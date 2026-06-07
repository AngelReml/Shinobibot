#!/usr/bin/env node
/**
 * Prueba funcional Sprint 1.3 — Multi-canal extensible.
 *
 * Demuestra que la arquitectura de canales funciona end-to-end:
 *
 *   1. Registramos cuatro adaptadores: loopback + discord + slack + email.
 *      Solo loopback está "configurado" (no requiere env vars). Los otros
 *      tres están en la lista pero `isConfigured() === false`.
 *
 *   2. El registry los lista correctamente, indica qué env vars necesita
 *      cada uno y arranca SOLO los configurados.
 *
 *   3. Mandamos 3 mensajes por loopback y vemos que el handler responde,
 *      el outbox se llena y los counters incrementan.
 *
 *   4. Verificamos que `registry.send()` proactivo a un canal NO
 *      configurado (discord/slack/email) falla con mensaje claro,
 *      enumerando las env vars que faltan — exactamente lo que un
 *      operador necesita saber para activar el canal.
 *
 * Para activar Discord/Slack/Email contra cuentas reales hace falta
 * alta humana de credenciales (documentado al final del script).
 */

import { channelRegistry, _resetChannelRegistry } from '../../src/channels/channel_registry.js';
import { LoopbackAdapter } from '../../src/channels/adapters/loopback_adapter.js';
import { DiscordAdapter } from '../../src/channels/adapters/discord_adapter.js';
import { SlackAdapter } from '../../src/channels/adapters/slack_adapter.js';
import { EmailAdapter } from '../../src/channels/adapters/email_adapter.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  // Empezamos limpios y sin env vars de plataformas reales.
  _resetChannelRegistry();
  for (const k of [
    'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN',
    'IMAP_HOST', 'IMAP_USER', 'IMAP_PASS', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  ]) delete process.env[k];

  const r = channelRegistry();
  const loopback = new LoopbackAdapter();
  r.register(loopback);
  r.register(new DiscordAdapter());
  r.register(new SlackAdapter());
  r.register(new EmailAdapter());

  console.log('=== Sprint 1.3 — Multi-canal extensible ===\n');
  console.log('--- Registry summary (antes de start) ---');
  for (const s of r.summary()) {
    console.log(`  ${s.id.padEnd(10)} configured=${s.configured ? 'yes' : 'NO'} requires=[${s.requires.join(', ')}]`);
  }

  check(r.list().length === 4, '4 adapters registrados (loopback + 3 reales)');
  check(r.get('loopback')?.isConfigured() === true, 'loopback configured (no requiere env)');
  check(r.get('discord')?.isConfigured() === false, 'discord NOT configured (sin DISCORD_BOT_TOKEN)');
  check(r.get('slack')?.isConfigured() === false, 'slack NOT configured (sin SLACK_*)');
  check(r.get('email')?.isConfigured() === false, 'email NOT configured (sin IMAP/SMTP)');

  // Handler de prueba: eco simple.
  let handlerCalls = 0;
  r.bindHandler(async (msg) => {
    handlerCalls++;
    return { text: `Shinobi: recibí "${msg.text}" en ${msg.channelId}` };
  });

  console.log('\n--- start() ---');
  const startResult = await r.start();
  console.log(`  started: ${JSON.stringify(startResult.started)}`);
  console.log(`  skipped: ${JSON.stringify(startResult.skipped)}`);
  console.log(`  errors:  ${JSON.stringify(startResult.errors)}`);

  check(startResult.started.includes('loopback'), 'loopback arrancado');
  check(startResult.skipped.includes('discord'), 'discord skipped (sin token, no error)');
  check(startResult.skipped.includes('slack'), 'slack skipped (sin tokens)');
  check(startResult.skipped.includes('email'), 'email skipped (sin IMAP/SMTP)');
  check(startResult.errors.length === 0, 'cero errores al arrancar');

  console.log('\n--- E2E roundtrip por loopback ---');
  const messages = [
    { text: 'hola, qué tal', userId: 'alice' },
    { text: 'cuál es el clima', userId: 'bob' },
    { text: 'gracias', userId: 'alice' },
  ];
  for (const m of messages) {
    const reply = await loopback.simulateIncoming(m);
    console.log(`  '${m.text}' -> '${reply?.text}'`);
  }

  check(handlerCalls === 3, 'handler invocado 3 veces');
  check(loopback.status().receivedCount === 3, 'receivedCount = 3');
  check(loopback.status().sentCount === 3, 'sentCount = 3');
  check(loopback.peekOutbox().length === 3, 'outbox tiene 3 mensajes');
  check(loopback.peekOutbox()[0].msg.text.includes('hola, qué tal'), 'primer outbox refleja el input');

  console.log('\n--- send() proactivo a canal NO configurado ---');
  for (const cid of ['discord', 'slack', 'email'] as const) {
    try {
      await r.send({ channelId: cid, conversationId: 'x' }, { text: 'hello' });
      check(false, `${cid} debería haber rechazado`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      check(msg.includes('no está configurado'), `${cid} rechazó con mensaje claro`, msg.slice(0, 90));
    }
  }

  console.log('\n--- shutdown() ---');
  await r.shutdown();
  check(loopback.status().running === false, 'loopback dejó de correr tras shutdown');

  console.log('\n=== Credenciales requeridas por el operador ===');
  for (const s of r.summary()) {
    if (s.id === 'loopback') continue;
    console.log(`  ${s.id.padEnd(10)} ${s.requires.length ? 'set: ' + s.requires.join(', ') : '(sin envs)'}`);
  }

  console.log('\n=== Summary ===');
  if (failed > 0) {
    console.log(`FAIL · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('PASS · arquitectura de canales funciona; 3 adapters reales esperan credenciales humanas');
}

main().catch((e) => {
  console.error('Channels test crashed:', e?.stack ?? e);
  process.exit(2);
});
