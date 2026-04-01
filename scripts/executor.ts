import { Orchestrator } from '../src/coordinator/orchestrator.ts';
import { OpenGravityBridge } from '../src/bridge/opengravity.ts';
import 'dotenv/config';

async function main() {
  const orchestrator = new Orchestrator();
  const bridge = new OpenGravityBridge('c:\\Users\\angel\\Desktop\\OpenGravity');

  // Parse --prompt from process.argv
  const promptArgIndex = process.argv.indexOf('--prompt');
  const task = promptArgIndex !== -1 ? process.argv[promptArgIndex + 1] : "No task provided";

  if (task === "No task provided") {
    console.log(JSON.stringify({ error: "No prompt provided. Use --prompt \"your task\"" }));
    return;
  }

  try {
    const code = await orchestrator.executeTask(task, { 
      provider: 'groq', 
      model: 'llama-3.3-70b-versatile' 
    });

    const auditResult = await bridge.audit('generated_code.ts', code);
    
    // Output JSON for n8n processing
    console.log(JSON.stringify({
      verdict: auditResult.status === 'SUCCESSFUL_AUDIT' ? 'VALID_AGENT' : 'INVALID_TEST',
      code: code,
      audit: auditResult
    }, null, 2));

  } catch (error: any) {
    console.log(JSON.stringify({ error: error.message }));
  }
}

main();
