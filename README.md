# Shinobi

An AI agent that runs on your Windows machine and executes real tasks
using natural language. Not a chatbot. Not a wrapper. An agent that
acts.

## What it does

Shinobi takes an instruction and executes it. It reads and writes files,
runs code, navigates real websites with your logged-in sessions, and
delegates complex work to sub-agents. When it fails a task, it generates
a new skill and retries.

Built and stress-tested in production. Not a demo.

## Core capabilities

**Browser automation**
Operates Comet/Chrome via CDP using your active sessions. Tested against
anti-bot systems (Fiverr, CoinGecko, YouTube, NotebookLM). No headless
detection issues — it uses your real browser.

**Code execution**
Runs Python, Node.js, PowerShell. Installs missing dependencies
automatically. Isolated venv per execution.

**Filesystem**
Read, write, edit, search across your machine. Understands project
structure via hierarchical repo analysis with parallel sub-agents.

**Persistent memory**
SQLite + vector embeddings. Context survives across sessions.

**Skills system**
When Shinobi fails a task it generates a new skill, validates it, and
adds it to its index. Three modes: reuse, enhance, generate.

**Committee**
Multi-model consensus for critical decisions. Deterministic verdicts via
majority voting with temperature=0. Code reviewer detects SQLi, XSS,
RCE with file:line citations.

**Resident missions**
Background tasks that run continuously. Triggered on schedule or event.

**n8n integration**
Delegates to external workflows via n8n bridge.

**Cloud bridge**
Offloads heavy missions to OpenGravity kernel when available.

## Requirements

- Windows 10/11
- Node.js 20+
- Comet or Chrome launched with `--remote-debugging-port=9222`
- At least one LLM API key (OpenAI, OpenRouter, or Groq)

## Quick start

```bash
git clone <repo> shinobibot && cd shinobibot
npm install
cp .env.example .env
# Add your API key, then:
npm run dev
```

Or run the prebuilt executable: `build/shinobi.exe`

## Environment

```env
# Pick at least one
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=

# Optional — cloud kernel
OPENGRAVITY_URL=http://localhost:9900
OPENGRAVITY_PATH=
SHINOBI_API_KEY=
```

## CLI reference

| Command | What it does |
|---------|-------------|
| `/mode [local\|kernel\|auto]` | Switch execution mode |
| `/model [name\|list]` | Change active LLM |
| `/memory recall <query>` | Search persistent memory |
| `/skill list` | Show available skills |
| `/resident start` | Start background mission |
| `/read <path>` | Analyze a codebase |
| `/committee` | Multi-model code audit |
| `/improvements` | Generate improvement proposals |
| `/apply <id>` | Apply a proposal |
| `/learn <url\|path>` | Learn a new tool or library |
| `/approval [on\|smart\|off]` | Human confirmation mode |
| `/ledger verify` | Verify mission audit chain |
| `/record start\|stop` | Record session with OBS |

## Verified in production

| Task | Result |
|------|--------|
| CoinGecko top 5 extraction | 16s, real data |
| YouTube transcript + comments | Verified |
| Anti-perimeter browsing (Fiverr) | Bypassed |
| DVWA security audit | SQLi/XSS/RCE detected with file:line |
| Repo analysis (kubernetes, react, langchain) | Sub-agent parallel reads |
| 500 concurrent missions | 100% success rate |
| 112 unit tests | 0 failures |

## Disclaimer

This agent executes real actions on your system — file writes, terminal
commands, browser automation. Use it under your own responsibility.
Human confirmation mode (`/approval smart`) is available if you want
Shinobi to ask before destructive actions.

## License

ISC