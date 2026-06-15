/**
 * S-15 — EL PROMPT WOW (§16) scaffold: "aprende el programa en tu jaula". Ejecutor de
 * jaula faked; el operador lo cambia por el backend real. Demuestra: no toca destructivo
 * con datos reales, no dispara external_effect, y solo certifica lo que respeta su contrato.
 */
import { describe, it, expect } from 'vitest';
import { runForgeDemo } from '../demo.js';
import type { AppCard } from '../../chizu/types.js';
import type { Capability } from '../types.js';
import type { CageExecutor } from '../sandbox/revertible.js';

function mkCard(over: Partial<AppCard>): AppCard {
  return {
    app_id: 'id', display_name: 'X', install_type: 'portable', discovered_by: [],
    usage: { usage_score: 0.8, signal_sources: [] },
    characterization: { cli: { available: true, evidence: 'known_db' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: true, needs_install: false, needs_network: false, needs_login: false, verdict: 'easy' } },
    category: 'utility', risk: { level: 'safe', reasons: [], becomes_protected_resource: false },
    automation_candidate_score: 0.9, provenance: { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: 't', trust_tier: 2, session_seq: 0 }, mapped_at: 't',
    ...over,
  } as AppCard;
}

const cap: Capability = { capability_id: 'tool.count', description: 'count', procedure: [], preconditions: [], success_check: 'stdout has COUNT', effects: ['read_only'], grade: 'strong' };

describe('shugyo — S-15 PROMPT WOW (aprende el programa)', () => {
  it('certifica una skill read_only que pasa el oráculo y la publica a Kagami', async () => {
    const exec: CageExecutor = async () => ({ success: true, stdout: 'COUNT=7', stderr: '' });   // read-only, no escribe
    const r = await runForgeDemo(
      [mkCard({ app_id: 'tool', display_name: 'CountTool' })],
      cap,
      { command: 'tool count', declared_tools: ['run_command'], declared_effects: 'read_only' },
      [{ case_id: 'c1', seed: {}, command: 'tool count', expected_stdout: 'COUNT=7' }],
      exec,
      ['open file', 'delete all', 'send report'],   // affordances sondeadas
    );
    expect(r.certified).toBe(true);
    expect(r.cell?.verdict).toBe('RELIABLE');
    expect(r.narration).toMatch(/external_effect: DOCUMENTADO, no disparado/);   // "send report"
    expect(r.narration).toMatch(/destructive: solo en jaula/);                   // "delete all"
    expect(r.narration).toMatch(/CERTIFICADO|CERTIFIED/i);
  });

  it('NO certifica si se sale de sus efectos declarados (read_only que escribe)', async () => {
    const writes: CageExecutor = async (_c, cwd) => { const fs = await import('node:fs'); const p = await import('node:path'); fs.writeFileSync(p.join(cwd, 'leak.txt'), 'x'); return { success: true, stdout: 'COUNT=7', stderr: '' }; };
    const r = await runForgeDemo(
      [mkCard({ app_id: 'tool', display_name: 'CountTool' })],
      cap,
      { command: 'tool count', declared_tools: ['run_command'], declared_effects: 'read_only' },
      [{ case_id: 'c1', seed: {}, command: 'tool count', expected_stdout: 'COUNT=7' }],
      writes,
    );
    expect(r.certified).toBe(false);
    expect(r.cell).toBeNull();
  });
});
