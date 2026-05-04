# Shinobi demos

Auto-grabables, deterministas, reproducibles desde clone limpio. La pieza estrella es la **killer demo** (C7).

## Killer demo — "Rename PDFs by content"

Una tarea única que ningún competidor puede resolver de un solo plumazo: scroll-infinito + load-more + parsing PDF + renombrado por contenido. Se ejecuta en local con un sitio simulado y el pipeline `web → fs → text-extract → rename` orquestado por C3.

### Reproducir desde cero

```sh
# (una sola vez) generar los 8 PDFs sintéticos
node demos/test_site/generate_pdfs.mjs

# correr el demo (sin OBS, no toca tu máquina)
node demos/killer_demo_runner.mjs

# o con OBS auto-record vía CLI (requiere obs-websocket habilitado)
npx tsx scripts/shinobi.ts demo --task killer
```

### Salida

Cada corrida produce `demos/runs/<UTC-timestamp>/`:

| Archivo | Qué es |
|---|---|
| `log.jsonl` | un evento por línea con `type`, `ts_utc`, `offset_ms` y campos por evento |
| `chapters.md` | tabla autogenerada a partir de los timestamps reales (ningún offset hardcodeado) |
| `output.json` | la lista final `[{filename, original_filename, internal_title}]` |

### Eventos emitidos por el runtime

```
SETUP_PRESENTED
AGENT_FIRST_ATTEMPT       (scrape estático)
AGENT_FAILURE             (motivo: scroll infinito no resuelto)
C3_TRIGGERED              (improve loop arranca)
SKILL_GENERATION_START    (3 candidatas)
SKILL_VALIDATION_PASS     (skill que recupera la lista completa)
SKILL_APPLIED
PDFS_DOWNLOADED
TITLE_EXTRACTED
RENAME_DONE
SUCCESS_TOTAL | SUCCESS_PARTIAL | TIMEOUT | AGENT_FAILURE
```

Cada evento incluye `offset_ms` (delta wall-clock desde `SETUP_PRESENTED`). El generador de chapters lee este `offset_ms` directamente — son timestamps reales, no narrativa.

### Sitio simulado

`demos/test_site/`:

- `serve.mjs` — HTTP server stdlib, puerto 8765 (override con `KILLER_SITE_PORT`).
- `index.html` — render JS-side via IntersectionObserver y botones "Load more" en lotes de 3.
- `pdfs/doc_NNNN.pdf` — 8 PDFs auto-generados con título interno distinto al filename.
- `manifest.json` — la "ground truth" que un agente JS-aware descubriría tras navegar el DOM.

### Flags del runner

```
--port <n>              puerto del site (default 8765)
--rename-out <dir>      destino de los PDFs renombrados (default %TEMP%)
--skip-server           usar un site ya levantado fuera del runner
--max-secs <n>          ceiling absoluto (default 1200 = 20min, regla parada #3)
```

### Integración con OBS

`shinobi demo --task killer` (sin `--no-record`) hace:

1. Arranca recording vía H1 (`desktop-obs-record-self`).
2. Lanza `killer_demo_runner.mjs` con stdio heredado.
3. Al exit, para vía H2 (`desktop-obs-stop-and-save`) y reporta `output_path`.

Sin OBS instalado / obs-websocket habilitado, el bracketing se salta silenciosamente (la demo sigue funcionando, sólo no graba video).

### Latencia observada

Local determinista (sin red al cluster real): **<1 segundo**. La regla parada #3 (<20min) está satisfecha con tres órdenes de magnitud de margen.

## Otras demos

- `shinobi demo --task <T01..T30>` — un task individual de ShinobiBench con bracketing OBS.
- `shinobi run-demo full-self-improve` — los 7 tasks del subset narrado, con bracketing OBS.

Ver `src/demo/demo_runner.ts`.
