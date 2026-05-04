# Program Discovery — visión cumbre

> "Que Shinobi sea verdaderamente útil para cualquier programa, no solo los que vienen con skill nativa."
> — Reporte de Criba, parte B1

Esta es la pieza que falta para que Shinobi pase de "agente con N skills hard-codeadas" a "agente que aprende programas desde cero". Es la diferencia entre un script y un agente real.

## Objetivo

Cuando el usuario pide algo en una app que no tiene skill nativa (ej. NotebookLM, Obsidian, Davinci Resolve), Shinobi:

1. **Detecta** que no tiene skill para esa app.
2. **Explora** la UI metódicamente (ventanas, menús, botones, atajos).
3. **Memoriza** el mapa de UI en memoria persistente.
4. **Genera tools propias** (skills) basadas en lo aprendido.
5. **Las usa** para cumplir el pedido del usuario.
6. **La próxima vez** la app ya está aprendida; entra directo a usarla.

## Estado de las piezas (qué ya existe)

| Pieza | Existe | Notas |
|---|---|---|
| Computer Use Windows nativo (`screen_observe`/`screen_act`) | ✅ | B9 cerrado, AMARILLO en criba (sin demo en vivo) |
| Generación de skills tras fallo (C3/C-INDEX) | ✅ | Verde |
| Memoria persistente con embeddings | ✅ | B5 fase C |
| Skill index + 3 modos | ✅ | C-INDEX |
| Forbidden zones / hash chain | ✅ | D5/AUDIT-DEV |

Lo que falta: el **protocolo de descubrimiento** que orquesta todo lo anterior.

## Protocolo (4 fases)

### Fase 1 — Detección de "programa nuevo"

Cuando el orchestrator recibe un prompt que menciona una app:
- Tokenize el nombre de la app.
- Match contra el catálogo de skills (`skill_index.findMatchingSkill` con categoría `desktop`).
- Si confidence < 0.30 → activar **Fase 2 (Exploración)**.
- Si confidence ≥ 0.30 pero ≥ 1 skill desktop registrada → usar/enhance.

### Fase 2 — Exploración inicial

Pasos automatizados:

1. **Launch**: ejecutar la app (registry + Start menu lookup).
2. **Window inventory**: capturar estructura de ventanas (`UIA tree` via PowerShell `Get-UIAutomationElement` o equivalente).
3. **Menu walk**: recorrer la barra de menús (File / Edit / View / etc.) sin clickear, sólo enumerar.
4. **Button inventory**: para cada vista visible, listar controles (button, input, list, ...).
5. **Screenshot baseline**: capturar 3-5 estados representativos.

Output: `discovery/<app-name>/inventory.json` + `screenshots/`.

### Fase 3 — Aprendizaje activo (objective-driven)

Sólo se activa cuando el usuario pide algo concreto:

1. Convertir el pedido en un objetivo verificable ("crea una nota llamada X").
2. Generar **plan de acciones tentativo** (LLM con el inventory.json en contexto).
3. **Ejecutar paso a paso** con verificación tras cada acción (screenshot + UIA tree → ¿cambió la UI según lo esperado?).
4. Si un paso falla, intentar **3 alternativas** (similar a C-INDEX 3 modos):
   - **Reuse** una sub-skill existente que parezca aplicable.
   - **Enhance** una sub-skill modificándola para esta app.
   - **Generate** una nueva con LLM.
5. Cuando se complete el objetivo, **persistir las acciones que funcionaron** como skill nueva.

### Fase 4 — Materialización a skill

La secuencia de acciones que cumplió el objetivo se compila en un bundle agentskills.io:

```
%APPDATA%/Shinobi/agentskills/<app>-<intent>/
├── SKILL.md                          # frontmatter + descripción de cuándo usarla
├── scripts/skill.mjs                 # entry, registra tool con execute(args)
├── inventory.json                    # snapshot de UI relevante
└── .shinobi/manifest.json            # round-trip
```

La próxima vez que el usuario pida lo mismo, `findMatchingSkill` encuentra la skill y entra en modo REUSE. Si el pedido es distinto pero relacionado, modo ENHANCE.

## Diseño de datos

```ts
interface ProgramInventory {
  app_id: string;            // canonical, kebab-case (ej. "notebook-lm-desktop")
  exe_path: string;
  exe_version?: string;
  windows: WindowSnapshot[];
  menus: MenuPath[];          // ej. [{ path: ["File","New","Document"], shortcut: "Ctrl+N" }]
  controls_per_window: Record<string, Control[]>;
  screenshots: { name: string; path: string }[];
  discovered_at: string;
  skills_derived: string[];   // skill_ids that came from this inventory
}

interface DiscoveredAction {
  step: number;
  action: 'click' | 'type' | 'wait' | 'shortcut' | 'screen_act' | 'screen_observe';
  target_selector: string;    // UIA path or coords
  args: Record<string, unknown>;
  pre_state: string;          // hash de screenshot pre
  post_state: string;         // hash de screenshot post
  verified: boolean;
}
```

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| LLM alucina selectores que no existen | Verificar tras cada acción con UIA tree post; si la UI no cambió como esperado, abortar y proponer alternativa. |
| Apps con UI dinámica (web embedded, custom WPF) | Fallback a coordenadas + OCR; documentar que para esos casos la skill será frágil. |
| Acciones destructivas (borrar archivos del usuario) | Forbidden zones de D5 ya cubren paths peligrosos; cualquier `screen_act` que lleve a "delete" / "remove" pasa por el Behavioral Deviation Score. |
| Time blow-up (apps lentas) | Hard timeout por skill (5 min default). Discovery se aborta y guarda lo que aprendió para reanudar. |
| Skills duplicadas para misma app | C-INDEX reflection loop detecta `parameters_hash` similares entre skills generadas; se proponen para fusión. |

## MVP escope

Para que esto NO se quede en doc:

1. **Caso piloto único**: Notepad (la app más simple posible — no Obsidian ni VSCode todavía).
2. **Inventory builder**: PowerShell wrapper que extrae UIA tree y lo serializa a JSON.
3. **Discovery orchestrator**: clase nueva en `src/discovery/` que ata las 4 fases para Notepad.
4. **Single objective**: "crea archivo nuevo, escribe texto X, guarda como Y.txt".
5. **Skill persistida**: bundle agentskills.io en disco que cualquier futuro shinobi puede usar.

Si el MVP funciona con Notepad, el siguiente caso es Obsidian. Después VSCode. Antes de prometer "aprende cualquier programa", probar al menos **3 apps distintas** con éxito.

## Tracking

- Este doc es la spec; **NO hay código todavía**. La criba lo lista como ROJO.
- El MVP queda como bloque pendiente. Cuando se aborde, abrir issue / branch `feat/program-discovery-mvp`.
- Mientras tanto, lo que **sí podemos prometer** en landing pública: "Shinobi tiene Computer Use Windows + 8 skills nativas para apps comunes". Lo que **NO**: "aprende cualquier programa".

## Por qué no construirlo ahora en esta sesión

1. **Scope**: las 4 fases son ~3-4 días de trabajo bien hecho. En este turno no caben.
2. **Riesgo**: una versión a medias prometería más de lo que entrega. Mejor diseñado que medio-construido.
3. **Dependencias críticas**: necesita interacción con UI real para validarse — eso requiere al usuario al teclado, no se puede E2E sin él.

Documento + plan detallado deja a Iván listo para abordarlo en la próxima sesión cuando esté frente a la máquina.
