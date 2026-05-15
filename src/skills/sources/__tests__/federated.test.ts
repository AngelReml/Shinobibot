import { describe, it, expect } from 'vitest';
import { AgentSkillsSource } from '../agentskills_io.js';
import { ClawHubSource } from '../clawhub.js';
import { FederatedSkillRegistry } from '../federated_registry.js';
import { SkillNotFoundError, type SkillSource } from '../types.js';

function mockFetch(impl: (url: string, init?: any) => { status: number; body: any }) {
  return async (url: string, init?: any) => {
    const { status, body } = impl(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

describe('AgentSkillsSource', () => {
  it('id + priority correctos', () => {
    const s = new AgentSkillsSource();
    expect(s.id).toBe('agentskills.io');
    expect(s.priority).toBe(10);
    expect(s.isConfigured()).toBe(true);
  });

  it('search parsea results array', async () => {
    const s = new AgentSkillsSource({
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: { results: [
          { name: 'fmt-json', version: '1.0.0', description: 'Format JSON', author: 'alice' },
          { name: 'curl-wrap', version: '0.2.0', description: 'curl wrapper', sha256: 'abc' },
        ]},
      })) as any,
    });
    const r = await s.search('json');
    expect(r.length).toBe(2);
    expect(r[0].name).toBe('fmt-json');
    expect(r[0].source).toBe('agentskills.io');
    expect(r[1].contentHash).toBe('abc');
  });

  it('search 500 → array vacío (no throw)', async () => {
    const s = new AgentSkillsSource({
      fetchImpl: mockFetch(() => ({ status: 500, body: {} })) as any,
    });
    const r = await s.search('x');
    expect(r).toEqual([]);
  });

  it('fetch devuelve bundle con body', async () => {
    const s = new AgentSkillsSource({
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: { name: 'fmt-json', version: '1.0.0', body: 'BODY HERE', sha256: 'h1' },
      })) as any,
    });
    const b = await s.fetch('fmt-json');
    expect(b.manifest.name).toBe('fmt-json');
    expect(b.body).toBe('BODY HERE');
    expect(b.declaredHash).toBe('h1');
  });

  it('fetch 404 → SkillNotFoundError', async () => {
    const s = new AgentSkillsSource({
      fetchImpl: mockFetch(() => ({ status: 404, body: {} })) as any,
    });
    await expect(s.fetch('nope')).rejects.toThrow(SkillNotFoundError);
  });

  it('fetch sin body en respuesta → throw', async () => {
    const s = new AgentSkillsSource({
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: { name: 'x', version: '1' }, // sin body
      })) as any,
    });
    await expect(s.fetch('x')).rejects.toThrow(/malformada/);
  });
});

describe('ClawHubSource', () => {
  it('priority 20 (después de agentskills)', () => {
    expect(new ClawHubSource().priority).toBe(20);
  });

  it('search usa x-api-key cuando hay key', async () => {
    let captured: any = null;
    const s = new ClawHubSource({
      apiKey: 'ch_secret',
      fetchImpl: mockFetch((url, init) => {
        captured = init;
        return { status: 200, body: { items: [] } };
      }) as any,
    });
    await s.search('x');
    expect(captured.headers['x-api-key']).toBe('ch_secret');
  });

  it('fetch latest sin version', async () => {
    let calledUrl = '';
    const s = new ClawHubSource({
      fetchImpl: mockFetch((url) => {
        calledUrl = url;
        return { status: 200, body: { name: 'x', version: '2.1', body: 'B' } };
      }) as any,
    });
    await s.fetch('x');
    expect(calledUrl).toContain('/latest');
  });

  it('fetch con version concreta', async () => {
    let calledUrl = '';
    const s = new ClawHubSource({
      fetchImpl: mockFetch((url) => {
        calledUrl = url;
        return { status: 200, body: { name: 'x', version: '1.0', body: 'B' } };
      }) as any,
    });
    await s.fetch('x', '1.0');
    expect(calledUrl).toContain('/1.0');
  });
});

describe('FederatedSkillRegistry', () => {
  function mockSource(id: string, priority: number, db: Record<string, any>): SkillSource {
    return {
      id,
      priority,
      isConfigured: () => true,
      async search(q: string) {
        return Object.values(db).filter((s: any) => s.name.includes(q)).map((s: any) => ({
          ...s, source: id,
        }));
      },
      async fetch(name: string) {
        const e = db[name];
        if (!e) throw new SkillNotFoundError(name, id);
        return { manifest: { name: e.name, version: e.version }, body: `body-from-${id}` };
      },
    };
  }

  it('ordena fuentes por priority asc', () => {
    const reg = new FederatedSkillRegistry({
      sources: [
        mockSource('clawhub', 20, {}),
        mockSource('local', 0, {}),
        mockSource('agentskills', 10, {}),
      ],
    });
    const ids = reg.active().map(a => a.id);
    expect(ids).toEqual(['local', 'agentskills', 'clawhub']);
  });

  it('search mergea fuentes y dedupe por nombre (gana mayor prioridad)', async () => {
    const reg = new FederatedSkillRegistry({
      sources: [
        mockSource('local', 0, { 'fmt-json': { name: 'fmt-json', version: '1.0', description: 'LOCAL' } }),
        mockSource('agentskills', 10, { 'fmt-json': { name: 'fmt-json', version: '2.0', description: 'REMOTE' } }),
      ],
    });
    const r = await reg.search('fmt');
    expect(r.length).toBe(1);
    expect(r[0].description).toBe('LOCAL'); // local gana
  });

  it('search agrega skills exclusivas de cada fuente', async () => {
    const reg = new FederatedSkillRegistry({
      sources: [
        mockSource('local', 0, { 'a': { name: 'a', version: '1' } }),
        mockSource('clawhub', 20, { 'b': { name: 'b', version: '1' } }),
      ],
    });
    const r = await reg.search('');
    expect(r.length).toBe(2);
  });

  it('fetch prueba en orden y devuelve la primera que tiene', async () => {
    const reg = new FederatedSkillRegistry({
      sources: [
        mockSource('local', 0, {}), // no la tiene
        mockSource('agentskills', 10, { 'x': { name: 'x', version: '1' } }),
        mockSource('clawhub', 20, { 'x': { name: 'x', version: '99' } }),
      ],
    });
    const b = await reg.fetch('x');
    expect(b.source).toBe('agentskills');
    expect(b.body).toBe('body-from-agentskills');
  });

  it('fetch ninguna fuente la tiene → SkillNotFoundError', async () => {
    const reg = new FederatedSkillRegistry({
      sources: [mockSource('local', 0, {}), mockSource('clawhub', 20, {})],
    });
    await expect(reg.fetch('inexistente')).rejects.toThrow(SkillNotFoundError);
  });

  it('una fuente lanza error random → continúa con la siguiente', async () => {
    const broken: SkillSource = {
      id: 'broken', priority: 5, isConfigured: () => true,
      async search() { throw new Error('500'); },
      async fetch() { throw new Error('500'); },
    };
    const reg = new FederatedSkillRegistry({
      sources: [broken, mockSource('clawhub', 20, { 'x': { name: 'x', version: '1' } })],
    });
    const b = await reg.fetch('x');
    expect(b.source).toBe('clawhub');
    const s = await reg.search('x');
    expect(s.length).toBe(1);
  });

  it('skipea fuentes no configuradas', async () => {
    const off: SkillSource = {
      id: 'off', priority: 0, isConfigured: () => false,
      async search() { throw new Error('should not be called'); },
      async fetch() { throw new Error('should not be called'); },
    };
    const reg = new FederatedSkillRegistry({
      sources: [off, mockSource('clawhub', 20, { 'x': { name: 'x', version: '1' } })],
    });
    const b = await reg.fetch('x');
    expect(b.source).toBe('clawhub');
  });
});
