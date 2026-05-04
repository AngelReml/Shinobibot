# Manual actions — paquete listo para Iván

Cada subdoc tiene **scripts copiar-pegar**. Total ~1h 40 min si se hacen todas.

## Las 6 acciones

| # | Doc | Tiempo | Tipo |
|---|-----|--------|------|
| 1 | [01_inno_setup.md](01_inno_setup.md) | 5 min | Install + compile (`installer/shinobi.iss` ya listo) |
| 2 | [02_email_routing.md](02_email_routing.md) | 10 min | Cloudflare UI |
| 3 | [03_github_secrets.md](03_github_secrets.md) | 15 min | UI + (opcional) gh CLI |
| 4 | [04_dns.md](04_dns.md) | 30 min | Cloudflare UI + propagación |
| 5 | [05_deploy_vps.md](05_deploy_vps.md) | 10 min | SSH + script `05_deploy_vps.sh` |
| 6 | [06_discord.md](06_discord.md) | 30 min | UI Discord + webhook → cierra secret #3c |

## Orden recomendado

1 → 2 → 3 (sin DISCORD_WEBHOOK_URL todavía) → 4 → 5 → 6 → 3c (rellenar webhook).

## Lo que NO está aquí

- **Whisper API key** (B3 voice mode): bloqueado por dep externa. Cuando lo tengas, hay un TODO en `manual_actions.md` raíz.
- **Compra dominios AuditGravity**: optional. Sólo si decides marca propia para B2B.
- **E2 hacer público shinobibot**: tu decisión. Bandera en `docs/sessions/2026-05-04_criba_closure.md`.
- **MutationEngine LLM live test**: requiere OPENROUTER_API_KEY + revisión manual. `OpenGravity/src/experimental/v1_engine/STATUS.md` describe el procedimiento.

## Auto-fill propuesto (requiere tu OK siguiente sesión)

En el último prompt, propusiste (d): "Auto-fill TRIAGE_LLM_KEY usando OPENROUTER_API_KEY si yo te lo confirmo". Yo no lo ejecuté en este turno porque pediste solo (b). Cuando me lo digas, en una sesión futura:

```
Tú: "Sí, usa OPENROUTER_API_KEY del .env de OG como TRIAGE_LLM_KEY."
Yo:  ejecuto el script de set_secret descrito en 03_github_secrets.md
     y verifico con `gh secret list`.
```

Es seguro hacerlo porque:
- La key ya existe en tu disco local (`.env` de OG).
- GitHub Secrets API exige cifrado libsodium con la public key del repo — el TOKEN del git credential manager basta para subirlo, sin exponer la key en logs.
- El secret no se puede leer una vez subido, sólo regenerar.

Pero NO lo hago sin tu confirmación expresa.
