#!/usr/bin/env node
/**
 * Prueba funcional Sprint P1.5 — Skill marketplace federado.
 *
 * Demuestra el flujo completo con fetchImpl mockeados de
 * agentskills.io y clawhub (no toca internet):
 *   1. search() federada que mergea + dedupe.
 *   2. fetch() por prioridad: local → agentskills → clawhub.
 *   3. Skill no encontrada en ninguna → SkillNotFoundError.
 *   4. Si una fuente cae (500), la otra sigue.
 */

import { AgentSkillsSource } from '../../src/skills/sources/agentskills_io.js';
import { ClawHubSource } from '../../src/skills/sources/clawhub.js';
import { FederatedSkillRegistry } from '../../src/skills/sources/federated_registry.js';
import { SkillNotFoundError } from '../../src/skills/sources/types.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

function mockFetch(impl: (url: string) => { status: number; body: any }) {
  return (async (url: string) => {
    const { status, body } = impl(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as any;
}

async function main(): Promise<void> {
  console.log('=== Sprint P1.5 — Skill marketplace federado (Opción A) ===');

  // ── 1. AgentSkills + ClawHub con mock data ──
  const agentskills = new AgentSkillsSource({
    fetchImpl: mockFetch((url) => {
      if (url.includes('/skills?q=')) {
        return {
          status: 200,
          body: { results: [
            { name: 'fmt-json', version: '1.0.0', description: 'Format JSON' },
            { name: 'http-cat', version: '0.5.0', description: 'HTTP cat emoji' },
          ]},
        };
      }
      if (url.endsWith('/skills/fmt-json')) {
        return { status: 200, body: { name: 'fmt-json', version: '1.0.0', body: 'BODY-AGENTSKILLS', sha256: 'a1' } };
      }
      return { status: 404, body: {} };
    }),
  });

  const clawhub = new ClawHubSource({
    fetchImpl: mockFetch((url) => {
      if (url.includes('/v1/skills/search')) {
        return {
          status: 200,
          body: { items: [
            { slug: 'fmt-json', version: '2.0.0', description: 'Format JSON (clawhub)' },
            { slug: 'log-tail', version: '1.0.0', description: 'Tail logs' },
          ]},
        };
      }
      if (url.includes('/v1/skills/log-tail')) {
        return { status: 200, body: { name: 'log-tail', version: '1.0.0', body: 'BODY-CLAWHUB' } };
      }
      return { status: 404, body: {} };
    }),
  });

  const registry = new FederatedSkillRegistry({ sources: [agentskills, clawhub] });

  console.log('\n--- 1. active() ordena por priority ---');
  const active = registry.active();
  check(active[0].id === 'agentskills.io' && active[0].priority === 10, 'agentskills primero');
  check(active[1].id === 'clawhub' && active[1].priority === 20, 'clawhub segundo');

  console.log('\n--- 2. search() federada ---');
  const results = await registry.search('json');
  console.log(`  resultados: ${results.length}`);
  for (const r of results) console.log(`    ${r.name} (${r.source})`);
  check(results.length === 3, 'mergea 3 únicas (fmt-json, http-cat, log-tail)');
  const fmt = results.find(r => r.name === 'fmt-json');
  check(fmt?.source === 'agentskills.io', 'fmt-json gana agentskills (mayor prioridad)');

  console.log('\n--- 3. fetch() por prioridad ---');
  const fmtBundle = await registry.fetch('fmt-json');
  check(fmtBundle.source === 'agentskills.io', 'fmt-json viene de agentskills');
  check(fmtBundle.body === 'BODY-AGENTSKILLS', 'body correcto');

  const tailBundle = await registry.fetch('log-tail');
  check(tailBundle.source === 'clawhub', 'log-tail solo en clawhub → fallback OK');
  check(tailBundle.body === 'BODY-CLAWHUB', 'body de clawhub');

  console.log('\n--- 4. Skill inexistente ---');
  try {
    await registry.fetch('inexistente-asdf');
    check(false, 'debería lanzar');
  } catch (e) {
    check(e instanceof SkillNotFoundError, 'SkillNotFoundError');
  }

  // ── 5. Resiliencia: una fuente cae, la otra sigue ──
  console.log('\n--- 5. Resiliencia con fuente caída ---');
  const broken = new AgentSkillsSource({
    fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as any,
  });
  const registry2 = new FederatedSkillRegistry({ sources: [broken, clawhub] });
  const resilient = await registry2.search('log');
  check(resilient.length >= 1, 'search devuelve resultados a pesar de fuente caída');
  const logBundle = await registry2.fetch('log-tail');
  check(logBundle.source === 'clawhub', 'fetch tras agentskills caído sigue funcionando');

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · registry federado funcional con 2 marketplaces externos');
}

main().catch((e) => {
  console.error('Sprint P1.5 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
