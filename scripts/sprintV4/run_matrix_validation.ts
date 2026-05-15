#!/usr/bin/env node
/**
 * FASE V4 (Matrix) — validación real contra el homeserver nope.chat.
 *
 * Flujo completo:
 *   1. whoami            — verifica el token + obtiene user_id/device.
 *   2. createRoom        — crea una sala privada de pruebas.
 *   3. send              — el bot manda un mensaje a la sala.
 *   4. sync/messages     — el bot lee la sala y confirma que su propio
 *                          mensaje llegó (eco).
 *   5. (cleanup)         — sale de la sala de pruebas.
 *
 * Mide latencia de cada paso. Evidencia cruda a stdout.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: true });

const HS = process.env.MATRIX_HOMESERVER_URL!;
const TOKEN = process.env.MATRIX_ACCESS_TOKEN!;

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${HS}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: Date.now() - t0 };
}

async function main(): Promise<void> {
  console.log('=== FASE V4 (Matrix) — validación real nope.chat ===\n');
  if (!HS || !TOKEN) {
    console.error('FALLO: MATRIX_HOMESERVER_URL o MATRIX_ACCESS_TOKEN ausentes');
    process.exit(1);
  }
  console.log(`Homeserver: ${HS}`);

  let failed = 0;
  const check = (c: boolean, l: string): void => {
    if (c) console.log(`  ok  ${l}`);
    else { console.log(`  FAIL ${l}`); failed++; }
  };
  const latency: Record<string, number> = {};

  // ── 1. whoami ──
  console.log('\n--- 1. whoami (auth) ---');
  const who = await api('GET', '/_matrix/client/v3/account/whoami');
  latency.whoami = who.ms;
  console.log(`  ${who.status} · ${JSON.stringify(who.json)} · ${who.ms}ms`);
  check(who.status === 200 && !!who.json.user_id, 'token válido, user_id presente');
  const botUserId: string = who.json.user_id;

  // ── 2. createRoom ──
  console.log('\n--- 2. createRoom (sala de pruebas privada) ---');
  const create = await api('POST', '/_matrix/client/v3/createRoom', {
    name: 'Shinobi V4 — sala de validación',
    topic: 'Sala temporal creada por la FASE V4 del plan de validación externa.',
    preset: 'private_chat',
    visibility: 'private',
  });
  latency.createRoom = create.ms;
  console.log(`  ${create.status} · ${JSON.stringify(create.json)} · ${create.ms}ms`);
  check(create.status === 200 && !!create.json.room_id, 'sala creada con room_id');
  const roomId: string = create.json.room_id;

  // ── 3. send ──
  console.log('\n--- 3. send (bot manda mensaje a la sala) ---');
  const marker = 'shinobi-v4-' + Date.now().toString(36);
  const txnId = 'txn-' + Date.now();
  const sent = await api(
    'PUT',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    { msgtype: 'm.text', body: `Mensaje de validación V4 · ${marker}` },
  );
  latency.send = sent.ms;
  console.log(`  ${sent.status} · ${JSON.stringify(sent.json)} · ${sent.ms}ms`);
  check(sent.status === 200 && !!sent.json.event_id, 'mensaje enviado con event_id');
  const sentEventId: string = sent.json.event_id;

  // ── 4. read back (eco) ──
  console.log('\n--- 4. messages (bot lee la sala y confirma el eco) ---');
  // Pequeña espera para que el evento se asiente.
  await new Promise((r) => setTimeout(r, 1500));
  const msgs = await api(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
  );
  latency.messages = msgs.ms;
  const chunk: any[] = msgs.json.chunk ?? [];
  const echoed = chunk.find(
    (e) => e.type === 'm.room.message' && e.content?.body?.includes(marker),
  );
  console.log(`  ${msgs.status} · ${chunk.length} eventos · ${msgs.ms}ms`);
  if (echoed) {
    console.log(`  eco encontrado: event_id=${echoed.event_id} body="${echoed.content.body}"`);
  }
  check(msgs.status === 200, 'lectura de mensajes OK');
  check(!!echoed, 'el mensaje del bot aparece de vuelta (eco confirmado)');
  check(echoed?.event_id === sentEventId, 'event_id del eco coincide con el enviado');
  check(echoed?.sender === botUserId, 'sender del eco es el propio bot');

  // ── 5. cleanup ──
  console.log('\n--- 5. cleanup (salir de la sala de pruebas) ---');
  const leave = await api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`);
  console.log(`  leave ${leave.status}`);

  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify({
    homeserver: HS,
    botUserId,
    roomId,
    auth: who.status === 200,
    write: sent.status === 200,
    read: msgs.status === 200,
    echo: !!echoed,
    latencyMs: latency,
  }, null, 2));

  if (failed > 0) {
    console.log(`\nMATRIX FALLIDO · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('\nMATRIX OK · auth + createRoom + send + echo verificados contra nope.chat');
}

main().catch((e) => {
  console.error('V4 Matrix crashed:', e?.stack ?? e);
  process.exit(2);
});
