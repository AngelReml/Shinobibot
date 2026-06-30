/**
 * Tests E5 — ANTICIPADOR
 *
 * Cubre:
 *   1. YouTube @handle resolution (watcher)
 *   2. Tier-1-local (credibility)
 *   3. Extracción de claims (e5_claims)
 *   4. Destilación de hipótesis (e5_hypotheses)
 *   5. Registro de apuestas con calibración asimétrica (e5_bets)
 *   6. Briefing (e5_briefing)
 *   7. Persistencia (e5_store)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { SentinelWatcher } from '../watcher.js';
import { tierForSource, aggregateCredibility } from '../../kagemusha/thread/credibility.js';
import { extractClaims, detectDimension } from '../e5_claims.js';
import { distillHypotheses } from '../e5_hypotheses.js';
import { E5BetRegistry } from '../e5_bets.js';
import { E5Store } from '../e5_store.js';
import { renderBriefing } from '../e5_briefing.js';
import type { SentinelItem, SentinelSource } from '../types.js';
import type { E5Claim, E5Hypothesis } from '../e5_types.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'e5-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

// ── 1. YouTube @handle ──────────────────────────────────────────────────────

describe('SentinelWatcher — @handle resolution', () => {
  const source: SentinelSource = {
    type: 'youtube_channel', id: '@testcanal', name: 'Test Canal',
    interval: '1w', whisper_threshold_minutes: 5,
  };

  it('resuelve @handle a channelId y descarga el feed', async () => {
    const CHANNEL_ID = 'UCabc123testXYZ456';
    const channelPage = `<html><script>"channelId":"${CHANNEL_ID}"</script></html>`;
    const feedXml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <entry><yt:videoId>v1</yt:videoId><title>Video 1</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=v1"/>
        <published>2026-06-01T00:00:00Z</published></entry>
    </feed>`;

    let requestedUrls: string[] = [];
    const fetch = async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('@testcanal')) return { ok: true, status: 200, text: channelPage };
      if (url.includes(CHANNEL_ID)) return { ok: true, status: 200, text: feedXml };
      return { ok: false, status: 404, text: '' };
    };

    const watcher = new SentinelWatcher({ dataDir: work, fetchImpl: fetch });
    const result = await watcher.checkSource(source);

    expect(requestedUrls[0]).toContain('@testcanal');
    expect(requestedUrls[1]).toContain(CHANNEL_ID);
    expect(result.error).toBeUndefined();
    expect(result.newItems.length).toBeGreaterThanOrEqual(1);
  });

  it('resolveHandleToChannelId extrae el channelId del HTML', async () => {
    const CHANNEL_ID = 'UCxyz789handle';
    const fetch = async () => ({
      ok: true, status: 200,
      text: `<html>"channelId":"${CHANNEL_ID}" other content</html>`,
    });
    const watcher = new SentinelWatcher({ dataDir: work, fetchImpl: fetch });
    const id = await watcher.resolveHandleToChannelId('@cualquierhandle');
    expect(id).toBe(CHANNEL_ID);
  });

  it('resolveHandleToChannelId lanza si no encuentra channelId', async () => {
    const fetch = async () => ({ ok: true, status: 200, text: '<html>sin channel id</html>' });
    const watcher = new SentinelWatcher({ dataDir: work, fetchImpl: fetch });
    await expect(watcher.resolveHandleToChannelId('@noexiste'))
      .rejects.toThrow(/channelId/);
  });

  it('fuente con channel_id normal NO va por la ruta handle', async () => {
    const normalSource: SentinelSource = {
      ...source, id: 'UCabc123normal',
    };
    let requestedUrls: string[] = [];
    const fetch = async (url: string) => {
      requestedUrls.push(url);
      return { ok: true, status: 200, text: '<feed></feed>' };
    };
    const watcher = new SentinelWatcher({ dataDir: work, fetchImpl: fetch });
    await watcher.checkSource(normalSource);
    // Solo 1 request al feed, no 2 (handle + feed).
    expect(requestedUrls.length).toBe(1);
    expect(requestedUrls[0]).toContain('channel_id=UCabc123normal');
  });
});

// ── 2. Tier-1-local ─────────────────────────────────────────────────────────

describe('tierForSource — Tier-1-local', () => {
  it('local → tier 1 (PLAUSIBLE eligible)', () => {
    expect(tierForSource('local')).toBe(1);
  });

  it('transcript → tier 1 (PLAUSIBLE eligible)', () => {
    expect(tierForSource('transcript')).toBe(1);
  });

  it('tier-1 fuente local NO resulta UNFOUNDED en credibility.ts (puede ser WEAK)', () => {
    const verdict = aggregateCredibility({
      source_tier: tierForSource('transcript'),
      authors_traceable: true,
      corroboration_count: 0,
      has_artifacts: false,
      recency_ok: true,
      red_flags: [],
    });
    // Tier-1 sin artefactos → WEAK (no UNFOUNDED). e5_claims.ts eleva WEAK→PLAUSIBLE.
    expect(verdict.level).not.toBe('UNFOUNDED');
  });

  it('extractClaims de youtube_channel → PLAUSIBLE (Tier-1-local, no UNFOUNDED)', async () => {
    const youtubeItem: SentinelItem = {
      itemId: 'yt1', sourceId: '@canal', sourceType: 'youtube_channel',
      sourceName: 'Test Canal', title: 'Benchmark de pass@1',
      url: 'https://youtube.com/watch?v=yt1', publishedAt: '2026-06-01T00:00:00Z',
      rawText: 'El nuevo modelo muestra mejoras en pass@1 de un 20%, reduciendo la latencia al mismo tiempo.',
      transcriptSource: 'whisper-local', archivedAt: new Date().toISOString(),
    };
    const claims = await extractClaims(youtubeItem);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.credibility !== 'UNFOUNDED')).toBe(true);
    expect(claims.every((c) => c.credibility === 'PLAUSIBLE' || c.credibility === 'SOLID')).toBe(true);
  });

  it('comment sigue siendo tier 0 → UNFOUNDED', () => {
    expect(tierForSource('comment')).toBe(0);
    const verdict = aggregateCredibility({
      source_tier: 0,
      authors_traceable: false,
      corroboration_count: 0,
      has_artifacts: false,
      recency_ok: true,
      red_flags: [],
    });
    expect(verdict.level).toBe('UNFOUNDED');
  });
});

// ── 3. Extracción de claims ──────────────────────────────────────────────────

function mkItem(overrides: Partial<SentinelItem> = {}): SentinelItem {
  return {
    itemId: 'item1',
    sourceId: 'src1',
    sourceType: 'rss',
    sourceName: 'Blog IA',
    title: 'Mejoras en pass@1 para agentes',
    url: 'https://blog.ia/post1',
    publishedAt: '2026-06-01T00:00:00Z',
    rawText: 'Los nuevos modelos muestran mejoras en pass@1 de hasta un 15%. La tasa de éxito en benchmark sube notablemente con mejoras de self_correction y latency.',
    transcriptSource: 'text',
    archivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('extractClaims — heurística sin LLM', () => {
  it('produce claims con credibilidad PLAUSIBLE para fuente rss', async () => {
    const claims = await extractClaims(mkItem());
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.credibility !== 'UNFOUNDED')).toBe(true);
  });

  it('los claims tienen valid_from y valid_until', async () => {
    const claims = await extractClaims(mkItem());
    for (const c of claims) {
      expect(c.valid_from).toBeTruthy();
      expect(c.valid_until).toBeTruthy();
      expect(new Date(c.valid_until) > new Date(c.valid_from)).toBe(true);
    }
  });

  it('detecta dimensión pass@1 en el texto', async () => {
    const claims = await extractClaims(mkItem());
    const hasDim = claims.some((c) => c.dimension === 'pass@1');
    expect(hasDim).toBe(true);
  });

  it('fuente github_repo → admissible (PLAUSIBLE o SOLID)', async () => {
    const claims = await extractClaims(mkItem({ sourceType: 'github_repo' }));
    expect(claims.every((c) => c.credibility !== 'UNFOUNDED')).toBe(true);
  });
});

describe('detectDimension', () => {
  it.each([
    ['mejora pass@1 en benchmark', 'pass@1'],
    ['self-correction rate sube un 20%', 'self_correction'],
    ['seguridad: 0 acciones irreversibles sin permiso', 'safety'],
    ['reducción de latencia en 30ms', 'latency'],
    ['coste por tarea baja a $0.002', 'cost'],
    ['onboarding wizard para usuarios no técnicos', 'accessibility'],
  ])('%s → %s', (text, expected) => {
    expect(detectDimension(text)).toBe(expected);
  });

  it('texto sin dimensión → undefined', () => {
    expect(detectDimension('el cielo es azul hoy')).toBeUndefined();
  });
});

describe('extractClaims — con LLM mock', () => {
  it('usa la respuesta estructurada del LLM', async () => {
    const llm = async () => JSON.stringify([
      { text: 'pass@1 sube un 15%', quote: 'mejora del 15%', dimension: 'pass@1' },
      { text: 'sin dimensión relevante', quote: 'xyz', dimension: null },
    ]);
    const claims = await extractClaims(mkItem(), { llm });
    expect(claims.length).toBe(2);
    expect(claims[0].dimension).toBe('pass@1');
    expect(claims[1].dimension).toBeUndefined();
  });

  it('LLM que devuelve JSON inválido → cae a heurística vacía (no crash)', async () => {
    const llm = async () => 'esto no es JSON';
    const claims = await extractClaims(mkItem(), { llm });
    // No debe lanzar; devuelve vacío del LLM (sin heurística fallback con LLM).
    expect(Array.isArray(claims)).toBe(true);
  });
});

// ── 4. Destilación de hipótesis ──────────────────────────────────────────────

describe('distillHypotheses', () => {
  function mkClaim(overrides: Partial<E5Claim>): E5Claim {
    return {
      claimId: 'c1',
      text: 'mejora en pass@1',
      quote: 'pass@1 sube',
      sourceUrl: 'https://x.com',
      sourceName: 'Fuente A',
      publishedAt: '2026-06-01T00:00:00Z',
      capturedAt: new Date().toISOString(),
      credibility: 'PLAUSIBLE',
      credibilityScore: 0.6,
      dimension: 'pass@1',
      valid_from: new Date(Date.now() - 1000).toISOString(),
      valid_until: new Date(Date.now() + 86_400_000).toISOString(),
      sourceItemId: 'item1',
      ...overrides,
    };
  }

  it('claims con dimensión → hipótesis; sin dimensión → notas', () => {
    const claims = [
      mkClaim({ claimId: 'c1', dimension: 'pass@1' }),
      mkClaim({ claimId: 'c2', dimension: undefined }),
    ];
    const { hypotheses, notes } = distillHypotheses(claims);
    expect(hypotheses.length).toBe(1);
    expect(notes.length).toBe(1);
    expect(hypotheses[0].dimension).toBe('pass@1');
  });

  it('dos fuentes independientes → corroboración → SOLID', () => {
    const claims = [
      mkClaim({ claimId: 'c1', sourceName: 'Fuente A', dimension: 'safety' }),
      mkClaim({ claimId: 'c2', sourceName: 'Fuente B', dimension: 'safety' }),
    ];
    const { hypotheses } = distillHypotheses(claims);
    expect(hypotheses[0].credibility).toBe('SOLID');
  });

  it('claims UNFOUNDED no generan hipótesis', () => {
    const claims = [
      mkClaim({ claimId: 'c1', credibility: 'UNFOUNDED', credibilityScore: 0.1 }),
    ];
    const { hypotheses } = distillHypotheses(claims);
    expect(hypotheses.length).toBe(0);
  });

  it('hipótesis ordenadas SOLID antes que PLAUSIBLE', () => {
    const claims = [
      mkClaim({ claimId: 'c1', dimension: 'pass@1', credibility: 'PLAUSIBLE', credibilityScore: 0.6 }),
      mkClaim({ claimId: 'c2', sourceName: 'X', dimension: 'safety' }),
      mkClaim({ claimId: 'c3', sourceName: 'Y', dimension: 'safety' }), // 2 fuentes → SOLID
    ];
    const { hypotheses } = distillHypotheses(claims);
    expect(hypotheses[0].dimension).toBe('safety');
    expect(hypotheses[0].credibility).toBe('SOLID');
  });
});

// ── 5. Registro de apuestas ──────────────────────────────────────────────────

function mkHypothesis(overrides: Partial<E5Hypothesis> = {}): E5Hypothesis {
  return {
    hypothesisId: 'h_test123',
    title: '[pass@1] mejora notable',
    description: 'Desc',
    dimension: 'pass@1',
    supportingClaims: ['c1'],
    credibility: 'PLAUSIBLE',
    credibilityScore: 0.6,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('E5BetRegistry', () => {
  it('registra una apuesta y la recupera como pendiente', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const bet = reg.register(mkHypothesis());
    expect(bet.betId).toMatch(/^bet_/);
    expect(bet.outcome).toBeNull();
    expect(reg.pending().length).toBe(1);
    expect(reg.resolved().length).toBe(0);
  });

  it('WIN → score +1, calibración sube', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const bet = reg.register(mkHypothesis());
    const resolved = reg.resolve(bet.betId, 'WIN');
    expect(resolved.calibrationScore).toBe(1.0);
    expect(reg.calibrationScore()).toBe(1.0);
    expect(reg.pending().length).toBe(0);
  });

  it('MISS → score -2 (penaliza más que WIN suma)', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const b1 = reg.register(mkHypothesis({ hypothesisId: 'h1' }));
    const b2 = reg.register(mkHypothesis({ hypothesisId: 'h2' }));
    reg.resolve(b1.betId, 'WIN');   // +1
    reg.resolve(b2.betId, 'MISS');  // -2
    expect(reg.calibrationScore()).toBe(-1.0); // 1 + (-2)
  });

  it('PARTIAL → score +0.3', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const bet = reg.register(mkHypothesis());
    const resolved = reg.resolve(bet.betId, 'PARTIAL');
    expect(resolved.calibrationScore).toBeCloseTo(0.3);
  });

  it('resolver dos veces la misma apuesta → error', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const bet = reg.register(mkHypothesis());
    reg.resolve(bet.betId, 'WIN');
    expect(() => reg.resolve(bet.betId, 'MISS')).toThrow(/ya está resuelta/);
  });

  it('persiste entre instancias', () => {
    const path = join(work, 'bets.json');
    const reg1 = new E5BetRegistry(path);
    const bet = reg1.register(mkHypothesis());
    reg1.resolve(bet.betId, 'WIN');

    const reg2 = new E5BetRegistry(path);
    expect(reg2.resolved().length).toBe(1);
    expect(reg2.calibrationScore()).toBe(1.0);
  });
});

// ── 6. Briefing ─────────────────────────────────────────────────────────────

describe('renderBriefing', () => {
  it('incluye hipótesis SOLID y PLAUSIBLE', () => {
    const hypotheses: E5Hypothesis[] = [
      mkHypothesis({ credibility: 'SOLID', title: '[safety] cero breaches', dimension: 'safety' }),
      mkHypothesis({ credibility: 'PLAUSIBLE', title: '[pass@1] mejora', dimension: 'pass@1' }),
    ];
    const md = renderBriefing({ hypotheses, pendingBets: [], resolvedBets: [], calibrationScore: 0 });
    expect(md).toContain('SOLID');
    expect(md).toContain('PLAUSIBLE');
    expect(md).toContain('cero breaches');
    expect(md).toContain('mejora');
  });

  it('sin hipótesis → indica ausencia de señal', () => {
    const md = renderBriefing({ hypotheses: [], pendingBets: [], resolvedBets: [], calibrationScore: 0 });
    expect(md).toMatch(/Sin señal|Sin hipótesis/i);
  });

  it('calibración positiva → buen criterio', () => {
    const reg = new E5BetRegistry(join(work, 'bets.json'));
    const bet = reg.register(mkHypothesis());
    reg.resolve(bet.betId, 'WIN');
    const md = renderBriefing({
      hypotheses: [],
      pendingBets: [],
      resolvedBets: reg.resolved(),
      calibrationScore: reg.calibrationScore(),
    });
    expect(md).toContain('buen criterio');
  });
});

// ── 7. Persistencia E5Store ──────────────────────────────────────────────────

describe('E5Store', () => {
  it('appendClaims evita duplicados', async () => {
    const store = new E5Store(work);
    const claim = (await extractClaims(mkItem()))[0];
    store.appendClaims([claim]);
    const r = store.appendClaims([claim]);
    expect(r.added).toBe(0);
    expect(r.duplicates).toBe(1);
  });

  it('activeClaims filtra por ventana temporal', () => {
    const store = new E5Store(work);
    const now = new Date();
    const active: E5Claim = {
      claimId: 'c_active', text: 'activo', quote: 'q', sourceUrl: 'x', sourceName: 's',
      publishedAt: now.toISOString(), capturedAt: now.toISOString(),
      credibility: 'PLAUSIBLE', credibilityScore: 0.6, dimension: 'pass@1',
      valid_from: new Date(now.getTime() - 1000).toISOString(),
      valid_until: new Date(now.getTime() + 86_400_000).toISOString(),
      sourceItemId: 'i1',
    };
    const expired: E5Claim = {
      ...active, claimId: 'c_exp',
      valid_until: new Date(now.getTime() - 1000).toISOString(),
    };
    store.appendClaims([active, expired]);
    const actives = store.activeClaims();
    expect(actives.some((c) => c.claimId === 'c_active')).toBe(true);
    expect(actives.some((c) => c.claimId === 'c_exp')).toBe(false);
  });

  it('mergeHypotheses actualiza por hypothesisId', () => {
    const store = new E5Store(work);
    const h = mkHypothesis();
    store.mergeHypotheses([h]);
    const updated = { ...h, credibilityScore: 0.9 };
    const r = store.mergeHypotheses([updated]);
    expect(r.updated).toBe(1);
    expect(r.added).toBe(0);
    const loaded = store.loadHypotheses();
    expect(loaded[0].credibilityScore).toBe(0.9);
  });
});
