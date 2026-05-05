// C.1 runner — ejecuta /learn https://docs.n8n.io.
import { runLearn } from '../src/knowledge/learn.js';

async function main() {
  const r = await runLearn('https://docs.n8n.io');
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => { console.error('[c1_run] FATAL:', e); process.exit(2); });
