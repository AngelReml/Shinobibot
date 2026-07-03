# BRIEFING — Estado actual de la remediación de seguridad de shinobibot
**Generado:** 2026-07-01. **Para:** un chat/modelo nuevo que va a continuar este trabajo sin haber visto la conversación previa.

Este documento es autocontenido: no asume que quien lo lea tiene memoria de nada anterior. Todo lo que afirma aquí está verificado directamente sobre el repositorio real (git log, git show, git status, lectura directa de archivos) en el momento de escribirlo, no repetido de memoria de una conversación anterior. Donde algo NO está verificado por mí directamente sino reportado por otra fuente (una sesión previa en la máquina Windows), lo digo explícitamente.

---

## 1. Qué es shinobibot

**shinobibot** ("Shinobi") es un agente autónomo Windows-native, v1.0.0, release público. Ejecuta acciones reales en la máquina (archivos, shell, navegador real vía CDP), orquesta sub-agentes, aprende y fabrica skills firmadas. No es un wrapper de chat. Repo local: `C:\Users\angel\Desktop\shinobibot`. TypeScript ESM, Node 22, tests con vitest. El propio repo trae un `AGENTS.md`/`CLAUDE.md` en la raíz con más detalle de arquitectura — léelo si necesitas contexto de producto más allá de esta remediación.

## 2. Qué es esta tarea

Una auditoría técnica externa produjo un plan de remediación de seguridad de **45 items**, organizados en fases **F0 a F6** (F0.1-F0.8, F1.1-F1.5, F2.1-F2.14, F3.1-F3.5, F4.1-F4.5, F5.1-F5.5, F6.1-F6.3). El trabajo lleva varias sesiones. El registro autoritativo de qué se decidió y por qué es **`DECISIONES.md`** en la raíz del repo (log append-only, más reciente arriba) — es la fuente de verdad sobre el histórico, más fiable que cualquier resumen de conversación, incluido este.

## 3. Reglas no negociables — léelas antes de tocar nada

Estas reglas las fijó el operador (angel, calycharlie@gmail.com) explícitamente durante la remediación, tras encontrar problemas reales por no seguirlas. Cualquier agente que continúe este trabajo debe respetarlas:

1. **Fuente de verdad = el contenido real de los archivos en la máquina Windows.** Durante esta remediación, un mount/sandbox Linux mostró divergencias silenciosas repetidas contra el contenido real (padding con bytes NUL, truncamientos a mitad de archivo, y al menos un caso de staleness total donde un archivo editado correctamente en Windows seguía viéndose con el contenido viejo desde el sandbox). Si vas a verificar o afirmar algo sobre un archivo, verifícalo leyéndolo directamente, no asumas que un `cat`/`grep` de un entorno intermedio es fiable. Si detectas una divergencia, repórtala explícitamente — nunca la resuelvas en silencio adivinando cuál versión es la correcta.
2. **El silencio, una pregunta aclaratoria o la ambigüedad NUNCA son aprobación.** No proceder con acciones consecuentes (commit, push, borrar algo, credenciales, CI con coste) sin una confirmación explícita e inequívoca del operador para ESA acción concreta. Una aprobación no se generaliza a acciones futuras.
3. **Ningún "arreglo" se declara verificado sin mutation testing.** Protocolo: copiar el/los archivo(s) de producción a un backup, romper el fix a propósito directamente en el árbol de trabajo, correr el test específico y confirmar que FALLA, restaurar desde el backup, confirmar que el diff es exactamente vacío, correr el test de nuevo y confirmar que vuelve a pasar. Un test que sigue en verde con el fix revertido es decorativo — no cuenta como cobertura real, hay que reportarlo como hallazgo, no darlo por bueno.
4. **Evidencia real, no resúmenes.** Pega salida real de comandos. Un fallo de test solo se clasifica como "problema de entorno, no del código" si hay prueba directa de que rompe ANTES de que se ejecute la lógica del test (p.ej. un binario ausente que revienta en `beforeAll`) — nunca por sospecha o plausibilidad.
5. **Nunca commitear, pushear ni borrar nada sin luz verde explícita y específica del operador para esa acción concreta**, incluso si el resto del trabajo ya está verificado y en verde.

## 4. Estado del repositorio ahora mismo (lo más importante — verificado en este momento)

```
Rama activa:        remediacion-2026-07-01
HEAD:                a6514521052bdabe3ab347e3a43a06324dccbc6d  (a651452)
main (sin tocar):    67e80fc — remediacion-2026-07-01 tiene exactamente 1 commit más que main
Pusheado:            NO. No existe origin/remediacion-2026-07-01 en el remoto.
Working tree:        limpio, salvo 1 archivo untracked: `<invalid>|*?.jsonl`
                      (residuo de nombre corrupto del trío audit.jsonl/.anchor/.chainhead.json,
                      ya cubierto por .gitignore, inofensivo — dejado a propósito sin borrar
                      por si el operador quiere inspeccionarlo primero).
```

El commit `a651452` (176 archivos, +7313/-2747) es el resultado de aplicar TODA la remediación F0-F6 más los hallazgos encontrados en la verificación final, y quedó hecho **localmente, sin push**. Autor: `AngelReml <calycharlie@gmail.com>`, fecha `2026-07-01 23:17:17 +0200`. Mensaje completo del commit:

> remediacion auditoria 2026-07-01 (F0-F6): hardening seguridad + build; ver DECISIONES.md
>
> Puertas verificadas: checkout -> npm ci -> typecheck -> test -> build:exe + arranque real (HTTP 200 en :3333). Corregidos 4 tests rotos encontrados en la verificacion (timeouts de red en memoria vectorial, citado de rutas Windows en apply_proposal, chequeo de rutas prohibidas cross-OS en audio_transcribe, separador de path en repo_map) y 3 gaps de empaquetado en build_exe.ts (onnxruntime-node/isolated-vm sin externalizar, prompts madre sin copiar, resolucion de package.json rota tras el bundle). Detalle completo de cada causa raiz en DECISIONES.md, incluido un hallazgo sin arreglar y documentado a proposito: la ruta SEA canonica (rebuild.cmd) tiene un problema distinto (Node SEA no soporta require() de nativos de terceros) que release.yml nunca detecta porque no arranca el .exe resultante.

## 5. Qué se verificó realmente y cómo — las "5 puertas"

El operador exigió una verificación real en la máquina Windows real (no solo en sandbox) antes de commitear nada, con la regla explícita "cada bloque tiene una puerta: si falla, paras y me lo dices". Las 5 puertas eran: (1) `git checkout -b remediacion-2026-07-01`, (2) `npm ci`, (3) `npm run typecheck`, (4) `npm run test`, (5) `npm run build:exe` + arrancar el `.exe` manualmente. Este proceso fue ejecutado por una sesión previa directamente en la máquina Windows (no por mí en este chat) — lo que sigue lo tengo verificado de forma cruzada contra el estado real del commit `a651452` (diffstat, lista de archivos, contenido de `DECISIONES.md`), así que confío en el relato, aunque no lo presencié en vivo.

**Puertas 1-3:** limpias a la primera. `npm ci` pasó — confirma que `package-lock.json` **no** está corrupto en el disco real (una duda que sí existía por divergencias vistas en el sandbox Linux de sesiones anteriores).

**Puerta 4 (`npm run test`) falló primero:** 10 de 2099 tests rotos en 6 archivos (212/218 archivos en verde). Se investigó cada causa raíz — las 4 eran bugs reales, no artefactos de entorno (confirmado porque CI corre en `windows-latest`, el mismo SO donde se reprodujo):

1. `src/memory/{memory_store,provenance,curated_memory_isolation}.test.ts` (5 tests, timeout de 10s) — estos 3 archivos no forzaban `SHINOBI_EMBED_PROVIDER=hash`, así que caían al backend real de embeddings ONNX (`@huggingface/transformers`, autodetectado), que intentaba descargar el modelo `Xenova/all-MiniLM-L6-v2` y colgaba. Arreglado forzando la misma variable que ya usaban otros test files equivalentes.
2. `src/committee/__tests__/apply_proposal.test.ts` (2 tests) — el helper de test `buildValidDiff` reescribía cabeceras de diff con `startsWith("--- a/")` (prefijo exacto), pero en Windows `git diff --no-index` cita las rutas con comillas por los backslashes (`--- "a/C:\Users\...`), así que no matcheaba. El código de producción real (`improvements.ts`, `computeDiffForProposal`) ya usaba un prefijo más laxo que sí funciona — se alineó el test con la técnica real.
3. `src/tools/__tests__/audio_prohibited_uses_canonical.test.ts` (2 tests) — bug real en producción (`audio_transcribe.ts`): un path POSIX (`/etc/passwd`) pasado en un proceso Windows no es reconocido como absoluto por `path.resolve`, colando el check de rutas prohibidas. Mismo tipo de bug que ya se había arreglado en `permissions.ts` (`looksLikeForeignAbsolutePath`) en una ronda anterior, pero `audio_transcribe.ts` no reusaba esa lógica. Arreglado.
4. `src/reader/__tests__/repo_map.test.ts` (1 test) — `formatSearchResults` imprimía el path crudo de `path.relative()` (usa `\` en Windows) en vez de normalizar a `/`. Arreglado en `repo_map.ts`.

Tras los 4 arreglos: **218/218 archivos, 2098/2099 tests en verde (1 skip)**. Typecheck re-confirmado limpio.

**Puerta 5 (`build:exe`)** compiló pero el `.exe` no arrancaba. 3 gaps de empaquetado encontrados y arreglados en `scripts/build_exe.ts` (ruta NO canónica, vía `@yao-pkg/pkg` — nunca se había re-validado end-to-end desde que se añadieron varias dependencias nuevas):
- `onnxruntime-node`, `@huggingface/transformers` e `isolated-vm` no estaban marcados `external` en esbuild ni empaquetados como assets nativos (igual que ya se hacía con `better-sqlite3`).
- Los prompts markdown de `src/agents/prompts/*.md` no se copiaban al bundle — tras colapsar todo a un único `.cjs`, `dirname(import.meta.url)` deja de apuntar a la ruta original.
- `src/utils/app_version.ts` resolvía `package.json` con una ruta relativa (`../../package.json`) que asumía la profundidad de directorio original; tras el bundle, esa ruta aterrizaba fuera del propio repo dentro del filesystem virtual de `pkg`. Se añadió un fallback vía `define` de esbuild (constante inyectada en build, nunca usada en dev/CLI/tests) que solo se activa si el `require` normal falla.

Verificado real: `Shinobi.exe` arranca, sirve en `:3333`, responde HTTP 200 (confirmado con una petición HTTP real, no solo "el proceso no crasheó"). Degradación conocida y no bloqueante: el índice semántico vectorial queda deshabilitado dentro del `.exe` empaquetado (límite conocido de V8 snapshots con imports dinámicos) pero el resto de la memoria sigue funcionando y esto ya estaba diseñado como best-effort.

**Hallazgo aparte, documentado pero deliberadamente NO arreglado:** la ruta de release "canónica" (la que de verdad usa `.github/workflows/release.yml`: `rebuild.cmd` → `build_sea.mjs` + Node SEA + postject) tiene un problema distinto y más profundo — dentro de un binario SEA, `require('better-sqlite3')` revienta con `ERR_UNKNOWN_BUILTIN_MODULE`, porque Node SEA no soporta `require()` normal de paquetes nativos de terceros. No es un fix de una línea; requiere repensar cómo el SEA carga nativos. Además se descubrió que `release.yml` nunca arranca el `.exe` resultante como smoke test — solo lo compila — así que este problema pudo llevar roto un tiempo indeterminado sin que CI lo detectara. El operador, al preguntársele cómo seguir, eligió explícitamente "dejarlo documentado y parar aquí" — **esto sigue sin arreglar, a propósito.**

Todo el detalle causa-por-causa de lo anterior está en la entrada de `DECISIONES.md` fechada 2026-07-01, título "Remediación post-auditoría — 4 tests rotos arreglados + build:exe reparado + SEA canónico roto documentado (no arreglado)".

## 6. Qué más se hizo en esta remediación (resumen de fases anteriores, ya en el commit)

- **F0** — purga de branding legacy, normalización de finales de línea CRLF/LF y `core.fileMode`, consistencia de versión (varios literales `'2.0.0'` huérfanos corregidos para usar `APP_VERSION` como fuente única, incluido un hallazgo nuevo en `src/web/server.ts` fuera del plan original de auditoría).
- **F1** — seguridad crítica. F1.4 cerrado: perfil de navegador Shinobi dedicado (no reutiliza el perfil de Chrome/Comet del usuario), CDP solo en loopback, con test de regresión. **F1.2 (sandboxing real con `isolated-vm` para `plugin_loader.ts`) sigue diferido — decisión explícita del operador, no está cerrado.**
- **F2** (14 items) — incluye path traversal cross-OS en `permissions.ts` (`looksLikeForeignAbsolutePath`, luego replicado a `audio_transcribe.ts` en esta última ronda), ancla anti-truncado del audit log (F2.3), y F2.11: el mutex del orchestrator (`runExclusive`). Aquí hubo un hallazgo importante en la pasada de verificación forense: mutation testing reveló que `ShinobiOrchestrator.process()` no tenía cobertura de integración real del mutex — el test existente (`orchestrator_mutex.test.ts`) solo probaba `runExclusive` como primitiva aislada, y mutar `process()` para saltarse el mutex dejaba toda la suite en verde. Se cerró con un test nuevo y dedicado, `src/coordinator/__tests__/process_uses_mutex.test.ts`, verificado con el mismo protocolo de mutación (se rompió el fix, se confirmó que el test nuevo SÍ falla, se restauró, se confirmó verde de nuevo). Este test ya está incluido en el commit `a651452`.
- **F5** — se confirmó que `.github/workflows/gates.yml` **ya existía** de una fase anterior (no fue necesario crearlo) y ya resolvía F5.3 correctamente: 6 jobs, todos `continue-on-error: true` (informativos), los que necesitan LLM/red gateados detrás de una variable de repo no-secreta (`SHINOBI_ENABLE_LLM_GATES`, por defecto apagada). Se añadió `npm audit --production --audit-level=high` a `ci.yml` (bloqueante, sin coste, sin secrets).
- **Pasada de verificación forense completa** (post-remediación, con backup verificable, barrido de corrupción de archivos, mutation testing de 5 fixes distintos, matriz de cobertura) — confirmó todo excepto el gap de F2.11 arriba mencionado, que se cerró en una tarea de seguimiento dedicada.

## 7. Qué queda pendiente — decisiones que le corresponden al operador, no al agente

- **¿Push de `remediacion-2026-07-01`?** El commit está listo y verificado, pero no pusheado. El propio operador dijo que quería revisar el commit contra su checklist original antes de decidir. **No pushear sin luz verde explícita.**
- **¿Merge a `main`?** Tampoco decidido.
- El problema de Node SEA + módulos nativos de terceros (`ERR_UNKNOWN_BUILTIN_MODULE`) en la ruta de release canónica — documentado, no arreglado, requiere rediseño de cómo el SEA carga binarios nativos.
- `release.yml` no smoke-testea el `.exe`/binario SEA resultante — solo compila. Es un gap de CI real, separado del bug anterior.
- F1.2 (`isolated-vm` real para el sandbox de plugins) sigue diferido.
- F0.8 (barrido de TODO/FIXME/HACK) — explícitamente marcado como NO re-verificado en la última pasada, no asumir que está completo.
- Si activar `SHINOBI_ENABLE_LLM_GATES=true` como variable real en la configuración del repo de GitHub (activaría los jobs de `gates.yml` que dependen de LLM/red) — decisión del operador.
- El archivo untracked `<invalid>|*?.jsonl` sigue en el working tree, sin borrar a propósito.

## 8. Cómo seguir

Si el operador confirma explícitamente que revisó el commit `a651452` y quiere pushear o mergear, es una acción simple (`git push -u origin remediacion-2026-07-01`, y luego decidir sobre el merge por separado). Si en cambio quiere abrir un frente nuevo (el problema del SEA, F1.2, o el smoke test faltante de `release.yml`), cada uno es un cambio de código real que requiere el mismo rigor que el resto de esta remediación: nada se declara "arreglado" sin mutation testing, nada se commitea sin aprobación explícita.

Antes de tocar cualquier archivo, léelo directamente (no asumas el estado por lo que dice este documento o cualquier otro histórico) — esto es exactamente el tipo de proyecto donde ya se ha demostrado, repetidas veces, que asumir sin verificar produce errores reales.

## 9. Referencia rápida

```
Repo:                C:\Users\angel\Desktop\shinobibot
Rama activa:         remediacion-2026-07-01 (1 commit por delante de main, sin pushear)
Fuente de verdad:    DECISIONES.md (histórico) > AGENTS.md/CLAUDE.md (mapa del repo)

npm run start        tsx scripts/shinobi.ts          (CLI)
npm run dev           tsx scripts/shinobi_web.ts       (WebChat :3333)
npm run test          vitest run
npm run typecheck     tsc --noEmit
npm run build:exe     ruta NO canónica (pkg) — la que se verificó en la puerta 5
rebuild.cmd            ruta canónica de release (Node SEA) — rota, ver sección 5/7
```
