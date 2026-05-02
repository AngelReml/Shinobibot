import { OpenGravityClient } from './src/cloud/opengravity_client.js';

async function main() {
  process.env.SHINOBI_API_KEY = process.env.SHINOBI_API_KEY || 'sk_dev_master';
  process.env.OPENGRAVITY_URL = process.env.OPENGRAVITY_URL || 'http://localhost:9900';

  console.log('--- TEST B2: invokeLLM via OpenGravity ---');

  const result = await OpenGravityClient.invokeLLM({
    messages: [
      { role: 'user', content: 'Responde solo con la palabra: OK' }
    ]
  } as any);

  console.log('success:', result.success);
  console.log('error:', result.error);
  console.log('output:', result.output ? result.output.substring(0, 300) : '(empty)');

  if (result.success && result.output) {
    try {
      const message = JSON.parse(result.output);
      console.log('message.content:', message.content);
      console.log('TEST: PASSED');
    } catch (e) {
      console.log('TEST: PARTIAL - output not valid JSON message');
    }
  } else {
    console.log('TEST: FAILED');
  }
}

main();
