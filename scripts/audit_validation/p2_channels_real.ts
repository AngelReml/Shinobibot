/**
 * Validación REAL del cableado P2 de canales (Loopback/Webhook).
 * Arranca el subsistema de canales real y comprueba el ciclo completo
 * incoming → handler → outgoing por el Loopback. Webhook se arranca si
 * SHINOBI_WEBHOOK_ENABLED=1.
 *
 * Run: npx tsx scripts/audit_validation/p2_channels_real.ts
 */
import { startChannels, _resetChannelsWiring } from '../../src/channels/channels_wiring.js';
import { channelRegistry, _resetChannelRegistry } from '../../src/channels/channel_registry.js';
import { LoopbackAdapter } from '../../src/channels/adapters/loopback_adapter.js';
import type { IncomingMessage } from '../../src/channels/types.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  _resetChannelRegistry();
  _resetChannelsWiring();
  process.env.SHINOBI_WEBHOOK_ENABLED = '1';

  // Handler de prueba (eco) para validar el fan-out sin gastar LLM; en
  // producción startChannels usa el handler que enruta al orchestrator.
  let handlerCalls = 0;
  const echo = async (msg: IncomingMessage) => { handlerCalls++; return { text: `eco: ${msg.text}` }; };

  console.log('=== startChannels ===');
  const r = await startChannels({ handler: echo });
  console.log(`  arrancados=[${r.started.join(', ')}], skipped=[${r.skipped.join(', ')}], errores=${r.errors.length}`);
  check('el registry arranca el Loopback', r.started.includes('loopback'), `started=[${r.started}]`);
  check('el Webhook arranca con SHINOBI_WEBHOOK_ENABLED=1', r.started.includes('webhook'), `started=[${r.started}]`);

  // Ciclo completo incoming → handler → outgoing por el Loopback.
  console.log('\n=== Ciclo incoming → handler → outgoing (Loopback) ===');
  const loopback = channelRegistry().get('loopback') as LoopbackAdapter;
  const reply = await loopback.simulateIncoming({ text: 'hola desde un canal', userId: 'u1' });
  console.log(`  incoming "hola desde un canal" -> reply: ${JSON.stringify(reply)}`);
  check('el mensaje entrante llega al handler', handlerCalls === 1, `${handlerCalls} llamada(s)`);
  check('el handler produce una respuesta', !!reply && /eco: hola/.test(reply.text || ''), reply?.text ?? '');
  check('la respuesta se deposita en el outbox', loopback.peekOutbox().length === 1, `${loopback.peekOutbox().length} en outbox`);

  // summary() refleja el estado.
  const summary = channelRegistry().summary();
  const lb = summary.find((s) => s.id === 'loopback');
  console.log(`  summary loopback: running=${lb?.running}, received=${lb?.received}, sent=${lb?.sent}`);
  check('summary refleja el canal corriendo con tráfico', !!lb && lb.running && lb.received === 1 && lb.sent === 1,
    JSON.stringify(lb));

  await channelRegistry().shutdown();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
