# Modo agente residente 24/7

Antes de este bloque, Shinobi sólo vivía mientras el usuario tenía abierto el CLI. Para misiones recurrentes (cron-skill que vigila Hermes, recordatorios, watchers de feeds, etc.) eso no sirve. Esta arquitectura cubre el modo "headless 24/7".

## Componentes

```
┌──────────────────────────┐
│  Windows Service          │  install_service.ps1 (sc.exe + recovery flags)
│  ShinobiDaemon (auto)     │
└──────────┬────────────────┘
           │ launches
           ▼
┌──────────────────────────┐
│  scripts/_shinobi_daemon  │  wrapper batch — cd + log redirect
│  .cmd (auto-generado)     │
└──────────┬────────────────┘
           │ executes
           ▼
┌──────────────────────────┐
│  shinobi daemon (CLI)     │  argv dispatch en scripts/shinobi.ts
│  - sin REPL               │
│  - SIGINT/SIGTERM clean   │
│  - heartbeat 5 min        │
└──────────┬────────────────┘
           │ owns
           ▼
┌──────────────────────────┐
│  ResidentLoop             │  src/runtime/resident_loop.ts
│  - tick cada 30s          │
│  - SQLite missions.db     │
│  - retry counter          │
│  - notify a 3 fallos      │
└──────────────────────────┘
```

## Comandos

```sh
# Foreground (debug):
shinobi daemon

# Como servicio Windows (Administrator PowerShell):
.\scripts\install_service.ps1            # registra + arranca
.\scripts\install_service.ps1 -Uninstall # detiene + borra
```

## Persistencia

- `%APPDATA%/Shinobi/missions.db` — tabla `missions_recurrent` y `mission_logs`.
- `%APPDATA%/Shinobi/daemon.log` — stdout/stderr del servicio.

## Recovery

`sc.exe failure ShinobiDaemon reset= 86400 actions= restart/5000/restart/15000/restart/60000`:
- 1er fallo en 24h → restart tras 5s
- 2º fallo → restart tras 15s
- 3er fallo → restart tras 60s
- 4º+ → no más reintentos (anti-loop)

Si el daemon crashea a propósito (ej. update mechanism), el servicio se reinicia solo. Si el problema es persistente, los logs y el sc.exe failure history lo evidencian.

## Limitaciones conocidas

- El daemon no procesa input del usuario; las nuevas misiones se añaden en una sesión interactiva (`shinobi` → `/resident add ...`) y la siguiente tick las recoge porque la SQLite está compartida.
- El servicio corre con la cuenta `LocalSystem` por defecto; el `%APPDATA%/Shinobi/` resuelve al perfil del system user, no al usuario interactivo. Para runtime con HOME del usuario, modificar el `install_service.ps1` para usar `obj= ".\<user>"` (requiere password).
- Auto-update vía B2 funciona, pero el installer se bloqueará si el servicio tiene `shinobi.exe` cargado. La rutina recomendada: `sc.exe stop ShinobiDaemon` antes del update y `sc.exe start ShinobiDaemon` después. El installer Inno Setup (B1) puede ejecutar esto en su `[Run]` block.

## Test manual

```sh
# Foreground
shinobi daemon
# Esperado:
# [shinobi-daemon] resident loop started — pid=NNN
# [ResidentLoop] started. Tick interval: 30s
# (cada 5 min)
# [shinobi-daemon] heartbeat 2026-...
# Ctrl+C para parar
# [shinobi-daemon] SIGINT received — stopping loop
# [ResidentLoop] stopped.
```

## Test E2E

`src/runtime/__tests__/resident_daemon.test.ts` — spawn the daemon as subprocess, assert heartbeat in stdout, send SIGTERM, assert clean exit.
