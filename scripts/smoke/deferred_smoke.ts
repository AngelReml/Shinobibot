process.env.SHINOBI_DEFERRED_TOOLS = '1';
process.env.SHINOBI_AUDIT_DISABLED = '1';
process.env.SHINOBI_MAX_ITERATIONS = '6';
process.env.SHINOBI_PROVIDER = 'groq';
import '../../src/tools/index.js';
import { ShinobiOrchestrator } from '../../src/coordinator/orchestrator.js';

async function main() {
  const task = 'Usa la herramienta tool_search para localizar una herramienta de informacion del sistema, y despues usala para decirme el sistema operativo. Responde en una frase.';
  console.log('=== DEFERRED SMOKE START ===');
  const r: any = await ShinobiOrchestrator.process(task);
  console.log('=== VERDICT:', r?.verdict);
  console.log('=== RESPONSE:', String(r?.response || r?.output || '').slice(0, 400));
}
main().catch(e => { console.error('THREW', e?.message ?? e); process.exit(1); });
