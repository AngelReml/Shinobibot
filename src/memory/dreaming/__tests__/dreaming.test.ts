import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { bucketByDay, dayKey } from '../day_bucket.js';
import { extractEntities, diffEntities } from '../entity_resolver.js';
import { DreamingEngine } from '../dreaming_engine.js';
import type { MemoryMessage } from '../../providers/types.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'shinobi-dream-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

describe('dayKey', () => {
  it('extrae YYYY-MM-DD UTC', () => {
    expect(dayKey('2026-05-15T10:30:00Z')).toBe('2026-05-15');
    expect(dayKey('2026-05-15T23:59:59Z')).toBe('2026-05-15');
  });
  it('null/undefined → "unknown"', () => {
    expect(dayKey(undefined)).toBe('unknown');
    expect(dayKey(null)).toBe('unknown');
  });
  it('inválido → "unknown"', () => {
    expect(dayKey('not-a-date')).toBe('unknown');
  });
});

describe('bucketByDay', () => {
  it('agrupa por día y devuelve orden ascendente', () => {
    const msgs: MemoryMessage[] = [
      { role: 'user', content: 'b', ts: '2026-05-15T10:00:00Z' },
      { role: 'user', content: 'a', ts: '2026-05-14T10:00:00Z' },
      { role: 'user', content: 'c', ts: '2026-05-15T12:00:00Z' },
    ];
    const b = bucketByDay(msgs);
    const keys = [...b.keys()];
    expect(keys).toEqual(['2026-05-14', '2026-05-15']);
    expect(b.get('2026-05-15')!.length).toBe(2);
  });
});

describe('extractEntities', () => {
  it('detecta proper nouns (personas/proyectos)', () => {
    const msgs: MemoryMessage[] = [{
      role: 'user',
      content: 'Hablé con Alice ayer sobre el proyecto Shinobi.',
      ts: '2026-05-15T00:00:00Z',
    }];
    const e = extractEntities(msgs);
    const names = e.map(x => x.text);
    expect(names).toContain('Alice');
    expect(names).toContain('Shinobi');
  });

  it('detecta preferencias', () => {
    const msgs: MemoryMessage[] = [{
      role: 'user',
      content: 'Me gusta el TypeScript estricto. No me gusta el dynamic typing.',
      ts: '2026-05-15T00:00:00Z',
    }];
    const e = extractEntities(msgs);
    const prefs = e.filter(x => x.kind === 'preference');
    expect(prefs.length).toBeGreaterThanOrEqual(1);
  });

  it('detecta decisiones', () => {
    const msgs: MemoryMessage[] = [{
      role: 'user',
      content: 'Decidimos usar Vitest en vez de Jest.',
      ts: '2026-05-15T00:00:00Z',
    }];
    const e = extractEntities(msgs);
    const decs = e.filter(x => x.kind === 'decision');
    expect(decs.length).toBeGreaterThanOrEqual(1);
  });

  it('detecta tools mencionadas', () => {
    const msgs: MemoryMessage[] = [{
      role: 'user',
      content: 'Ejecuté read_file y luego invoqué grep_search.',
      ts: '2026-05-15T00:00:00Z',
    }];
    const e = extractEntities(msgs);
    const tools = e.filter(x => x.kind === 'tool').map(x => x.text);
    expect(tools).toContain('read_file');
    expect(tools).toContain('grep_search');
  });

  it('count se incrementa con menciones múltiples', () => {
    const msgs: MemoryMessage[] = [
      { role: 'user', content: 'Alice escribió código.', ts: '2026-05-15T00:00:00Z' },
      { role: 'user', content: 'Luego Alice revisó el PR.', ts: '2026-05-15T01:00:00Z' },
      { role: 'user', content: 'Alice y el equipo aprobaron.', ts: '2026-05-15T02:00:00Z' },
    ];
    const e = extractEntities(msgs);
    const alice = e.find(x => x.text === 'Alice');
    expect(alice?.count).toBe(3);
  });

  it('descarta stopwords (Hola, Pero, etc.)', () => {
    const msgs: MemoryMessage[] = [{
      role: 'user',
      content: 'Hola, Pero como dijiste, Cuando empezamos.',
      ts: '2026-05-15T00:00:00Z',
    }];
    const e = extractEntities(msgs);
    const text = e.map(x => x.text);
    expect(text).not.toContain('Hola');
    expect(text).not.toContain('Pero');
    expect(text).not.toContain('Cuando');
  });
});

describe('diffEntities', () => {
  it('marca como novel lo nuevo', () => {
    const today = extractEntities([
      { role: 'user', content: 'Alice y Bob trabajaron en Shinobi.', ts: '2026-05-15T00:00:00Z' },
    ]);
    const yesterday = extractEntities([
      { role: 'user', content: 'Alice trabajó en Hermes.', ts: '2026-05-14T00:00:00Z' },
    ]);
    const { novel, recurring } = diffEntities(today, yesterday);
    expect(recurring.map(e => e.text)).toContain('Alice');
    expect(novel.map(e => e.text)).toContain('Bob');
  });
});

describe('DreamingEngine', () => {
  it('crea dreamsDir si no existe', () => {
    const dir = join(work, 'dreams');
    expect(existsSync(dir)).toBe(false);
    new DreamingEngine({ dreamsDir: dir });
    expect(existsSync(dir)).toBe(true);
  });

  it('genera un dream.md por cada día con mensajes', async () => {
    const dir = join(work, 'dreams');
    const eng = new DreamingEngine({ dreamsDir: dir, nowFn: () => new Date('2026-05-16T00:00:00Z') });
    const msgs: MemoryMessage[] = [
      { role: 'user', content: 'Hablé con Alice del proyecto Shinobi.', ts: '2026-05-14T10:00:00Z' },
      { role: 'user', content: 'Decidimos usar Vitest para testing.', ts: '2026-05-15T11:00:00Z' },
      { role: 'user', content: 'Alice revisó el PR.', ts: '2026-05-15T15:00:00Z' },
    ];
    const reports = await eng.dream(msgs);
    expect(reports.length).toBe(2);
    expect(reports[0].date).toBe('2026-05-14');
    expect(reports[1].date).toBe('2026-05-15');
    expect(existsSync(join(dir, '2026-05-14.md'))).toBe(true);
    expect(existsSync(join(dir, '2026-05-15.md'))).toBe(true);

    const md = readFileSync(join(dir, '2026-05-15.md'), 'utf-8');
    expect(md).toContain('# Dream · 2026-05-15');
    expect(md).toContain('Decisiones');
    expect(md).toContain('Vitest');
  });

  it('listDreams ordena los md', async () => {
    const dir = join(work, 'dreams');
    const eng = new DreamingEngine({ dreamsDir: dir });
    await eng.dream([
      { role: 'user', content: 'Alice ayer.', ts: '2026-05-13T00:00:00Z' },
      { role: 'user', content: 'Bob hoy.', ts: '2026-05-15T00:00:00Z' },
    ]);
    const list = eng.listDreams();
    expect(list).toEqual(['2026-05-13.md', '2026-05-15.md']);
  });

  it('skipea bucket "unknown" (sin ts)', async () => {
    const dir = join(work, 'dreams');
    const eng = new DreamingEngine({ dreamsDir: dir });
    const reports = await eng.dream([
      { role: 'user', content: 'sin fecha' }, // sin ts
    ]);
    expect(reports.length).toBe(0);
  });
});
