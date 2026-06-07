# HANDOFF — Sesión Cowork 2026-06-06 → continuar en Claude Code CLI

**Origen:** sesión de Cowork (Claude desktop) sobre `C:\Users\angel\Desktop\shinobibot`.
**Destino:** Claude Code CLI en la misma carpeta.
**Rama:** `main` · último commit: `3ecdf0d` (test+fix capability stress harness).

> ⚠️ **Todo el trabajo de esta sesión está EN DISCO y SIN COMMITEAR.** El
> `tsc --noEmit` del subsistema nuevo está PENDIENTE de validar en tu terminal
> (el sandbox de Cowork no pudo correrlo, ver §5). Primera acción recomendada
> antes de commitear: §6.

---

## 0. Resumen ejecutivo (TL;DR)

Tres bloques de trabajo, en orden:

1. **Auditoría + fixes** del repo (dossier en `DOSSIER_AUDITORIA_2026-06-06.md`).
   Bug real que corrompía memoria (B1) corregido; 5 type-errors más; limpieza de
   código muerto; CI estricto; hook anti-secretos.
2. **Solución al problema "no usa tools/skills por lenguaje natural"**: tres
   causas raíz encontradas y corregidas (matching de skills, system prompt,
   traza visible del razonamiento).
3. **Subsistema de navegador "Kage"** nuevo (observe → act → verify), diseñado
   para calidad tipo Antigravity pero corrigiendo su modelo frágil. Doc:
   `docs/BROWSER_SUBSYSTEM.md`.

**Estado:** código completo en disco. Falta: (a) `npm run typecheck` limpio,
(b) test de humo del browser, (c) commits. Detalle en §5–§6.

---

## 1. Bloque A — Auditoría y fixes

Referencia completa: `DOSSIER_AUDITORIA_2026-06-06.md`.

| Fix | Qué era | Archivo(s) |
|---|---|---|
| **B1** 🔴 | `ContradictionFilter` llamaba `invokeLLM([...])` (forma inválida; espera `{messages}`) y leía `.content` (no existe en `CloudResponse`, es `.output`). Resultado: `reply` siempre `''` → reportaba un FALSO conflicto en CADA escritura de memoria curada (`curated_memory.ts` lo usa 3×). | `src/memory/contradiction_filter.ts` |
| **B3** | `scripts/shinobi.ts` importaba `../src/demo/demo_runner.js` (no existe) → `run-demo` crasheaba. Ahora degrada con mensaje claro. Script `p2_modal_daytona_real.ts` (imports a backends inexistentes) borrado. Docstring de `registry.ts` corregido. | `scripts/shinobi.ts`, `src/sandbox/registry.ts` |
| **B4** | `toolMatchAscii` tipado `false | RegExpMatchArray` → indexado inseguro. | `src/web/server.ts` |
| **B5** | `await` faltantes en script de validación. | `archive/.../markdown_memory_real.ts` |
| **B6** | imports `.mjs` sin tipos (implicit any). Añadida declaración ambiental. | `src/types/mjs_modules.d.ts` (nuevo) |
| **Test** | El test de `ContradictionFilter` mockeaba `{ content }` (misma forma errónea del bug). Corregido a `{ success, output }`. **Hecho ya en tu sesión de Claude Code; 4/4 pasan.** | `src/memory/__tests__/contradiction_filter.test.ts` |

**Higiene:**
- Código muerto borrado: 8 `.bak` + 2 stubs `export {}` (`scripts/executor.ts`, `test_jwt.ts`).
- 31 dirs de `scripts/sprint*/` + `audit_validation/` movidos a `archive/` (excluido en `tsconfig.json`).
- Docs sincronizadas: `ARCHITECTURE.md` (LoopDetector v2→v3, 34→41 tools).
- CI: `.github/workflows/ci.yml` ahora corre `tsc --noEmit` estricto (sin los filtros de errores pre-existentes).
- Secretos: `.githooks/pre-commit` anti-claves + `git config core.hooksPath .githooks` ya aplicado.
- `.env`: rotación de claves descartada por decisión explícita del usuario (cuentas de prueba, pérdida asumida).

## 2. Bloque B — Tools/skills desde lenguaje natural

Tres causas raíz del síntoma "ignora tools/skills si no uso /comando":

1. **Matching de skills era substring exacto** → fallaba con acentos, plurales y
   keywords reordenadas. Reescrito `skill_manager.ts#getContextSection`:
   normaliza diacríticos, tolera singular/plural y prefijo morfológico, keywords
   multi-palabra matchean en cualquier orden, ranking por nº de hits. Validado
   con 9 casos (9/9). Loguea `[🧩] Skill activada: …`; con `SHINOBI_SKILL_DEBUG=1`
   también loguea cuando nada matchea.
2. **System prompt listaba 8 de 41 tools** → reescrito `prompts.ts` con catálogo
   por categorías + **TOOL-FIRST RULE** (ante intención accionable, llamar la
   tool sin exigir nombrarla) + **PLAN PROTOCOL** (`PLAN: objetivo → tools`
   antes del primer tool call).
3. **El razonamiento del modelo no se imprimía** (solo `[🔨] Tool called`) →
   `orchestrator.ts` ahora emite `[🧠] …`; `server.ts` lo reenvía al WebChat
   como tipos `plan` y `skill_activated`.

## 3. Bloque C — Subsistema de navegador "Kage"

Doc de arquitectura: `docs/BROWSER_SUBSYSTEM.md` (léelo, explica las 5 mejoras
sobre el modelo coordenada-céntrico de Antigravity).

**Concepto:** flujo `observe → act → verify`.
- `browser_observe`: etiqueta interactivos en el DOM (`data-kage-ref="N"`) y
  devuelve un mapa numerado legible. El modelo actúa por `ref`, no por
  selector/coordenada.
- `browser_act`: click/type/select/press/scroll/navigate/click_xy por ref, con
  input-lock del motor, reintento por staleness y **veredicto de verificación**
  (¿cambió URL/DOM/pantalla?).
- `browser_session`: open/navigate/status/screencast/close.
- Consentimiento propio (`consent.ts`) independiente del gate global desactivado;
  timeout = DENEGAR. Reusa el canal WS `approval_request/response`.
- Screencast vía CDP `Page.startScreencast` → frames al panel `/browser.html`.

**Archivos nuevos:**
```
src/browser/{types,session,observer,actor,verifier,screencast,consent}.ts
src/tools/{browser_observe,browser_act,browser_session}.ts   (+ registrados en src/tools/index.ts)
src/web/public/browser.html
skills/approved/kage-browser-operator.skill.md
docs/BROWSER_SUBSYSTEM.md
```
**Tocados:** `src/web/server.ts` (consent asker + broadcast de frames),
`src/constants/prompts.ts` (flujo browser), `src/security/approval.ts`
(`browser_observe` read-only).

---

## 4. Inventario exacto de cambios (para el commit)

> **CRÍTICO sobre el ruido de git:** `git status` muestra ~38 archivos `src/…`
> "modificados" que **NO se tocaron** — son solo cambios de fin de línea (CRLF)
> introducidos por el mount de Cowork. Verificado: `git diff --ignore-cr-at-eol`
> sobre ellos da vacío. **No los commitees como cambios de contenido.**
> Sugerencia: `git config core.autocrlf input` (o `false`) y revisa con
> `git diff --ignore-cr-at-eol --stat` antes de añadir.

**Cambios REALES de contenido (estos sí):**

Modificados:
- `src/memory/contradiction_filter.ts`
- `src/memory/__tests__/contradiction_filter.test.ts`
- `scripts/shinobi.ts`
- `src/sandbox/registry.ts`
- `src/web/server.ts`
- `src/constants/prompts.ts`
- `src/coordinator/orchestrator.ts`
- `src/skills/skill_manager.ts`
- `src/security/approval.ts`
- `src/tools/index.ts`
- `tsconfig.json`
- `.github/workflows/ci.yml`
- `.gitignore`
- `ARCHITECTURE.md`

Nuevos (untracked):
- `src/browser/` (7 archivos)
- `src/tools/browser_observe.ts`, `browser_act.ts`, `browser_session.ts`
- `src/types/mjs_modules.d.ts`
- `src/web/public/browser.html`
- `skills/approved/kage-browser-operator.skill.md`
- `.githooks/pre-commit`
- `docs/BROWSER_SUBSYSTEM.md`
- `DOSSIER_AUDITORIA_2026-06-06.md`
- `HANDOFF_COWORK_2026-06-06.md` (este archivo)
- `archive/` (sprints movidos + README)

Borrados: 8 `.bak`, `scripts/executor.ts`, `scripts/test_jwt.ts`,
`archive/scripts/audit_validation/p2_modal_daytona_real.ts`.

> Archivos sueltos a ignorar/decidir: `notas.md`, `parse_wiki.js`,
> `plan_cafeteria.md`, `shinobi.lock` — no son de esta sesión, revísalos aparte.

---

## 5. Validación pendiente (PRIMERA ACCIÓN en Claude Code)

El sandbox de Cowork no pudo correr `tsc` con fiabilidad (su copia del FS iba
desincronizada y leía archivos truncados). El disco está íntegro. Ejecuta:

```bash
npm run typecheck
```

Esperado: **0 errores**. Si aparece alguno en `src/browser/*`, los puntos más
probables a revisar (ya mitigados, pero confírmalos):
- `observer.ts` usa `declare const document/window: any` para el código que corre
  dentro de la página (proyecto Node sin lib DOM). Si tu tsconfig SÍ trae lib
  DOM por otra vía, podría chocar — quita las declaraciones en ese caso.
- `session.ts` usa `ctx.newCDPSession(page)` y `CDPSession` de `playwright`
  (confirmado presente en `playwright-core/types`).

Luego, test de humo funcional:
```bash
npm run dev          # abre WebChat en :3333
# visita http://localhost:3333/browser.html
# en el chat: "abre example.com y dime qué botones hay"
# esperado: browser_session open → browser_observe → mapa de elementos + screencast en el panel
```

Y el test del filtro (ya verde, re-confírmalo):
```bash
npx vitest run src/memory/__tests__/contradiction_filter.test.ts
```

---

## 6. Plan de commits sugerido (lógicos, desde tu terminal real)

```bash
# 0) Neutraliza el ruido CRLF primero
git config core.autocrlf false
git add -A --renormalize .   # opcional; o añade selectivamente como abajo

# 1) Auditoría + fixes
git add src/memory/contradiction_filter.ts src/memory/__tests__/contradiction_filter.test.ts \
        scripts/shinobi.ts src/sandbox/registry.ts src/web/server.ts \
        src/types/mjs_modules.d.ts tsconfig.json
git commit -m "fix(audit): B1 ContradictionFilter + B3-B6 type errors (ver DOSSIER_AUDITORIA_2026-06-06)"

# 2) Tools/skills por lenguaje natural
git add src/skills/skill_manager.ts src/constants/prompts.ts src/coordinator/orchestrator.ts
git commit -m "feat(nl): matching de skills tolerante + TOOL-FIRST/PLAN en prompt + traza [PLAN]/[skill]"

# 3) Subsistema de navegador Kage
git add src/browser/ src/tools/browser_observe.ts src/tools/browser_act.ts \
        src/tools/browser_session.ts src/tools/index.ts src/security/approval.ts \
        src/web/public/browser.html skills/approved/kage-browser-operator.skill.md \
        docs/BROWSER_SUBSYSTEM.md
git commit -m "feat(browser): subsistema Kage observe→act→verify con screencast, input-lock y consent"

# 4) Higiene: CI, hook, docs, archivado
git add .github/workflows/ci.yml .githooks/ ARCHITECTURE.md .gitignore archive/ \
        DOSSIER_AUDITORIA_2026-06-06.md HANDOFF_COWORK_2026-06-06.md
git commit -m "chore(audit): CI tsc estricto, hook anti-secretos, docs, archivado de sprints"
```

> El hook `.githooks/pre-commit` se ejecutará y bloqueará si detecta claves en el
> diff. Ninguno de estos archivos tiene secretos; si diera falso positivo,
> `git commit --no-verify`.

---

## 7. Backlog de mejoras del subsistema Kage

Ordenado por valor/esfuerzo:

1. **Tests unitarios de Kage** (no hay aún): `observer` sobre HTML fixture
   (cuenta de elementos, refs, flag `sensitive`); `verifier.buildVerdict` con
   señales sintéticas; `consent.isSensitive` (password/submit/host nuevo).
   Mockear Playwright o usar una página estática local.
2. **E2E real** contra una página de prueba local (`demos/test_site/`) en CI con
   Playwright instalado: open → observe → type → click → verificar URL.
3. **Más acciones**: `hover`, `drag`, `upload` (file input), `wait_for` (texto/
   selector), `back/forward`, manejo de `<iframe>` (hoy el observer solo ve el
   documento top-level — limitación conocida).
4. **Observer en iframes y shadow DOM**: recorrer `shadowRoot` y frames anidados.
5. **Persistir `knownHosts`** entre sesiones (hoy es memoria volátil) para que el
   consentimiento de "host nuevo" no se repita en cada arranque.
6. **Diff de screenshot más fino** que el hash binario (p. ej. % de píxeles
   cambiados) para distinguir cambios reales de ruido de render.
7. **Throttle adaptativo del screencast** según ancho de banda del WS.
8. **Reconciliar con los tools legacy** (`browser_click`, `browser_scroll`): o
   deprecarlos formalmente o reimplementarlos sobre Kage para no tener dos
   caminos.
9. **Telemetría/audit** de cada `browser_act` con su veredicto (`verified`) para
   medir tasa de acciones efectivas — engancha con el `audit.jsonl` existente.

---

## 8. Notas de entorno para Claude Code

- Node 22 ESM, TypeScript 5, Playwright 1.59, `better-sqlite3`. tsc vía
  `npm run typecheck`.
- El gate de aprobaciones global está desactivado (FIX-002, `approval.ts`
  reporta siempre `off`). Kage NO depende de él: trae su propio `consent.ts`.
- WebChat sirve estáticos desde `src/web/public/` y WS en `/ws` (`server.ts`).
- Variables nuevas de Kage: `KAGE_CONSENT` (off|sensitive|all),
  `KAGE_CONSENT_TIMEOUT_MS`, `KAGE_SCREENCAST`, `KAGE_SCREENCAST_QUALITY`,
  `KAGE_SCREENCAST_MAX_FPS`. Defaults sanos en el código.
