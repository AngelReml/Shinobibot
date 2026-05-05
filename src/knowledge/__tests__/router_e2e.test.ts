// C.2 e2e — verifica que SubAgent recibe la inyección del manual cuando la
// tarea menciona el programa, y NO cuando no lo menciona.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSubAgent, type LLMClient, type SubTask } from '../../reader/SubAgent.js';
import { KnowledgeRouter } from '../KnowledgeRouter.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'router-e2e-'));
const knowledgeDir = path.join(tmp, 'knowledge');
fs.mkdirSync(path.join(knowledgeDir, 'n8n'), { recursive: true });
fs.writeFileSync(path.join(knowledgeDir, 'n8n', 'manual.json'), JSON.stringify({
  purpose: 'workflow automation tool',
  install: 'npm install n8n',
  public_api: [{ name: 'workflow.execute', signature: 'workflow.execute(data)', summary: 'runs workflow synchronously' }],
  usage_patterns: [{ title: 'webhook trigger', body: 'use the webhook node to start workflow on POST.' }],
  gotchas: ['credentials encrypted at rest only when WORKFLOW_ENCRYPTION_KEY is set'],
  examples: [],
  synonyms: ['n8n.io'],
  source: { kind: 'url', origin: 'https://docs.n8n.io', pages_or_files: 20 },
}));

const repoDir = path.join(tmp, 'repo');
fs.mkdirSync(repoDir);
fs.writeFileSync(path.join(repoDir, 'foo.ts'), 'export function foo(){return "hi"}\n');

const router = new KnowledgeRouter({
  knowledgeDir,
  usageLogPath: path.join(knowledgeDir, 'usage.log'),
  maxTokens: 2_000,
});

let lastUserMsg = '';
const stubLLM: LLMClient = {
  async chat(messages) {
    lastUserMsg = messages.find((m) => m.role === 'user')?.content ?? '';
    return JSON.stringify({
      path: 'foo',
      purpose: 'demo',
      key_files: [],
      dependencies: { internal: [], external: [] },
      concerns: [],
    });
  },
};

const task: SubTask = {
  sub_path: 'foo',
  abs_path: repoDir,
  files_to_read: [path.join(repoDir, 'foo.ts')],
  prompt_extra: 'Check if this folder integrates with n8n via webhook.',
  token_budget: 4_000,
};

console.log('C.2 e2e — injection happens when task mentions program');
await runSubAgent(task, stubLLM, {
  knowledgeInjector: (userPrompt) => router.buildPromptInjection(userPrompt, 'M-e2e-1').text,
});
t('user prompt contains injected manual marker', lastUserMsg.includes('BEGIN INJECTED KNOWLEDGE'));
t('injected text mentions n8n manual', lastUserMsg.includes('Manual injected: n8n'));
t('injected text references webhook (relevant section)', /webhook/i.test(lastUserMsg));

console.log('\nC.2 e2e — no injection when task does NOT mention program');
const taskNoMention: SubTask = { ...task, prompt_extra: 'Just check generic style.' };
lastUserMsg = '';
await runSubAgent(taskNoMention, stubLLM, {
  knowledgeInjector: (userPrompt) => router.buildPromptInjection(userPrompt, 'M-e2e-2').text,
});
t('no manual injected when task is unrelated', !lastUserMsg.includes('BEGIN INJECTED KNOWLEDGE'));

console.log('\nC.2 e2e — usage.log records mission_id of the matching call');
const log = fs.readFileSync(path.join(knowledgeDir, 'usage.log'), 'utf-8');
t('usage.log mentions M-e2e-1', log.includes('M-e2e-1'));
t('usage.log does NOT mention M-e2e-2 (no match)', !log.includes('M-e2e-2'));

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
