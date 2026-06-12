// src/agents/swarm_plan.ts
//
// PLANIFICADOR DE ENJAMBRE POR DAG — el cerebro de orquestación.
//
// Por qué existe: el comparativo honesto (DECISIONES 2026-06-10) encontró que el
// swarm de Shinobi (swarm.ts/team.ts) es SUPERIOR en aislamiento (worktree por
// agente), verificación (E1) y firma (E7), pero INFERIOR en inteligencia de
// orquestación al IDE de enjambre del operador: a Shinobi le faltaba descomponer
// un objetivo en un DAG de subtareas con rol y schedularlas en lotes paralelos
// respetando dependencias. Este módulo PORTA esa pieza (fielmente: mismo Kahn,
// misma tolerancia de parseo, mismo guard de ciclo) y la pone ENCIMA del
// aislamiento superior de Shinobi. Lo mejor de los dos: el plan de swarm-ide
// ejecutado por el `team.ts` aislado-por-worktree y verificado de Shinobi, con el
// COMITÉ de Shinobi (committee_review) como revisor — mejor que el revisor único
// del original.
//
// Este fichero es NÚCLEO PURO (sin imports pesados, sin red): parsear, schedular y
// detectar ciclos son funciones deterministas y unit-testables, igual que
// best_of_n_select.ts. El cableado al runtime (LLM planner + ejecución por lotes
// con team.ts) vive en el orquestador; aquí está la lógica que no puede mentir.
//
// Crédito: lógica pura portada de swarm-ide (backend/app/orchestrator.py,
// parse_plan/schedule/review_rejected), del propio operador. Adaptada a los
// nombres de tool reales de Shinobi y a su comité.

export type SwarmRole = 'architect' | 'coder' | 'reviewer' | 'tester';
export const SWARM_ROLES: readonly SwarmRole[] = ['architect', 'coder', 'reviewer', 'tester'] as const;

export interface PlannedSubTask {
  id: string;
  goal: string;
  role: SwarmRole;
  dependsOn: string[];
}

/** Cajas de tool por rol, con los nombres REALES del registro de Shinobi.
 *  Nota de seguridad (heredada de team.ts): en ejecución aislada-por-worktree solo
 *  write_file/edit_file están confinadas; run_command (tester) exige sandbox real
 *  y queda como deuda combinable — igual que documenta team.ts. */
export const ROLE_TOOLS: Record<SwarmRole, string[]> = {
  architect: ['read_file', 'list_dir', 'search_files', 'tool_search', 'web_search', 'research_agent_run'],
  coder: ['read_file', 'list_dir', 'search_files', 'write_file', 'edit_file', 'lint_file'],
  reviewer: ['read_file', 'list_dir', 'search_files', 'lint_file', 'committee_review'],
  tester: ['read_file', 'list_dir', 'run_command', 'lint_file'],
};

export const ROLE_PROMPT: Record<SwarmRole, string> = {
  architect: 'Eres el Arquitecto. Analiza y define el enfoque y los ficheros a tocar. NO escribas código; produce un plan técnico claro.',
  coder: 'Eres el Coder. Implementa el subobjetivo con write_file/edit_file. Código de producción, sin demos.',
  reviewer: 'Eres el Revisor. Evalúa seguridad, arquitectura, rendimiento y corrección. Primera línea: "✅ APROBADO: …" o "❌ RECHAZADO: …".',
  tester: 'Eres el Tester. Ejecuta los tests y reporta si pasan. Si fallan, resume el error con precisión.',
};

/** Tope para que un plan malformado o envenenado no genere cientos de agentes. */
export const MAX_SUBTASKS = 12;

/**
 * Parsea el JSON de un planificador. Tolerante: ignora vallas markdown, encuentra
 * el array, descarta entradas inválidas, deduplica ids, normaliza rol a 'coder' y
 * recorta a MAX_SUBTASKS. Nunca lanza: plan ilegible → [].
 */
export function parsePlan(raw: string): PlannedSubTask[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let data: unknown;
  try { data = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(data)) return [];

  const out: PlannedSubTask[] = [];
  const seen = new Set<string>();
  data.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) return;
    const it = item as Record<string, unknown>;
    let sid = String(it.id ?? `t${i + 1}`);
    if (seen.has(sid)) sid = `${sid}_${i}`;
    seen.add(sid);
    let role = String(it.role ?? 'coder') as SwarmRole;
    if (!SWARM_ROLES.includes(role)) role = 'coder';
    const deps = Array.isArray(it.depends_on)
      ? it.depends_on.filter((d) => typeof d === 'string' || typeof d === 'number').map(String)
      : [];
    const goal = String(it.goal ?? it.task ?? '').trim();
    if (goal) out.push({ id: sid, goal, role, dependsOn: deps });
  });
  return out.slice(0, MAX_SUBTASKS);
}

/**
 * Ordena las subtareas en LOTES PARALELOS por orden topológico (Kahn). Cada lote
 * es un conjunto de subtareas sin dependencias pendientes → se lanzan a la vez
 * (en Shinobi, vía team.ts: cada una en su worktree aislado). Lanza si una
 * dependencia es desconocida o si hay un ciclo.
 */
export function schedule(subtasks: PlannedSubTask[]): PlannedSubTask[][] {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const indeg = new Map(subtasks.map((s) => [s.id, 0]));
  const adj = new Map<string, string[]>(subtasks.map((s) => [s.id, []]));

  for (const s of subtasks) {
    for (const d of s.dependsOn) {
      if (!byId.has(d)) throw new Error(`Dependencia desconocida: ${d} (en ${s.id})`);
      indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1);
      adj.get(d)!.push(s.id);
    }
  }

  let ready = [...indeg.entries()].filter(([, deg]) => deg === 0).map(([id]) => id).sort();
  const batches: PlannedSubTask[][] = [];
  let done = 0;
  while (ready.length) {
    batches.push(ready.map((id) => byId.get(id)!));
    done += ready.length;
    const next: string[] = [];
    for (const id of ready) {
      for (const m of adj.get(id)!) {
        indeg.set(m, (indeg.get(m) ?? 0) - 1);
        if (indeg.get(m) === 0) next.push(m);
      }
    }
    ready = next.sort();
  }
  if (done !== subtasks.length) throw new Error('El plan contiene un ciclo de dependencias');
  return batches;
}

/** True si el veredicto del revisor (o del comité) BLOQUEA el cambio. Puro. */
export function reviewRejected(reviewOutput: string): boolean {
  return reviewOutput.trimStart().startsWith('❌') || reviewOutput.toUpperCase().includes('RECHAZADO');
}

/** True si la corrida tocó su techo de coste (0 = ilimitado). */
export function budgetExceeded(spentUsd: number, ceilingUsd: number): boolean {
  return ceilingUsd > 0 && spentUsd >= ceilingUsd;
}

/** Render legible del plan (para el rastro / la UI del enjambre). */
export function renderPlan(subtasks: PlannedSubTask[]): string {
  const lines = ['📋 Plan del enjambre:'];
  for (const s of subtasks) {
    const dep = s.dependsOn.length ? `  ⟵ ${s.dependsOn.join(', ')}` : '';
    lines.push(`  • [${s.role}] ${s.id}: ${s.goal}${dep}`);
  }
  return lines.join('\n');
}

/** Prompt del planificador LLM (el runtime lo usa; aquí por cohesión y test). */
export const PLANNER_PROMPT = `Descompón la tarea en subtareas para un equipo de agentes (architect, coder, reviewer, tester).
Responde SOLO con un array JSON de objetos: {"id","goal","role","depends_on":[ids]}.
Mantén 1–6 subtareas. El reviewer depende del coder; el tester depende del coder.

TAREA:
{task}`;
