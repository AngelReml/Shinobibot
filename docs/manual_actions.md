# Manual actions pendientes

Lista viva de acciones que el usuario debe hacer manualmente, según el contrato de
`respuestas.txt`. Cada entrada con eje, fecha de creación y status.

## Pendientes

### Bloque 1 (eje C) — 2026-05-04

- (ninguna por el momento; eje C completo se ejecuta vía API GitHub + repos locales).

### B4 — 6 skills desktop nativas Windows — 2026-05-04

Las 6 skills se cargan correctamente (lint + load 6/6 PASS) pero la **ejecución real** requiere verificación en máquina con software instalado. Por skill:

- [ ] `desktop-excel-open-and-extract` — abrir un `.xlsx` real, leer rango con `headerRow=true`, validar JSON
- [ ] `desktop-outlook-send-email` — enviar mail con `display=true` (no real-send) primero; luego un test real a una dirección propia
- [ ] `desktop-premiere-basic-cut` — corte 5s de un MP4, exportar; tarda varios minutos. Confirmar que `findPremiereExe()` localiza la versión instalada (revisar candidatos en `skill.mjs` si es 2027+)
- [ ] `desktop-obs-setup-scene` — habilitar obs-websocket en OBS (Tools > WebSocket Server Settings, `127.0.0.1:4455`), probar con scene name nuevo
- [ ] `desktop-photoshop-resize-export` — resize 1920x1080 sobre `.png`, validar JPEG resultante
- [ ] `desktop-chrome-login-and-action` — script trivial: `goto example.com` + `extract h1`. Confirmar que reusa la sesión de Chrome (no aparece pantalla de "first run")

## Diferidas (no abordar todavía)

### Eje B — Inno Setup
- [ ] Confirmar que Inno Setup está instalado en máquina dev antes de B1.
- [ ] Si no, instalar manualmente desde https://jrsoftware.org/isinfo.php.

### Eje D — naming + dominios
- [ ] Comprar dominio `audit.zapweave.com` (subdominio: configurar DNS en proveedor de zapweave.com).
- [ ] Resolver naming AgentAudit (validación dominio top 1) y comprar `.com`.

### Eje D — publicación SDKs
- [ ] Publicar `agentaudit-py` en PyPI con credenciales personales.
- [ ] Publicar `agentaudit-node` en npm con credenciales personales.

### Eje E — repo público
- [ ] Hacer público `AngelReml/shinobibot` (E2.1) cuando llegue el bloque correspondiente.

### Eje G — Discord webhook
- [ ] Crear Discord webhook para release notifications (G3.3) y pegar URL en config CI.

### Despliegue OpenGravity
- [ ] Tras cada cambio en `C:\Users\angel\Desktop\OpenGravity` que toque endpoints
      productivos, **el usuario** valida y ejecuta deploy al VPS Contabo
      (`ssh root@167.86.80.220`, `systemctl restart opengravity.service`).
