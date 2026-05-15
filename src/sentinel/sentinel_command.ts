/**
 * Sentinel — handler del slash command `/sentinel`.
 *
 * Subcomandos:
 *   /sentinel watch                  — corre el watcher sobre todas las fuentes + indexa
 *   /sentinel ask <tema>             — búsqueda semántica en items sentinel
 *   /sentinel deep <itemId|rawPath>  — extrae propuesta estructurada
 *   /sentinel list <YYYY-MM-DD>      — lista items archivados desde una fecha
 *   /sentinel forward <proposalId>   — pasa una propuesta al council
 *   /sentinel digest [--week|--month]— boletín
 *
 * Las dependencias pesadas (LLM, memory provider) se inyectan vía
 * `SentinelDeps` para que los tests no toquen red.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { MemoryProvider } from '../memory/providers/types.js';
import type { SentinelProposal } from './types.js';
import { loadSources } from './sources_config.js';
import { SentinelWatcher } from './watcher.js';
import { indexItem } from './indexer.js';
import { ask, deepExtract, listArchived } from './query.js';
import { forwardToCouncil, type CouncilLLM } from './council.js';
import { collectDigest, renderDigest } from './digest.js';
import { SentinelTokenBudget } from './token_budget.js';

export interface SentinelPaths {
  sourcesYaml: string;
  dataDir: string;       // data/sentinel/
  decisionsDir: string;  // docs/sentinel/decisions/
}

export interface SentinelDeps {
  paths?: Partial<SentinelPaths>;
  /** Provider de memoria para indexar/buscar. */
  provider: MemoryProvider;
  /** LLM para extracción de propuestas (deep). Opcional → heurística. */
  proposalLLM?: (prompt: string) => Promise<string>;
  /** LLM para el council (forward). Requerido para /sentinel forward. */
  councilLLM?: CouncilLLM;
  /** Sink de salida (default console.log). */
  out?: (line: string) => void;
}

function defaultPaths(): SentinelPaths {
  const root = process.cwd();
  return {
    sourcesYaml: resolve(root, 'config/sentinel/sources.yaml'),
    dataDir: resolve(root, 'data/sentinel'),
    decisionsDir: resolve(root, 'docs/sentinel/decisions'),
  };
}

function proposalPath(dataDir: string, id: string): string {
  return join(dataDir, 'proposals', id + '.json');
}

function saveProposal(dataDir: string, p: SentinelProposal): void {
  const dir = join(dataDir, 'proposals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(proposalPath(dataDir, p.proposalId), JSON.stringify(p, null, 2), 'utf-8');
}

function loadProposal(dataDir: string, id: string): SentinelProposal | null {
  const p = proposalPath(dataDir, id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

/** Resuelve un itemId a su raw .md path buscando en data/sentinel/raw/. */
function findRawPath(dataDir: string, itemIdOrPath: string): string | null {
  if (existsSync(itemIdOrPath)) return itemIdOrPath;
  const rawDir = join(dataDir, 'raw');
  if (!existsSync(rawDir)) return null;
  const target = itemIdOrPath.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
  for (const date of readdirSync(rawDir)) {
    const dateDir = join(rawDir, date);
    for (const src of readdirSync(dateDir)) {
      const f = join(dateDir, src, target + '.md');
      if (existsSync(f)) return f;
    }
  }
  return null;
}

/** Entry point del slash command. `argv` es lo que sigue a "/sentinel". */
export async function handleSentinel(argv: string, deps: SentinelDeps): Promise<void> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const paths: SentinelPaths = { ...defaultPaths(), ...deps.paths };
  const parts = argv.trim().split(/\s+/);
  const sub = (parts[0] || '').toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (sub) {
    case 'watch':   return cmdWatch(paths, deps, out);
    case 'ask':     return cmdAsk(rest, deps, out);
    case 'deep':    return cmdDeep(rest, paths, deps, out);
    case 'list':    return cmdList(rest, paths, out);
    case 'forward': return cmdForward(rest, paths, deps, out);
    case 'digest':  return cmdDigest(rest, paths, deps, out);
    default:
      out('Uso: /sentinel <watch|ask|deep|list|forward|digest>');
      out('  watch                 — chequea fuentes + indexa items nuevos');
      out('  ask <tema>            — busca en lo archivado');
      out('  deep <itemId>         — extrae propuesta de un item');
      out('  list <YYYY-MM-DD>     — lista items archivados desde una fecha');
      out('  forward <proposalId>  — pasa una propuesta al council');
      out('  digest [--week|--month] — boletín');
  }
}

async function cmdWatch(paths: SentinelPaths, deps: SentinelDeps, out: (l: string) => void): Promise<void> {
  const { sources, errors } = loadSources(paths.sourcesYaml);
  for (const e of errors) out(`⚠ config: ${e}`);
  if (sources.length === 0) {
    out('No hay fuentes en config/sentinel/sources.yaml. Añade alguna y reintenta.');
    return;
  }

  const budget = new SentinelTokenBudget({ statePath: join(paths.dataDir, 'budget.json') });
  if (!budget.canProceed()) {
    out(`⏸ Watcher pausado: presupuesto semanal agotado (${budget.limit} tokens). ` +
      'Se reanuda en la siguiente ventana.');
    return;
  }

  const watcher = new SentinelWatcher({ dataDir: paths.dataDir });
  let totalNew = 0;
  for (const source of sources) {
    const r = await watcher.checkSource(source);
    if (r.error) {
      out(`✗ ${source.name}: ${r.error}`);
      continue;
    }
    out(`· ${source.name}: ${r.newItems.length} nuevos, ${r.skipped} ya vistos`);
    for (const item of r.newItems) {
      const date = item.archivedAt.slice(0, 10);
      const rawPath = join(paths.dataDir, 'raw', date,
        item.sourceId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120),
        item.itemId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) + '.md');
      try {
        await indexItem(deps.provider, item, rawPath);
        // Coste aproximado de indexar (embedding): ~longitud/4 tokens.
        budget.consume(Math.ceil((item.title.length + item.rawText.length) / 4));
        totalNew++;
      } catch (e: any) {
        out(`  ⚠ no se pudo indexar ${item.itemId}: ${e?.message ?? e}`);
      }
    }
  }
  out(`Watcher OK · ${totalNew} items nuevos archivados e indexados · ` +
    `presupuesto restante: ${budget.remaining()}/${budget.limit} tokens`);
}

async function cmdAsk(query: string, deps: SentinelDeps, out: (l: string) => void): Promise<void> {
  if (!query) { out('Uso: /sentinel ask <tema o pregunta>'); return; }
  const hits = await ask(deps.provider, query, 8);
  if (hits.length === 0) {
    out(`Sin resultados para "${query}". ¿Has corrido /sentinel watch?`);
    return;
  }
  out(`Top ${hits.length} para "${query}":`);
  for (const h of hits) {
    out(`  [${h.score.toFixed(2)}] ${h.title}  (${h.sourceName})`);
    out(`        ${h.summary}`);
    out(`        ${h.url}  · itemId: ${h.itemId}`);
  }
}

async function cmdDeep(
  arg: string, paths: SentinelPaths, deps: SentinelDeps, out: (l: string) => void,
): Promise<void> {
  if (!arg) { out('Uso: /sentinel deep <itemId|rawPath>'); return; }
  const rawPath = findRawPath(paths.dataDir, arg);
  if (!rawPath) { out(`No encuentro el item archivado: ${arg}`); return; }
  const proposal = await deepExtract(rawPath, deps.proposalLLM);
  saveProposal(paths.dataDir, proposal);
  out(`Propuesta extraída: ${proposal.proposalId}`);
  out(`  Título:   ${proposal.title}`);
  out(`  Desc:     ${proposal.description}`);
  out(`  Área:     ${proposal.shinobiArea}`);
  out(`  Esfuerzo: ${proposal.effort}`);
  out(`  Riesgos:  ${proposal.risks.join('; ') || 'ninguno'}`);
  out(`  Fuente:   ${proposal.sourceLink}`);
  out(`  → /sentinel forward ${proposal.proposalId} para pasarla al council.`);
}

function cmdList(arg: string, paths: SentinelPaths, out: (l: string) => void): void {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : '0000-00-00';
  const items = listArchived(join(paths.dataDir, 'raw'), since);
  if (items.length === 0) { out(`Sin items archivados desde ${since}.`); return; }
  out(`${items.length} items archivados desde ${since}:`);
  for (const it of items) {
    out(`  ${it.date} · ${it.sourceId} · ${it.itemId}`);
    out(`        ${it.title}`);
  }
}

async function cmdForward(
  arg: string, paths: SentinelPaths, deps: SentinelDeps, out: (l: string) => void,
): Promise<void> {
  if (!arg) { out('Uso: /sentinel forward <proposalId>'); return; }
  if (!deps.councilLLM) { out('Council no disponible: falta el LLM (councilLLM).'); return; }
  const proposal = loadProposal(paths.dataDir, arg);
  if (!proposal) { out(`Propuesta no encontrada: ${arg}. Genérala con /sentinel deep.`); return; }
  out(`Pasando "${proposal.title}" al council (arquitecto, security_auditor, strategic_critic)…`);
  const decision = await forwardToCouncil(proposal, {
    decisionsDir: paths.decisionsDir,
    llm: deps.councilLLM,
  });
  out(`Veredicto del council: ${decision.verdict}`);
  for (const [role, note] of Object.entries(decision.roleNotes)) out(`  ${role}: ${note}`);
  out(`Razonamiento: ${decision.rationale}`);
  out('Decisión registrada en docs/sentinel/decisions/. NO se implementa automáticamente.');
}

function cmdDigest(arg: string, paths: SentinelPaths, deps: SentinelDeps, out: (l: string) => void): void {
  const window = /--month/.test(arg) ? 'month' : 'week';
  const { sources } = loadSources(paths.sourcesYaml);
  const data = collectDigest({
    rawDir: join(paths.dataDir, 'raw'),
    decisionsDir: paths.decisionsDir,
    activeSources: sources.length,
    window,
  });
  for (const line of renderDigest(data).split('\n')) out(line);
}
