/**
 * chizu/demo.ts — M-16: scaffold del PROMPT WOW (§13). "Antes de mover un dedo,
 * reconoce el terreno: qué programas hay DE VERDAD, cuáles vivo, cuáles puedes
 * pilotar por CLI, y cuáles son una bomba que no se toca sin permiso."
 *
 * Corre el cartógrafo de punta a punta con la enumeración (PowerShell/winget)
 * INYECTADA — el operador cambia `discover` por discoverSource real. Lo que demuestra:
 * Atlas solo con lo descubierto (cero alucinación), uso real, automatizabilidad y
 * recursos protegidos.
 */

import { fuse, type SourceBatch } from './discovery/fuse.js';
import { scoreUsage } from './usage/score.js';
import { classifyRisk, inferCategory } from './characterize/risk.js';
import { characterizeStatic } from './characterize/characterize.js';
import { Atlas } from './atlas/atlas.js';
import { protectedResources } from './adapters.js';
import type { AppCard } from './types.js';

/** ⚑ LIVE seam: run the read-only discovery sources. Injected/faked. */
export type DiscoverFn = () => Promise<SourceBatch[]>;
/** ⚑ LIVE seam: usage signal per app (UserAssist/Prefetch). Injected/faked. */
export type UsageFn = (card: AppCard) => { run_count?: number; recency_days?: number };

export interface TerrainResult { atlas: Atlas; cards: AppCard[]; narration: string; }

export async function runTerrainDemo(discover: DiscoverFn, usageOf: UsageFn, ts = 't'): Promise<TerrainResult> {
  const batches = await discover();
  const cards = fuse(batches, { retrievedAt: ts }).map((c) => {
    const u = usageOf(c);
    const category = inferCategory(c.display_name, c.publisher);   // fuse leaves 'other'; infer for real risk/characterization
    const risk = classifyRisk({ name: c.display_name, publisher: c.publisher, category });
    return {
      ...c, category,
      usage: { ...c.usage, run_count: u.run_count, recency_days: u.recency_days, usage_score: scoreUsage({ run_count: u.run_count, recency_days: u.recency_days }) },
      characterization: characterizeStatic({ name: c.display_name, exe: c.primary_executable, publisher: c.publisher, install_type: c.install_type as any, category }),
      risk,
    } as AppCard;
  });
  const atlas = new Atlas(cards);
  const prot = protectedResources(cards);

  const N = ['🗺 RECONOCE EL TERRENO (demo):'];
  N.push(`HAY (de verdad, cada uno con fuente): ${cards.length} programas.`);
  const top = [...cards].sort((a, b) => b.usage.usage_score - a.usage.usage_score).slice(0, 3);
  N.push(`VIVO MÁS: ${top.map((c) => `${c.display_name} (${(c.usage.usage_score * 100).toFixed(0)}%)`).join(', ')}.`);
  const cli = cards.filter((c) => c.characterization.cli.available === true);
  N.push(`PILOTABLE POR CLI: ${cli.map((c) => c.display_name).join(', ') || '(ninguno detectado)'}.`);
  N.push(`BOMBAS (no tocar sin permiso): ${prot.map((p) => `${p.display_name} [${p.reasons.join('/')}]`).join(', ') || '(ninguna)'}.`);
  return { atlas, cards, narration: N.join('\n') };
}
