# Auditoria de Shinobii

Fecha: 2026-09-12  
Rama: `limpieza/shinobii-auditoria-20260912`  
Base: `remediacion-2026-07-01`  
Repositorio: `AngelReml/Shinobibot`

## Resultado ejecutivo

- La bateria completa queda verde: **247 ficheros, 2309 tests correctos y 3 omitidos**.
- `typecheck` queda correcto.
- Se corrigio un fallo de arranque real en el guard de egress: `dns.lookup(..., { all: true })` devolvia una lista y el codigo trataba esa lista como una IP.
- La prueba web aislada arranca y `GET /` devuelve `HTTP 200`.
- El arranque usando el `%APPDATA%` habitual de esta maquina falla por permisos (`EPERM` / `SQLITE_CANTOPEN`), no por la correccion aplicada. Esto debe resolverse en el entorno de ejecucion o mediante una ruta de datos configurable.
- No se hizo push ni se modifico ningun remoto.

## Cambios realizados

1. `src/egress/runtime_guard.ts`
   - Normaliza la respuesta de `dns.lookup`: admite tanto una IP como `Array<{ address, family }>`.
   - Bloquea si cualquiera de las direcciones resueltas es privada/reservada.
   - Mantiene el callback original y el error `EgressBlockedError`.
2. `src/tenshu/types.ts`
   - Elimina un residuo textual de una marca anterior detectado por el test de branding.

## Pruebas ejecutadas

### Regresion y calidad

- `npm run typecheck`: correcto.
- `npm run test`: **247/247 suites correctas; 2309 correctos; 3 omitidos**.
- Suites de seguridad y aislamiento: **35 suites; 378 correctos; 2 omitidos**.
- Suites de agentes, coordinacion, proveedores, memoria y persistencia: **54 suites; 469 correctos** con el perfil de datos del proceso aislado.
- Suites de egress despues del arreglo: **4 suites; 32 correctos**.
- Browser E2E y branding despues de instalar Chromium: **3 suites; 17 correctos**.

### Prueba funcional web

- Con un `%APPDATA%` temporal y vacio: `npm run dev` inicia, escucha en `localhost:3333` y `GET /` responde `HTTP 200`, documento con titulo `Shinobi`.
- Sin perfil temporal, el proceso no puede abrir `C:\Users\angel\AppData\Roaming\Shinobi\...` y aborta con `SQLITE_CANTOPEN`; se conserva como incidencia de entorno.

## Incidencias y riesgos pendientes

### Resuelto: permisos/ruta de datos en Windows

Se introdujo `src/runtime/data_dir.ts`, que prueba `SHINOBI_DATA_DIR`, `%APPDATA%\\Shinobi`, `%LOCALAPPDATA%\\Shinobi`, `~/.shinobi` y finalmente `%TEMP%\\Shinobi`, usando un probe de escritura antes de seleccionar la ruta. Memoria, misiones, configuración, skills y el servidor web usan ahora esta resolución. El arranque real sin perfil temporal escucha en `localhost:3333` y `/` responde `HTTP 200`.

### P1/P2: dependencias de produccion

La auditoria de npm realizada antes de la comprobacion final reporto **24 vulnerabilidades de produccion: 13 moderadas y 11 altas**. Entre los paquetes afectados aparecian `axios`, `ws`, `@e2b/sdk`, `@huggingface/transformers`, `sharp`, `tmp` y dependencias transitivas. La consulta final al endpoint de npm no pudo repetirse por un error de red del endpoint; no se ejecuto `npm audit fix --force` ni se actualizaron dependencias a ciegas.

### Mejorado: dependencias de produccion

Se actualizaron las dependencias directas `axios` a `1.20.0` y `ws` a `8.21.3`, con lockfile regenerado y tests completos verdes. Permanecen vulnerabilidades transitivas y paquetes que requieren saltos mayores (`@e2b/sdk`, transformers/sharp); no se forzaron cambios incompatibles.

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

El nucleo de tests y el frontend local son funcionales bajo un perfil de datos escribible. El repositorio no debe declararse listo para entrega hasta resolver la ruta/permisos de datos de Windows, revisar las vulnerabilidades de produccion con actualizaciones compatibles y cerrar la politica de firma de skills.
