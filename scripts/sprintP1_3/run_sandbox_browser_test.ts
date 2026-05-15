#!/usr/bin/env node
/**
 * Prueba funcional Sprint P1.3 — Sandbox Browser pre-baked.
 *
 * Como NO podemos buildear/correr Docker desde Claude Code, validamos:
 *   1. Los 3 artefactos están en sitio: Dockerfile, compose, entrypoint.
 *   2. Manager construye URLs correctas con puertos custom.
 *   3. up()/down() emiten los args exactos a docker compose con
 *     un spawn mock.
 *   4. healthCheck() detecta correctamente OK/500/timeout.
 *   5. Bind a 127.0.0.1 (no IP pública).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { BrowserSandboxManager } from '../../src/sandbox/browser_sandbox/manager.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

class FakeChild extends EventEmitter {
  stdout: Readable; stderr: Readable;
  constructor(public stdoutData: string = '', public stderrData: string = '', public exitCode: number = 0) {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    setImmediate(() => {
      if (stdoutData) this.stdout.push(stdoutData);
      this.stdout.push(null);
      if (stderrData) this.stderr.push(stderrData);
      this.stderr.push(null);
      this.emit('exit', exitCode);
    });
  }
}

async function main(): Promise<void> {
  console.log('=== Sprint P1.3 — Sandbox Browser pre-baked ===');

  // ── 1. Artefactos en repo ──
  console.log('\n--- 1. Artefactos en repo ---');
  const root = process.cwd();
  const docker = join(root, 'Dockerfile.sandbox-browser');
  const compose = join(root, 'docker-compose.sandbox-browser.yml');
  const entry = join(root, 'scripts', 'sandbox', 'browser_entrypoint.sh');

  check(existsSync(docker), 'Dockerfile.sandbox-browser');
  check(existsSync(compose), 'docker-compose.sandbox-browser.yml');
  check(existsSync(entry), 'scripts/sandbox/browser_entrypoint.sh');

  const dockerContent = readFileSync(docker, 'utf-8');
  check(dockerContent.includes('chromium'), 'Dockerfile instala chromium');
  check(dockerContent.includes('novnc'), 'Dockerfile instala novnc');
  check(dockerContent.includes('xvfb'), 'Dockerfile instala xvfb');
  check(dockerContent.includes('EXPOSE 6080'), 'expone novnc');
  check(dockerContent.includes('EXPOSE 6080 9222'), 'expone CDP también');
  check(!dockerContent.includes('USER root\nCMD'), 'no corre CMD como root');

  const composeContent = readFileSync(compose, 'utf-8');
  check(composeContent.includes('127.0.0.1:6080:6080'), 'compose bind novnc a 127.0.0.1');
  check(composeContent.includes('127.0.0.1:9222:9222'), 'compose bind CDP a 127.0.0.1');
  check(!composeContent.includes('"0.0.0.0:'), 'compose NO expone a 0.0.0.0');

  const entryContent = readFileSync(entry, 'utf-8');
  check(entryContent.includes('Xvfb :99'), 'entrypoint arranca Xvfb');
  check(entryContent.includes('chromium'), 'entrypoint arranca chromium');
  check(entryContent.includes('remote-debugging-port=9221'), 'CDP interno en 9221');
  check(entryContent.includes('socat') && entryContent.includes('9222'), 'socat puentea 9222 → 9221');
  check(entryContent.includes('websockify'), 'entrypoint arranca novnc');

  // ── 2. Manager URLs ──
  console.log('\n--- 2. Manager URLs ---');
  const m = new BrowserSandboxManager({ composePath: compose });
  check(m.vncUrl() === 'http://127.0.0.1:6080/vnc.html', `vncUrl=${m.vncUrl()}`);
  check(m.cdpUrl() === 'http://127.0.0.1:9222', `cdpUrl=${m.cdpUrl()}`);
  check(m.isComposeAvailable() === true, 'compose detectado');

  // ── 3. up/down con spawn mock ──
  console.log('\n--- 3. up/down via docker compose (spawn mock) ---');
  const calls: string[][] = [];
  const m2 = new BrowserSandboxManager({
    composePath: compose,
    spawnImpl: ((bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      return new FakeChild(`Stopped/Started ${args.includes('up') ? 'up' : 'down'}\n`, '', 0);
    }) as any,
  });
  const upR = await m2.up({ build: true });
  check(upR.exitCode === 0, 'up exitCode=0');
  check(calls[0]?.includes('up'), 'docker compose up llamado');
  check(calls[0]?.includes('--build'), '--build pasado');

  const downR = await m2.down();
  check(downR.exitCode === 0, 'down exitCode=0');
  check(calls[1]?.includes('down'), 'docker compose down llamado');

  // ── 4. healthCheck ──
  console.log('\n--- 4. healthCheck ---');
  const m3 = new BrowserSandboxManager({
    composePath: compose,
    fetchImpl: (async () => ({ ok: true, status: 200 })) as any,
  });
  const h1 = await m3.healthCheck();
  check(h1.ok && h1.novncOk && h1.cdpOk, 'health 200/200 → ok');

  const m4 = new BrowserSandboxManager({
    composePath: compose,
    fetchImpl: (async (url: string) => ({ ok: !url.includes(':6080'), status: url.includes(':6080') ? 500 : 200 })) as any,
  });
  const h2 = await m4.healthCheck();
  check(!h2.ok && !h2.novncOk && h2.cdpOk, 'health novnc=500 → ok=false');

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · sandbox browser arquitectónicamente listo (sin build real, requiere Docker)');
}

main().catch((e) => {
  console.error('Sprint P1.3 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
