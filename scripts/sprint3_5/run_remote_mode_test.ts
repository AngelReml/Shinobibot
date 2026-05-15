#!/usr/bin/env node
/**
 * Prueba funcional Sprint 3.5 — Modo VPS aislado.
 *
 * El sprint pide validar contra Contabo root@167.86.80.220. Como NO
 * tenemos acceso a la SSH key del operador desde Claude Code, NO
 * ejecutamos el deploy real. En su lugar:
 *
 *   1. Parseamos la URL del Contabo y verificamos kind/user/host/port.
 *   2. Generamos los artefactos (Dockerfile.remote, compose, script,
 *      env.template) en un staging dir y verificamos su contenido.
 *   3. Validamos que el script generado NO incluye comandos
 *      destructivos sobre la máquina LOCAL.
 *   4. Ejecutamos `healthCheck` contra un fetch mock (probando los 4
 *      caminos: ok, HTTP 500, network error, timeout).
 *
 * Las instrucciones imprimidas al final son las EXACTAS que el operador
 * ejecuta cuando quiera deploy real.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseRemoteUrl,
  generateArtifacts,
  writeArtifacts,
  healthCheck,
  renderInstructions,
} from '../../src/runtime/remote_mode.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint 3.5 — Modo VPS aislado opcional ===');
  const work = mkdtempSync(join(tmpdir(), 'sprint3_5-'));

  try {
    // ── Step 1: parsear URL del Contabo del adenda ──
    console.log('\n--- 1. Parsear URL Contabo ssh://root@167.86.80.220 ---');
    const target = parseRemoteUrl('ssh://root@167.86.80.220');
    console.log(`  kind=${target.kind} user=${target.user} host=${target.host} port=${target.port}`);
    check(target.kind === 'ssh', 'kind=ssh');
    check(target.user === 'root', 'user=root');
    check(target.host === '167.86.80.220', 'host correcto');
    check(target.port === 22, 'port=22 default');

    // Otros formatos.
    check(parseRemoteUrl('admin@1.2.3.4').user === 'admin', 'shorthand user@host');
    check(parseRemoteUrl('https://kernel.example.com:8443').kind === 'https', 'https URL');

    // ── Step 2: generar artefactos ──
    console.log('\n--- 2. Generar artefactos de deploy ---');
    const artifacts = generateArtifacts(target);
    const paths = writeArtifacts(work, artifacts);
    console.log(`  Generados ${paths.length} archivos en ${work}:`);
    for (const p of paths) {
      const size = readFileSync(p, 'utf-8').length;
      console.log(`    ${p.split(/[\\/]/).pop()} (${size} bytes)`);
    }
    check(paths.length === 4, '4 archivos generados');
    check(paths.every(p => existsSync(p)), 'todos existen en disco');

    const dockerfile = readFileSync(paths.find(p => p.endsWith('Dockerfile.remote'))!, 'utf-8');
    check(dockerfile.includes('FROM node:22-bookworm-slim'), 'Dockerfile usa node:22 slim');

    const compose = readFileSync(paths.find(p => p.endsWith('.yml'))!, 'utf-8');
    check(compose.includes('127.0.0.1:3333:3333'), 'compose bind a 127.0.0.1 (no expuesto a internet)');

    const script = readFileSync(paths.find(p => p.endsWith('.sh'))!, 'utf-8');
    check(script.includes('root@167.86.80.220'), 'script usa el target correcto');
    check(script.includes('rsync'), 'script usa rsync para subir código');
    check(script.includes('docker compose up'), 'script lanza docker compose');
    check(script.includes('ssh -p "$SSH_PORT" -N -L'), 'script abre túnel SSH');

    // ── Step 3: el script NO toca la máquina local ──
    console.log('\n--- 3. Verificar que el script NO ejecuta destructivos en local ---');
    const forbiddenLocal = [
      'rm -rf /', 'Stop-Process', 'taskkill /F', 'format C:', 'del /F /S',
    ];
    let safe = true;
    for (const bad of forbiddenLocal) {
      if (script.includes(bad)) { safe = false; console.log(`    !!! contiene ${bad}`); }
    }
    check(safe, 'script NO contiene comandos destructivos');

    // ── Step 4: health checks con fetch mock ──
    console.log('\n--- 4. healthCheck con fetch mocks ---');
    const okR = await healthCheck({ url: 'http://localhost:3333/api/status', fetchImpl: async () => ({ ok: true, status: 200 }) });
    console.log(`  ok mock: ok=${okR.ok} status=${okR.status} latency=${okR.latencyMs}ms`);
    check(okR.ok && okR.status === 200, 'mock 200 → ok=true');

    const errR = await healthCheck({ url: 'http://x', fetchImpl: async () => ({ ok: false, status: 503 }) });
    check(!errR.ok && !!errR.error?.includes('503'), 'mock 503 → ok=false con error HTTP');

    const throwR = await healthCheck({ url: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    check(!throwR.ok && !!throwR.error?.includes('ECONNREFUSED'), 'mock throw → ok=false con error');

    const timeoutR = await healthCheck({ url: 'http://x', timeoutMs: 50, fetchImpl: () => new Promise(() => { /* never */ }) });
    check(!timeoutR.ok && /timeout/.test(timeoutR.error || ''), 'mock timeout → error timeout');

    // ── Step 5: instrucciones para el operador ──
    console.log('\n--- 5. Instrucciones de deploy (no ejecutadas, requieren SSH key humana) ---');
    const lines = renderInstructions(target, paths);
    for (const line of lines.slice(0, 12)) console.log(`  ${line}`);
    check(lines.some(l => l.includes('root@167.86.80.220')), 'instrucciones mencionan el target');
    check(lines.some(l => l.includes('docker compose')), 'instrucciones mencionan docker compose');

    console.log('\n=== Summary ===');
    if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
    console.log('PASS · arquitectura modo remoto lista; deploy real requiere SSH key del operador');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Remote mode test crashed:', e?.stack ?? e);
  process.exit(2);
});
