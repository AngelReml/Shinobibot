# Promptfoo — juez objetivo de calidad de prompt

FASE 0 del encargo "Refinador de prompts". Promptfoo se integra como
**infraestructura de validación**, no como dependencia en caliente de
producción: solo lo invocan golden sets y herramientas de evaluación, nunca
el camino de respuesta al usuario.

## Para qué

Dado un prompt **A** (original) y un prompt **B** (refinado), Promptfoo los
puntúa contra un set de casos reales y devuelve un veredicto objetivo con
número: ¿B supera a A, lo empata, o lo empeora?

Esto cierra el círculo del refinador (FASE 1): un prompt refinado solo se
acepta si Promptfoo confirma con número que no empeora al original.

## Piezas

| Pieza | Qué es |
|-------|--------|
| `promptfoo` (devDependency) | El motor de evaluación. No entra en producción. |
| `src/evaluation/prompt_quality.ts` | La API programática `evaluatePromptQuality(A, B, cases)`. |
| `promptfoo/promptfooconfig.yaml` | Config versionada, ejecutable a mano para inspección. |
| `scripts/audit_validation/fase0_promptfoo_golden.ts` | Golden set: 12 pares (A,B) con ganador conocido. |

## Uso programático (el real)

```ts
import { evaluatePromptQuality } from './src/evaluation/prompt_quality.js';

const r = await evaluatePromptQuality(promptA, promptB, cases);
// r = { winner: 'A' | 'B' | 'tie', scoreA, scoreB, detail, error? }
```

Contrato de robustez: **siempre responde, nunca lanza**. Si Promptfoo falla
(no instalado, timeout, error de proveedor) devuelve
`{ winner: 'tie', error: <motivo> }` y deja decidir al llamador — mismo
contrato que la skill `prompt_refactor` del Bloque 4.

Cada caso (`EvalCase`) lleva `vars` (rellenan `{{var}}` o `{var}` en los
prompts) y `assert` (aserciones Promptfoo: deterministas o `llm-rubric`).

## Uso por línea de comandos (inspección manual)

```
npx promptfoo eval -c promptfoo/promptfooconfig.yaml
```

Requiere `OPENROUTER_API_KEY` en el entorno — el provider es Haiku vía
OpenRouter, el backend barato de Shinobi (§8 del manual: la evaluación de
rutina no usa el modelo caro).

## Diseño de aserciones

Las aserciones deben estar **ancladas al contenido**, no a proxies de
formato: comprueban que el output hace de verdad la tarea sobre el input
(p. ej. `icontains` de una palabra clave que solo aparece si el modelo
procesó el texto). Un proxy de formato (`¿contiene un guion?`) es engañoso —
un prompt roto puede satisfacerlo por accidente.
