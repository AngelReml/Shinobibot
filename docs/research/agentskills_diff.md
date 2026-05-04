# Diff Shinobi vs spec agentskills.io

Fecha: 2026-05-04
Spec consultado: <https://agentskills.io/specification> (fetched 2026-05-04, sección frontmatter + directory + progressive disclosure).

## A1.1 — Snapshot del spec

agentskills.io es un estándar abierto **iniciado por Anthropic**, ahora adoptado por ~38 productos (Claude Code, Cursor, OpenCode, Goose, OpenHands, Gemini CLI, Codex, Letta, Roo Code…). Lo importante:

- **Una skill = un directorio**.
- El único archivo obligatorio es `SKILL.md` en la raíz.
- El `SKILL.md` lleva **YAML frontmatter** + **cuerpo Markdown libre**.
- Carga **progresiva en 3 fases**: discovery (sólo `name`+`description`), activation (cuerpo entero del `SKILL.md`), execution (scripts/refs bajo demanda).

```
my-skill/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code (python/bash/js)
├── references/       # Optional: docs cargadas a demanda
├── assets/           # Optional: templates, images, schemas
└── ...
```

## A1.2 — Manifiesto

Sólo el frontmatter de `SKILL.md`:

| Campo            | Requerido | Tipo   | Restricciones |
|------------------|-----------|--------|---------------|
| `name`           | sí        | string | 1–64 chars · `[a-z0-9-]+` · sin guion al inicio/fin · sin `--` · **debe coincidir con el nombre del directorio** |
| `description`    | sí        | string | 1–1024 chars · qué hace + cuándo usarse · keywords útiles para discovery |
| `license`        | no        | string | nombre de licencia o referencia a archivo |
| `compatibility`  | no        | string | ≤500 chars · requisitos de entorno (producto, paquetes, red…) |
| `metadata`       | no        | object | mapping string→string libre, claves "razonablemente únicas" |
| `allowed-tools`  | no        | string | **experimental**, lista separada por espacios de tools pre-aprobadas (ej. `Bash(git:*) Read`) |

Cuerpo: Markdown libre. Recomendación oficial: **<500 líneas** y **<5000 tokens**. Material extenso → `references/*.md`.

## A1.3 — Permisos

agentskills.io **no define un modelo de permisos formal**. Lo más cercano:

- `compatibility`: declarativo, indica al cliente si la skill espera red, paquetes, etc.
- `allowed-tools` (experimental): el cliente puede pre-aprobar un subset de tools.
- En la práctica los permisos viven **en el cliente** (Claude Code, Cursor, etc.), no en el spec.

Implicación para Shinobi: nuestro `visibility` (private/public/premium) y `status` (verified/promoted) **no están en el spec**, pero podemos guardarlos en `metadata.shinobi.*` sin romper compatibilidad.

## A1.4 — Triggers

Tampoco hay un campo `triggers` formal. La activación es **descripción-driven**:
- El agente lee `description` en discovery.
- Si la tarea match con esa descripción (decisión del propio LLM, no regex), carga el `SKILL.md` completo.

Implicación: Shinobi seguirá usando triggers internos (regex/intent/comando), pero **no son parte del manifiesto público**. Si los necesitamos serializar, va en `metadata.shinobi.triggers`.

## A1.5 — Engine (node/python/etc.)

**No declarado en el spec.** Citas literales:

> Supported languages depend on the agent implementation. Common options include Python, Bash, and JavaScript.

Las skills de ejemplo bundlean código en `scripts/` y se invocan por path (`scripts/extract.py`). El runtime decide cómo ejecutarlo. Si Shinobi quiere una pista, va en `compatibility` (texto libre) o `metadata.shinobi.engine`.

## A1.6 — Diff vs Shinobi actual

### Formato Shinobi hoy

`%APPDATA%/Shinobi/approved_skills/<id>.mjs` — un archivo `.mjs` ejecutable que importa `tool_registry.js` y llama `registerTool(...)`. El catálogo (en OG `data/skills_catalog.json`) guarda:

```ts
interface SkillEntry {
  id: string;                      // skill_<hex>
  name: string;                    // snake_case (ej. extract_emails)
  description: string;             // libre
  owner_key: string;               // X-Shinobi-Key del autor
  visibility: 'private'|'public'|'premium';
  status: 'unverified'|'verified'|'promoted'|'rejected';
  parameters_schema: any;          // JSON schema del input
  code_filename: string;           // <id>.ts
  tags: string[];
  created_at: string; updated_at: string;
  last_validation?: { ... };
}
```

### Diferencias

| Tema | Shinobi hoy | agentskills.io | Acción A2 |
|------|-------------|----------------|-----------|
| Unidad | `.mjs` plano + entry en catálogo | directorio con `SKILL.md` | Mantener `.mjs` interno + **emitir** un `SKILL.md` exportable |
| Naming | `snake_case` (ej. `extract_emails`) | `kebab-case` (ej. `extract-emails`) | A2.3: convertir snake↔kebab al exportar/importar |
| Manifiesto | JSON en catálogo central | YAML frontmatter en cada SKILL.md | A2.1: añadir campos `name`(kebab), `description`, `license`, `compatibility`, `metadata`, `allowed-tools` al `SkillEntry` |
| Discovery | API `/v1/skills/list` | filesystem scan de directorios | Compatible: el SkillsAgent puede emitir directorios y el catálogo sigue siendo la verdad de Shinobi |
| Permisos | `visibility` + `status` | no hay campo formal | Guardar en `metadata.shinobi.visibility` y `metadata.shinobi.status` |
| Triggers | implícitos (matching de prompt en SkillsAgent) | description-driven, sin campo | Guardar regex/intent en `metadata.shinobi.triggers` |
| Engine | Node ESM (`.mjs`) con `registerTool` | sin declarar (scripts/) | A2.3: emitir un `scripts/skill.mjs` y declarar `compatibility: "Requires Shinobi runtime / Node 20+"` |
| Permisos pre-aprobados | n/a | `allowed-tools` (experimental) | Mapear desde permisos internos si existen, o dejar vacío |
| Validación | `last_validation` con lint/compile/sandbox | n/a | Mantener interno; opcional exponer en `metadata.shinobi.validation` |
| Tamaño body | sin límite | <500 líneas / <5000 tokens recomendado | Generador debe producir bodies cortos; mover detalles a `references/` |
| `parameters_schema` | JSON Schema en el catálogo | n/a (las skills agentskills no exponen schema declarativo) | Guardar el schema en `metadata.shinobi.parameters_schema` para que clientes Shinobi sigan funcionando |

### Decisión de mapeo (input para A2.1)

`SkillSchema` v2 (versión Shinobi 1.1) añade campos espejo de agentskills.io. Lectura/escritura siempre vía catálogo central, **export e import** generan/consumen estructura `agentskills.io`-compliant:

```ts
interface SkillEntryV2 {
  // — agentskills.io frontmatter (espejo) —
  name: string;                     // kebab-case 1-64
  description: string;              // 1-1024
  license?: string;
  compatibility?: string;
  allowed_tools?: string;           // serializable como "Bash(git:*) Read"
  metadata?: Record<string,string>; // claves shinobi.* viven aquí

  // — campos internos Shinobi (no del spec) —
  id: string;                       // skill_<hex>
  legacy_name?: string;             // snake_case original (pre-migración)
  owner_key: string;
  visibility: SkillVisibility;
  status: SkillStatus;
  parameters_schema: any;
  code_filename: string;
  triggers?: { regex?: string[]; intents?: string[]; commands?: string[] };
  engine: 'node-mjs';               // por ahora único soportado
  tags: string[];
  created_at: string; updated_at: string;
  last_validation?: { ... };
  schema_version: '1.1';
}
```

Cuando el SkillsAgent **exporte** una skill como agentskills.io, produce:

```
<name>/
├── SKILL.md              # frontmatter + body con descripción extendida + uso
├── scripts/
│   └── skill.mjs         # el .mjs original con registerTool
├── references/
│   ├── parameters.json   # parameters_schema
│   └── triggers.json     # triggers
└── .shinobi/
    └── manifest.json     # SkillEntryV2 íntegro (para round-trip lossless)
```

`SKILL.md` body: descripción extendida (incluye el `description` resumido del frontmatter), tabla de parámetros, ejemplos input/output del último `last_validation`, y nota "Generado por Shinobi v…".

Cuando **importe** una skill agentskills.io ajena: leer frontmatter → poblar `SkillEntryV2` con `engine: 'node-mjs'` si `scripts/skill.mjs` existe; en caso contrario marcar `status: 'unverified'` y dejar engine como `'unknown'`. El path para soportar python/bash queda **fuera de A2** (anota TODO en `manual_actions.md` si surge).

### Riesgos/TODOs

1. **Naming collision**: si dos skills migran al mismo kebab (`extract_emails` → `extract-emails`) y ya existía una externa con ese nombre, sufijar `-shinobi`. A2.2 debe verificar.
2. **`allowed-tools` es experimental**: lo emitimos pero no nos basamos en él para autorización; el control real sigue en el cliente.
3. **Multi-engine futuro**: A1 confirma que el spec no obliga a Node. Si llegan B4 (skills desktop) o tareas python, vendrá una v1.2 del SkillSchema. Documentado.

## Referencias

- <https://agentskills.io/specification>
- <https://agentskills.io/skill-creation/quickstart>
- <https://github.com/agentskills/agentskills/tree/main/skills-ref> (validador oficial)
