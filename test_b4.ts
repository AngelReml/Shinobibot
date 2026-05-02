import { OpenGravityClient } from './src/cloud/opengravity_client.js';

async function main() {
  process.env.SHINOBI_API_KEY = process.env.SHINOBI_API_KEY || 'sk_dev_master';
  process.env.OPENGRAVITY_URL = process.env.OPENGRAVITY_URL || 'http://localhost:9900';

  console.log('--- B4 TEST 1: catálogo via /v1/n8n/catalog ---');
  const axios = (await import('axios')).default;
  try {
    const r = await axios.get(`${process.env.OPENGRAVITY_URL}/v1/n8n/catalog`, {
      headers: { 'X-Shinobi-Key': process.env.SHINOBI_API_KEY }
    });
    console.log('Catalog response:', r.data);
    const list = JSON.parse(r.data.output);
    console.log(`Workflows visible: ${list.length}`);
    console.log('TEST 1:', list.length >= 1 ? 'PASSED' : 'FAILED');
  } catch (e: any) { console.log('TEST 1 FAILED:', e.message); }

  console.log('\n--- B4 TEST 2: invoke echo-pilot via OpenGravity ---');
  const r2 = await OpenGravityClient.invokeWorkflow('echo-pilot', { hello: 'shinobi', timestamp: Date.now() });
  console.log('Result success:', r2.success);
  console.log('Result output:', r2.output);
  console.log('Result error:', r2.error);
  if (r2.success) {
    try {
      const data = JSON.parse(r2.output);
      console.log('TEST 2: PASSED — workflow respondió');
      console.log('Payload received:', JSON.stringify(data).substring(0, 300));
    } catch { console.log('TEST 2: PARTIAL — output not JSON'); }
  } else {
    console.log('TEST 2: FAILED — el workflow piloto puede no estar creado todavía en n8n');
  }

  console.log('\n--- B4 TEST 3: invocar workflow inexistente ---');
  const r3 = await OpenGravityClient.invokeWorkflow('does-not-exist', {});
  console.log('Should fail with 404:', !r3.success && (r3.error || '').includes('404'));
  console.log('TEST 3:', !r3.success && (r3.error || '').includes('404') ? 'PASSED' : 'FAILED');

  console.log('\n--- ALL TESTS DONE ---');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
