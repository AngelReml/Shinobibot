# docs/

Documentación de arquitectura que describe el código tal y como es hoy. Para
instalar y arrancar, ver el `README.md` de la raíz.

| Fichero | Qué describe |
|---|---|
| `ARQUITECTURA_MEMORIA.md` | Las 4 capas de memoria y el rol de cada una (`src/memory/`, `src/db/memory.ts`, `src/learning/memory_separation.ts`). |
| `BROWSER_SUBSYSTEM.md` | El subsistema de navegador "Kage": observación por mapa de refs, acción anclada con verificación (`src/browser/`, `src/tools/browser_*.ts`). |
| `ARQUITECTURA_HABILIDAD_A.md` | Lectura jerárquica de repos: partición → sub-agentes en paralelo → síntesis (`src/reader/`). |
| `architecture/resident_mode.md` | El modo agente residente 24/7 (`src/runtime/resident_loop.ts`). |
| `mission_schema.md` | Estructura mínima de una misión autónoma. |
| `migrations/from_hermes.md` | El comando `shinobi import hermes` (`src/migration/`). |
