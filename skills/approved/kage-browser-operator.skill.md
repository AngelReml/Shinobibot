---
name: kage-browser-operator
description: Operar un sitio web real (navegar, rellenar formularios, login, extraer, clicar) con el subsistema Kage observe→act→verify.
trigger_keywords: [navegador, browser, web, navega, abre la pagina, abre la web, inicia sesion, login, formulario, rellena, clic, click, pestaña, sitio web, pagina web, entra en, busca en]
model_recommended: anthropic/claude-sonnet-4.6
created_at: "2026-06-06T00:00:00.000Z"
status: approved
source: manual
source_kind: manual
---

# Kage — operador de navegador

Playbook para manejar un sitio web real con calidad robusta. NO adivines
selectores CSS ni coordenadas: trabaja siempre por `ref` del mapa de elementos.

## Bucle de oro

1. **Abrir**: `browser_session {action:"open", url:"…"}`. Esto conecta y arranca
   el screencast (el usuario lo ve en el panel `/browser.html`).
2. **Observar**: `browser_observe`. Devuelve un mapa numerado:
   `[3] input "Correo" (email)`, `[4] button "Entrar" (submit)`. Cada elemento
   tiene un `ref` estable.
3. **Actuar por ref**: `browser_act {action:"type", ref:3, text:"…"}`, luego
   `browser_act {action:"click", ref:4, reobserve:true}`.
4. **Leer la verificación**: cada `browser_act` dice si la acción quedó
   `VERIFICADA` (cambió URL/DOM/pantalla) o `SIN EFECTO`. Si fue sin efecto,
   vuelve a `browser_observe` y replantea — NO repitas la misma acción a ciegas
   (el loop detector la cortaría).

## Reglas

- Tras una acción que cambia de página (navigate, submit, click que carga otra
  vista), **vuelve a observar** o usa `reobserve:true`. Los `ref` viejos ya no
  valen.
- Campos sensibles aparecen con `🔒sensitive`. Al escribir en ellos, o al pulsar
  envíos/login/pago, el sistema pedirá permiso al usuario por el panel. Espera
  su decisión; si deniega, no insistas — informa y ofrece alternativa.
- Para extraer datos de la página, `browser_observe` ya te da el texto de los
  elementos; para contenido extenso usa `clean_extract` sobre la URL.
- `click_xy` solo para lienzos canvas/WebGL sin DOM accesible.
- Si una pestaña concreta importa, enfócala con
  `browser_observe {url_contains:"…"}`.

## Ejemplo: login

```
browser_session {action:"open", url:"https://ejemplo.com/login"}
browser_observe
→ [2] input "Email" (email)  [3] input "Password" (password) 🔒  [4] button "Entrar" (submit)
browser_act {action:"type", ref:2, text:"usuario@correo.com"}
browser_act {action:"type", ref:3, text:"••••••"}   → pedirá permiso (campo sensible)
browser_act {action:"click", ref:4, reobserve:true}
→ Verificación: OK — la URL cambió a /dashboard
```
