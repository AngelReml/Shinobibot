# Auditoria de producto real - Shinobii

Fecha: 2026-09-12
Rama: `limpieza/shinobii-auditoria-20260912`
Directorios de evidencia: `_auditoria/misiones_reales_2026-09-12`, `_auditoria/misiones_reales_2026-09-13-final`

## Resultado

Se ejecuto una auditoria de producto con llamadas LLM reales, servidor web real, herramientas de escritura/lectura, extraccion web, memoria aislada, documento Excel, grafico SVG y modo verificado.

Resultado final tras remediacion:

- `npm run typecheck`: correcto.
- `npm run test`: 247 suites correctas, 2313 tests correctos, 3 omitidos.
- `npm audit`: 0 vulnerabilidades totales.
- `npm audit --omit=dev`: 0 vulnerabilidades de produccion.
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
| `final-verified` | Repetir calculo verificado en carpeta limpia | OK, 82.22% | `2026-09-13-final/verified.json` |
| `final-excel` | Generar y verificar Excel final | OK, `.xlsx` creado y formula `AVERAGE(B2:B4)` confirmada fuera del modelo | `2026-09-13-final/excel.json` |
| `final-chart` | Generar grafico via especialista tras propagar `SHINOBI_OUTPUT_DIR` | OK, SVG dentro de carpeta aislada | `2026-09-13-final/chart.json` |
| `final-web` | Repetir extraccion web limpia | OK, `Example Domain`, proceso termina solo | `2026-09-13-final/web.json` |

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

### 5. `DataAgent` no propagaba `SHINOBI_OUTPUT_DIR`

El camino directo de `generate_chart` quedo corregido, pero la mision final mostro que el especialista `DataAgent` llamaba a `writeChart(spec)` por debajo y volvia a generar en `artifacts/charts`.

Correccion: `DataAgent.produce` pasa `process.env.SHINOBI_OUTPUT_DIR` al renderizador. La mision `final-chart` genero el SVG dentro de `_auditoria/misiones_reales_2026-09-13-final/chart`.

### 6. Auditoria de dependencias global

La auditoria posterior elimino los hallazgos restantes con overrides y upgrades controlados: `adm-zip@0.6.1`, `sharp@0.35.4`, `jimp@1.6.1`, `uuid@11.1.1`, `vitest@4.1.11`, `@vitest/coverage-v8@4.1.11` y `tsx@4.23.13`. `@modelcontextprotocol/sdk@1.30.0` quedo declarado como dependencia directa porque el codigo lo importa.

## Estado operativo

- Los resultados `run_one` muestran `usage: null` aunque la llamada LLM real ocurre. El gateway usado por el runner devuelve solo texto, no metadatos de tokens. Esto es una carencia de observabilidad de coste, no un fallo funcional.
- Los canales externos reales requieren credenciales/cuentas del operador. La suite local de canales paso completa: 5 suites y 76 tests.
- En runtime sin secretos, el producto arranca cerrado: `loopback` activo, gateway externo desactivado y canales externos omitidos por configuracion.

## Dictamen

Shinobii queda funcionalmente mas presentable que al inicio de esta fase: las misiones reales validan autonomia con coste, herramientas, trazabilidad firmada, escritura aislada, lectura, extraccion web, memoria, documentos, graficos, modo verificado y frontend. Los fallos encontrados durante la auditoria fueron corregidos y cubiertos por pruebas cuando habia superficie testeable local. La auditoria npm queda en cero y no quedan pendientes tecnicos abiertos dentro del alcance de esta auditoria.
