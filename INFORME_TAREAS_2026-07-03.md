# Informe — tareas pendientes en `prompt.txt` (2026-07-03)

## Qué encontré

Dos ficheros `prompt.txt` distintos en el repo:

- **`prompt.txt` (raíz):** scratchpad de otro agente ("Security Gatekeeper") que verificó
  contra bytes reales (no contra el parte de Claude Code) que **ALTA-02 estaba cerrada de
  verdad** en `HEAD 068c17b`, diagnosticó un "árbol sucio" de `src/confine/`/`src/policy/`
  como desincronización del índice de git (no pérdida de trabajo), y dejó **dos
  META-PROMPTs dirigidos a Claude Code** (yo) más una limpieza de índice pendiente.
- **`Sello/prompt.txt`:** encargo de implementar 13 (+1 candidata) probes RESPEC del
  modelo §6.2 del contrato de Sello, con tabla de resultados naive-vs-robusto.

El usuario me pidió priorizar las cuatro. Las hice en orden de riesgo creciente.

---

## 1. Limpieza del índice de git — hecho, sin commit (no aplica)

Confirmé la hipótesis del gatekeeper contra los bytes: `git diff HEAD` sobre todos los
ficheros marcados `MM`/`D`/`??` (incluyendo `src/confine/`, `src/policy/`) daba **cero
diferencias** salvo `DECISIONES.md`, que tenía una frase truncada a mitad — corrupción real
del árbol de trabajo (no del commit), coherente con el hallazgo previo de que el mount de
este entorno pica ficheros ya commiteados. Restauré `DECISIONES.md` desde `HEAD` y corrí
`git reset` para resincronizar el índice. Resultado: `git status` limpio, nada perdido.

## 2. P2.E3.c — DPAPI cifra en reposo la identidad de dispositivo — **CERRADO**

**Commit:** [`cb80b2a`](../../commit/cb80b2a) — *P2.E3.c cerrada: DPAPI cifra en reposo la identidad de dispositivo*

`src/attest/device_identity.ts` persistía la clave privada Ed25519 en `.shinobi/device_key.json`
con permisos 0600 pero **en claro** (seam documentado en el propio fichero). Nuevo
`src/attest/dpapi.ts` envuelve `System.Security.Cryptography.ProtectedData` (scope
`CurrentUser`) vía `powershell.exe -EncodedCommand` (mismo transporte que
`src/tools/_powershell.ts`: base64 UTF-16LE, cero interpolación de shell). El JSON persistido
pasa a `{ publicKeyPem, privateKeyEnc, dpapi:true }` — la privada nunca vuelve a tocar disco
en claro cuando DPAPI está disponible.

**Fail-soft en dos niveles:** fuera de win32, o si la llamada a PowerShell falla, cae al
formato legado en claro con `console.warn` (no rompe CI/Linux/multiusuario); un blob DPAPI
que no desenvuelve (otro usuario/máquina, o corrupto) se trata igual que un fichero corrupto
ya se trataba: no reutiliza una clave dudosa, regenera una identidad nueva. Los ficheros
legados existentes se siguen leyendo sin migración forzosa.

**Verificado (no solo "tests verdes"):**
- `tsc --noEmit`: 0 errores.
- Roundtrip **real** (sin mocks) contra `powershell.exe` + DPAPI en esta máquina Windows.
- El JSON en disco tiene `dpapi:true`+`privateKeyEnc`; **cero** apariciones de `BEGIN PRIVATE
  KEY` ni de la PEM privada como substring.
- Segundo arranque (proceso nuevo) desenvuelve el blob y reusa la MISMA identidad.
- **Mutación** (regla del repo): forcé `dpapiPlatformSupported()` a devolver siempre `false`
  → los tests que exigen formato DPAPI en disco se pusieron **rojos** (volvía a persistir en
  claro) → restaurado → **verdes**.
- Suite completa: **232 test files / 2205 tests passed / 3 skipped**.

## 3. P1.E4 — ruta PowerShell por el monitor — **CERRADO (parcial, con hallazgo honesto)**

**Commit:** [`4a504f4`](../../commit/4a504f4) — *P1.E4 parcial: ruta PowerShell cerrada por el monitor; Job Object no se envía*

### Parte 1 — cerrada
`run_command.ts` con `shell:'auto'` en win32 (el comportamiento **por defecto** del producto
en su host nativo) llamaba a `runPowerShell()` directo, esquivando `mediatedEffect()` — la
brecha de mayor tráfico real, documentada explícitamente en `monitor.ts`. Nuevo backend
`'powershell'` (`src/sandbox/backends/powershell.ts`) envuelve `runPowerShell()` tras el
contrato `RunBackend`, registrado en el `sandboxRegistry()`. `run_command.ts` ahora arma un
`ShellEffect` y pasa por `mediatedEffect` — mismo `runPowerShell()` por debajo (misma defensa
F1.1 intacta), cero cambio de comportamiento observable, solo cambia el camino: ahora
auditado, con el mismo chokepoint que `'local'`.

**Verificado:** `tsc` 0; test real contra `powershell.exe`; **mutación** (revertí
temporalmente a llamar al backend directo, bypass de `mediatedEffect` — los tests que
assertan `monitorStats().mediated` se pusieron rojos → restaurado → verdes); suite completa
**232 files / 2211 tests passed / 3 skipped**.

### Parte 2 — Job Object, NO enviada (honestidad, no un fallo silenciado)
Investigué y prototipé confinamiento nativo (`CreateJobObject`/`SetInformationJobObject`/
`AssignProcessToJobObject` vía P/Invoke desde PowerShell). **Hallazgo empírico en este
entorno de desarrollo:** el proceso ya está anidado dentro de un Job Object externo
(`IsProcessInJob` → `true` antes de crear el mío), y un límite `JOB_OBJECT_LIMIT_PROCESS_MEMORY`
de 8MB **no impidió** una reserva+touch de 200MB en la prueba directa — no pude verificar que
el límite confine de verdad en este entorno concreto. La instrucción del encargo era
explícita: *"si Job Object/AppContainer no contiene un vector, repórtalo, no lo finjas"*. No
comiteé ese código: enviarlo sin verificación real sería exactamente la jaula fingida que la
instrucción prohíbe. Detalle completo del experimento en `DECISIONES.md` (entrada del
2026-07-03, P1.E4).

**Queda pendiente** (no para mí en este sandbox): repetir la verificación en una máquina
Windows sin anidamiento de job previo antes de comitear cualquier código de confinamiento de
proceso.

## 4. Sello — 13 (+1) probes RESPEC — **YA ESTABA CERRADO**

Antes de implementar nada, verifiqué el estado real del repo: `Sello/probes/RESPEC_SUMMARY.md`,
`RESULTS_probes.md`, `corpus_v1_respec.jsonl` y `SELLO_CONTRACT.md` §6.2 (marcado **FINAL**)
ya existían, ya estaban commiteados (`git status` limpio en `Sello/`) y ya cubrían exactamente
lo que pedía `Sello/prompt.txt`: CN-30 reconsiderada de UNBOUND a RESPEC (task-agnóstica), el
overlay de CN-15/16/17/18/19/31/32 confirmado como disparo **solo si el output ejecuta** la
acción inyectada (no por la mera presencia de la inyección en el prompt), y la tabla de
resultados naive-vs-robusto.

Para no dar esto por bueno solo porque el fichero lo dice, **re-corrí el pipeline en vivo**:

```
npx tsx scripts/run_probes.ts
```

Resultado: **14/14 probes producen su `expected_shift`**, salida idéntica byte a byte a
`RESULTS_probes.md`. No hice ningún cambio — no había nada pendiente que hacer.

---

## Resumen de commits en `remediacion-2026-07-01` (pusheados)

| Commit | Qué |
|---|---|
| `cb80b2a` | P2.E3.c — DPAPI cifra en reposo la identidad de dispositivo |
| `4a504f4` | P1.E4 (parcial) — ruta PowerShell por el monitor; Job Object investigado y NO enviado |

## Qué falta (para una sesión futura, no en este sandbox)

- **P1.E4 Job Object:** repetir la verificación de confinamiento de memoria en una máquina
  Windows real (sin anidamiento de job previo) antes de comitear código.
- **P2.E3.c → P6 (build/SBOM):** mencionado como siguiente meta-prompt en el `prompt.txt`
  original, no abordado en esta sesión (no estaba en las 4 tareas priorizadas).
