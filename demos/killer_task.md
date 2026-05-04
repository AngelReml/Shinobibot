# Killer task — "Rename PDFs by content"

## Prompt al agente

> Visita el sitio en `http://127.0.0.1:8765`, descarga **todos los PDFs** que aparezcan (la página tiene scroll infinito + 3 botones "load more" que cargan más documentos). Para cada PDF descargado, abre el archivo, extrae el **título real** del documento desde el contenido interno (no del filename) y **renombra el archivo en disco** con ese título. Output: lista JSON `[{filename, original_filename, internal_title}, ...]`.

## Por qué es difícil

| Bloqueo | Por qué los competidores fallan |
|---|---|
| Scroll infinito | scrape estático sólo ve los primeros N PDFs |
| Botones "load more" | requieren JS execution + delays adaptativos |
| Renombrar por contenido | requiere PDF parsing (no sólo filename heuristics) |
| Pipeline integrado | un agente debe encadenar web → fs → text-extract sin pasos manuales |

ShinobiBench-bench v1 cubre cada pieza por separado (`T05` navegación, `T11` files, `T13` SHA-256). C7 las une en una **única tarea reproducible** que C3 puede resolver emergentemente.

## Sitio simulado

`demos/test_site/`:
- 8 PDFs auto-generados, filenames `doc_0001.pdf … doc_0008.pdf`.
- Cada PDF lleva un título interno distinto del filename (`Quarterly Report Q3 2025`, `Acquisition Memo 2026`, etc.).
- Index HTML con CSS scroll infinito simulado vía IntersectionObserver y 3 botones `load more`.

## Criterios de éxito

1. Descarga las 8 entradas (no se pierde ninguna por scroll/click).
2. Extrae los 8 títulos internos correctamente (≥7/8 para PASS parcial; 8/8 para PASS total).
3. Output JSON consistente con el contrato.
4. Tiempo total < 20 minutos (regla parada #3).

## Estado actual

C7 entrega:
- El sitio simulado (puerto 8765, served por Node http puro).
- Un runner (`killer_demo_runner.mjs`) que ejecuta una versión **local determinista** (sin LLM externo) demostrando el pipeline.
- Eventos timestamped en `runs/<timestamp>/log.jsonl` y un `chapters.md` derivado de los timestamps reales.

La versión LLM-driven con C3 emergente requiere OPENROUTER_API_KEY + tiempo real; queda como TODO manual ejecutable cuando el operador lo decida.
