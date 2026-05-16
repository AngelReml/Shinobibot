# Auditoría de código profunda — Shinobi

**Fecha:** 2026-05-16
**Alcance:** todo `src/` (203 archivos `.ts`, ~29.000 LOC de producción) + archivos `.ts` de la raíz. Excluidos `*.test.ts`, `scripts/` (runners de sprint desechables) y `node_modules`.
**Método:** 7 auditores en paralelo, cada uno leyendo a fondo su bloque y verificando con grep en todo el repo cada afirmación de "código muerto".
**Naturaleza:** solo diagnóstico — no se modificó código.

---

## Resumen ejecutivo

**~150 hallazgos**: **15 CRITICAL · 41 HIGH · 52 MEDIUM · 42 LOW.**

El código está bien escrito a nivel de archivo individual, pero la auditoría destapa **tres problemas sistémicos graves**:

### 1. Teatro de seguridad — los guardarraíles anunciados son código muerto
Varios mecanismos de seguridad independientes existen, están testeados, y **nunca se invocan en el flujo real**:
- `requiresConfirmation()` (lo declaran `run_command`, `write_file`, `task_scheduler_create`, `screen_act`) — el orquestador **nunca lo llama** (`orchestrator.ts:259` es un comentario "auto-execute").
- `requestApproval` / `approval.ts` (D-017, con blacklists de rutas críticas `.env`/`.ssh`/`System32`) — **nunca se invoca**; el comando `/approval [on|smart|off]` persiste un modo que **nada lee**.
- `skill_signing.verifySkill` — las skills se firman al instalar pero **la firma jamás se verifica al cargarlas**.
- `skill_loader` descarga y **ejecuta `.mjs` remoto** de OpenGravity (HTTP plano) **sin auditar ni verificar firma**.
- El auditor de skills usa 22 patrones; los ~70 patrones "extendidos" (paridad Hermes) **no los importa nadie**.

**Consecuencia:** el banner y el README anuncian protecciones que no existen → falsa sensación de seguridad. La única defensa real es la blacklist de substrings de `run_command` (trivialmente evadible).

### 2. Deuda arquitectónica masiva — features construidas y NO cableadas
Una fracción enorme del código son módulos completos, testeados, con script de sprint propio, que **ningún path de producción invoca**:

| Módulo / feature | Estado |
|---|---|
| `model_router` + `query_complexity` (enrutado semántico) | sin cablear |
| `progress_judge` (la "capa 3 LLM judge" del README) | sin cablear |
| `failover_cooldown` | sin cablear |
| `memory_reflector` + `llm_compactor` | sin cablear |
| `iteration_budget` | sin cablear |
| `Dreaming` (3 archivos, "paridad OpenClaw") | sin cablear |
| Committee evolutivo (`role_registry`, `role_selector`, `mediator`, `vote_history`) | sin cablear |
| `usage_pattern_detector` (auto-skill Sprint 2.6) | sin cablear |
| `self_debug` (10 patrones error→fix) | sin cablear |
| Cadena de instalación federada de skills (`sources/*`, `registry/installer`) | sin cablear |
| **Todo `src/channels/`** — registry + 9 adapters | sin cablear |
| A2A / ACP (`A2ADispatcher`, `ZedBridge`) | sin cablear (`bin/shinobi-acp` no existe) |
| `multiuser` (`UserRegistry`, scoped dirs) | sin cablear |
| backends de sandbox `modal` y `daytona` | stubs que devuelven `success:false` siempre |

### 3. README / marketing vs. realidad
- **"5 channel adapters" / "multi-canal"** — 0 adapters de `src/channels/` están arrancados. Canales reales operativos: **3** (Telegram, HTTP, WebChat), todos en `gateway/`+`web/`.
- **"skills firmadas SHA256"** — se firman, no se verifican. Engañoso.
- **"loop detector capa 3 (LLM judge)"** — el `progress_judge` LLM está muerto; la capa 3 real (la del incidente 2026-05-16) es heurística.
- **"committee multi-modelo con voting"** — cierto en `runAudit.ts`, pero el comando `/committee` directo corre una versión degradada (3 roles, sin voting).
- **"sandbox / aislamiento"** — el backend por defecto `local` es `exec` directo en el host, no aísla nada.
- **"913 tests"** — la suite real tiene **953** (desfase del README).

---

## Hallazgos CRITICAL (15)

| # | Archivo:línea | Cat. | Problema |
|---|---|---|---|
| C1 | `coordinator/orchestrator.ts:191` | BUG | `JSON.parse(result.output)` sin try/catch propio. Un output no-JSON de cualquier provider convierte el turno entero en `verdict:'ERROR'` y aborta la misión, en vez de degradar a texto plano. |
| C2 | `coordinator/orchestrator.ts:259` | DEAD_CODE | `requiresConfirmation()` (lo declaran 4 tools) **nunca se invoca**. `run_command`, `write_file`, `task_scheduler_create`, `screen_act` se auto-ejecutan sin gate. Toda la capa de confirmación es decorativa. |
| C3 | `tools/_powershell.ts:23-26` | BUG | Escape `\"` inválido para `cmd.exe`; un valor del LLM con comillas dobles puede inyectar comandos en las 7+ tools Windows-elite (`psEscapeString` solo cubre comillas simples). **Command injection.** |
| C4 | `tools/run_command.ts:12-56` | BUG | Blacklist destructiva = `includes()` de substrings, evadible (variables, comillas, base64) e incompleta (falta `shutdown`, `reboot`, `diskpart`, `reg delete`, `Remove-Item -Recurse`, redirección `>`, destructores Unix para el backend Docker). |
| C5 | `utils/permissions.ts:15` | BUG | `validatePath` usa `startsWith(workspaceRoot)` sin separador → un dir hermano con prefijo común (`shinobibot-secrets`) pasa el check. **Path traversal** en la única guarda de las tools de filesystem. |
| C6 | `memory/provider_registry.ts:60-65` | MOCK | El provider de memoria `local` (default de producción) nunca recibe `localFactory` → degrada a `InMemoryProvider` **volátil en RAM**. La "persistencia SQLite local" no existe por esa ruta; se pierde todo al reiniciar. |
| C7 | `db/memory.ts:29-57` | BUG | `addMessage` hace read-modify-write **no atómico** sobre `memory.json`, con múltiples instancias de `Memory` (orchestrator + context_builder) escribiendo el mismo archivo. Lost-update bajo concurrencia async → pérdida de historial. |
| C8 | `skills/skill_loader.ts:30-75` | BUG | Descarga y **ejecuta `.mjs` remoto** de OpenGravity (HTTP plano) tras un strip de tipos por regex frágil, **sin auditar ni verificar firma**. RCE si el endpoint está comprometido. |
| C9 | `skills/skill_signing.ts` | DEAD_CODE | `verifySkill`/`verifySkillText` **solo se usan en tests**. Ni `skill_manager.loadApproved()` ni `skill_loader` verifican la firma al cargar. Es un checksum que nadie comprueba. |
| C10 | `skills/sources/{agentskills_io,clawhub,federated_registry}.ts` | BUG | `contentHash`/`declaredHash` de las fuentes remotas se capturan pero **nunca se comparan** con el body descargado. Una fuente comprometida sirve un body alterado sin detección. |
| C11 | `src/channels/` (subsistema completo) | DEAD_CODE | `channelRegistry()` y los 9 adapters **no se importan desde producción**. Ningún entry point arranca un adapter. El "5 channel adapters" del README es falso para `channels/`. |
| C12 | `web/server.ts:357-485` | BUG | Flag `busy` global no atómico + monkey-patch **global de `console`** → bajo conexiones WS concurrentes los streams de output se mezclan o se pierde la restauración de `console` (el propio código lo admite). |
| C13 | `security/approval.ts` (módulo completo) | DEAD_CODE | `requestApproval`, `isDestructive`, `DESTRUCTIVE_PATTERNS`, `CRITICAL_PATH_PATTERNS` **nunca se invocan**. `/approval [on\|smart\|off]` persiste un modo que nada lee. Protección anunciada inexistente. |
| C14 | `web/server.ts:130` | MOCK | El asker de aprobación en modo Web es `async () => 'no'` permanente: toda operación que pidiera confirmación se deniega en silencio sin UI. |
| C15 | `scripts/d017_smoke.ts:20` | BUG | Importa `ABSOLUTE_PROHIBITED_PATHS` de `permissions.ts`, símbolo **que no se exporta** → smoke test D-017 roto en build/runtime. (También causa 1 de los 4 errores de `tsc`.) |

---

## Hallazgos HIGH (41)

### Coordinator / LLM
- `[HIGH]` `orchestrator.ts` + `slash_commands.ts` — `/tier` es un **no-op silencioso**: `getTier/setTier` no existen, el `?.` los traga; el `model_router` no está cableado.
- `[HIGH]` `coordinator/model_router.ts` + `query_complexity.ts` — DEAD_CODE: el enrutado semántico de modelos no lo invoca producción.
- `[HIGH]` `coordinator/progress_judge.ts` — DEAD_CODE: la "capa 3 LLM judge" del README nunca se ejecuta.
- `[HIGH]` `coordinator/failover_cooldown.ts` — DEAD_CODE: el `provider_router` hace failover sin consultar cooldowns.
- `[HIGH]` `context/memory_reflector.ts` + `llm_compactor.ts` — DEAD_CODE: reflexión de memoria + compactación LLM construidas, nunca cableadas.
- `[HIGH]` `bridge/opengravity.ts:48-71` — BUG + DEAD_CODE: deja `.tmp` huérfano, WSL hardcodeado (`C:\Windows\System32\bash.exe`), y la clase no se importa en producción.

### Tools
- `[HIGH]` `utils/permissions.ts:15` — (= C5) traversal por prefijo.
- `[HIGH]` `tools/run_command.ts:72` + `READONLY_LEADERS:27` — la excepción de sandbox para `node`/`npx` permite **ejecutar código arbitrario fuera del workspace** (`node -e "..."`).
- `[HIGH]` `tools/web_search.ts:33-68` — fuga de pestañas: la rama `isFullUrl` crea pestañas y nunca las cierra; sin rotación.
- `[HIGH]` `tools/screen_act.ts:151` / `screen_observe.ts:19` — `await import('@nut-tree-fork/nut-js')` fuera de try/catch: si nut-js no está instalado, la tool revienta con stack crudo.
- `[HIGH]` `tools/browser_engine.ts:531` — `JSON.parse` sin validar en `visionAnalyze`: una respuesta de visión válida se reporta como "parse failed".
- `[HIGH]` `tools/_docker_backend.ts:80-105` — la blacklist destructiva es Windows-céntrica; comandos destructivos **Unix** dentro del container pueden arrasar el `cwd` montado del host.

### Memory / persistencia
- `[HIGH]` `memory/embedding_providers/factory.ts:28-45` — la "autodetección" de backend es falsa: el `try` no comprueba nada, siempre devuelve `'local'`, la cascada de fallback es inalcanzable.
- `[HIGH]` `memory/memory_store.ts:120-126` — recall mezcla scores incomparables (cosine `-1..1` sin normalizar vs keyword fijo `0.5`); ranking arbitrario; cosine negativo resta score.
- `[HIGH]` `memory/memory_store.ts:85-97` — `recall()` carga la tabla `memories` completa en RAM y calcula similitud en JS por query. O(n) sin índice ni `LIMIT`. No escala.
- `[HIGH]` `db/memory.ts` + `memory_store.ts` — TECH_DEBT: tres capas de memoria solapadas y mal delimitadas; el registry ni accede al `MemoryStore`.
- `[HIGH]` `persistence/missions_recurrent.ts:124-129` — `recordRun` trunca `output` con `.substring()` sin marcar; JSON/markdown largo queda corrupto.

### Skills / committee
- `[HIGH]` `skills/skill_loader.ts:60-66` — strip de tipos TS por regex que puede coincidir con object literals reales y corromper la skill.
- `[HIGH]` `committee/cli.ts:8-26` — DEAD_CODE/MOCK: `/committee` corre versión degradada (3 roles, `votingRuns:1`, sin `code_reviewer`) vs. la real de `runAudit.ts`.
- `[HIGH]` `committee/{role_registry,role_selector,mediator,vote_history}.ts` — DEAD_CODE: todo el "Committee evolutivo Sprint 2.2" sin cablear.
- `[HIGH]` `skills/auditor/extended_patterns.ts` — DEAD_CODE: los ~70 patrones extendidos no los importa el auditor (corre con 22).
- `[HIGH]` `skills/sources/*` + `registry/installer.ts` — DEAD_CODE: toda la instalación federada de skills sin punto de entrada.
- `[HIGH]` `selfdebug/self_debug.ts` — DEAD_CODE: nunca se invoca al fallar una tool.
- `[HIGH]` `skills/usage_pattern_detector.ts` — DEAD_CODE: el detector de patrones Sprint 2.6 no está integrado.

### Channels / interfaces
- `[HIGH]` `a2a/{zed_bridge,protocol,acp_adapter}.ts` — DEAD_CODE: A2A/ACP sin cablear; `bin/shinobi-acp` mencionado no existe.
- `[HIGH]` `multiuser/user_registry.ts` — DEAD_CODE: `UserRegistry` nunca se usa; ningún canal aísla por usuario.
- `[HIGH]` `channels/adapters/teams_adapter.ts:117` — MOCK: `send()` lanza "no implementado" (envío proactivo).
- `[HIGH]` `channels/adapters/webhook_adapter.ts:141` — `send()` lanza error; un adapter registrado no cumple el contrato.
- `[HIGH]` 8 adapters de `channels/adapters/*` — BUG: excepciones tragadas en los listeners de mensajes entrantes → el remitente nunca recibe respuesta ni aviso de error.
- `[HIGH]` `web/server.ts:130` — (= C14) asker = `() => 'no'`.
- `[HIGH]` `gateway/telegram_channel.ts:110` — `void bot.start()` fire-and-forget: si el polling crashea, el bot queda muerto sin reintento y `/api/info` sigue diciendo `telegramEnabled:true`.

### Runtime / seguridad / sandbox
- `[HIGH]` `sandbox/backends/modal.ts:44` — MOCK: `run()` ejecuta `echo MODAL_NOT_IMPLEMENTED` y siempre devuelve `success:false`; registrado como backend real.
- `[HIGH]` `sandbox/backends/daytona.ts:50` — MOCK: igual, solo hace `GET /health`, nunca ejecuta.
- `[HIGH]` `tools/run_command.ts:131` vs `sandbox/registry.ts:9` — BUG: backend desconocido cae a `local` con un `warn` (contradice la política documentada de no-fallback); rompe el aislamiento.
- `[HIGH]` `sandbox/backends/local.ts` — el "sandbox" por defecto no aísla nada (`exec` directo en el host).
- `[HIGH]` `security/secret_redactor.ts` — DEAD_CODE: `redactSecrets` solo se usa en backup; **no está cableado en el sink de `audit.jsonl` ni en el logger** (el "hueco" que dice cerrar sigue abierto).

### Utils / misc
- `[HIGH]` `backup/state_backup.ts:81,242` — BUG: `restoreBackup` sobrescribe el `audit.jsonl` real con la versión **redactada** del backup → pérdida irreversible de datos del audit.
- `[HIGH]` `audit/runAudit.ts:213-218` — BUG: con `opts.commit`, el `git fetch` de un SHA no-HEAD puede fallar sin chequear `.ok` → auditoría "pinned" que audita otro commit.
- `[HIGH]` `utils/kill_switch.ts:35-46` — BUG: si el spawn de PowerShell del kill switch falla, el `catch` lo traga y `shouldAbort()` devuelve siempre `false` → el botón de pánico de `screen_act` queda muerto en silencio.
- `[HIGH]` `demo/demo_runner.ts:124-219` — MOCK: `localStubResponse()` devuelve respuestas hardcodeadas por `task.id`; `shinobi demo` no ejecuta el agente real pero reporta PASS/FAIL.

---

## Hallazgos MEDIUM (52, condensados)

**Coordinator/LLM:** `orchestrator.ts:172` catch que traga errores de token budget · `iteration_budget.ts` DEAD_CODE + lógica `remaining()` que puede exceder `total` · `orchestrator.ts:115` `maxIterations=10` hardcodeado · `provider_router` + clients: failover cross-provider **inservible** (todos leen la misma `SHINOBI_PROVIDER_KEY` → 401 al rotar) · `orchestrator.ts:28` cliente `OpenAI` instanciado pero su uso está `[B2-DEPRECATED]` · clients `validateKey`: rama `else` inalcanzable (axios lanza en ≥400) · `slash_commands.ts:213` `parseInt` parcial acepta `3xyz` · `opengravity_client.ts:27` catch que traga error.

**Tools:** `screen_act.ts:49` `askYesNo` deniega siempre sin TTY → screen_act nunca puede borrar nada en modo autónomo · `read/write/edit/list` resuelven rutas contra `cwd` inconsistente; `edit_file` sin cap de tamaño · `web_search.ts:72` regex de dominio con lista de TLDs arbitraria → falsos positivos · `edit_file.ts:33` `target` vacío no validado · `search_files.ts:28` `args.include` concatenado crudo en la línea de comando → **command injection** · `n8n_list_catalog/skill_list/skill_request_generation`: URL+key de OpenGravity duplicada inline (bypassan el cliente) · `cloud_mission.ts:34` `await` sin timeout · `env_list.ts:12` blacklist por nombre no cubre `DATABASE_URL`/`DSN`/`cookie` con credenciales embebidas.

**Memory:** `dreaming/*` (3 archivos) DEAD_CODE · `getRecentMemories`/`inlineCitations` DEAD_CODE · `embedding_provider.ts:38` `cosineSimilarity` recalcula normas que el docstring dice innecesarias · `migration/from_hermes.ts:312` muta `process.env.APPDATA` global (race) · `from_hermes.ts:186` patrón ElevenLabs `[a-f0-9]{32,}` matchea cualquier hash · `from_hermes.ts:188` patrón OpenAI superconjunto del de OpenRouter · `knowledge/learn.ts:233` modelo hardcodeado y comentario desincronizado · `learn.ts:145` scraping sin `robots.txt` ni rate-limit.

**Skills/committee:** `skill_manager.ts:171` race en `evaluateAndPropose` fire-and-forget → skills duplicadas · `Committee.ts:326` bloque `confidence` muerto con `+(...?0:0)` · `anthropic_skill_installer.ts:152` `github-repo`/`tarball` lanzan "no implementado" · `improvements.ts:331` escribe el archivo real del repo y lo revierte → pérdida de datos si crashea · `local_registry.ts:53` `compareSemver` ignora pre-releases · `skill_md_parser.ts:58` frontmatter frágil con valores multilínea · `skill_manager.ts:190` el trigger de patrón cuenta historia global sin ventana.

**Channels:** gateway y web server **sin CORS**; el WS de WebChat **sin auth**, bindea a `0.0.0.0` → cualquiera en la LAN ejecuta el orquestador · `web/server.ts:133` `express.json()` sin límite (DoS) · `email_adapter.ts:88` lock muerto + `pollTimer` declarado y nunca asignado · `email_adapter.ts:94` race en el listener `'exists'` → doble respuesta al mismo email · `gateway/llm.ts:53` accede a `choices[0].message` sin validar · `gateway/llm.ts` `LLMGateway` DEAD_CODE · `signal_adapter.ts` no envía `subscribeReceive` · `web/server.ts:103` título auto puede quedar `"undefined"`.

**Runtime/seguridad:** `e2b.ts:53` API del SDK E2B probablemente inexistente · `resident_loop.ts:36` errores de `tick()` tragados, sin backoff · `resident_loop.ts:43` misiones procesadas secuencialmente sin timeout → una colgada bloquea el loop · `mission_scheduler.ts:80` weekday `0..7` mete representación no canónica en `CronField` · `ssh.ts:53` `StrictHostKeyChecking=no` hardcodeado (MITM) · `ssh.ts:60` `checkSandbox` valida el `cwd` de la máquina equivocada en modo SSH · `approval.ts:169` asker por defecto irrelevante mientras `requestApproval` siga muerto.

**Utils/misc:** 19 archivos `test_*.ts`/`stress_test.ts` scratch versionados en la raíz · `utils/runner.ts` `run_command` DEAD_CODE con `execSync` sin sanitizar · `utils/undercover.ts` `UNDERCOVER_RULES` DEAD_CODE · `observability/alerts.ts:184` `webhookUrl` sin validar (SSRF) · `telemetry.ts:50` endpoint default `http://localhost:9900` sin TLS · `admin_dashboard.ts` `/admin` sin auth propia.

---

## Hallazgos LOW (42, agregados)

Bugs menores y deuda de calidad: handlers de `timeout` faltantes en algún `http.get` (`kernel_client.ts:86`), regex de `classifyFailureMode` demasiado amplio (riesgo de falso positivo), `dotenv.config()` cargado de forma inconsistente, modo `'auto'` semi-implementado en el orquestador, exit-code casteado a `number` (puede dar `NaN`), modelos hardcodeados dispersos (committee, vision), rutas relativas a `cwd` para artefactos persistentes (`committee_history.jsonl`, `proposals/`), `MissionLedger.list()` que revienta entera con una línea JSONL corrupta, fugas de directorios temporales en `/learn`, `process_lock` que mata el proceso en `unhandledRejection`, IP del VPS Contabo `167.86.80.220` en un comentario JSDoc, `console.log [DIAG temporal]` dejado en producción (`documents/factory.ts:152`), parsers markdown duplicados (`pdf.ts`/`word.ts`), checks de benchmark con regex `s[ií]` laxo, `import()` dinámico innecesario en `runAudit.ts`, sin tabla de versión de esquema en ninguna DB SQLite, `test_api.ts` con `sk_test_123` hardcodeado. Detalle completo por bloque en los informes de cada auditor.

---

## Patrones transversales

1. **"Ghost features".** ~20 módulos completos con tests y scripts de sprint pero **cero integración en producción**. El patrón se repite por bloque: se construyó la feature, se escribió su test, se cerró el sprint "en verde" — pero nunca se cableó al orquestador. Es la mayor fuente de deuda del repo.
2. **Seguridad declarada ≠ seguridad real.** Tres sistemas de confirmación/aprobación distintos, todos muertos. Firma de skills sin verificación. Sandbox que no aísla. El riesgo no es solo técnico: el banner y el README prometen protecciones inexistentes.
3. **`JSON.parse` sin red.** Patrón repetido (orchestrator, browser_engine, web/server) de parsear output de LLM/provider asumiendo JSON válido.
4. **Excepciones tragadas.** `catch {}` o `catch { lastError = e }` sin log en múltiples bloques — fallos reales invisibles.
5. **Sin migraciones de esquema.** Ninguna DB SQLite tiene versionado; el próximo cambio de esquema romperá en silencio sobre DBs viejas.
6. **Higiene de repo.** 19 archivos scratch en la raíz no deberían estar en un repo etiquetado v1.0.0 público.

---

## Recomendaciones priorizadas

**P0 — antes de presentar el producto como "seguro":**
- Cablear UN sistema de confirmación real (decidir entre `requiresConfirmation` o `approval.ts`, eliminar el otro) en el bucle de despacho de tools.
- Verificar firma/hash de skills al cargar (`skill_signing` + `contentHash` de fuentes); auditar el código de `skill_loader` antes de ejecutarlo.
- Arreglar `validatePath` (C5) y el escape de PowerShell (C3).
- Corregir o quitar del README las afirmaciones falsas (channels, skills firmadas, sandbox, capa 3, nº de tests).

**P1 — bugs que corrompen datos:**
- C6 (memoria volátil), C7 (escritura no atómica de `memory.json`), HIGH de `restoreBackup` (audit redactado), `improvements.ts` (escribe el repo).

**P2 — decidir el destino de las ~20 ghost features:** cablearlas o eliminarlas. No pueden quedar como código a medias presentado como diferenciador.

**P3 — robustez:** `JSON.parse` defensivo, timeouts por tool/misión, CORS+auth en web/gateway, migraciones de esquema, dejar de tragar excepciones.

**P4 — higiene:** sacar los 19 `test_*.ts` de la raíz, quitar la IP del VPS y `sk_test_123`, eliminar dead code confirmado (`utils/runner.ts`, `utils/undercover.ts`, `bridge/opengravity.ts`).

---

*Auditoría realizada el 2026-05-16. Diagnóstico únicamente — no se aplicó ningún fix. Los conteos exactos por bloque están en los informes de los 7 auditores.*
