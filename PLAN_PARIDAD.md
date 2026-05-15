# Plan de paridad — Shinobi vs Hermes / OpenClaw

Fecha: 2026-05-15. Basado en `competitive_audit_M3_revisado.md` (HEAD `760551e`).

Objetivo: cerrar las brechas reales identificadas en la re-auditoría sin perder los 9 diferenciadores genuinos que ya tiene Shinobi (loop detector capa 3, committee evolutivo, audit log unificado, registry con rollback, auto-skill por patrones, memory reflector, observability `/admin`, token budget endpoint, tools PowerShell).

El plan está priorizado por **impacto × frecuencia de uso**, no por dificultad. Las brechas que afectan a la mayoría de usuarios van primero.

---

## Resumen ejecutivo

| Tier | Sprints | Esfuerzo total | Cierra brecha de |
|---|---|---|---|
| Tier 1 (alto impacto) | 5 sprints | ~3 semanas | Mensajería, memoria, sandbox, marketplace, ACP |
| Tier 2 (mediano impacto) | 4 sprints | ~2 semanas | Compactor, audit patterns, failover, dreaming |
| Tier 3 (pulido) | 3 sprints | ~1 semana | IDE bridge, persona, benchmark real |

**Total estimado:** 12 sprints, ~6 semanas. Mantiene la cadencia del plan intensivo previo (5-8 sprints/mes).

---

## Tier 1 — Brechas grandes (semanas 1-3)

### Sprint P1.1 — Multi-canal expansion (4 → 15+ canales)

**Brecha:** Shinobi tiene 4 channel adapters; Hermes ~20; OpenClaw ~26.

**Objetivo:** sumar al menos 10 channel adapters nuevos manteniendo el patrón opt-in (dynamic import indirecto para que `tsc` no resuelva deps no instaladas).

**Canales a añadir, en orden de demanda:**
1. WhatsApp (Baileys o whatsapp-web.js)
2. Signal (signal-cli wrapper)
3. Matrix (matrix-bot-sdk)
4. Mattermost (mattermost-client)
5. Microsoft Teams (botbuilder-adapter-teams)
6. Webhook genérico HTTP (entrante y saliente)
7. SMS (Twilio adapter)
8. IRC (irc-framework)
9. XMPP (@xmpp/client)
10. Webex (webex)
11. Bluebubbles (iMessage bridge) — opcional, requiere Mac

**Paths:**
- `src/channels/adapters/whatsapp_adapter.ts`
- `src/channels/adapters/signal_adapter.ts`
- ...
- `src/channels/__tests__/<adapter>.test.ts` por cada uno

**Criterios de éxito:**
- 10+ adapters nuevos exportando `ChannelAdapter` standard interface
- Cada adapter con test unitario mockeado (sin tocar red real)
- Dynamic import indirecto para evitar errores `tsc` si la dep no está instalada
- Documentación en `README.md` con la matriz de canales

**Complejidad:** L (cada canal son ~2-4 horas, total 25-40h).

**Tests:** +30 vitest (3 por adapter).

---

### Sprint P1.2 — Memory provider plugin system

**Brecha:** Hermes tiene 8 memory providers (Hindsight, Holographic, Honcho, Mem0, Supermemory, RetainDB, OpenViking, Byterover). Shinobi tiene 1 backend principal (`memory_store` con embeddings reales pero monolítico).

**Objetivo:** refactorizar `memory_store` para que sea pluggable + añadir 3 providers alternativos.

**Diseño:**
- Definir `MemoryProvider` interface: `store(msg)`, `recall(query, k)`, `forget(id)`, `consolidate()`, `metrics()`.
- Extraer el SQLite+vec actual a `LocalSqliteMemoryProvider`.
- Añadir:
  - `Mem0Provider` (cliente HTTP a mem0.ai)
  - `SupermemoryProvider` (cliente supermemory.ai)
  - `InMemoryProvider` (para tests)
- Registry `MemoryProviderRegistry` con selección vía env `SHINOBI_MEMORY_PROVIDER`.

**Paths:**
- `src/memory/providers/types.ts` (interface)
- `src/memory/providers/local_sqlite.ts`
- `src/memory/providers/mem0.ts`
- `src/memory/providers/supermemory.ts`
- `src/memory/providers/in_memory.ts`
- `src/memory/provider_registry.ts`
- `src/memory/__tests__/providers/*.test.ts`

**Criterios de éxito:**
- 4 providers funcionales bajo interfaz común
- `memory_store` legacy sigue funcionando (back-compat)
- Tests por provider con mocks de HTTP
- `/admin/memory` endpoint que muestra provider activo + métricas

**Complejidad:** M (3-5 días).

**Tests:** +25 vitest.

---

### Sprint P1.3 — Sandbox browser pre-baked (paridad OpenClaw)

**Brecha:** OpenClaw tiene `Dockerfile.sandbox-browser` con chromium + novnc pre-instalados — operador puede VER el browser del sandbox en su navegador. Shinobi usa Comet/Chrome del operador via CDP, lo cual es elegante pero NO es sandbox real para misiones VPS.

**Objetivo:** añadir backend `browser-sandbox` que arranca container con chromium headed + novnc en `:6080`, accesible desde el WebChat.

**Paths:**
- `Dockerfile.sandbox-browser` (nuevo, paralelo al existente)
- `src/sandbox/backends/browser_sandbox.ts`
- `src/web/components/SandboxViewer.tsx` (iframe novnc)
- `scripts/sandbox/build_browser_sandbox.sh`

**Criterios de éxito:**
- `docker-compose.sandbox.yml` levanta chromium + novnc en `127.0.0.1:6080`
- Misión "abre google.com y haz screenshot" funciona en sandbox sin tocar el navegador del operador
- WebChat tiene tab "Sandbox view" con iframe del novnc
- Tests de smoke con mock de Docker

**Complejidad:** L (4-6 días, mucho de Docker tuning).

**Tests:** +8 vitest (mock Docker spawn) + funcional E2E manual.

---

### Sprint P1.4 — Adoptar ACP estándar para A2A

**Brecha:** Shinobi tiene su propio envelope v1; Hermes y OpenClaw usan **Agent Client Protocol (ACP)** oficial. Como cliente externo es más fácil integrar ACP que el envelope custom.

**Objetivo:** que Shinobi exponga ENDPOINT compatible con ACP además del envelope propio. Dos protocolos coexisten.

**Paths:**
- `src/a2a/acp_adapter.ts` (traduce ACP ↔ envelope interno)
- `src/a2a/__tests__/acp_adapter.test.ts`
- `src/web/routes/acp.ts` (endpoints `/acp/agents`, `/acp/sessions`, etc.)
- `acp_registry/agent.json` en raíz del repo (igual que Hermes)

**Criterios de éxito:**
- Cliente Zed o cliente ACP cualquiera puede conectar a Shinobi y ejecutar tools
- Envelope propio de Shinobi sigue funcionando
- `agent.json` describe correctamente capabilities
- Tests con cliente ACP mockeado

**Complejidad:** M (3-4 días).

**Tests:** +15 vitest.

**Dependencias:** ninguna; complementa Sprint 3.1.

---

### Sprint P1.5 — Skill marketplace público

**Brecha:** OpenClaw tiene **ClawHub** real con publish/install/update pipeline. Hermes tiene **agentskills.io + GitHub + skills.sh + ClawHub source**. Shinobi tiene registry local + GitHub source pero NO un marketplace público activo.

**Objetivo:** publicar registry público y pipeline `shinobi skill publish`.

**Opciones:**
- **Opción A — Federar agentskills.io / ClawHub:** Shinobi consume ambos (ya lo hace parcialmente). Bajo esfuerzo, alto valor inmediato.
- **Opción B — Registry propio shinobi-skills.dev:** Shinobi publica al suyo. Alto esfuerzo, control total.

**Recomendación:** A primero (cierre rápido), B en Tier 3 si hay tracción.

**Paths (Opción A):**
- `src/skills/sources/agentskills_io.ts` (existe o ampliar)
- `src/skills/sources/clawhub.ts` (nuevo)
- `src/skills/publish.ts` (CLI `shinobi skill publish` que sube a fork GitHub)
- `docs/SKILL_PUBLISHING.md`

**Criterios de éxito:**
- `shinobi skill install <name>` busca en orden: local → agentskills.io → ClawHub → GitHub source
- `shinobi skill publish ./mi-skill` empaqueta + firma SHA256 + sube via gh CLI
- Tests con HTTP mocks de los 3 fuentes
- Manifest URL público con auditoría cripto pre-install (diferenciador Shinobi)

**Complejidad:** M (4-5 días).

**Tests:** +20 vitest.

---

## Tier 2 — Brechas medianas (semanas 4-5)

### Sprint P2.1 — Context compactor LLM-based opcional

**Brecha:** Hermes tiene `agent/context_compressor.py` con LLM-based summarization (más caro pero más fiel semánticamente). Shinobi tiene heurístico `chars/4` (más barato y predecible, pero pierde información).

**Objetivo:** modo dual — heurístico por default (mantiene predecibilidad), LLM opt-in cuando el contexto es crítico.

**Paths:**
- `src/context/llm_compactor.ts`
- `src/context/__tests__/llm_compactor.test.ts`
- Env: `SHINOBI_COMPACTOR_MODE=heuristic|llm|auto` (auto = LLM si tokens > 80% budget)

**Criterios de éxito:**
- LLM compactor usa el provider router con role `compactor`
- Tests miden tokens preservados antes vs después
- Default OFF para no romper UX existente

**Complejidad:** M (2-3 días).

**Tests:** +12 vitest.

---

### Sprint P2.2 — Skill audit pattern expansion (11+9 → 50+)

**Brecha:** Hermes `skills_guard.py` tiene ~70 patrones regex en 6 categorías. Shinobi `skill_auditor.ts` tiene 11 critical + 9 warning.

**Objetivo:** subir a 50+ patrones manteniendo la política multi-modelo committee (diferenciador Shinobi).

**Categorías a cubrir (de Hermes):**
1. Exfil (read /etc/passwd, AWS metadata IP, .ssh/, .aws/, etc.)
2. Injection (eval/exec/spawn con args concatenados)
3. Destructive (rm -rf /, format, mkfs, dd if=/dev/zero)
4. Persistence (cron, systemd, scheduled tasks, RunOnce reg keys)
5. Network egress sospechoso (curl ips raras, base64-encoded URLs)
6. Obfuscation (decode chains, multi-eval, char-coded strings)

**Paths:**
- `src/skills/auditor/patterns/<category>.ts` (uno por categoría)
- `src/skills/__tests__/skill_auditor_extended.test.ts`

**Criterios de éxito:**
- 50+ patrones documentados con CWE-like IDs
- Cada patrón con test positivo + test negativo (false positive)
- Política trust-aware: builtin → allow, community → block, custom → committee vote
- Audit run contra 10 skills reales (Anthropic Skills Hub samples)

**Complejidad:** M (3-4 días).

**Tests:** +50 vitest (1 por patrón par positivo+negativo).

---

### Sprint P2.3 — Failover con auth-profile cooldown

**Brecha:** OpenClaw `auth-profiles/` rota credenciales con cooldown probe automático (no reintentar contra una API key que está rate-limiteada por 5 min).

**Objetivo:** ampliar `failover_policy.ts` actual con cooldown por (provider, auth-profile) y probe automático.

**Paths:**
- `src/coordinator/failover_cooldown.ts`
- `src/coordinator/__tests__/failover_cooldown.test.ts`

**Criterios de éxito:**
- Si una key da 429, se marca en cooldown N segundos
- Probe automático cada cooldown/3 reintenta una request liviana
- Métricas en `/admin/metrics`
- Sin romper failover existente

**Complejidad:** S (2 días).

**Tests:** +10 vitest.

---

### Sprint P2.4 — Dreaming / Active Memory pipeline

**Brecha:** OpenClaw tiene Dreaming engine (REM grounded + dayBucket + UI diary) que consolida la memoria entre sesiones. Shinobi tiene memory reflector cada N mensajes pero NO pipeline cíclico de consolidación.

**Objetivo:** añadir `dreaming_engine.ts` que cada N horas (o on-idle) ejecuta:
1. Lee la memoria del día (bucket por fecha).
2. Identifica entidades + relaciones nuevas vs anteriores.
3. Consolida en knowledge graph.
4. Produce `dreams/<date>.md` legible por humano.

**Paths:**
- `src/memory/dreaming/dreaming_engine.ts`
- `src/memory/dreaming/day_bucket.ts`
- `src/memory/dreaming/entity_resolver.ts`
- `src/memory/dreaming/__tests__/*.test.ts`
- `src/web/routes/dreams.ts` (`/api/dreams/<date>`)

**Criterios de éxito:**
- Tras 1 día de uso, `dreams/2026-05-16.md` resume entidades + decisiones + cambios de preferencia
- No bloquea el agente (corre como background mission)
- Tests con fixtures de memoria sintética
- Endpoint `/admin/dreams` lista días disponibles

**Complejidad:** L (5-7 días).

**Tests:** +25 vitest.

**Dependencia:** Sprint P1.2 (memory provider system) ayuda pero no es bloqueante.

---

## Tier 3 — Pulido (semana 6)

### Sprint P3.1 — IDE-protocol bridge (Zed-compatible)

**Brecha:** OpenClaw tiene `extensions/acpx/` con bridge Zed-compatible. Útil para que desarrolladores en Zed/Cursor usen Shinobi como agent.

**Objetivo:** bridge Shinobi ↔ Zed via ACP IDE-bridge protocol.

**Paths:**
- `src/a2a/zed_bridge.ts` (extiende Sprint P1.4)
- Docs `docs/INTEGRATIONS/ZED.md`

**Complejidad:** S (1-2 días si P1.4 está hecho).

**Tests:** +8 vitest.

---

### Sprint P3.2 — Persona library expandida

**Brecha:** Hermes seeding rico de personas (no solo `docker/SOUL.md` sino library). Shinobi tiene 3 built-ins.

**Objetivo:** subir a 10+ built-ins, todos con tests de output diferenciable.

**Paths:**
- `src/soul/builtins/{ronin,monje,kunoichi,oyabun,kohai,sensei,kappa}.ts`
- Tests: mismo prompt → output distinguible por persona

**Complejidad:** S (1-2 días, mucho prompt tuning).

**Tests:** +15 vitest.

---

### Sprint P3.3 — Benchmark real contra runtimes rivales

**Brecha:** El BENCHMARK_M3.md actual usa **perfiles simulados** de Hermes/OpenClaw. Para tener autoridad, hay que correrlo contra los binarios reales.

**Objetivo:** ejecutar la suite contra Hermes (Python CLI) y OpenClaw (Node CLI) reales, publicar números honestos.

**Pasos (humano + Shinobi):**
1. Instalar Hermes (`pip install hermes-agent`) y OpenClaw (`npm i -g openclaw`) en una VM Linux.
2. Crear `HermesRealAdapter` y `OpenClawRealAdapter` que spawneen los CLIs y parseen output.
3. Correr la suite, exportar CSV.
4. Publicar `BENCHMARK_M3_REAL.md` con números **reales** (no simulados).
5. Si Shinobi pierde en alguna categoría, decirlo SIN maquillar.

**Paths:**
- `src/benchmark/adapters/hermes_real.ts`
- `src/benchmark/adapters/openclaw_real.ts`
- `scripts/sprintP3_3/run_real_benchmark.ts`

**Complejidad:** M (2-3 días + setup VM).

**Tests:** +10 vitest (mock CLI output).

**Importante:** este es el sprint más estratégicamente importante. Hasta que se haga, cualquier marketing de "Shinobi gana al benchmark" es deshonesto.

---

## Roadmap visual

```
Semana 1  |█████| P1.1 multi-canal           |  P1.4 ACP
Semana 2  |█████| P1.1 multi-canal           |  P1.2 memory providers
Semana 3  |█████| P1.3 sandbox browser       |  P1.5 marketplace
─────────────────────────────────────────────────────────────
Semana 4  |█████| P2.2 audit patterns        |  P2.3 cooldown
Semana 5  |█████| P2.1 LLM compactor         |  P2.4 dreaming
─────────────────────────────────────────────────────────────
Semana 6  |█████| P3.1 IDE bridge | P3.2 personas | P3.3 benchmark real
```

---

## Métricas de cierre del plan

Al final del plan, Shinobi debería poder presentar:

| Métrica | Antes (HEAD `760551e`) | Después (objetivo) |
|---|---|---|
| Channel adapters | 4 | 15+ |
| Memory providers | 1 | 4 |
| Sandbox backends | 7 | 8 (con browser novnc) |
| Skill audit patterns | 11+9 = 20 | 50+ |
| A2A protocols soportados | 1 (propio) | 2 (propio + ACP) |
| Skill marketplaces consumidos | 1 (local + GitHub) | 3 (+ agentskills.io + ClawHub) |
| Built-in personas | 3 | 10+ |
| Benchmark vs rivales reales | simulado | **real** publicado |
| Capacidades exclusivas Shinobi | 9 | 9 (mantenidas) |
| Capacidades paridad con rivales | ~20 | ~30 |
| Tests vitest | 627 | ~825+ |

**Posicionamiento corregido tras el plan:**
"Shinobi es **paridad funcional con Hermes/OpenClaw** + **superior en 9 dimensiones de auditabilidad y reproducibilidad** + **único Windows-native PowerShell-first**."

Sin overclaims. Verificable.

---

## Reglas operativas (heredadas del plan intensivo previo)

1. Cada sprint cierra con: vitest verde + tsc clean + commit + push + funcional test.
2. Sin maquillar resultados al cierre de cada Tier.
3. Nada de matar procesos del sistema, cambiar modelo bajo medición sin notificar, saltarse instrucciones humanas.
4. Si una capacidad nueva requiere decisión humana (alta cuenta marketplace, deploy a producción, dinero externo), para y pregunta.
5. Re-auditoría al cierre de los 3 Tiers con `competitive_audit_paridad.md` + comparación contra Hermes/OpenClaw actualizados.

---

## Próximo paso

Confirmar con el operador:
- ¿Arrancar Tier 1 directo (5 sprints, ~3 semanas) o priorizar uno solo del Tier 1?
- ¿Opción A o B para Sprint P1.5 (marketplace)?
- ¿VM Linux disponible para Sprint P3.3 (benchmark real)?
