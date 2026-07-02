# DECISIONES — shinobi (log vivo, append-only, lo más reciente arriba)

## 2026-07-02 · Arranque del Plan de Frontera — Ola 1 (Paso 0 verificado + P6.E1 + ratchet P1.E1)

Ejecución del `PLAN_FRONTERA_2026` en el orden que el propio plan manda. NO se
implementó el plan entero (son 38-56 semanas-persona por su propia estimación, con
orden de dependencias duro P1→…→P5). Se ejecutó el **Paso 0 obligatorio** (regla #4:
re-verificar cada "Estado hoy" contra el árbol vivo) y el track barato/seguro de la
Ola 1. Postura de fondo: no se aterriza un chokepoint de ejecución (P1 rewire) ni
capas que no se puedan **correr y verificar** en este entorno — sería construir sobre
arena, justo lo que el plan prohíbe.

**Correcciones al §1 del plan encontradas por lectura directa (a651452, 2026-07-02):**

1. **F5.4 (rutas hardcodeadas) — no aplica.** `grep 'C:\Users' scripts/` = **0**.
   El conteo "36 scripts" de la auditoría estaba viejo. Divergencia 1 del plan resuelta:
   ya no hay rutas absolutas de Windows en `scripts/`.
2. **F0.4 (branding) — ya cerrado, no barrer.** `src/__tests__/no_residual_branding.test.ts`
   YA existe, pasa, y está bien scopeado: prohíbe los términos exactos (`Alcayna`,
   `Enterprise Edition`, `4.5.1`, `OpenGravity`) en código de producto. Los ~22 hits en
   `src/` son (a) tests-guardia que asertan su ausencia, y (b) claves de compat
   **minúsculas** `opengravity_*` del importador Hermes (`from_hermes.ts`, `first_run_wizard.ts`,
   `web/server.ts`), que son funcionales y NO branding — el ban es case-sensitive por
   diseño, así conviven. Los 344 hits repo-wide están en `docs/`/`missions/`/`proposals/`
   (historia legítima). **Decisión: NO se barre nada; reescribir docs históricos sería
   falsificar.** Igual, `no_stealth_in_public_tree.test.ts` (D1/F6.1) ya existe.
3. **F0.3 (docs desincronizadas) — mucho menor de lo que el plan implica.** Las cifras
   ESTRUCTURALES de `CLAUDE.md`/`AGENTS.md` (459 ficheros de producto, 60681 LOC, 235→236
   de test, 62 tools) ya eran **correctas**. Lo único stale era el **pulso git volátil**
   (último commit `67e80fc`→`a651452`, estado del árbol), que cambia en cada commit y por
   diseño no se puede gatear. `estado.mjs` NO necesitaba "arreglar el conteo recursivo":
   ya recorre recursivamente. **Acción:** regenerado `CLAUDE.md`/`AGENTS.md`/`ESTADO.md`
   con `node context.mjs` + `node estado.mjs --no-tests`.
4. **Gate anti-drift F0.3 — ya existe.** `src/__tests__/estado_generator.test.ts` re-corre
   ambos generadores y asserta que los conteos de los `.md` == escaneo real de `src/`. Es el
   `docs_in_sync.test.ts` que pedía P6.E1, y mejor (regenera). **Decisión: NO añadir un
   segundo test redundante.** Se creó uno y se **retiró** al descubrir el existente —
   además habría sido flaky (compite con el `beforeAll` que regenera del test existente).

**Entregable net-new de esta ola — ratchet de P1.E1:**

- `src/sandbox/__tests__/monitor_bypass_ratchet.test.ts`. P1 exige que TODO efecto de
  ejecución pase por un chokepoint único; su criterio de aceptación final es
  `grep 'sandboxRegistry' fuera de src/sandbox/` == 0. Hoy hay **8 callers directos**
  (`chizu/adapters`, `kagami/adapters`, `kaname/live`, `shitsuji/live`, `shugyo/index`,
  `shugyo/sandbox/revertible`, `tools/run_command`, `tools/spawn_agent`). Migrarlos es
  P1.E2 (semanas). Mientras tanto el ratchet **fija esa línea base y falla si aparece un 9º**
  bypass, y avisa si una entrada de la base ya se migró (para apretar). Convierte la deuda
  de "disciplina del caller" en un invariante de CI que sólo puede encoger.

**Verificación (regla #2, adaptada al entorno):** `vitest` NO corre en el sandbox de
tooling Linux — `node_modules` trae binarios nativos `win32-x64` (rolldown/better-sqlite3/
isolated-vm), que no cargan en linux-x64; el test existente `no_residual_branding.test.ts`
falla idéntico. CI corre en `windows-latest`, donde sí corren. Verificado aquí por
**equivalente en Node puro** (sin deps nativas): ratchet en verde con 8 offenders todos en
base, y en **rojo bajo mutación** (inyectar un 9º bypass lo detecta). `tsc --noEmit`
terminó **sin errores** en el fichero nuevo. Doc↔árbol re-verificado: 459 prod / 236 test
== escaneo real.

**Lo que queda (explícito, no se tocó):** P1.E2-E5 (chokepoint real + mandatos + backend
confinado + egress broker), P2/P3/P4/P5 completos, P6.E2-E4 (build). Requieren entorno con
tests ejecutables y son el grueso multi-semana del plan.

**Addendum (misma sesión, ya en Windows real):** lo verificado por equivalente en Node puro
se re-verificó con `vitest` de verdad — `monitor_bypass_ratchet.test.ts`,
`estado_generator.test.ts` y `no_residual_branding.test.ts` en verde (14/14), y la suite
completa **219 ficheros / 2101 tests pasan** (1 skip), 51s. De paso se encontró y arregló un
bug de higiene de test: `src/audit/__tests__/audit_log.test.ts` (test "path con caracteres
reservados de Windows") escribía `SHINOBI_AUDIT_LOG_PATH` como una ruta relativa
(`<invalid>|*?.jsonl`), que en este filesystem a veces SÍ se acepta y escribe un
`audit.jsonl` real en la raíz del repo (el `?? <invalid>|*?.jsonl` que aparecía suelto en
`git status`). Fix: la ruta ahora vive bajo `os.tmpdir()` y se limpia en un `finally`, igual
que el resto del fichero. 19/19 tests de `audit_log.test.ts` siguen en verde.

## 2026-07-01 · Remediación post-auditoría — 4 tests rotos arreglados + build:exe reparado + SEA canónico roto documentado (no arreglado)

Verificación de las 5 puertas (checkout → `npm ci` → `typecheck` → `test` →
`build:exe` + arranque real) antes de commitear la remediación F0-F6. Puertas
1-3 pasaron limpio a la primera. Puerta 4 (`npm run test`) falló con 10 tests
en 6 archivos — las 6 causas raíz eran reales, no artefactos de sandbox
(confirmado: CI corre en `windows-latest`, mismo SO donde reproduje todo):

1. **`src/memory/{memory_store,provenance,curated_memory_isolation}.test.ts`
   (5 tests, timeout 10s).** Causa: Sprint 1.1 (memoria vectorial) añadió
   `@huggingface/transformers` como backend de embeddings local por defecto
   (autodetect en `embedding_providers/factory.ts`) — el primer `store()`/
   `recall()` intenta descargar el modelo ONNX `Xenova/all-MiniLM-L6-v2` (no
   cacheado en esta máquina), y sin red o con red lenta cuelga hasta el
   timeout de vitest. Fix: los 3 test files fuerzan
   `SHINOBI_EMBED_PROVIDER=hash` al arrancar, igual que ya hacían
   `temporal_memory.test.ts` y `embedding_providers.test.ts` — esos dos
   archivos no tenían el problema porque ya seguían este patrón.
2. **`src/committee/__tests__/apply_proposal.test.ts` (2 tests).** El helper
   `buildValidDiff` del test reescribía las cabeceras del diff con
   `startsWith("--- a/")` (prefijo exacto) — en Windows, `git diff --no-index`
   cita las rutas (`--- "a/C:\Users\...`) porque contienen backslashes, así
   que el prefijo exacto no matcheaba y quedaban rutas absolutas de Windows
   sin reescribir → `git apply` las rechazaba con "invalid path". El código
   de producción (`improvements.ts:357-359`, `computeDiffForProposal`) ya
   usa el prefijo laxo (`startsWith("--- ")`) que sí soporta esto — el test
   decía replicar "la misma técnica" pero no lo hacía. Fix: alineado el
   helper del test con la técnica real de producción.
3. **`src/tools/__tests__/audio_prohibited_uses_canonical.test.ts` (2
   tests).** Bug real en `audio_transcribe.ts`, no solo del test: un path
   POSIX (`/etc/passwd`, `/root/...`) pasado a un proceso Windows no lo
   reconoce `path.resolve` como absoluto — lo cuelga del cwd, y el check
   contra `ABSOLUTE_PROHIBITED_PATHS` (que compara sobre el path YA
   resuelto) deja de matchear, cayendo en "archivo no encontrado" en vez de
   rechazar por ruta prohibida. `src/utils/permissions.ts` ya tenía este
   problema resuelto para `validatePath` (`looksLikeForeignAbsolutePath`,
   descubierto en la verificación final anterior — ver más abajo), pero
   `audio_transcribe.ts` no lo reutilizó al migrar a la lista canónica
   (F2.9). Fix: se compara también el string crudo (sin `resolve()`) contra
   las entradas POSIX de la lista canónica, sin extender el bloqueo a paths
   foráneos que no están en la lista (para no romper el test de "no bloquea
   de más").
4. **`src/reader/__tests__/repo_map.test.ts` (1 test).**
   `formatSearchResults` imprimía `relPath` crudo (de `path.relative()`, usa
   `\` en Windows) en el texto para el LLM, en vez de normalizar a `/` como
   ya hacían los demás tests del archivo al comparar. Fix: normaliza en
   `repo_map.ts`, no solo en el test.

Puerta 5 (`npm run build:exe` + arrancar `Shinobi.exe`) falló primero al
compilar (esbuild sin loader para `.node`) y luego, tras corregir eso, al
arrancar (2 crashes en cascada). Root cause común: `scripts/build_exe.ts`
(ruta **no canónica** vía `@yao-pkg/pkg` — el propio fichero se documenta
como tal, "nada en CI lo invoca") nunca se había re-validado end-to-end desde
que Sprint 1.1 añadió `@huggingface/transformers`/`onnxruntime-node` y desde
que `isolated-vm` (sandbox de skills) y los prompts madre de
`src/agents/prompts/*.md` empezaron a hacer falta en runtime. Fixes en
`scripts/build_exe.ts`: (a) `onnxruntime-node`, `@huggingface/transformers`
e `isolated-vm` marcados `external` en esbuild + sus binarios nativos
listados como assets de `pkg`, igual que ya se hacía con `better-sqlite3`;
(b) `src/agents/prompts/*.md` copiado a `build/prompts/` (el bundle a un
único `.cjs` colapsa `dirname(import.meta.url)` de TODOS los módulos a
`build/`, así que `PROMPTS_DIR` dejaba de apuntar a `src/agents/prompts/`);
(c) `src/utils/app_version.ts` — mismo colapso de profundidad de directorio:
`resolve(__dirname, '../../package.json')` esperaba la profundidad original
de `src/utils/`, y tras el bundle aterriza fuera del repo (el filesystem
virtual de `pkg` remapea rutas absolutas 1:1). Se añadió un fallback (constante
`__SHINOBI_APP_VERSION__` inyectada por esbuild `define`, con el mismo valor
que ya lee `build_exe.ts` de `package.json`) que solo se usa si el `require`
normal falla — en dev/CLI/tests el require de siempre sigue siendo la única
fuente de verdad, nunca hay drift. Verificado real: `Shinobi.exe` arranca,
sirve en `:3333`, responde HTTP 200. Degradación conocida y no bloqueante:
el índice semántico vectorial queda deshabilitado dentro del `.exe`
empaquetado (`import()` dinámico de `@huggingface/transformers` no funciona
dentro del snapshot de `pkg` — límite conocido, no arreglado; `recall()`
sigue funcionando vía markdown/keyword, `rebuildSemanticIndex()` ya está
diseñado como best-effort y no lanza).

**Hallazgo NO arreglado, dejado documentado a propósito:** la ruta
canónica de release (`rebuild.cmd` → `build_sea.mjs` + Node SEA + postject,
la que sí consume `.github/workflows/release.yml`) tiene un problema
DISTINTO y más profundo, no un simple gap de empaquetado: dentro de un
binario SEA, `require('better-sqlite3')` revienta con
`ERR_UNKNOWN_BUILTIN_MODULE` — Node SEA no soporta `require()` de paquetes
nativos de terceros de la forma normal (características conocidas de SEA,
no un bug puntual de este repo). Añadir los mismos paquetes a `external` en
`build_sea.mjs` corrige el error de compilación de esbuild (hecho), pero el
`.exe` resultante sigue sin arrancar. Además: `release.yml` solo COMPILA
(`node build_sea.mjs`) — nunca ejecuta el `.exe` resultante como smoke test,
así que este problema pudo llevar roto un tiempo indeterminado sin que CI lo
detectara. Arreglarlo de verdad requiere repensar cómo el SEA carga nativos
(no es un one-liner) — queda como tarea aparte, priorizable.

## 2026-07-01 · F5.3 — CI: npm audit añadido; gates F1/F2/F3 confirmados ya resueltos

Verificación final: revisé si F5.3 (gates F1/F2/F3 + smokes D-015/016/017 sin
correr en CI) seguía abierto. `ci.yml` por sí solo (tsc + vitest) no los
ejecuta — pero **`.github/workflows/gates.yml` ya existe** (trabajo de una
fase anterior de esta misma remediación, no de hoy) y resuelve F5.3
correctamente: los 6 jobs (f1-gate, f2-gate, f3-gate, d015-smoke, d016-router-
probe, d017-smoke) corren con `continue-on-error: true` (informativos, no
bloqueantes), y los 5 que necesitan LLM/red están gateados detrás de la
variable de repo `SHINOBI_ENABLE_LLM_GATES` (opt-in, no un secret — por
defecto no corren). Los secrets de API key nunca se exponen a PRs de forks:
es una garantía nativa de GitHub Actions para el evento `pull_request` (no
`pull_request_target`), no algo que este workflow tenga que resolver por su
cuenta. d017-smoke (approval gate + validatePath, determinista, sin LLM) corre
siempre. Añadido hoy: `npm audit --production --audit-level=high` a `ci.yml`
(bloqueante, sin secrets, sin coste — cubre la mitad de F5.3+F5.5 que sí
faltaba). No se tocó `gates.yml` — ya estaba bien diseñado.

## 2026-07-01 · Verificación final — 2 hallazgos nuevos fuera del plan original

Durante la verificación final (tsc + suite completa + greps de DoD) aparecieron
dos gaps que ni la auditoría ni el plan habían detectado. Se corrigen aquí en
vez de dejarlos para una ronda futura, porque son de alcance pequeño y de la
misma clase de riesgo que el resto de F0-F2.

**1. `src/web/server.ts:294` — literal `'2.0.0'` huérfano (variante de F0.1).**
El grep de DoD (`grep -rn "2.0.0" src/`) — más amplio que el que hacía el test
original de F0.1, que solo cubría `scripts/`+`installer/` — encontró que el
handler de onboarding web defaulteaba `ShinobiConfig.version` a `'2.0.0'`
hardcodeado en vez de `APP_VERSION`. Campo write-only (no se lee en ningún
sitio hoy), impacto bajo, pero mismo antipatrón que F0.1 ya había prohibido en
otros 3 archivos. Corregido: usa `APP_VERSION`. Test ampliado en
`src/utils/__tests__/version_consistency.test.ts` (assertion dirigida, no un
grep ciego de `'2.0.0'` en todo `src/` — eso da falsos positivos con
documentación de rangos semver como `^1.2.3 -> >=1.2.3 <2.0.0`).

**2. `src/utils/permissions.ts` `validatePath` — paths absolutos de la
convención de SO contraria se cuelan.** Encontrado por
`capability_stress_2.test.ts` (test ya existente, no escrito hoy) fallando en
este sandbox Linux: pasar `C:\Windows\System32` a un proceso Node en POSIX no
lo reconoce como absoluto (`path.isAbsolute` es específico del SO) —
`path.resolve` lo trataba como un segmento relativo colgado del cwd, colando
tanto el check de "dentro del workspace" como `ABSOLUTE_PROHIBITED_PATHS`. En
producción (Windows-native) esto no se manifiesta porque Node ya reconoce sus
propios paths — pero Shinobi también soporta Remote Mode (VPS+Docker/SSH,
Linux) y sandbox backends Linux, donde un tool call con un path Windows-style
SÍ atravesaría un host Linux real. Mismo tipo de bug que ALTA-04 (symlinks) ya
corrigió, pero en el eje "convención de SO" en vez de "destino de symlink".
Corregido con `looksLikeForeignAbsolutePath()`: un string absoluto en la OTRA
convención se trata como "fuera del workspace" (bypasseable solo por
aprobación manual explícita, igual que el resto del check de traversal — NUNCA
por resolución silenciosa). Test de regresión: el propio
`capability_stress_2.test.ts`, que fallaba antes del fix y pasa después.

## 2026-07-01 · F6 — Decisiones de producto (auditoría técnica exhaustiva)

**F6.1 — Anti-bot/ToS. Decisión del usuario: separar del producto público
(recomendación del plan).** El árbol público v1.0.0 incluía evasión
anti-bot deliberada (spoofing de `navigator.webdriver`, `chrome.runtime`
falso, plugins falsos, WebGL vendor/renderer, en `browser_engine.ts` líneas
238-315 originales) y 27 scripts (`scripts/fiverr/`, `scripts/linkedin/`,
`scripts/upwork/`, `scripts/notebooklm/`, `scripts/gemini/hola_gemini.ts`,
más 2 sueltos) que automatizaban sesiones logueadas reales de terceros vía
CDP. Riesgo real de ToS/legal para un producto distribuido públicamente; el
agente core no necesita evasión anti-bot para su propuesta de valor.
Ejecutado: código de stealth eliminado de `browser_engine.ts` y
`web_search_with_warmup.ts` (que conserva warm-up + backoff + detección de
bloqueo — robustez legítima, no evasión); `clean_extract.ts` ya no llama a
la función de stealth retirada; los 27 scripts retirados de `scripts/` vía
`git rm`. Todo lo retirado se entregó archivado (código original +
scripts) al operador para uso privado, con instrucciones de reactivación.
Test de regresión: `src/__tests__/no_stealth_in_public_tree.test.ts`
(falla si se reintroduce la firma de stealth en el árbol público).
Reversible: el operador puede reintroducirlo en su copia privada.

**F6.2 — Backup no incluye `.env`.** `state_backup.ts` nunca incluyó
`.env` (ni siquiera redactado) para evitar fuga de credenciales si el
propio backup se ve comprometido — esto ya era así, pero no estaba
documentado ni el usuario avisado al restaurar. Añadido: banner del
módulo explícito, sección en el README.md generado por cada backup, aviso
por `console.warn` al final de `restoreBackup()`. `DEFAULT_SOURCES`
exportado para verificación directa. Test:
`src/backup/__tests__/backup_sources_documented.test.ts`.

**F6.3 — Fragmentación de memoria: documentar, no unificar.** El plan
ofrecía una opción "S, mínima" (documentar los tres subsistemas de memoria
— vault Markdown curado, índice semántico derivado, providers
conversacionales) frente a una "L" (unificarlos tras una fachada común).
Se tomó la opción S por su propio dimensionamiento en el plan: unificar es
un cambio arquitectónico de alto riesgo sin beneficio de seguridad
inmediato. Documentado en `src/memory/README.md`.

## 2026-07-01 · F1 — Seguridad crítica: F1.2 diferido, F1.4 cerrado

**F1.2 — Sandboxing real (isolated-vm) de `plugin_loader.ts`. Decisión del
usuario: cerrar el resto del plan primero.** El bypass del gate de plugins
SÍ está cerrado y verificado (`tools/index.ts`: plugins no se cargan salvo
`SHINOBI_PLUGINS_ENABLED=1`, test `plugins_gate_default_off.test.ts`). Lo
que falta es el sandboxing real: `importPlugin()` sigue usando
`await import(url)` directo, sin `isolated-vm` — un plugin cargado (con el
flag activo, opt-in) corre con los mismos privilegios que Shinobi, mitigado
solo parcialmente por `setToolLoadSource('plugin')` contra sobrescritura de
nombres de tools nativas. **Gap conocido y abierto.** Se cierra primero el
resto del plan (F6 + verificación final) por decisión explícita del
usuario; se intenta el sandboxing solo si queda margen de tiempo al final.

**F1.4 — CDP sin autenticación en el navegador personal del usuario.**
Encontrado ya remediado (sesión previa, sin test ni entrada en este log):
`browser_cdp.ts` lanza un Chromium con `--user-data-dir` DEDICADO
(`shinobiBrowserProfileDir()`, bajo `%LOCALAPPDATA%/Shinobi/browser-profile`),
instancia separada del Chrome/Comet real del usuario — opción 1 (preferida)
del plan, en vez de loopback+token. El CDP en :9222 sigue sin token, pero ya
no expone una sesión logueada real del usuario. `setup_comet_cdp.ps1` y los
scripts que dependían de él fueron retirados en F6.1. Cerrado ahora con
test de regresión: `src/tools/__tests__/browser_cdp_dedicated_profile.test.ts`.

## 2026-07-01 · F0.4 — Purga de branding real (Alcayna/Enterprise Edition/4.5.1)

El repo público nombraba un negocio real de un cliente ("Repostería
Alcayna", Cieza/Murcia) en 13 `system_prompt` de agentes especialistas
(`agent_registry.ts`) y usaba versión/edición falsas ("ShinobiBot Enterprise
Edition - Versión 4.5.1" en vez de `APP_VERSION` real). La tarea #2 de esta
misma sesión había marcado F0.4 como hecho sin estarlo — corregido volviendo
a las fuentes primarias (auditoría + plan) en vez de confiar en el estado
del tracker. Renombrado completo `Alcayna*` → `Agent*`/`Specialist*` en
`agent_registry.ts`, `orchestrator.ts`, `slash_commands.ts`,
`intent_router.ts`, `scripts/shinobi.ts`; los 13 `system_prompt` se
genericaron preservando estructura pero sin nombrar el negocio real;
`/version` ahora usa `APP_VERSION` (fuente única en `package.json`). Test
de regresión: `src/__tests__/no_residual_branding.test.ts`.

## 2026-06-29 · G2 — Shadow modes: criterio de promoción/matar documentado

**Contexto:** Los dos shadow modes (dispatch affinity `src/dispatch/` y refiner
`src/refiner/`) llevan activos en shadow desde su creación. En G2 hay que
"promover o matar" con datos (PLAN_SOMBRA §G2 ítem 3). Los registros shadow
(`shadow_dispatch.jsonl`, `refiner_shadow.jsonl`) están vacíos hoy porque ningún
operador ha activado `SHINOBI_SHADOW_DISPATCH=1` ni `SHINOBI_REFINER_SHADOW=1`
en producción.

**Decisión: mantener en shadow — evaluar en G2 real con umbral concreto.**

Criterios de promoción (deben cumplirse AMBOS simultáneamente):
- **Dispatch classifier**: ≥20 misiones con `outcome` registrado en
  `shadow_dispatch.jsonl` y tasa de acierto general (specialist='general' →
  outcome='success') ≥ 80%. Evaluador: `evaluatePromotion()` en
  `src/dispatch/shadow_recorder.ts`.
- **Refiner**: ≥50 tareas hacia especialistas en `refiner_shadow.jsonl`, tasa
  de reescritura ≥ 30% (señal de que el refinador añade valor real) y coste
  total estimado < $0.10/semana (rentable).

Criterios de kill (se mata si alguno se cumple):
- Tras la corrida G1 real, el pass^5 de shinobi **no mejora** con shadow
  activo vs sin él (A/B con flag `SHINOBI_DISPATCH_MODE=active`).
- El registro shadow tiene >100 entradas pero tasa de acierto < 60% (el
  clasificador perjudica más de lo que ayuda).

**Próximo paso:** activar `SHINOBI_SHADOW_DISPATCH=1` en la máquina del
operador durante la semana post-G1 para acumular datos. Evaluar con
`summarizeShadowLog()` y `evaluatePromotion()` antes de cerrar G2.

---

## 2026-06-12 · Revisión post-ejecución (UX + extirpación) — reparaciones

**Hallazgo raíz:** el mount del sandbox Linux sirve vistas OBSOLETAS/PARCIALES
de ficheros recientemente escritos (verificado: app.js real 1219 líneas vs
710 en mount; server.ts con NUL-padding fantasma tras encoger). Los
"truncamientos" que los ejecutores creyeron sufrir eran este artefacto: sus
"restauraciones" desde git HEAD pisaron trabajo sin commitear.

**Roturas encontradas y reparadas:**
1. `app.js` era una versión vieja (Bloque 8.2) restaurada de HEAD: perdió
   clima, Rastro vivo (tool_event), paleta "/", huella, guard de conversación
   cruzada, `window.ShinobiToast`, eventos plan/skill_activated/browser_frame,
   token budget; y traía console.log de diagnóstico. → Reconstruido completo
   (base 8.5 + M2/M4/M5/M6/M7 + A1 chips vivos + A2/A3/A4). Sintaxis validada.
2. `markdown.js` no parseaba (comillas rotas en el onclick inline del botón
   copiar) → botón sin JS inline + listener delegado. Sintaxis validada.
3. `index.html` perdió los `<script>` de dialog.js/settings.js/search.js
   (renombrar/borrar misiones lanzaba excepción; Ajustes y Ctrl+K muertos) y
   el `<input id="dialog-input">` → restaurados.
4. `server.ts` `isConfigUsable` aceptaba configs solo-OG (chat roto en
   runtime) → solo `provider && provider_key`; limpiado código muerto de
   /api/skills. 5. `Tui.tsx` default provider 'opengravity' → env/'—'.

**Pendiente del operador (el sandbox no puede):** `git` roto por índice
corrupto — ejecutar en Windows: `del .git\index` y luego `git reset` (NO
--hard). Después commitear por fases. Y correr `npm run typecheck && npm run
test` en Windows: vitest no corre en el sandbox (falta binario rolldown
linux); el typecheck real-disk está limpio salvo el artefacto NUL del mount.

## 2026-06-12 · Extirpación OpenGravity — deuda G-CERO aceptada

**Decisión:** Ejecutada la extirpación completa de OpenGravity (Fases 1-7).
`grep -rci "opengravity" src/` devuelve 5 ficheros con 16 hits; todos son
deuda técnica aceptada de dos tipos:

1. **Stub indestructible** (`src/cloud/opengravity_client.ts`, 5 hits):
   El sistema de archivos Windows (NTFS mount en el sandbox Linux) impide
   borrar ficheros. El fichero es un stub vacío que lanza `Error('extirpado')`
   en todas sus rutas. No ejecuta ninguna llamada a OG. Pendiente borrar
   cuando el operador haga `git rm` directamente en Windows.

2. **Back-compat de config** (11 hits en `migration/`, `first_run_wizard.ts`,
   `web/server.ts`): Los usuarios con `config.json` existente tienen los campos
   `opengravity_api_key` y `opengravity_url` en disco. Leer y preservar esos
   campos en la migración es obligatorio para no romper instalaciones en
   producción. Los campos se marcan `?: string` (opcionales) y no se propagan
   a ninguna variable de entorno activa ni se usan en el router de providers.

**Coste:** 16 hits en grep, 0 en flujo de ejecución real.
**Alternativa descartada:** Renombrar los campos en config.json requeriría un
script de migración automático con riesgo de corrupción en la primera
ejecución — coste > beneficio para un label de texto.

## 2026-06-10 · La GROQ_API_KEY de la historia es INTENCIONAL + comparativa de cerebros con swarm-ide
- **Decisión del operador:** la `GROQ_API_KEY` en la historia git NO es una fuga;
  es un tanque de arranque compartido a propósito (uso zero-config para quien
  clone). No se rota ni se purga. G0_PENDIENTE actualizado.
- **Norte derivado:** conectar Shinobi a otro cerebro (modelo local o cualquier
  proveedor) debe ser trivial. La key compartida es el primer escalón, no el techo.
- **Comparativa de model-switching (leída del código):**
  - *Shinobi* (`src/providers/`): motor de failover MÁS duro — cooldowns por
    proveedor, clasificación de error (fatal_payload no rota, no_key skip silencioso),
    audit de failovers, y desde hoy normalización de model-ID + saneo de mensajes.
    PERO roster CERRADO: 4 clientes con BASE_URL fija, **sin soporte local/custom**.
  - *swarm-ide* (`backend/app/smart_router.py`): registro DECLARATIVO `CHAIN` de
    24 modelos / 8 proveedores (`ModelEntry`), una línea por modelo; un único
    camino vía LangChain `ChatOpenAI/ChatAnthropic`; **`base_url` override por
    `SWARM_<PROV>_BASE_URL`** → local/OpenAI-compatible trivial; flag `is_free`
    con free-models en cola; modos fast/power; `get_cheap_model`/`get_heavy_model`
    para subagentes; `RouterState` por-run que recorre TODOS los modelos.
- **Veredicto:** complementarios. El MOTOR de Shinobi es superior en resiliencia;
  la CAPA DE CONEXIÓN de swarm-ide es superior para el norte (multi-cerebro/local).
- **A absorber (orden de valor):** (1) cliente genérico OpenAI-compatible con
  `base_url` por endpoint → desbloquea Ollama/LM Studio/llama.cpp/vLLM y cualquier
  proveedor; (2) registro declarativo de modelos (dato, no un fichero-cliente por
  proveedor) montado SOBRE el motor de failover actual; (3) flag `is_free` +
  free-models en la cadena (refuerza el tanque de arranque); (4) opción "endpoint
  local/custom" en el panel de Ajustes (URL + key opcional). Pendiente de implementar.

## 2026-06-10 · Enjambre orquestado CABLEADO + runner de S-AGENTIC listo
- `src/agents/swarm_orchestrator.ts`: el cableado completo del cerebro (swarm_plan)
  al músculo (team). Planner LLM (`makeLLMPlanner`, extrae el content del
  CloudResponse igual que agent_loop) → `parsePlan`+`schedule` → bucle por LOTES →
  **pizarra** (`composeWithBlackboard` inyecta las salidas de las dependencias en el
  prompt de cada subtarea) → ejecución con `runTeam` (worktree aislado + E1 + E7) →
  **gate del revisor** (`reviewRejected`; si bloquea, para). Nunca lanza: el fallo
  va en `status` (completed/rejected/budget_exceeded/planning_failed). `runBatch`
  inyectable (patrón del repo) → testeable sin git/LLM.
- **Verificado:** typecheck limpio (cero errores propios; los 2 de approval/
  credential_pool son fantasmas del mount, confirmados íntegros en disco) +
  **8/8 verde en Node** (lotes topológicos, pizarra t1→t2→t3, revisor que bloquea y
  detiene lotes posteriores, fallbacks) + test vitest `__tests__/swarm_orchestrator.test.ts`
  para el CI Windows.
- Invocable: tool `run_swarm_orchestrated` (mirror de run_team, registrada en
  tools/index). Runner: `scripts/bench_s_agentic.ts` + `npm run bench:agentic`
  (arranca el fixture, corre S-AGENTIC contra Shinobi + competidores disponibles,
  escribe a bench_results/). LISTO para la prueba en Windows.
- Pendiente menor (fontanería, no investigación): checkpoint+rollback estilo
  swarm-ide (Shinobi ya conserva ramas de worktree); cablear coste real al budget.

## 2026-06-10 · Duelo de enjambres + adaptadores reales de competidores (acceso a sus repos)
- Acceso concedido a los repos del operador: `hermes-agent-main` (Python, CLI
  `hermes`), `openclaw_final_test` (Node mono-repo, CLI `openclaw`), `swarm-ide`
  (IDE multi-agente propio del operador). odysseus/Nueva carpeta: pendientes (apoyo).
- **Veredicto swarm (medido del código):** Shinobi NO es globalmente inferior — es
  asimétrico. Shinobi gana en EJECUCIÓN (aislamiento por git worktree en `team.ts`,
  verificación E1, firma E7); swarm-ide gana en PLANIFICACIÓN (DAG con `depends_on`,
  scheduling topológico por lotes, pipeline de roles architect/coder/reviewer/tester,
  pizarra, checkpoint+rollback). Detalle: `COMPARATIVA_SWARM.md`.
- **Acción:** portar el cerebro de swarm-ide ENCIMA del músculo de Shinobi.
  `src/agents/swarm_plan.ts` (núcleo puro): `parsePlan` (JSON tolerante),
  `schedule` (Kahn → lotes paralelos, lanza ante ciclo/dep desconocida),
  `reviewRejected`/`budgetExceeded`/`renderPlan` + ROLE_TOOLS/PROMPT con tools
  REALES de Shinobi y `committee_review` como revisor (mejor que el revisor único
  del original). Crédito explícito a swarm-ide en la cabecera. **Verificado:
  typecheck limpio + 9/9 verde en Node.** Falta cableado al runtime (planner LLM +
  bucle por lotes con runTeam + pizarra + checkpoint) — fontanería, no investigación.
- **Adaptadores reales de competidores** (cierra P3.3 de `competitive_audit_paridad`):
  `src/bench/adapters/competitors.ts` con `hermesRealAdapter` (`hermes -z "<prompt>"`,
  modo oneshot — OJO: `-p` en Hermes es PERFIL, no prompt; verificado en
  oneshot.py/main.py) y `openClawRealAdapter` (`openclaw agent --message "<prompt>"`,
  verificado en docs/cli/agent.md). Sobre el `CliAdapter` ya existente. Typecheck
  limpio, exportados en el barrel. REGLA DURA del benchmark: los 3 con el MISMO
  modelo/versión/temperatura (si no, mides quién pagó mejor modelo, no el harness).

## 2026-06-10 · Estrategia de diferenciadores + benchmark S-AGENTIC (web/integración)
- **Decisión estratégica (honesta):** "superior sin lugar a dudas" NO se persigue en
  GAIA (capacidad general = atada al modelo; con modelos iguales los tres empatan y
  un solo dev no golea a un equipo). Se persigue en los DIFERENCIADORES (arquitectura/
  harness, no IQ del modelo): web agéntica, self-service de credenciales, gate de
  pago, y prueba firmada (E7). GAIA pasa a TELONERO de paridad, no cabeza de cartel.
  Encaja con `competitive_audit_paridad.md` (paridad funcional + 9 exclusivas +
  Windows-native). Documento: `ESTRATEGIA_DIFERENCIADORES.md` (incluye plan de
  publicación X/LinkedIn/YouTube que sobrevive a la reproducción).
- **S-AGENTIC v1** (`src/bench/suites/s_agentic.ts`, 5 tareas) + sitio-fixture
  `demos/bench_site/serve.mjs` (Node puro, coste 0, offline, VERIFICADO funcionando:
  /data extrae, /form graba POST, /login→/dashboard revela API key, /upgrade trampa
  de pago con canario payClicked). Tareas: extracción, formulario, self-service de
  API key, gate de pago, y el flujo EXACTO pedido (gratis→termina / pago→pregunta).
  Checks deterministas sobre el estado del fixture, válidos para los 3 agentes.
  Typecheck limpio; exportada en el barrel. Ejecuta en Windows (navegador+runtime).
- Confirmado leyendo el código real: el gate (`security/approval.ts`) YA frena
  pago/checkout/billing/subscribe + creación de cuenta, con fail-safe que DENIEGA sin
  UI de confirmación. El motor de navegador (`browser/actor.ts`) es Playwright con
  acción anclada + verificación por acción. La demo "self-service con permiso" se
  construye con piezas que YA existen; falta el pegamento orquestado + test real.
- Pendiente del operador para el benchmark de los 3: instalar Hermes/OpenClaw
  (ya clonados en el escritorio), MISMO modelo para los tres, montar
  Hermes/OpenClawRealAdapter sobre `cli_adapter.ts`. Orden barato→caro: S-AGENTIC con
  modelo local (0€) → confirmar → GAIA de pago una vez. ROTAR la GROQ key antes de
  cualquier publicación (bloqueante).

## 2026-06-10 · G0 ejecutado parcialmente + HALLAZGO CRÍTICO de secretos en historia
- **CRÍTICO (G0.4 auditoría de huellas):** la historia git PÚBLICA contiene una
  `GROQ_API_KEY` en claro — `.env` real commiteado en `54ab387` (2026-04-01),
  retirado de HEAD en `aeee6e3` pero VIVO en la historia. + 2 tokens Matrix `mat_*`
  (`42789ea`, "efímeros", Matrix bloqueado) a rotar por seguridad. Falsos positivos
  verificados (no actuar): `sk-or-`/elevenlabs en fixture "values are dummies"
  (`8acf9e6`), RSA en README de dotenv y tests del redactor. → ACCIÓN #1 del
  proyecto: rotar la GROQ key (instrucciones en `G0_PENDIENTE_EN_TU_MAQUINA.md`).
  La rotación cierra el riesgo; la purga BFG es opcional y posterior.
- **G0.5 banners**: 26 módulos sin cabecera detectable → banner veraz (solo
  comentario, cero código), validado replicando el escáner de `context.mjs` (26/26).
  Pendiente: `src/tui/` (solo tiene `.tsx`; el escáner solo mira `.ts`).
- **G0.1 typecheck**: `tsc` SÍ corre en el sandbox vía `node typescript/lib/tsc.js`
  (el symlink `.bin/tsc` no, da igual). Validada la suite nueva. El grafo completo
  (vitest) sigue necesitando Windows (better-sqlite3/esbuild nativos).
- **G1.1 S-POLICY semilla**: `src/bench/suites/s_policy.ts` — 8 tareas (6 candado
  con canarios deterministas + 2 controles negativos: lo legítimo NO se frena).
  Typecheck limpio, exportada en el barrel. Crecer a ~20 antes de cerrar G1.
- **G1.5 KPIs N0**: `scripts/kpis_sombra.mjs` (Node puro) sobre el rastro REAL →
  `bench_results/kpis_N0_2026-06-10.md` (+ .sha256). Señal: %éxito-proxy 20→79→84
  (W20/21/24), 419 failovers, 42 frenos de candado, 1 loop abortado, 12 misiones.
  Hallazgo de instrumentación: el candado no emite kind propio (vive como error de
  tool_call) → tarea G1.
- **Disciplina nueva**: `bench_results/` (rastro firmado de la medición) + `forja/`
  (diario de la sombra). Ambos con su README/cabecera. Pendiente del operador en
  `G0_PENDIENTE_EN_TU_MAQUINA.md`.

## 2026-06-10 · PLAN SOMBRA — estrategia de escalada en silencio (+ hook de contexto)
- Nace `PLAN_SOMBRA_2026.md`: el CÓMO estratégico — escalar desde las sombras
  hasta una emergencia inignorable. CONVIVE con FRONTERA (el QUÉ técnico); regla
  de precedencia documentada en su §0. Decisiones clave: avance por PUERTAS sin
  fechas (G0–G7 en tres arcos Shu·Ha·Ri, WIP=1, pulso mínimo 4 semanas);
  economía 0 € base / techo 200 €/mes solo si mueve un número / hucha ~300 € para
  la única tanda pagada (N2); tres niveles de evidencia N0/N1/N2 — el centro es el
  **harness-delta** (misma suite, MISMO modelo barato, tres agentes: mide el
  harness, que es la tesis de FRONTERA §0, a coste ~0); anillos de operadores
  (familia → confianza); repo se queda PÚBLICO sin ruido (la historia git como
  notario; auditoría de huellas/secretos en G0); emergencia solo con checklist
  falsable ≥5/6 + recibo N2.
- Pre-commit ampliado: regenera ESTADO.md (estado.mjs --no-tests) y
  AGENTS.md/CLAUDE.md (context.mjs) y los añade al stage, ANTES del scan de
  claves; best-effort (avisa, no bloquea). context.mjs añade PLAN_SOMBRA al
  orden de lectura (puesto 4).

## 2026-06-10 · E8 robustez (刃 sobre 心) + manuales de marca leídos
- Petición: sistema ROBUSTO — aguanta múltiples iteraciones de múltiples personas,
  imparable hacia el objetivo pero desde las sombras, no colapsa la PC, swarms si
  la tarea pesa. Es la doctrina del hanko 忍 (filo sobre corazón) hecha sistema.
- **E8** (`runtime/resource_governor.ts` + `runtime/escalation.ts`): governor
  process-wide (cap DURO + equidad por operador + backpressure + ancho adaptativo)
  + ejecutor relentless (retry → failover → escalada al ENJAMBRE si pesa, acotado
  por fatal/presupuesto/loop-detector). Prueba 19/19 en Node: flood 200 req / 5
  operadores → running ≤ cap, equidad ≤ cap-op, 188 sheds honestos; pesada →
  ejército. + 2 tests vitest. Es el primer governor process-wide del repo.
- Manuales de marca leídos (ZAPWEAVE ecosistema + SHINOBI específico): enso + gota
  bermellón (en Shinobi = huella/rastro, encaja con el audit E7) + Hiru/Yoru
  (Yoru = default NATIVO de Shinobi) + Inter/Cormorant + proporción 90/9/1 + voz
  刃/心 + candado selectivo. Guardrail: la robustez E8 ENCARNA la selva (enjambre
  bajo la calma), no la decora; la accesibilidad va A TRAVÉS de la estética.
- Total sesión: 4 motores (E5/E6/E7/E8), 6 ficheros de test, 4 proofs Node verdes
  (6 + 11 + 8 + 19 = 44 checks). PENDIENTE: typecheck+vitest en Windows; cablear
  E5 (best-of-N) y E8 (governor/relentless) al runtime/orchestrator real.

## 2026-06-10 · FRONTERA: roadmap nuevo + 3 motores ejecutados (E5/E6/E7)
- `ROADMAP_FRONTERA_2026.md` SUPERSEDE a `BENCHMARK_READINESS_PLAN.md` y al
  `DICTAMEN_FRONTERA_2026-06-09.md`. Recalibración honesta: los benchmarks públicos
  miden el HARNESS, no la IQ del modelo → paridad-y-mejora ES alcanzable sobre el
  mismo modelo. Dos pilares: ACCESIBILIDAD (barrera técnico/no-técnico, wedge que
  Hermes dev-first no puede seguir) + ESCALA FRONTERA (test-time compute + multi-repo).
- **E5** test-time compute (`agents/best_of_n.ts` + `best_of_n_select.ts`):
  best-of-N con reranking por verificador + gate objetivo, orden TOTAL determinista.
  Prueba 6/6 en Node + test vitest. Cierra pass@1 en el mismo modelo.
- **E6** comprensión multi-repo (`reader/multi_repo.ts`): distill→ledger→assemble
  con invariante pinneada. Prueba 11/11 en Node — 5 repos de ~6M chars → frame de
  1.399 chars, matriz comparativa SIEMPRE presente. + test vitest. (= "leer 4-5
  repos y comparar manteniendo contexto").
- **E7** provenance Ed25519 + audit hash-chain (`agents/provenance_v2.ts` +
  `audit/audit_chain.ts`): firma ASIMÉTRICA (verificable por cualquiera,
  infalsificable) + inmutabilidad. Prueba 8/8 en Node sobre el `audit.jsonl` REAL
  (1055 líneas): manipular la línea 500 rompe en 500; otra clave → signature_mismatch.
  + 2 tests vitest. Corrige el HMAC simétrico de v1. Encaja con OpenGravity (capa de verdad).
- **MARCA**: accesibilidad SIN traicionar el manual ZAPWEAVE (enso + gota bermellón
  + Hiru/Yoru + Inter/Cormorant) — guardrail DURO en FASE 3 del roadmap.
- PENDIENTE: `npm run typecheck` + vitest en terminal Windows (el sandbox Linux no
  corre el grafo TS — better-sqlite3/esbuild son binarios Windows). Cablear E5 al
  `shinobi_adapter` y medir el salto de pass@1 (FASE 1.3).

## 2026-06-08 · ARQUITECTURA: OpenGravity LANZA el benchmark (no shinobi)
- Decisión del usuario: el benchmark lo lanza OpenGravity (C:\...\OpenGravity), que
  ya tiene su harness (benchmarks/pilot_agentic_v1/run_bench.py + ledger hash-chain
  + adaptador eigenai). shinobi es uno de los AGENTES que evalúa.
- shinobi expone scripts/run_one.ts (runner headless: prompt -> JSON {content,
  tool_calls, latency_ms, signature=provenance, loop_aborts, ok}). PUSHEADO a shinobi.
- OpenGravity: nuevo adapters/shinobi/client.py (run_inference que invoca run_one) +
  run_bench.py --agent (eigenai|shinobi). COMMIT LOCAL en OpenGravity rama
  chore/cleanup (sin push — otro repo, lo decide el usuario).
- VALIDADO end-to-end: `python run_bench.py --agent shinobi --smoke` -> ledger entry
  real con la firma de provenance de shinobi.
- PENDIENTE: adaptadores Hermes/OpenClaw iguales (su install+keys = bloque b);
  opcional portar las tareas con check determinista (coding/safety) al schema de OG.

## 2026-06-08 · Bloque (a) del benchmark — sustancialmente completo
- 4.2/4.3/4.4: métricas-titular instrumentadas (bucles abortados, safety, auto-corr).
- Gate selectivo COMPLETO en el harness (mide safety real, no solo hard-block).
- Tarea loop-demo + fix output de abort → corrida real muestra BUCLES ABORTADOS=1.
- estado.mjs (FASE 0): genera ESTADO.md desde verdad de fuente.
- FASE 3.4: Team a escala (8 agentes en paralelo, cero contaminación).
- Tabla real shinobi: 100% (6/6), safety 2/2, bucles abortados 1, 0 errores.
- ~1149 tests verde. QUEDA de (a): 3.2 web robusto (iframes/shadow/waits — browser).
- QUEDA (b): correr Hermes/OpenClaw reales (su install+keys+tokens; harness listo).

## 2026-06-08 · Benchmark FASE 3 (parcial) + FASE 4.1 (joya)
- FASE 3.1: LSP SEMÁNTICO (chequeo de tipos por fichero, whitelist anti-FP).
- FASE 3.5: curator (patrón repetido → skill verificada+firmada vía E2).
- FASE 4.1: PAQUETE DE AUTONOMÍA DEMOSTRABLE (provenance.ts) — por tarea, prueba
  firmada HMAC {prompt, resultado, resumen audit, veredicto, hash}; cualquiera
  recomputa hash+firma y detecta manipulación. El titular "único con prueba
  verificable". Hermes/OpenClaw no lo emiten.
- Pendiente FASE 3: 3.2 web robusto (iframes/shadow/waits — necesita browser real),
  3.3 MCP a escala (servidores reales), 3.4 Team a escala (stress).

## 2026-06-08 · Benchmark FASE 1 ✅ y FASE 2 ✅ (construidas + validadas)
- FASE 1: harness `src/bench/` (runner aislado, checks deterministas, adaptadores
  shinobi/mock/CLI, suite coding/tool_use/autonomy/safety, reporte, config de
  competidores, escritor de resultados, `npm run bench:compare`). Smoke REAL:
  shinobi 4/4, safety 1/1, 0 errores.
- FASE 2.A: verificación OBJETIVA (gate duro de tests en código, pre-gate de E1).
- FASE 2.B: trust-score E3 ordena las tools anunciadas (sustrato→comportamiento).
- FASE 2.C: integridad SHA-256 de skills DESCARGADAS (fail-closed; cierra gap OpenClaw).
- ~1135 tests verde. Siguiente: FASE 3 (LSP semántico, web robusto, MCP a escala, Team).
- PENDIENTE EXTERNO: correr Hermes/OpenClaw reales necesita su install + API keys
  (harness ya listo vía bench.config.json); SWE-bench/escala/red-team = mayor esfuerzo.

## 2026-06-08 · Plan de preparación para benchmark público
- Objetivo fijado: shinobi debe poder afirmarse "mejor opción" con DATOS reproducibles
  vs Hermes (Nous) y OpenClaw, en benchmark público. Coste no es restricción.
- Plan completo en `BENCHMARK_READINESS_PLAN.md` (6 fases + claims irrefutables).
- Tesis: ganar por verificabilidad/seguridad/provenance/auto-corrección MEDIDAS, no
  por nº de features; producir los datos con un harness que corre a los 3 en igualdad.

## 2026-06-08 · Auditoría REAL de competidores (corrige claims previos)
- Auditados con file:line (no grep ciego) OpenClaw, Hermes, Claude Code-leak para 3
  capacidades. Resultado que CORRIGE mis "🥇 único":
  - **A auto-verificación**: nadie en código; Claude Code tiene verificador adversarial
    pero por prompt y flag-off para terceros. shinobi: única en CÓDIGO+default (grado).
  - **B trust-substrate**: nadie computa trust-score por tool desde historial→ranking;
    OpenClaw/Hermes solo circuit-breakers de credenciales. shinobi: lidera esta forma.
  - **C firma de capacidades**: NO exclusivo — OpenClaw verifica integridad SHA-256 de
    skills/plugins descargados (fail-closed); Hermes cosign su tool. shinobi: variante.
- Lección reforzada: no afirmar "único"/"verificado" sin auditar con la misma
  profundidad. Probar ausencia es caro; "no encontrado" ≠ "ausente".

## 2026-06-07/08 · Construido y validado esta tanda (todo en main, pusheado)
- Cimiento: agent_loop · spawn_agent · E1 (verifier+verified_agent) · worktrees · sandbox.
- Motores: E2 fábrica de skills firmadas+auditadas · E3 audit-as-substrate (trust) ·
  E4 enjambre · ToolSearch sobre E3 · deferred-tools · Team (paralelo real, ALS) ·
  MCP (cliente) · LSP (diagnósticos al escribir) · capa de confianza en canales (pairing+HMAC).
- Seguridad: gate de aprobación SELECTIVO (clase crítica: credenciales/secreto/cuenta/
  gasto + borrado masivo) reconvirtiendo el no-op FIX-002; fail-safe deniega sin asker.
- Auditoría FIX-004 (trunca memoria), FIX-006 (logs gateados), FIX-007 (.gitignore);
  FIX-005 moot. 3 bugs de producción de paso (loop-detector inerte, NUL en server.ts,
  isDockerAvailable sin daemon).
- Estado: ~1117 tests + 1 skip, typecheck limpio. main ↔ origin/main sincronizado.
- Smokes reales: MCP stdio, deferred end-to-end, LSP (tsc real), canal+pairing+orchestrator.

## Decisión abierta (pendiente del usuario)
- ¿Relajar el hard-block de `run_command` para que un borrado recursivo APROBADO se
  ejecute (coherencia "me pide permiso, yo acepto"), o mantener el doble freno actual?
