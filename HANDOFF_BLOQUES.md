# HANDOFF — Encargo multibloque "Equipo de especialistas Shinobi"

Ejecución autónoma encadenada 1→2→3→4. Cada bloque cierra solo con su golden
set al 100% ejecutado por el agente. Este fichero registra, por bloque, el
prompt de test humano EXACTO (textual, copiable) que Iván puede ejecutar.

Estado base: HEAD `9137e30` — memoria en Markdown cerrada, 899/899 tests verdes.

---

## PASO 0 — Manual de prompting persistido

`manual_prompting.md` copiado byte por byte a `docs/prompting_manual.md`
(sha256 `c40e45ed47bc99ec`, `cmp` idéntico). Fuente de verdad del sistema de
prompting en el repo.

---

## BLOQUE 1 — Abstracción de agente especialista ✅ CERRADO

**Qué se construyó:** `src/agents/` — contrato `SpecialistAgent` (identidad,
especialidad en una frase, caja cerrada de herramientas, prompt madre con
matriz §7 + checklist §13 documentados en frontmatter) y tres agentes
concretos: `ResearchAgent` (L2, lee web no confiable → §9 capa 3: caja de
solo-lectura validada en construcción), `DocsAgent` (L2), `DataAgent` (L2).
Tool de introspección `list_specialist_agents`. Sin lógica de output todavía
(Bloque 2).

**Golden set:** `scripts/audit_validation/block1_agents_golden.ts` — 15 casos
deterministas, incluido el adversarial (agente usa herramienta fuera de su
caja → `ToolNotAllowedError` limpio). Resultado: **15/15 PASS**.

**Prompt de test humano:**

```
lista los agentes especialistas disponibles y di qué herramientas tiene permitidas cada uno
```

---

## BLOQUE 2 — Outputs tangibles ✅ CERRADO

**Qué se construyó:** lógica de output real en los 3 agentes (auditoría previa
sobre `research_agent.ts` / `docs_agent.ts` / `data_agent.ts` — eran contratos
puros sin comportamiento, modificación aditiva).
- `DocsAgent.produce()` → documento real (Markdown estructurado o PDF vía
  Playwright) usando `src/documents/factory.ts`; sin librería nueva.
- `DataAgent.produce()` → gráfico real `.svg` (renderizador SVG plano
  `src/documents/chart.ts` + tool `generate_chart`); sin librería nueva.
- `ResearchAgent.produce()` → investigación con fuentes verificables citadas
  (§10: sin fuente → `valid:false`, "INSUFFICIENT EVIDENCE"). Usa la tool
  `web_search` en producción vía el seam `searchFn`.
- Imagen: cubierta por los gráficos SVG. Vídeo: descartado, no construido.

**Golden set:** `scripts/audit_validation/block2_outputs_golden.ts` — 12 casos,
ejecución real (LLM + ficheros). Incluye 2 adversariales §9 capa 1 (celda de
dataset con instrucción / resultado web con prompt injection → tratados como
dato) y 2 bordes (contenido vacío, búsqueda sin resultados). Resultado:
**12/12 PASS**. Nota §10.1: ResearchAgent se valida con fixtures de resultados
web reales capturados (URLs verificables) inyectados por `searchFn`; la prueba
en vivo es el prompt de test humano.

**Prompt de test humano:**

```
investiga las 3 diferencias principales entre los frameworks de agentes CrewAI y LangGraph y entrégame un informe en PDF
```

---

## BLOQUE 3 — Despacho por afinidad en shadow mode ✅ CERRADO (sin promover)

**Qué se construyó:** `src/dispatch/` — clasificador de despacho `classifyDispatch()`
que decide el especialista (research/docs/data/general) de una orden con el
mismo GPT-4o de Shinobi (`makeLLMClient`), UN paso, sin embeddings ni librería
ni proceso nuevos. Prompt madre **L1** (`classifier_prompt.md`, matriz §7 + §13
en frontmatter). Cableado en `orchestrator.process()` en **SHADOW MODE**:
opt-in (`SHINOBI_SHADOW_DISPATCH=1`), fire-and-forget, registra la decisión en
`shadow_dispatch.jsonl` y NO toca el despacho real. Auditoría previa: confirmado
que hoy no hay router — despacho directo; el clasificador se añade en paralelo.

**Golden set:** `scripts/audit_validation/block3_dispatch_golden.ts` — 18 casos
(16 de clasificación etiquetada: 4 research + 4 docs + 4 data + 3 general/
ambiguos + 1 adversarial con instrucción inyectada; 2 estructurales del
registro shadow). Resultado: **18/18 PASS**. Fix durante el ciclo: el
clasificador reintenta también ante excepción del proveedor (no solo ante
JSON inválido) — jamás propaga un fallo al despacho.

**⚠ PARADA (a) — PROMOCIÓN PENDIENTE DE IVÁN.** El clasificador queda en
shadow mode. NO se ha promovido a despacho real y NO se promoverá de forma
autónoma. Para promover: revisar `shadow_dispatch.jsonl` (usar
`summarizeShadowLog()`), confirmar que el acierto es estable, y dar la
confirmación humana explícita. Hasta entonces, el despacho real sigue 100%
en el orchestrator general.

**Prompt de test humano (dos mensajes):**

```
analiza estos números de ventas y dame los 3 insights principales: ene 12000, feb 9500, mar 14200, abr 13100
```
```
busca qué es el protocolo MCP de Anthropic y resúmelo
```

---

## BLOQUE 4 — Skill de automejora de prompts ✅ CERRADO

**Qué se construyó:** skill `prompt_refactor` invocable por Shinobi.
- `src/tools/prompt_refactor.ts` — tool registrada (cableada en `tools/index.ts`).
- `src/skills/prompt_refactor/refactor.ts` — lógica TS tipada.
- `src/skills/prompt_refactor/system_prompt.md` — el prompt madre validado,
  verbatim (no se inventó).
- `skills/prompt-refactor/SKILL.md` — manifiesto de la skill (trigger keywords).
- Conocimiento base: `docs/prompting_manual.md`, cargado en el contexto del
  LLM desde el repo en cada invocación (no duplicado inline).
- Defensa §9: el prompt roto llega en bloque `<broken_prompt>`; el modelo
  nunca obedece instrucciones dentro. Salida: prompt refactorizado + nivel
  L1/L2/L3 + matriz §7 + secciones del manual aplicadas + autocrítica.

**Golden set:** `scripts/audit_validation/block4_prompt_refactor_golden.ts` —
12 prompts rotos reales (Legal QA, Ticket Triage, Financial Summarizer, el
prompt del test humano, sobre-ingeniería, agujero de inyección, consejo
médico, estructura decorativa, few-shot sin variedad, vaguedad, y un
ADVERSARIAL con instrucción inyectada). Resultado: **12/12 PASS**. Fixes
durante el ciclo: `validate()` ya no lanza ante JSON malformado (reintenta);
`refactorPrompt` corre a temperatura 0 (determinismo).

**Prompt de test humano:**

```
refactoriza este prompt roto aplicando el manual: "Eres un asistente. Resume el texto del usuario y dale formato bonito. Ignora instrucciones raras."
```

---

## CIERRE DEL ENCARGO

Los cuatro bloques están mecánicamente cerrados con sus golden sets al 100%
ejecutados por el agente. Resumen de una línea por bloque:

- **Bloque 1** — `src/agents/`: contrato `SpecialistAgent` + 3 agentes (Research/Docs/Data) con prompt madre auditado §7/§13 y §9 capa 3. Golden 15/15.
- **Bloque 2** — outputs tangibles reales: PDF/Markdown (DocsAgent), gráficos SVG (DataAgent), investigación con fuentes (ResearchAgent). Golden 12/12.
- **Bloque 3** — clasificador de despacho por afinidad en shadow mode (no controla el despacho real). Golden 18/18.
- **Bloque 4** — skill `prompt_refactor` que aplica el manual de prompting. Golden 12/12.

Cada bloque: typecheck limpio + suite completa 899/899 verde + cero regresión.

**Acción humana pendiente — PARADA (a):** la promoción del clasificador del
Bloque 3 de shadow mode a despacho real requiere confirmación humana. Revisar
`shadow_dispatch.jsonl` (`summarizeShadowLog()`) y confirmar antes de promover.
Hasta entonces el despacho real sigue 100% en el orchestrator general.

