# Sello

**Pure behavioral verifier (PoBI — Proof of Behavioral Integrity). NOT an agent.**

Sello takes a *subject* (any process), runs it against a frozen task bank, grades
its output with deterministic graders, and emits a **signed, hash-chained
verdict** that anyone can verify offline. It takes no autonomous action.

> Source of truth: `SELLO_CONTRACT.md` (shared contract). Code wins over the
> contract where they disagree; §5 carries the reconciliation note.

## What it produces — the PoBI verdict (CONTRACT §2)

A signed JSON record per run, chained to the previous one:

- `conditions` — clean/perturbed mode, probes, `env_hash` (detects false-override).
- `result.evidence_hash` — the raw output is **not** inline; it lives in a
  content-addressed evidence-store. The verdict only references its hash.
- `integrity` — `this_hash = sha256(canonical(verdict − this_hash − signature))`,
  ed25519 `signature` over `this_hash`, `prev_hash` linking the chain.
- `result.verdict` — one of the 9 values (CONTRACT §3). Graders emit
  `PASS/FAIL/FORMAT_FAIL/CONTENT_FAIL/SAFETY_FAIL`; the harness/ledger emit
  `TIMEOUT/ERROR/PENDING/INTEGRITY_FAIL`.

## Layout

```
src/core/ledger/    canonical.ts · keys.ts (ed25519) · evidence_store.ts · recorder.ts (hash chain)
src/core/verdict/   pobi.ts (schema §2, sign/verify, canonicalization)
src/graders/        5 graders (ported from OpenGravity) + common interface (index.ts)
src/harness/        runner.ts · adapters/cli_process.ts · bank.ts · subjects/{oracle,naive}.mjs
src/cli/sello.ts    run · verify · replay
bank/               pilot_agentic_v1.jsonl — the 30 real tasks (CONTRACT §4)
scripts/            extract_bank.ts · compute_oracles.ts · regression.ts
vendor/             OpenGravity source vendored for verbatim extraction provenance
```

## Use

```bash
npm install
npm run setup:hooks            # install the pre-commit secret-scan

npm run extract:bank           # 30 real tasks → bank/pilot_agentic_v1.jsonl
npm run compute:oracles        # compute + validate oracle_output against real graders
npm run regression             # F0 GATE: 30/30 oracle ÷ 0/30 naive via raw CLI

# single subject run
npx tsx src/cli/sello.ts run T_TRADE_01_SLIPPAGE_HONEST node src/harness/subjects/oracle.mjs
npx tsx src/cli/sello.ts verify runs/T_TRADE_01_*.verdict.json
npx tsx src/cli/sello.ts replay T_TRADE_01_SLIPPAGE_HONEST
```

## F0 status

`✓ F0 GATE PASSED (30/30 ÷ 0/30)` — confirmed by raw CLI over the 30 real tasks.
Oracles are computed by code (`scripts/compute_oracles.ts`) and each is validated
to PASS its assigned real grader before shipping — no hand-trusted oracle.

## Security

- `.env`, `*.pem`, `keys/` are gitignored from commit 1; a pre-commit secret-scan
  blocks key material / token patterns.
- The ed25519 keypair is generated **new** for Sello and never committed.
- Runtime artifacts (`evidence/`, `runs/`, `ledger/`) are gitignored.
