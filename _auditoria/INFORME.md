# Informe de auditoria final - Shinobii

Fecha: 2026-09-13
Rama limpia: `limpieza/shinobii-presentable-main-20260913`
Base: `main`

## Objetivo

Dejar el repositorio en estado presentable para GitHub sin arrastrar una rama antigua con diferencias historicas. La auditoria se ejecuto sobre una rama nueva creada desde `main`, portando solo correcciones verificadas.

## Hallazgos cerrados

1. El backend E2B usaba el paquete legacy `@e2b/sdk` y asumía `sandbox.process.start()`. Se migro a `e2b` moderno con compatibilidad legacy y helpers testeados para `commands.run`, `process.start().wait()` y liberacion con `kill`/`close`.
2. `@modelcontextprotocol/sdk` se usaba en codigo fuente pero no estaba declarado como dependencia directa. Se declaro explicitamente.
3. La auditoria npm dejaba vulnerabilidades altas. Se actualizaron dependencias y overrides hasta obtener `0` vulnerabilidades en auditoria completa y produccion.
4. `generate_chart` y `DataAgent` generaban artefactos fuera del directorio de mision. Ahora respetan `SHINOBI_OUTPUT_DIR`.
5. `clean_extract` cerraba la pagina pero podia dejar vivo el navegador/CDP. Ahora cierra tambien el browser en el `finally`.
6. `reader/llm_adapter` no reconocia `SHINOBI_PROVIDER_KEY` como clave OpenRouter, aunque otros proveedores si. Ahora lo acepta y lo cubre con test.
7. `isProviderConfigured('openrouter')` ignoraba `SHINOBI_PROVIDER_KEY`. Ahora el estado de UI/runtime coincide con el cliente real.
8. La memoria SQLite asumía un directorio de datos escribible fijo. Ahora usa `shinobiDataDir()` con fallback a `SHINOBI_DATA_DIR`, `APPDATA`, `LOCALAPPDATA`, home y temp.
9. El guard de egress fallaba al recibir resultados DNS multiples (`all:true`) porque trataba un array como string. Ahora revisa todas las direcciones y conserva el contrato original.
10. Faltaba un runner headless versionado para misiones aisladas (`scripts/run_one.ts`). Se añadio para auditoria reproducible con provenance firmado.
11. El smoke CI D-017 estaba desalineado con la politica real de `main`: esperaba `smart` por defecto y que `off` relajara `validatePath`. Se actualizo para comprobar la politica mas segura vigente: `critical` por defecto y bloqueo duro de rutas absolutas sensibles.

## Validacion tecnica

- `npm audit --json`: 0 vulnerabilidades.
- `npm audit --omit=dev --json`: 0 vulnerabilidades.
- `npm run typecheck`: OK.
- Pruebas focalizadas iniciales: 8 archivos, 107 tests OK.
- Pruebas focalizadas tras correccion de memoria/egress: 12 archivos, 134 tests OK.
- Smoke D-017 local: 7/7 OK.
- Suite completa final: 247 archivos OK, 2313 tests OK, 3 skipped.

## Auditoria de producto real

Carpeta de evidencia: `_auditoria/misiones_reales_2026-09-13-main-final/`

Misiones reales ejecutadas con runner headless:

- `final-main-verified`: razonamiento/cálculo verificable. Resultado: `37 / 45 * 100 = 82.22%`, `ok=true`.
- `final-main-excel`: generacion de `.xlsx` real. Verificacion independiente con `exceljs`: 5 filas, fila `Core` = `18/20`, celda `B5` = `=AVERAGE(B2:B4)`, `ok=true`.
- `final-main-chart`: generacion de SVG real via especialista de datos. Verificacion independiente: archivo SVG existe, contiene `<svg`, `Core`, `Web` y `Canales`, `ok=true`.
- `final-main-web`: extraccion limpia de `https://example.com`. Resultado: titulo `Example Domain` y frase principal extraida, `ok=true`.

Validacion frontend:

- Servidor local: `http://localhost:3333`.
- Endpoints comprobados: `/`, `/api/status`, `/api/providers`, `/api/models` -> HTTP 200.
- Captura visual guardada: `_auditoria/misiones_reales_2026-09-13-main-final/frontend-smoke.png`.

## Estado honesto de pendientes

No quedan pendientes tecnicos detectados en esta rama para presentacion del repositorio: auditoria npm limpia, tipos limpios, suite completa verde, frontend levanta y misiones reales pasan.

Los canales externos (`webhook`, `discord`, `slack`, `whatsapp`, `signal`, `matrix`, `teams`, `email`) aparecen correctamente desactivados en runtime cuando faltan sus secretos. Eso no es deuda de codigo: es activacion operativa que requiere credenciales reales del operador. El servidor local informa `loopback` arrancado y el resto `skipped`, sin fingir integraciones no configuradas.

Aviso observado al arrancar web:

- `skill_ac2ca91a3f5a435c.mjs` rechazado por faltar su `.md` companion.
- `kage-browser-operator.skill.md` cargado como legacy sin firma.

Ambos pertenecen a estado local de skills, no a una regresion del repo versionado.
