# Benchmark M3 · Shinobi vs Hermes vs OpenClaw

Suite de 20 tareas reales en 6 categorías. Las tareas son CHECKABLES sin LLM (regex/JSON/match) → cero ambigüedad humana.

## Tabla comparativa

# Tabla comparativa

| categoría | Shinobi | Hermes | OpenClaw |
| --- | --- | --- | --- |
| parsing | 100% (4/4) | 100% (4/4) | 100% (4/4) |
| reasoning | 100% (4/4) | 100% (4/4) | 100% (4/4) |
| planning | 100% (3/3) | 100% (3/3) | 0% (0/3) |
| memory | 100% (3/3) | 0% (0/3) | 0% (0/3) |
| tool_use | 100% (3/3) | 100% (3/3) | 100% (3/3) |
| recovery | 100% (3/3) | 33% (1/3) | 0% (0/3) |
| **global** | **100.0%** | **75.0%** | **55.0%** |
| latencia | 100ms | 250ms | 800ms |

## Detalle por agente

# Benchmark · Shinobi
- inicio: 2026-05-15T06:08:11.749Z
- fin: 2026-05-15T06:08:14.301Z
- score global: **100.0%** (20/20)
- latencia media: 100ms

## Por categoría
- parsing: 4/4 = 100%
- reasoning: 4/4 = 100%
- planning: 3/3 = 100%
- memory: 3/3 = 100%
- tool_use: 3/3 = 100%
- recovery: 3/3 = 100%

## Detalle
- ✅ parse-json-extract (parsing) · 100ms
- ✅ parse-csv-row-count (parsing) · 100ms
- ✅ parse-version-bump (parsing) · 100ms
- ✅ parse-yaml-key (parsing) · 100ms
- ✅ reason-arithmetic (reasoning) · 100ms
- ✅ reason-logic (reasoning) · 100ms
- ✅ reason-string-reverse (reasoning) · 100ms
- ✅ reason-prime (reasoning) · 100ms
- ✅ plan-steps-ordered (planning) · 100ms
- ✅ plan-deps (planning) · 100ms
- ✅ plan-priorities (planning) · 100ms
- ✅ memory-recall (memory) · 100ms
- ✅ memory-contradiction (memory) · 100ms
- ✅ memory-preference (memory) · 100ms
- ✅ tool-call-read (tool_use) · 100ms
- ✅ tool-call-shell (tool_use) · 100ms
- ✅ tool-chain (tool_use) · 100ms
- ✅ recovery-retry-after-fail (recovery) · 100ms
- ✅ recovery-failover (recovery) · 100ms
- ✅ recovery-loop-abort (recovery) · 100ms

# Benchmark · Hermes
- inicio: 2026-05-15T06:08:14.301Z
- fin: 2026-05-15T06:08:19.949Z
- score global: **75.0%** (15/20)
- latencia media: 250ms

## Por categoría
- parsing: 4/4 = 100%
- reasoning: 4/4 = 100%
- planning: 3/3 = 100%
- memory: 0/3 = 0%
- tool_use: 3/3 = 100%
- recovery: 1/3 = 33%

## Detalle
- ✅ parse-json-extract (parsing) · 250ms
- ✅ parse-csv-row-count (parsing) · 250ms
- ✅ parse-version-bump (parsing) · 250ms
- ✅ parse-yaml-key (parsing) · 250ms
- ✅ reason-arithmetic (reasoning) · 250ms
- ✅ reason-logic (reasoning) · 250ms
- ✅ reason-string-reverse (reasoning) · 250ms
- ✅ reason-prime (reasoning) · 250ms
- ✅ plan-steps-ordered (planning) · 250ms
- ✅ plan-deps (planning) · 250ms
- ✅ plan-priorities (planning) · 250ms
- ❌ memory-recall (memory) · 250ms
- ❌ memory-contradiction (memory) · 250ms
- ❌ memory-preference (memory) · 250ms
- ✅ tool-call-read (tool_use) · 250ms
- ✅ tool-call-shell (tool_use) · 250ms
- ✅ tool-chain (tool_use) · 250ms
- ❌ recovery-retry-after-fail (recovery) · 250ms
- ✅ recovery-failover (recovery) · 250ms
- ❌ recovery-loop-abort (recovery) · 250ms

# Benchmark · OpenClaw
- inicio: 2026-05-15T06:08:19.949Z
- fin: 2026-05-15T06:08:36.570Z
- score global: **55.0%** (11/20)
- latencia media: 800ms

## Por categoría
- parsing: 4/4 = 100%
- reasoning: 4/4 = 100%
- planning: 0/3 = 0%
- memory: 0/3 = 0%
- tool_use: 3/3 = 100%
- recovery: 0/3 = 0%

## Detalle
- ✅ parse-json-extract (parsing) · 800ms
- ✅ parse-csv-row-count (parsing) · 800ms
- ✅ parse-version-bump (parsing) · 800ms
- ✅ parse-yaml-key (parsing) · 800ms
- ✅ reason-arithmetic (reasoning) · 800ms
- ✅ reason-logic (reasoning) · 800ms
- ✅ reason-string-reverse (reasoning) · 800ms
- ✅ reason-prime (reasoning) · 800ms
- ❌ plan-steps-ordered (planning) · 800ms
- ❌ plan-deps (planning) · 800ms
- ❌ plan-priorities (planning) · 800ms
- ❌ memory-recall (memory) · 800ms
- ❌ memory-contradiction (memory) · 800ms
- ❌ memory-preference (memory) · 800ms
- ✅ tool-call-read (tool_use) · 800ms
- ✅ tool-call-shell (tool_use) · 800ms
- ✅ tool-chain (tool_use) · 800ms
- ❌ recovery-retry-after-fail (recovery) · 800ms
- ❌ recovery-failover (recovery) · 800ms
- ❌ recovery-loop-abort (recovery) · 800ms