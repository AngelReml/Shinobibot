// D.2 unit test — HierarchicalReader against a synthetic repo with stub LLM.
// Covers: depth=1 regression equivalence with Habilidad A, depth=2 produces
// sub-supervisors that consolidate leaves, telemetry tree shape.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HierarchicalReader, renderTelemetryTree } from '../HierarchicalReader.js';
import type { LLMClient } from '../SubAgent.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hier-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Hier test\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"hier"}');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const x=1;\n');
  fs.mkdirSync(path.join(root, 'src', 'lib'));
  fs.writeFileSync(path.join(root, 'src', 'lib', 'a.ts'), 'export const a=1;\n');
  fs.mkdirSync(path.join(root, 'src', 'utils'));
  fs.writeFileSync(path.join(root, 'src', 'utils', 'b.ts'), 'export const b=1;\n');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 't.ts'), 'export const t=1;\n');
  return root;
}

function makeStubLLM(): LLMClient {
  return {
    async chat(messages) {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.find((m) => m.role === 'user')?.content ?? '';

      // Final synthesizer
      if (sys.includes('synthesizing a single repo report')) {
        return JSON.stringify({
          repo_purpose: 'test repo',
          architecture_summary: 'test',
          modules: [{ name: 'src', path: 'src', responsibility: 'app' }],
          entry_points: [{ file: 'src/index.ts', kind: 'library' }],
          risks: [],
          evidence: { subagent_count: 3, tokens_total: 0, duration_ms: 1, subreports_referenced: 3 },
        });
      }

      // Intermediate sub-supervisor synth
      if (sys.includes('sub-supervisor consolidating leaf sub-reports')) {
        const branchMatch = user.match(/Branch path:\s*(\S+)/);
        const branch = branchMatch ? branchMatch[1] : 'unknown';
        return JSON.stringify({
          path: branch,
          purpose: `consolidated for ${branch}`,
          key_files: [],
          dependencies: { internal: [], external: [] },
          concerns: [],
        });
      }

      // Leaf sub-agent
      const folderMatch = user.match(/Folder:\s*(\S+)/);
      const folder = folderMatch ? folderMatch[1] : 'leaf';
      return JSON.stringify({
        path: folder,
        purpose: `leaf ${folder}`,
        key_files: [],
        dependencies: { internal: [], external: [] },
        concerns: [],
      });
    },
  };
}

async function main() {
  const fixture = makeFixture();
  try {
    console.log('D.2 — depth=1 regression (parity with Habilidad A)');
    const r1 = new HierarchicalReader({ llm: makeStubLLM(), depth: 1 });
    const out1 = await r1.read(fixture);
    t('depth=1 ok', out1.ok === true, out1.error);
    t('depth=1 telemetry has only leaves under root',
      out1.telemetry.children.every((c) => c.level === 'leaf'));
    t('depth=1 produces ≥3 subreports', out1.subreports.length >= 3);
    t('depth=1 final report exists', !!out1.report?.modules);

    console.log('\nD.2 — depth=2 produces sub-supervisors');
    const r2 = new HierarchicalReader({ llm: makeStubLLM(), depth: 2 });
    const out2 = await r2.read(fixture);
    t('depth=2 ok', out2.ok === true, out2.error);
    const subSups = out2.telemetry.children.filter((c) => c.level === 'sub_supervisor');
    t('depth=2 has ≥1 sub-supervisor', subSups.length >= 1);
    t('depth=2 each sub-supervisor has leaf children',
      subSups.every((s) => s.children.length > 0 && s.children.every((c) => c.level === 'leaf')));
    t('depth=2 root_meta and misc/ stay leaves (not promoted)',
      out2.telemetry.children.some((c) => c.level === 'leaf' && c.label === '/'));

    console.log('\nD.2 — telemetry timing fields populated');
    t('telemetry root has duration_ms', typeof out2.telemetry.duration_ms === 'number');
    t('every node has start_ms', collectNodes(out2.telemetry).every((n) => typeof n.start_ms === 'number'));
    t('every completed node has end_ms', collectNodes(out2.telemetry).every((n) => n.status !== 'ok' || typeof n.end_ms === 'number'));

    console.log('\nD.2 — telemetry tree renders');
    const tree = renderTelemetryTree(out2.telemetry);
    t('rendered tree starts with [✓] supervisor', tree.startsWith('[✓] supervisor'));
    t('rendered tree contains sub_supervisor entries', tree.includes('sub_supervisor'));
    t('rendered tree contains leaf entries', tree.includes('leaf'));
    t('rendered tree shows hierarchy (├─ or └─ prefix)', /[├└]─/.test(tree));
    t('rendered tree shows nesting (│ or whitespace prefix on grandchildren)', /[│ ]\s+[├└]─/.test(tree));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Total: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

function collectNodes(n: any): any[] {
  return [n, ...n.children.flatMap(collectNodes)];
}

main().catch((e) => { console.error(e); process.exit(2); });
