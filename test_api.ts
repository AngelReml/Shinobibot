import { OpenGravityClient } from './src/cloud/opengravity_client.js';

async function runTests() {
  console.log("Running OpenGravity Client Tests...\n");

  // P3: Llamada real con auth válida
  process.env.SHINOBI_API_KEY = 'sk_test_123';
  process.env.OPENGRAVITY_URL = 'http://localhost:9900';

  let isOnline = await OpenGravityClient.checkHealth();
  console.log(`[P3] Healthcheck (Valid Auth/Online): ${isOnline ? 'PASSED' : 'FAILED'}`);

  if (isOnline) {
    let result = await OpenGravityClient.startSwarmMission("Test Mission");
    console.log(`[P3] startSwarmMission (Valid Auth): ${result.success ? 'PASSED' : 'FAILED'} - ${result.output}`);

    // P4: Llamada con auth inválida
    process.env.SHINOBI_API_KEY = 'invalid_key';
    let resultInvalid = await OpenGravityClient.startSwarmMission("Test Mission");
    console.log(`[P4] startSwarmMission (Invalid Auth): ${!resultInvalid.success && resultInvalid.error.includes('401') ? 'PASSED' : 'FAILED'} - ${resultInvalid.error}`);
  } else {
    console.log(`[P3/P4] SKIP - OpenGravity local is offline`);
  }

  // P5: OpenGravity caído
  process.env.OPENGRAVITY_URL = 'http://localhost:9999'; // Invalid port
  let resultOffline = await OpenGravityClient.checkHealth();
  console.log(`[P5] Healthcheck (Offline Port): ${!resultOffline ? 'PASSED' : 'FAILED'} - Fallback to local mode works safely`);
  
  let missionOffline = await OpenGravityClient.startSwarmMission("Test Offline");
  console.log(`[P5] startSwarmMission (Offline Port): ${!missionOffline.success && missionOffline.error.includes('Connection error') ? 'PASSED' : 'FAILED'} - ${missionOffline.error}`);

  console.log("\nDone.");
}

runTests();
