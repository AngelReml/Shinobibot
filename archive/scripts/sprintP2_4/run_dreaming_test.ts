#!/usr/bin/env node
/**
 * Prueba funcional Sprint P2.4 — Dreaming engine.
 *
 * Genera dreams para 3 días sintéticos y verifica que el output md
 * tiene las secciones esperadas, novelty cross-día, y persistencia.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DreamingEngine } from '../../src/memory/dreaming/dreaming_engine.js';
import type { MemoryMessage } from '../../src/memory/providers/types.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint P2.4 — Dreaming / Active Memory pipeline ===');

  const work = mkdtempSync(join(tmpdir(), 'sprint-P2.4-'));
  try {
    const dreamsDir = join(work, 'dreams');
    const engine = new DreamingEngine({
      dreamsDir,
      nowFn: () => new Date('2026-05-16T08:00:00Z'),
    });

    const msgs: MemoryMessage[] = [
      // Día 1 — onboarding.
      { role: 'user', content: 'Hablamos con Alice sobre el proyecto Shinobi.', ts: '2026-05-13T10:00:00Z' },
      { role: 'user', content: 'Me gusta el TypeScript estricto con NodeNext.', ts: '2026-05-13T11:00:00Z' },
      { role: 'user', content: 'Ejecuté read_file y revisé la estructura.', ts: '2026-05-13T12:00:00Z' },

      // Día 2 — decisiones.
      { role: 'user', content: 'Decidimos usar Vitest en vez de Jest.', ts: '2026-05-14T09:00:00Z' },
      { role: 'user', content: 'Alice revisó el PR. Bob aprobó.', ts: '2026-05-14T15:00:00Z' },
      { role: 'user', content: 'Invoqué grep_search para buscar refs.', ts: '2026-05-14T16:00:00Z' },

      // Día 3 — pull request del día.
      { role: 'user', content: 'Vamos a integrar con OpenClaw el módulo Memoria.', ts: '2026-05-15T08:00:00Z' },
      { role: 'user', content: 'Carlos se unió. No me gusta el dynamic typing.', ts: '2026-05-15T10:00:00Z' },
      { role: 'user', content: 'Alice cerró el sprint. Ejecuté run_command.', ts: '2026-05-15T17:00:00Z' },
    ];

    console.log('\n--- 1. Generar dreams para 3 días ---');
    const reports = await engine.dream(msgs);
    check(reports.length === 3, `3 reports generados`);
    check(reports[0].date === '2026-05-13', 'día 1 = 2026-05-13');
    check(reports[2].date === '2026-05-15', 'día 3 = 2026-05-15');

    console.log('\n--- 2. Cross-día novelty ---');
    const day2 = reports[1];
    const day3 = reports[2];
    const day2Recurring = day2.recurring.map(e => e.text);
    const day3Recurring = day3.recurring.map(e => e.text);
    check(day2Recurring.includes('Alice'), 'día 2 reconoce Alice como recurring (del día 1)');
    check(day3Recurring.includes('Alice'), 'día 3 sigue marcando Alice como recurring');
    check(day3.novel.some(e => e.text === 'Carlos'), 'día 3 detecta Carlos como novel');
    check(day3.novel.some(e => e.text === 'OpenClaw'), 'día 3 detecta OpenClaw como novel');

    console.log('\n--- 3. Secciones del markdown ---');
    const md = readFileSync(join(dreamsDir, '2026-05-14.md'), 'utf-8');
    console.log(md.split('\n').slice(0, 18).map(l => '  ' + l).join('\n'));
    check(md.includes('# Dream · 2026-05-14'), 'header con fecha');
    check(md.includes('## Entidades nuevas hoy'), 'sección novel');
    check(md.includes('## Entidades recurrentes'), 'sección recurring');
    check(md.includes('Vitest'), 'menciona la decisión');

    console.log('\n--- 4. listDreams ordena ---');
    const list = engine.listDreams();
    check(list.length === 3, '3 dream files');
    check(list[0] === '2026-05-13.md', 'primer dream = día más viejo');

    console.log('\n--- 5. Mensajes sin ts → skipea sin error ---');
    const dreamsDir2 = join(work, 'dreams2');
    const e2 = new DreamingEngine({ dreamsDir: dreamsDir2 });
    const r2 = await e2.dream([
      { role: 'user', content: 'sin ts' },
    ]);
    check(r2.length === 0, 'mensajes sin ts no producen dream');

    console.log('\n=== Summary ===');
    if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
    console.log('PASS · Dreaming pipeline genera markdown auditable por día');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Sprint P2.4 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
