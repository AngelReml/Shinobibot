# Incidente 2026-05-16 — `screen_act` + Alt+F4: fuga por hotkey destructiva

**Fecha:** 2026-05-16
**Severidad:** Alta (riesgo de pérdida de trabajo del usuario)
**Estado:** Fix 2 corregido (2ª iteración). Pendiente de validación en prueba
real — los tests NO cierran este incidente (ver Adenda).
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
> ⚠️ La 1ª versión de este fix (contador de fallos **consecutivos**) NO
> funcionó en prueba real. Lo que sigue describe la versión **corregida**
> (acumulativo + ventana deslizante). Ver "Adenda" más abajo.

`src/coordinator/loop_detector.ts`: nueva capa 3.
- `classifyFailureMode(error)` clasifica un error en un modo de fallo de
  **entorno** estable: `browser_unavailable`, `auth_invalid`, `file_not_found`,
  `network_unreachable` — o `null` si el error parece un bug del agente (que sí
  se arregla cambiando de táctica).
- `LoopDetector.recordOutcome(tool, success, error)` usa **dos señales** que
  ignoran lo que ocurra entre los fallos (éxitos, sleeps, otras tools):
  - **Contador acumulativo** por modo: total en TODA la misión, nunca se
    resetea. ≥ `maxSameFailureMode` (default 3, env
    `SHINOBI_LOOP_MAX_SAME_FAILURE`) → abort. Backstop duro.
  - **Ventana deslizante**: ≥ `failureWindowThreshold` (default 3, env
    `SHINOBI_LOOP_FAILURE_WINDOW_THRESHOLD`) fallos del mismo modo en las
    últimas `failureWindowSize` (default 6, env
    `SHINOBI_LOOP_FAILURE_WINDOW_SIZE`) llamadas → abort.
  Aborta la primera que dispare, con el veredicto `LOOP_SAME_FAILURE` —
  **aunque sean tools y args distintos y haya tools intercaladas**.

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

## Adenda 2026-05-16 — el primer Fix 2 fue insuficiente

La primera versión del Fix 2 implementó la capa 3 como **"N fallos
CONSECUTIVOS del mismo modo de fallo"**: un contador que se incrementaba con
cada fallo de entorno y se **reseteaba a cero** ante cualquier éxito o fallo de
otro tipo.

En la **2ª prueba real con Iván** no funcionó. En ejecución real Shinobi NO
falla en `clean_extract` doce veces seguidas: **intercala** otras tools entre
los fallos — `taskkill` (rechazado por la blacklist), `sleeps`,
`screen_observe`. Cada tool intercalada que no fallaba por `browser_unavailable`
reseteaba el contador consecutivo. Resultado: los fallos de `browser_unavailable`
cayeron en las iteraciones **4, 5 y 8** (no consecutivas), el contador nunca
pasó de 2, y Shinobi llegó a la **iteración 10** sin abortar.

### Por qué el test de regresión no lo detectó

El test de regresión inicial simulaba **fallos consecutivos**
(`recordOutcome` × 3 seguidos del mismo modo). Con esa secuencia sintética el
contador consecutivo SÍ llegaba a 3 y abortaba — el test pasaba en verde. Pero
la secuencia sintética no se parecía a la realidad: **el test validaba el
camino feliz del propio diseño, no el comportamiento observado**.

Lección: un test de regresión de un incidente debe reproducir la **traza real**
del incidente (aquí: fallos intercalados), no una versión idealizada que
encaje con la implementación elegida. Un test que solo pasa porque imita la
suposición del código no es una regresión válida.

### Corrección

La capa 3 ya **no cuenta consecutivos**. Usa un **contador acumulativo** por
modo (total de la misión, nunca se resetea) más una **ventana deslizante**
(N fallos del mismo modo en las últimas M llamadas). Ambos ignoran las tools
intercaladas. El test de regresión se reescribió con el fixture
`REAL_SESSION_ITERS` (iteraciones 1-10 con sus modos de fallo reales) y verifica
que Shinobi aborta en la **iteración 8** (3er `browser_unavailable`), no en la
10+. El test incluye una aserción explícita de que la racha consecutiva máxima
del fixture es 2 — es decir, el diseño viejo NO habría abortado.

### Esto NO cierra el incidente

Los tests verifican la lógica del detector, pero el incidente solo se
considerará cerrado tras una **nueva prueba real observada** por Iván. La
validación por test sintético ya falló una vez; la única validación válida es
la ejecución real.
