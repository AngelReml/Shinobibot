# Incidente 2026-05-16 — regresión de la conexión CDP al navegador del usuario

**Fecha:** 2026-05-16
**Tipo:** Investigación forense (diagnóstico — **sin fix**, pendiente de revisión con Iván)
**Síntoma:** toda misión de browser falla con
`No browser on port 9222, but a Comet/Chrome process is already running. Chromium refuses to enable remote debugging on a second instance.`
**Relacionado:** [`2026-05-16_screen_act_hotkey_escape.md`](2026-05-16_screen_act_hotkey_escape.md)
— ese incidente fue la *reacción* de Shinobi a este fallo (intentó cerrar
ventanas con Alt+F4). Este informe es la *causa raíz*.

---

## TL;DR

**Ningún commit rompió la conexión al navegador.** El código de conexión CDP
(`src/tools/browser_cdp.ts → connectOrLaunchCDP / doLaunch`) es **byte-idéntico
desde el 2026-05-10** (commit `980f34e`, bloque2), cinco días *antes* de que
empezara el plan intensivo. El único commit del plan que tocó ese fichero
(`3f744fe`, V2) solo **añadió** el modo CDP remoto opcional y no altera el
camino local.

La regresión es **de entorno, no de código**: Comet está corriendo **sin** el
flag `--remote-debugging-port=9222`. Verificado en vivo (ver Evidencia). El
mecanismo que funcionaba "antes" nunca fue un launcher en el repo — era el
**paso manual documentado** en `docs/01_ecosystem.md`: arrancar Comet con ese
flag. Ese paso no se está cumpliendo ahora.

---

## (a) ¿Qué commit(s) rompieron la conexión?

**Ninguno.** Evidencia del `git log`:

### Historia completa de `src/tools/browser_cdp.ts`
```
3f744fe  2026-05-15 10:50  feat(V2): SHINOBI_BROWSER_CDP_URL para CDP remoto
980f34e  2026-05-10 00:12  feat(bloque2): browser profesional — motor central
```
Solo **dos** commits en toda la vida del fichero.

- `980f34e` (bloque2, **2026-05-10**) creó `browser_cdp.ts`. La función
  `doLaunch()` — incluyendo el guard `isBrowserProcessRunning()` y el mensaje
  de error exacto que vemos hoy — estaba **ya presente, idéntica**, en esa
  primera versión (verificado con `git show 980f34e:src/tools/browser_cdp.ts`).
- `3f744fe` (V2, **2026-05-15**) es el único commit del plan intensivo que
  tocó el fichero. Su diff **solo añade** la función `remoteCdpUrl()` y un
  bloque `if (remote) { ... }` al inicio de `connectOrLaunchCDP()`. El camino
  local (`connectOverCDP('http://localhost:9222')` + `ensureLaunched()`) **no
  se modificó**.

### El modo remoto está inactivo
El bloque nuevo de V2 solo se ejecuta si `SHINOBI_BROWSER_CDP_URL` está
definida. Verificado: **no está en `.env`** (el `.env` local solo tiene
`GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `MEM0_API_KEY`,
`SUPERMEMORY_API_KEY`, `MATRIX_*`, `OLLAMA_URL`, `OPENGRAVITY_URL`,
`AUDIT_PORT`, `WORKSPACE_ROOT`). Además, si estuviera definida, el error sería
otro (`SHINOBI_BROWSER_CDP_URL=... no alcanzable`). El error observado es el de
**modo local**, lo que confirma que el modo remoto no interviene.

### Las demás tools de browser tampoco cambiaron
`web_search.ts`, `clean_extract.ts`, `browser_click.ts`, `browser_scroll.ts`,
`browser_click_position.ts`, `web_search_with_warmup.ts` y `browser_engine.ts`
tienen su último commit en `980f34e` (bloque2) o antes. Ninguna fue tocada
durante el plan intensivo. Todas obtienen el navegador llamando a
`connectOrLaunchCDP()` — la lógica está centralizada y congelada.

### Cronología (clave)
- **2026-05-10** — bloque2: `browser_cdp.ts` creado con la lógica actual.
- **2026-05-10 → 2026-05-14** — ventana "antes del plan" que recuerda el
  usuario. Código de conexión = el de hoy.
- **2026-05-15** — el plan intensivo entero (Sprints 1.x–3.x, P1–P3, V1–V6)
  ocurrió en un único día. V2 añadió el modo remoto (inerte).
- **2026-05-16** — hoy.

**Conclusión:** no hay commit que revertir. El código no es la causa.

---

## (b) ¿Cómo funcionaba antes exactamente?

El navegador del usuario **nunca** se arrancó con CDP desde un script del repo.
No existe —ni existió— ningún launcher: `git log -S"remote-debugging-port"` no
devuelve ningún `.cmd`/`.lnk`/launcher, `git log --diff-filter=D` no muestra
ningún launcher borrado, y `shinobi_web.cmd` solo hace `start http://localhost:3333`
(abre el navegador por defecto en una URL, **sin** flag de debugging).

El mecanismo real, documentado en **`docs/01_ecosystem.md` §"Comet (navegador)"**:

> - Comando para arrancar con CDP:
>   `"C:\Program Files\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222 --no-first-run --no-default-browser-check`
> - **Flujo operativo correcto (validado)** → paso 1:
>   *"Arrancar Comet con CDP en 9222 (**manualmente**, comando arriba)"*

Es decir: **el usuario arranca Comet con el flag a mano** (un acceso directo
con ese Target, o el comando). Con eso, Comet escucha CDP en `:9222` con el
perfil del usuario y sus sesiones (Upwork, LinkedIn, Fiverr…). Shinobi entonces
hace `chromium.connectOverCDP('http://localhost:9222')` y opera esa sesión.

Había además un **fallback de auto-lanzamiento** en `browser_cdp.ts`
(`doLaunch → launchBrowserDetached`): si **no hay ningún** proceso
comet.exe/chrome.exe corriendo, Shinobi lanza `comet.exe --remote-debugging-port=9222`
él mismo. Pero ese fallback solo dispara con el navegador **completamente
cerrado** — por diseño no puede activar debugging sobre un Comet ya abierto
(limitación single-instance de Chromium). El guard `isBrowserProcessRunning()`
existe precisamente para dar un error claro en ese caso.

Resumen del estado que "funcionaba": Comet abierto **con** el flag (paso manual)
→ puerto 9222 abierto → `connectOverCDP` conecta a la primera. O Comet cerrado
→ Shinobi lo auto-lanza con el flag.

---

## (c) Evidencia en vivo — el estado actual del sistema

Inspección del sistema (2026-05-16, read-only):

### Comet está corriendo SIN el flag de debugging
`Get-CimInstance Win32_Process` — proceso principal de Comet:
```
Name        : comet.exe
ProcessId   : 3580
CommandLine : "C:\Program Files\Perplexity\Comet\Application\comet.exe"
```
**La línea de comando no contiene `--remote-debugging-port`.** Comet se lanzó
de forma normal (icono / arranque estándar), no con el comando documentado.
Hay ~25 procesos `comet.exe` hijos (renderers, gpu, utility) — Comet está
plenamente abierto y en uso. Versión: `148.0.7778.222`. Perfil:
`C:\Users\angel\AppData\Local\Perplexity\Comet\User Data`.

### El puerto 9222 está cerrado
`Get-NetTCPConnection -LocalPort 9222 -State Listen` → **nada escuchando en 9222.**

### La carpeta de Inicio (Startup) está vacía
`shell:Startup` (`%APPDATA%\...\Startup`) no contiene accesos directos. La nota
histórica `docs/sessions/2026-05-02_capas-1-2-3.md` mencionaba un *"acceso
directo del 28/04 en Startup"* que abría Comet solo; hoy ese acceso directo
**ya no está** (o nunca llevó el flag — era el arranque normal de Perplexity).

### Cadena de fallo resultante
`connectOrLaunchCDP()` →
1. `connectOverCDP('http://localhost:9222')` → falla `ECONNREFUSED` (puerto cerrado).
2. `ensureLaunched()` → `doLaunch()`:
   - `isPortOpen(9222)` → `false`.
   - `isBrowserProcessRunning()` → `true` (comet.exe por todas partes).
   - → **lanza el error exacto del síntoma.** Correcto por diseño: Chromium no
     permite activar debugging en una segunda instancia.

El diagnóstico queda **probado**: Comet abierto sin `--remote-debugging-port`
+ puerto 9222 cerrado = el error observado, en cada misión.

### Causa del cambio de entorno (probable, no commit)
No es atribuible a un commit. Lo más plausible: Comet `148.0.7778.222` es una
build reciente — un **auto-update de Comet** y/o un **reinicio del PC**
relanzaron Comet con su arranque estándar (sin flags), y/o el acceso directo
con el flag que usaba el usuario se perdió/regeneró sin el flag. El paso 1 del
flujo documentado (arranque manual con CDP) simplemente dejó de cumplirse.

---

## (d) Qué hay que restaurar — opciones (SIN implementar, para decidir con Iván)

El objetivo se mantiene: **usar el navegador del usuario con sus sesiones**.
Playwright headless queda **descartado** (no usaría las sesiones del usuario;
además el prompt lo excluye explícitamente). El arreglo es sobre **cómo se
lanza Comet**, no sobre el código de Shinobi. **Ningún commit a revertir.**

Requisito físico ineludible: para que el puerto 9222 se abra, Comet tiene que
**arrancarse** con `--remote-debugging-port=9222`. No se puede activar sobre un
Comet ya abierto → cualquier opción exige que Comet esté cerrado en el momento
de (re)lanzarlo.

**Opción A — Restaurar el arranque de Comet con el flag (menor riesgo, lo documentado).**
Crear un acceso directo (escritorio + carpeta Startup) cuyo *Target* sea el
comando documentado en `01_ecosystem.md`:
`comet.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check`.
El usuario abre Comet **siempre** por ese acceso directo. Conserva su perfil y
sesiones. Coste: disciplina del usuario / un reinicio para que el Startup
tome efecto. Es exactamente "el flujo validado" de la doc.

**Opción B — Preflight en Shinobi que detecte y guíe.**
Antes de una misión de browser, comprobar el puerto 9222; si Comet corre sin
el flag, devolver un mensaje accionable ("cierra Comet y reábrelo con el
acceso directo CDP"). Shinobi **no** toca el navegador. Mejora la claridad
del error actual pero no automatiza nada — sigue dependiendo de la Opción A.

**Opción C — Shinobi cierra y relanza Comet con el flag (más invasivo).**
Un paso de arranque que cierre Comet y lo relance con el flag y el perfil del
usuario. **Riesgo:** pierde las pestañas/trabajo en curso del usuario; exige
consentimiento explícito; entra en conflicto con la blacklist destructiva
(cerrar el navegador). Solo viable con confirmación humana y restauración de
sesión. Documentado aquí como opción, **no recomendada** sin más diseño.

**Nota secundaria (para el diseño del fix, no es la causa):** el fallback
`launchBrowserDetached` en `browser_cdp.ts` lanza Comet con *solo*
`--remote-debugging-port=9222` — sin `--user-data-dir` ni
`--no-first-run --no-default-browser-check` (el comando documentado sí los
lleva). No es la causa del incidente (ese fallback solo corre con Comet
cerrado), pero conviene alinearlo con el comando canónico cuando se decida el
fix.

---

## Pasos de verificación usados (reproducibles)

```
git log --oneline --follow -- src/tools/browser_cdp.ts
git show 980f34e:src/tools/browser_cdp.ts          # doLaunch original == actual
git show 3f744fe -- src/tools/browser_cdp.ts        # V2 solo añade modo remoto
git log --all --oneline -S"remote-debugging-port"   # no hay launcher
git log --all --diff-filter=D ...                   # no se borró ningún launcher
Get-CimInstance Win32_Process -Filter "Name='comet.exe'"   # CommandLine sin flag
Get-NetTCPConnection -LocalPort 9222 -State Listen          # puerto cerrado
```

## Estado

Diagnóstico cerrado. **Fix NO implementado** — pendiente de que Iván revise y
se decida la opción (A / B / C) en una sesión posterior.
