// src/reader/__tests__/multi_repo.test.ts
//
// Tests del motor E6 (comprensión multi-repo comparativa). El núcleo (distill,
// ledger, assemble) es PURO y determinista. La orquestación se prueba con un
// digester y un índice MOCK (sin LLM ni FS real).

import { describe, it, expect } from 'vitest';
import {
  distillCard, cardSizeChars, ComparisonLedger, assembleComparisonFrame,
  comprehendRepos, type RepoDigester, type RepoIndex,
} from '../multi_repo.js';
import type { RepoReport } from '../schemas.js';

function bigReport(i: number): RepoReport {
  return {
    repo_purpose: `Repo ${i} `.repeat(60),
    architecture_summary: 'arquitectura masiva '.repeat(2000),
    modules: Array.from({ length: 150 }, (_, k) => ({ name: `mod${k}`, path: `/m${k}`, responsibility: 'resp larga '.repeat(20) })),
    entry_points: Array.from({ length: 20 }, (_, k) => ({ file: `e${k}.ts`, kind: 'cli' })),
    risks: [{ severity: 'high', description: 'crítico '.repeat(30) }, { severity: 'low', description: 'menor' }],
    evidence: { subagent_count: 9, tokens_total: 1_500_000, duration_ms: 1, subreports_referenced: 9 },
  };
}

describe('distillCard — acota repos enormes a una card pequeña', () => {
  it('trunca módulos a maxModules y conserva el total real en metrics', () => {
    const card = distillCard(bigReport(0), { id: 'A', name: 'repo0', path: '/r0' });
    expect(card.modules).toHaveLength(8);
    expect(card.metrics.modules).toBe(150);
  });
  it('la card cabe en pocos KB pese a un repo de millones de chars', () => {
    const card = distillCard(bigReport(1), { id: 'B', name: 'repo1', path: '/r1' });
    expect(cardSizeChars(card)).toBeLessThanOrEqual(3000);
  });
  it('ordena riesgos por severidad (high primero)', () => {
    const card = distillCard(bigReport(2), { id: 'C', name: 'repo2', path: '/r2' });
    expect(card.topRisks[0].startsWith('[high]')).toBe(true);
  });
});

describe('ComparisonLedger — matriz comparativa durable', () => {
  it('registra hallazgos por eje/repo y los serializa', () => {
    const l = new ComparisonLedger();
    l.record('auth', 'A', 'JWT');
    l.record('auth', 'B', 'sesiones');
    expect(l.size()).toBe(2);
    const round = ComparisonLedger.fromJSON(l.toJSON());
    expect(round.findingsFor('auth').get('A')).toBe('JWT');
  });
  it('renderiza una tabla markdown legible por humanos', () => {
    const l = new ComparisonLedger();
    l.record('auth', 'A', 'JWT'); l.record('tests', 'A', 'vitest');
    const md = l.toMatrixMarkdown([{ id: 'A', name: 'repo0' }, { id: 'B', name: 'repo1' }]);
    expect(md.split('\n')[0]).toContain('| Eje |');
    expect(md).toContain('auth');
    expect(md).toContain('tests');
  });
});

describe('assembleComparisonFrame — invariante de contexto acotado', () => {
  const cards = [0, 1, 2, 3, 4].map((i) => distillCard(bigReport(i), { id: String.fromCharCode(65 + i), name: `repo${i}`, path: `/r${i}` }));
  const ledger = new ComparisonLedger();
  ledger.record('auth', 'A', 'JWT'); ledger.record('auth', 'B', 'sesiones');

  it('con budget mínimo, el contexto queda acotado y algún repo se resume (lazy)', () => {
    const frame = assembleComparisonFrame(cards, ledger, 2500);
    expect(frame.usedChars).toBeLessThanOrEqual(2500 + 1500);
    expect(frame.summarized.length).toBeGreaterThan(0);
  });
  it('INVARIANTE: la matriz comparativa y las cabeceras NUNCA se caen, aun con budget mínimo', () => {
    const frame = assembleComparisonFrame(cards, ledger, 1500);
    expect(frame.context).toContain('Matriz comparativa');
    expect(frame.context).toContain('auth');
    for (const id of ['A', 'B', 'C', 'D', 'E']) expect(frame.context).toContain(`[${id}]`);
  });
  it('con budget amplio, todos los repos se expanden', () => {
    const frame = assembleComparisonFrame(cards, ledger, 200_000);
    expect(frame.expanded).toHaveLength(5);
    expect(frame.summarized).toHaveLength(0);
  });
});

describe('comprehendRepos — orquestación con mocks (sin LLM ni FS)', () => {
  const digester: RepoDigester = { digest: async (p) => bigReport(p.length) };
  it('digiere, destila e indexa N repos y arma el frame', async () => {
    const indexed: string[] = [];
    const index: RepoIndex = {
      index: (repoId, section) => { indexed.push(`${repoId}:${section}`); },
      recall: () => ['snippet'],
    };
    const res = await comprehendRepos({
      repos: [{ path: '/repoA', name: 'A' }, { path: '/repoB', name: 'B' }, { path: '/repoC', name: 'C' }],
      digester, index, budgetChars: 6000,
    });
    expect(res.cards).toHaveLength(3);
    expect(res.frame.context).toContain('Comparación de 3 repos');
    expect(indexed.some((s) => s.endsWith(':purpose'))).toBe(true);
  });
});
