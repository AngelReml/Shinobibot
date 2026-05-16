import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryProvider } from '../providers/in_memory.js';
import { Mem0Provider } from '../providers/mem0_provider.js';
import { SupermemoryProvider } from '../providers/supermemory_provider.js';
import {
  MemoryProviderRegistry, memoryProviderRegistry, _resetMemoryProviderRegistry,
} from '../provider_registry.js';

const ENV = ['SHINOBI_MEMORY_PROVIDER', 'MEM0_API_KEY', 'SUPERMEMORY_API_KEY', 'MEM0_BASE_URL', 'SUPERMEMORY_BASE_URL'];

beforeEach(() => { for (const k of ENV) delete process.env[k]; _resetMemoryProviderRegistry(); });
afterEach(() => { for (const k of ENV) delete process.env[k]; _resetMemoryProviderRegistry(); });

// ── InMemoryProvider ──
describe('InMemoryProvider', () => {
  it('store + recall por jaccard text', async () => {
    const p = new InMemoryProvider();
    await p.init();
    await p.store({ role: 'user', content: 'me gusta el café por la mañana' });
    await p.store({ role: 'user', content: 'la lluvia me relaja' });
    const hits = await p.recall('café mañana', 5);
    expect(hits[0].message.content).toContain('café');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].matchType).toBe('text');
  });

  it('store devuelve id', async () => {
    const p = new InMemoryProvider();
    const id = await p.store({ role: 'user', content: 'x' });
    expect(id).toMatch(/^m_/);
  });

  it('forget elimina', async () => {
    const p = new InMemoryProvider();
    const id = await p.store({ role: 'user', content: 'temporal' });
    expect(await p.forget(id)).toBe(true);
    expect(await p.forget(id)).toBe(false); // ya no existe
  });

  it('consolidate elimina duplicados exactos', async () => {
    const p = new InMemoryProvider();
    await p.store({ role: 'user', content: 'mismo', ts: '2020-01-01T00:00:00Z' });
    await p.store({ role: 'user', content: 'mismo', ts: '2025-01-01T00:00:00Z' });
    await p.store({ role: 'user', content: 'distinto' });
    const r = await p.consolidate();
    expect(r.removed).toBe(1);
    const all = await p.recall('mismo', 10);
    const conMismo = all.filter(h => h.message.content === 'mismo');
    expect(conMismo.length).toBe(1);
    expect(conMismo[0].message.ts).toBe('2025-01-01T00:00:00Z');
  });

  it('metrics expone count + healthy', async () => {
    const p = new InMemoryProvider();
    await p.store({ role: 'user', content: 'a' });
    await p.store({ role: 'user', content: 'b' });
    const m = await p.metrics();
    expect(m.count).toBe(2);
    expect(m.healthy).toBe(true);
    expect(m.bytes).toBeGreaterThan(0);
  });

  it('shutdown vacía', async () => {
    const p = new InMemoryProvider();
    await p.store({ role: 'user', content: 'x' });
    await p.shutdown();
    expect((await p.metrics()).count).toBe(0);
  });
});

// ── Mem0Provider con fetchImpl mock ──
function mockFetch(impl: (url: string, init?: any) => { status: number; body: any }) {
  return async (url: string, init?: any) => {
    const { status, body } = impl(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

describe('Mem0Provider', () => {
  it('init falla sin API key', async () => {
    const p = new Mem0Provider({ apiKey: '' });
    await expect(p.init()).rejects.toThrow(/MEM0_API_KEY/);
  });

  it('store envía POST con bearer', async () => {
    let captured: any = null;
    const p = new Mem0Provider({
      apiKey: 'tok',
      fetchImpl: mockFetch((url, init) => {
        captured = { url, init };
        return { status: 200, body: { results: [{ id: 'mem0_abc' }] } };
      }),
    });
    const id = await p.store({ role: 'user', content: 'hola' });
    expect(id).toBe('mem0_abc');
    expect(captured.url).toContain('/v1/memories');
    expect(captured.init.method).toBe('POST');
    expect(captured.init.headers.authorization).toBe('Token tok');
  });

  it('recall parsea results array', async () => {
    const p = new Mem0Provider({
      apiKey: 'tok',
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: { results: [{ id: 'a', memory: 'hola mundo', score: 0.95, created_at: '2026-05-15T00:00:00Z' }] },
      })),
    });
    const hits = await p.recall('hola', 5);
    expect(hits.length).toBe(1);
    expect(hits[0].message.content).toBe('hola mundo');
    expect(hits[0].score).toBe(0.95);
    expect(hits[0].matchType).toBe('vector');
  });

  it('HTTP 500 incrementa errors', async () => {
    const p = new Mem0Provider({
      apiKey: 'tok',
      fetchImpl: mockFetch(() => ({ status: 500, body: {} })),
    });
    await expect(p.recall('x')).rejects.toThrow(/HTTP 500/);
    const m = await p.metrics();
    expect(m.errors).toBeGreaterThan(0);
  });

  it('forget DELETE', async () => {
    let captured: any = null;
    const p = new Mem0Provider({
      apiKey: 'tok',
      fetchImpl: mockFetch((url, init) => { captured = { url, init }; return { status: 200, body: {} }; }),
    });
    const ok = await p.forget('xyz');
    expect(ok).toBe(true);
    expect(captured.init.method).toBe('DELETE');
    expect(captured.url).toContain('/xyz/');
  });
});

// ── SupermemoryProvider ──
describe('SupermemoryProvider', () => {
  it('init falla sin API key', async () => {
    const p = new SupermemoryProvider({ apiKey: '' });
    await expect(p.init()).rejects.toThrow(/SUPERMEMORY_API_KEY/);
  });

  it('store usa Bearer scheme', async () => {
    let captured: any = null;
    const p = new SupermemoryProvider({
      apiKey: 'sm',
      fetchImpl: mockFetch((url, init) => { captured = init; return { status: 200, body: { id: 'sm_1' } }; }),
    });
    const id = await p.store({ role: 'user', content: 'x' });
    expect(id).toBe('sm_1');
    expect(captured.headers.authorization).toBe('Bearer sm');
  });

  it('recall maneja array plano', async () => {
    const p = new SupermemoryProvider({
      apiKey: 'sm',
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: [{ id: 'a', content: 'algo', score: 0.7, metadata: { role: 'user' } }],
      })),
    });
    const hits = await p.recall('algo');
    expect(hits[0].message.role).toBe('user');
  });
});

// ── Registry ──
describe('MemoryProviderRegistry', () => {
  it('default → local usa LocalJsonProvider persistente si no hay factory', async () => {
    // Fix C6: antes degradaba en silencio a in_memory (volátil). Ahora el
    // default 'local' es LocalJsonProvider, persistente a disco.
    const r = new MemoryProviderRegistry();
    expect(r.activeId).toBe('local');
    const p = await r.getProvider();
    expect(p.id).toBe('local');
    expect(p.label.toLowerCase()).toContain('persist');
  });

  it('env SHINOBI_MEMORY_PROVIDER=in_memory', async () => {
    process.env.SHINOBI_MEMORY_PROVIDER = 'in_memory';
    const r = new MemoryProviderRegistry();
    expect(r.activeId).toBe('in_memory');
    expect((await r.getProvider()).id).toBe('in_memory');
  });

  it('env mem0 instancia Mem0Provider y falla init sin key', async () => {
    process.env.SHINOBI_MEMORY_PROVIDER = 'mem0';
    const r = new MemoryProviderRegistry();
    await expect(r.getProvider()).rejects.toThrow(/MEM0_API_KEY/);
  });

  it('id desconocido → fallback local', () => {
    process.env.SHINOBI_MEMORY_PROVIDER = 'noexiste' as any;
    const r = new MemoryProviderRegistry();
    expect(r.activeId).toBe('local');
  });

  it('localFactory custom', async () => {
    const r = new MemoryProviderRegistry({
      providerId: 'local',
      localFactory: () => new InMemoryProvider(),
    });
    const p = await r.getProvider();
    expect(p.id).toBe('in_memory');
  });

  it('getProvider cachea', async () => {
    const r = new MemoryProviderRegistry({ providerId: 'in_memory' });
    const p1 = await r.getProvider();
    const p2 = await r.getProvider();
    expect(p1).toBe(p2);
  });

  it('singleton', () => {
    const a = memoryProviderRegistry();
    const b = memoryProviderRegistry();
    expect(a).toBe(b);
  });
});
