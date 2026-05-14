# Configuración de canales (Sprint 1.3)

Shinobi ofrece adaptadores de canal opt-in. La arquitectura compila los
adaptadores siempre, pero cada uno solo arranca si **todas** sus variables
de entorno están definidas. Si faltan, el canal queda **skipped** sin
errores. El registry muestra el estado en `summary()` y en el endpoint
de diagnóstico.

> Si alguno de estos adaptadores requiere alta de cuenta humana (Discord,
> Slack, WhatsApp Business, Teams), **Shinobi NO crea cuentas por ti**.
> Tienes que generar el bot/token tú y pegarlo en `.env`.

## WebChat (incluido, sin config)

`/ws` + `/api/*`. Sin token. Arranca con `npm run dev`.

## Telegram

```
TELEGRAM_BOT_TOKEN=...           # @BotFather → /newbot
TELEGRAM_ALLOWED_USER_IDS=...    # CSV, opcional
```

## HTTP REST gateway

```
SHINOBI_HTTP_GATEWAY_TOKEN=...   # Bearer auth
```

## Discord (Sprint 1.3, nuevo)

1. Crea una app en https://discord.com/developers/applications.
2. Sección "Bot" → Add Bot → copia el token.
3. Habilita **Privileged Gateway Intents** → "MESSAGE CONTENT INTENT".
4. Invita el bot a tu servidor con permisos `Read Messages`, `Send Messages`,
   `Read Message History`.
5. Instala la dep opcional: `npm install discord.js`.

```
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_GUILDS=...        # CSV de guild IDs, opcional
```

## Slack (Sprint 1.3, nuevo)

1. Crea una app en https://api.slack.com/apps.
2. Habilita **Socket Mode**, genera `SLACK_APP_TOKEN` (xapp-...).
3. OAuth & Permissions → añade bot scopes: `chat:write`, `channels:history`,
   `app_mentions:read`, `im:history`, `im:read`, `im:write`.
4. Install to Workspace → copia `SLACK_BOT_TOKEN` (xoxb-...).
5. Event Subscriptions → suscribe a `message.channels`, `message.im`,
   `app_mention`.
6. Instala la dep opcional: `npm install @slack/bolt`.

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

## Email IMAP+SMTP (Sprint 1.3, nuevo)

Cualquier proveedor con IMAP/SMTP estándar. Si usas Gmail necesitas un
"App password" (https://myaccount.google.com/apppasswords) — la
contraseña de la cuenta normal no funciona desde 2022.

```
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=tucorreo@gmail.com
IMAP_PASS=app-password-de-16-chars
IMAP_TLS=true

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tucorreo@gmail.com
SMTP_PASS=app-password-de-16-chars
SMTP_TLS=false                    # true para puerto 465

EMAIL_ALLOWED_SENDERS=...         # CSV de emails permitidos, opcional
```

Instala las deps opcionales: `npm install imapflow nodemailer mailparser`.

## Diagnóstico

`channelRegistry().summary()` devuelve por cada adaptador:
- `configured` (boolean)
- `requires` (lista de env vars necesarias)
- `running` / `received` / `sent`
- `error` (último error si hubo)

El comando `npm run channels:test` ejecuta una prueba E2E con el adaptador
loopback (sin credenciales) y muestra qué env vars faltan a cada uno de
los reales.
