# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Shinobi is an autonomous **Windows-native** agent (TypeScript, ESM, Node). It
executes real actions on the user's machine — file I/O, shell commands, browser
automation — driven by an LLM tool loop with guardrails (loop detector, audit
log, command blacklist) so the model cannot run away destructively. It is not a
chatbot or a wrapper.

Note: most docs and code comments are in **Spanish**. Match that when editing
existing prose; new identifiers stay in English.

## Commands

```bash
npm test                 # vitest run — full suite
npm run test:watch       # vitest watch mode
npm run test:coverage    # vitest run --coverage
npm run typecheck        # tsc --noEmit
npm run dev              # tsx watch scripts/shinobi.ts (hot reload)
npm run tui              # Ink-based terminal UI (scripts/shinobi-tui.tsx)
npm run bench            # benchmark suite (scripts/benchmarks/run.ts)
npm run build:exe        # pkg build → Windows .exe (scripts/build_exe.ts)
```

Run a single test file or pattern:

```bash
npx vitest run src/coordinator/__tests__/loop_detector.test.ts
npx vitest run -t "LOOP_DETECTED"      # filter by test name
```

The real CLI/web entry points are `scripts/shinobi.ts` and
`scripts/shinobi_web.ts`, run via `tsx` (see `shinobi.cmd` / `shinobi_web.cmd`).
`package.json`'s `start`/`dev` run `scripts/shinobi.ts` via `tsx`.

## Test layout — important

- `vitest.config.ts` uses an explicit **allowlist** of spec files in its
  `include` array — NOT a blanket `**/*.test.ts` glob. A new
  `src/**/__tests__/*.test.ts` file will NOT run until you add it to that
  `include` list.
- The `test_*.ts` files at the repo **root** are legacy specs in
  `main().catch(...)` style, not vitest. `vitest.config.ts` and
  `tsconfig.build.json` exclude them. They are being ported block by block —
  do not assume they run in CI.
- `tsconfig.json` is `noEmit` (typecheck only, strict). `tsconfig.build.json`
  is the emit config (`strict: false`, `outDir: dist`).

## CI gotcha — pre-existing tsc errors

CI runs on `windows-latest` (the Windows-elite tools and `run_command` path
sandbox need real Windows). The typecheck step **filters four known
pre-existing errors** in modules not under active work:
`memory_store.ts`, `missions_recurrent.ts`, `scripts/d017_smoke.ts`,
`scripts/desktop_skills_load.ts`. New tsc errors anywhere else fail the build.
Don't "fix" CI by adding files to that filter — fix the error or leave the
filter alone.

## Architecture

Request flow (full detail in `ARCHITECTURE.md`):

1. **Surface** — input arrives via WebChat (`src/web/`), Telegram
   (`src/gateway/telegram_channel.ts`), HTTP (`src/gateway/http_channel.ts`),
   or CLI (`scripts/shinobi.ts`).
2. **`ShinobiOrchestrator.process()`** (`src/coordinator/orchestrator.ts`) is
   the core LLM-tool loop (max 10 iterations). It assembles context (system
   prompt + curated memory snapshot + sanitized history), injects relevant
   memories with citations and matching approved skills, then loops:
   - `src/context/compactor.ts` compresses context past 75% of budget, keeping
     system / latest user input / last 3 turns intact (heuristic, idempotent).
   - `src/providers/provider_router.ts` invokes the LLM, rotating across the
     failover chain on rate-limit/transient/auth errors (`src/providers/failover.ts`
     classifies; only `fatal_payload` breaks the chain).
   - For each tool call: `src/coordinator/loop_detector.ts` checks the args
     layer (SHA256, abort on 2nd identical → `LOOP_DETECTED`) and the semantic
     layer (output fingerprint, abort after 3 indistinguishable → `LOOP_NO_PROGRESS`);
     the tool runs; `src/audit/audit_log.ts` appends the call to `audit.jsonl`.
3. Output is persisted and returned to the originating channel.

Key seams:

| Concern | Location |
|---|---|
| LLM-tool loop, execution modes (local/kernel/auto) | `src/coordinator/orchestrator.ts` |
| Tool registry (in-process singleton) | `src/tools/tool_registry.ts`, `src/tools/index.ts` |
| `run_command` guards (destructive blacklist + cwd sandbox) | `src/tools/run_command.ts` |
| Windows-elite tools (PowerShell-based, zero deps) | `src/tools/{clipboard,process,system,disk,env,network,registry,task_scheduler,windows_notification}_*.ts` |
| Provider failover | `src/providers/provider_router.ts`, `failover.ts` |
| Persistent memory (SQLite + vector) | `src/memory/` |
| Skills (sign/audit/load) | `src/skills/` |
| Cloud kernel bridge (OpenGravity) | `src/bridge/` |
| Slash commands | `src/coordinator/slash_commands.ts` |

## Conventions

- **ESM throughout**: imports of local TS files use the `.js` extension
  (`import { x } from './foo.js'`) even though the source is `.ts` — NodeNext
  resolution requires it. Match this in every new import.
- **Adding a tool**: implement under `src/tools/`, register it in
  `src/tools/index.ts` / `tool_registry.ts`. Tools take a JSON-schema arg
  object and return a result; the loop detector and audit log wrap them
  automatically — don't reimplement that.
- **Heuristic over LLM** is a deliberate design rule: the compactor and loop
  detector are 100% heuristic (no extra round-trip). Don't add LLM calls to
  those paths.
- **Audit is best-effort**: `audit.jsonl` writes must never block or throw
  into the main flow — failure returns `false` and the agent continues.
- **Windows-elite tools use only `powershell.exe` / `schtasks.exe`** — no new
  npm dependency for OS access; it keeps the packaged `.exe` and supply-chain
  surface small.

## Known debt

`memory_store.ts` and `missions_recurrent.ts` have `Cannot find namespace
'Database'` errors (`better-sqlite3` without the namespace declaration) — they
work at runtime; CI filters them. Persistent missions / cron in
`src/runtime/resident_loop.ts` are partially implemented. No real OS sandbox
for `run_command` yet — only blacklist + cwd sandbox.
