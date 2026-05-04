# Acción 6 — Crear servidor Discord + webhook

**Tiempo: ~30 min**
**Desbloquea**: comunidad pública + cierra el secret `DISCORD_WEBHOOK_URL` de la acción 3.

## Por qué a mano

Discord exige que el servidor lo cree una persona física logueada. Hacerlo con un bot daría un servidor "huérfano" sin owner claro. Tu inversión: 30 min una vez.

## Guía completa

`docs/comunidad.md` ya tiene el plan canales + roles + reglas + plantilla de mensaje #welcome. **Esta doc complementa con la pieza que falta**: webhook → secret GitHub.

## Pasos resumen

### 1. Crear servidor + canales

Sigue `docs/comunidad.md` paso 1-3. (10 min)

### 2. Crear webhook para release notifications

```
Server Settings → Integrations → Webhooks → New Webhook

  Name:    GitHub Releases
  Channel: #anuncios          (el canal solo-lectura para releases)
  Avatar:  (opcional, sube logo Shinobi)

  → "Copy Webhook URL"
  → guarda en algo seguro temporalmente (1Password, post-it físico, etc.)
```

La URL tiene este formato:

```
https://discord.com/api/webhooks/<channel_id>/<token>
```

### 3. Pegarla como secret en GitHub

#### Por UI

```
https://github.com/AngelReml/Shinobibot/settings/secrets/actions
→ New repository secret
  Name:   DISCORD_WEBHOOK_URL
  Secret: <pega la URL completa>
→ Add secret
```

#### Por gh CLI

```bash
echo "https://discord.com/api/webhooks/.../..." | gh secret set DISCORD_WEBHOOK_URL --repo AngelReml/Shinobibot
```

### 4. Test del webhook (sin esperar a un release)

```bash
WEBHOOK="https://discord.com/api/webhooks/.../..."

curl -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "shinobi-test",
    "content": "Test webhook desde shinobibot — si ves este mensaje, está bien configurado."
  }'
```

Deberías ver el mensaje en `#anuncios` en <2 segundos.

### 5. (Opcional) Plantilla de mensaje rich embed

Si quieres que las release notifications se vean bonitas, edita `.github/workflows/release.yml` reemplazando el bloque actual:

```yaml
- name: Notify Discord
  if: steps.ver.outputs.tag_exists == 'false' && env.DISCORD != ''
  shell: pwsh
  env:
    DISCORD: ${{ secrets.DISCORD_WEBHOOK_URL }}
  run: |
    $payload = @{
      username = "shinobi-releases"
      embeds = @(@{
        title = "Shinobi ${{ steps.ver.outputs.version }} shipped"
        url = "https://github.com/${{ github.repository }}/releases/tag/${{ steps.ver.outputs.tag }}"
        color = 5814783
        timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        fields = @(
          @{ name = "version"; value = "${{ steps.ver.outputs.version }}"; inline = $true }
          @{ name = "tag";     value = "${{ steps.ver.outputs.tag }}";     inline = $true }
        )
        footer = @{ text = "github actions / shinobibot" }
      })
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method Post -Uri $env:DISCORD -ContentType 'application/json' -Body $payload
```

Versus el simple `content: "Shinobi 1.0.0 shipped — <url>"` que está actualmente. Ambos funcionan; el embed es más vistoso si vas a publicitar la comunidad.

## Plantilla de mensaje #welcome (para pegar tras crear el server)

```
👋 Bienvenidos a **Zapweave / Shinobi**.

Esto es la comunidad técnica detrás de:
- **Shinobi** — agente autónomo Windows-native (https://zapweave.com)
- **OpenGravity** — kernel verificable de auditoría de agentes (https://kernel.zapweave.com)
- **AuditGravity** — producto B2B de behavioral verification (https://zapweave.com/audit/)
- **OpenBrain** — protocolo abierto para delegación entre agentes
- **shinobi-bench** — benchmark público (https://github.com/AngelReml/shinobi-bench)

**Reglas:**
1. Sin spam, sin reposts, sin promo gratis ajena.
2. Inglés y español ambos OK.
3. Las cosas internas en su canal; los anuncios públicos en #anuncios solo los hago yo.
4. Si vienes a aprender, pregunta sin miedo. Si vienes a vender, pasa por DM antes.

**Para empezar:**
- 📦 Descarga Shinobi en https://github.com/AngelReml/Shinobibot/releases (cuando hagamos el repo público)
- 📚 Docs: https://zapweave.com/docs.html
- 🐛 Bugs e ideas: GitHub Issues (link arriba)
- 💬 Charla técnica: #general, #ideas, #showcase

— Iván
```

(Adapta los URLs de Releases cuando E2 pase shinobibot a público.)

## Verificación final

Después de configurar:

```bash
# Disparar un release manual de prueba (versión bump a 1.0.1):
# Edita package.json → version: "1.0.1"
git commit -am "release(test): bump for webhook test"
git push origin main

# El workflow Release corre, crea tag/release, y al final dispara Discord.
# Verifica que ves el mensaje en #anuncios.
```

Si no ves el mensaje pero el resto del workflow sale verde, el problema es el secret (revisa que esté bien pegado, sin saltos de línea al final).

## Mantenimiento

- Si rotas el webhook (alguien lo filtró, etc.), hay que actualizar el secret en GitHub.
- Si cambias el canal `#anuncios` a otro nombre, el webhook no necesita cambiar — está atado al channel_id, no al nombre.
- Si haces público el repo (E2), considera regenerar el webhook **antes** del push público porque commits viejos del workflow tienen el nombre del secret expuesto (no el valor) y un atacante con CI access podría leerlo.
