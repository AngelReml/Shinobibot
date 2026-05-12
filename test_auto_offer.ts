// test_auto_offer.ts
//
// Bloque 5.3 — E2E del auto-offer hook movido a server.ts.
//
// Mockea OpenGravityClient.invokeLLM (path principal) y invokeLLMViaOpenRouter
// (fallback) para devolver UNA respuesta directa de texto estructurado SIN
// tool calls — exactamente el escenario que reportó el FAIL ("OpenRouter
// fallback OK → fin" sin que el hook se disparara).
//
// Verifica que el WS client recibe document_event con type=document_offer.

import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Sandbox the curated memory / web chat DB en tmp para no contaminar.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-auto-offer-test-'));
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// IMPORTANTE: monkey-patch ANTES de importar el server, para que el
// orchestrator coja nuestras versiones.
const STRUCTURED_RESPONSE = (() => {
  const filler = 'lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8);
  return [
    '## **Sección uno**',
    '',
    filler,
    '',
    '## **Sección dos**',
    '',
    filler,
    '',
    '## **Sección tres**',
    '',
    '• Punto uno: ' + filler,
    '• Punto dos: ' + filler,
    '• Punto tres: ' + filler,
    '• Punto cuatro: ' + filler,
    '• Punto cinco: ' + filler,
  ].join('\n');
})();

const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
(OpenGravityClient as any).invokeLLM = async () => ({
  success: true,
  output: JSON.stringify({ role: 'assistant', content: STRUCTURED_RESPONSE }),
  error: '',
});
// El fallback OpenRouter no se mockea porque ESM exports son read-only.
// El mock de OpenGravityClient.invokeLLM ya devuelve success=true, así
// que el orchestrator nunca entra a la rama de fallback.

const { startWebServer } = await import('./src/web/server.js');

const PORT = 13701;
await startWebServer({ port: PORT, dbPath: path.join(sandbox, 'web_chat.db') });
await new Promise(r => setTimeout(r, 200));

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const received: any[] = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  received.push(m);
});

await new Promise<void>((res, rej) => {
  ws.once('open', () => res());
  ws.once('error', rej);
  setTimeout(() => rej(new Error('ws open timeout')), 3000);
});
console.log('[test] WS open');

ws.send(JSON.stringify({
  type: 'send',
  text: 'dame un análisis completo sobre tendencias 2026 con secciones y bullets',
  sessionId: 'auto-offer-test',
}));

// Wait for final + (hopefully) document_event.
const deadline = Date.now() + 15000;
let sawFinal = false;
let sawOffer = false;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 150));
  sawFinal = received.some(m => m.type === 'final');
  sawOffer = received.some(m => m.type === 'document_event' && m.event?.type === 'document_offer');
  if (sawFinal && sawOffer) break;
  if (sawFinal && Date.now() - deadline > 2000) break; // give offer 2s after final
}

console.log(`[test] received ${received.length} message(s)`);
console.log(`[test] saw final: ${sawFinal}`);
console.log(`[test] saw document_offer: ${sawOffer}`);
console.log('');
console.log('[test] thinking lines captured:');
for (const m of received) {
  if (m.type === 'thinking' && /\[auto-offer\]/.test(m.line)) {
    console.log('  ' + m.line);
  }
}

try { ws.close(); } catch {}
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}

const pass = sawFinal && sawOffer;
console.log('');
console.log('═════════════════════════════════════════════════════');
console.log(pass ? '✅ PASS — direct text response triggers auto-offer' : '❌ FAIL — auto-offer did NOT fire');
console.log('═════════════════════════════════════════════════════');
process.exit(pass ? 0 : 1);
