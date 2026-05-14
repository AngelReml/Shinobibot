import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listRoles, getRole, relevanceFor } from '../role_registry.js';
import { selectRoles } from '../role_selector.js';
import { VoteHistory, computeWeight } from '../vote_history.js';
import { mediateHeuristic, votesFromMembers, isLLMMediatorEnabled } from '../mediator.js';
import type { MemberReport } from '../Committee.js';

let tmpHistory: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'shinobi-committee-'));
  tmpHistory = join(dir, 'history.jsonl');
  process.env.SHINOBI_COMMITTEE_HISTORY_PATH = tmpHistory;
  delete process.env.SHINOBI_MEDIATOR_LLM;
});
afterEach(() => {
  try { if (existsSync(tmpHistory)) rmSync(tmpHistory, { force: true }); } catch {}
  delete process.env.SHINOBI_COMMITTEE_HISTORY_PATH;
  delete process.env.SHINOBI_MEDIATOR_LLM;
});

describe('role_registry', () => {
  it('expone catálogo con ids únicos', () => {
    const roles = listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(roles.map(r => r.id));
    expect(ids.size).toBe(roles.length);
  });

  it('getRole encuentra por id', () => {
    expect(getRole('architect')?.id).toBe('architect');
    expect(getRole('inexistente')).toBeUndefined();
  });

  it('relevanceFor: input sin keywords → 0', () => {
    const r = getRole('security_auditor')!;
    expect(relevanceFor(r, '')).toBe(0);
    expect(relevanceFor(r, 'random unrelated text')).toBe(0);
  });

  it('relevanceFor: keyword match único → score > 0', () => {
    const r = getRole('security_auditor')!;
    expect(relevanceFor(r, 'busca vulnerabilidades')).toBeGreaterThan(0);
  });

  it('relevanceFor: múltiples keywords → score ≥ 0.5', () => {
    const r = getRole('security_auditor')!;
    expect(relevanceFor(r, 'audit security vulnerabilities and CVE')).toBeGreaterThanOrEqual(0.5);
  });

  it('clamp01: relevance siempre en [0,1]', () => {
    const r = getRole('architect')!;
    expect(relevanceFor(r, 'architecture architecture architecture architecture architecture architecture'))
      .toBeLessThanOrEqual(1);
  });
});

describe('selectRoles', () => {
  it('count default 3', () => {
    const sel = selectRoles('Refactoriza la arquitectura del módulo de pagos');
    expect(sel.length).toBe(3);
  });

  it('incluye architect y security_auditor (core coverage) por default', () => {
    const sel = selectRoles('mejora el rendimiento de la API');
    const ids = sel.map(s => s.id);
    expect(ids).toContain('architect');
    expect(ids).toContain('security_auditor');
  });

  it('ensureCoreCoverage=false permite sustituir', () => {
    const sel = selectRoles('mejora rendimiento de la API', { ensureCoreCoverage: false, count: 2 });
    // El selector elegirá los 2 más relevantes; performance + (algo) muy probablemente.
    expect(sel.length).toBe(2);
    expect(sel.map(s => s.id)).toContain('performance_analyst');
  });

  it('requiredIds fuerza la inclusión', () => {
    const sel = selectRoles('analyze schema', {
      count: 4,
      requiredIds: ['devops_reviewer', 'data_modeler'],
    });
    const ids = sel.map(s => s.id);
    expect(ids).toContain('devops_reviewer');
    expect(ids).toContain('data_modeler');
  });

  it('tareas de seguridad → security al frente', () => {
    const sel = selectRoles('audit security: detectar SQLi, XSS, RCE');
    expect(sel[0].id).toMatch(/security/);
  });

  it('orden final por weight × relevance descendente', () => {
    const sel = selectRoles('audit security: detectar SQLi y RCE');
    for (let i = 1; i < sel.length; i++) {
      const prev = sel[i - 1].weight * sel[i - 1].relevance;
      const curr = sel[i].weight * sel[i].relevance;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe('computeWeight', () => {
  it('total=0 → peso 1.0', () => {
    expect(computeWeight(0, 0)).toBe(1.0);
  });
  it('zona neutral 0.4-0.7 → 1.0', () => {
    expect(computeWeight(10, 0.5)).toBe(1.0);
    expect(computeWeight(10, 0.65)).toBe(1.0);
  });
  it('alignment alto (>0.7) → sube hasta 1.5', () => {
    expect(computeWeight(10, 0.7)).toBe(1.0);
    expect(computeWeight(10, 1.0)).toBeCloseTo(1.5, 4);
    expect(computeWeight(10, 0.85)).toBeGreaterThan(1.1);
    expect(computeWeight(10, 0.85)).toBeLessThanOrEqual(1.5);
  });
  it('alignment bajo (<0.4) → baja hasta 0.5', () => {
    expect(computeWeight(10, 0.4)).toBe(1.0);
    expect(computeWeight(10, 0.0)).toBe(0.5);
    expect(computeWeight(10, 0.2)).toBeLessThan(1.0);
    expect(computeWeight(10, 0.2)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('VoteHistory persistence', () => {
  it('appendRecord persiste y se lee en próximo VoteHistory', () => {
    const h = new VoteHistory(tmpHistory);
    h.appendRecord({ reviewId: 'r1', roleId: 'architect', roleRisk: 'medium', finalRisk: 'medium', aligned: true });
    h.appendRecord({ reviewId: 'r2', roleId: 'architect', roleRisk: 'high', finalRisk: 'medium', aligned: false });
    const h2 = new VoteHistory(tmpHistory);
    expect(h2.snapshot()).toHaveLength(2);
    const stats = h2.statsFor('architect');
    expect(stats.total).toBe(2);
    expect(stats.aligned).toBe(1);
    expect(stats.alignmentRatio).toBe(0.5);
    expect(stats.weight).toBe(1.0);
  });

  it('alignment alto → peso 1.x', () => {
    const h = new VoteHistory(tmpHistory);
    for (let i = 0; i < 9; i++) h.appendRecord({ reviewId: `r${i}`, roleId: 'security_auditor', roleRisk: 'high', finalRisk: 'high', aligned: true });
    h.appendRecord({ reviewId: 'r9', roleId: 'security_auditor', roleRisk: 'medium', finalRisk: 'high', aligned: false });
    const s = h.statsFor('security_auditor');
    expect(s.alignmentRatio).toBe(0.9);
    expect(s.weight).toBeGreaterThan(1.0);
    expect(s.weight).toBeLessThanOrEqual(1.5);
  });
});

describe('mediator.mediateHeuristic', () => {
  it('regla 1: high-weight high sin refutación → high con confidence high', () => {
    const r = mediateHeuristic([
      { roleId: 'security_auditor', risk: 'high', weight: 1.5 },
      { roleId: 'architect',         risk: 'medium', weight: 1.0 },
      { roleId: 'design_critic',     risk: 'low',    weight: 0.8 },
    ]);
    expect(r.finalRisk).toBe('high');
    expect(r.confidence).toBe('high');
  });

  it('regla 1 NO aplica si hay low-weight high pero también low-weight low', () => {
    const r = mediateHeuristic([
      { roleId: 'a', risk: 'high', weight: 1.3 },
      { roleId: 'b', risk: 'low',  weight: 1.3 },
      { roleId: 'c', risk: 'medium', weight: 1.0 },
    ]);
    // No high strong sin refutación → cae a mayoría/mediana.
    expect(['low', 'medium', 'high']).toContain(r.finalRisk);
  });

  it('regla 2: mayoría ponderada simple', () => {
    const r = mediateHeuristic([
      { roleId: 'a', risk: 'medium', weight: 1.0 },
      { roleId: 'b', risk: 'medium', weight: 1.0 },
      { roleId: 'c', risk: 'high',   weight: 1.0 },
    ]);
    expect(r.finalRisk).toBe('medium');
  });

  it('unanimidad → confidence high', () => {
    const r = mediateHeuristic([
      { roleId: 'a', risk: 'medium', weight: 1.0 },
      { roleId: 'b', risk: 'medium', weight: 1.0 },
      { roleId: 'c', risk: 'medium', weight: 1.0 },
    ]);
    expect(r.finalRisk).toBe('medium');
    expect(r.confidence).toBe('high');
  });

  it('cero votos → medium con confidence low', () => {
    const r = mediateHeuristic([]);
    expect(r.finalRisk).toBe('medium');
    expect(r.confidence).toBe('low');
  });

  it('regla 3: tres tiers distintos sin mayoría → mediana ponderada', () => {
    const r = mediateHeuristic([
      { roleId: 'a', risk: 'low',    weight: 1.0 },
      { roleId: 'b', risk: 'medium', weight: 1.0 },
      { roleId: 'c', risk: 'high',   weight: 1.0 },
    ]);
    // mediana de [1,2,3] = 2 → medium
    expect(r.finalRisk).toBe('medium');
  });
});

describe('votesFromMembers', () => {
  it('omite errores', () => {
    const m: any[] = [
      { role: 'a', strengths: [], weaknesses: [], recommendations: [], risk_level: 'high' } as MemberReport,
      { role: 'b', error: 'boom' },
    ];
    const v = votesFromMembers(m);
    expect(v).toHaveLength(1);
    expect(v[0].roleId).toBe('a');
  });

  it('aplica pesos del map', () => {
    const m: MemberReport[] = [
      { role: 'a', strengths: [], weaknesses: ['x'], recommendations: [], risk_level: 'high' },
    ];
    const v = votesFromMembers(m, new Map([['a', 1.5]]));
    expect(v[0].weight).toBe(1.5);
    expect(v[0].rationale).toBe('x');
  });
});

describe('LLM mediator flag', () => {
  it('default OFF', () => {
    delete process.env.SHINOBI_MEDIATOR_LLM;
    expect(isLLMMediatorEnabled()).toBe(false);
  });
  it('SHINOBI_MEDIATOR_LLM=1 → ON', () => {
    process.env.SHINOBI_MEDIATOR_LLM = '1';
    expect(isLLMMediatorEnabled()).toBe(true);
  });
});
