// E2E for Habilidad A core. No real LLM: stub client returns scripted JSON.
// Run: npx tsx src/reader/__tests__/reader.test.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  validateSubReport,
  validateRepoReport,
  tryParseJSON,
} from '../schemas.js';
import { partition, RepoReader } from '../RepoReader.js';
import type { LLMClient } from '../SubAgent.js';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-fixture-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# DummyRepo\nA dummy repo for tests.\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dummy', dependencies: { axios: '^1' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'import axios from "axios";\nexport function go() {}\n');
  fs.mkdirSync(path.join(root, 'src', 'utils'));
  fs.writeFileSync(path.join(root, 'src', 'utils', 'helpers.ts'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  fs.mkdirSync(path.join(root, 'node_modules'));   // should be ignored
  fs.writeFileSync(path.join(root, 'node_modules', 'a.js'), 'leak');
  return root;
}

function makeStubLLM(opts: {
  failFirstSub?: boolean;
  failSynthOnce?: boolean;
} = {}): LLMClient {
  let subCalls = 0;
  let synthCalls = 0;
  return {
    async chat(messages, callOpts) {
      const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
      const userMsg = messages.find((m) => m.role === 'user')?.content ?? '';
      // Robust shape detection: synth call always feeds a JSON array of sub-reports
      // in the user message; leaf calls feed file blocks delimited by `--- name ---`.
      // Substring-on-system-prompt is too coupled to prompt wording.
      const isSynth = userMsg.startsWith('Sub-reports (JSON array):') || systemMsg.includes('synthesizing');

      if (isSynth) {
        synthCalls++;
        if (opts.failSynthOnce && synthCalls === 1) {
          return JSON.stringify({ repo_purpose: 'missing fields' });
        }
        return JSON.stringify({
          repo_purpose: 'A dummy test repo.',
          architecture_summary: '## Modules\n- src\n- docs\n',
          modules: [
            { name: 'src', path: 'src', responsibility: 'application code' },
            { name: 'docs', path: 'docs', responsibility: 'documentation' },
          ],
          entry_points: [{ file: 'src/index.ts', kind: 'library' }],
          risks: [],
          evidence: { subagent_count: 3, tokens_total: 0, duration_ms: 1, subreports_referenced: 3 },
        });
      }

      subCalls++;
      if (opts.failFirstSub && subCalls === 1) {
        return 'not even valid json {{{';
      }
      const folderMatch = userMsg.match(/Folder:\s*(\S+)/);
      const folder = folderMatch ? folderMatch[1] : 'unknown';
      return JSON.stringify({
        path: folder,
        purpose: `Dummy purpose for ${folder}`,
        key_files: [],
        dependencies: { internal: [], external: [] },
        concerns: [],
      });
    },
  };
}

async function main() {
  console.log('Habilidad A — reader.test.ts');
  console.log('');

  // Test 1: schema validation positive
  console.log('schemas:');
  const goodSub = {
    path: 'src',
    purpose: 'app code',
    key_files: [{ name: 'index.ts', role: 'entry' }],
    dependencies: { internal: ['src/utils'], external: ['axios'] },
    concerns: [],
  };
  check('validateSubReport accepts valid', validateSubReport(goodSub).ok);

  // Test 2: schema validation negative
  const badSub: any = { ...goodSub };
  delete badSub.purpose;
  check('validateSubReport rejects missing field', !validateSubReport(badSub).ok);

  const goodRepo = {
    repo_purpose: 'X',
    architecture_summary: 'Y',
    modules: [{ name: 'a', path: 'a', responsibility: 'r' }],
    entry_points: [{ file: 'a/i.ts', kind: 'cli' }],
    risks: [],
    evidence: { subagent_count: 1, tokens_total: 0, duration_ms: 0, subreports_referenced: 1 },
  };
  check('validateRepoReport accepts valid', validateRepoReport(goodRepo).ok);
  check(
    'validateRepoReport rejects bad severity',
    !validateRepoReport({ ...goodRepo, risks: [{ severity: 'critical', description: 'x' }] }).ok,
  );

  // Test 3: tryParseJSON tolerates fenced blocks
  check(
    'tryParseJSON tolerates ```json fence',
    JSON.stringify(tryParseJSON('```json\n{"a":1}\n```')) === '{"a":1}',
  );

  // Test 4: partition — node_modules ignored, root_meta present
  console.log('\npartition:');
  const fixture = makeFixture();
  try {
    const part = partition(fixture);
    check('rootMeta task created', part.rootMeta.sub_path === '/');
    check('rootMeta files include README', part.rootMeta.files_to_read.some((f) => /README\.md$/i.test(f)));
    check('node_modules NOT in any branch', part.branches.every((b) => !b.files_to_read.some((f) => f.includes('node_modules'))));
    check('at least one branch (src)', part.branches.some((b) => b.sub_path === 'src'));

    // Test 5: full RepoReader flow with stub LLM
    console.log('\nRepoReader.read (stub LLM):');
    const reader = new RepoReader({ llm: makeStubLLM() });
    const result = await reader.read(fixture);
    check('reader.read ok', result.ok === true, !result.ok ? (result as any).error : undefined);
    if (result.ok) {
      check('report has modules', Array.isArray(result.report.modules) && result.report.modules.length > 0);
      check('subreports array length matches', result.subreports.length === 1 + part.branches.length);
    }

    // Test 6: invalid first JSON triggers retry, second valid → returns SubReport
    console.log('\nSubAgent retry path:');
    const reader2 = new RepoReader({ llm: makeStubLLM({ failFirstSub: true }) });
    const r2 = await reader2.read(fixture);
    check('reader.read still ok despite first sub returning garbage', r2.ok === true);

    // Test 7: synth fails first, retries
    console.log('\nsynthesize retry path:');
    const reader3 = new RepoReader({ llm: makeStubLLM({ failSynthOnce: true }) });
    const r3 = await reader3.read(fixture);
    check('reader.read ok with synth retry', r3.ok === true);

  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Total: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
