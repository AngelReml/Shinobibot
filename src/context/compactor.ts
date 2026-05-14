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
}

export interface CompactionResult {
  messages: any[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  truncatedCount: number;
  droppedCount: number;
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
 */
function collapseOldTurns(
  messages: any[],
  dialogTurnsToCollapse: Turn[],
): { newMessages: any[]; dropped: number } {
  if (dialogTurnsToCollapse.length === 0) return { newMessages: messages, dropped: 0 };

  // Construimos un resumen heurístico: cuenta de user msgs, lista de tools usadas.
  let userCount = 0;
  const toolNames = new Set<string>();
  const collapseIdxs = new Set<number>();
  for (const t of dialogTurnsToCollapse) {
    for (let i = t.start; i < t.end; i++) {
      collapseIdxs.add(i);
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

  // 1) Segmenta en turnos.
  const turns = segmentTurns(messages);
  const dialogTurns = turns.filter(t => t.kind === 'dialog');

  // 2) Zona protegida = system turns + últimos N dialog turns + último msg.
  const protectedDialog = dialogTurns.slice(-c.preserveLastTurns);
  const compactableDialog = dialogTurns.slice(0, dialogTurns.length - c.preserveLastTurns);

  const protectedIdxs = new Set<number>();
  for (const t of turns.filter(x => x.kind === 'system')) {
    for (let i = t.start; i < t.end; i++) protectedIdxs.add(i);
  }
  for (const t of protectedDialog) {
    for (let i = t.start; i < t.end; i++) protectedIdxs.add(i);
  }
  // El último mensaje del array siempre protegido (input actual del user).
  if (messages.length > 0) protectedIdxs.add(messages.length - 1);

  const compactableIdxs = new Set<number>();
  for (const t of compactableDialog) {
    for (let i = t.start; i < t.end; i++) {
      if (!protectedIdxs.has(i)) compactableIdxs.add(i);
    }
  }

  // 3) Truncado de contents largos en zona compactable.
  let working = messages.slice();
  const truncated = truncateInZone(working, compactableIdxs, c);
  let dropped = 0;

  // 4) Si tras truncar aún excede, colapsar turnos antiguos.
  if (totalTokens(working) > limit && compactableDialog.length > 0) {
    const collapsed = collapseOldTurns(working, compactableDialog);
    working = collapsed.newMessages;
    dropped = collapsed.dropped;
  }

  const after = totalTokens(working);
  return {
    messages: working,
    compacted: true,
    beforeTokens: before,
    afterTokens: after,
    truncatedCount: truncated,
    droppedCount: dropped,
  };
}
