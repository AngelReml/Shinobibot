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

### H1-H5 — Self-recording demos — 2026-05-04

- [ ] Verificar `shinobi demo --task T16` con OBS arrancado (sin `--no-record`): debe abrir OBS si no está, configurar la escena `Shinobi Self-Recording`, grabar el shell, parar y devolver path MP4.
- [ ] Verificar `shinobi run-demo full-self-improve` con OBS arrancado: la grabación debe contener el spool completo de las 7 tareas narradas.
- [ ] Confirmar en OBS Studio que `Tools > WebSocket Server Settings` está habilitado en `127.0.0.1:4455` (la primera vez es manual).
- [ ] **Opcional (H5)**: subtítulos automáticos via Whisper. No incluido en B-bloque por dependencia (Whisper API o whisper.cpp local). Cuando se aborde B3 (voice mode) se podrá enchufar al demo runner por callback.

## Diferidas (no abordar todavía)

### Eje B — Inno Setup
- [ ] Confirmar que Inno Setup está instalado en máquina dev antes de B1.
- [ ] Si no, instalar manualmente desde https://jrsoftware.org/isinfo.php.

### Eje D — naming + dominios

**Naming decidido en D1 (2026-05-04): AuditGravity.**

- [ ] Comprar `auditgravity.com` (RDAP libre al 2026-05-04, ver `docs/decisions/D1_naming.md`).
- [ ] Reservar handle GitHub `auditgravity` (libre al 2026-05-04).
- [ ] Configurar DNS de `audit.zapweave.com` apuntando al frontend cuando D3 esté desplegado.
  - Opción A (recomendada): añadir un CNAME `audit` → `<tu-host-de-redirect>` y configurar redirect 301 a `https://zapweave.com/audit/`. GitHub Pages sólo sirve un único custom domain por repo, así que la landing real ya está accesible en `zapweave.com/audit/` tras el deploy de la PR D3.
  - Opción B: alojar `audit.zapweave.com` en otro static host (Cloudflare Pages, Netlify) apuntando a la misma carpeta `web/audit/`.
- [ ] Crear formulario Formspree para la landing AuditGravity y reemplazar `REPLACE_FORMSPREE_AUDIT` en `web/audit/index.html`.

### Eje D — publicación SDKs

Renombrados a `auditgravity-py` / `auditgravity-node` tras decisión D1.

- [ ] Publicar `auditgravity` en PyPI: `cd OpenGravity/sdks/python && python -m build && twine upload dist/*`. Requiere reservar el nombre y crear el proyecto antes.
- [ ] Publicar `auditgravity` en npm: `cd OpenGravity/sdks/node && npm publish --access public`. Requiere `npm login` con cuenta del usuario.

### Eje E — repo público
- [ ] Hacer público `AngelReml/shinobibot` (E2.1) cuando llegue el bloque correspondiente.

### Eje G — Discord webhook
- [ ] Crear Discord webhook para release notifications (G3.3) y pegar URL en config CI.

### Despliegue OpenGravity
- [ ] Tras cada cambio en `C:\Users\angel\Desktop\OpenGravity` que toque endpoints
      productivos, **el usuario** valida y ejecuta deploy al VPS Contabo
      (`ssh root@167.86.80.220`, `systemctl restart opengravity.service`).
