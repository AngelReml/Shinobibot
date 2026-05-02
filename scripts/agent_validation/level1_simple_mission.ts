import { ShinobiOrchestrator } from '../../src/coordinator/orchestrator.js';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('C:/Users/angel/Desktop/shinobibot/artifacts/agent_validation', { recursive: true });

const MISSION = 'Lista las primeras 5 criptomonedas del top ranking de CoinGecko (https://www.coingecko.com). Para cada una devuelve: rank, nombre, símbolo y precio si lo encuentras. Devuelve la respuesta estructurada en JSON.';

async function main() {
  const startTime = Date.now();
  console.log(`[AGENT-E2E-L1] Setting mode to local`);
  ShinobiOrchestrator.setMode('local');
  
  console.log(`[AGENT-E2E-L1] Mission: ${MISSION}`);
  console.log(`[AGENT-E2E-L1] Invoking orchestrator...`);
  
  let result: any;
  let error: any = null;
  try {
    result = await ShinobiOrchestrator.process(MISSION);
  } catch (e: any) {
    error = e.message || String(e);
  }
  
  const elapsedMs = Date.now() - startTime;
  
  const report = {
    mission: MISSION,
    mode: 'local',
    elapsed_ms: elapsedMs,
    elapsed_seconds: Math.round(elapsedMs / 1000),
    success: !error,
    error,
    result_type: typeof result,
    result_raw: result,
    result_preview: typeof result === 'string' ? result.slice(0, 3000) : JSON.stringify(result).slice(0, 3000)
  };
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/agent_validation/level1_report.json', JSON.stringify(report, null, 2));
  
  console.log(`[AGENT-E2E-L1] Done in ${report.elapsed_seconds}s | success=${report.success}`);
  if (error) console.log(`[AGENT-E2E-L1] ERROR: ${error}`);
  if (result) console.log(`[AGENT-E2E-L1] Preview: ${report.result_preview.slice(0, 500)}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
