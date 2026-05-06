# Cierre 2026-05-04 — Reporte de Criba ejecutado

Tras leer `Reporte_Criba_Shinobi.docx` y procesar los 13 ROJOS + 9 AMARILLOS, esta sesión avanzó **lo máximo sin intervención de Iván**. Resultado: todo verde, lista manual reducida a 6 acciones humanas.

## Cambios cerrados (todos pusheados a GitHub privado)

| # | Tema | Repo · archivos clave | Estado |
|---|------|----------------------|--------|
| 1 | Alias FASE 1 (C5/D5/C7 ≡ C-INDEX/AUDIT-DEV/KILLER) | shinobi `docs/sessions/2026-05-04_alias_fase1.md` | ✅ |
| 2 | OBS auto-record → opt-IN (default OFF) | shinobi `src/demo/demo_runner.ts`, `scripts/shinobi.ts`, `demos/README.md` | ✅ |
| 3 | Verification battery (P4-P9) | C-INDEX/improve/baseline/D5/agentskills/killer + verify_release | 6/6 PASS |
| 4 | n8n bridge restaurado | OG `src/dashboard/server.ts` `/api/webhook/n8n` + audit JSONL + E2E | ✅ |
| 5 | Resident mode 24/7 (`shinobi daemon` + Windows service) | shinobi `scripts/shinobi.ts` daemon, `scripts/install_service.ps1`, `docs/architecture/resident_mode.md`, E2E | ✅ |
| 6 | Auto-bench generation | OG `src/benchmark/auto_gen/` + `/v1/benchmark/auto-gen` + E2E (3 valid + 1 quarantined) | ✅ |
| 7 | OpenBrain spec mínimo viable + SDK | OG `src/openbrain/{registry,SPEC.md}` + `/v1/openbrain/{match,invoke,feedback,brains,register}` + `sdks/openbrain-node/` + E2E | ✅ |
| 8 | MutationEngine validation (smoke + STATUS.md) | OG `src/experimental/v1_engine/{__tests__/mutation_smoke.test.ts, STATUS.md}` | ✅ smoke verde, LLM path queda como AMARILLO controlado |
| 9 | Program discovery design doc | shinobi `docs/architecture/program_discovery.md` | ✅ doc completo, código intencionalmente diferido |
| 10 | Cleanup OG (5.6 GB → 3.31 GB reclamables identificados) | OG `scripts/cleanup_dryrun.mjs` | ✅ dry-run no destructivo |

## Estado del proyecto (post-criba)

**VERDE confirmado en código + tests** (lo que se puede mencionar en una landing pública sin vergüenza):

- Browser/web/HTTP automation, Comet integration
- Memoria persistente con embeddings
- C-INDEX: skill index + reflection + 3 modos
- AUDIT-DEV: behavioral deviation score con calibration mode (p99=3.91ms)
- KILLER: demo reproducible 8/8 PDFs en 0.4s con chapters auto-emitidos
- agentskills.io compatibilidad y migración
- Import-from-hermes
- MCP standard compliance
- ShinobiBench v1 público + auto-mejora loop verificada
- OpenRouter como LLM gateway
- Hash chain forense (sin migración destructiva)
- AuditGravity B2B (landing + endpoints + dashboard)
- Telemetría opt-in
- Issue triage automatizado
- Release CI con SEA build (v1.0.0 publicado en GH Releases)
- 5 repos obsoletos archivados
- **Nuevos esta sesión**: opt-IN OBS, n8n bridge, daemon 24/7, auto-bench gen, OpenBrain v0.1, mutation state machine

**AMARILLO (build presente, demo en vivo pendiente)** — cosas reales pero sin show:

- Computer Use Windows nativo (B9 cerrado en código)
- 6 skills desktop nativas (lint+load 8/8 sin Excel/Outlook/etc. abiertos)
- Auto-update mechanism (sin verificar contra v1.0.1 real)
- Dashboard web monitoreo + heatmap
- Swarm jerárquico
- MutationEngine LLM path

**ROJO (no construido — diferido por dependencias o scope)**:

- "Aprender programa nuevo desde cero" — diseñado, no construido (`docs/architecture/program_discovery.md`)
- Empaquetado .exe con Inno Setup — bloqueado por Inno Setup en máquina dev
- Voice mode (Whisper) — bloqueado por API key
- Empresa sintética / wallets — visión a 1+ año
- Prospect Mateo Pereira — comercial, no técnico

## Lista manual mínima (6 acciones humanas)

Ordenadas por impacto vs esfuerzo:

1. **Configurar 3 secrets en GitHub** (Settings → Secrets and variables → Actions, repo `AngelReml/Shinobibot`):
   - `BUILD_LOG_PAT` — fine-grained PAT con permiso `Contents: read` sobre los 3 repos. Sin él, el build log salta OpenGravity con un warning.
   - `TRIAGE_LLM_KEY` — OpenRouter key. Sin él, el bot de triage usa el clasificador heurístico (funcional, peor calidad).
   - `DISCORD_WEBHOOK_URL` — webhook de Discord. Sin él, las notificaciones de release se saltan en silencio.

2. **Instalar Inno Setup** en máquina dev (descarga: <https://jrsoftware.org/isinfo.php>, ~5 min). Desbloquea el empaquetado `.exe` distribuible que verify_release lista como skipped.

3. **Configurar DNS de subdominios** en proveedor de zapweave.com:
   - `audit.zapweave.com` → CNAME a `<host>.netlify.app` (o equivalente) sirviendo `web/audit/`. Alternativa: redirect 301 a `zapweave.com/audit/` desde Cloudflare.
   - `kernel.zapweave.com` → ya apunta al VPS Contabo (167.86.80.220), comprobar que sigue verde tras el próximo deploy.
   - `brain.zapweave.com` → opcional, redirect a `kernel.zapweave.com/v1/openbrain/`.

4. **Cloudflare Email Routing** para `hola@zapweave.com` → tu inbox personal. (~10 min en Cloudflare, gratis).

5. **Deploy OG nuevo a VPS Contabo** (cuando confirmes):
   ```sh
   ssh root@167.86.80.220
   cd /root/OpenGravity
   git pull origin main
   npm ci
   systemctl restart opengravity.service
   ```
   Trae todos los endpoints nuevos: `/v1/audit/*`, `/v1/telemetry/*`, `/v1/openbrain/*`, `/v1/benchmark/auto-gen`, `/v1/skills/reflect`, dashboards `/dashboard/audit/deviation` y `/dashboard/telemetry`.

6. **Crear servidor Discord** (manual, ~30 min) siguiendo `shinobibot/docs/comunidad.md`. Tras crearlo, generar webhook y guardarlo como `DISCORD_WEBHOOK_URL` (cierra punto 1c).

### Diferidas por dep externa (NO bloquean el lanzamiento, sólo lo enriquecen)

- **Whisper API key** — para voice mode (B3). Compra en <https://platform.openai.com> o instalar `whisper.cpp` local.
- **Compra dominios** y reservas de handle GitHub para AuditGravity (`auditgravity.com`, `github.com/auditgravity`) — opcionales hasta que se haga el push B2B real.

### Cosas que IA NO puede hacer pero el usuario puede automatizar más

- Smoke tests con apps abiertas (Excel/Outlook/Premiere/OBS/Photoshop) → script en PowerShell en `scripts/manual_smoke.ps1` documentado, pero requiere apps + sesión interactiva.
- Demo viral pública en LinkedIn/Twitter → escribir el copy y el thread, pero el publish queda en cuenta del usuario.

## Tests verdes esta sesión

```
[c5-e2e] Phase 5: success rate 100% (run1 3, run2 3) — OK
[improve-e2e] resolved 4 gaps, chain valid — OK
[baseline] 16/16, weighted 22.30/22.30 — OK
[d5-e2e] p50=1.96ms p99=2.99ms — OK
[a2-e2e] round-trip OK
[killer] 8/8 PDFs en 0.4s — OK
[verify-release] passed=5 failed=0 skipped=2 (esperados) — OK
[n8n-bridge-e2e] OK — id=n8n_morgqzqh_buc1p5 log_grew=251 bytes
[daemon-e2e] OK — boot detected
[auto-gen-e2e] OK — generated=3 quarantined=1
[openbrain-e2e] OK match=shinobi-local invoke=true brains=4
[mutation-smoke] OK — proposed→sandboxed→validated→rejected
```

## Repos / commits

| Repo | Commits esta sesión | Push |
|---|---|---|
| `Shinobibot` | 6 (alias, OBS opt-in, daemon, program discovery doc, criba closure) | ✅ |
| `OpenGravity` | 7 (n8n bridge, auto-bench, OpenBrain ×3 archivos, mutation status, cleanup) | ✅ |

OG sigue **sin deploy a VPS** — todos los endpoints nuevos viven en GitHub privado. Acción manual #5 los expone.

## Recomendación de orden de los 6 manuales

1. **Inno Setup** (5 min, desbloquea .exe).
2. **Cloudflare Email Routing hola@zapweave.com** (10 min).
3. **3 secrets en GitHub** (15 min total).
4. **DNS subdominios** (30 min, tiempo de propagación incluido).
5. **Deploy VPS** (10 min cuando estés listo).
6. **Discord server** (30 min cuando quieras lanzar comunidad).

Total ~1h 40min de trabajo humano. Todo lo demás es zero-touch desde aquí.

## Bandera

**Lanzamiento público de shinobibot (E2)** sigue diferido a tu OK explícito. El roadmap v2 del prompt.txt v3 dice "Shinobibot SE QUEDA PRIVADO hasta el final del nuevo roadmap". Lo que se ha entregado esta sesión cumple casi toda esa lista (FASE 1 ya estaba; FASE 2 GR-DNA queda truncado en spec; FASE 3 OpenBrain hecho como MVP). El lanzamiento es ahora una **decisión** tuya, no un bloqueo técnico.

---

## Addendum 2026-05-06 — Hardening del comité (F1/F2/F3)

Tres ítems que la criba original no había marcado VERDE porque el código aún no existía. Cerrados esta fecha tras pasar los gates correspondientes:

| Ítem | Estado | Evidencia |
|---|---|---|
| Comité determinista (mismo SHA → mismo verdict) | ✅ VERDE | `scripts/f1_gate.ts` → 5/5 verdicts idénticos con `confidence=high` sobre execa@`f3a2e848`. Implementación: `temperature=0` global + `votingRuns=3` con majority + read-cache por SHA en `audits/.machine/`. |
| Code reviewer con código real | ✅ VERDE | `scripts/f2_gate.ts` → audit DVWA detecta `[sql injection, xss, csrf, rce]`. Implementación: `src/committee/code_reviewer.ts` selecciona archivos de riesgo y los inyecta literalmente (~8k tokens) al prompt. |
| Fuzzy apply de propuestas | ✅ VERDE | `scripts/f3_gate.ts` → 5 propuestas, 4 aplicables (4 OK), `/apply` modifica el archivo correctamente, tsc 0 errores nuevos. Implementación: `[OK]/[FUZZY]/[BROKEN_DIFF]` tagging + retry con `{find,replace}` reconstruido por `git diff` + path resolver por basename. |

**Sesión completa**: `docs/sessions/2026-05-06_F1_F2_F3_committee_hardening.md` (incluye 4 bugs reales descubiertos durante F3 — index-line stripping, --3way blobs, gate non-surgical revert, baseline tsc).

**Tests**: 39 nuevos en committee + 77 ya verdes = 103 passed, 0 failed.

**Commits pusheados a `origin/main`**: `c69ce80`, `9bc3eaa`, `4d24a3e` (range `716c72a..3e23d98`).
