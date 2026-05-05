# ARQUITECTURA — Habilidad A (Lectura jerárquica de repos)

Versión 1.0 · 2026-05-05 · gate A.1

> Documento contrato. Cualquier desviación al implementar A.2/A.3/A.4 requiere PR explícito que actualice este doc primero.

---

## 1. Problema

Shinobi necesita producir un reporte legible por humano sobre qué hace un repo arbitrario, sin alucinar. Un único LLM mirando todo el árbol no escala (ventana de contexto, latencia, coste). La solución: **partición → lectura paralela por sub-agentes → síntesis**.

## 2. Componentes

```
RepoReader
 ├─ partition(path, budget) → SubTask[]
 ├─ spawn(SubTask[])        → Promise<SubReport[]>   (Promise.all sobre SubAgent)
 └─ synthesize(SubReport[]) → RepoReport             (Opus 4.7)

SubAgent (función pura)
 (SubTask, llm_client) → SubReport | { error: string }
```

- `RepoReader.ts` orquesta. No habla con el LLM directamente para tareas de hoja: delega a `SubAgent`.
- `SubAgent.ts` recibe una sub-ruta + prompt y devuelve JSON validado. Si el JSON no valida, retry una vez con el error del validador. Si vuelve a fallar: `{ error }` y el supervisor decide.
- `synthesize` siempre lo llama Opus 4.7 (modelo de síntesis crítica). No se delega.

## 3. Schemas

### 3.1 SubReport (output de cada sub-agente)

```jsonc
{
  "path": "src/runtime",                    // ruta relativa al root del repo
  "purpose": "string (≤200 chars)",         // qué hace esta carpeta en una frase
  "key_files": [                            // máx 8
    { "name": "executor.ts", "role": "string (≤100 chars)" }
  ],
  "dependencies": {                         // qué consume esta carpeta
    "internal": ["src/utils/permissions"],  // otras rutas del repo
    "external": ["axios", "playwright"]     // paquetes npm o equivalente
  },
  "concerns": [                             // observaciones, máx 5
    "string (≤150 chars)"
  ]
}
```

Todos los campos son obligatorios. `key_files` y `concerns` pueden ser `[]` pero deben existir.

### 3.2 RepoReport (output sintetizado por Opus)

```jsonc
{
  "repo_purpose": "string (≤300 chars)",    // qué es el repo, en una frase
  "architecture_summary": "string (≤1500 chars, markdown)",
  "modules": [                              // resumen por módulo de alto nivel
    {
      "name": "runtime",
      "path": "src/runtime",
      "responsibility": "string (≤200 chars)"
    }
  ],
  "entry_points": [                         // dónde arranca la ejecución
    { "file": "scripts/shinobi.ts", "kind": "cli" }
  ],
  "risks": [                                // detectados por contraste entre sub-reportes
    { "severity": "low|medium|high", "description": "string (≤200 chars)" }
  ],
  "evidence": {                             // metadata de la ejecución
    "subagent_count": 6,
    "tokens_total": 0,
    "duration_ms": 0,
    "subreports_referenced": 6
  }
}
```

`risks` debe incluir cualquier contradicción detectada entre sub-reportes (un módulo dice X, otro dice ¬X).

### 3.3 Validación

- Validación con `zod`. Cada schema vive en `src/reader/schemas.ts` y se exporta para tests.
- Si el LLM devuelve JSON que no valida: retry una vez con el mensaje de error de zod incluido en el prompt como guía. Segundo fallo → degradar.

## 4. Regla de partición

Entrada: `path` (root del repo) + `budget` (max sub-agentes, max tokens).

Algoritmo:

1. **Listar** las entradas top-level del path (carpetas + archivos sueltos).
2. **Filtrar ruido** mediante glob deny-list común: `node_modules`, `dist`, `build`, `.git`, `.venv`, `__pycache__`, `.next`, `coverage`, `*.log`, `*.lock`. Editable en `READER_IGNORE_PATTERNS` constante.
3. **Agrupar** carpetas hermanas pequeñas (< 10 archivos) en un único sub-agente compartido bajo etiqueta `misc/`.
4. **Cap de paralelismo**: máx `budget.maxSubagents` (default 6) sub-agentes simultáneos. Si hay más subramas candidatas, las menos pobladas se agrupan.
5. **Archivos top-level sueltos** (README, package.json, configs raíz): siempre asignados a un sub-agente "root_meta" obligatorio.
6. **Cap de tokens por sub-agente**: `budget.tokensTotal / budget.maxSubagents`. Cada SubAgent trunca su entrada si excede su cuota (lectura priorizada por: README, archivos `index.*`, archivos con más imports inversos).

Resultado: array `SubTask[]`, donde cada `SubTask = { sub_path, files_to_read[], prompt, token_budget }`.

## 5. Presupuesto por defecto

```ts
const DEFAULT_BUDGET = {
  maxSubagents: 6,
  tokensTotal: 50_000,        // hard cap suma de input+output de todos los sub-agentes
  perSubagentTimeoutMs: 90_000,
  totalTimeoutMs: 180_000,    // gate A.3 exige <2 min en repo OpenGravity
};
```

Override por CLI: `/read <path> --budget=N` donde `N` es `tokensTotal`. `maxSubagents` se ajusta proporcionalmente (`floor(tokensTotal / 8000)`, mínimo 2, máximo 12).

`BudgetGuard` (ya existe en el repo) se invoca antes de cada `spawn` y antes de `synthesize`.

## 6. Modelos

| Componente   | Modelo               | Razón                                          |
|--------------|----------------------|------------------------------------------------|
| `SubAgent`   | claude-haiku-4-5     | Volumen, latencia baja, lectura local         |
| `synthesize` | claude-opus-4-7      | Resolver contradicciones requiere razonamiento |

Gateway: OpenRouter (S4 del plan). El cliente LLM se inyecta en el constructor de `RepoReader` para permitir mocks en tests.

## 7. Errores y degradación

- Sub-agente con JSON inválido tras retry → su `SubReport` se sustituye por `{ path, purpose: "[unreadable]", error: string }` en el array entregado a `synthesize`. Opus marca esa rama como `risk: medium` automáticamente vía system prompt.
- `synthesize` que devuelve JSON inválido → retry una vez. Si falla: `RepoReader` emite `{ ok: false, error, partial: SubReport[] }` y el CLI imprime un fallback humano (lista de sub-reportes crudos).
- Timeout total → todos los sub-agentes en curso se abortan, `synthesize` corre con los que llegaron, marcando los faltantes en `risks`.

## 8. Persistencia y auditoría

Cada ejecución de `/read` genera dos artefactos en `missions/<timestamp>_read/`:
- `subreports.json` — array crudo de SubReports.
- `report.json` — RepoReport sintetizado.
- `meta.json` — `{ path, budget, model_calls, total_cost, duration_ms }`.

Esto alimenta D.4 (MissionLedger) sin reescritura posterior.

## 9. Invariantes técnicas

1. **Ningún sub-agente devuelve texto libre.** Solo JSON validado contra `SubReport`.
2. **`synthesize` nunca delega a Haiku.** Síntesis crítica = Opus.
3. **El supervisor no ejecuta lectura por sí mismo.** Toda lectura pasa por un `SubAgent`.
4. **Hallucination guard**: el system prompt de `SubAgent` incluye literalmente "If you cannot read the file, set the field to null. Do NOT invent paths or function names." Tests A.4 verifican adherencia.

## 10. Qué este documento NO decide

- Concurrency primitive (Promise.all es default; si hay back-pressure, decisión en A.2).
- Formato del display CLI streaming (decisión en A.3).
- Visualización del árbol jerárquico para D.2 (decisión en D.2).

---

FIN del documento de Habilidad A · v1.0
