// src/coordinator/session_cost.ts
//
// Contador de gasto de la sesión: tokens REALES que devuelve el proveedor en
// cada llamada y su coste estimado. Lo enseña `/coste`. Los tokens son un dato
// medido; los dólares son una estimación con la tabla de pricing.ts.

export interface UsageLike {
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

export interface CostBucket {
  calls: number;
  /** Entrada total (incluye lo leído y lo escrito en caché). */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  usd: number;
}

const empty = (): CostBucket => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0 });

let _session = new Map<string, CostBucket>();
let _turn = empty();
let _turnLabel = '';

function add(b: CostBucket, u: UsageLike, usd: number): void {
  b.calls += 1;
  b.input += u.prompt_tokens || 0;
  b.cacheRead += u.cache_read_tokens || 0;
  b.cacheWrite += u.cache_write_tokens || 0;
  b.output += u.completion_tokens || 0;
  b.usd += usd || 0;
}

/** Marca el inicio de un turno del usuario: el contador "último turno" empieza de cero. */
export function beginCostTurn(label = ''): void {
  _turn = empty();
  _turnLabel = label.replace(/\s+/g, ' ').slice(0, 60);
}

/** Apunta una llamada al modelo (la invoca el bucle tras cada respuesta con `usage`). */
export function recordLlmUsage(provider: string, model: string, usage: UsageLike, usd: number): void {
  const key = `${provider}:${model}`;
  if (!_session.has(key)) _session.set(key, empty());
  add(_session.get(key)!, usage, usd);
  add(_turn, usage, usd);
}

export function sessionCost(): { byModel: Record<string, CostBucket>; total: CostBucket; turn: CostBucket; turnLabel: string } {
  const total = empty();
  const byModel: Record<string, CostBucket> = {};
  for (const [k, b] of _session) {
    byModel[k] = { ...b };
    total.calls += b.calls; total.input += b.input; total.cacheRead += b.cacheRead;
    total.cacheWrite += b.cacheWrite; total.output += b.output; total.usd += b.usd;
  }
  return { byModel, total, turn: { ..._turn }, turnLabel: _turnLabel };
}

export function resetSessionCost(): void {
  _session = new Map();
  _turn = empty();
  _turnLabel = '';
}

const n = (x: number) => Math.round(x).toLocaleString('es-ES');
const usd = (x: number) => `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`;

function line(b: CostBucket): string {
  const cached = b.cacheRead ? ` (${n(b.cacheRead)} leídos de caché)` : '';
  return `${b.calls} llamadas · entrada ${n(b.input)}${cached} · salida ${n(b.output)} · ~${usd(b.usd)}`;
}

/** Una línea con el gasto del último turno; '' si no hubo llamadas. */
export function describeTurnCost(): string {
  return _turn.calls ? `[coste] este turno: ${line(_turn)}` : '';
}

/** Texto de `/coste`. */
export function describeCost(): string {
  const c = sessionCost();
  if (c.total.calls === 0) return 'Todavía no hay llamadas al modelo en esta sesión.';
  const out: string[] = ['Gasto de esta sesión (tokens medidos; dólares estimados con la tabla de precios):'];
  if (c.turn.calls) out.push(`  Último turno${c.turnLabel ? ` («${c.turnLabel}»)` : ''}: ${line(c.turn)}`);
  for (const [k, b] of Object.entries(c.byModel)) out.push(`  ${k}: ${line(b)}`);
  if (Object.keys(c.byModel).length > 1) out.push(`  TOTAL: ${line(c.total)}`);
  out.push('  /coste reset pone el contador a cero.');
  return out.join('\n');
}
