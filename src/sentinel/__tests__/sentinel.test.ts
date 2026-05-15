import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { parseSourcesYaml, intervalToMs } from '../sources_config.js';
import { SentinelWatcher, parseFeed } from '../watcher.js';
import { SentinelTokenBudget } from '../token_budget.js';
import { indexItem, isSentinelHit, SENTINEL_TAG } from '../indexer.js';
import { ask, deepExtract, listArchived, twoSentenceSummary } from '../query.js';
import { mediate, forwardToCouncil } from '../council.js';
import { collectDigest, renderDigest, shouldSuggestSourceReview } from '../digest.js';
import { InMemoryProvider } from '../../memory/providers/in_memory.js';
import type { SentinelSource, SentinelItem, SentinelProposal } from '../types.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'sentinel-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

// ── sources_config ──
describe('parseSourcesYaml', () => {
  it('parsea 3 fuentes de distinto tipo', () => {
    const yaml = `
sources:
  - type: github_repo
    id: ggml-org/whisper.cpp
    name: whisper releases
    interval: 1w
    whisper_threshold_minutes: 5
  - type: youtube_channel
    id: UCabc123
    name: Canal IA
    interval: 3d
  - type: rss
    id: https://example.com/feed.xml
    name: Blog
    interval: 1d
`;
    const r = parseSourcesYaml(yaml);
    expect(r.errors).toEqual([]);
    expect(r.sources.length).toBe(3);
    expect(r.sources[0].type).toBe('github_repo');
    expect(r.sources[1].interval).toBe('3d');
    expect(r.sources[1].whisper_threshold_minutes).toBe(5); // default
  });

  it('reporta type inválido', () => {
    const r = parseSourcesYaml('sources:\n  - type: ftp\n    id: x\n');
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/type inválido/);
  });

  it('lista vacía con sources: []', () => {
    expect(parseSourcesYaml('sources: []').sources).toEqual([]);
  });

  it('intervalToMs', () => {
    expect(intervalToMs('1d')).toBe(86400000);
    expect(intervalToMs('1w')).toBe(7 * 86400000);
  });
});

// ── watcher: detecta nuevos sin reprocesar ──
describe('SentinelWatcher — detecta items nuevos sin re-procesar', () => {
  const source: SentinelSource = {
    type: 'github_repo', id: 'acme/widget', name: 'Acme Widget',
    interval: '1w', whisper_threshold_minutes: 5,
  };

  function githubFetch(releaseIds: number[]) {
    return async (_url: string) => ({
      ok: true, status: 200,
      text: JSON.stringify(releaseIds.map((id) => ({
        id, tag_name: `v${id}`, name: `Release ${id}`,
        body: `Notas de la release ${id}`, published_at: '2026-05-10T00:00:00Z',
        html_url: `https://github.com/acme/widget/releases/v${id}`,
      }))),
    });
  }

  it('primer check archiva todo; segundo check no re-procesa', async () => {
    const w1 = new SentinelWatcher({ dataDir: work, fetchImpl: githubFetch([1, 2, 3]) });
    const r1 = await w1.checkSource(source);
    expect(r1.newItems.length).toBe(3);
    expect(r1.skipped).toBe(0);

    // Segundo check con los mismos items → 0 nuevos.
    const w2 = new SentinelWatcher({ dataDir: work, fetchImpl: githubFetch([1, 2, 3]) });
    const r2 = await w2.checkSource(source);
    expect(r2.newItems.length).toBe(0);
    expect(r2.skipped).toBe(3);
  });

  it('un item nuevo entre checks se detecta', async () => {
    const w1 = new SentinelWatcher({ dataDir: work, fetchImpl: githubFetch([1, 2]) });
    await w1.checkSource(source);
    const w2 = new SentinelWatcher({ dataDir: work, fetchImpl: githubFetch([1, 2, 3]) });
    const r = await w2.checkSource(source);
    expect(r.newItems.length).toBe(1);
    expect(r.newItems[0].itemId).toBe('3');
  });

  it('archiva a data/raw/<fecha>/<fuente>/<id>.md', async () => {
    const w = new SentinelWatcher({ dataDir: work, fetchImpl: githubFetch([7]) });
    await w.checkSource(source);
    const rawDir = join(work, 'raw');
    expect(existsSync(rawDir)).toBe(true);
    const dates = readdirSync(rawDir);
    expect(dates.length).toBe(1);
  });

  it('error de fetch → result con error, no crash', async () => {
    const w = new SentinelWatcher({
      dataDir: work,
      fetchImpl: async () => ({ ok: false, status: 503, text: '' }),
    });
    const r = await w.checkSource(source);
    expect(r.error).toMatch(/503/);
    expect(r.newItems).toEqual([]);
  });
});

// ── watcher: whisper threshold ──
describe('SentinelWatcher — whisper local solo si duration > threshold', () => {
  it('video largo (> threshold) usa whisper-local', async () => {
    const source: SentinelSource = {
      type: 'youtube_channel', id: 'UCx', name: 'Canal', interval: '1w',
      whisper_threshold_minutes: 5,
    };
    let resolverCalled = false;
    const w = new SentinelWatcher({
      dataDir: work,
      fetchImpl: async () => ({ ok: true, status: 200, text: '<feed></feed>' }),
      transcriptResolver: async () => { resolverCalled = true; return 'transcript whisper'; },
    });
    // Inyectamos un item largo directamente vía el resolver path.
    const longItem: SentinelItem = {
      itemId: 'vid1', sourceId: 'UCx', sourceType: 'youtube_channel', sourceName: 'Canal',
      title: 'Video largo', url: 'https://y/vid1', publishedAt: '2026-05-10T00:00:00Z',
      durationMinutes: 30, rawText: 'desc corta', transcriptSource: 'text',
      archivedAt: new Date().toISOString(),
    };
    const resolved = await (w as any).resolveTranscript(longItem, source);
    expect(resolverCalled).toBe(true);
    expect(resolved.transcriptSource).toBe('whisper-local');
    expect(resolved.rawText).toBe('transcript whisper');
  });

  it('video corto (<= threshold) usa auto-caption, NO whisper', async () => {
    const source: SentinelSource = {
      type: 'youtube_channel', id: 'UCx', name: 'Canal', interval: '1w',
      whisper_threshold_minutes: 5,
    };
    let resolverCalled = false;
    const w = new SentinelWatcher({
      dataDir: work,
      fetchImpl: async () => ({ ok: true, status: 200, text: '' }),
      transcriptResolver: async () => { resolverCalled = true; return 'no debería llamarse'; },
    });
    const shortItem: SentinelItem = {
      itemId: 'vid2', sourceId: 'UCx', sourceType: 'youtube_channel', sourceName: 'Canal',
      title: 'Video corto', url: 'https://y/vid2', publishedAt: '2026-05-10T00:00:00Z',
      durationMinutes: 3, rawText: 'caption', transcriptSource: 'text',
      archivedAt: new Date().toISOString(),
    };
    const resolved = await (w as any).resolveTranscript(shortItem, source);
    expect(resolverCalled).toBe(false);
    expect(resolved.transcriptSource).toBe('auto-caption');
  });
});

describe('parseFeed — RSS/Atom', () => {
  it('parsea items RSS', () => {
    const xml = `<rss><channel>
      <item><title>Post A</title><guid>a1</guid><link>https://x/a</link>
        <description>Contenido A</description><pubDate>Mon, 10 May 2026 00:00:00 GMT</pubDate></item>
      <item><title>Post B</title><guid>b2</guid><link>https://x/b</link>
        <description>Contenido B</description></item>
    </channel></rss>`;
    const src: SentinelSource = { type: 'rss', id: 'https://x/feed', name: 'X', interval: '1w', whisper_threshold_minutes: 5 };
    const items = parseFeed(xml, src, '2026-05-15T00:00:00Z');
    expect(items.length).toBe(2);
    expect(items[0].title).toBe('Post A');
    expect(items[0].itemId).toBe('a1');
  });
});

// ── token budget ──
describe('SentinelTokenBudget — budget cap', () => {
  it('canProceed true por debajo del límite', () => {
    const b = new SentinelTokenBudget({ statePath: join(work, 'b.json'), budget: 1000 });
    expect(b.canProceed()).toBe(true);
    expect(b.remaining()).toBe(1000);
  });

  it('consume reduce el remaining', () => {
    const b = new SentinelTokenBudget({ statePath: join(work, 'b.json'), budget: 1000 });
    b.consume(300);
    expect(b.remaining()).toBe(700);
  });

  it('superar el límite → canProceed false (pausa)', () => {
    const b = new SentinelTokenBudget({ statePath: join(work, 'b.json'), budget: 500 });
    b.consume(400);
    expect(b.canProceed()).toBe(true);
    b.consume(200); // total 600 > 500
    expect(b.canProceed()).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  it('rota la ventana tras 1 semana', () => {
    let now = 1_000_000_000_000;
    const b = new SentinelTokenBudget({ statePath: join(work, 'b.json'), budget: 500, nowFn: () => now });
    b.consume(500);
    expect(b.canProceed()).toBe(false);
    now += 8 * 24 * 60 * 60 * 1000; // +8 días
    expect(b.canProceed()).toBe(true); // ventana nueva
  });

  it('lee SHINOBI_SENTINEL_TOKEN_BUDGET del env', () => {
    process.env.SHINOBI_SENTINEL_TOKEN_BUDGET = '12345';
    const b = new SentinelTokenBudget({ statePath: join(work, 'b.json') });
    expect(b.limit).toBe(12345);
    delete process.env.SHINOBI_SENTINEL_TOKEN_BUDGET;
  });
});

// ── indexer + ask ──
describe('indexer + ask — resultados ordenados por score', () => {
  function mkItem(id: string, title: string, text: string): SentinelItem {
    return {
      itemId: id, sourceId: 'src1', sourceType: 'rss', sourceName: 'Fuente 1',
      title, url: `https://x/${id}`, publishedAt: '2026-05-10T00:00:00Z',
      rawText: text, transcriptSource: 'text', archivedAt: '2026-05-15T00:00:00Z',
    };
  }

  it('indexItem guarda con tag sentinel', async () => {
    const provider = new InMemoryProvider();
    await indexItem(provider, mkItem('i1', 'Loop detection en agentes', 'cómo evitar bucles infinitos'), '/raw/i1.md');
    const hits = await provider.recall('loop detection', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(isSentinelHit(hits[0].message.metadata)).toBe(true);
    expect(hits[0].message.metadata?.tag).toBe(SENTINEL_TAG);
  });

  it('ask devuelve hits ordenados por score descendente', async () => {
    const provider = new InMemoryProvider();
    await indexItem(provider, mkItem('i1', 'Loop detection agentes', 'detectar bucles infinitos en agentes LLM'), '/raw/i1.md');
    await indexItem(provider, mkItem('i2', 'Cocina italiana', 'recetas de pasta y pizza'), '/raw/i2.md');
    await indexItem(provider, mkItem('i3', 'Loop detection avanzada', 'bucles y loop detection semántica'), '/raw/i3.md');
    const hits = await ask(provider, 'loop detection bucles', 8);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // Ordenado: score[0] >= score[1] >= ...
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
    // El top hit debe ser uno de los de loop detection, no la cocina.
    expect(hits[0].title.toLowerCase()).toMatch(/loop/);
  });

  it('ask filtra solo items con tag sentinel', async () => {
    const provider = new InMemoryProvider();
    // Mensaje sin tag sentinel.
    await provider.store({ role: 'user', content: 'loop detection no-sentinel', metadata: {} });
    await indexItem(provider, mkItem('i1', 'Loop detection sentinel', 'bucle'), '/raw/i1.md');
    const hits = await ask(provider, 'loop detection', 8);
    expect(hits.every((h) => h.itemId.length > 0)).toBe(true);
    expect(hits.length).toBe(1); // solo el sentinel
  });

  it('twoSentenceSummary corta a 2 frases', () => {
    const s = twoSentenceSummary('Primera frase. Segunda frase. Tercera frase.');
    expect(s).toContain('Primera');
    expect(s).toContain('Segunda');
    expect(s).not.toContain('Tercera');
  });
});

// ── deepExtract ──
describe('deepExtract', () => {
  function writeRaw(): string {
    const dir = join(work, 'raw', '2026-05-15', 'src1');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'i1.md');
    writeFileSync(p, [
      '---', 'itemId: i1', 'sourceId: src1', 'title: "Nuevo paper sobre loop detection"',
      'url: https://arxiv.org/abs/xxxx', '---', '',
      'Un paper propone detectar bucles con fingerprints de output. Resultados prometedores.',
    ].join('\n'), 'utf-8');
    return p;
  }

  it('sin LLM → extracción heurística degradada', async () => {
    const p = writeRaw();
    const proposal = await deepExtract(p);
    expect(proposal.proposalId).toMatch(/^prop_/);
    expect(proposal.title).toContain('loop detection');
    expect(proposal.risks[0]).toMatch(/sin LLM/);
  });

  it('con LLM → propuesta estructurada del JSON', async () => {
    const p = writeRaw();
    const llm = async () => JSON.stringify({
      title: 'Integrar fingerprint loop detection',
      description: 'Tres frases. De propuesta. Estructurada.',
      shinobiArea: 'src/coordinator/loop_detector.ts',
      effort: 'M',
      risks: ['riesgo A', 'riesgo B'],
    });
    const proposal = await deepExtract(p, llm);
    expect(proposal.title).toBe('Integrar fingerprint loop detection');
    expect(proposal.shinobiArea).toContain('loop_detector');
    expect(proposal.effort).toBe('M');
    expect(proposal.risks.length).toBe(2);
  });

  it('raw inexistente → throw', async () => {
    await expect(deepExtract(join(work, 'no.md'))).rejects.toThrow(/no encontrado/);
  });
});

// ── council ──
describe('council — mediate + forward', () => {
  const proposal: SentinelProposal = {
    proposalId: 'prop_test1', itemId: 'i1', title: 'Mejora X',
    description: 'Una mejora.', shinobiArea: 'src/x', effort: 'M',
    risks: [], sourceLink: 'https://x', createdAt: '2026-05-15T00:00:00Z',
  };

  it('mediate: algún contrario → REJECT', () => {
    const r = mediate([
      { role: 'arquitecto', stance: 'favorable', note: 'ok' },
      { role: 'security_auditor', stance: 'contrario', note: 'riesgo' },
      { role: 'strategic_critic', stance: 'favorable', note: 'ok' },
    ]);
    expect(r.verdict).toBe('REJECT');
  });

  it('mediate: todos favorables → APPROVE', () => {
    const r = mediate([
      { role: 'arquitecto', stance: 'favorable', note: 'ok' },
      { role: 'security_auditor', stance: 'favorable', note: 'ok' },
      { role: 'strategic_critic', stance: 'favorable', note: 'ok' },
    ]);
    expect(r.verdict).toBe('APPROVE');
  });

  it('mediate: mezcla con cauto → RESEARCH_MORE', () => {
    const r = mediate([
      { role: 'arquitecto', stance: 'favorable', note: 'ok' },
      { role: 'security_auditor', stance: 'cauto', note: 'dudas' },
      { role: 'strategic_critic', stance: 'favorable', note: 'ok' },
    ]);
    expect(r.verdict).toBe('RESEARCH_MORE');
  });

  it('forwardToCouncil pasa al committee y registra decisión en disco', async () => {
    const decisionsDir = join(work, 'decisions');
    const llm = async (system: string) => {
      // Cada rol responde favorable.
      return JSON.stringify({ stance: 'favorable', note: `${system.slice(0, 10)} ok` });
    };
    const decision = await forwardToCouncil(proposal, { decisionsDir, llm });
    expect(decision.verdict).toBe('APPROVE');
    expect(Object.keys(decision.roleNotes)).toEqual(['arquitecto', 'security_auditor', 'strategic_critic']);
    // Doc escrito.
    const files = readdirSync(decisionsDir);
    expect(files.length).toBe(1);
    const doc = readFileSync(join(decisionsDir, files[0]), 'utf-8');
    expect(doc).toContain('APPROVE');
    expect(doc).toContain('NO implementa propuestas automáticamente');
  });

  it('forwardToCouncil con un rol contrario → REJECT registrado', async () => {
    const decisionsDir = join(work, 'decisions');
    const llm = async (system: string) => {
      const stance = system.includes('seguridad') ? 'contrario' : 'favorable';
      return JSON.stringify({ stance, note: 'nota' });
    };
    const decision = await forwardToCouncil(proposal, { decisionsDir, llm });
    expect(decision.verdict).toBe('REJECT');
  });
});

// ── digest ──
describe('digest', () => {
  it('digest sin items → señal baja explícita', () => {
    const data = collectDigest({
      rawDir: join(work, 'raw'), decisionsDir: join(work, 'decisions'),
      activeSources: 2, window: 'week',
    });
    expect(data.lowSignal).toBe(true);
    const md = renderDigest(data);
    expect(md).toMatch(/Señal baja/);
  });

  it('digest sin fuentes → avisa de sources.yaml vacío', () => {
    const data = collectDigest({
      rawDir: join(work, 'raw'), decisionsDir: join(work, 'decisions'),
      activeSources: 0, window: 'week',
    });
    const md = renderDigest(data);
    expect(md).toMatch(/sources\.yaml/);
  });

  it('shouldSuggestSourceReview: 3 lowSignal seguidos → true', () => {
    expect(shouldSuggestSourceReview([false, true, true, true])).toBe(true);
    expect(shouldSuggestSourceReview([true, true, false])).toBe(false);
    expect(shouldSuggestSourceReview([true, true])).toBe(false);
  });
});
