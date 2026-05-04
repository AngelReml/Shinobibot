# Acción 5 — Deploy OG nuevo a VPS Contabo

**Tiempo: ~10 min**
**Desbloquea**: todos los endpoints nuevos viven en `kernel.zapweave.com`:
- `/v1/audit/*` (event, profile, deviation)
- `/v1/telemetry/*`
- `/v1/openbrain/*` (match, invoke, feedback)
- `/v1/benchmark/auto-gen`
- `/v1/skills/reflect`
- Dashboards: `/dashboard/audit/deviation`, `/dashboard/telemetry`

## Pre-flight

Desde tu máquina local, asegúrate que el código en GitHub está al día:

```powershell
cd C:\Users\angel\Desktop\OpenGravity
git status                        # working tree clean
git log --oneline origin/main..HEAD  # debería estar vacío (todo pusheado)
```

## Pasos en VPS

### 1. SSH y backup snapshot

```bash
ssh root@167.86.80.220

cd /root/OpenGravity

# Snapshot del estado actual antes de tocar nada
git rev-parse HEAD > /root/og_pre_deploy.sha
date > /root/og_pre_deploy.ts
echo "Pre-deploy snapshot: $(cat /root/og_pre_deploy.sha) at $(cat /root/og_pre_deploy.ts)"

# Backup del .env del servidor (NO está en git, contiene secrets reales)
cp .env /root/og.env.backup-$(date +%Y%m%d-%H%M%S)
```

### 2. Pull del código nuevo

```bash
git fetch origin main
# Inspeccionar antes de mergear:
git log --oneline HEAD..origin/main | head -30

# Aplicar
git pull origin main
```

### 3. Reinstalar dependencias

```bash
# Si package.json no cambió, este paso es no-op (npm ci respeta lockfile)
npm ci
```

### 4. Verificar TypeScript compila

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v browser_manager | head -20
# Esperado: sin output (sólo el preexistente browser_manager si lo hay)
```

### 5. Reiniciar el servicio systemd

```bash
systemctl restart opengravity.service
sleep 3
systemctl status opengravity.service --no-pager | head -20
```

Buscar en el output `Active: active (running)` y la última línea de log similar a:

```
[OPENGRAVITY_API_GATEWAY] Running on port 9900
```

### 6. Smoke tests post-deploy

```bash
# Health
curl -s https://kernel.zapweave.com/v1/health
# Esperado: {"status":"online","version":"1.0.0","n8n_status":"online"}

# Version
curl -s https://kernel.zapweave.com/v1/version
# Esperado: {"success":true,"component":"shinobi","latest_version":"1.0.0",...}

# Endpoints nuevos (requieren auth):
KEY="sk_dev_master"  # o tu key real

# OpenBrain match
curl -s -X POST https://kernel.zapweave.com/v1/openbrain/match \
  -H "Content-Type: application/json" -H "X-Shinobi-Key: $KEY" \
  -d '{"task":"test deploy","required_capabilities":["testing"]}' | head -c 300

# Audit profile (un agente cualquiera, devuelve estado calibrating si no existe)
curl -s -H "X-Shinobi-Key: $KEY" \
  https://kernel.zapweave.com/v1/audit/profile/post-deploy-test | head -c 300

# Telemetry summary
curl -s -H "X-Shinobi-Key: $KEY" \
  https://kernel.zapweave.com/v1/telemetry/summary | head -c 300

# Skills reflect
curl -s -H "X-Shinobi-Key: $KEY" \
  https://kernel.zapweave.com/v1/skills/reflect | head -c 300
```

### 7. Verificar dashboards (en navegador)

```
https://kernel.zapweave.com/dashboard/audit/deviation
https://kernel.zapweave.com/dashboard/telemetry
https://kernel.zapweave.com/dashboard/live    (improve_live SSE)
```

Pegar `sk_dev_master` (o tu key) en el input y "reload".

### 8. (Opcional) Setear las env vars de release manifest

Si quieres que `/v1/version` devuelva un download_url real:

```bash
# En /root/OpenGravity/.env, añadir:
SHINOBI_LATEST_VERSION=1.0.0
SHINOBI_LATEST_INSTALLER_URL=https://github.com/AngelReml/Shinobibot/releases/download/v1.0.0/shinobi-portable-1.0.0.zip
SHINOBI_LATEST_RELEASED_AT=2026-05-04
SHINOBI_RELEASE_CHANNEL=stable

systemctl restart opengravity.service
```

## Rollback (si algo falla)

```bash
ssh root@167.86.80.220
cd /root/OpenGravity

PRE=$(cat /root/og_pre_deploy.sha)
git reset --hard "$PRE"
systemctl restart opengravity.service

# Verificar:
curl -s https://kernel.zapweave.com/v1/health
```

## Script auto-deploy (uso opcional con tu confirmación previa)

Si en el futuro quieres que IA ejecute esto, requeriría:
- Acceso SSH a `root@167.86.80.220` desde el entorno de la sesión.
- Tu OK explícito a "deploy a VPS" para esa sesión específica.

El contrato actual (`respuestas.txt`) es: **NO deploy automático**. Esta acción la haces tú.

## Plan B — pull manual mínimo

Si por alguna razón no quieres hacer `git pull`, puedes copiar archivos uno por uno. La lista mínima de archivos nuevos críticos:

```
src/skills/skill_index.ts
src/audit/deviation_score.ts
src/openbrain/registry.ts
src/openbrain/SPEC.md
src/api/v1/audit_router.ts
src/api/v1/openbrain_router.ts
src/api/v1/telemetry_router.ts
src/api/v1/router.ts                     (modificado)
src/api/gateway.ts                       (modificado: 2 dashboard handlers + SSE pre-auth)
src/dashboard/server.ts                  (modificado: /api/webhook/n8n)
src/benchmark/auto_gen/generator.ts
src/benchmark/shinobi/{events.ts,improve.ts mods, runner.ts mods, ledger.ts, types.ts, candidate_generator.ts, sandbox.ts, store.ts, verifiers.mjs}
src/audit/event_log.ts
src/telemetry/store.ts
dashboard/{deviation.html, telemetry.html}
```

Pero `git pull` es trivialmente más limpio.

## Tiempo total real

- SSH + 6 pasos: 5-7 min.
- 7 smoke tests: 2 min.
- Restart service y propagación: 30s.
- Verificar dashboards en browser: 1 min.

**Total ~10 min** si todo va bien.
