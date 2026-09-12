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
