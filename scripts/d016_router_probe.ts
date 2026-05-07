/**
 * D-016 — Probe del router LLM. Llama directo a /v1/llm/chat con cada uno
 * de los 3 prompts de PASO 6 y reporta {tier_elegido, modelo_usado, ms,
 * resultado}. No usa el orchestrator: enviamos messages directamente y leemos
 * el campo `routing` del response.
 */
import axios from 'axios';
import { loadConfig } from '../src/runtime/first_run_wizard.js';

interface Probe {
  label: string;
  prompt: string;
  expected_tier: 'FAST' | 'BALANCED' | 'REASONING';
  budget_s: number;
}

const probes: Probe[] = [
  { label: 'a) crear archivo', prompt: 'crea archivo test_fast.txt con texto Hola en escritorio', expected_tier: 'FAST', budget_s: 10 },
  { label: 'b) web research', prompt: 'busca en web los 3 últimos modelos lanzados por OpenAI y resume', expected_tier: 'BALANCED', budget_s: 60 },
  { label: 'c) contrato legal', prompt: 'genera un contrato de prestación de servicios entre dos empresas españolas con cláusula de confidencialidad y propiedad intelectual', expected_tier: 'REASONING', budget_s: 180 }
];

async function main() {
  const config = loadConfig();
  if (!config) { console.error('[D016] No Shinobi config'); process.exit(2); }
  const baseUrl = (config.opengravity_url || 'http://localhost:9900').replace(/\/+$/, '');
  const apiKey = config.opengravity_api_key || '';
  if (!apiKey) { console.error('[D016] No API key in config'); process.exit(2); }

  console.log(`[D016] base=${baseUrl} key.len=${apiKey.length}\n`);
  console.log('| # | Tarea | Tier esperado | Tier elegido | Modelo usado | Tiempo (s) | OK |');
  console.log('|---|-------|---------------|--------------|--------------|------------|----|');

  for (const p of probes) {
    const t0 = Date.now();
    try {
      const res = await axios.post(
        `${baseUrl}/v1/llm/chat`,
        {
          messages: [{ role: 'user', content: p.prompt }],
          // No model: el router decide. No tier: heurística.
        },
        {
          headers: { 'Content-Type': 'application/json', 'X-Shinobi-Key': apiKey },
          timeout: (p.budget_s + 30) * 1000
        }
      );
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const r = res.data;
      const tier = r.routing?.tier || '(none)';
      const model = r.model_used || r.routing?.model || '(none)';
      const tierOK = tier === p.expected_tier;
      const budgetOK = Number(elapsed) <= p.budget_s;
      const ok = r.success && tierOK && budgetOK;
      console.log(`| ${p.label.split(')')[0]} | ${p.prompt.slice(0, 40)}... | ${p.expected_tier} | ${tier} | ${model} | ${elapsed} | ${ok ? '✅' : '❌'} ${tierOK ? '' : '(tier!)'}${budgetOK ? '' : '(budget!)'}${r.success ? '' : '(error: ' + r.error + ')'} |`);
    } catch (e: any) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`| ${p.label.split(')')[0]} | ${p.prompt.slice(0, 40)}... | ${p.expected_tier} | ERR | - | ${elapsed} | ❌ ${e.message} |`);
    }
  }

  console.log('\n[D016] Done.');
  process.exit(0);
}

main().catch((e) => { console.error('[D016] Fatal:', e); process.exit(1); });
