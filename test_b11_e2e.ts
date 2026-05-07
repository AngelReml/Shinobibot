import axios from 'axios';

const PROD_URL = process.env.OPENGRAVITY_URL || "http://localhost:9900";
const KEY = 'sk_dev_master';
const headers = { 'X-Shinobi-Key': KEY, 'Content-Type': 'application/json' };

async function main() {
  console.log('--- B11 E2E TEST contra producción ---');
  console.log('Target:', PROD_URL);
  console.log();

  // T1: health
  console.log('T1: GET /v1/health');
  try {
    const r = await axios.get(`${PROD_URL}/v1/health`);
    console.log(`  status: ${r.status}, body:`, r.data);
    console.log(`  T1: ${r.data.status === 'online' ? 'PASSED' : 'FAILED'}\n`);
  } catch (e: any) { console.log(`  T1: FAILED — ${e.message}\n`); }

  // T2: LLM call real via OpenRouter
  console.log('T2: POST /v1/llm/chat (LLM real)');
  try {
    const r = await axios.post(`${PROD_URL}/v1/llm/chat`, {
      messages: [
        { role: 'system', content: 'You are a test assistant. Reply ONLY with the word \"B11OK\".' },
        { role: 'user', content: 'Confirm.' }
      ],
      max_tokens: 30
    }, { headers, timeout: 60000 });
    const msg = JSON.parse(r.data.output || '{}');
    console.log(`  success: ${r.data.success}`);
    console.log(`  model_used: ${r.data.model_used}`);
    console.log(`  content: ${msg.content}`);
    const ok = r.data.success && (msg.content || '').includes('B11OK');
    console.log(`  T2: ${ok ? 'PASSED' : 'FAILED'}\n`);
  } catch (e: any) { console.log(`  T2: FAILED — ${e.response?.data?.error || e.message}\n`); }

  // T3: skills list (de B5)
  console.log('T3: GET /v1/skills/list');
  try {
    const r = await axios.get(`${PROD_URL}/v1/skills/list`, { headers });
    const list = JSON.parse(r.data.output);
    console.log(`  skills count: ${list.length}`);
    console.log(`  T3: ${r.data.success ? 'PASSED' : 'FAILED'}\n`);
  } catch (e: any) { console.log(`  T3: FAILED — ${e.message}\n`); }

  // T4: swarm real (de B7)
  console.log('T4: POST /v1/missions/swarm (swarm real)');
  try {
    const r = await axios.post(`${PROD_URL}/v1/missions/swarm`, {
      mission_prompt: 'Say in ONE SHORT sentence what an AI agent is. Reply with final immediately.'
    }, { headers, timeout: 180000 });
    const parsed = r.data.success ? JSON.parse(r.data.output) : null;
    console.log(`  success: ${r.data.success}`);
    if (parsed) {
      console.log(`  iterations: ${parsed.iterations}`);
      console.log(`  agents_used: ${parsed.agents_used.join(', ')}`);
      console.log(`  total_tokens: ${parsed.total_tokens}`);
      console.log(`  final: ${parsed.final_output.substring(0, 200)}`);
    } else {
      console.log(`  error: ${r.data.error}`);
    }
    console.log(`  T4: ${r.data.success && parsed?.final_output?.length > 10 ? 'PASSED' : 'FAILED'}\n`);
  } catch (e: any) { console.log(`  T4: FAILED — ${e.response?.data?.error || e.message}\n`); }

  // T5: auth invalida → 401
  console.log('T5: auth inválida');
  try {
    await axios.get(`${PROD_URL}/v1/skills/list`, { headers: { 'X-Shinobi-Key': 'sk_invalid_xxx' } });
    console.log(`  T5: FAILED — debería haber sido 401\n`);
  } catch (e: any) {
    const status = e.response?.status;
    console.log(`  status: ${status}`);
    console.log(`  T5: ${status === 401 ? 'PASSED' : 'FAILED'}\n`);
  }

  // T6: latencia (3 pings consecutivos)
  console.log('T6: latencia');
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    try { await axios.get(`${PROD_URL}/v1/health`); } catch {}
    times.push(Date.now() - t);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  ping times: ${times.join('ms, ')}ms`);
  console.log(`  avg: ${Math.round(avg)}ms`);
  console.log(`  T6: ${avg < 2000 ? 'PASSED' : 'FAILED — latencia alta'}\n`);

  // T7: Shinobi local apuntando a producción
  console.log('T7: Shinobi local llamando a producción');
  process.env.OPENGRAVITY_URL = PROD_URL;
  process.env.SHINOBI_API_KEY = KEY;
  try {
    const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
    const r = await OpenGravityClient.invokeLLM({
      messages: [{ role: 'user', content: 'Say \"B11SHINOBIOK\" only.' }],
      max_tokens: 20
    } as any);
    const msg = r.success ? JSON.parse(r.output) : null;
    console.log(`  success: ${r.success}`);
    console.log(`  content: ${msg?.content}`);
    const ok = r.success && (msg?.content || '').includes('B11SHINOBIOK');
    console.log(`  T7: ${ok ? 'PASSED' : 'FAILED'}\n`);
  } catch (e: any) { console.log(`  T7: FAILED — ${e.message}\n`); }

  console.log('--- ALL DONE ---');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
