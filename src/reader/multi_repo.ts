// src/reader/multi_repo.ts
//
// MOTOR E6 — COMPRENSIÓN MULTI-REPO COMPARATIVA.
//
// El problema: leer 4-5 repos GRANDES a la vez y mantener el contexto al
// compararlos, cuando ninguno cabe entero en la ventana. La respuesta NO es una
// ventana más grande (siempre se queda corta); es una arquitectura
// map-distill-reduce con INVARIANTES PINNEADAS:
//
//   1. MAP/DISTILL — cada repo se reduce, con el HierarchicalReader que ya
//      existe, a una RepoCard: un destilado ESTRUCTURADO y ACOTADO (propósito,
//      arquitectura, módulos clave, entry points, riesgos). No guardamos el
//      código en contexto; guardamos su destilado (~1-2 KB por repo).
//
//   2. LEDGER — el entendimiento COMPARATIVO se acumula en un ComparisonLedger
//      durable (eje → repo → hallazgo). Es el artefacto que deja al agente
//      recorrer 5 repos enormes sin perder el hilo: la comparación vive aquí,
//      no en el contexto volátil. Sobrevive a la compactación (va pinneado).
//
//   3. ASSEMBLE — un ensamblador CONSCIENTE DEL PRESUPUESTO arma el frame de
//      comparación: SIEMPRE pinnea las cabeceras de cada card + la matriz del
//      ledger (el estado de comparación nunca se cae), y expande los cuerpos de
//      las cards hasta agotar el budget; el resto queda en una línea. El código
//      concreto se trae BAJO DEMANDA (drill-down por retrieval) y se descarta.
//
// Resultado: contexto de trabajo ACOTADO (N cards pequeñas + ledger) aunque los
// repos sumen millones de líneas, y un entendimiento que CRECE en un artefacto
// durable. Y la salida — la matriz comparativa — es legible por un humano NO
// técnico: no ve código, ve una tabla clara. (Pilar de accesibilidad.)
//
// Las piezas de §1-3 marcadas PURO no tienen imports en runtime: son
// deterministas y testeables aisladas (y portadas a un proof en Node).

import type { RepoReport } from './schemas.js';

// ───────────────────────────────────────────────────────────────────────────
// Tipos
// ───────────────────────────────────────────────────────────────────────────

export interface RepoCard {
  /** Id corto y estable para la comparación (p. ej. 'A', 'B' o slug). */
  id: string;
  name: string;
  path: string;
  purpose: string;
  architecture: string;
  modules: { name: string; role: string }[];
  entryPoints: string[];
  topRisks: string[];
  metrics: { modules: number; tokensRead: number };
}

export interface DistillOptions {
  maxModules?: number;   // top-K módulos a conservar (default 8)
  purposeCap?: number;   // chars (default 200)
  archCap?: number;      // chars (default 600)
  maxRisks?: number;     // default 3
}

const DEFAULTS: Required<DistillOptions> = { maxModules: 8, purposeCap: 200, archCap: 600, maxRisks: 3 };

// ───────────────────────────────────────────────────────────────────────────
// §1 · DISTILL (PURO) — RepoReport → RepoCard acotada
// ───────────────────────────────────────────────────────────────────────────

function cap(s: string, n: number): string {
  const t = (s ?? '').trim();
  if (t.length <= n) return t;
  // Trunca en límite de palabra cuando es posible; marca el recorte.
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/**
 * Destila un RepoReport (salida del HierarchicalReader) en una RepoCard de
 * tamaño acotado. Determinista: conserva el orden de entrada y trunca por tope.
 */
export function distillCard(report: RepoReport, meta: { id: string; name: string; path: string }, opts: DistillOptions = {}): RepoCard {
  const o = { ...DEFAULTS, ...opts };
  const modules = (report.modules ?? []).slice(0, o.maxModules).map((m) => ({
    name: m.name,
    role: cap(m.responsibility, 100),
  }));
  const risks = (report.risks ?? [])
    .slice()
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
    .slice(0, o.maxRisks)
    .map((r) => `[${r.severity}] ${cap(r.description, 120)}`);
  return {
    id: meta.id,
    name: meta.name,
    path: meta.path,
    purpose: cap(report.repo_purpose, o.purposeCap),
    architecture: cap(report.architecture_summary, o.archCap),
    modules,
    entryPoints: (report.entry_points ?? []).map((e) => `${e.file} (${e.kind})`).slice(0, 6),
    topRisks: risks,
    metrics: { modules: (report.modules ?? []).length, tokensRead: report.evidence?.tokens_total ?? 0 },
  };
}

function sevRank(s: string): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

/** Tamaño aproximado en chars de una card expandida (para el presupuesto). */
export function cardSizeChars(c: RepoCard): number {
  return cardBody(c).length;
}

// ───────────────────────────────────────────────────────────────────────────
// §2 · LEDGER (PURO) — entendimiento comparativo durable
// ───────────────────────────────────────────────────────────────────────────

/**
 * Acumula hallazgos comparativos por EJE (auth, estado, tests, errores…) y por
 * repo. Es la memoria de trabajo de la comparación: pinneada, nunca se compacta,
 * serializable a/desde JSON para persistir entre sesiones.
 */
export class ComparisonLedger {
  // eje -> (repoId -> hallazgo)
  private axes = new Map<string, Map<string, string>>();

  record(axis: string, repoId: string, finding: string): void {
    const a = axis.trim();
    if (!a) return;
    let row = this.axes.get(a);
    if (!row) { row = new Map(); this.axes.set(a, row); }
    row.set(repoId, finding.trim());
  }

  axesList(): string[] {
    return [...this.axes.keys()];
  }

  findingsFor(axis: string): Map<string, string> {
    return this.axes.get(axis) ?? new Map();
  }

  size(): number {
    let n = 0;
    for (const row of this.axes.values()) n += row.size;
    return n;
  }

  /**
   * Renderiza la MATRIZ comparativa en Markdown (filas=ejes, columnas=repos).
   * Esta es la salida legible por humanos: una tabla, no código.
   */
  toMatrixMarkdown(repos: { id: string; name?: string }[]): string {
    const axes = this.axesList();
    if (axes.length === 0 || repos.length === 0) return '_(sin hallazgos comparativos todavía)_';
    const head = ['Eje', ...repos.map((r) => r.name ? `${r.name} (${r.id})` : r.id)];
    const sep = head.map(() => '---');
    const rows = axes.map((axis) => {
      const row = this.findingsFor(axis);
      return [axis, ...repos.map((r) => (row.get(r.id) ?? '—').replace(/\|/g, '\\|'))];
    });
    return [head, sep, ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
  }

  toJSON(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [axis, row] of this.axes) out[axis] = Object.fromEntries(row);
    return out;
  }

  static fromJSON(obj: Record<string, Record<string, string>> | undefined | null): ComparisonLedger {
    const l = new ComparisonLedger();
    if (obj) for (const [axis, row] of Object.entries(obj)) for (const [repo, f] of Object.entries(row)) l.record(axis, repo, f);
    return l;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §3 · ASSEMBLE (PURO) — frame de comparación consciente del presupuesto
// ───────────────────────────────────────────────────────────────────────────

export interface ComparisonFrame {
  /** Texto listo para inyectar como contexto del agente. */
  context: string;
  /** Repos cuyo cuerpo completo entró en el budget. */
  expanded: string[];
  /** Repos resumidos a una línea (no cupo el cuerpo; siguen pinneados en cabecera). */
  summarized: string[];
  usedChars: number;
  budgetChars: number;
}

function cardHeader(c: RepoCard): string {
  return `### [${c.id}] ${c.name} — ${c.purpose}`;
}

function cardBody(c: RepoCard): string {
  const mods = c.modules.length
    ? c.modules.map((m) => `  - ${m.name}: ${m.role}`).join('\n')
    : '  - (sin módulos destilados)';
  const eps = c.entryPoints.length ? c.entryPoints.join(', ') : '—';
  const risks = c.topRisks.length ? c.topRisks.map((r) => `  - ${r}`).join('\n') : '  - —';
  return [
    cardHeader(c),
    `Arquitectura: ${c.architecture}`,
    `Entry points: ${eps}`,
    `Módulos clave (${c.metrics.modules} totales):`,
    mods,
    `Riesgos:`,
    risks,
  ].join('\n');
}

/**
 * Ensambla el frame de comparación respetando un presupuesto de chars. INVARIANTE
 * (siempre presente, nunca compactado): la matriz del ledger + una cabecera por
 * repo. Con lo que sobre, expande cuerpos de card en orden hasta agotar budget.
 * Así, aunque haya 5 repos enormes, el contexto de trabajo queda acotado y el
 * estado de comparación NUNCA se cae.
 */
export function assembleComparisonFrame(cards: RepoCard[], ledger: ComparisonLedger, budgetChars: number): ComparisonFrame {
  const repos = cards.map((c) => ({ id: c.id, name: c.name }));
  const matrix = ledger.toMatrixMarkdown(repos);
  const pinnedHeaders = cards.map(cardHeader).join('\n');
  const invariant =
    `## Comparación de ${cards.length} repos\n` +
    `### Matriz comparativa (estado acumulado — pinneado)\n${matrix}\n\n` +
    `### Repos en foco\n${pinnedHeaders}\n`;

  const expanded: string[] = [];
  const summarized: string[] = [];
  let body = '';
  let used = invariant.length;

  // Expande cuerpos en orden mientras quepan; el resto queda solo en cabecera.
  for (const c of cards) {
    const chunk = `\n\n${cardBody(c)}`;
    if (used + chunk.length <= budgetChars) {
      body += chunk;
      used += chunk.length;
      expanded.push(c.id);
    } else {
      summarized.push(c.id);
    }
  }

  const context =
    invariant +
    (expanded.length ? `\n### Detalle expandido (cabe en presupuesto)${body}` : '') +
    (summarized.length ? `\n\n_Resumidos por presupuesto (drill-down bajo demanda): ${summarized.join(', ')}_` : '');

  return { context, expanded, summarized, usedChars: context.length, budgetChars };
}

// ───────────────────────────────────────────────────────────────────────────
// §4 · ORQUESTACIÓN (runtime) — lee N repos, los indexa y arma el frame
// ───────────────────────────────────────────────────────────────────────────
//
// Esta capa conecta el núcleo puro con el HierarchicalReader (lectura jerárquica
// que ya existe) y un índice de retrieval para el drill-down (el MemoryStore
// SQLite+vec). Se mantiene fina a propósito: la inteligencia está en §1-3.

/** Índice mínimo para drill-down bajo demanda (lo implementa MemoryStore). */
export interface RepoIndex {
  /** Indexa un destilado/sección de un repo para recuperarlo luego por query. */
  index(repoId: string, section: string, text: string): Promise<void> | void;
  /** Recupera las secciones más relevantes de un repo para una pregunta. */
  recall(repoId: string, query: string, limit?: number): Promise<string[]> | string[];
}

/** Lector jerárquico ya existente, abstraído a lo que necesitamos. */
export interface RepoDigester {
  digest(repoPath: string): Promise<RepoReport>;
}

export interface ComprehendOptions {
  repos: { id?: string; name?: string; path: string }[];
  digester: RepoDigester;
  index?: RepoIndex;
  budgetChars?: number;
  distill?: DistillOptions;
  ledger?: ComparisonLedger;
  onProgress?: (ev: { phase: 'digest' | 'distill' | 'index' | 'assemble'; repoId?: string }) => void;
}

export interface ComprehendResult {
  cards: RepoCard[];
  frame: ComparisonFrame;
  ledger: ComparisonLedger;
}

function autoId(i: number, name: string): string {
  // 'A','B','C'… para <=26 repos; luego slug del nombre.
  return i < 26 ? String.fromCharCode(65 + i) : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || `r${i}`;
}

/**
 * Comprende N repos en paralelo conceptual: digiere → destila → indexa, y arma
 * el frame de comparación. El ledger empieza vacío (o se reutiliza uno
 * persistido) y se va llenando con drillAndCompare() o por el propio agente.
 */
export async function comprehendRepos(opts: ComprehendOptions): Promise<ComprehendResult> {
  const ledger = opts.ledger ?? new ComparisonLedger();
  const cards: RepoCard[] = [];

  for (let i = 0; i < opts.repos.length; i++) {
    const r = opts.repos[i];
    const id = r.id ?? autoId(i, r.name ?? r.path);
    const name = r.name ?? r.path.split(/[\\/]/).filter(Boolean).pop() ?? id;

    opts.onProgress?.({ phase: 'digest', repoId: id });
    const report = await opts.digester.digest(r.path);

    opts.onProgress?.({ phase: 'distill', repoId: id });
    const card = distillCard(report, { id, name, path: r.path }, opts.distill);
    cards.push(card);

    if (opts.index) {
      opts.onProgress?.({ phase: 'index', repoId: id });
      // Indexa el destilado y cada módulo para drill-down por retrieval.
      await opts.index.index(id, 'purpose', `${card.purpose}\n${card.architecture}`);
      for (const m of card.modules) await opts.index.index(id, `module:${m.name}`, `${m.name}: ${m.role}`);
    }
  }

  opts.onProgress?.({ phase: 'assemble' });
  const frame = assembleComparisonFrame(cards, ledger, opts.budgetChars ?? 8000);
  return { cards, frame, ledger };
}

/**
 * Drill-down comparativo: para un EJE (p. ej. "manejo de errores"), recupera de
 * cada repo las secciones relevantes y deja que el agente registre el hallazgo
 * por repo en el ledger. Aquí solo se hace el retrieval acotado; el juicio lo
 * pone el LLM del agente. Mantener el contexto = recuperar poco y registrar en
 * el ledger, no recargar los repos.
 */
export async function gatherForAxis(
  axis: string,
  cards: RepoCard[],
  index: RepoIndex,
  perRepoLimit = 3,
): Promise<{ repoId: string; snippets: string[] }[]> {
  const out: { repoId: string; snippets: string[] }[] = [];
  for (const c of cards) {
    const snippets = await index.recall(c.id, axis, perRepoLimit);
    out.push({ repoId: c.id, snippets: Array.isArray(snippets) ? snippets : [] });
  }
  return out;
}
