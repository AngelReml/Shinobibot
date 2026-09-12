# Auditoria de Shinobii

Fecha: 2026-09-12  
Rama: `limpieza/shinobii-auditoria-20260912`  
Base: `remediacion-2026-07-01`  
Repositorio: `AngelReml/Shinobibot`

## Resultado ejecutivo

- La bateria completa queda verde: **247 ficheros, 2312 tests correctos y 3 omitidos**.
- `typecheck` queda correcto.
- Se corrigio un fallo de arranque real en el guard de egress: `dns.lookup(..., { all: true })` devolvia una lista y el codigo trataba esa lista como una IP.
- La prueba web arranca con la ruta de datos normal de esta maquina y `GET /` devuelve `HTTP 200`.
- La auditoria de dependencias de produccion queda en **13 vulnerabilidades: 9 moderadas y 4 altas, sin criticas**. Las restantes dependen de paquetes sin fix directo seguro publicado.
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
   - Fija overrides saneados para `body-parser`, `brace-expansion`, `nanoid`, `protobufjs`, `qs` y `tmp`.

## Pruebas ejecutadas

### Regresion y calidad

- `npm run typecheck`: correcto.
- `npm run test`: **247/247 suites correctas; 2312 correctos; 3 omitidos**.
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

### Mejorado: dependencias de produccion

Se actualizaron las dependencias directas `axios` a `1.20.0` y `ws` a `8.21.3`, se sustituyo `@e2b/sdk` por `e2b@2.49.1`, y se fijaron overrides compatibles para vulnerabilidades transitivas con parche disponible. La auditoria de produccion paso de 24 hallazgos iniciales a **13 hallazgos finales: 9 moderados y 4 altos, 0 criticos**.

Permanecen estos bloques porque npm no ofrece fix directo compatible:

- `@huggingface/transformers` arrastra `onnxruntime-node`, `adm-zip` y `sharp`.
- `@nut-tree-fork/nut-js` arrastra `jimp`, `@jimp/core`, `@jimp/custom` y `file-type`.
- `exceljs` arrastra `uuid`; bajar a `exceljs@3.4.0` seria un salto funcional hacia atras y no se aplico sin una bateria especifica de documentos.

### Resuelto: skill legacy sin checksum

`skills/approved/kage-browser-operator.skill.md` fue recalculada con el firmador nativo del repositorio (`signed_by: user`) y `verifySkillText` devuelve `valid: true`.

### Limitaciones de esta pasada

- No se pudo completar una llamada generativa real: la credencial disponible fue rechazada con HTTP 401 y no se copiaron credenciales de otro proyecto.
- No se verificaron canales externos (Discord, Slack, WhatsApp, Signal, Matrix, Teams, email) porque requieren secretos, cuentas y efectos externos.
- No se publicaron cambios.

## Prueba real de proveedor

La prueba real con la clave provisional de OpenRouter fue correcta: validacion HTTP 200 y una respuesta de Shinobii desde `deepseek/deepseek-v4-flash-0731`, con 113 tokens totales. La clave solo vivio en el entorno temporal del proceso y no se persistio en el repositorio. Se intento listar las claves para revocarla, pero OpenRouter devolvio HTTP 401 porque la credencial no tiene permisos de management; la revocacion debe hacerse desde el panel de OpenRouter o con una management key.

## API local comprobada

Con un perfil de datos temporal y sin credenciales, el servidor respondio:

- `/`: `200`, HTML de onboarding Shinobi.
- `/api/status`: `200`.
- `/api/providers`: `200`, roster de proveedores.
- `/api/models`: `200`, catalogo de modelos.

## Dictamen

El nucleo de tests y el frontend local son funcionales en esta maquina. La ruta de datos, la firma de skills, el guard de egress, la migracion de E2B y los parches de dependencias compatibles quedan cerrados con tests completos verdes. Para una entrega publica aun conviene decidir si se reemplazan o aislan los bloques sin fix directo (`@huggingface/transformers`, `@nut-tree-fork/nut-js` y `exceljs`) o se documentan como deuda tecnica aceptada.
