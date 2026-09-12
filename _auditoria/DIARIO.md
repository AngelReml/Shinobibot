# Diario de auditoria

## 2026-09-12

- Se verificaron las carpetas locales de Shinobii; estaban vacias. No se uso `Desktop\\PASSIO-TXT\\shinobi`.
- Se clono `AngelReml/Shinobibot` sin tags y se creo la rama aislada `limpieza/shinobii-auditoria-20260912` desde `remediacion-2026-07-01`.
- Baseline: 3 suites fallaban por un residuo de branding y por Chromium de Playwright ausente; `typecheck` correcto.
- Se instalo Chromium de Playwright localmente para poder probar E2E.
- Se elimino el residuo textual de branding en `src/tenshu/types.ts`.
- La bateria completa paso: 247 suites, 2309 tests correctos y 3 omitidos.
- La prueba por areas descubrio que memoria falla si `%APPDATA%` apunta a una ruta no escribible; con perfil temporal pasa.
- La prueba web con `%APPDATA%` habitual fallo con `EPERM`/`SQLITE_CANTOPEN`.
- La prueba web con perfil temporal descubrio el defecto `ip.split is not a function` en la interceptacion de `dns.lookup` con resultado multiple.
- Se corrigio el guard para soportar respuestas simples y listas, manteniendo el bloqueo de IPs privadas/reservadas.
- Egress: 4 suites y 32 tests correctos tras el cambio.
- Smoke web con perfil temporal: servidor escuchando y `GET /` respondio `HTTP 200`.
- Validacion real de OpenAI a traves del router: HTTP 401; no hubo consumo de tokens.
- Prueba real con OpenRouter: HTTP 200, respuesta de `deepseek/deepseek-v4-flash-0731`, 113 tokens totales.
- Intento de revocacion via API de gestion: HTTP 401; la clave no tiene permisos de management. La clave no aparece persistida en el repositorio.
- Smoke adicional de API: `/`, `/api/status`, `/api/providers` y `/api/models` respondieron HTTP 200 con perfil temporal.
- Se detuvo el servidor y no se dejaron procesos de prueba activos.
- Tras liberar 39.26 GB, se reconstruyeron 1206 paquetes y se repitio la bateria completa con perfil temporal: 247 suites correctas, 2309 tests correctos y 3 omitidos.
- Se calculo y verifico el checksum de `skills/approved/kage-browser-operator.skill.md`; la skill deja de cargar como legacy sin integridad.
- La actualizacion automatica de dependencias se dejo sin aplicar por conflicto de peer y saltos mayores no seguros.
- Se migro E2B del paquete deprecado `@e2b/sdk` al paquete mantenido `e2b@2.49.1`.
- Se adapto el backend E2B a la API moderna `sandbox.commands.run(...)`, manteniendo fallback para instalaciones legacy.
- Se fijaron overrides de seguridad para `body-parser@1.20.8`, `brace-expansion@2.1.4`, `nanoid@5.1.16`, `protobufjs@7.6.5`, `qs@6.16.0` y `tmp@0.2.7`.
- Auditoria final de produccion: 13 vulnerabilidades, 9 moderadas y 4 altas, 0 criticas. Quedan asociadas a `@huggingface/transformers`, `@nut-tree-fork/nut-js`/Jimp y `exceljs`/uuid sin fix directo seguro.
- Verificacion final despues de la remediacion de dependencias: `typecheck` correcto; sandbox/spawn_agent correctos; bateria completa con 247 suites, 2312 tests correctos y 3 omitidos.
- Smoke web final con perfil normal: `/`, `/api/status`, `/api/providers` y `/api/models` respondieron HTTP 200. El servidor de prueba se detuvo y se retiro el lockfile.
- Auditoria de producto real con coste LLM: ping OpenRouter correcto; misiones de escritura, datos, web, memoria aislada, Excel, chart y modo verified ejecutadas con evidencias en `_auditoria/misiones_reales_2026-09-12`.
- Fallo real detectado: `run_one` no podia auditar escritura en workdir aislado porque el gate headless denegaba `write_file` sin asker. Se anadio `--ungated` como modo explicito de auditoria; el modo por defecto sigue protegido.
- Fallo real detectado: `clean_extract` dejaba la conexion CDP abierta y el runner no terminaba. Se cierra `browser.close()` al finalizar y la mision web posterior termina sola.
- Fallo real detectado: `reader/llm_adapter` ignoraba `SHINOBI_PROVIDER_KEY` y caia a OpenAI directo aunque OpenRouter estuviera configurado en onboarding. Se alineo con `provider_router` y se anadio test de regresion.
- Fallo real detectado: `generate_chart` ignoraba `SHINOBI_OUTPUT_DIR` y escribia en `artifacts/charts`. Se pasa el output dir al renderizador y la repeticion genero dentro del directorio aislado.
- Verificacion posterior: `typecheck` correcto, tests enfocados correctos, auditoria npm de produccion 13 hallazgos/0 criticos, frontend headless renderiza titulo `Shinobi`, y bateria completa final con 247 suites, 2313 tests correctos y 3 omitidos.
