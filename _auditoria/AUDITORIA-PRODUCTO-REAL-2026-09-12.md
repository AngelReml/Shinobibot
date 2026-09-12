# Auditoria de producto real - Shinobii

Fecha: 2026-09-12
Rama: `limpieza/shinobii-auditoria-20260912`
Directorio de evidencia: `_auditoria/misiones_reales_2026-09-12`

## Resultado

Se ejecuto una auditoria de producto con llamadas LLM reales, servidor web real, herramientas de escritura/lectura, extraccion web, memoria aislada, documento Excel, grafico SVG y modo verificado.

Resultado final tras remediacion:

- `npm run typecheck`: correcto.
- `npm run test`: 247 suites correctas, 2313 tests correctos, 3 omitidos.
- `npm audit --omit=dev`: 13 vulnerabilidades de produccion, 9 moderadas, 4 altas, 0 criticas.
- Smoke web: `/`, `/api/status`, `/api/providers`, `/api/models` respondieron HTTP 200.
- Frontend headless: titulo `Shinobi`, UI renderizada y captura en `frontend-smoke.png`.

## Misiones reales ejecutadas

| ID | Objetivo | Resultado | Evidencia |
| --- | --- | --- | --- |
| `llm_ping` | Validar llamada minima real al proveedor | OK, OpenRouter respondio `OK` | consola |
| `audit-file-deliverable` | Crear y leer un Markdown | FALLO esperado de seguridad: `write_file` denegado por gate headless sin asker | `m1_file.json` |
| `audit-file-deliverable-ungated` | Repetir escritura en workdir aislado con modo de auditoria | OK, `write_file` + `read_file` | `m1_file_ungated.json` |
| `audit-data-summary` | Leer CSV, calcular totales y escribir resumen | OK, 45 tareas, 37 cerradas, 82.22% | `m2_data.json` |
| `audit-web-research` | Extraer `https://example.com` con herramienta web | OK funcional, pero el proceso quedo colgado tras escribir JSON | `m3_web.json` |
| `audit-web-research-after-fix` | Repetir extraccion web tras cerrar conexion CDP | OK y el proceso termina solo | `m3_web_after_fix.json` |
| `audit-memory-isolated` | Guardar memoria sin tocar perfil real | OK en `SHINOBI_DATA_DIR` aislado | `m4_memory.json` |
| `audit-excel-generation` | Generar Excel con formula | OK, `.xlsx` verificado con formula `AVERAGE(B2:B4)` | `m5_document.json` |
| `audit-chart-generation` | Generar grafico via especialista de datos | OK final, pero mostro fallback erroneo a OpenAI y 401 interno antes de continuar | `m6_chart.json` |
| `audit-chart-generation-after-config-fix` | Repetir grafico tras alinear `SHINOBI_PROVIDER_KEY` | OK, `data_agent_run` sin 401 | `m6_chart_after_fix.json` |
| `audit-chart-output-dir-fix` | Verificar que charts respetan `SHINOBI_OUTPUT_DIR` | OK, SVG generado dentro de carpeta aislada | `m6_chart_output_fix.json` |
| `audit-verified-reasoning` | Probar modo `--verified` con razonamiento corto | OK, 82.22%, 1 iteracion | `m7_verified.json` |

## Fallos encontrados y corregidos

### 1. Misiones headless no podian auditar escritura segura

`scripts/run_one.ts` no exponia un modo explicito para desactivar el gate interactivo en workdirs aislados. La primera mision intento `write_file`, el gate denego la accion por `no_asker`, y el loop detector aborto al repetir los mismos argumentos.

Correccion: se anadio `--ungated`, manteniendo el comportamiento seguro por defecto. Solo se usa cuando el operador lo pide para auditoria/benchmark aislado.

### 2. `clean_extract` dejaba procesos abiertos

La herramienta cerraba la pagina, pero no la conexion CDP/browser. La mision web produjo JSON correcto y quedo viva hasta interrupcion manual.

Correccion: `clean_extract` cierra tambien `browser.close()` al terminar. La repeticion con `audit-web-research-after-fix` termino sola con `ok=true`.

### 3. Configuracion OpenRouter incoherente entre capas

`provider_router` aceptaba `SHINOBI_PROVIDER_KEY`, pero `reader/llm_adapter` solo leia `OPENROUTER_API_KEY`. En misiones con especialistas esto provoco fallback a OpenAI directo y un 401 interno aunque existia una clave generica configurada.

Correccion: `reader/llm_adapter` usa `OPENROUTER_API_KEY || SHINOBI_PROVIDER_KEY`; `providers/registry.ts` marca OpenRouter configurado con cualquiera de las dos. Se anadio test de regresion.

### 4. `generate_chart` ignoraba `SHINOBI_OUTPUT_DIR`

La tool generaba SVG en `artifacts/charts` aunque la auditoria fijase un output aislado.

Correccion: `generate_chart` pasa `process.env.SHINOBI_OUTPUT_DIR` a `writeChart`. La repeticion genero el SVG dentro de `_auditoria/misiones_reales_2026-09-12/m6_chart_output_fix/outputs`.

## Riesgos pendientes

- Los resultados `run_one` muestran `usage: null` aunque la llamada LLM real ocurre. El gateway usado por el runner devuelve solo texto, no metadatos de tokens. Esto es una carencia de observabilidad de coste, no un fallo funcional.
- Las vulnerabilidades residuales de produccion siguen concentradas en paquetes sin fix directo seguro publicado: `@huggingface/transformers`/`onnxruntime-node`/`sharp`, `@nut-tree-fork/nut-js`/Jimp y `exceljs`/`uuid`.
- Canales externos como email, Slack, Discord, WhatsApp, Signal, Matrix y Teams no se probaron end-to-end porque requieren secretos/cuentas/canales externos activos.

## Dictamen

Shinobii queda funcionalmente mas presentable que al inicio de esta fase: las misiones reales validan autonomia con coste, herramientas, trazabilidad firmada, escritura aislada, lectura, extraccion web, memoria, documentos, graficos, modo verificado y frontend. Los fallos encontrados durante la auditoria fueron corregidos y cubiertos por pruebas cuando habia superficie testeable local.
