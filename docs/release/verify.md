# `verify_release` — pre-release gating

`scripts/release/verify_release.mjs` corre los 7 checks que `Tareas..txt F1.1`
exige antes de tagear v1.0.0:

| # | Check | Tool |
|---|-------|------|
| 1 | Demo Auto-Mejora end-to-end (modo `--no-record`) | `shinobi run-demo full-self-improve --no-record` |
| 2 | Demo Windows Native — los 8 bundles desktop cargan y registran tool | `scripts/desktop_skills_load.ts` |
| 3 | `shinobi import hermes` funciona con fixture sintético | `src/migration/__tests__/from_hermes.test.ts` |
| 4 | `audit.zapweave.com` landing reachable (o file local) | HTTP GET o `web/audit/index.html` |
| 5 | `kernel.zapweave.com /v1/health` 200 OK | HTTP GET |
| 6 | `zapweave.com` landing reachable | HTTP GET o `web/index.html` |
| 7 | `ShinobiSetup.exe` presente en `build/` | filesystem check (soft skip si no existe) |

## Uso

```sh
node scripts/release/verify_release.mjs
```

Variables de entorno:

| Var | Efecto |
|---|---|
| `KERNEL_BASE_URL` | URL del kernel (default `https://kernel.zapweave.com`) |
| `ZAPWEAVE_BASE_URL` | URL del frontend (default `https://zapweave.com`) |
| `KERNEL_OFFLINE=1` | Salta el check 5 (útil cuando se trabaja sin red al VPS) |
| `SKIP_*=1` | Salta el check correspondiente (`SKIP_DEMO_AUTOMEJORA`, etc.) |
| `SHINOBI_VERSION` | Nombre del installer esperado (`ShinobiSetup-<ver>.exe`) |

## Output

- ✓ verde por check pasado
- ✗ rojo por check fallido
- ⏭ skipped cuando el env var lo indica

Exit code:
- `0` si todos pasaron o se saltaron — release autorizada
- `1` si al menos uno falló — release bloqueada
- `2` si el script crashea en sí mismo

## Cuándo skipear

| Skip | Cuándo es razonable |
|------|---------------------|
| `KERNEL_OFFLINE=1` | Pre-release antes de deploy a VPS, o entornos sin red al VPS |
| `SKIP_INSTALLER_PRESENT=1` | Antes de B1 (Inno Setup); soft skip automático si no existe |
| `SKIP_LANDING_AUDIT=1` | Antes de configurar DNS de `audit.zapweave.com` |

Ningún otro check debe saltarse para una release oficial. Si ChatGPT/CI/un
humano solicita saltarlos, exigir justificación documentada.

## Integración con G3 / F2

- **G3** (release CI): la action de release lanzará `verify_release.mjs` antes
  de empaquetar artefactos. `KERNEL_BASE_URL` apuntará a un staging.
- **F2** (tag v1.0.0): el tag sólo se publica si verify_release sale verde.

## Última corrida (referencia)

```
✓  Demo Auto-Mejora end-to-end (full-self-improve --no-record) — exit=0 pass=7
✓  Demo Windows Native (skill load: 8 desktop bundles register tools) — exit=0
✓  shinobi import hermes --dry-run with synthetic fixture — exit=0
✓  audit.zapweave.com landing reachable (or local web/audit/index.html exists) — local file present
⏭  kernel.zapweave.com /v1/health 200 OK (or skip if KERNEL_OFFLINE=1) — KERNEL_OFFLINE
✓  zapweave.com landing reachable (or local web/index.html exists) — live 200
⏭  ShinobiSetup.exe present in build/ (B1 manual TODO; soft-skipped if absent) — absent — B1 not yet executed

[verify-release] passed=5 failed=0 skipped=2 total=7
```
