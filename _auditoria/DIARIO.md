# Diario de cierre - Shinobii

## 2026-09-13

- Se descarto usar como PR directo la rama vieja `limpieza/shinobii-auditoria-20260912` porque no partia limpiamente de `main` y arrastraba diferencias historicas.
- Se creo una rama limpia desde `main`: `limpieza/shinobii-presentable-main-20260913`.
- Se portaron solo correcciones con evidencia previa y se encontraron dos fallos adicionales al validar sobre `main`:
  - SQLite de memoria fallaba al abrir la base de datos cuando el directorio por defecto no era escribible.
  - El guard de egress rompia el arranque web con respuestas DNS multiples.
- Ambos fallos quedaron corregidos y cubiertos por pruebas.
- Se regenero `package-lock.json` desde `package.json` y se ejecuto `npm audit fix` hasta dejar 0 vulnerabilidades.
- Se ejecuto suite completa final: 247 archivos de test, 2313 tests OK, 3 skipped.
- Se ejecuto auditoria real de producto: razonamiento verificable, Excel, SVG, extraccion web y frontend local.
- Tras crear el PR, CI marco rojo el smoke D-017. Se corrigio el smoke para alinearlo con la politica real mas segura (`critical` por defecto y `validatePath` duro) y se valido localmente 7/7 OK.

Recordatorio del encargo: se omitio la prueba de email en vivo porque el usuario indico continuar con lo demas y recordarlo al terminar.
