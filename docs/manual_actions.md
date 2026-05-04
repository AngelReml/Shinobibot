# Manual actions pendientes — versión criba (2026-05-04)

Lista condensada tras procesar `Reporte_Criba_Shinobi.docx`. La sesión "criba_closure" cerró todo lo automatizable; lo que queda son **6 acciones humanas reducidas al mínimo**.

Histórico detallado (TODOs por bloque) en `docs/sessions/` — esta lista es la canónica desde 2026-05-04.

## Las 6 acciones que solo Iván puede hacer

| # | Acción | Tiempo | Desbloquea |
|---|--------|--------|------------|
| 1 | Instalar Inno Setup (<https://jrsoftware.org/isinfo.php>) | 5 min | empaquetado `.exe` (verify_release pasa de skipped → green) |
| 2 | Cloudflare Email Routing → `hola@zapweave.com` a tu inbox | 10 min | comunicación con waitlist + landings |
| 3 | 3 secrets en `Settings → Secrets` de `AngelReml/Shinobibot` | 15 min | build log con OG · triage LLM · Discord notifs |
| 4 | DNS de subdominios en proveedor de zapweave.com | 30 min (incl. propagación) | `audit.zapweave.com`, `brain.zapweave.com` live |
| 5 | Deploy OG nuevo al VPS Contabo (cuando confirmes) | 10 min | `/v1/audit/*`, `/v1/telemetry/*`, `/v1/openbrain/*`, `/v1/benchmark/auto-gen` viven en kernel.zapweave.com |
| 6 | Crear servidor Discord siguiendo `docs/comunidad.md` | 30 min | comunidad pública + webhook (cierra el secret de #3) |

**Total: ~1h 40min.** El orden recomendado es 1 → 2 → 3 → 4 → 5 → 6.

## Detalle por acción

### 1. Inno Setup

```
Descargar: https://jrsoftware.org/isinfo.php
Instalar.
Después en máquina dev:
  cd C:\Users\angel\Desktop\shinobibot
  # crear installer/shinobi.iss siguiendo el plan B1 de Tareas..txt
  # compilar: ISCC.exe installer\shinobi.iss → build/ShinobiSetup-1.0.0.exe
  # commit + re-dispatch del workflow Release con input version=1.0.0
```

### 2. Cloudflare Email Routing

```
Cloudflare → zapweave.com → Email → Email Routing → habilitar
Crear ruta: hola@zapweave.com  →  <tu-mail-personal>
(opcional: contacto@, audit@, brain@ con la misma ruta)
```

### 3. Secrets en GitHub

`https://github.com/AngelReml/Shinobibot/settings/secrets/actions` → New repository secret:

- **`BUILD_LOG_PAT`**: fine-grained PAT (User → Settings → Developer settings → PATs → Fine-grained), permiso `Contents: read` sobre `AngelReml/Shinobibot`, `AngelReml/OpenGravity`, `AngelReml/shinobi-bench`. Sin él, el build log salta OG con un warning.
- **`TRIAGE_LLM_KEY`**: key de OpenRouter (<https://openrouter.ai/keys>). El bot de issues tiene fallback heurístico, pero con LLM clasifica mejor.
- **`DISCORD_WEBHOOK_URL`**: tras crear el server (acción #6), Server Settings → Integrations → Webhooks → New Webhook → copiar URL.

### 4. DNS

En el proveedor de `zapweave.com` (Cloudflare/Namecheap/...):

```
Type    Name    Value
CNAME   audit   <host>.netlify.app           # o redirect 301 a zapweave.com/audit/ vía Cloudflare Page Rules
A/AAAA  kernel  167.86.80.220                # ya configurado, verificar
CNAME   brain   kernel.zapweave.com          # opcional, vanity
```

Si `audit.zapweave.com` se aloja como redirect a `zapweave.com/audit/` desde Cloudflare, no necesitas otro static host — ya tenemos el contenido en GitHub Pages.

### 5. Deploy OG → VPS

```sh
ssh root@167.86.80.220
cd /root/OpenGravity
git pull origin main
npm ci
# Reiniciar el servicio
systemctl restart opengravity.service
# Verificar:
curl https://kernel.zapweave.com/v1/health
curl -X POST -H "Content-Type: application/json" -H "X-Shinobi-Key: sk_dev_master" \
  -d '{"task":"test"}' https://kernel.zapweave.com/v1/openbrain/match
```

Si algo falla, el log está en `journalctl -u opengravity -n 200`.

### 6. Discord

Seguir `docs/comunidad.md`. Tras crear:
- Generar webhook (`#release-notifications` channel).
- Pegar URL como secret `DISCORD_WEBHOOK_URL` (cierra acción #3c).

## Diferidas (no bloquean lanzamiento)

- **Whisper API key** o `whisper.cpp` local → desbloquea voice mode (B3). Marcado opcional hasta que se priorice.
- **Compra dominios AuditGravity**: `auditgravity.com` + `github.com/auditgravity` (RDAP libres al 2026-05-04). Sólo si decides empujar B2B con marca propia.
- **Hacer público shinobibot (E2)**: tu decisión. Queda como bandera al final de `2026-05-04_criba_closure.md`.

## Cosas IA NO puede hacer pero el usuario puede minimizar

- Smoke tests con apps abiertas (Excel/Outlook/Photoshop/Premiere/OBS): requieren apps instaladas + sesión interactiva. Documentación lista en cada `SKILL.md`. ~5 min por skill.
- Validación viva del MutationEngine LLM path: requiere OPENROUTER_API_KEY con créditos + revisar manualmente el patch propuesto. `OpenGravity/src/experimental/v1_engine/STATUS.md` detalla el procedimiento.
- Validación killer demo con OBS realmente arrancado: `shinobi demo --task killer --record` con OBS+obs-websocket activo. Producirá un .mp4.

## Resumen

Estado tras sesión 2026-05-04:
- 18 capacidades VERDES verificadas + 6 nuevas verdes esta sesión = **24 verdes en código + tests**.
- AMARILLOS reducidos a los que requieren apps reales abiertas.
- ROJOS reducidos a 3 (program-discovery diseñado pero no construido + 2 bloqueados por deps externas).
- Lista manual: **6 acciones, ~1h 40min**.
- Lanzamiento público es **decisión**, no bloqueo técnico.
