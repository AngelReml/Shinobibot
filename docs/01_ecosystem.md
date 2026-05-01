# Ecosistema Shinobi — Arquitectura real

## Tres directorios físicos

### `C:\Users\angel\Desktop\shinobibot\` — el CLI
- Punto de entrada: `shinobi` en cualquier CMD (binario global)
- Tecnología: TypeScript + tsx + Playwright + OpenAI gpt-4o
- Comunicación: HTTP a localhost:9900 hacia OpenGravity
- Tools registradas hoy: `read_file`, `write_file`, `edit_file`, `run_command`, `list_dir`, `search_files`, `web_search`, `kernel_swarm_mission`, `browser_click`
- Memoria persistente: `memory.json` en raíz del repo
- LLM principal: gpt-4o vía OpenAI directo
- Modos: `local`, `kernel`, `auto` (`/mode <X>` en el CLI)

### `C:\Users\angel\Desktop\OpenGravity\` — el cerebro
- Punto de entrada principal: `npx tsx START_kernel.ts` (kernel HTTP solo)
- Punto de entrada completo: `npx tsx src/index.ts` (kernel + dashboard + scheduler + watchdog)
- Puerto kernel: 9900
- Puerto dashboard: 18789
- DB: SQLite (~43MB), tablas `missions`, `strategies`, `pending_actions`, `execution_traces`, `agent_patterns`...
- Subsistemas vivos confirmados: `kernel/`, `dashboard/`, `mcp/`, `tools/`, `services/`, `experimental/`, `observability/`, `scheduler/`, `agents/`, `swarm/`, `runtime/`, `system/`, `llm/`
- LLM Provider Hub: failover entre Groq / OpenRouter / OpenAI / Ollama

### `C:\Users\angel\Desktop\Shinobi_Nexus\` — empaquetado para distribución
- Copia de los anteriores + start.bat
- **NO TOCAR** durante desarrollo

## Comet (navegador)

- Ruta actual del binario (post-reinstalación per-machine): `C:\Program Files\Perplexity\Comet\Application\comet.exe`
- Comando para arrancar con CDP: `"C:\Program Files\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222 --no-first-run --no-default-browser-check`
- CDP en puerto 9222
- Shinobi se conecta vía `chromium.connectOverCDP('http://localhost:9222')`
- Sesiones del usuario (LinkedIn, Fiverr, etc.) se reusan: Shinobi opera con la sesión activa

## Flujo operativo correcto (validado)

1. Arrancar Comet con CDP en 9222 (manualmente, comando arriba)
2. Loguear cuentas relevantes en Comet (LinkedIn, Fiverr, Upwork, YouTube, Google/NotebookLM...)
3. Arrancar OpenGravity: `npx tsx START_kernel.ts` desde la carpeta de OpenGravity
4. Verificar kernel: `curl http://localhost:9900/health` debe devolver `{"status":"ok",...}`
5. Arrancar CLI: `shinobi` en cualquier CMD
6. Entrar en modo kernel si la tarea es compleja: `/mode kernel`. Para web/DOM dejar en `/mode auto`.

## Repos GitHub

- `AngelReml/Shinobibot` (privado)
- `AngelReml/OpenGravity` (privado, rama activa: `fix-planner-tools-20260410`)
- `opengravity-bvp` (público, sanitizado, para verificación externa de Behavioral Verification Protocol)

## Nunca subir a repo público

- `TopSecretUltraImportante/` — SSH keys del Contabo VPS
- `.env` (cualquier .env)
- `bridge/exports/*.json` con datos sensibles

## Infraestructura externa

- Contabo VPS: `ssh root@167.86.80.220`. 48GB RAM, 12 cores, Ubuntu 24.04, ~€20/mes. Repo OpenGravity en `/root/OpenGravity/`, rama `fix-planner-tools-20260410`. Benchmark runner usa opencode v1.14.19 con env var `AGENT`.
