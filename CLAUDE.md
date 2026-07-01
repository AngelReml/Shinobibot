# AGENTS.md — contexto del sistema para una IA
<!-- GENERADO por context.mjs · NO editar a mano · 2026-07-01T21:15:12.787Z -->

> Si eres una IA y acabas de aterrizar en este repo: **lee este fichero primero.**
> Se genera desde la verdad de fuente (git + package.json + escaneo del codigo),
> asi que no miente ni se queda viejo. Para el detalle de diseno, sigue el orden
> de lectura del final.

## Que es
**shinobibot** — Shinobi — autonomous Windows-native agent. Public v1.0.0 release.
Canon del producto: *«extension de ti mismo, todo local, todo tuyo».* Ejecuta
acciones reales en la maquina (archivos, shell, navegador real con CDP), orquesta
sub-agentes (swarm/team), aprende y fabrica skills firmadas. No es un wrapper de chat.

## Pulso (vivo)
- **Version:** 1.0.0 · **Rama:** remediacion-2026-07-01 · **Arbol:** SUCIO (173 cambios)
- **Ultimo commit:** 67e80fc chore(F0.2): normaliza core.fileMode y finales de línea CRLF/LF
- **Tamano:** 459 ficheros de codigo (60681 LOC), 235 de test
- **Inventario (escaneo real):** ~62 registros de tool · 2 referencias MCP

## Mapa de modulos (`src/`, autogenerado del banner de cada modulo)

| Modulo | Ficheros | Rol (de la cabecera del codigo) |
|---|---|---|
| `src/a2a/` | 2 | A2A — protocolo Agent-to-Agent: otro agente invoca capacidades de este Shinobi. |
| `src/agents/` | 29 | Barrel del subsistema de agentes especialistas (Bloque 1 del encargo |
| `src/audit/` | 5 | D.3 — `shinobi audit <github_url>` orquesta clone → HierarchicalReader → |
| `src/backup/` | 1 | State Backup — backup/restore de settings/memoria/skills/audit(redactado) de Shinobi. NO incluye .e... |
| `src/bench/` | 15 | Barrel del harness de benchmark (FASE 1) — runner, tasks, adapters, report y results. |
| `src/benchmark/` | 5 | Benchmark Runner — suite comparativa de 20 tareas con scoring objetivo sin LLM. |
| `src/browser/` | 7 | Mejora 2: acción anclada con Playwright + reintento por staleness; CDP solo de |
| `src/channels/` | 13 | CAPA DE CONFIANZA de canales — pairing + identidad firmada. |
| `src/chizu/` | 16 | Nivel 3 — Chizu (地図): el cartógrafo, retrato fiel de la máquina (discovery/uso/riesgo→Atlas), cero ... |
| `src/cloud/` | 3 | Pool de credenciales API multi-proveedor — rotación de keys y cuarentena 1h tras rate-limit. |
| `src/committee/` | 8 | Habilidad B.2 — Comité de validación. |
| `src/constants/` | 1 | Prompt de sistema base del agente (SYSTEM_PROMPT): identidad, regla tool-first y protocolos. |
| `src/context/` | 5 | Context Compactor — compactación heurística del historial bajo presupuesto de tokens, sin LLM. |
| `src/coordinator/` | 13 | Orquestador del bucle LLM-tool (ShinobiOrchestrator): ejecuta tools, compacta contexto y audita. |
| `src/db/` | 2 | _(anade un banner de cabecera)_ |
| `src/dispatch/` | 5 | Barrel del clasificador de despacho por afinidad (Bloque 3). Shadow mode: |
| `src/documents/` | 6 | Renderizador de gráficos a SVG plano — CERO dependencia nueva. |
| `src/egress/` | 3 | F2.1 (CRIT-08, auditoría 2026-07-01) — enforcement REAL de egress en |
| `src/evaluation/` | 1 | FASE 0 del encargo "Refinador de prompts" — Promptfoo como juez objetivo |
| `src/gaia/` | 1 | Scorer OFICIAL de GAIA — port fiel y VALIDADO del `question_scorer` del |
| `src/gateway/` | 6 | Bloque 6 — orchestrator de canales del gateway externo. |
| `src/integrity/` | 7 | Integrity layer — checks pre/post-acción (claimed==real, hash, tipo) y bloqueo opcional vía SHINOBI... |
| `src/kagami/` | 14 | Nivel 2 — Kagami (鏡): el espejo, autocrítica calibrada (brier+sesgos) + 3 pilares (salud/frontera/a... |
| `src/kagemusha/` | 23 | Nivel 1 — Kagemusha (影武者): el clon-sombra que investiga de noche → Informe del Amanecer, bajo Capa ... |
| `src/kaname/` | 11 | Kaname (要): el núcleo inmutable + la frontera núcleo/skills — designa el núcleo, enforcea mediación... |
| `src/kangeiko/` | 11 | Kangeiko (寒稽古): motor de auto-mejora verificada — MIDE→INVESTIGA→FABRICA→CERTIFICA→CONSOLIDA→RE-MID... |
| `src/knowledge/` | 2 | Habilidad C.1 — /learn <ruta_o_url> |
| `src/learning/` | 5 | Fase 6 del bucle de aprendizaje — el Curator (Motor 2): mantiene sana la colección de skills. |
| `src/ledger/` | 1 | D.4 — MissionLedger: hash chain SHA256 de cada mision completada. |
| `src/lsp/` | 1 | LSP-flavored — DIAGNÓSTICOS al escribir/editar código. |
| `src/mcp/` | 3 | Registra las herramientas de un servidor MCP como Tools NATIVAS de shinobi. |
| `src/memory/` | 27 | Bloque 4 — Memoria persistente curada al estilo Hermes. |
| `src/migration/` | 1 | A4 — `shinobi import hermes` implementation. |
| `src/multiuser/` | 2 | Multi-user — un único runtime sirve a varios usuarios con memoria, soul y permisos aislados. |
| `src/notifications/` | 1 | Notifier — alertas operacionales (misiones fallidas, loops) vía webhook directo. |
| `src/observability/` | 3 | Reglas de alerta configurables que disparan webhooks al cruzar umbrales de eventos o métricas. |
| `src/persistence/` | 2 | Cola de tareas persistente en SQLite (better-sqlite3, WAL) con buffer de progreso y flush 200ms. |
| `src/plugins/` | 3 | Hot-plug de plugins como tools nativas — transforma ESM→CJS y evalúa en sandbox isolated-vm. |
| `src/providers/` | 10 | Bloque 7 — Anthropic native client. Default claude-haiku-4-5. |
| `src/reader/` | 10 | Habilidad D.2 — HierarchicalReader: extiende RepoReader con depth jerárquico. |
| `src/refiner/` | 4 | Barrel del refinador de prompts en camino caliente (FASE 1). Shadow mode: |
| `src/replay/` | 1 | Mission Replay — reconstruye y opcionalmente re-ejecuta (dry-run) una sesión desde audit.jsonl. |
| `src/runtime/` | 8 | Remote Mode (Sprint 3.5) — Shinobi desplegado en un VPS vía SSH+Docker; las tools corren allí. |
| `src/sandbox/` | 9 | Registro singleton de backends de ejecución de comandos: local, docker, ssh, e2b y mock. |
| `src/security/` | 2 | D-017 — gate selectivo de aprobación: modos on/smart/critical/off (default critical). |
| `src/selfdebug/` | 1 | Self-Debug — convierte cada fallo de tool en un diagnostic report estructurado y accionable. |
| `src/sentinel/` | 15 | Sentinel — slash command /sentinel: watch de fuentes, ask semántico, propuestas, council y digest. |
| `src/shitsuji/` | 14 | Nivel 5 — Shitsuji (執事): el mayordomo, compone skills CERTIFIED sobre datos reales (NL→Intent→Plan→... |
| `src/shugyo/` | 17 | Nivel 4 — Shugyo (修行): el explorador, aprende programas en jaula revertible (snapshot/restore de di... |
| `src/skills/` | 19 | Bloque 3 — Skill Manager autónomo. Bucle de auto-mejora inspirado en |
| `src/skills_runtime/` | 1 | Tiny obs-websocket v5 client for the desktop skills. |
| `src/soul/` | 1 | Soul (Alma) — personalidad configurable del agente: tono, identidad y persona prompt vía soul.md. |
| `src/stt/` | 1 | STT local con whisper.cpp — transcripción offline envolviendo el binario whisper-cli del operador. |
| `src/telemetry/` | 1 | G2.1 — Anonymous, opt-in telemetry client. |
| `src/tenshu/` | 14 | Tenshu (天守): el puente de mando sobre todo el dojo — VER/CONDUCIR/ENTENDER/CONSULTAR + SPA local + ... |
| `src/tools/` | 51 | Este archivo fuerza la carga y registro de todas las herramientas nativas. |
| `src/tui/` | 3 | TUI — interfaz de terminal interactiva (Ink/React): layout de chat + log de tool events en tiempo r... |
| `src/types/` | 1 | Tipos ambientales del repo — contrato mínimo de las skills .mjs cargadas dinámicamente. |
| `src/updater/` | 2 | B2.2 / B2.3 — Shinobi update check. |
| `src/utils/` | 7 | _(anade un banner de cabecera)_ |
| `src/watchers/` | 1 | A5 — Continuous watcher for the upstream Hermes repo. |
| `src/web/` | 2 | Bloque 1 — UI Web Chat. Express + WebSocket layer that wraps the existing |

## Como se corre / prueba

| Comando | Hace |
|---|---|
| `npm run start` | `tsx scripts/shinobi.ts` |
| `npm run dev` | `tsx scripts/shinobi_web.ts` |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run tui` | `tsx scripts/shinobi-tui.tsx` |
| `npm run bench` | `tsx scripts/benchmarks/run.ts` |
| `npm run bench:compare` | `tsx scripts/bench.ts` |
| `npm run bench:agentic` | `tsx scripts/bench_s_agentic.ts` |
| `npm run bench:s_code` | `tsx scripts/bench_s_code.ts` |
| `npm run bench:g2` | `tsx scripts/bench_g2.ts` |
| `npm run bench:g4` | `tsx scripts/bench_g4.ts` |
| `npm run bench:g5` | `tsx scripts/bench_g5_safety.ts` |
| `npm run bench:f41` | `tsx scripts/bench_f41.ts` |
| `npm run bench:f43` | `tsx scripts/bench_f43.ts` |
| `npm run build:exe` | `tsx scripts/build_exe.ts` |

> Entrada principal: `scripts/shinobi.ts` (CLI) y `scripts/shinobi_web.ts` (WebChat :3333).
> El orquestador del bucle LLM-tool vive en `src/coordinator/orchestrator.ts`.

## Orden de lectura (de lo mas autoritativo a lo mas historico)
1. **Este fichero** (AGENTS.md / CLAUDE.md) — orientacion viva, autogenerada.
2. **ARCHITECTURE.md** — diseno y flujo de una peticion.
3. **ROADMAP_FRONTERA_2026.md** — hacia donde va (motores E5-E8, pilares).
4. **PLAN_SOMBRA_2026.md** — el como estrategico: sigilo, economia 0-200, puertas G0-G7, emergencia.
5. **ESTRATEGIA_DIFERENCIADORES.md** — donde Shinobi gana indiscutible + plan de publicacion honesto.
6. **DECISIONES.md** — log append-only de decisiones (lo mas reciente arriba).
7. **ESTADO.md** — pulso autogenerado (lo genera estado.mjs).

**Historicos / no fiables como verdad actual:** -.
(Describen versiones anteriores; este fichero los reemplaza como puerta de entrada.)

## Convenciones que importan
- TypeScript ESM (Node 22). Tests con vitest (`*.test.ts` en `__tests__/`).
- El audit (`src/audit/`) registra toda tool-call en `audit.jsonl` (append-only).
- Seguridad: gate selectivo en `src/security/approval.ts` (no `utils/permissions.ts`).
- LLM multi-proveedor con failover (`src/providers/`), no un solo modelo fijo.
- Regla del repo: ninguna afirmacion sin dato medido; las decisiones van a DECISIONES.md.
