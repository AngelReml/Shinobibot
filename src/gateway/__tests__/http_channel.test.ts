// Regresión auditoría 2026-07-01 (CRIT-04 + CRIT-05):
//   - CRIT-04: el canal HTTP (`/api/chat`) nunca instalaba el pre-gate de
//     familia que sí monta el WebSocket — un usuario `family` con
//     restricciones no tenía NINGUNA caja vía la API HTTP.
//   - CRIT-05: el canal HTTP llamaba a ShinobiOrchestrator.process()
//     directamente, sin el mutex `runExclusive` que sí usa el WebSocket —
//     dos peticiones concurrentes de canales distintos podían pisarse el
//     estado global `_preGate`.
// Estos tests reproducen el camino real (HTTP end-to-end vía fetch), no una
// versión idealizada que llame a las funciones internas directamente.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../coordinator/orchestrator.js', () => ({
  ShinobiOrchestrator: {
    process: vi.fn(),
    getModel: () => 'mock-model',
  },
}));

import { ShinobiOrchestrator } from '../../coordinator/orchestrator.js';
import { createHttpChannelRouter } from '../http_channel.js';
import { setApprovalMode, setApprovalAsker, requestApproval, clearSessionApprovals } from '../../security/approval.js';
import { _resetMultiuserWiring, userRegistry } from '../../multiuser/multiuser_wiring.js';

function makeChatStore(): any {
  return { add: vi.fn(), list: vi.fn(() => []) };
}

describe('http_channel — family gate (CRIT-04) + mutex serialization (CRIT-05)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    _resetMultiuserWiring();
    clearSessionApprovals();
    setApprovalMode('critical');
    vi.mocked(ShinobiOrchestrator.process).mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api', createHttpChannelRouter({ chatStore: makeChatStore() }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setApprovalAsker(null);
    clearSessionApprovals();
    delete process.env.SHINOBI_USERS_ROOT;
    delete process.env.SHINOBI_TRUST_USER_HEADER;
  });

  it('un usuario family con noShell es bloqueado por el preGate antes de llegar al asker', async () => {
    userRegistry().createFamily({ userId: 'kid', displayName: 'Kid' });
    let askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'yes'; });

    let allowed: boolean | null = null;
    vi.mocked(ShinobiOrchestrator.process).mockImplementation(async () => {
      allowed = await requestApproval({ toolName: 'run_command', args: { command: 'whoami' }, destructive: true, reason: 'test' });
      return { response: 'done' };
    });

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shinobi-User': 'kid' },
      body: JSON.stringify({ text: 'run whoami' }),
    });
    expect(res.status).toBe(200);
    expect(allowed).toBe(false); // family gate denegó — nunca llegó al asker
    expect(askerCalls).toBe(0);
  });

  it('el owner (sin restricciones) sí llega al asker', async () => {
    let askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'yes'; });

    let allowed: boolean | null = null;
    vi.mocked(ShinobiOrchestrator.process).mockImplementation(async () => {
      allowed = await requestApproval({ toolName: 'run_command', args: { command: 'whoami' }, destructive: true, reason: 'test' });
      return { response: 'done' };
    });

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'run whoami' }),
    });
    expect(res.status).toBe(200);
    expect(allowed).toBe(true);
    expect(askerCalls).toBe(1);
  });

  it('serializa peticiones concurrentes vía runExclusive — nunca dos en vuelo a la vez', async () => {
    const order: string[] = [];
    let active = 0;
    vi.mocked(ShinobiOrchestrator.process).mockImplementation(async () => {
      active++;
      order.push(`enter(active=${active})`);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return { response: 'done' };
    });

    const post = () => fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hola' }),
    });

    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Si no estuviera serializado, el segundo entraría con active=2.
    expect(order).toEqual(['enter(active=1)', 'enter(active=1)']);
  });

  it('limpia el preGate tras la petición incluso si el orchestrator lanza (sin fuga de estado entre requests)', async () => {
    userRegistry().createFamily({ userId: 'kid2', displayName: 'Kid2' });
    setApprovalAsker(async () => 'yes');

    vi.mocked(ShinobiOrchestrator.process).mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const failing = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shinobi-User': 'kid2' },
      body: JSON.stringify({ text: 'falla' }),
    });
    expect(failing.status).toBe(500);

    // Petición siguiente, de un usuario SIN restricciones: si el preGate de
    // kid2 hubiera quedado instalado por la fuga, esta también se denegaría.
    let allowed: boolean | null = null;
    vi.mocked(ShinobiOrchestrator.process).mockImplementationOnce(async () => {
      allowed = await requestApproval({ toolName: 'run_command', args: { command: 'whoami' }, destructive: true, reason: 'test' });
      return { response: 'done' };
    });
    const ok = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'owner pide' }),
    });
    expect(ok.status).toBe(200);
    expect(allowed).toBe(true);
  });
});
