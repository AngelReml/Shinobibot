# FASE GAIA.1 — Setup y validación previa

Fecha: 2026-05-16.

## Setup

- Dataset clonado en el Contabo: `/opt/GAIA` desde
  `https://huggingface.co/datasets/gaia-benchmark/GAIA` (dataset gated;
  requirió token HF del operador + aceptación de términos).
- Estructura real: `2023/validation/` y `2023/test/`. **No existe
  `validation/metadata.jsonl`** como decía el plan — el dataset migró a
  formato Parquet (`metadata.parquet` + `metadata.level{1,2,3}.parquet`).
- Los parquet venían como punteros git-LFS; se hizo
  `git lfs pull --include="2023/validation/metadata*.parquet"`.
- Generado `2023/validation/metadata.jsonl` (165 filas) desde el parquet
  para que el harness lo consuma como esperaba el plan.
- Las attachments (mp3/pdf/xlsx que algunas tareas referencian) siguen
  como punteros LFS — se descargarán en GAIA.2/3 con `git lfs pull` del
  directorio `validation/`.

## Conteo de tareas — validation set

| Nivel | Tareas |
|---|---|
| Level 1 | 53 |
| Level 2 | 86 |
| Level 3 | 26 |
| **Total** | **165** |

Nota: el plan decía "166 tareas". El validation set oficial de GAIA
2023 tiene **165**. Se reporta el número real.

Columnas del metadata: `task_id`, `Question`, `Level`, `Final answer`,
`file_name`, `file_path`, `Annotator Metadata`.

## Modelo y precio

`z-ai/glm-4.7-flash` vía OpenRouter (verificado en
`openrouter.ai/api/v1/models`):
- Input (prompt): **$0.060 / 1M tokens**
- Output (completion): **$0.400 / 1M tokens**

## Estimación de coste

Ejecuciones totales = 165 tareas × 3 agentes × 3 runs = **1 485 runs**.

| Nivel | Runs | Tokens/run estimados (in/out) | $/run | Subtotal |
|---|---|---|---|---|
| L1 | 53×3×3 = 477 | 35K / 4K | $0.0037 | $1.77 |
| L2 | 86×3×3 = 774 | 90K / 9K | $0.0090 | $6.97 |
| L3 | 26×3×3 = 234 | 180K / 15K | $0.0168 | $3.93 |
| **Total** | **1 485** | — | — | **≈ $12.7** |

`$/run = tokens_in × 0.06/1M + tokens_out × 0.40/1M`.

### Escenario pesimista

Los runs agénticos sobre un benchmark difícil pueden disparar
iteraciones (sobre todo con un modelo pequeño que reintenta más). Con
un multiplicador ×2.5 de consumo de tokens:

**Estimación pesimista ≈ $32.**

### Veredicto del presupuesto

- Estimación central: **~$13**
- Estimación pesimista: **~$32**

Ambas **por debajo del límite de $50**. Margen de seguridad razonable.
El plan exige parar la ejecución si en algún momento se ven
comprometidos los $50 con margen 10% (=$45); el harness de GAIA.3
monitorizará el consumo real y abortará en $45.

## Incertidumbres declaradas

- El consumo real de tokens por tarea GAIA es difícil de predecir: las
  tareas L2/L3 implican navegación web + procesado de archivos
  adjuntos; un agente que entra en bucles consume mucho más.
- GLM-4.7-flash es un modelo pequeño — puede fallar más tareas (eso
  abarata, no encarece) pero también reintentar más (encarece).
- El monitoreo de coste real cada 30 min en GAIA.3 es la red de
  seguridad: si se acerca a $45 se para con resultados parciales.

## Estado

GAIA.1 completa. Estimación bajo presupuesto. **Parado para reporte
humano** antes de GAIA.2 (adaptación del harness), como pide el plan.
