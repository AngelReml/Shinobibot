# Validación FASE V2 — Sandbox browser remoto

Fecha: 2026-05-15. Servidor: `root@167.86.80.220` (Contabo).

## Resumen

| Item | Estado |
|---|---|
| Imagen Docker | `shinobi-sandbox-browser:latest` buildeada (debian-slim + chromium 148 + noVNC + xvfb + socat) |
| Contenedor | `shinobi-sandbox-browser` corriendo, puertos `127.0.0.1:6080` (noVNC) + `127.0.0.1:9222` (CDP) |
| CDP | `GET /json/version` → `Chrome/148.0.7778.96` ✅ |
| noVNC | `GET /vnc.html` → HTTP 200 ✅ |
| Integración Shinobi | `SHINOBI_BROWSER_CDP_URL` añadida a `src/tools/browser_cdp.ts` ✅ |
| Misión real | navegación a `github.com/digininja/DVWA` vía CDP del sandbox ✅ |

## Build

```bash
cd /opt/shinobibot
docker build -f Dockerfile.sandbox-browser -t shinobi-sandbox-browser:latest .
docker compose -f docker-compose.sandbox-browser.yml up -d
```

## Bug encontrado y corregido durante V2

Chromium moderno (v148) **ignora `--remote-debugging-address`** y siempre
bindea el CDP a `127.0.0.1` dentro del contenedor. El docker-proxy
reenvía a la interfaz `0.0.0.0` del contenedor, así que el CDP quedaba
inalcanzable desde fuera.

**Fix** (commit `6600d11`):
- Chromium usa `--remote-debugging-port=9221` (interno) + `--remote-allow-origins=*`.
- `socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9221` puentea el
  CDP a `0.0.0.0:9222`, ahora sí alcanzable.
- Dockerfile instala `socat`.

## Integración: `SHINOBI_BROWSER_CDP_URL`

`src/tools/browser_cdp.ts` → `connectOrLaunchCDP()` ahora respeta la
variable. Si está definida, conecta a ese endpoint sin auto-lanzar
browser local. El sandbox gestiona el navegador.

```bash
SHINOBI_BROWSER_CDP_URL=http://localhost:9222 npx tsx scripts/sprintV2/run_remote_browser_mission.ts
```

## Misión real ejecutada — evidencia cruda

Target: `https://github.com/digininja/DVWA` (sugerido por el plan).
Ejecutada **en el Contabo**, Shinobi apuntando al CDP del sandbox del
mismo host. **El navegador local del operador NO se tocó.**

```json
{
  "cdpUrl": "http://localhost:9222",
  "browserVersion": "148.0.7778.96",
  "navigatedUrl": "https://github.com/digininja/DVWA",
  "finalUrl": "https://github.com/digininja/DVWA",
  "pageTitle": "GitHub - digininja/DVWA: Damn Vulnerable Web Application (DVWA) · GitHub",
  "h1Text": "Search code, repositories, users, issues, pull requests...",
  "metaDescription": "Damn Vulnerable Web Application (DVWA). Contribute to digininja/DVWA development by creating an account on GitHub.",
  "bodyTextSample": "Skip to content Navigation Menu Platform Solutions Resources Open Source Enterprise Pricing Sign in Sign up digininja / DVWA Public Sponsor Notifications Fork 4.8k Star 13.1k Code Issues 1 Pull requests 4 Actions Projects Wiki Security and quality Insights digininja/DVWA master 2 Branches 11 Tags",
  "screenshotBytes": 130710,
  "elapsedMs": 7410
}
```

### Aserciones

```
ok  la página cargada menciona DVWA
ok  finalUrl es github.com
ok  screenshot capturado (130710 bytes)
ok  browser remoto reporta versión válida (148.0.7778.96)

MISIÓN OK · browser remoto navegó y extrajo datos reales sin tocar máquina local
```

Datos reales extraídos: 13.1k stars, 4.8k forks, 11 tags, 2 branches
del repo DVWA — confirmando que la navegación cargó contenido vivo de
GitHub, no caché ni mock. Tiempo total 7.4 s. Screenshot de 130 KB
capturado dentro del sandbox.

## Operación del sandbox

```bash
# Arrancar / parar
docker compose -f docker-compose.sandbox-browser.yml up -d
docker compose -f docker-compose.sandbox-browser.yml down

# Ver el browser en vivo (tras túnel SSH del 6080)
ssh -N -L 6080:localhost:6080 root@167.86.80.220
# luego abrir http://localhost:6080/vnc.html

# Logs del contenedor
docker logs shinobi-sandbox-browser
```

## Notas

- Los puertos 6080 y 9222 hacen bind a `127.0.0.1` del Contabo — no
  expuestos a internet. Acceso vía túnel SSH.
- Los errores `dbus`/`gcm` en `docker logs` son ruido normal de
  chromium headless, no afectan la operación.
- La misión se ejecutó con `waitUntil: 'domcontentloaded'` + 2.5 s de
  espera para contenido dinámico de GitHub.
