# DECISIONES — shinobi (log vivo, append-only, lo más reciente arriba)

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
