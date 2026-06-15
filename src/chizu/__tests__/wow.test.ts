/**
 * M-16 — EL PROMPT WOW (§13) scaffold: "reconoce el terreno". Enumeración + uso
 * faked; el operador cambia `discover`/`usageOf` por las fuentes reales.
 */
import { describe, it, expect } from 'vitest';
import { runTerrainDemo, type DiscoverFn, type UsageFn } from '../demo.js';
import type { SourceBatch } from '../discovery/fuse.js';
import type { AppCard } from '../types.js';

const discover: DiscoverFn = async (): Promise<SourceBatch[]> => [
  { source: 'path_scan', apps: [{ raw_name: 'git', raw_path: 'C:/git/git.exe', meta: {} }] },
  { source: 'registry_uninstall', apps: [{ raw_name: 'MyBank', raw_path: 'C:/bank/bank.exe', meta: { publisher: 'Bank Inc' } }] },
  { source: 'registry_uninstall', apps: [{ raw_name: 'Notepad', raw_path: 'C:/win/notepad.exe', meta: {} }] },
];
const usageOf: UsageFn = (c: AppCard) => c.display_name === 'git' ? { run_count: 300, recency_days: 1 } : { run_count: 0 };

describe('chizu — M-16 PROMPT WOW (reconoce el terreno)', () => {
  it('mapea lo que HAY (con fuente), lo más usado, lo pilotable por CLI y las bombas', async () => {
    const { cards, narration } = await runTerrainDemo(discover, usageOf);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.discovered_by.length > 0)).toBe(true);     // cero alucinación
    expect(narration).toMatch(/RECONOCE EL TERRENO/);
    expect(narration).toMatch(/VIVO MÁS: git/);                            // uso real arriba
    expect(narration).toMatch(/PILOTABLE POR CLI: .*git/);                 // CLI por known_db
    expect(narration).toMatch(/BOMBAS.*MyBank/);                           // riesgo financiero protegido
  });
});
