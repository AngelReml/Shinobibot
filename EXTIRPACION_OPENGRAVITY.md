# EXTIRPACION_OPENGRAVITY.md — plan quirúrgico de eliminación total

> **Estado:** plan auditado, NO ejecutado. **Fecha:** 2026-06-12.
> **Censo medido:** 132 referencias en código (`src/` + `scripts/`, 46 ficheros),
> 34 en docs raíz, 4 ficheros de test. Cada cita fichero:línea verificada.
> **Ejecutor previsto:** modelos baratos, fase a fase. Cada fase compila en verde
> antes de pasar a la siguiente. Al cerrar cada fase: entrada en DECISIONES.md.

---

## 0. Lo que la auditoría descubrió (léelo antes de ejecutar)

OpenGravity son **DOS sistemas distintos** dentro de Shinobi, no uno:

| Sistema | Cliente | Puerto | Qué hace |
|---|---|---|---|
| **Kernel** | `src/bridge/kernel_client.ts` (`KERNEL_URL`, :9998) | 9998 | health-check, lanzar/esperar misiones |
| **Gateway/Cloud** | `src/cloud/opengravity_client.ts` (`OPENGRAVITY_URL`, :9900) | 9900 | proxy LLM legacy, catálogo de skills, workflows n8n, swarm missions, telemetría, version-check |

Y dos hallazgos que explican que "el modo kernel aún da problemas":

1. **El default sigue siendo kernel.** `orchestrator.ts:50` → `private static mode: ExecutionMode = 'kernel'`. Cada arranque vuelve a modo kernel aunque OpenGravity no exista.
2. **El filtro de tools en modo local nunca funcionó.** `orchestrator.ts:337` filtra la tool `start_kernel_mission`… pero la tool registrada se llama **`start_cloud_mission`** (`cloud_mission.ts:13`). El nombre no coincide → incluso en modo local el LLM siempre tuvo disponible la tool que intenta conectar a OpenGravity, falla el health-check o cuelga 5 min de timeout. Además la pista del sistema (`orchestrator.ts:113`) le dice al LLM que use una tool que no existe con ese nombre.

Conclusión: la extirpación no es solo limpieza — corrige un bug activo.

---

## 1. Invariantes (gates obligatorios para el ejecutor)

- **G-COMPILA**: al final de CADA fase: `npm run typecheck` verde.
- **G-TESTS**: al final de cada fase: `npx vitest run` verde (ajustar los tests de la fase, nunca borrarlos para "pasar").
- **G-CERO** (solo al final, Fase 7): `grep -rci "opengravity" src/ scripts/ src/web/public/` = 0 en todos los ficheros. `grep -ri "KernelClient\|start_cloud_mission\|OPENGRAVITY_URL\|SHINOBI_API_KEY"` = 0 en `src/` y `scripts/`.
- **Rama**: `git checkout -b extirpacion-opengravity`. Un commit por fase. Rollback = revertir el commit de la fase.
- **Regla de oro**: ante una referencia ambigua, NO improvisar — anotarla en DECISIONES.md y preguntar. Las tres ambigüedades conocidas ya están resueltas en §4.
- **Localizar por contenido, no por línea**: el árbol está vivo (131 cambios sin commitear) y los números de línea YA derivan entre lecturas (medido en app.js durante esta auditoría). Cada cita de este plan lleva el símbolo o snippet: el ejecutor debe regrepear (`grep -n`) antes de tocar. La línea es orientación; el ancla es el contenido.

---

## 2. Lo que NO se toca (falsos positivos verificados)

| Fichero | Por qué se queda |
|---|---|
| `src/runtime/remote_mode.ts` | Usa la palabra "kernel" para referirse al **propio Shinobi desplegado en un VPS** (SSH+Docker), no a OpenGravity. Solo retocar textos/comentarios (opcional, Fase 7). |
| `src/reader/RepoReader.ts:95` | `'kernel'` es una keyword en una lista heurística de nombres de directorio. Nada que ver. |
| `src/cloud/openrouter_fallback.ts` | **Se conserva**: es un cliente directo de OpenRouter usado por 5 módulos ajenos a OG (`learning/background_review`, `learning/skill_curator`, `providers/provider_router`, `skills/skill_manager`, `tools/browser_engine`). Solo limpiar comentarios/cabecera `X-Title` (líneas 3-7, 43). |
| `src/cloud/types.ts` | **Se conserva**: lo importan 12 módulos (todos los providers, agents, learning, memory, skills). Eliminar SOLO las interfaces específicas de OG (`SwarmMissionPayload`, `N8nWorkflowPayload`) tras confirmar con typecheck que nadie más las usa. `LLMChatPayload` y `CloudResponse` se quedan. |
| `src/bench/` (harness completo) | Autocontenido, cero refs OG en su código. Solo el comentario de `scripts/run_one.ts:3` (decía que run_bench.py de OpenGravity lo invoca — reescribir comentario: es un entry-point standalone). |
| `DECISIONES.md` | Append-only por regla del repo. El historial menciona OG: **se conserva**. Se añade la decisión de extirpación, no se reescribe el pasado. |

---

## 3. Las fases (orden por dependencia; cada una compila sola)

### FASE 1 — Matar el modo kernel (el dolor activo)

| Fichero | Acción |
|---|---|
| `src/coordinator/orchestrator.ts` | `:47` eliminar el tipo `ExecutionMode` (o reducirlo a `'local'`); `:50` default → `'local'`; `:75-78` eliminar `setMode`; `:108-115` eliminar `buildModeHint` (la rama kernel nombra una tool inexistente); `:337` eliminar el filtro `start_kernel_mission` (queda obsoleto al borrar la tool en Fase 2). |
| `src/bridge/kernel_client.ts` | **Borrar el fichero** (138 líneas). Borrar `src/bridge/` si queda vacío. |
| `src/coordinator/slash_commands.ts` | `:19` quitar import KernelClient; `:42-43` actualizar descripciones de `/status` (sin "kernel") y **eliminar `/mode`**; `:77-83` eliminar `checkKernelStatus`; `:116-129` eliminar el handler de `/mode` y la llamada a checkKernel en `/status`. |
| `src/web/server.ts` | `:35` quitar import KernelClient; `:349-357` eliminar `POST /api/mode`; `:399-407` en `/api/status` quitar `kernelOnline` y `mode` (o `mode:'local'` constante un release, ver §5); `:693-696` en el WS `final` quitar `mode`. |
| `scripts/shinobi_web.ts` | `:21` import; `:123-128` `checkKernel()`; llamada en main. |
| `scripts/shinobi.ts` | `:12` import; `:35-42` checkKernel; `:250-256` textos del banner CLI (`/mode kernel`, "KERNEL CONNECTED"); `:297`. |
| `src/gateway/http_channel.ts` | `:58` `mode: 'local'` constante (API pública del gateway: no romper el shape). |
| UI: `index.html:323-338` | Eliminar el bloque "modo de ejecución" de la pestaña El dojo (los 3 radios kernel/local/auto). |
| UI: `settings.js:222` | Quitar la fila `kernel` del estado; quitar el handler del radio mode. |
| UI: `app.js:683-684` | En FALLBACK_COMMANDS quitar `/mode` y la palabra kernel de `/status`; el campo `mode` ya no llega en `final` ni en `/api/status` (limpiar `lastStatus.mode`, `rk-modo` en `index.html:204` y su render). |
| `src/dispatch/intent_router.ts:32` | Reescribir el texto de ayuda (cita "/status para verificar el estado del OpenGravity Kernel"). |

**Gate F1**: typecheck + vitest + `grep -rn "KernelClient\|ExecutionMode\|setMode" src/ scripts/` → solo hits esperados (ninguno o los de remote_mode si comparte nombre — verificar).

### FASE 2 — Matar las tools cloud y el catálogo remoto de skills

| Fichero | Acción |
|---|---|
| `src/tools/cloud_mission.ts` | **Borrar** (tool `start_cloud_mission`). |
| `src/tools/n8n_invoke.ts`, `src/tools/n8n_list_catalog.ts` | **Borrar** (proxean workflows vía OG). |
| `src/tools/skill_list.ts` | La tool lista el catálogo remoto OG (`:6,:15`). Reescribir para listar SOLO skills locales (`skillManager().listPending()` + aprobadas) o borrar si `/skill list` ya lo cubre. |
| `src/tools/skill_request_generation.ts` | **Borrar** (pide a OG generar skills; el bucle local de auto-generación del Skill Manager — Bloque 3 — es independiente y se queda). |
| `src/tools/index.ts:19` | Quitar `import './cloud_mission.js'` y los imports de los borrados. |
| `src/skills/skill_loader.ts` | `approveAndLoad` (`:18-32+`) descarga `.mjs` del marketplace OG. Eliminar el camino remoto; conservar `reloadAllApproved()` (carga local de `skills/approved/`, no toca red — verificado en el boot de `shinobi_web.ts:175`). |
| `src/coordinator/slash_commands.ts` | `:299` (`/skill` rama con `OPENGRAVITY_URL`) y `:314` (namespace dual "OpenGravity executable-skill flow"): dejar solo el namespace local. |
| `src/skills/skill_manager.ts:25` | Comentario (cita .mjs "que vienen de OpenGravity") — actualizar. |

**Gate F2**: typecheck + vitest + arrancar `npm run dev` y verificar que el boot carga skills locales sin errores.

### FASE 3 — Notifier: de workflow OG a webhook directo

`src/notifications/notifier.ts` envía alertas vía `OpenGravityClient.invokeWorkflow` (`:58`). Lo usan `slash_commands` (/notify), `runtime/resident_loop` y `tools/windows_notification`. **No borrar la feature**: reescribir `Notifier` para hacer POST directo a una URL configurable `SHINOBI_NOTIFY_WEBHOOK` (mismo payload JSON). `/notify set <url>` guarda la URL; sin URL configurada → no-op silencioso con log. Elimina el import de OpenGravityClient. ~40 líneas. Actualizar test si existe.

### FASE 4 — Providers: extirpar el proveedor 'opengravity' (el compilador guía)

**Técnica para el ejecutor barato**: primero quitar `'opengravity'` del union type y dejar que typecheck señale cada rama muerta.

| Fichero | Acción |
|---|---|
| `src/providers/types.ts:10-12` | Quitar `'opengravity'` del union `ProviderName` y el comentario. |
| `src/providers/provider_router.ts` | `:20` import OpenGravityClient fuera; `:62` rama `return null`; `:78` **default ya no es `'opengravity'`**: `currentProvider()` devuelve el provider configurado o `null` (los callers ya gatean onboarding con `isConfigUsable`); `:83-97` eliminar el camino legacy "OpenGravity primario + OpenRouter fallback". |
| `src/providers/failover.ts` | `:119` quitar del array `valid`; `:146` `defaultOrder` pasa a `['openrouter','groq','anthropic','openai','gemini','deepseek','glm','huggingface']`; `:6,:114` comentarios. |
| `src/cloud/opengravity_client.ts` | **Borrar** (ya sin importadores tras F2/F3). |
| `src/cloud/credential_pool.ts` | `:20` quitar la rama `OPENGRAVITY_KEY_\d+ / SHINOBI_API_KEY`. OJO: su único importador era opengravity_client (verificado) — si tras F4 nadie lo importa, **borrar entero**; si algo más lo usa, solo la rama. |
| `src/cloud/types.ts` | Quitar `SwarmMissionPayload`, `N8nWorkflowPayload` (typecheck confirma). |
| `src/coordinator/model_router.ts:30` | Comentario del union. |
| `src/constants/prompts.ts:4` | **El system prompt dice "You are powered by the OpenGravity Kernel."** Sustituir por identidad local-first (p. ej. "You are Shinobi, an autonomous agent running locally on the operator's machine."). Es una línea, y cambia lo que el modelo cree ser. |

**Gate F4**: typecheck verde tras seguir TODOS los errores; `npx vitest run src/providers` verde (ajustar `failover.test.ts:2refs`).

### FASE 5 — Config, onboarding y dependientes silenciosos

| Fichero | Acción |
|---|---|
| `src/runtime/first_run_wizard.ts` | `:10-11` `opengravity_api_key/url` salen del tipo `ShinobiConfig` (subir `version` del schema); `:43-44` no exportar `OPENGRAVITY_URL`/`SHINOBI_API_KEY` al env; `:142-177` el wizard CLI pedía key de OG → reescribir para pedir provider+key (mismo flujo que el onboarding web) o delegar al web. `loadConfig` debe **tolerar** configs viejas con campos OG (ignorarlos, no crashear); `saveConfig` ya no los escribe. |
| `src/web/server.ts` | `:74-79` `isConfigUsable` pierde la rama legacy `opengravity_api_key && opengravity_url` → **cambio de comportamiento deliberado**: un usuario con config solo-OG va a onboarding (correcto: OG ya no provee LLM). Cuidado FIX-001: los tres puntos (`GET /`, `/api/onboarding/status`, `/skip`) ya comparten esta función — no duplicar lógica. `:202-207` `newCfg` sin campos OG. |
| `scripts/shinobi.ts:148-149,245-246` | No setear env OG desde config. |
| `src/migration/from_hermes.ts` | `:119-120` deja de mapear hacia campos OG; `:332-333` escribe el schema nuevo. Ajustar `from_hermes.test.ts`. |
| `src/telemetry/telemetry.ts:51` | El endpoint era el gateway OG. **Decisión §4-D2**: enviar solo si `SHINOBI_TELEMETRY_URL` está definida; si no, no-op. Sigue siendo opt-in. |
| `src/updater/version_check.ts:77` + `install_update.ts:25` | El update-check preguntaba al kernel. **Decisión §4-D3**: gatear por `SHINOBI_UPDATE_URL`; sin ella → "update check disabled". Ajustar `update_e2e.test.ts`. |
| `src/memory/curated_memory.ts:80` | Texto de plantilla de memoria que cita OG como ejemplo — reescribir ejemplo. |
| `src/multiuser/`, `src/a2a/` | Sin refs (verificado) — nada. |

**Gate F5**: typecheck + vitest + prueba manual: arrancar con un `config.json` legacy (solo campos OG) → debe ir a onboarding sin crash; arrancar con config provider → directo al dojo.

### FASE 6 — Scripts auxiliares y tests

- `scripts/d015_smoke.ts` (5), `scripts/d016_router_probe.ts` (2), `scripts/p_acceptance.ts` (3), `scripts/a4_run.ts` (1), `scripts/gaia/shinobi_oneshot.ts:39` (comentario start_kernel_mission), `scripts/build_log_generate.mjs` (4), `scripts/release/verify_release.mjs` (2), `scripts/run_tests.mjs` (1), `scripts/run_one.ts:3` (comentario): actualizar o, si el script era exclusivamente una prueba de OG (leer cabecera antes), borrarlo.
- Tests: `src/__tests__/stress/capability_stress.test.ts` (3), `src/runtime/__tests__/resident_daemon.test.ts` (2), `src/providers/__tests__/failover.test.ts` (2), `src/migration/__tests__/from_hermes.test.ts` (2) — ya tocados en sus fases; este es el barrido de confirmación.
- `src/tui/Tui.tsx:1`, `src/updater/version_check.ts`, `src/ledger/MissionLedger.ts:2` (comentario "replica el patrón del forensic ledger de OpenGravity" — reescribir como descripción propia).

### FASE 7 — Docs, env y gate final

- `.env` / `.env.example`: quitar `OPENGRAVITY_URL`, `SHINOBI_API_KEY`, `KERNEL_URL`, `OPENGRAVITY_KEY_*`, `AUDIT_PORT` si era del kernel.
- Docs raíz (13 ficheros con refs, 34 menciones): `README.md`, `ARCHITECTURE.md`, `AGENTS.md`/`CLAUDE.md` (regenerar — es autogenerado: corregir el generador `estado.mjs`/`context.mjs` si plantilla OG), `ESTADO.md` (autogenerado), `SECURITY.md`, `ERROR_REPORT.md`, handoffs. **PLAN_SOMBRA_2026 / ROADMAP_FRONTERA_2026 / DOSSIER / DECISIONES**: históricos — no reescribir; añadir nota de vigencia si citan OG como presente.
- `apagar_shinobi.cmd` / `shinobi.cmd` / `rebuild*.cmd`: revisar si arrancan/checkean el kernel.
- **Gate final G-CERO** (§1) + `npm run typecheck` + `vitest run` completo + humo manual: web chat responde, /status limpio, una misión con navegador (Kage) funciona.
- Entrada de cierre en DECISIONES.md: "OpenGravity extirpado — Shinobi es standalone".

---

## 4. Decisiones tomadas (defaults propuestos; revoca si discrepas)

| # | Ambigüedad | Decisión propuesta |
|---|---|---|
| D1 | Notifier (alertas /notify, resident loop) | **Conservar la feature** vía webhook directo `SHINOBI_NOTIFY_WEBHOOK` (Fase 3). Borrar sería perder alertas operacionales que ya usas. |
| D2 | Telemetría (posteaba al gateway OG) | No-op salvo `SHINOBI_TELEMETRY_URL` explícita. No inventar endpoint nuevo ahora. |
| D3 | Update-check (preguntaba versión al kernel) | Deshabilitado salvo `SHINOBI_UPDATE_URL`. Migrar a GitHub Releases es tarea futura aparte. |
| D4 | `/api/status.mode` y `final.mode` (API pública del gateway/UI) | Mantener el campo con valor constante `'local'` durante un release y retirarlo después (no romper consumidores externos del gateway de golpe). |
| D5 | Skills remotas del marketplace OG | Se pierden (catálogo, generación remota). El bucle LOCAL de skills (SKILL.md + pending/approved + curator) queda intacto — es donde vive el valor real. |

## 5. Riesgos reales (sin maquillaje)

1. **Usuarios con config legacy solo-OG quedan "desconfigurados"** y verán onboarding. Es lo correcto (OG ya no responde), pero documentarlo en el release note.
2. **`cloud/types.ts` es columna vertebral** de 12 módulos: en F4 borrar SOLO interfaces que typecheck declare muertas. Si `SwarmMissionPayload` aparece usado en algo vivo, parar y anotar.
3. **El árbol está SUCIO (131 cambios sin commitear)** según el pulso del repo. Antes de la Fase 1: commitear o stashear el trabajo en curso. No mezclar la extirpación con cambios pendientes — el rollback por fases depende de ello.
4. Orden F2→F4 importa: borrar `opengravity_client.ts` antes de quitar sus importadores rompe la compilación a mitad de fase.

## 6. Estimación honesta

F1+F2 (el dolor activo): 1 día de modelo barato con gates. F3-F5: 1-2 días. F6-F7: medio día. Total: **2-4 días de ejecución supervisada**, commit por fase, sin big-bang.
