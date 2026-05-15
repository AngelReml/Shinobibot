# Competitive audit M3 — REVISADO con verificación independiente

Fecha: 2026-05-15. Supersede a `competitive_audit_M3.md`.
Repos verificados con lectura directa de código:
- Shinobi (`C:\Users\angel\Desktop\shinobibot`, HEAD `c6dcb64`)
- Hermes Agent v0.13.0 (Nous Research, `C:\Users\angel\Desktop\hermes-agent-main`)
- OpenClaw v2026.4.15-beta.1 (`C:\Users\angel\Desktop\openclaw_final_test`, HEAD `8c392f0019`)

Tres agentes independientes verificaron uno-a-uno las afirmaciones de M1/M2/M3 contra el código real de cada repo. Encontraron que **varias "capacidades únicas" reclamadas por Shinobi eran falsas** porque los audits previos subestimaron a Hermes y OpenClaw. Esto se corrige aquí sin maquillar.

---

## 1. Estado actual verificado

### Shinobi (verificación interna)
- **15/15 capacidades reclamadas existen como código real** — 0 stubs, 0 missing. Cada módulo tiene 187-345 LOC y test vitest asociado.
- **627 tests vitest pasando** (cifra real, no maquillada).
- El audit M3 incluso *sub-cuenta* capacidades: `documents/`, `updater/`, `gateway/`, `tui/`, `knowledge/`, `cloud/`, `bridge/` no aparecen en la tabla de 35.

### Hermes (auditoría externa)
- Repo dated v0.13.0, codebase Python, no commits expuestos.
- `tools/skills_guard.py` = **932 LOC con ~70 patrones regex en 6 categorías** (más extenso que el auditor de Shinobi de 11 critical + 9 warning).
- `acp_adapter/server.py` + `acp_registry/agent.json` = **A2A completo vía Agent Client Protocol oficial**.
- `docker/SOUL.md` + `hermes_cli/default_soul.py` = persona configurable seeded en HERMES_HOME.
- `tools/skills_hub.py` con `HubLockFile` + `bundle_content_hash` SHA256 = signing efectivo + provenance.
- `agent/redact.py` con vendor prefixes + query params + body keys = redactor completo.
- 8 sandbox backends (local/docker/ssh/modal/managed_modal/daytona/singularity/vercel_sandbox).
- Benchmarks reales en `environments/benchmarks/` (tblite, terminalbench_2, yc_bench, SWE-bench).

### OpenClaw (auditoría externa)
- HEAD `8c392f0019`, beta freeze 2026-04-15. **Cero features nuevas** desde M2; commits posteriores son fixes (dreaming storage, replay dedupe).
- `tool-loop-detection.ts` SÍ tiene capa output (`hashToolOutcome` + `getNoProgressStreak`), no solo args.
- **53 skills bundled con `SKILL.md` Anthropic-compatible** — Shinobi M1 sobreestimó la diferenciación.
- 4 sandbox backends reales: local + docker + ssh + browser (chromium+novnc).
- `skills/openai-whisper/` = STT local existe.
- ClawHub publish/install/update existe pero sin rollback formal.

---

## 2. Capacidades de Shinobi que NO son únicas (corrección honesta)

Los siguientes claims del audit M3 original están **incorrectos o exagerados**:

| Capacidad | Audit M3 original | Realidad verificada |
|---|---|---|
| Soul/Alma configurable (Sprint 3.6) | "✅ ventaja Shinobi" | **Paridad con Hermes** (`docker/SOUL.md` + `default_soul.py`). No es ventaja, es alcanzar paridad. |
| A2A protocol (Sprint 3.1) | "única Shinobi" | **Paridad con Hermes** (`acp_adapter/` + librería ACP oficial). OpenClaw tiene ACP IDE-bridge (Zed). |
| Skill signing SHA256 + provenance | "única Shinobi" | **Paridad con Hermes** (`HubLockFile` + `bundle_content_hash` SHA256). |
| Secret redactor (Sprint 3.8) | "única Shinobi" | **Paridad con Hermes** (`agent/redact.py` completo). |
| Backup state (Sprint 3.8) | "única Shinobi" | **Paridad con Hermes** (`hermes_cli/backup.py`). |
| Skill audit pre-install criptográfico | "única Shinobi (committee multi-modelo + literal)" | **Hermes tiene escáner más extenso** (~70 patrones vs 11+9 de Shinobi); el committee multi-modelo SÍ es único de Shinobi. |
| STT local (Sprint 3.7) | implicaba ventaja | **Paridad con Hermes** (faster-whisper) **y con OpenClaw** (skill openai-whisper). |
| Modo VPS aislado (Sprint 3.5) | "✅ ventaja" | **Hermes lo tiene más maduro** (Dockerfile + docker-compose + entrypoint + `loginctl enable-linger`). Shinobi 3.5 alcanza paridad arquitectónica. |
| Memoria con embeddings reales | "única" | **Paridad con Hermes** (Hindsight con embeddings locales + entity resolution + knowledge graph; 8 memory providers totales). |
| Multi-canal (Tg/Discord/Slack/Email) | implicaba ventaja | **Hermes tiene ~20 plataformas**, OpenClaw ~26. Shinobi 4. |
| Sandbox backends swappables | "✅ Sprint 1.4" | **Hermes tiene 8, OpenClaw tiene 4**, Shinobi tiene 7. Paridad con Hermes, ligero adelanto sobre OpenClaw. |
| Benchmark público (Sprint 3.2) | "única Shinobi" | **Hermes tiene tblite + terminalbench_2 + yc_bench + SWE-bench** en `environments/benchmarks/`. Shinobi no es primero. |
| Loop detector capa output | "única Shinobi v2" | **OpenClaw tiene `hashToolOutcome` + no-progress streak**, Hermes tiene `_result_hash` + repeat_count. Es paridad, no exclusiva. |

**Score corregido:** de las 22 "capacidades únicas" reclamadas en M3, **~13 son paridad con al menos un rival**, no únicas. Las exclusivas reales son ~9 (ver §3).

---

## 3. Capacidades genuinamente únicas de Shinobi (post-verificación)

Estas SÍ se sostienen tras leer el código de los 3 repos:

| # | Capacidad | Por qué es exclusiva |
|---|---|---|
| 1 | **Loop detector capa 3 — LLM judge de progreso vs objetivo** (Sprint 2.1, default OFF) | Hermes y OpenClaw tienen capa args + output, ninguno tiene capa "¿se está acercando al objetivo declarado?" |
| 2 | **Committee voting evolutivo** (Sprint 2.2): 7 roles dinámicos + pesos por historial + mediator heurístico | Hermes tiene curator/insights pero unidimensional; OpenClaw no tiene committee. |
| 3 | **Skill registry con rollback formal** (Sprint 2.5): dir `.rollback/<name>/<version>/` + restore automático | Hermes tiene quarantine; OpenClaw tiene update via npm integrity. Ninguno tiene rollback con backup. |
| 4 | **Auto-skill por patrones de uso reales** (Sprint 2.6): 3+ repeticiones de misma secuencia de tools → propone skill firmable con `pending_confirmation` | Hermes tiene curator post-transcript, OpenClaw no tiene equivalente. |
| 5 | **Memory reflector con markdown auditable** (Sprint 2.7): detecta contradicciones tipo "X es Y vs X no es Y" y produce `docs/reflections/<ts>.md` | Hermes tiene Honcho dialectic parcial sin output markdown; OpenClaw tiene Dreaming (distinto propósito). |
| 6 | **Audit log unificado JSONL** | Hermes audit es solo skills; OpenClaw audit es solo config. Shinobi audita tool_call + loop_abort + failover en un único `audit.jsonl`. |
| 7 | **Observability `/admin/dashboard` + Prometheus + AlertRouter** (Sprint 2.4) | Hermes tiene plugin Langfuse opcional; OpenClaw no tiene endpoint público. |
| 8 | **Token budget visible (`/api/token-budget`)** | Endpoint público no encontrado en Hermes ni OpenClaw. |
| 9 | **Tools Windows-elite PowerShell-native** (10 tools): clipboard, process_list, system_info, disk_usage, env_list, network_info, registry_read, task_scheduler_create, windows_notification | Ambos rivales son cross-platform sin PowerShell-first. |

Capacidades parcialmente únicas (mejores que rivales pero no exclusivas conceptualmente):
- Self-debug heurístico estructurado con 10 patrones (Hermes tiene curator+insights+background_review pero no patrón→fix suggestions estructurados con confidence).
- Mission replay con `dryRunReplay` detectando divergencias (OpenClaw tiene replay para exec.finished events vía ACP loadSession; Shinobi añade detección de divergencias).
- Multi-user con `canActOn` y roles owner/collab/guest (gateway Hermes tiene multi-session sin tenant isolation formal; OpenClaw tiene pairing-store sin scoping).

---

## 4. Áreas donde Hermes u OpenClaw lideran sobre Shinobi (honestidad)

| Capacidad | Líder | Por qué |
|---|---|---|
| Volumen y madurez de canales messaging | OpenClaw (26) > Hermes (20) > Shinobi (4) | Shinobi enfocado en 4 canales con tests; rivales tienen ecosistema mucho mayor. |
| Plugin marketplace real con pipeline publish | OpenClaw (ClawHub + 112 extensions) | Shinobi tiene registry local + GitHub source; no hay marketplace público activo. |
| Memory providers (diversidad) | Hermes (8: Hindsight, Holographic, Honcho, Mem0, Supermemory, RetainDB, OpenViking, Byterover) | Shinobi tiene memory_store + embeddings reales pero un solo backend principal. |
| Dreaming / Active Memory pipeline | OpenClaw (REM grounded + UI diary + dayBucket) | Shinobi tiene memory reflector pero no equivale al pipeline Dreaming. |
| Skill audit estático (densidad de patrones) | Hermes (~70 patrones vs Shinobi 11+9) | Cantidad. Shinobi gana en política multi-modelo (committee), Hermes en breadth. |
| Sandbox browser con novnc + chromium pre-baked | OpenClaw | Shinobi usa Comet/Chrome del operador via CDP, no sandbox dedicado. |
| Context compactor calidad semántica | Hermes (LLM-based) | Más caro en tokens pero preserva mejor; Shinobi heurístico es más predecible y barato. |
| IDE-protocol bridge (Zed-compatible) | OpenClaw (`docs.acp.md`, `extensions/acpx/`) | Shinobi A2A es genérico, no IDE-bridge. |
| Failover auth-profile cooldown automático | OpenClaw (`auth-profiles/`) | Shinobi tiene failover pero sin cooldown por auth-profile. |

---

## 5. Tabla comparativa final HONESTA (35 capacidades reordenadas)

Leyenda: ✅ = sí completo, ◐ = parcial, ❌ = no, n/d = no aplicable.

| # | Capacidad | Hermes | OpenClaw | Shinobi |
|---|---|---|---|---|
| 1 | Loop detector args (hash) | ✅ | ✅ | ✅ |
| 2 | Loop detector output semántico | ✅ (`_result_hash`) | ✅ (`hashToolOutcome`) | ✅ |
| 3 | **Loop detector capa 3 LLM judge** | ❌ | ❌ | ✅ Sprint 2.1 (default OFF) |
| 4 | Failover cross-provider | ✅ classifier 9 cat. | ✅ + cooldown | ✅ |
| 5 | Context compactor | ✅ LLM-based | ✅ pluggable | ✅ heurístico |
| 6 | **Token budget endpoint público** | ❌ | ❌ | ✅ |
| 7 | Iteration budget | ✅ | ◐ | ✅ |
| 8 | **Audit log unificado JSONL** | ◐ solo skills | ◐ solo config | ✅ tool_call+loop+failover |
| 9 | Tool execution events streaming | ❌ | ◐ Canvas live | ✅ WS |
| 10 | **Committee voting evolutivo (roles+pesos+mediator)** | ❌ | ❌ | ✅ Sprint 2.2 |
| 11 | Anthropic Skills format | ◐ agentskills.io | ✅ 53 bundled | ✅ installer + auditor |
| 12 | Skill signing SHA256 + provenance | ✅ `lock.json`+content_hash | ❌ (npm integrity) | ✅ signed_at+signed_by |
| 13 | Skill audit pre-install | ✅ ~70 patrones | ◐ npm integrity | ✅ committee multi-modelo |
| 14 | **Skill registry con rollback formal** | ❌ | ❌ | ✅ Sprint 2.5 |
| 15 | **Auto-skill por patrones de tools** | ◐ curator transcript | ❌ | ✅ Sprint 2.6 |
| 16 | Memoria embeddings reales + citations | ✅ Hindsight | ✅ memory-host-sdk | ✅ |
| 17 | **Memory reflector markdown auditable** | ◐ Honcho dialectic | ❌ (Dreaming es otra cosa) | ✅ Sprint 2.7 |
| 18 | Hierarchical reader profundo | ❌ | ◐ | ✅ Sprint 2.3 |
| 19 | **Observability `/admin` + Prometheus** | ◐ Langfuse plugin | ❌ endpoint | ✅ Sprint 2.4 |
| 20 | Multi-canal messaging | ✅ ~20 | ✅ ~26 | ◐ 4 |
| 21 | Sandbox backends | ✅ 8 | ✅ 4 (+ browser novnc) | ✅ 7 |
| 22 | Enrutador semántico por complejidad | ◐ image_routing | ◐ reasoning-level | ✅ Sprint 1.5 (env-toggle) |
| 23 | Plugin manifest fail-fast | ❌ | ✅ ~15 slots | ✅ |
| 24 | **Tools Windows-elite PowerShell** | ❌ | ❌ | ✅ |
| 25 | Modo VPS / Docker / túnel SSH | ✅ entrypoint+linger | ❌ (deploy templates ≠ off-load) | ✅ Sprint 3.5 (sin deploy E2E) |
| 26 | Soul/persona configurable | ✅ docker/SOUL.md | ❌ | ✅ Sprint 3.6 |
| 27 | STT local sin internet | ✅ faster-whisper | ✅ skill openai-whisper | ✅ Sprint 3.7 (sin run E2E) |
| 28 | Redact secrets en logs | ✅ agent/redact.py | ◐ | ✅ Sprint 3.8 (13 patrones) |
| 29 | Backup state | ✅ hermes_cli/backup | ❌ | ✅ Sprint 3.8 GitHub privado |
| 30 | Self-debug estructurado patrón→fix | ◐ curator+insights | ❌ | ✅ Sprint 3.1 |
| 31 | Mission replay con divergencias | ◐ trajectory_compressor | ◐ ACP loadSession | ✅ Sprint 3.1 |
| 32 | **Multi-user con scoped dirs y roles** | ◐ multi-session sin tenant | ◐ pairing-store sin scoping | ✅ Sprint 3.1 |
| 33 | A2A / agent protocol | ✅ ACP oficial | ✅ ACP IDE-bridge | ✅ Sprint 3.1 (envelope+HMAC) |
| 34 | Benchmark suite reproducible | ✅ 4 (tblite/yc/SWE/term) | ◐ qa-lab interno | ✅ Sprint 3.2 (20 tareas, simulado vs rivales) |
| 35 | Modular por bloques | ◐ run_agent.py 11k LOC | ✅ extensiones | ✅ |

**Score honesto:**
- Exclusivas Shinobi (ningún rival): **9** (filas 3, 6, 8, 10, 14, 15, 17, 19, 24 + parcialmente 30, 32) ≈ 25-30% del total.
- Paridad con al menos un rival: **~20** capacidades.
- Donde Shinobi sigue por detrás: messaging channels (4 vs 20-26), memory provider diversity (1 vs 8), marketplace ecosystem, dreaming pipeline.

---

## 6. BENCHMARK_M3.md — disclaimer reforzado

El benchmark publicado mostraba Shinobi 100% / Hermes 75% / OpenClaw 55%. **Eso es contra perfiles simulados**, NO contra runtimes reales. La suite (`src/benchmark/benchmark_runner.ts`) sí es reproducible; cualquier humano puede correrla contra los rivales y publicar números reales. Mientras eso no se haga, los porcentajes son ilustrativos del diseño de la suite, no medición competitiva.

---

## 7. Veredicto final corregido

**Mes 3 del plan intensivo: PASS con asterisco.**

Lo que sigue siendo cierto:
- 20 sprints entregados (5 M1 + 7 M2 + 8 M3).
- 627 tests vitest pasando, tsc clean, CI verde.
- 15/15 capacidades reclamadas existen como código real, no humo.
- 9 capacidades genuinamente exclusivas que ningún rival tiene.

Lo que el audit M3 original sobreestimó:
- "22 capacidades únicas" → realidad ~9 exclusivas + ~13 paridad. La diferencia es transparencia.
- "Shinobi único en signing SHA256 + audit cripto + redactor + backup + soul + A2A + STT local + VPS" → varios de esos son **paridad con Hermes**, no exclusivas.
- Las tablas comparativas del README también sobreestimaron en 8 filas.

Lo que rivales tienen y Shinobi no:
- Hermes: 8 memory providers, ~20 channels, benchmark suite real, sandbox 8 backends, LLM context compactor.
- OpenClaw: 26 channels, Dreaming/REM, ACP IDE-bridge, sandbox browser novnc, ClawHub marketplace.

**Estrategia honesta para mensajes públicos:** dejar de presentarse como "único en X" cuando Hermes lo tiene. Posicionar Shinobi como **el agente Windows-native con auditabilidad y reproducibilidad superiores** (audit log unificado JSONL, committee multi-modelo, rollback formal, memory reflector, benchmark suite). Esos diferenciadores se sostienen.

Las tablas de README y el documento M3 original quedan superseded por este revisado.
