#!/usr/bin/env node
/**
 * Prueba funcional Sprint P3.1 — Zed IDE bridge.
 *
 * Simula que Zed manda mensajes ACP a Shinobi vía stdio:
 *   1. initialize
 *   2. session/new
 *   3. session/prompt 'audita este archivo'
 *   4. session/cancel
 *
 * Validamos que cada respuesta es JSON-RPC válido + capabilities
 * vienen en initialize + handler real responde a prompts.
 */

import { Readable, Writable } from 'stream';
import { ZedBridge, SHINOBI_ZED_CAPS } from '../../src/a2a/zed_bridge.js';
import { A2ADispatcher } from '../../src/a2a/protocol.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint P3.1 — Zed IDE bridge ===');

  const dispatcher = new A2ADispatcher({ selfId: 'shinobi' });
  dispatcher.on('mission_handoff', async (env) => {
    const params = (env.payload as any).acpParams;
    if ((env.payload as any).acpMethod === 'session/new') {
      return { result: { sessionId: 'sess_' + Date.now() } };
    }
    return { result: { cancelled: true, params } };
  });
  dispatcher.on('capability_invoke', async (env) => ({
    result: { reply: 'Shinobi recibió: ' + (env.payload as any).acpParams.text },
  }));

  const lines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { text: 'audita src/a2a/' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'session/cancel' }),
  ];

  let idx = 0;
  const stdin = new Readable({
    read() {
      if (idx < lines.length) this.push(lines[idx++] + '\n');
      else this.push(null);
    },
  });

  const out: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      out.push(chunk.toString().trim());
      cb();
    },
  });
  const stderrOut: string[] = [];
  const stderr = new Writable({
    write(chunk, _enc, cb) { stderrOut.push(chunk.toString()); cb(); },
  });

  const bridge = new ZedBridge({
    selfId: 'shinobi',
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stderr as any,
  });

  await bridge.serveStdio(dispatcher);

  console.log('\n--- 1. Cada line de Zed produce 1 response ACP ---');
  check(out.length === 4, `4 responses (got ${out.length})`);

  console.log('\n--- 2. initialize devuelve capabilities ---');
  const init = JSON.parse(out[0]);
  check(init.id === 1, 'id propagado');
  check(init.result.protocolVersion === 'acp/1', 'protocolVersion=acp/1');
  check(init.result.capabilities.fileAttachments === true, 'fileAttachments=true');
  check(init.result.capabilities.cancellation === true, 'cancellation=true');

  console.log('\n--- 3. session/new genera sessionId ---');
  const newSess = JSON.parse(out[1]);
  check(typeof newSess.result.sessionId === 'string', 'sessionId string');
  check(newSess.result.sessionId.startsWith('sess_'), 'sessionId con prefijo');

  console.log('\n--- 4. session/prompt llega al handler ---');
  const prompt = JSON.parse(out[2]);
  check(prompt.result.reply.includes('audita src/a2a/'), 'handler procesó prompt');

  console.log('\n--- 5. session/cancel también funciona ---');
  const cancel = JSON.parse(out[3]);
  check(cancel.result.cancelled === true, 'cancel respondido');

  console.log('\n--- 6. stderr logs sin contaminar stdout ---');
  check(out.every(l => l.startsWith('{')), 'todo stdout es JSON-RPC');
  check(stderrOut.some(l => l.includes('listening')), 'stderr tiene log de boot');

  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · Zed IDE bridge stdio (paridad OpenClaw acpx)');
}

main().catch((e) => {
  console.error('Sprint P3.1 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
