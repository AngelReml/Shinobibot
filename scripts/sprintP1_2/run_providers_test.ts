#!/usr/bin/env node
/**
 * Prueba funcional Sprint P1.2 — Memory provider plugin system.
 *
 * Demuestra:
 *   1. InMemoryProvider real (store/recall/forget/consolidate)
 *   2. Mem0Provider con fetch mockeado (sin tocar mem0.ai)
 *   3. SupermemoryProvider con fetch mockeado
 *   4. Registry con switch por env var
 *   5. Aislamiento entre providers (mismo dato en in_memory vs mem0)
 */

import { InMemoryProvider } from '../../src/memory/providers/in_memory.js';
import { Mem0Provider } from '../../src/memory/providers/mem0_provider.js';
import { SupermemoryProvider } from '../../src/memory/providers/supermemory_provider.js';
import { MemoryProviderRegistry } from '../../src/memory/provider_registry.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

function mockFetch(impl: (url: string, init?: any) => { status: number; body: any }) {
  return async (url: string, init?: any) => {
    const { status, body } = impl(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

async function main(): Promise<void> {
  console.log('=== Sprint P1.2 — Memory provider plugin system ===');

  // ── 1. InMemoryProvider real ──
  console.log('\n--- 1. InMemoryProvider real ---');
  const im = new InMemoryProvider();
  await im.init();
  const id1 = await im.store({ role: 'user', content: 'me gusta el café por la mañana' });
  await im.store({ role: 'user', content: 'la lluvia me relaja' });
  await im.store({ role: 'assistant', content: 'apuntado: café mañanero' });
  check(typeof id1 === 'string' && id1.length > 0, 'store devuelve id');

  const hits = await im.recall('café mañana', 3);
  check(hits.length > 0, `recall encontró ${hits.length} hits`);
  check(hits[0].message.content.includes('café'), 'top hit menciona café');
  check(hits[0].score > 0, `top score=${hits[0].score.toFixed(2)}`);

  const dropped = await im.forget(id1);
  check(dropped === true, 'forget OK');
  const m = await im.metrics();
  check(m.count === 2, `metrics.count=2 tras forget`);

  // ── 2. Mem0Provider con fetch mock ──
  console.log('\n--- 2. Mem0Provider (mock HTTP, no toca mem0.ai) ---');
  let storeCalled = 0;
  let searchCalled = 0;
  const mem0 = new Mem0Provider({
    apiKey: 'fake_token_for_test',
    fetchImpl: mockFetch((url) => {
      if (url.includes('/search')) {
        searchCalled++;
        return {
          status: 200,
          body: { results: [
            { id: 'mem0_x', memory: 'mock recuerdo', score: 0.91, created_at: '2026-05-15T00:00:00Z' },
          ] },
        };
      }
      if (url.endsWith('/v1/memories/')) {
        storeCalled++;
        return { status: 200, body: { results: [{ id: `mem0_${storeCalled}` }] } };
      }
      return { status: 200, body: {} };
    }),
  });
  await mem0.init();
  await mem0.store({ role: 'user', content: 'evento de prueba' });
  const mem0Hits = await mem0.recall('prueba');
  check(storeCalled === 1, 'mem0 store llamado');
  check(searchCalled === 1, 'mem0 search llamado');
  check(mem0Hits[0]?.message.content === 'mock recuerdo', 'mem0 parsea response');
  check(mem0Hits[0]?.matchType === 'vector', 'mem0 matchType=vector');

  // ── 3. SupermemoryProvider con fetch mock ──
  console.log('\n--- 3. SupermemoryProvider (mock HTTP) ---');
  const sm = new SupermemoryProvider({
    apiKey: 'sm_token',
    fetchImpl: mockFetch((url) => {
      if (url.endsWith('/v1/memories')) return { status: 200, body: { id: 'sm_42' } };
      if (url.endsWith('/v1/search')) {
        return {
          status: 200,
          body: [{ id: 'sm_42', content: 'cosa', score: 0.77, metadata: { role: 'assistant', ts: '2026-05-15T00:00:00Z' } }],
        };
      }
      return { status: 404, body: {} };
    }),
  });
  await sm.init();
  const smId = await sm.store({ role: 'assistant', content: 'cosa' });
  check(smId === 'sm_42', 'sm store devuelve id');
  const smHits = await sm.recall('cosa');
  check(smHits[0]?.message.role === 'assistant', 'sm respeta role metadata');

  // ── 4. Registry switch por env ──
  console.log('\n--- 4. Registry switch por env ---');
  process.env.SHINOBI_MEMORY_PROVIDER = 'in_memory';
  const reg1 = new MemoryProviderRegistry();
  const p1 = await reg1.getProvider();
  check(p1.id === 'in_memory', `registry → ${p1.id}`);

  delete process.env.SHINOBI_MEMORY_PROVIDER;
  const reg2 = new MemoryProviderRegistry({ providerId: 'in_memory' });
  const p2 = await reg2.getProvider();
  check(p2.id === 'in_memory', 'registry override por constructor');

  const reg3 = new MemoryProviderRegistry({ providerId: 'mem0' });
  try {
    await reg3.getProvider();
    check(false, 'mem0 sin key debería throw en init');
  } catch (e: any) {
    check(/MEM0_API_KEY/.test(e.message), 'mem0 fail-fast claro');
  }

  // ── 5. Aislamiento ──
  console.log('\n--- 5. Aislamiento entre providers ---');
  const isoA = new InMemoryProvider();
  const isoB = new InMemoryProvider();
  await isoA.store({ role: 'user', content: 'solo A' });
  const aHits = await isoA.recall('solo');
  const bHits = await isoB.recall('solo');
  check(aHits.length === 1 && bHits.length === 0, 'providers aislados');

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · 3 providers + registry + aislamiento integrados');
}

main().catch((e) => {
  console.error('Sprint P1.2 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
