# `shinobi import hermes`

Importa un install existente de **Hermes** a la disposición Shinobi nativa, sin tocar el original.

## Detección

Busca el directorio raíz de Hermes en este orden:

1. `--hermes-root <path>` (CLI flag)
2. `HERMES_HOME` (env var)
3. `~/.hermes`
4. `%USERPROFILE%/.hermes`

Si nada existe, sale con un warning y exit code 1 (en `--apply`) o 0 (en `--dry-run`).

## Uso

```sh
# Preview (default — nada se escribe)
shinobi import hermes

# Aplicar cambios. Backup automático del destino si ya existe.
shinobi import hermes --overwrite

# Override paths (útil para tests / instalaciones no estándar)
shinobi import hermes \
  --hermes-root "D:\backup\hermes" \
  --shinobi-dir "%APPDATA%\Shinobi" \
  --repo-dir   "C:\Users\me\Desktop\shinobibot"
```

Salida típica de `--dry-run`:

```
Hermes root  : C:\Users\you\.hermes
Shinobi dir  : C:\Users\you\AppData\Roaming\Shinobi
Found        :
  config.yaml : true
  MEMORY.md   : true
  USER.md     : true
  skills/     : true (4)
  API keys    : OPENROUTER_API_KEY, ANTHROPIC_API_KEY

Planned actions: 8
  • [config] config.yaml -> Shinobi/config.json
    target: C:\Users\you\AppData\Roaming\Shinobi\config.json
  • [memory] MEMORY.md -> SQLite memory.db (category=project)
    target: C:\Users\you\AppData\Roaming\Shinobi\memory.db
  ...
```

## Qué se importa

| Origen Hermes | Destino Shinobi | Notas |
|---|---|---|
| `<hermes>/config.yaml` | `%APPDATA%/Shinobi/config.json` | Mapea `opengravity_url`, `opengravity_api_key`, `language`, `memory_path` (mejor esfuerzo). `imported_from: "hermes"` queda anotado. |
| `<hermes>/MEMORY.md` | `memory.db` (categoría `project`) | Cada sección `## ...` se almacena como un `MemoryEntry`. Si no hay headings, se almacena como un único registro. |
| `<hermes>/USER.md` | `memory.db` (categoría `user`, `importance=0.8`) | Igual que MEMORY.md pero más prioridad. |
| `<hermes>/skills/<name>/` | `%APPDATA%/Shinobi/agentskills/<name>/` | Copia recursiva (incluye `SKILL.md`, `scripts/`, `references/`, etc.). |
| `<hermes>/.env`, `config.yaml`, `secrets.yaml`, `keys.json` | `<repo>/.env` | Sólo claves cuyo nombre coincide con `*_API_KEY` o que se reconocen por patrón (`sk-or-`, `sk-`, `sk-ant-`, ElevenLabs). Variables que no son API keys se ignoran. |

## Reglas operativas

- **Default `--dry-run`**. Nunca escribe sin `--overwrite`.
- **Backup automático** del fichero destino si ya existe (`<file>.backup-<UTC>`). En el caso de `agentskills/<name>/` es renombrado en bloque a `<name>.backup-<UTC>` antes de escribir.
- `.env` se actualiza preservando claves existentes y añadiendo sólo las que faltan, bajo un comentario `# imported from hermes <UTC>`.
- Si la DB SQLite no se puede abrir (`better-sqlite3` no carga, etc.), el paso de memoria reporta el error en `errors[]` y los demás pasos continúan.

## Comandos

| Flag | Default | Efecto |
|---|---|---|
| (sin flag) | dry-run | Imprime el plan, no escribe nada |
| `--dry-run` | — | Idéntico al default, explícito |
| `--overwrite` | off | Aplica cambios; backups automáticos |
| `--hermes-root <p>` | autodetect | Fuerza ruta de Hermes |
| `--shinobi-dir <p>` | `%APPDATA%/Shinobi` | Destino raíz de Shinobi |
| `--repo-dir <p>` | `cwd` | Destino del `.env` del repo |

## Salida

Exit codes:

- `0` — plan ejecutado sin errores (incluye dry-run).
- `1` — al menos un paso registró error (devuelto en `errors[]`).

## Test de referencia

`src/migration/__tests__/from_hermes.test.ts` levanta un `~/.hermes` sintético con `config.yaml`, `MEMORY.md`, `USER.md`, dos skills y un `.env` con dos API keys. Verifica:

1. Detección por override.
2. `buildPlan()` reporta los 6 acciones esperadas.
3. `dry-run` no escribe nada.
4. `--overwrite` escribe `config.json`, dos directorios `agentskills/<name>/` y un `.env` con sólo las API keys (no `OTHER_VAR`).
5. Re-ejecutar sin `--overwrite` no produce errores.

## Pendiente (no en este bloque)

- Si Hermes empieza a usar otro path para skills (p. ej. `~/.hermes/.local/share/skills`), añadir candidato en `listHermesSkills`.
- Detección de `engine: python` en skills migradas: por ahora se preserva tal cual; el SkillsAgent de Shinobi sólo ejecuta Node, así que pasar a python requiere un wrapper que no toca este bloque.
