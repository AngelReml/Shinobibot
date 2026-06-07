#!/usr/bin/env node
/**
 * Prueba funcional Sprint P1.1 — 5 channel adapters nuevos.
 *
 * Como no podemos arrancar WhatsApp Web/Signal-cli/Matrix/Teams reales
 * desde Claude Code, validamos:
 *   1. Que los 5 adapters existen, exportan la interfaz correcta y
 *      cumplen ChannelAdapter contract.
 *   2. Que isConfigured() refleja correctamente la presencia/ausencia
 *      de env vars.
 *   3. Que el Webhook adapter (única dep cero-externa) hace E2E real:
 *      arranque, POST entrante, handler, response.
 */

import { request as httpRequest } from 'http';
import { WhatsAppAdapter } from '../../src/channels/adapters/whatsapp_adapter.js';
import { SignalAdapter } from '../../src/channels/adapters/signal_adapter.js';
import { MatrixAdapter } from '../../src/channels/adapters/matrix_adapter.js';
import { TeamsAdapter } from '../../src/channels/adapters/teams_adapter.js';
import { WebhookAdapter } from '../../src/channels/adapters/webhook_adapter.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

function httpPost(port: number, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        let parsed: any = buf;
        try { parsed = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  console.log('=== Sprint P1.1 — 5 channel adapters nuevos ===');

  // ── 1. Contract compliance ──
  console.log('\n--- 1. ChannelAdapter contract ---');
  const adapters = [
    new WhatsAppAdapter(),
    new SignalAdapter(),
    new MatrixAdapter(),
    new TeamsAdapter(),
    new WebhookAdapter(),
  ];
  for (const a of adapters) {
    check(typeof a.id === 'string' && a.id.length > 0, `${a.label}: id presente`);
    check(typeof a.isConfigured === 'function', `${a.label}: isConfigured()`);
    check(typeof a.requiredEnvVars === 'function', `${a.label}: requiredEnvVars()`);
    check(typeof a.start === 'function', `${a.label}: start()`);
    check(typeof a.stop === 'function', `${a.label}: stop()`);
    check(typeof a.send === 'function', `${a.label}: send()`);
    check(a.status().running === false, `${a.label}: status() running=false inicial`);
  }

  // ── 2. isConfigured se comporta con env vars ──
  console.log('\n--- 2. isConfigured() reactivo a env ---');
  delete process.env.SHINOBI_WHATSAPP_ENABLED;
  check(new WhatsAppAdapter().isConfigured() === false, 'WA sin flag → no config');
  process.env.SHINOBI_WHATSAPP_ENABLED = '1';
  check(new WhatsAppAdapter().isConfigured() === true, 'WA con flag → config');
  delete process.env.SHINOBI_WHATSAPP_ENABLED;

  // ── 3. Webhook E2E real ──
  console.log('\n--- 3. Webhook E2E real (sin deps externas) ---');
  process.env.SHINOBI_WEBHOOK_ENABLED = '1';
  process.env.WEBHOOK_LISTEN_PORT = '14100';
  const webhook = new WebhookAdapter();
  let lastIncoming: any = null;
  await webhook.start(async (m) => {
    lastIncoming = m;
    return { text: `Shinobi: recibido "${m.text}"` };
  });
  try {
    const r1 = await httpPost(14100, '/webhook/incoming', {
      text: 'hola desde webhook',
      userId: 'integration-test',
    });
    check(r1.status === 200, 'POST 200');
    check(r1.body.text === 'Shinobi: recibido "hola desde webhook"', 'response text correcto');
    check(lastIncoming?.target?.userId === 'integration-test', 'userId propagado');
    check(webhook.status().receivedCount === 1, 'receivedCount=1');
    check(webhook.status().sentCount === 1, 'sentCount=1');

    const r2 = await httpPost(14100, '/webhook/incoming', { userId: 'x' }); // sin text
    check(r2.status === 400, '400 sin text');

    const r3 = await httpPost(14100, '/other-path', { text: 'x' });
    check(r3.status === 404, '404 path desconocido');
  } finally {
    await webhook.stop();
  }
  check(webhook.status().running === false, 'webhook stopped tras stop()');

  // ── 4. Fail-fast de deps no instaladas ──
  console.log('\n--- 4. Fail-fast con instrucciones claras ---');
  process.env.SHINOBI_WHATSAPP_ENABLED = '1';
  try {
    await new WhatsAppAdapter().start(async () => null);
    check(false, 'WA debería throw sin whatsapp-web.js');
  } catch (e: any) {
    check(/whatsapp-web\.js/.test(e.message), 'WA fail-fast menciona dep');
  }
  delete process.env.SHINOBI_WHATSAPP_ENABLED;

  process.env.MATRIX_HOMESERVER_URL = 'https://x';
  process.env.MATRIX_ACCESS_TOKEN = 'tok';
  process.env.MATRIX_BOT_USER_ID = '@b:x';
  try {
    await new MatrixAdapter().start(async () => null);
    check(false, 'Matrix debería throw');
  } catch (e: any) {
    check(/matrix-bot-sdk/.test(e.message), 'Matrix fail-fast menciona dep');
  }

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · 5 adapters nuevos compliant con ChannelAdapter');
}

main().catch((e) => {
  console.error('Sprint P1.1 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
