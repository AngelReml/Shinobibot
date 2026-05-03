# Zapweave · Shinobi + OpenGravity

**Shinobi** es un asistente AI de escritorio para Windows pensado para
**YouTubers hispanos que adaptan formatos de canales en inglés**: investiga,
transcribe, encuentra patrones (hooks, estructura, miniaturas) y te entrega
un brief para localizar el formato a tu canal.

**OpenGravity** es la infraestructura cloud opcional que ejecuta misiones
grandes (research masivo, modelos premium, jobs largos) sin colgar tu PC.

Web: <https://zapweave.com>
Email: <hola@zapweave.com>

---

## Estado de los bloques

| Bloque | Tema | Estado |
|--------|------|--------|
| B0 | Bootstrap del agente y memoria local | ✅ cerrado |
| B1 | Tools de archivo y comando | ✅ cerrado |
| B2 | Migración a OpenGravity para LLM | ✅ cerrado |
| B3 | Bridge HTTP con el Kernel | ✅ cerrado |
| B4 | Memoria persistente con SQLite + sqlite-vec | ✅ cerrado |
| B5 | Memoria semántica fase C (embeddings) | ✅ cerrado |
| B6 | Misiones recurrentes y resident loop | ✅ cerrado |
| B7 | Skills cargables bajo demanda | ✅ cerrado |
| B8 | Web automation (Playwright CDP) | ✅ cerrado |
| B9 | Operación de apps de escritorio (`screen_observe`/`screen_act`) | ✅ cerrado |
| B10 | n8n / workflows externos | ✅ cerrado |
| B11 | Tests E2E end-to-end | ✅ cerrado |
| B12 | Empaquetado a `.exe` (Node SEA) | ✅ cerrado |
| B13 | Setup comercial: zapweave.com, precios, docs | ✅ cerrado |

---

## Setup de desarrollo

```bash
# 1. Clonar y entrar
git clone <repo-url> shinobibot && cd shinobibot

# 2. Instalar deps
npm install

# 3. Configurar .env
cp .env.example .env
# edita y rellena al menos: OPENAI_API_KEY (o OPENROUTER_API_KEY)
# y, si usas el cloud, OPENGRAVITY_URL + SHINOBI_API_KEY.

# 4. Arrancar en modo dev (TypeScript directo)
npm run dev

# 5. Probar B9 (mueve mouse/teclado en Notepad — no lo corras AFK)
npx tsx test_b9.ts
```

### Build del .exe distribuible

```bash
node build_sea.mjs           # produce build/shinobi.exe
./rebuild.cmd                # rebuild rápido durante desarrollo
./rebuild_test.cmd           # rebuild + smoke test
```

### Estructura

```
src/
  coordinator/    Bucle principal de tools (orchestrator.ts)
  tools/          Tools nativas (file, run_command, screen_*, browser_*, etc.)
  cloud/          Cliente OpenGravity (HTTP)
  bridge/         Puente al Kernel
  db/             Memoria persistente (memory.ts, context_builder.ts)
  memory/         Memory store con embeddings
  utils/          Permisos, kill switch, vision client, etc.
  runtime/        First-run wizard, resident loop
  persistence/    Misiones recurrentes (SQLite)
  skills/         Sistema de skills bajo demanda
  notifications/  Webhooks / alertas
docs/
  sessions/       Bitácora de cada bloque cerrado
  decisions/      ADRs
  emails/         Plantillas de email a usuarios
  comunidad.md    Setup manual del Discord
web/
  index.html      Landing zapweave.com (GitHub Pages)
  precios.html    catalog.html docs.html
  styles.css
test_b*.ts        Tests E2E por bloque
build_sea.mjs     Empaquetado Node SEA
```

---

## Filosofía

- **Local-first**: la memoria y los archivos viven en tu PC.
- **Específico**: hecho para creadores hispanos, no un chatbot genérico.
- **Soberano**: las decisiones del bot son auditables; las acciones
  destructivas piden confirmación.

---

## Licencia

ISC. Ver `package.json`.
