/**
 * Context Compactor — reduce el tamaño del array de messages antes de
 * enviarlo al LLM cuando excede un umbral de tokens.
 *
 * Diferencia clave vs Hermes (auto-summary LLM) y OpenClaw (compact runner):
 * este compactor es 100% heurístico, sin round-trip extra al LLM, sin
 * dependencias nuevas. Si una iteración tarde requiere summarization
 * semántica, se puede añadir como modo 'semantic' sin romper este.
 *
 * Invariantes (NO se rompen nunca):
 *   1. Todos los mensajes role:'system' se preservan intactos.
 *   2. El último mensaje (input actual del usuario) se preserva intacto.
 *   3. Los últimos `preserveLastTurns` turnos se preservan intactos.
 *   4. Cada assistant.tool_calls mantiene su pairing con los role:'tool'
 *      que lleven los mismos tool_call_id (no se separa un par; se trunca
 *      el content del tool pero el id y name permanecen).
 *   5. Idempotente: mensajes ya marcados con COMPACTION_MARKER no se
 *      recompactan.
 */

export interface CompactionConfig {
  /** Token budget total para el contexto (default 32k — conservador). */
  budgetTokens?: number;
  /** Disparar cuando estimado > budget * threshold (default 0.75). */
  thresholdRatio?: number;
  /** Cuántos turnos finales preservar intactos (default 3). */
  preserveLastTurns?: number;
  /** Caracteres de content tool sobre los que truncar (default 800). */
  toolOutputCap?: number;
  /** Caracteres a los que se reduce un content truncado (default 400). */
  toolOutputKeep?: number;
  /** Cap para texto de assistant sin tool_calls (default 1200). */
  assistantTextCap?: number;
  /** Hasta cuánto se reduce el texto assistant (default 600). */
  assistantTextKeep?: number;
  /**
   * Fracción del budgetTokens por debajo de la cual el compactor NUNCA bajará
   * (default 0.40 = 40 %). Evita vaciar el contexto en cargas muy grandes.
   * El suelo efectivo es max(budgetTokens * floorRatio, absoluteFloorTokens),
   * pero nunca supera el 50 % del budget para que el parámetro sea coherente
   * con presupuestos pequeños usados en tests.
   */
  floorRatio?: number;
  /**
   * Mínimo absoluto de tokens que el compactor preservará, independientemente
   * del budget (default 8 000). Se aplica como max junto con floorRatio.
   */
  absoluteFloorTokens?: number;
}

export interface CompactionResult {
  messages: any[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  truncatedCount: number;
  droppedCount: number;
  /**
   * true cuando el compactor llegó al suelo mínimo sin poder reducir el
   * contexto hasta el límite del proveedor. Señal para que el orchestrator
   * avise al usuario de dividir el trabajo en lugar de continuar con un
   * contexto potencialmente inservible.
   */
  irreducible?: boolean;
}

/** Marker para detectar mensajes ya compactados (idempotencia). */
export const COMPACTION_MARKER = '[…compactado';

const DEFAULTS: Required<CompactionConfig> = {
  budgetTokens: 32_000,
  thresholdRatio: 0.75,
  preserveLastTurns: 3,
  toolOutputCap: 800,
  toolOutputKeep: 400,
  assistantTextCap: 1200,
  assistantTextKeep: 600,
  floorRatio: 0.40,
  absoluteFloorTokens: 8_000,
};

/**
 * Estimación heurística de tokens. chars/4 es la regla estándar para
 * texto ASCII/UTF-8; sobrestima ligeramente vs tiktoken, lo cual es lo
 * que queremos (más conservador = más temprano a compactar).
 */
export function estimateTokens(content: any): number {
  if (content == null) return 0;
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  // tool_calls / arrays / objects: stringify y mide.
  try {
    return Math.ceil(JSON.stringify(content).length / 4);
  } catch {
    return 0;
  }
}

function messageTokens(msg: any): number {
  let total = 4; // overhead fijo por mensaje (role + framing)
  if (msg?.content != null) total += estimateTokens(msg.content);
  if (msg?.tool_calls) total += estimateTokens(msg.tool_calls);
  if (msg?.name) total += estimateTokens(msg.name);
  return total;
}

export function totalTokens(messages: any[]): number {
  let sum = 0;
  for (const m of messages) sum += messageTokens(m);
  return sum;
}

/**
 * Trunca una cadena dejando los primeros `keep` chars + marker indicando
 * cuántos se compactaron. Idempotente: si ya lleva marker, no toca.
 */
function truncateString(s: string, keep: number): string {
  if (!s || typeof s !== 'string') return s;
  if (s.includes(COMPACTION_MARKER)) return s;
  if (s.length <= keep) return s;
  const removed = s.length - keep;
  return `${s.slice(0, keep)} ${COMPACTION_MARKER} ${removed} chars]`;
}

/**
 * Segmenta el historial en "turnos". Un turno empieza en un mensaje user
 * o system y termina justo antes del siguiente user/system. Cada turno
 * agrupa user + assistant(s) + tool(s) en orden.
 *
 * Los mensajes system se aíslan como turnos propios (de 1 elemento) para
 * que la lógica de preserveLastTurns no los cuente como turnos de diálogo.
 */
interface Turn {
  start: number;
  end: number; // exclusivo
  kind: 'system' | 'dialog';
}

function segmentTurns(messages: any[]): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'system') {
      turns.push({ start: i, end: i + 1, kind: 'system' });
      i++;
      continue;
    }
    // un turno de diálogo: empieza en user (o assistant sin user previo) y
    // se extiende mientras los siguientes sean assistant/tool.
    const start = i;
    i++;
    while (i < messages.length) {
      const next = messages[i];
      if (next.role === 'system' || next.role === 'user') break;
      i++;
    }
    turns.push({ start, end: i, kind: 'dialog' });
  }
  return turns;
}

/**
 * Aplica truncado a los mensajes de una zona compactable (excluye los
 * últimos preserveLastTurns + system msgs + último mensaje).
 * Devuelve cuántos mensajes se truncaron.
 */
function truncateInZone(
  messages: any[],
  zoneIdxs: Set<number>,
  cfg: Required<CompactionConfig>,
): number {
  let truncated = 0;
  for (const idx of zoneIdxs) {
    const m = messages[idx];
    if (!m) continue;
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > cfg.toolOutputCap) {
      const next = truncateString(m.content, cfg.toolOutputKeep);
      if (next !== m.content) {
        messages[idx] = { ...m, content: next };
        truncated++;
      }
    } else if (
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.length > cfg.assistantTextCap &&
      // si lleva tool_calls, no tocamos el texto (suele ser plan corto)
      !(Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
    ) {
      const next = truncateString(m.content, cfg.assistantTextKeep);
      if (next !== m.content) {
        messages[idx] = { ...m, content: next };
        truncated++;
      }
    }
  }
  return truncated;
}

/**
 * Modo agresivo: colapsa turnos de diálogo enteros (en la zona
 * compactable) en un único mensaje system con un resumen ultracorto.
 * Se aplica solo si tras el truncado el contexto sigue por encima del
 * threshold.
 *
 * @param sacredIdxs Índices que NUNCA deben colapsar aunque estén dentro de
 *   un turno compactable. Úsalo para proteger el primer mensaje 'user'
 *   (tarea original) aunque su turno quede en la zona de colapso.
 */
function collapseOldTurns(
  messages: any[],
  dialogTurnsToCollapse: Turn[],
  sacredIdxs: Set<number> = new Set(),
): { newMessages: any[]; dropped: number } {
  if (dialogTurnsToCollapse.length === 0) return { newMessages: messages, dropped: 0 };

  // Construimos un resumen heurístico: cuenta de user msgs, lista de tools usadas.
  let userCount = 0;
  const toolNames = new Set<string>();
  const collapseIdxs = new Set<number>();
  for (const t of dialogTurnsToCollapse) {
    for (let i = t.start; i < t.end; i++) {
      // Índices sagrados (p.ej. primer mensaje user) quedan fuera del colapso.
      if (!sacredIdxs.has(i)) collapseIdxs.add(i);
      const m = messages[i];
      if (m.role === 'user') userCount++;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc?.function?.name) toolNames.add(tc.function.name);
        }
      }
      if (m.role === 'tool' && m.name) toolNames.add(m.name);
    }
  }

  const summary =
    `[Resumen automático del compactor: ${dialogTurnsToCollapse.length} turno(s) antiguo(s) ` +
    `omitido(s) para ahorrar contexto. ${userCount} mensaje(s) de usuario, ` +
    `tools usadas: ${toolNames.size > 0 ? [...toolNames].join(', ') : 'ninguna'}. ` +
    `${COMPACTION_MARKER} turnos colapsados]`;

  // Insertamos el resumen en la posición del primer turno colapsado y
  // saltamos todos los índices colapsados al reconstruir.
  const firstIdx = Math.min(...collapseIdxs);
  const newMessages: any[] = [];
  let inserted = false;
  for (let i = 0; i < messages.length; i++) {
    if (collapseIdxs.has(i)) {
      if (!inserted && i === firstIdx) {
        newMessages.push({ role: 'system', content: summary });
        inserted = true;
      }
      continue;
    }
    newMessages.push(messages[i]);
  }
  return { newMessages, dropped: collapseIdxs.size };
}

/**
 * Prunes assistant tool call arguments to keep structural keys intact
 * while truncating large values (> 120 chars) to prevent context lobotomy.
 */
export function pruneToolArguments(args: any): string {
  if (args == null) return '{}';

  let obj: any;
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args);
    } catch {
      // Fallback: character limit if raw string cannot be parsed as JSON
      if (args.length > 120 && !args.includes('[Truncated')) {
        return `${args.slice(0, 80)}... [Truncated ${args.length - 80} chars for context optimization]`;
      }
      return args;
    }
  } else if (typeof args === 'object') {
    obj = args;
  } else {
    return String(args);
  }

  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  const pruned: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      if (val.length > 120 && !val.includes('[Truncated')) {
        pruned[key] = `${val.slice(0, 80)}... [Truncated ${val.length - 80} chars for context optimization]`;
      } else {
        pruned[key] = val;
      }
    } else if (typeof val === 'object' && val !== null) {
      const str = JSON.stringify(val);
      if (str.length > 120 && !str.includes('[Truncated')) {
        pruned[key] = `[Truncated Object: ${str.length} chars]`;
      } else {
        pruned[key] = val;
      }
    } else {
      pruned[key] = val;
    }
  }

  return JSON.stringify(pruned);
}

/**
 * Punto de entrada principal. Devuelve un nuevo array de messages (no
 * muta el input) junto con métricas.
 */
export function compactMessages(
  messages: any[],
  cfg: CompactionConfig = {},
): CompactionResult {
  const c: Required<CompactionConfig> = { ...DEFAULTS, ...cfg };
  const before = totalTokens(messages);
  const limit = c.budgetTokens * c.thresholdRatio;

  // Suelo: el compactor nunca reducirá por debajo de este valor.
  // Se calcula como max(budgetTokens * floorRatio, absoluteFloorTokens) pero
  // sin superar el 50 % del budget, para que sea coherente con presupuestos
  // pequeños de tests (ej. budgetTokens=2000 → floor=1000, no 8000).
  const floorTokens = Math.min(
    Math.max(c.budgetTokens * c.floorRatio, c.absoluteFloorTokens),
    c.budgetTokens * 0.50,
  );

  if (before <= limit || messages.length === 0) {
    return {
      messages,
      compacted: false,
      beforeTokens: before,
      afterTokens: before,
      truncatedCount: 0,
      droppedCount: 0,
    };
  }

  // Índice del primer mensaje 'user' en todo el array — es la tarea original
  // del usuario y nunca debe perderse, ni en colapso agresivo de turnos.
  const firstUserIdx = messages.findIndex(m => m.role === 'user');

  // 1) Segmenta en turnos.
  const turns = segmentTurns(messages);
  const dialogTurns = turns.filter(t => t.kind === 'dialog');

  const compactableIdxs = new Set<number>();
  let compactableDialog: Turn[] = [];

  if (dialogTurns.length === 1) {
    const turn = dialogTurns[0];
    const toolIdxs: number[] = [];
    const assistantIdxs: number[] = [];
    for (let i = turn.start; i < turn.end; i++) {
      const m = messages[i];
      if (m.role === 'tool') {
        toolIdxs.push(i);
      } else if (m.role === 'assistant') {
        assistantIdxs.push(i);
      }
    }

    const n = c.preserveLastTurns;
    const preservedToolIdxs = new Set(toolIdxs.slice(-n));
    const preservedAssistantIdxs = new Set(assistantIdxs.slice(-n));

    for (const tIdx of preservedToolIdxs) {
      const toolMsg = messages[tIdx];
      if (toolMsg && toolMsg.tool_call_id) {
        for (const aIdx of assistantIdxs) {
          const astMsg = messages[aIdx];
          if (astMsg && Array.isArray(astMsg.tool_calls)) {
            if (astMsg.tool_calls.some((tc: any) => tc.id === toolMsg.tool_call_id)) {
              preservedAssistantIdxs.add(aIdx);
            }
          }
        }
      }
    }

    for (let i = turn.start; i < turn.end; i++) {
      const m = messages[i];
      if (m.role === 'system' || m.role === 'user') continue;
      if (i === messages.length - 1) continue; // Último mensaje siempre protegido

      if (m.role === 'tool') {
        if (!preservedToolIdxs.has(i)) {
          compactableIdxs.add(i);
        }
      } else if (m.role === 'assistant') {
        if (!preservedAssistantIdxs.has(i)) {
          compactableIdxs.add(i);
        }
      }
    }
  } else {
    // 2) Zona protegida = system turns + últimos N dialog turns + último msg.
    const protectedDialog = dialogTurns.slice(-c.preserveLastTurns);
    compactableDialog = dialogTurns.slice(0, dialogTurns.length - c.preserveLastTurns);

    const protectedIdxs = new Set<number>();
    for (const t of turns.filter(x => x.kind === 'system')) {
      for (let i = t.start; i < t.end; i++) protectedIdxs.add(i);
    }
    for (const t of protectedDialog) {
      for (let i = t.start; i < t.end; i++) protectedIdxs.add(i);
    }
    // El último mensaje del array siempre protegido (input actual del user).
    if (messages.length > 0) protectedIdxs.add(messages.length - 1);

    for (const t of compactableDialog) {
      for (let i = t.start; i < t.end; i++) {
        if (!protectedIdxs.has(i)) compactableIdxs.add(i);
      }
    }
  }

  // 3) Truncado de contents largos en zona compactable.
  let working = messages.slice();
  const truncated = truncateInZone(working, compactableIdxs, c);
  let dropped = 0;

  // Comprobación de suelo post-truncado. Si el truncado solo ya llevó el
  // contexto por debajo del mínimo viable, detener aquí y señalizar
  // irreducible en lugar de continuar con colapso destructivo.
  // Nota de diseño: se prefiere devolver el array truncado (aún con
  // estructura de mensajes intacta) sobre devolver el original sin comprimir,
  // porque el truncado reduce sin eliminar mensajes, lo que sigue siendo
  // más útil para el LLM que un contexto que revienta el límite del proveedor.
  const afterTruncate = totalTokens(working);
  if (afterTruncate < floorTokens) {
    return {
      messages: working,
      compacted: true,
      beforeTokens: before,
      afterTokens: afterTruncate,
      truncatedCount: truncated,
      droppedCount: 0,
      irreducible: true,
    };
  }

  // 4) Si tras truncar aún excede, colapsar turnos antiguos o colapsar
  //    herramientas en un solo turno largo.
  if (totalTokens(working) > limit) {
    if (dialogTurns.length > 1 && compactableDialog.length > 0) {
      // El primer mensaje 'user' es sagrado: pasa como índice protegido para
      // que collapseOldTurns no lo elimine aunque su turno sea compactable.
      const sacredIdxs: Set<number> = firstUserIdx >= 0
        ? new Set([firstUserIdx])
        : new Set();
      const collapsed = collapseOldTurns(working, compactableDialog, sacredIdxs);
      working = collapsed.newMessages;
      dropped = collapsed.dropped;
    } else if (dialogTurns.length === 1) {
      let collapsedCount = 0;
      for (const idx of compactableIdxs) {
        const m = working[idx];
        if (m) {
          if (m.role === 'tool' && typeof m.content === 'string') {
            const collapsedContent = `[Tool output collapsed] ${COMPACTION_MARKER} collapsed]`;
            if (m.content !== collapsedContent) {
              working[idx] = { ...m, content: collapsedContent };
              collapsedCount++;
            }
          } else if (m.role === 'assistant') {
            let changed = false;
            const updated: any = { ...m };
            if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
              updated.tool_calls = m.tool_calls.map((tc: any) => {
                if (tc?.function && tc.function.arguments) {
                  const pruned = pruneToolArguments(tc.function.arguments);
                  if (pruned !== tc.function.arguments) {
                    changed = true;
                    return {
                      ...tc,
                      function: {
                        ...tc.function,
                        arguments: pruned
                      }
                    };
                  }
                }
                return tc;
              });
            }
            if (typeof m.content === 'string' && m.content.length > 100 && !m.content.includes(COMPACTION_MARKER)) {
              updated.content = `${m.content.slice(0, 50)} ${COMPACTION_MARKER} assistant collapsed]`;
              changed = true;
            }
            if (changed) {
              working[idx] = updated;
              collapsedCount++;
            }
          }
        }
      }
      dropped += collapsedCount;
    }
  }

  const after = totalTokens(working);
  return {
    messages: working,
    compacted: true,
    beforeTokens: before,
    afterTokens: after,
    truncatedCount: truncated,
    droppedCount: dropped,
    // Si el resultado quedó bajo el suelo (p.ej. el colapso lo llevó demasiado
    // abajo), señalizamos irreducible para que el orchestrator pueda avisar al
    // usuario de dividir el trabajo.
    irreducible: after < floorTokens,
  };
}
