// F1 — majority voting test with stub LLM. Verifies: 3 runs, vote, confidence.
import { Committee, DEFAULT_ROLES } from '../Committee.js';
import type { LLMClient } from '../../reader/SubAgent.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

function makeStubLLM(verdictsByRun: ('low'|'medium'|'high')[]): LLMClient {
  let synthCallIdx = 0;
  return {
    async chat(messages, opts) {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      const userMsg = messages.find((m) => m.role === 'user')?.content ?? '';
      const isSynth = userMsg.startsWith('Member reports') || sys.includes('committee member reports') || sys.includes('chair of a software-audit committee');
      if (isSynth) {
        const v = verdictsByRun[synthCallIdx++ % verdictsByRun.length];
        return JSON.stringify({
          consensus: [{ topic: 'tests gap', agreeing_roles: ['architect', 'design_critic'] }],
          dissents: [{ topic: 'risk severity', positions: [
            { role: 'architect', position: 'medium' },
            { role: 'security_auditor', position: 'high' },
          ]}],
          combined_recommendations: ['Add tests', 'Audit deps'],
          overall_risk: v,
        });
      }
      // Member call
      return JSON.stringify({
        role: 'architect',
        strengths: ['s'],
        weaknesses: ['w'],
        recommendations: ['r'],
        risk_level: 'medium',
      });
    },
  };
}

async function main() {
  console.log('F1 — majority voting');

  // Case 1: unanimous high (3 runs all return high) → confidence high.
  const c1 = new Committee({ llm: makeStubLLM(['high', 'high', 'high']), votingRuns: 3, temperature: 0 });
  const r1 = await c1.review(JSON.stringify({ x: 1 }));
  if ('error' in r1.synthesis) { t('case1 synth ok', false, r1.synthesis.error); }
  else {
    t('case1 unanimous → overall_risk=high', r1.synthesis.overall_risk === 'high');
    t('case1 verdict_confidence=high', r1.synthesis.verdict_confidence === 'high');
    t('case1 voting_runs has 3 entries', r1.synthesis.voting_runs?.length === 3);
  }

  // Case 2: majority high (high, high, medium) → confidence medium.
  const c2 = new Committee({ llm: makeStubLLM(['high', 'high', 'medium']), votingRuns: 3, temperature: 0 });
  const r2 = await c2.review(JSON.stringify({ x: 1 }));
  if ('error' in r2.synthesis) t('case2 synth ok', false, r2.synthesis.error);
  else {
    t('case2 majority → overall_risk=high', r2.synthesis.overall_risk === 'high');
    t('case2 verdict_confidence=medium', r2.synthesis.verdict_confidence === 'medium');
  }

  // Case 3: split (high, medium, low) → plurality, confidence low.
  const c3 = new Committee({ llm: makeStubLLM(['high', 'medium', 'low']), votingRuns: 3, temperature: 0 });
  const r3 = await c3.review(JSON.stringify({ x: 1 }));
  if ('error' in r3.synthesis) t('case3 synth ok', false, r3.synthesis.error);
  else {
    t('case3 split → confidence=low', r3.synthesis.verdict_confidence === 'low');
  }

  // Case 4: votingRuns=1 (default) does NOT add voting metadata.
  const c4 = new Committee({ llm: makeStubLLM(['medium']), votingRuns: 1 });
  const r4 = await c4.review(JSON.stringify({ x: 1 }));
  if ('error' in r4.synthesis) t('case4 synth ok', false, r4.synthesis.error);
  else {
    t('case4 single run has no voting metadata', r4.synthesis.verdict_confidence === undefined && r4.synthesis.voting_runs === undefined);
  }

  console.log('');
  console.log(`Total: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
