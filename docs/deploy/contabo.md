# Deploy de Shinobi en Contabo (FASE V1)

Fecha: 2026-05-15. Servidor: `root@167.86.80.220` (Contabo VPS, Ubuntu 24.04, kernel 6.8).

## Estado del deploy

| Item | Estado |
|---|---|
| Repo clonado | `/opt/shinobibot` (HEAD `fb64bf8` al desplegar) |
| Node | v22.22.2 (ya instalado, no hizo falta instalar) |
| Dependencias | 602 paquetes vía `npm install` |
| `.env` | copiado vía `scp` desde el PC del operador → `/opt/shinobibot/.env` |
| Servidor web | corriendo en puerto **3333** (interno) |
| Healthcheck | `GET /api/status` → HTTP 200 |
| Exposición externa | **NO** — UFW solo permite el puerto 22. El 3333 queda interno. |

### Nota sobre `npm install` vs `npm ci`

El plan pedía `npm ci`, pero falla en Linux porque el `package-lock.json`
se generó en Windows y no incluye las binarias platform-specific de
`sharp` (`@img/sharp-linux-x64` etc.). Se usó `npm install`, que resuelve
las binarias Linux correctas. Es el workaround estándar para deploys
cross-plataforma. **Bug colateral documentado** (ver más abajo).

### Exposición

UFW está activo y solo permite el puerto 22 (SSH). El servidor web en el
3333 **no es accesible desde internet** — exactamente lo que pide el plan
("puerto interno"). Para acceder al WebChat desde el PC del operador, usar
un túnel SSH:

```bash
ssh -N -L 3333:localhost:3333 root@167.86.80.220
# luego abrir http://localhost:3333 en el navegador local
```

No se configuró reverse proxy ni se abrió el puerto: el plan lo
condiciona a "si el firewall lo permite", y no lo permite. Abrir el
puerto sería una decisión de exposición deliberada — queda para el
operador si la quiere.

## Operación

El launcher es `scripts/contabo/shinobi-web.sh`.

```bash
cd /opt/shinobibot

# Arrancar (background, logs persistentes)
./scripts/contabo/shinobi-web.sh start

# Parar
./scripts/contabo/shinobi-web.sh stop

# Reiniciar
./scripts/contabo/shinobi-web.sh restart

# Estado + healthcheck
./scripts/contabo/shinobi-web.sh status

# Ver logs en vivo
./scripts/contabo/shinobi-web.sh logs
```

### Ubicación de archivos

| Qué | Dónde |
|---|---|
| Código | `/opt/shinobibot` |
| Configuración / secretos | `/opt/shinobibot/.env` (NO versionado) |
| PID del servidor | `/opt/shinobibot/.run/shinobi-web.pid` |
| Log persistente | `/opt/shinobibot/.run/shinobi-web.log` |
| Memoria persistente | `/opt/shinobibot/memory.json` |
| Launcher | `/opt/shinobibot/scripts/contabo/shinobi-web.sh` |

### Variables relevantes

| Variable | Default | Uso |
|---|---|---|
| `SHINOBI_WEB_PORT` | 3333 | Puerto del servidor web |
| `SHINOBI_NOTIFY_ENABLED` | 0 (forzado por el launcher) | Silencia el notifier por email |
| `SHINOBI_GATEWAY_TOKEN` | — | Si se define, habilita gateway HTTP + Telegram |

## Verificación reproducible

```bash
ssh root@167.86.80.220 'curl -s http://localhost:3333/api/status'
# → {"model":"default","kernelOnline":false,"mode":"kernel","approval":"smart"}
```

## Bug colateral detectado (fuera de scope V1)

`npm ci` no funciona en el deploy Linux porque `package-lock.json` se
generó en Windows y le faltan las binarias `@img/sharp-linux-*`. No se
arregló dentro de esta fase (el plan dice no arreglar colaterales salvo
que bloqueen — y `npm install` desbloquea). **Fix pendiente:** regenerar
el lock en Linux o añadir `os`/`cpu` overrides, o documentar `npm install`
como el comando de deploy oficial.

## Update del deploy

```bash
ssh root@167.86.80.220
cd /opt/shinobibot
./scripts/contabo/shinobi-web.sh stop
git pull origin main
npm install --no-audit --no-fund
./scripts/contabo/shinobi-web.sh start
```
