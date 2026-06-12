# Dictamen del techo real de Shinobi — batería M1–M5

> Sesión de stress-testing del 2026-06-10. Misiones lanzadas contra Shinobi vivo
> (WebChat, modo local, modelo auto) y verificadas contra el disco / la web real.
> Regla del repo: ninguna afirmación sin dato medido. Todo lo de abajo está
> observado en el Rastro o verificado en código.

## TL;DR

El techo de Shinobi **no es la inteligencia del modelo** — es **el bucle agéntico y
la herramienta de navegación**. Tras arreglar la fontanería de proveedores y
contexto, los diferenciadores de arquitectura (enjambre, candado, navegación +
extracción real) funcionan y están **verificados**. Lo que limita la fiabilidad en
misiones autónomas largas son tres cosas concretas: `browser_observe` roto, un
detector de bucles demasiado tosco, y una auto-corrección que ataca síntomas, no
causas.

## Resultado por misión

| # | Misión | Resultado | Evidencia |
|---|--------|-----------|-----------|
| M1 | Auditar su propio repo con evidencia | ✓ con matiz | Pegó **código verbatim real** (verificado: `extractDom`, `SandboxMode`, `DESTRUCTIVE_PATTERNS`, `ApprovalMode`, `checkDestructiveHotkey` existen tal cual). Números de línea **erróneos**. |
| M2 | Navegar HN real, extraer, calcular ratios | ✓ verificado | Navegó HN de verdad; títulos y números coinciden con la página real (deriva de 1–3 por contadores live); ratios bien calculados. |
| M3 | Dataset + anomalías + auto-corrección | ✗ parcial | Diagnosticó bien un `UnicodeEncodeError` de Windows pero lo arregló **carácter a carácter**; el loop-detector lo abortó antes de converger. Sin métricas finales. |
| M4 | Enjambre de sub-agentes en paralelo | ✓ verificado | `run_swarm` real con 3 tareas; 3 sub-agentes concurrentes (failover paralelo en el Rastro); resúmenes exactos al código (incluyó el FIX-3 recién añadido → leyó el fichero vivo). |
| M5 | Web + comprensión + escribir fichero | ✗ fallo | `browser_observe` reventó (`ReferenceError: __name is not defined`); `web_search` insuficiente (5 queries, nunca abrió un resultado); loop-detector lo mató. Fichero **no** escrito. |

Marcador: **2 verificadas, 1 con matiz, 2 falladas** — y las dos falladas y el matiz
apuntan al mismo sitio: el bucle de acción, no el razonamiento.

## Bugs encontrados (con localización)

### Arreglados en esta sesión (código)
1. **Contexto global** — el historial del agente era un singleton de sesión; un
   "ping" en conversación nueva pedía 30.189 tokens. `db/context_builder.ts` leía
   un `memory.json` global. → `setConversation()` en el orchestrator da a cada
   conversación su fichero. Medido: 30.189 → 14.038 tokens en conversación nueva.
2. **Model-ID sin normalizar** — `openai/gpt-4o` (prefijo OpenRouter) llegaba al
   cliente directo de OpenAI → "invalid model ID". `providers/openai_client.ts:22`
   mandaba el ID crudo. → `normalizeModelId()` en los 3 clientes directos.
3. **Anthropic rechazaba `tool_calls`** — `anthropic_client.ts` no traducía
   mensajes assistant con `tool_calls` a bloques `tool_use`. → traducción añadida;
   medido: Anthropic pasó de fallar siempre a servir como fallback real.
4. **Groq rechazaba `refusal`** — campo que OpenAI emite y Groq no acepta. →
   whitelist de campos (`sanitizeOpenAiMessages`).

### Pendientes (hallazgos nuevos de M3/M5)
5. **`browser_observe` roto** — `src/browser/observer.ts:117` hace
   `page.evaluate(collectInteractiveElements)` pasando una **función con nombre**
   que el bundler (tsup/esbuild) envuelve en `__name()`, helper inexistente dentro
   de la página → `ReferenceError: __name is not defined`. El mapa de elementos
   (la base para rellenar formularios y pulsar botones) **no funciona**. Arreglo:
   pasar el cuerpo como string a `evaluate`, o inyectar `globalThis.__name = (f)=>f`
   antes, o desactivar el `keepNames` del bundler para ese módulo.
6. **Loop-detector demasiado tosco** — hashea el **comando/tool**, no el estado
   subyacente. En M3 mató un ciclo legítimo editar-script→reejecutar (el comando
   `python x.py` se repetía aunque el script cambiaba); en M5 mató un
   refinamiento legítimo de búsqueda. Debería considerar si el estado (fichero,
   query) cambió entre llamadas.
7. **Auto-corrección sintomática** — arregla el primer síntoma visible, no la
   causa raíz (quitó emojis Unicode uno a uno en vez de fijar el encoding una vez).
8. **Citas de línea poco fiables** — pega el código real pero inventa el número de
   línea. `read_file` no devuelve números de línea, así que el modelo no los tiene.
9. **`web_search` sin fetch** — busca pero no abre los resultados para leerlos;
   declaró "no relevante" sobre un benchmark (tau-bench) que es trivial de
   encontrar abriendo el primer resultado.

### Entorno (tuyo, no código)
- OpenRouter **sin saldo** (cuenta vacía) → siempre falla primero.
- Groq free tier **12k TPM** < el ~14k de baseline de Shinobi → Groq inservible
  mientras el system prompt + esquemas pesen tanto.
- Anthropic tier **50k input/min** → se satura en misiones de varias iteraciones.

## Dónde brilla (verificado, no marketing)
- **Enjambre real** (M4): descompone en sub-agentes que corren en paralelo de
  verdad y consolida. El cerebro portado de swarm-ide funciona end-to-end.
- **Navegación + extracción + cálculo** (M2): saca datos reales de una web viva y
  opera sobre ellos correctamente.
- **Evidencia anclada** (M1): cuando el contexto está limpio y se le exige, pega
  código real verbatim en vez de inventar.
- **El candado** (§11): pidió permiso para cada host nuevo y para cada acción
  sensible, sin fallar al lado inseguro.

## Veredicto

Subí el suelo (proveedores + contexto ya no matan misiones). El techo que queda a
la vista es **operacional, no intelectual**: el agente piensa razonablemente y sus
diferenciadores de arquitectura son reales y verificables, pero su capacidad de
**actuar sobre la web de forma fiable** (observar → interactuar → auto-corregir en
bucle) está limitada por dos bugs concretos (`browser_observe`, loop-detector) y
una estrategia de auto-corrección superficial.

**El siguiente frente, en orden de valor:** (1) arreglar `browser_observe` —es tu
diferenciador estrella y está medio roto—; (2) hacer el loop-detector consciente
del estado para que deje converger los ciclos legítimos; (3) que `web_search` abra
el primer resultado; (4) devolver números de línea en `read_file`. Ninguno es de
inteligencia: los cuatro son fontanería del bucle. Arréglalos y el techo sube solo.
