# FIXES_CLEAN_DELTA — Structural Tech Debt Fixes (FIX 2.x)

Applied: 2026-06-26

---

## FIX 2.1 — Version strings unified to package.json

**Problem:** `src/telemetry/telemetry.ts` fell back to `'0.0.0'` (wrong default); `src/migration/from_hermes.ts` stamped `'1.0.0'` literally — both would drift on the next version bump.

**Fix:**
- Created `src/utils/app_version.ts` — reads `package.json` at module load via `createRequire(import.meta.url)`, exports `APP_VERSION`.
- `src/telemetry/telemetry.ts`: `cfg.install_version ?? '0.0.0'` → `cfg.install_version ?? APP_VERSION`
- `src/migration/from_hermes.ts`: `version: '1.0.0'` → `version: APP_VERSION`

---

## FIX 2.2 — Invalid Anthropic model IDs (dot notation)

**Problem:** Anthropic model IDs use dashes (`claude-haiku-4-5`), not dots (`claude-haiku-4.5`). Dot-notation IDs are rejected by the Anthropic API. Found in 12 files.

**Fix:**
- Created `src/utils/model_defaults.ts` — canonical table of valid model IDs + OpenRouter routing variants.
- Fixed dot → dash in:
  - `src/evaluation/prompt_quality.ts` — `openrouter:anthropic/claude-haiku-4.5` → uses `OPENROUTER_MODEL_HAIKU`
  - `src/skills/skill_manager.ts` — DEFAULT_MODEL
  - `src/tools/browser_engine.ts` — DEFAULT_VISION_MODEL
  - `src/providers/openrouter_client.ts` — DEFAULT_MODEL
  - `src/cloud/openrouter_fallback.ts` — DEFAULT_MODEL
  - `src/reader/llm_adapter.ts` — OPENROUTER_ALIAS mapping values
  - `src/coordinator/model_router.ts` — PRICE_PER_1M keys + DEFAULT_MAPPING values
  - `src/learning/skill_curator.ts` — reviewModel() fallback
  - `src/coordinator/slash_commands.ts` — log string
  - Test files: `model_router.test.ts`, `progress_judge.test.ts`, `telemetry.test.ts`

---

## FIX 2.3 — Dead code removed from orchestrator

**Problem:** `src/coordinator/orchestrator.ts` had:
1. `import OpenAI from 'openai'` + `private static openai = new OpenAI({...})` — never called
2. `[B2-DEPRECATED]` commented-out block (OpenAI direct call) — dead code in mainline
3. `const availableTools = allTools` — identity alias, pointless indirection
4. `setConversation()` did not null out `_memoryReflector` — leaked old reflector across conversation switches

**Fix:**
- Removed `import OpenAI from 'openai'`
- Removed `private static openai` field
- Removed 12-line `[B2-DEPRECATED]` comment block
- Replaced `availableTools` alias; callers now use `allTools` directly
- Added `this._memoryReflector = null;` in `setConversation()` after counter resets

---

## FIX 2.5 — Hardcoded timeouts and max_tokens moved to env vars

**Problem:** `timeout: 60000` (1 min) and `max_tokens: 2048` were hardcoded in every provider client, making production tuning impossible without code edits.

**New env vars:**
- `SHINOBI_LLM_TIMEOUT_MS` — controls axios timeout (default: 60000)
- `SHINOBI_ANTHROPIC_MAX_TOKENS` — controls Anthropic max_tokens (default: 4096; also raised from 2048)

**Files updated:**
- `src/providers/anthropic_client.ts` — timeout + max_tokens
- `src/providers/openrouter_client.ts` — timeout
- `src/providers/openai_client.ts` — timeout
- `src/cloud/openrouter_fallback.ts` — timeout

---

## FIX 2.7 — Secret redactor extended with URL/connection patterns

**Problem:** `src/security/secret_redactor.ts` did not catch:
1. URLs with embedded credentials (`scheme://user:pass@host`)
2. Env vars whose names indicate connection strings (`DATABASE_URL`, `REDIS_DSN`, etc.)

**Fix — two new patterns added to `PATTERNS` (after existing `env-secret-assignment`):**
- `env-connection-string`: matches variable names containing `URL`, `URI`, `DSN`, `CONNECTION`, `CONN`, or `DATABASE`; redacts the value (group 2)
- `url-credentials`: matches `scheme://user:password@host`; redacts the credentials+host (group 2), preserves the scheme

New `SecretKind` entries: `'url-credentials'`, `'env-connection-string'`

---

## FIX 2.8 — Approved-skills directory centralized

**Problem:** Two modules computed the "approved skills" directory independently:
- `src/skills/skill_loader.ts`: inline `path.join(process.env.APPDATA || os.homedir(), 'Shinobi', 'approved_skills')`
- `src/skills/skill_manager.ts` + installer variants: `path.join(skillsRoot, 'approved')` (different base, different purpose — this group is internally consistent and needs no change)

**Fix:**
- Created `src/skills/paths.ts` — exports `APPROVED_SKILLS_DIR` (same value as skill_loader's inline constant)
- `src/skills/skill_loader.ts` — removed `os` import, replaced inline constant with `import { APPROVED_SKILLS_DIR } from './paths.js'`

Note: `skill_manager` / `anthropic_skill_installer` / `registry/installer` use a different path rooted in `process.cwd()/skills/` — correct and consistent within that group; no change needed.
