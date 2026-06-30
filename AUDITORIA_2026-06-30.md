# ESTADO HONESTO DE SHINOBIBOT — 2026-06-30

> Principio de este documento: ninguna afirmación sin dato crudo que la respalde.
> Si algo no se verificó directamente, se dice explícitamente.

---

## 1. ALCANCE REAL DE LA AUDITORÍA

### Qué se hizo

- **Grep automático** sobre `src/` y `scripts/` con los patrones:
  - `TODO|FIXME|throw new Error.*implement|not_implemented`
  - `process.env.SHINOBI_*|OPENROUTER_*|KAGEMUSHA_*`
  - `hardcoded|mock|demo|stub` en nombres de símbolo/archivo
  - Comparación de cada variable `process.env.*` contra `.env.example`

- **Lectura directa** de estos archivos (fuente: herramienta Read, verificable en el transcript):

| Archivo | Líneas leídas |
|---------|---------------|
| `src/skills/anthropic_skill_installer.ts` | 296 (completo) |
| `src/shugyo/index.ts` | 21 (completo) |
| `src/shugyo/demo.ts` | 68 (completo) |
| `src/sandbox/registry.ts` | 72 (completo) |
| `src/coordinator/progress_judge.ts` | 228 (completo) |
| `src/learning/background_review.ts` | 1–60 |
| `src/learning/skill_curator.ts` | 1–150 |
| `src/skills/skill_manager.ts` | 1–130 + 419–445 |
| `src/web/server.ts` | 440–475 |
| `src/providers/anthropic_client.ts` | 1–20 |
| `src/tools/run_swarm.ts` | 75–94 |
| `src/tools/run_team.ts` | 1–30 |
| `src/agents/best_of_n.ts`, `swarm.ts`, `team.ts`, `spawn_depth.ts` | completos |
| `.env.example` | completo |
| `SHINOBI_CHECKPOINT.md` | completo |

**Total código leído directamente: ~1 700 líneas de 46 947 LOC de producción (3,6 %).**

### Qué NO se auditó

Los siguientes módulos solo recibieron grep de patrones, sin lectura de su cuerpo:

- `src/tools/` — 57 archivos (herramientas de agente: browser_engine, run_command, write_file, etc.)
- `src/coordinator/` — 13 archivos salvo `progress_judge.ts`
- `src/kagemusha/` — 22 archivos
- `src/tenshu/` — 14 archivos (SPA local + puente de mando)
- `src/shitsuji/` — 11 archivos
- `src/kagami/` — 14 archivos
- `src/chizu/` — 16 archivos
- `src/kangeiko/` — 11 archivos
- `src/channels/` — 13 archivos (Discord, Slack, Telegram, email)
- `src/gateway/` — 6 archivos
- `src/runtime/` — 8 archivos (SSH/Docker remote)
- `src/a2a/` — 2 archivos (protocolo Agent-to-Agent)
- `src/committee/` — 8 archivos
- `src/bench/` — 13 archivos (harness de benchmark)
- `src/memory/` — 27 archivos (solo grep de env vars)
- `scripts/` — todos (solo grep de env vars y nombres de archivo)
- `Sello/` — directorio de firma Ed25519, no abierto

**En total: 431 de los 457 archivos de producción NO fueron leídos directamente.**

---

## 2. HALLAZGOS CONFIRMADOS Y SU ESTADO

### Corregidos hoy

| # | Archivo | Dato crudo que justifica el hallazgo | Fix aplicado |
|---|---------|--------------------------------------|--------------|
| 1 | `src/skills/anthropic_skill_installer.ts:175` | `throw new Error('source kind no implementado todavía: ${source.kind}')` — `parseSkillSource()` acepta `github:owner/repo` y devuelve `{kind:'github-repo'}` en línea 92; `materializeSource()` lanza en runtime para ese kind | `github-repo` implementado via `raw.githubusercontent.com/{owner}/{repo}/{ref}/SKILL.md`; `tarball` da error accionable; exhaustiveness `never` añadido |
| 2 | `src/learning/background_review.ts:47` vs `src/learning/skill_curator.ts:140` | `'anthropic/claude-3-5-haiku-20241022'` en un archivo, `'anthropic/claude-haiku-4-5'` en el otro — mismo env var `SHINOBI_REVIEW_MODEL`, dos fallbacks distintos | Unificado a `'anthropic/claude-haiku-4-5'` en ambos |
| 3 | `.env.example` | `grep -rn "process.env.*" src/ \| grep -v __tests__` mostró 11 vars sin entrada en `.env.example`: `SHINOBI_REVIEW_MODEL`, `SHINOBI_REVIEW_ENABLED`, `SHINOBI_CURATOR_ENABLED/INTERVAL_HOURS/STALE_DAYS/ARCHIVE_DAYS`, `SHINOBI_PROGRESS_DETECTION`, `SHINOBI_PROGRESS_JUDGE`, `OPENROUTER_DEFAULT_MODEL`, `OPENROUTER_VISION_MODEL`, `KAGEMUSHA_BULK_MODEL`, `KAGEMUSHA_JUDGE_MODEL` | Documentadas con defaults |
| 4 | `src/skills/skill_manager.ts:120` + `src/web/server.ts:460` | `private approved: ApprovedSkill[]` — `server.ts` accedía via `sm as any` con comentario `// TODO honesto: exponer listApproved()` | `ApprovedSkill` exportado; `listApproved()` público añadido; cast eliminado |
| 5 | `.env.example` (segundo gap) | `grep -rn "GROQ_API_KEY" src/` devuelve 4 hits en producción (`registry.ts:70`, `credential_pool.ts:23`, `groq_client.ts:24-25`, `gateway/llm.ts:20`); `.env.example` no tenía entrada | `GROQ_API_KEY=` añadida |

### Confirmados NO problemáticos (datos que lo prueban)

| Hallazgo del scanner | Dato crudo que lo descarta |
|----------------------|---------------------------|
| `MockBackend` importado en `sandbox/registry.ts` | Línea 39 del mismo archivo: `// Mock NO se registra por default — lo añaden los tests con register()` |
| `MockProgressJudge` en código de producción | Línea 132 de `progress_judge.ts`: `/** Judge sintético para tests: devuelve scores scripted. */` — clase en el mismo archivo que `LLMProgressJudge` y `ProgressTracker`, patrón aceptado |
| `runForgeDemo` exportado desde `shugyo/index.ts` | Lectura de `shugyo/demo.ts`: implementación real del pipeline S-15 (selectTarget → explore → certifyInCage → publishToKagami); no devuelve datos ficticios |
| URLs de APIs externas hardcodeadas | Son endpoints públicos de Anthropic, OpenAI, Groq, OpenRouter — no tienen alternativa configurable por diseño |

---

## 3. INCONSISTENCIAS RESUELTAS EN SESIÓN

### spawn_depth: run_team usaba process.env mutable en lugar de ALS

**Hallazgo con dato crudo** (`run_team.ts:58-79` antes del fix):
```typescript
// ANTES — método antiguo, race condition bajo paralelismo:
const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
process.env.SHINOBI_SPAWN_DEPTH = String(parentDepth + 1);
try { result = await runTeam({...}); }
finally { process.env.SHINOBI_SPAWN_DEPTH = prevDepth; }
```

**Causa raíz**: `run_team.ts` nunca se migró a `AsyncLocalStorage` cuando se creó `spawn_depth.ts`. Seguía usando el mecanismo global que `spawn_depth.ts` documenta explícitamente como el bug a corregir.

**Comparación con run_swarm.ts** (línea 84, ya correcto):
```typescript
const result = await runWithSpawnDepth(parentDepth + 1, () => runSwarm({...}));
```

**Fix aplicado** (commit `1a278d2`): reemplaza las 10 líneas de env-mutation por `getSpawnDepth() + runWithSpawnDepth()`. Ambas tools ahora son simétricas: check temprano → wrap ALS → motor. 1731/1731 tests.

---

## 4. LO QUE NO SE PUEDE AFIRMAR

Por falta de evidencia directa, estas afirmaciones NO se hacen:

- **"El sistema es seguro"** — los 27 tests de `security_invariants.test.ts` pasan, pero solo se leyeron en el checkpoint, no directamente. No se verificó su cobertura de los 57 archivos de tools.

- **"Funciona en Windows"** — el CLAUDE.md dice "Windows-native" y el installer (`installer/shinobi.iss`) existe, pero todos los tests de hoy corrieron en Linux (Ubuntu 6.8.0). No probado en Windows.

- **"Los LLMs reales funcionan"** — todos los tests usan `invokeLLM` inyectado (mocks). Ningún test de esta sesión tocó una API key real.

- **"La suite cubre el código auditado"** — `vitest.config.ts` tiene `include` conservador y no se corrió `--coverage`. No se conoce el porcentaje real de cobertura.

- **"Los 1731 tests representan el comportamiento en producción"** — los tests de network (channels, browser, SSH, E2B) usan mocks o están deshabilitados por `SHINOBI_AUDIT_DISABLED=1`.

- **"github-repo funciona con cualquier repo"** — la implementación de hoy usa `raw.githubusercontent.com`. Repos privados necesitan un token (`Authorization: Bearer`) que la implementación actual no envía. No testeado contra repos reales.

---

## 5. ESTADO MECÁNICO AL CIERRE DE SESIÓN

Datos directamente medibles, sin interpretación:

```
Tests:      1731 / 1731 passing
Typecheck:  0 errors (tsc --noEmit)
Archivos modificados en sesión: 16
Líneas netas añadidas: ~+350 / -80
Commit final: 1a278d2  (run_team → ALS)
Branch: main (ahead of origin/main by 8 commits)
```

**Pendientes del plan arquitectónico** (del SHINOBI_CHECKPOINT.md, sin cambio hoy):
- Corridas reales con LLM (G1/G2/G4/G5) — necesitan API key en máquina del operador
- Demo tamper en Yoru — pendiente grabación
- ≥20 skills selladas con lacre OpenGravity — 0 creadas
- Wizard cero-config (CDP auto-detect Windows) — pospuesto desde G3
