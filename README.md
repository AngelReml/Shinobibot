# Shinobi 忍

[![CI](https://github.com/AngelReml/Shinobibot/actions/workflows/ci.yml/badge.svg)](https://github.com/AngelReml/Shinobibot/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-180_passing-brightgreen)](./src)
[![License](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_10%2F11-0078D6)](https://www.microsoft.com/windows/)

Agente autónomo **Windows-nativo** que ejecuta tareas reales en tu máquina con
lenguaje natural. No es un chatbot. No es un wrapper. Es un agente que actúa,
con guardrails diseñados para que el LLM no entre en bucles destructivos.

> **English version below** ([→ jump to English](#english))

---

## 🇪🇸 Español

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
| Modular por bloques (no monolítico) | ❌ (`run_agent.py` 15k LOC) | ❌ (plugin SDK enorme) | n/a | ✅ |

Detalle técnico: ver [ARCHITECTURE.md](./ARCHITECTURE.md).

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
npm test            # vitest run (180 specs)
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
| Tests propios | 180 passing, CI en `windows-latest` |

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
npm test            # vitest (180 specs)
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
