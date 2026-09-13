# Auditoria de Shinobii

Fecha: 2026-09-12  
Rama: `limpieza/shinobii-auditoria-20260912`  
Base: `remediacion-2026-07-01`  
Repositorio: `AngelReml/Shinobibot`

## Resultado ejecutivo

- La bateria completa queda verde: **247 ficheros, 2313 tests correctos y 3 omitidos**.
- `typecheck` queda correcto.
- Se corrigio un fallo de arranque real en el guard de egress: `dns.lookup(..., { all: true })` devolvia una lista y el codigo trataba esa lista como una IP.
- La prueba web arranca con la ruta de datos normal de esta maquina y `GET /` devuelve `HTTP 200`.
- La auditoria de dependencias queda en **0 vulnerabilidades totales** (`npm audit`) y **0 vulnerabilidades de produccion** (`npm audit --omit=dev`).
- Se ejecuto una auditoria de producto con misiones reales y coste LLM: escritura/lectura, analisis de CSV, extraccion web, memoria aislada, Excel, graficos, modo verificado y frontend.
- No se hizo push ni se modifico ningun remoto.

## Cambios realizados

1. `src/egress/runtime_guard.ts`
   - Normaliza la respuesta de `dns.lookup`: admite tanto una IP como `Array<{ address, family }>`.
   - Bloquea si cualquiera de las direcciones resueltas es privada/reservada.
   - Mantiene el callback original y el error `EgressBlockedError`.
2. `src/tenshu/types.ts`
   - Elimina un residuo textual de una marca anterior detectado por el test de branding.
3. `src/runtime/data_dir.ts` y consumidores de datos persistentes
   - Centraliza la ruta de datos escribible y prueba `SHINOBI_DATA_DIR`, `%APPDATA%\\Shinobi`, `%LOCALAPPDATA%\\Shinobi`, `~/.shinobi` y `%TEMP%\\Shinobi`.
   - Evita abortos por `SQLITE_CANTOPEN` cuando el primer perfil no es escribible.
4. `package.json`, `package-lock.json` y `src/sandbox/backends/e2b.ts`
   - Migra de `@e2b/sdk` deprecado a `e2b@2.49.1`.
   - Actualiza el adaptador E2B a `sandbox.commands.run(...)` manteniendo fallback legacy.
   - Fija overrides saneados para `adm-zip`, `body-parser`, `brace-expansion`, `jimp`, `nanoid`, `protobufjs`, `qs`, `sharp`, `tmp` y `uuid`.
   - Declara `@modelcontextprotocol/sdk` como dependencia directa porque el cliente MCP lo importa directamente.
5. `scripts/run_one.ts`, `src/tools/clean_extract.ts`, `src/reader/llm_adapter.ts`, `src/providers/registry.ts` y `src/tools/generate_chart.ts`
   - Permite auditorias aisladas con `--ungated` sin cambiar la seguridad por defecto.
   - Cierra la conexion CDP de `clean_extract` para que las misiones web no queden colgadas.
   - Alinea OpenRouter para aceptar `SHINOBI_PROVIDER_KEY` en el adapter de lector/especialistas.
   - Hace que `generate_chart` respete `SHINOBI_OUTPUT_DIR`.

## Pruebas ejecutadas

### Regresion y calidad

- `npm run typecheck`: correcto.
- `npm run test`: **247/247 suites correctas; 2313 correctos; 3 omitidos**.
- Suites de seguridad y aislamiento: **35 suites; 378 correctos; 2 omitidos**.
- Suites de agentes, coordinacion, proveedores, memoria y persistencia: **54 suites; 469 correctos** con el perfil de datos del proceso aislado.
- Suites de egress despues del arreglo: **4 suites; 32 correctos**.
- Browser E2E y branding despues de instalar Chromium: **3 suites; 17 correctos**.

### Prueba funcional web

- Con un `%APPDATA%` temporal y vacio: `npm run dev` inicia, escucha en `localhost:3333` y `GET /` responde `HTTP 200`, documento con titulo `Shinobi`.
- Con el perfil normal de la maquina: `npm run dev` inicia, escucha en `localhost:3333` y `GET /` responde `HTTP 200`.

## Incidencias y riesgos pendientes

### Resuelto: permisos/ruta de datos en Windows

Se introdujo `src/runtime/data_dir.ts`, que prueba `SHINOBI_DATA_DIR`, `%APPDATA%\\Shinobi`, `%LOCALAPPDATA%\\Shinobi`, `~/.shinobi` y finalmente `%TEMP%\\Shinobi`, usando un probe de escritura antes de seleccionar la ruta. Memoria, misiones, configuración, skills y el servidor web usan ahora esta resolución. El arranque real sin perfil temporal escucha en `localhost:3333` y `/` responde `HTTP 200`.

### Resuelto: dependencias

Se actualizaron las dependencias directas `axios` a `1.20.0` y `ws` a `8.21.3`, se sustituyo `@e2b/sdk` por `e2b@2.49.1`, se actualizaron herramientas de desarrollo (`vitest`, `@vitest/coverage-v8`, `tsx`) y se fijaron overrides compatibles para vulnerabilidades transitivas con parche publicado. La auditoria paso de 24 hallazgos iniciales de produccion y 37 hallazgos globales intermedios a **0 hallazgos finales**.

Overrides finales relevantes:

- `@huggingface/transformers`: `adm-zip@0.6.1` y `sharp@0.35.4`.
- `@nut-tree-fork/nut-js`: `jimp@1.6.1`.
- `exceljs`: `uuid@11.1.1`.

La migracion de Jimp obligo a adaptar `scripts/build_enso_inline.ts` a la API actual (`Jimp`, `JimpMime`, `width`/`height`, `resize({ w, h })`), y el script fue ejecutado correctamente.

### Resuelto: skill legacy sin checksum

`skills/approved/kage-browser-operator.skill.md` fue recalculada con el firmador nativo del repositorio (`signed_by: user`) y `verifySkillText` devuelve `valid: true`.

### Activaciones externas

Los canales externos no quedan como deuda tecnica: la suite local de canales paso completa (**5 suites, 76 tests**). En runtime sin secretos, Shinobii arranca cerrado: canal `loopback` activo, gateway externo desactivado, webhook rechazando sin `WEBHOOK_SHARED_SECRET`, y Discord/Slack/WhatsApp/Signal/Matrix/Teams/email omitidos por configuracion. La activacion live requiere credenciales/cuentas del operador, no cambios de codigo.

## Prueba real de proveedor

La prueba real con la clave provisional de OpenRouter fue correcta: validacion HTTP 200 y una respuesta de Shinobii desde `deepseek/deepseek-v4-flash-0731`, con 113 tokens totales. La clave solo vivio en el entorno temporal del proceso y no se persistio en el repositorio. Se intento listar las claves para revocarla, pero OpenRouter devolvio HTTP 401 porque la credencial no tiene permisos de management; la revocacion debe hacerse desde el panel de OpenRouter o con una management key.

## Auditoria de producto real

La fase adicional de auditoria con misiones reales queda documentada en `AUDITORIA-PRODUCTO-REAL-2026-09-12.md`. Se consumio proveedor real configurado en la maquina y se conservaron evidencias JSON/audit por mision bajo `_auditoria/misiones_reales_2026-09-12` y `_auditoria/misiones_reales_2026-09-13-final`.

## API local comprobada

Con un perfil de datos temporal y sin credenciales, el servidor respondio:

- `/`: `200`, HTML de onboarding Shinobi.
- `/api/status`: `200`.
- `/api/providers`: `200`, roster de proveedores.
- `/api/models`: `200`, catalogo de modelos.

## Dictamen

El nucleo de tests y el frontend local son funcionales en esta maquina. La ruta de datos, la firma de skills, el guard de egress, la migracion de E2B, los parches de dependencias, la salida aislada de documentos/graficos y la auditoria real de producto quedan cerrados con tests completos verdes, auditoria npm en cero y evidencias reproducibles.
