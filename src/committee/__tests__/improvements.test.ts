// B.3 unit test — improvements with stub LLM, no real network.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateProposals } from '../improvements.js';
import type { LLMClient } from '../../reader/SubAgent.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

const sampleDiff =
`--- /dev/null
+++ b/docs/TESTING_PLAN.md
@@ -0,0 +1,3 @@
+# Testing Plan
+
+Stub created to track unit-test coverage gaps surfaced by the committee.
`;

function makeStubLLM(opts: { dropOne?: boolean } = {}): LLMClient {
  return {
    async chat() {
      const proposals: any[] = [
        {
          id: 'add-test-plan-doc',
          file: 'docs/TESTING_PLAN.md',
          motive: 'Committee consensus on missing tests; create a tracking doc as low-risk first step.',
          risk: 'low',
          diff: sampleDiff,
        },
        {
          id: 'noop-bad-diff',
          file: 'docs/X.md',
          motive: 'Should be filtered: diff lacks @@ hunk header.',
          risk: 'low',
          diff: 'no hunk header here',
        },
      ];
      if (opts.dropOne) proposals.pop();
      return JSON.stringify({ proposals });
    },
  };
}

async function main() {
  console.log('B.3 — generateProposals filters invalid items');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-'));
  const reportPath = path.join(tmp, 'committee.json');
  fs.writeFileSync(reportPath, JSON.stringify({ members: [], synthesis: { combined_recommendations: ['add tests'] } }));

  try {
    const r1 = await generateProposals(reportPath, makeStubLLM());
    t('returns ok', r1.ok === true);
    t('keeps valid proposal', r1.proposals.some((p) => p.id === 'add-test-plan-doc'));
    t('drops invalid (no @@)', r1.proposals.every((p) => p.id !== 'noop-bad-diff'));
    t('proposal carries risk + motive', r1.proposals[0].risk === 'low' && r1.proposals[0].motive.length > 0);
    t('proposal diff contains hunk header', r1.proposals[0].diff.includes('@@'));

    const r2 = await generateProposals(reportPath, makeStubLLM({ dropOne: true }));
    t('still ok with single valid proposal', r2.ok === true && r2.proposals.length === 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Total: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
