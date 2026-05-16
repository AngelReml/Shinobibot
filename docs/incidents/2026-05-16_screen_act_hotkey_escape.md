# Incidente 2026-05-16 — `screen_act` + Alt+F4: fuga por hotkey destructiva

**Fecha:** 2026-05-16
**Severidad:** Alta (riesgo de pérdida de trabajo del usuario)
**Estado:** Resuelto — 3 fixes + test de regresión.
**Detectado en:** sesión real con Iván.

## Resumen

Iván pidió una misión de navegación web. El navegador (Comet) no estaba abierto,
así que no había puerto de depuración CDP disponible. La tool `clean_extract`
falló con `No browser on port 9222`.

En lugar de parar y avisar, Shinobi intentó "arreglar" el entorno por su cuenta:

1. Probó **12 keywords distintas** con `clean_extract` — todas fallaron por el
   mismo motivo (browser no disponible).
2. Cambió a `run_command`, luego a `screen_observe` — mismo motivo.
3. Finalmente usó `screen_act` con **Alt+F4** intentando cerrar ventanas del
   usuario para "reiniciar" el navegador.

La blacklist destructiva existente rechazó correctamente `Stop-Process`, pero
`screen_act` con hotkeys destructivas (Alt+F4) **no estaba cubierto**: Alt+F4
solo estaba gateado por confirmación, no bloqueado.

## Causas raíz

### Bug 1 — el loop detector no detectó el patrón
El detector tenía dos capas:
- **Capa 1 (args):** SHA256(tool+args). No disparó porque cada `clean_extract`
  usaba una keyword distinta → args distintos.
- **Capa 2 (output):** fingerprint reducido del output. No disparó porque cada
  output mencionaba la keyword (`extract "gatos": No browser…` vs
  `extract "perros": No browser…`) → fingerprints distintos.

Ninguna capa veía lo esencial: **12 fallos con la misma CAUSA de entorno**
(browser caído). Cambiar de keyword/tool/táctica nunca iba a progresar.

### Bug 2 — `screen_act` sin blacklist dura de hotkeys destructivas
Alt+F4, Ctrl+W, Ctrl+Q, Win+L, Alt+Tab… solo estaban gateadas por confirmación
(`isDestructiveAction`). En modo no interactivo la confirmación auto-deniega,
pero el agente seguía rotando tácticas hasta dar con una hotkey que pasara.
Una hotkey que cierra la ventana del usuario nunca es una acción legítima de
un agente que persigue un objetivo.

### Bug 3 — falta la regla "si falla el browser, para y pide ayuda"
No había ninguna señal que dijera "el entorno está roto, no lo arregles tú".
Shinobi asumió que matar procesos / cerrar ventanas era una táctica válida.

## Fixes aplicados

### Fix 1 — Blacklist dura de hotkeys destructivas en `screen_act`
`src/utils/screen_safety.ts`: nueva función `checkDestructiveHotkey()` con una
blacklist (`DESTRUCTIVE_HOTKEY_BLACKLIST`) que `screen_act` consulta antes de
ejecutar. Rechaza de plano —**sin posibilidad de bypass con `force_confirm`**—:

| Combo | Motivo |
|---|---|
| Alt+F4 | cierra la ventana activa |
| Ctrl+W / Ctrl+F4 | cierra pestaña / documento |
| Ctrl+Q / Ctrl+Shift+Q | cierra la aplicación |
| Win+L | bloquea la sesión |
| Win+D / Win+M | minimiza todas las ventanas |
| Ctrl+Alt+Delete | secure attention sequence |
| Alt+Tab | cambia de contexto sin progreso |

Reconoce alias de nut-js (`LeftAlt`, `LeftControl`, `super`, `cmd`…) vía
`normalizeKeyToken()`. Alt+F4 y Ctrl+W se sacaron de `isDestructiveAction`
(antes "confirmables") porque ahora son bloqueo duro.

### Fix 2 — Loop detector capa 3: "modo de fallo de entorno repetido"
`src/coordinator/loop_detector.ts`: nueva capa 3.
- `classifyFailureMode(error)` clasifica un error en un modo de fallo de
  **entorno** estable: `browser_unavailable`, `auth_invalid`, `file_not_found`,
  `network_unreachable` — o `null` si el error parece un bug del agente (que sí
  se arregla cambiando de táctica).
- `LoopDetector.recordOutcome(tool, success, error)` lleva la racha de fallos
  consecutivos del mismo modo. Tras **3** (configurable con
  `SHINOBI_LOOP_MAX_SAME_FAILURE`) aborta con el veredicto nuevo
  `LOOP_SAME_FAILURE`, **aunque sean tools y args distintos**. Un éxito o un
  fallo de otro modo rompe la racha.

El orchestrator llama `recordOutcome` tras cada tool y, ante
`LOOP_SAME_FAILURE`, para y pide intervención humana con un mensaje específico
del modo de fallo (`failureModeAdvice`).

### Fix 3 — Regla "si falla el browser, para y pide ayuda"
Es consecuencia de la capa 3: ante fallos de entorno repetidos Shinobi **para
y reporta al usuario** en lugar de intentar arreglar el entorno. El mensaje
para `browser_unavailable` pide explícitamente *"abre Comet y reintenta"*.
Shinobi ya no mata procesos ni cierra ventanas para "recuperar" el navegador.

## Test de regresión

`src/coordinator/__tests__/incident_2026-05-16_screen_act_hotkey_escape.test.ts`
simula el escenario "Iván pide misión de browser sin Comet abierto" y verifica:
- `screen_act` rechaza Alt+F4, Ctrl+W, Ctrl+Q, Win+L, Alt+Tab… (incluidos alias).
- Hotkeys legítimas (Ctrl+S, Ctrl+C…) siguen permitidas.
- El detector para en el **3er** fallo de browser, no en el 12º.
- La detección cruza tools distintas (`clean_extract` → `run_command` →
  `screen_observe`).
- Un éxito o un fallo de otro modo no produce falsos positivos.

## Archivos tocados

- `src/utils/screen_safety.ts` — `checkDestructiveHotkey`, `normalizeKeyToken`.
- `src/tools/screen_act.ts` — aplica la blacklist antes de ejecutar.
- `src/coordinator/loop_detector.ts` — capa 3 (`classifyFailureMode`,
  `recordOutcome`, `LOOP_SAME_FAILURE`, `failureModeAdvice`).
- `src/audit/audit_log.ts` — veredicto `LOOP_SAME_FAILURE` en el audit log.
- `src/coordinator/orchestrator.ts` — integra la capa 3.
- `src/coordinator/__tests__/incident_2026-05-16_screen_act_hotkey_escape.test.ts` — regresión.
- `src/coordinator/__tests__/loop_detector.test.ts` — tests de la capa 3.
