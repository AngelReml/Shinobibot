# Acción 3 — 3 secrets en GitHub

**Tiempo: ~15 min**
**Desbloquea**: build log incluye OG · triage LLM mejor · release notifications a Discord.

## Los 3 secrets

| Nombre | Tipo | Quién lo necesita | Sin él |
|---|---|---|---|
| `BUILD_LOG_PAT` | fine-grained PAT | `pages.yml` (build_log_generate.mjs) | salta OG con warning |
| `TRIAGE_LLM_KEY` | OpenRouter / OpenAI key | `issue_triage.yml` | usa fallback heurístico |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL | `release.yml` | salta notificación silente |

## Opción A — Por UI (recomendado)

Ir a `https://github.com/AngelReml/Shinobibot/settings/secrets/actions`.

### Secret 1: BUILD_LOG_PAT

1. **Crear el PAT**:
   - Ir a `https://github.com/settings/personal-access-tokens/new`
   - Token name: `shinobi-build-log`
   - Expiration: 1 year (o `No expiration` si quieres olvidarte; menos seguro)
   - Repository access: **Only select repositories** → `AngelReml/Shinobibot`, `AngelReml/OpenGravity`, `AngelReml/shinobi-bench`
   - Permissions → Repository permissions:
     - **Contents**: `Read-only` ✓
     - (todo lo demás: `No access`)
   - Generate token → **copia el `github_pat_...`** (no se vuelve a mostrar)

2. **Pegarlo como secret**:
   - `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `BUILD_LOG_PAT`
   - Secret: `<paste>`
   - Add secret

### Secret 2: TRIAGE_LLM_KEY

Lo más barato es OpenRouter (puedes usar la misma key que tienes para OG):

1. Si ya tienes `OPENROUTER_API_KEY` en `.env` local de OG, **es la misma key**. Cópiala.
2. Si no, crea una en `https://openrouter.ai/keys` con un límite de gasto bajo (ej. $5/mes).

`Settings → Secrets → New`:
- Name: `TRIAGE_LLM_KEY`
- Secret: `sk-or-...`

### Secret 3: DISCORD_WEBHOOK_URL

Esta requiere primero **crear el server Discord** (acción 6). Puedes:
- Hacerlas en orden: 6 → 3c.
- O dejar este secret vacío por ahora — `release.yml` skipea silente y todo lo demás funciona.

## Opción B — Por gh CLI (más rápido si lo tienes)

```bash
# Pre-requisitos:
#   gh CLI instalado y authenticated:  gh auth login

cd C:\Users\angel\Desktop\shinobibot

# 1. BUILD_LOG_PAT (después de crearlo en la UI):
echo "github_pat_xxxxxxxxxx" | gh secret set BUILD_LOG_PAT

# 2. TRIAGE_LLM_KEY (cópialo de tu .env):
echo "sk-or-xxxxxxxxxx" | gh secret set TRIAGE_LLM_KEY

# 3. DISCORD_WEBHOOK_URL (después de la acción 6):
echo "https://discord.com/api/webhooks/.../..." | gh secret set DISCORD_WEBHOOK_URL

# Verificar:
gh secret list
```

## Plantilla `.env.local` para auto-fill TRIAGE

Si quieres que **yo** te lo configure desde una sesión futura (con tu permiso), el flag mencionado en (d) sería:

```
"Sí, usa OPENROUTER_API_KEY del .env de OG como TRIAGE_LLM_KEY"
```

Y yo ejecutaría:

```bash
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
KEY=$(grep '^OPENROUTER_API_KEY=' /c/Users/angel/Desktop/OpenGravity/.env | cut -d= -f2-)
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/AngelReml/Shinobibot/actions/secrets/TRIAGE_LLM_KEY \
  -d "$(node -e "
    const sodium = require('libsodium-wrappers');
    (async () => {
      await sodium.ready;
      const pubKeyResp = await fetch('https://api.github.com/repos/AngelReml/Shinobibot/actions/secrets/public-key', {
        headers: { Authorization: 'Bearer $TOKEN', Accept: 'application/vnd.github+json' }
      }).then(r => r.json());
      const messageBytes = Buffer.from(process.env.SECRET_VAL, 'utf8');
      const keyBytes = Buffer.from(pubKeyResp.key, 'base64');
      const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
      console.log(JSON.stringify({ encrypted_value: Buffer.from(encrypted).toString('base64'), key_id: pubKeyResp.key_id }));
    })();
  ")"
```

(En la sesión real lo simplificaría con un script pequeño en `scripts/set_secret.mjs`. No lo construyo ahora porque dijiste "ejecuta SOLO (b)".)

## Verificación

Después de configurar:

1. **BUILD_LOG_PAT**: dispara `gh workflow run pages.yml` o haz un commit a `web/`. El step "Generate build log" debería incluir todos los repos sin warning de OpenGravity.
2. **TRIAGE_LLM_KEY**: abre una issue de prueba en el repo. `issue_triage.yml` corre y debería etiquetar + responder. Si la clasificación es razonable y el response incluye `"classifier":"llm-with-heuristic-fallback"` en los logs, está usando el LLM.
3. **DISCORD_WEBHOOK_URL**: dispara un release manual `gh workflow run release.yml -f version=1.0.1`. Tras el run, deberías ver un mensaje en el canal de Discord.

## Rotación

- El PAT expira en 1 año. Pon recordatorio en calendario.
- TRIAGE_LLM_KEY: rota cuando rotes la de OpenRouter.
- DISCORD_WEBHOOK_URL: rota si publicas el repo (E2) — los webhooks en commits viejos siguen siendo accesibles a quien clone el repo, así que mejor regenerar antes de hacer público.
