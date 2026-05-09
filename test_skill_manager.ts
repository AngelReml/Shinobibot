// test_skill_manager.ts
//
// Bloque 3 — E2E del Skill Manager autónomo.
//
// Uso:
//   npx tsx test_skill_manager.ts
//
// Los tests usan un directorio temporal y un task_runs.db aislado para no
// contaminar el entorno del usuario, y mockean la llamada al LLM via
// setLLMInvokerForTesting (sin red).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillMd, serializeSkillMd } from './src/skills/skill_md_parser.js';
import {
  SkillManagerImpl,
  setLLMInvokerForTesting,
  setSkillEventListener,
  type SkillEvent,
} from './src/skills/skill_manager.js';

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} [${ms}ms] ${name} — ${detail}`);
}

// Drive everything from a per-run sandbox so we never touch the user's
// real skills/ or task_runs.db. We chdir into the sandbox so SkillManager
// (which uses process.cwd()) puts pending/approved/db there.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-skill-test-'));
const originalCwd = process.cwd();
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Synthetic SKILL.md content the fake LLM will return when proposeSkill fires.
const FAKE_SKILL_MD = `---
name: linkedin-profile-extractor
description: Extract structured data from a LinkedIn profile URL.
trigger_keywords: [linkedin, profile]
model_recommended: anthropic/claude-haiku-4.5
---

# LinkedIn profile extractor

1. Use clean_extract on the profile URL.
2. Parse the markdown for name, headline, current role.
3. Return as JSON.
`;

// Mock invoker that returns the fake SKILL.md as if OpenRouter answered.
setLLMInvokerForTesting(async () => ({
  success: true,
  output: JSON.stringify({ role: 'assistant', content: FAKE_SKILL_MD }),
  error: '',
}));

// Subscribe to events to verify the WS-broadcast pipeline at the source.
const observedEvents: SkillEvent[] = [];
setSkillEventListener(e => observedEvents.push(e));

async function main(): Promise<void> {
  // ─── A: parser round-trip ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const original = `---
name: foo-bar
description: "A test, with comma"
trigger_keywords: [alpha, "beta gamma", delta]
status: pending
---

# Foo

Body line 1
Body line 2
`;
      const parsed = parseSkillMd(original);
      const re = serializeSkillMd(parsed);
      const reparsed = parseSkillMd(re);
      const ok =
        parsed.frontmatter.name === 'foo-bar' &&
        parsed.frontmatter.description === 'A test, with comma' &&
        Array.isArray(parsed.frontmatter.trigger_keywords) &&
        (parsed.frontmatter.trigger_keywords as string[]).length === 3 &&
        (parsed.frontmatter.trigger_keywords as string[])[1] === 'beta gamma' &&
        reparsed.frontmatter.name === parsed.frontmatter.name &&
        reparsed.body === parsed.body;
      record('A. parser round-trip', ok,
        `name=${parsed.frontmatter.name}, kws=${JSON.stringify(parsed.frontmatter.trigger_keywords)}, body_match=${reparsed.body === parsed.body}`,
        t0);
    } catch (e: any) {
      record('A. parser round-trip', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── B: failure trigger fires after N consecutive fails ──────────────────
  {
    const t0 = Date.now();
    try {
      const sm = new SkillManagerImpl(path.join(sandbox, 'runs_b.db'));
      // Simulate 3 fails of the same input. Each observeRun will trigger
      // evaluateAndPropose internally; we need to await a tick for the
      // async proposal call to complete.
      const inp = 'extract data from my linkedin profile';
      observedEvents.length = 0;
      sm.observeRun({ input: inp, toolSequence: ['web_search', 'browser_click'], success: false, error: 'fail 1' });
      sm.observeRun({ input: inp, toolSequence: ['web_search', 'browser_click'], success: false, error: 'fail 2' });
      sm.observeRun({ input: inp, toolSequence: ['web_search', 'browser_click'], success: false, error: 'fail 3' });
      // Yield so the fire-and-forget background proposal can run.
      await new Promise(r => setTimeout(r, 200));
      const proposed = observedEvents.find(e => e.type === 'skill_proposed');
      const pendingDir = path.join(sandbox, 'skills', 'pending');
      const pendingFiles = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter(f => f.endsWith('.skill.md')) : [];
      const ok = !!proposed && pendingFiles.length >= 1;
      record('B. failure trigger after N fails', ok,
        `event=${!!proposed}, pending_files=${pendingFiles.length}`,
        t0);
    } catch (e: any) {
      record('B. failure trigger after N fails', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── C: proposeSkill writes a valid pending file ──────────────────────────
  {
    const t0 = Date.now();
    try {
      // Reset pending dir for a clean test.
      const pendingDir = path.join(sandbox, 'skills', 'pending');
      if (fs.existsSync(pendingDir)) for (const f of fs.readdirSync(pendingDir)) fs.unlinkSync(path.join(pendingDir, f));
      const sm = new SkillManagerImpl(path.join(sandbox, 'runs_c.db'));
      const r = await sm.proposeSkill('manual context for a test skill', 'manual');
      const ok = r.ok && !!r.id && !!r.name;
      let parsedOk = false;
      if (ok) {
        const file = path.join(pendingDir, `${r.id}.skill.md`);
        const content = fs.readFileSync(file, 'utf-8');
        const parsed = parseSkillMd(content);
        parsedOk = parsed.frontmatter.name === 'linkedin-profile-extractor' &&
          parsed.frontmatter.status === 'pending' &&
          parsed.frontmatter.source === 'auto';
      }
      record('C. proposeSkill writes pending file', ok && parsedOk,
        `ok=${r.ok}, id=${r.id}, name=${r.name}, parsed_ok=${parsedOk}`,
        t0);
    } catch (e: any) {
      record('C. proposeSkill writes pending file', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── D: approve moves pending → approved ─────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const sm = new SkillManagerImpl(path.join(sandbox, 'runs_d.db'));
      const proposed = await sm.proposeSkill('approve test', 'manual');
      if (!proposed.ok || !proposed.id) throw new Error('proposal failed: ' + proposed.error);
      const id = proposed.id;
      const r = sm.approve(id);
      const pending = path.join(sandbox, 'skills', 'pending', `${id}.skill.md`);
      const approved = path.join(sandbox, 'skills', 'approved', `${id}.skill.md`);
      const ok = r.ok && !fs.existsSync(pending) && fs.existsSync(approved);
      let statusOk = false;
      if (ok) {
        const parsed = parseSkillMd(fs.readFileSync(approved, 'utf-8'));
        statusOk = parsed.frontmatter.status === 'approved';
      }
      record('D. approve(id) moves pending→approved', ok && statusOk,
        `pending_gone=${!fs.existsSync(pending)}, approved_exists=${fs.existsSync(approved)}, status_updated=${statusOk}`,
        t0);
    } catch (e: any) {
      record('D. approve(id) moves pending→approved', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── E: loadApproved + getContextSection matches by trigger_keyword ──────
  {
    const t0 = Date.now();
    try {
      const sm = new SkillManagerImpl(path.join(sandbox, 'runs_e.db'));
      sm.loadApproved();
      const matchSection = sm.getContextSection('extrae datos de mi perfil de linkedin');
      const noMatchSection = sm.getContextSection('what is the weather today');
      const ok = matchSection !== null && /Skill: linkedin-profile-extractor/.test(matchSection) && noMatchSection === null;
      record('E. matching by trigger_keyword', ok,
        `match=${matchSection !== null && /linkedin/.test(matchSection)}, no_match_for_unrelated=${noMatchSection === null}`,
        t0);
    } catch (e: any) {
      record('E. matching by trigger_keyword', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} tests passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)`);
  console.log('═════════════════════════════════════════════════════');

  // Cleanup sandbox
  process.chdir(originalCwd);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  process.chdir(originalCwd);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
