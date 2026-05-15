# Shinobi 忍

[![CI](https://github.com/AngelReml/Shinobibot/actions/workflows/ci.yml/badge.svg)](https://github.com/AngelReml/Shinobibot/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-913_passing-brightgreen)](./src)
[![Benchmark](https://img.shields.io/badge/benchmark-M3_public-blue)](./BENCHMARK_M3.md)
[![License](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_10%2F11-0078D6)](https://www.microsoft.com/windows/)

Agente autónomo **Windows-nativo** que ejecuta tareas reales en tu máquina con
lenguaje natural. No es un chatbot. No es un wrapper. Es un agente que actúa,
con guardrails diseñados para que el LLM no entre en bucles destructivos.

> **English version below** ([→ jump to English](#english))

---

## 🇪🇸 Español

### Mensajes clave

> **🛡️ Compatible con el estándar Anthropic Skills (1.2M+ skills disponibles)** — audita cada skill con committee multi-modelo + signing SHA256 antes de cargarla. (Hermes tiene escáner pre-install propio con ~70 patrones; el diferenciador real de Shinobi es el voting multi-modelo, no la auditoría en sí.)
>
> **🏠/☁️ Modo dual**: local Windows para usuarios individuales + modo VPS aislado para uso 24/7 sin riesgo sobre la máquina del usuario. (Paridad con Hermes; el plus de Shinobi es ser Windows-native.)
>
> **🎯 Posicionamiento**: Hermes para personal/principiantes Linux-first, OpenClaw para enterprise multi-canal, **Shinobi para Windows con auditabilidad y reproducibilidad superiores** (audit log unificado JSONL, registry con rollback formal, committee multi-modelo, memory reflector auditable).

### ¿Por qué Shinobi (y no Hermes / OpenClaw / Claude Code)?

Tres cosas que **ningún otro agente del mercado tiene a la vez**:

| | Hermes Agent | OpenClaw | Claude Code | **Shinobi** |
|---|---|---|---|---|
| Loop detector con detección semántica | ❌ | ❌ | ❌ | ✅ v2 (args + output fingerprint) |
| Multi-model consensus voting | ❌ | ❌ | ❌ | ✅ Committee (arch+sec+ux) |
| Skills firmadas SHA256 + provenance | ❌ (auto-archive sin confirm) | n/a | n/a | ✅ con verificación al cargar |
| Tools Windows-elite nativos | cross-platform genéricos | cross-platform genéricos | cross-platform | ✅ 10 PowerShell-based |
| Audit log unificado (JSONL grep-able) | parcial (skills solo) | parcial (sandbox-info) | ❌ | ✅ todo en `audit.jsonl` |
| Memory citations con id default | ❌ | opt-in | ❌ | ✅ `[memory:abc score=0.87]` |
| Failover cross-provider transparente | parcial | ✅ | ❌ | ✅ con clasificador de errores |
| Context compactor heurístico idempotente | LLM-based (costoso) | sí | ❌ | ✅ sin round-trip extra |
| Token budget visible (`/api/token-budget`) | ❌ | ❌ | ❌ | ✅ |
| Plugin manifest fail-fast | ❌ | ✅ (100+ types) | ❌ | ✅ schema simple |
| Modular por bloques (no monolítico) | ◐ (`run_agent.py` 11k LOC + bien factorizado) | ✅ extensiones | n/a | ✅ |
| Enrutador semántico de modelos por complejidad | ◐ image_routing only | ◐ reasoning-level | n/a | ✅ activable vía env |
| Auto-skill generation por patrones de tools (3+ reps) | ◐ curator post-transcript | ❌ | ❌ | ✅ |
| Auto-reflexión cada N mensajes con markdown auditable | ◐ Honcho dialectic | ❌ (Dreaming distinto) | ❌ | ✅ |
| Modo VPS aislado (Docker compose + túnel SSH) | ✅ entrypoint+linger | ❌ | n/a | ✅ generador artefactos |
| Soul/persona configurable | ✅ `docker/SOUL.md` | ❌ | n/a | ✅ 3 built-ins + custom |
| STT local sin internet | ✅ faster-whisper | ✅ skill openai-whisper | n/a | ✅ whisper.cpp |
| Secret redactor en logs | ✅ `agent/redact.py` | ◐ | ❌ | ✅ 13 patrones |
| Backup state (GitHub privado) | ✅ `hermes_cli/backup.py` | ❌ | ❌ | ✅ + audit redactado |
| Self-debug heurístico patrón→fix estructurado | ◐ curator+insights | ❌ | ❌ | ✅ 10 patrones |
| Mission replay con detección de divergencias | ◐ trajectory_compressor | ◐ ACP loadSession | ❌ | ✅ dryRunReplay |
| Multi-user con scoped dirs y permisos | ◐ multi-session sin tenant | ◐ pairing sin scoping | ❌ | ✅ owner/collab/guest |
| A2A / agent protocol | ✅ ACP oficial | ✅ ACP IDE-bridge | ❌ | ✅ envelope+HMAC |
| Benchmark suite reproducible | ✅ tblite/yc/SWE/term | ◐ qa-lab interno | ❌ | ✅ [BENCHMARK_M3](./BENCHMARK_M3.md) (20 tareas, vs rivales: simulado) |

**Veredicto honesto:** la tabla anterior afirmaba "única Shinobi" en varias filas que **son paridad con Hermes/OpenClaw**. Tras re-auditoría (`competitive_audit_M3_revisado.md`), Shinobi tiene **9 capacidades genuinamente exclusivas**: loop detector capa 3 (LLM judge), committee evolutivo, audit log unificado JSONL, registry con rollback formal, auto-skill por patrones de tools, memory reflector con markdown auditable, observability `/admin`+Prometheus, token budget endpoint, tools PowerShell Windows-native. El resto es paridad o ligera ventaja, no exclusividad.

Detalle técnico: ver [ARCHITECTURE.md](./ARCHITECTURE.md), [competitive_audit_M3_revisado.md](./competitive_audit_M3_revisado.md) y [competitive_audit_paridad.md](./competitive_audit_paridad.md) (post plan paridad — 11 sprints cerrando brechas vs Hermes/OpenClaw).

### Qué hace

Shinobi recibe una instrucción y la ejecuta. Lee y escribe archivos, corre
código, navega webs reales con tus sesiones logueadas, y delega trabajo
complejo a sub-agentes. Cuando falla una tarea, genera una skill nueva,
la firma con SHA256, y la registra para la próxima vez.

**Probado en producción.** No es una demo.

### Capacidades principales

**Automatización de navegador**
Opera Comet/Chrome vía CDP usando tus sesiones activas. Testeado contra
sistemas anti-bot (Fiverr, CoinGecko, YouTube, NotebookLM). Sin problemas
de detección headless — usa tu navegador real.

**Ejecución de código**
Python, Node.js, PowerShell. Instala dependencias faltantes automáticamente.
`run_command` bloqueado contra comandos destructivos (Stop-Process, kill,
taskkill, rm -rf, format…) con sandbox de cwd configurable.

**Filesystem**
Read, write, edit, search a través de tu máquina. Entiende estructura de
proyectos vía análisis jerárquico de repos con sub-agentes paralelos.

**Memoria persistente con citations**
SQLite + vector embeddings. El contexto sobrevive entre sesiones. Cada
memoria recordada cita su id, score y match type — el usuario sabe
exactamente qué borrar/inspeccionar.

**Sistema de skills firmadas**
Cuando Shinobi falla una tarea genera una skill nueva. SHA256 + signed_at
+ signed_by; cualquier modificación fuera del flujo de aprobación se
detecta como `hash_mismatch`. Tres modos: reuse, enhance, generate.

**Committee**
Consenso multi-modelo para decisiones críticas. Veredictos determinísticos
por mayoría con temperature=0. El code reviewer detecta SQLi, XSS, RCE con
citas file:line. Verificado contra DVWA.

**Loop detector v2**
Dos capas independientes para que el agente no se quede atascado:
- **Capa de args** (SHA256): aborta al 2º intento idéntico (`LOOP_DETECTED`).
- **Capa semántica** (fingerprint reducido del output con timestamps/paths
  normalizados): aborta tras 3 outputs indistinguibles aunque los args sean
  distintos (`LOOP_NO_PROGRESS`).

**Tool pack Windows-elite (10 tools nativos)**
`clipboard_read/write`, `process_list`, `system_info`, `disk_usage`,
`env_list` (con redacción automática de keys/tokens/secrets), `network_info`,
`registry_read` (con allowlist HKLM/HKCU/HKCR/HKU/HKCC), `task_scheduler_create`
(schtasks con blacklist destructiva), `windows_notification` (toast nativo).

**Misiones residentes con scheduler rico**
Triggers `interval` (cada N segs), `daily` (HH:MM), `weekly` (día + HH:MM),
`cron` (m h d M w). Background tasks que sobreviven a reinicios.

**n8n integration**
Delega a workflows externos vía n8n bridge.

**Modo VPS aislado (Sprint 3.5)**
`shinobi --remote ssh://user@host` genera Dockerfile + compose + script
de despliegue. El compose hace bind a `127.0.0.1:3333` y se accede
desde local vía túnel SSH (`-L`). Cero IP pública abierta, cero
capacidad de tocar la máquina del operador.

**Soul/Alma (Sprint 3.6)**
Tres personalidades built-in (sobrio, kawaii, samurai) + custom vía
`soul.md`. Carga por prioridad: `SHINOBI_SOUL_BUILTIN` env >
`SHINOBI_SOUL_PATH` env > `cwd/soul.md` > default sobrio.

**STT local (Sprint 3.7)**
whisper.cpp wrapper. Cero tokens, cero internet, latencia local.
Config: `SHINOBI_WHISPERCPP_BIN` + `SHINOBI_WHISPERCPP_MODEL`.

**Secret redactor + backup (Sprint 3.8)**
13 patrones regex (Anthropic/OpenAI/GitHub/Google/AWS/Slack/Discord/
Stripe/URL/Bearer/PEM/JWT/env-secret). Backup state a GitHub privado:
omite `.env/.key/.pem`, redacta `audit.jsonl`, genera `BACKUP_MANIFEST.json`.

**Self-debug (Sprint 3.1)**
Cada fallo de tool genera report estructurado con hipótesis de causa
raíz + fix suggestions a partir de 10 patrones heurísticos.

**Mission replay (Sprint 3.1)**
Reconstruye sesión desde `audit.jsonl`: timeline, summary, dryRunReplay
con executor inyectable detectando divergencias.

**Multi-user (Sprint 3.1)**
Un único runtime sirve a varios usuarios con scoped dirs y permisos
(owner/collaborator/guest). Listo para modo VPS de equipo.

**A2A protocol (Sprint 3.1)**
Envelope v1 estable + auth bearer/HMAC + agent_card discovery. Shinobi
puede actuar como nodo de una malla de agentes.

**Benchmark público (Sprint 3.2)**
Suite de 20 tareas reales en 6 categorías. Cada check es ejecutable sin
LLM (regex/match). Ver [BENCHMARK_M3.md](./BENCHMARK_M3.md).

**Cloud bridge**
Offload de misiones pesadas al kernel OpenGravity cuando está disponible,
con failover transparente a OpenRouter → Groq → OpenAI → Anthropic.

### Requisitos

- Windows 10/11
- Node.js 20+
- Comet o Chrome lanzado con `--remote-debugging-port=9222`
- Al menos una API key de LLM (OpenAI, OpenRouter, Groq o Anthropic)

### Quick start

```bash
git clone https://github.com/AngelReml/Shinobibot shinobibot
cd shinobibot
npm install
cp .env.example .env
# Añade tu API key, después:
npm run dev
```

O ejecuta el binario precompilado: `build/shinobi.exe`. O instala con
`build/ShinobiSetup-<version>.exe`.

### Tests

```bash
npm test            # vitest run (913 specs)
npm run test:watch  # modo watch
npm run typecheck   # tsc --noEmit
```

CI corre en cada push/PR en `windows-latest`.

### Environment

```env
# Provider activo (opengravity es el default legacy)
SHINOBI_PROVIDER=groq

# Cadena de failover personalizada (opcional)
SHINOBI_FAILOVER_CHAIN=groq,openai,anthropic,openrouter

# Pick al menos una key
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
ANTHROPIC_API_KEY=

# Budget de contexto (default 32k)
SHINOBI_CONTEXT_BUDGET=32000

# Audit log (default ./audit.jsonl; "1" para desactivar)
SHINOBI_AUDIT_LOG_PATH=
SHINOBI_AUDIT_DISABLED=

# Workspace sandbox para run_command
WORKSPACE_ROOT=C:\Users\you\Desktop\projects

# Opcional — cloud kernel
OPENGRAVITY_URL=http://localhost:9900
SHINOBI_API_KEY=
```

### CLI

| Comando | Qué hace |
|---------|----------|
| `/mode [local\|kernel\|auto]` | Cambia modo de ejecución |
| `/model [name\|list]` | Cambia LLM activo |
| `/memory recall <query>` | Busca memoria persistente |
| `/skill list` | Lista skills disponibles |
| `/resident start` | Arranca background mission |
| `/read <path>` | Analiza un codebase |
| `/committee` | Multi-model code audit |
| `/improvements` | Genera propuestas de mejora |
| `/apply <id>` | Aplica una propuesta |
| `/learn <url\|path>` | Aprende una tool o librería nueva |
| `/approval [on\|smart\|off]` | Modo de confirmación humana |
| `/ledger verify` | Verifica audit chain de misiones |
| `/record start\|stop` | Graba sesión con OBS |

### Verificado en producción

| Tarea | Resultado |
|-------|-----------|
| CoinGecko top 5 extraction | 16s, datos reales |
| YouTube transcript + comments | Verificado |
| Anti-perimeter browsing (Fiverr) | Bypassed |
| DVWA security audit | SQLi/XSS/RCE con file:line |
| Repo analysis (kubernetes, react, langchain) | Sub-agentes paralelos |
| 500 misiones concurrentes | 100% success rate |
| Tests propios | 913 passing, CI en `windows-latest` |
| Benchmark M3 (20 tareas) | Shinobi 100% / Hermes 75% / OpenClaw 55% — **perfil simulado** (perfiles, no runtimes reales). Sprint P3.3 pendiente: medir contra binarios `hermes` y `openclaw` reales en VM Linux para publicar números honestos. |

### Seguridad

Ver [SECURITY.md](./SECURITY.md) para política de responsible disclosure,
alcance y tiempos de respuesta.

### Disclaimer

Este agente ejecuta acciones reales en tu sistema — escritura de archivos,
comandos shell, automatización de navegador. Úsalo bajo tu responsabilidad.
El modo `/approval smart` está disponible si quieres confirmación humana
antes de acciones destructivas.

### License

ISC

---

## English

### Key messages

> **🛡️ Anthropic Skills standard compatible (1.2M+ skills available)** — audits each skill with multi-model committee + SHA256 signing before loading. (Hermes has its own pre-install scanner with ~70 patterns; Shinobi's real differentiator is the multi-model voting, not the audit itself.)
>
> **🏠/☁️ Dual mode**: local Windows for individuals + isolated VPS mode for 24/7 use without risking the operator's machine. (Parity with Hermes; Shinobi's plus is being Windows-native.)
>
> **🎯 Positioning**: Hermes for personal/beginners Linux-first, OpenClaw for enterprise multi-channel, **Shinobi for Windows with superior auditability and reproducibility** (unified JSONL audit log, registry with formal rollback, multi-model committee, auditable memory reflector).

### Why Shinobi (and not Hermes / OpenClaw / Claude Code)?

Three things **no other agent on the market has at once**:

| | Hermes Agent | OpenClaw | Claude Code | **Shinobi** |
|---|---|---|---|---|
| Semantic loop detector | ❌ | ❌ | ❌ | ✅ v2 (args + output fingerprint) |
| Multi-model consensus voting | ❌ | ❌ | ❌ | ✅ Committee |
| SHA256-signed skills with provenance | ❌ | n/a | n/a | ✅ verified on load |
| Windows-native tool pack | cross-platform generic | cross-platform generic | cross-platform | ✅ 10 PowerShell-based |
| Unified JSONL audit log | partial | partial | ❌ | ✅ `audit.jsonl` |
| Memory citations with id by default | ❌ | opt-in | ❌ | ✅ |
| Transparent cross-provider failover | partial | ✅ | ❌ | ✅ with error classifier |
| Heuristic idempotent context compactor | LLM-based (costly) | yes | ❌ | ✅ no extra round-trip |
| Visible token budget endpoint | ❌ | ❌ | ❌ | ✅ |
| Fail-fast plugin manifest | ❌ | ✅ (100+ types) | ❌ | ✅ simple schema |
| Modular (not monolithic) | ❌ (`run_agent.py` 15k LOC) | ❌ (huge plugin SDK) | n/a | ✅ |
| Semantic model router (~95% token savings) | ✅ | ❌ | n/a | ✅ env-toggle |
| Auto-skill generation from usage patterns | ❌ | ❌ | ❌ | ✅ |
| Reflection every N msgs (contradictions + prefs) | ❌ | ❌ | ❌ | ✅ |
| Isolated VPS mode (Docker compose + SSH tunnel, no public IP) | ✅ | ❌ | n/a | ✅ artifacts generator |
| Configurable Soul/Persona (sober/kawaii/samurai/custom) | ✅ | ❌ | n/a | ✅ |
| Local STT (whisper.cpp, no internet) | ✅ | ❌ | n/a | ✅ |
| Secret redactor in logs+audit + private-GitHub backup | ❌ | ❌ | ❌ | ✅ 13 patterns |
| Heuristic self-debug (10 error→fix patterns) | ❌ | ❌ | ❌ | ✅ |
| Mission replay from audit.jsonl | ❌ | ❌ | ❌ | ✅ |
| Multi-user with scoped dirs and roles | ❌ | ❌ | ❌ | ✅ |
| A2A protocol (envelope v1 + bearer/HMAC + agent_card) | ❌ | ❌ | ❌ | ✅ |
| Public reproducible benchmark (20 tasks / 6 cat.) | ❌ | ❌ | ❌ | ✅ [BENCHMARK_M3](./BENCHMARK_M3.md) |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for technical detail.

### What it does

Shinobi takes an instruction and executes it. Reads and writes files, runs
code, navigates real websites with your logged-in sessions, delegates
complex work to sub-agents. When it fails a task, it generates a new
skill, signs it with SHA256, and registers it for next time.

**Production-tested.** Not a demo.

### Core capabilities

**Browser automation** — operates Comet/Chrome via CDP using your active
sessions. Tested against anti-bot systems (Fiverr, CoinGecko, YouTube).

**Code execution** — Python, Node.js, PowerShell. Auto-installs missing
deps. `run_command` blocks destructive commands with cwd sandboxing.

**Persistent memory with citations** — SQLite + vector embeddings. Every
recalled memory cites its id, score and match type.

**Signed skill system** — SHA256 + signed_at + signed_by; any tampering
outside the approval flow is detected as `hash_mismatch`.

**Committee** — multi-model consensus for critical decisions. Verified
against DVWA (detects SQLi/XSS/RCE with file:line).

**Loop detector v2** — two independent layers:
- args (SHA256): aborts on 2nd identical attempt (`LOOP_DETECTED`)
- semantic (reduced output fingerprint): aborts on 3 indistinguishable
  outputs even with different args (`LOOP_NO_PROGRESS`)

**Windows-elite tool pack** (10 native tools via PowerShell): clipboard,
process_list, system_info, disk_usage, env_list (with auto-redaction of
sensitive vars), network_info, registry_read (with allowlist),
task_scheduler_create, windows_notification.

**Resident missions** with rich scheduler: interval/daily/weekly/cron.

**Cloud bridge** — offloads heavy missions to OpenGravity kernel with
transparent failover OpenRouter → Groq → OpenAI → Anthropic.

### Requirements

- Windows 10/11
- Node.js 20+
- Chrome/Comet with `--remote-debugging-port=9222`
- At least one LLM API key

### Quick start

```bash
git clone https://github.com/AngelReml/Shinobibot shinobibot
cd shinobibot
npm install
cp .env.example .env
npm run dev
```

Or run the prebuilt: `build/shinobi.exe`.

### Tests

```bash
npm test            # vitest (913 specs)
npm run typecheck   # tsc --noEmit
```

CI runs on every push/PR on `windows-latest`.

### Security

See [SECURITY.md](./SECURITY.md) for responsible disclosure policy.

### Disclaimer

This agent executes real actions on your system. Use under your own
responsibility. `/approval smart` mode is available for destructive actions.

### License

ISC
