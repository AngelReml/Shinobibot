# Competitive audit — cierre de Mes 2

Fecha: 2026-05-15 (HEAD Shinobi `b0c6586`, Sprint 2.7 cerrado).
Repos comparados:
- Hermes Agent v0.13.0 (Nous Research)
- OpenClaw v2026.4.15-beta.1
- Shinobi (`AngelReml/Shinobibot`, branch `main`)

Sin maquillar según regla del plan.

---

## Resumen ejecutivo Mes 2

Mes 2 entregó **7 sprints** (los 5 originales 2.1-2.5 + 2.6 y 2.7 de la
adenda del 2026-05-15). Tras este mes Shinobi añade **5 capacidades
únicas en el mercado** que ningún rival tiene:

| Capacidad nueva | Sprint | Path |
|---|---|---|
| **Loop detector v3 con capa semántica de progreso** (LLM judge ligero opt-in que aborta si tras N iter no se acerca al objetivo declarado) | 2.1 | `src/coordinator/progress_judge.ts` |
| **Committee voting evolutivo** con 7 roles dinámicos + pesos por historial + mediator heurístico para disensos | 2.2 | `src/committee/{role_registry,role_selector,vote_history,mediator}.ts` |
| **Auto-skill generation por patrones reales** (3 repeticiones de misma secuencia de tools → propone skill firmable con `pending_confirmation`) | 2.6 | `src/skills/usage_pattern_detector.ts` |
| **Memory reflector** cada N mensajes detectando contradicciones, preferencias y consolidación con output markdown auditable | 2.7 | `src/context/memory_reflector.ts` |
| **Skill registry público con deps/upgrade/rollback** (resuelve grafo de deps con ciclos, hace backup automático, rollback restaura backup más reciente) | 2.5 | `src/skills/registry/{types,local_registry,dep_resolver,installer}.ts` |

Además se cierran dos huecos heredados:

| Hueco previo | Sprint | Cómo |
|---|---|---|
| Hierarchical reader cobertura 0.06–0.26% en repos grandes | 2.3 | `src/reader/deep_descent.ts` — walk recursivo + scoring relevance + cache SHA persistente. Validado **20.12% cobertura** en el propio repo de Shinobi. |
| Observabilidad limitada a `audit.jsonl` | 2.4 | `src/observability/{metrics,alerts,admin_dashboard}.ts` — `/admin/dashboard` HTML, `/admin/metrics/prom` Prometheus, `/admin/metrics/json`. AlertRouter con 3 tipos de regla (event_count, metric_above, event_match) + cooldown anti-spam + webhooks Slack/Discord. |

Y se silencia un comportamiento ruidoso heredado:

| Issue operacional | Cómo | Path |
|---|---|---|
| `Notifier.send()` mandaba email por cada misión fallida 3× consecutivas vía OpenGravity workflow, saturando inbox del operador | Default OFF; requiere `SHINOBI_NOTIFY_ENABLED=1` para reactivar. Modo silenciado loguea con prefijo `[Notifier:muted]` y devuelve `{success:true, muted:true}` para no romper callers | `src/notifications/notifier.ts` |

---

## Tabla comparativa (25 capacidades, cierre M2)

| # | Capacidad | Hermes | OpenClaw | Shinobi M2 |
|---|---|---|---|---|
| 1 | Loop detector — capa args (hash) | ❌ (solo IterationBudget) | ❌ explícito | ✅ SHA256 |
| 2 | Loop detector — capa output semántica (fingerprint normalizado) | ❌ | ❌ | ✅ |
| 3 | **Loop detector — capa progreso vs objetivo (LLM judge)** | ❌ | ❌ | ✅ Sprint 2.1 |
| 4 | Failover cross-provider con clasificador | parcial (multi-provider + tenacity) | ✅ model-fallback | ✅ con classifier |
| 5 | Context compactor heurístico idempotente | parcial (threshold tokens, no semantic) | ✅ context engine | ✅ chars/4 + invariantes |
| 6 | Token budget visible (endpoint) | ❌ | ❌ | ✅ `/api/token-budget` |
| 7 | Iteration budget compartido subagentes | ✅ IterationBudget | ❌ | ✅ |
| 8 | Audit log unificado JSONL | parcial (skills only) | parcial (sandbox-info) | ✅ todo en `audit.jsonl` |
| 9 | Tool execution events streaming | ❌ | parcial (Canvas live) | ✅ WS broadcast |
| 10 | **Committee voting con N roles dinámicos + pesos + mediator** | ❌ | ❌ | ✅ Sprint 2.2 (7 roles) |
| 11 | Anthropic Skills format compatible | parcial (agentskills.io schema) | ✅ Pi-coding-agent upstream | ✅ installer + Superpowers nested |
| 12 | Skill signing SHA256 + provenance | ❌ (auto-archive sin confirm) | ❌ | ✅ `signed_at + signed_by` |
| 13 | Skill audit pre-install (cripto + escáner estático) | parcial (subst vars + inline shell con timeout) | parcial (`openclaw security audit`) | ✅ 11 reglas critical + 9 warning + signing |
| 14 | **Skill registry público con deps/upgrade/rollback** | agentskills.io (sin rollback) | ClawHub (sin rollback formal) | ✅ Sprint 2.5 |
| 15 | **Auto-skill por patrones de uso reales (3+ repeticiones)** | parcial (curator post-transcript, no por secuencias de tools) | parcial (exec auto-allow trust binding) | ✅ Sprint 2.6 con confirmación humana |
| 16 | Memory vectorial built-in (sin plugin externo) | ❌ (plugin Honcho/Holographic) | ✅ sqlite-vec + LanceDB | ✅ Transformers.js local + OpenAI + hash |
| 17 | **Memory reflector periódico (contradicciones + preferencias)** | parcial (Honcho dialectic, sin output auditable) | parcial (Dreaming + Active Memory, sin contradicciones explícitas) | ✅ Sprint 2.7 con reporte markdown |
| 18 | Memory citations con id por default | ❌ | opt-in | ✅ |
| 19 | Multi-canal messaging (cantidad) | ✅ 32 plataformas en `gateway/platforms/` | ✅ 22+ canales | parcial (8: webchat/telegram/http/discord/slack/email/loopback/TUI) |
| 20 | Sandbox multi-backend (cantidad) | ✅ 7 (local/SSH/docker/Modal/Daytona/Singularity/Vercel) | ❌ (docker + browser) | ✅ 7 (local/docker/ssh/modal/daytona/e2b/mock) |
| 21 | Tools cross-platform (volumen) | ✅ 100+ | ✅ 58 skills | parcial (~37 tools) |
| 22 | Tools Windows-native (PowerShell) | ❌ | ❌ | ✅ 11 |
| 23 | Model router por complejidad del input (5 tiers) | parcial (vision routing only) | ✅ model fallback + reasoning-level mapping | ✅ Sprint 1.5 (50% ahorro validado) |
| 24 | **Deep reader profundo con scoring + cache SHA** (5%+ cobertura repos grandes) | ❌ (Firecrawl/browser, sin recursive descent local) | parcial (fs-safe helpers, no scoring por query) | ✅ Sprint 2.3 (20.12% cobertura validada) |
| 25 | **Observabilidad enterprise (Prometheus + dashboard admin + alertas webhook configurables)** | parcial (Langfuse plugin) | parcial (Control UI status card) | ✅ Sprint 2.4 (`/admin/dashboard` + `/admin/metrics/prom` + AlertRouter 3 tipos) |

---

## Categorías nuevas donde Shinobi gana (M2)

| Categoría | Estado M1 | Estado M2 | Justificación |
|---|---|---|---|
| Loop safety | gana (v2) | **gana más fuerte (v3 semántica)** | Capa 3 con LLM judge ligero (opt-in) detecta no-progreso vs objetivo declarado. Ningún rival tiene equivalente. |
| Committee decisions | gana (3 roles fijos) | **gana fuerte (7 roles dinámicos + pesos)** | role_selector elige por relevance keyword + ensureCoreCoverage. vote_history calibra peso 0.5–1.5. mediator heurístico resuelve disensos 3-vías con regla "peso ≥1.3 sin refutación". |
| Skill ecosystem | gana (signing) | **gana fuerte (registry + deps + rollback)** | Único agente con audit cripto + grafo de deps + backup automático + rollback. |
| Auto-skill generation | empate parcial | **gana (por patrones reales)** | Hermes crea skills post-tarea; OpenClaw por exec auto-allow. Shinobi detecta SECUENCIAS de tools repetidas 3+ veces, NO ejecuciones aisladas. Confirmación humana antes de generar. |
| Memory introspection | n/a | **gana (reflector)** | Hermes tiene Honcho dialectic (modelado conversacional, no reportes); OpenClaw tiene Dreaming (indexing, no contradicciones). Shinobi produce markdown auditable con contradicciones y preferencias. |
| Reader profundo | parcial | **gana (cobertura 20%)** | Validado en repo propio. Hermes confía en herramientas externas (Firecrawl). OpenClaw no tiene walk recursivo con scoring. |
| Observabilidad enterprise | empate | **gana fuerte** | Único con Prometheus + dashboard + 3 tipos de alert rule + cooldown anti-spam. |

---

## Categorías donde Shinobi sigue perdiendo

| Categoría | Hermes | OpenClaw | Shinobi M2 | Plan M3 |
|---|---|---|---|---|
| Volumen canales messaging | 32 | 22+ | 8 | Arquitectura está; requiere alta humana de credenciales (Discord/Slack ya implementados, faltan WhatsApp, Signal, Matrix nativos). Sprint 3.x si el operador aporta. |
| Volumen tools | 100+ | 58 | ~37 | No es foco del plan (calidad > cantidad). |
| Vision multimodal (imagen/screenshot via LLM) | ✅ Gemini/OpenAI vision | parcial | ❌ | No previsto. |
| Mobile native (iOS/Android app) | ❌ | parcial (companion apps roadmap) | ❌ (solo PWA) | Sprint 3.x si se prioriza. |
| Modo VPS aislado (ejecutar fuera de máquina host) | parcial (SSH/Modal backends) | ❌ | parcial (SSH backend) | **Sprint 3.5 lo cierra**: `shinobi --remote <vps>` via Docker + WebChat local + kernel remoto. |
| Personalidad configurable (Soul/Alma) | ❌ documentada formalmente | ❌ | ❌ | **Sprint 3.6**. |
| STT local sin API | ✅ faster-whisper opcional | parcial (Voyage embeddings) | ❌ (Whisper API only) | **Sprint 3.7** con whisper.cpp. |
| Redact secrets en logs + backup GitHub privado | parcial | parcial | ❌ | **Sprint 3.8**. |

---

## Deltas vs M1 (2026-05-15)

| Métrica | Cierre M1 | Cierre M2 | Delta |
|---|---|---|---|
| Sprints completados (plan 3 meses) | 5/12 | 12/14 (+2 adenda) | +7 |
| Tests vitest passing | 341 | 468 | +127 |
| Scripts funcionales sprint_*.ts | 5 | 12 | +7 (uno por sprint) |
| Categorías "gana o empata" en tabla | 10/14 | **17/25** | +7 categorías |
| Categorías "pierde claramente" | 4 | 4 (mismas + vision + mobile que no estaban en plan) | igual |
| Diferenciadores únicos en mercado | 5 | **10** | +5 |

---

## Veredicto honesto cierre M2

Shinobi al cierre del Mes 2 **gana o empata en 17 de las 25 categorías
auditadas** y suma **5 capacidades únicas en el mercado** que ningún
rival tiene:

1. Loop detector capa 3 semántica (progreso vs objetivo).
2. Committee voting evolutivo con pesos por historial.
3. Auto-skill generation por patrones reales de tools.
4. Memory reflector con detección de contradicciones.
5. Skill registry con deps + upgrade + rollback.

Las 4 áreas restantes donde pierde (volumen canales, volumen tools,
vision multimodal, mobile native) son problemas de **escala**, no de
**arquitectura** — el sprint pasado demostró que la arquitectura es
extensible y Shinobi puede sumar canales/tools sin refactor mientras el
operador aporta credenciales/recursos. Vision multimodal y mobile
native no estaban en el plan; entran en backlog post-M3 si el
posicionamiento del producto los pide.

El Mes 3 cierra los 4 huecos finales del plan (VPS aislado, Soul/Alma,
STT local, redact + backup) y publica el benchmark comparativo público
+ veredicto final.

---

## Próximos sprints (Mes 3)

- **3.1** Capacidades únicas extra (self-debug, mission replay, multi-user, A2A).
- **3.2** Benchmark suite comparativo (20 tareas reales en los 3 agentes).
- **3.3** README + marketing técnico final.
- **3.4** Re-auditoría final + veredicto.
- **3.5** Modo VPS aislado opcional (`shinobi --remote <vps>`).
- **3.6** Módulo Soul/Alma configurable.
- **3.7** STT local con whisper.cpp.
- **3.8** Redact secrets en logs + backup GitHub privado.

**Parada obligatoria** por regla del plan ("Para al cierre de cada mes
para mostrar la tabla comparativa actualizada antes de continuar al
siguiente mes") activada. Espera OK del operador para arrancar Mes 3.
