// B.2 unit test — Committee with stub LLM.
// Run: npx tsx src/committee/__tests__/committee.test.ts
import { Committee, DEFAULT_ROLES } from '../Committee.js';
import type { LLMClient } from '../../reader/SubAgent.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

function makeStubLLM(opts: { failOneMember?: boolean } = {}): LLMClient {
  let memberCalls = 0;
  return {
    async chat(messages, callOpts) {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      const isSynth = sys.includes('synthesizing committee member reports');
      if (isSynth) {
        return JSON.stringify({
          consensus: [
            { topic: 'tests are insufficient', agreeing_roles: ['architect', 'design_critic'] },
          ],
          dissents: [
            {
              topic: 'severity of dependency risk',
              positions: [
                { role: 'security_auditor', position: 'high — too many transitive deps' },
                { role: 'architect', position: 'medium — vetted core deps' },
              ],
            },
          ],
          combined_recommendations: [
            'Add unit tests for core orchestrator',
            'Audit and pin transitive dependencies',
            'Document threat model for tool execution',
          ],
          overall_risk: 'medium',
        });
      }
      memberCalls++;
      if (opts.failOneMember && memberCalls === 1) {
        return 'not json {{{';
      }
      const role = (callOpts?.model === 'claude-opus-4-7') ? 'architect' : (memberCalls % 2 === 0 ? 'security_auditor' : 'design_critic');
      return JSON.stringify({
        role,
        strengths: ['clear separation', 'security gate present'],
        weaknesses: ['no tests in core path', 'docs out of sync'],
        recommendations: ['add tests', 'sync docs'],
        risk_level: 'medium',
      });
    },
  };
}

async function main() {
  console.log('B.2 — Committee.review (stub LLM)');
  const c = new Committee({ llm: makeStubLLM(), roles: DEFAULT_ROLES });
  const r = await c.review(JSON.stringify({ repo_purpose: 'x' }));
  t('3 members produced', r.members.length === 3);
  t('all members valid', r.members.every((m: any) => !('error' in m)));
  t('synthesis ok', !('error' in r.synthesis));
  if (!('error' in r.synthesis)) {
    t('at least 1 dissent present', r.synthesis.dissents.length >= 1);
    t('combined_recommendations non-empty', r.synthesis.combined_recommendations.length > 0);
    t('overall_risk valid', ['low', 'medium', 'high'].includes(r.synthesis.overall_risk));
  }

  console.log('\nB.2 — retry on invalid first member response');
  const c2 = new Committee({ llm: makeStubLLM({ failOneMember: true }), roles: DEFAULT_ROLES });
  const r2 = await c2.review(JSON.stringify({ repo_purpose: 'x' }));
  t('synthesis still ok after one retry', !('error' in r2.synthesis));

  console.log('');
  console.log(`Total: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
