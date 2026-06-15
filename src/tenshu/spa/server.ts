/**
 * tenshu/spa/server.ts — TS-04: the local SPA server (gated by TENSHU_ENABLED). Thin
 * Express wiring over the testable core (state.ts): serves the dashboard HTML, a
 * read endpoint (GET /api/tenshu/state) and a control endpoint (POST /api/tenshu/command).
 * Read-only by default; the only side effects are ControlPlane signals (pause/kill/
 * resume) — the clean kill switch reachable from the UI (the TS-04 GATE).
 */

import express from 'express';
import type { Express } from 'express';
import { tenshuEnabled } from '../config.js';
import { buildState, applyCommand, type TenshuSpaDeps } from './state.js';
import { SPA_HTML } from './page.js';
import type { ControlCommand, CommandKind, DojoSource } from '../types.js';

const VALID_COMMANDS = new Set<CommandKind>(['pause', 'resume', 'kill', 'set_budget', 'approve', 'reject', 'set_mode', 'launch']);

/** Build the Express app for the Tenshu dashboard. Pure wiring over the deps. */
export function createTenshuApp(deps: TenshuSpaDeps): Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => { res.type('html').send(SPA_HTML); });

  app.get('/api/tenshu/state', (_req, res) => {
    try { res.json(buildState(deps)); }
    catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
  });

  app.post('/api/tenshu/command', (req, res) => {
    const body = (req.body ?? {}) as Partial<ControlCommand>;
    if (!body.command || !VALID_COMMANDS.has(body.command) || !body.target) {
      res.status(400).json({ ok: false, error: 'command/target inválidos' });
      return;
    }
    const cmd: ControlCommand = { command: body.command, target: body.target as DojoSource | 'all', args: body.args };
    res.json(applyCommand(deps, cmd));
  });

  return app;
}

export interface TenshuSpaServer { port: number; close: () => Promise<void>; }

/**
 * Start the dashboard on `port` (default 3334). Gated: refuses unless TENSHU_ENABLED,
 * so it never opens a control surface in production by accident.
 */
export async function startTenshuSpa(deps: TenshuSpaDeps, port = 3334): Promise<TenshuSpaServer> {
  if (!tenshuEnabled()) throw new Error('tenshu: SPA deshabilitada (TENSHU_ENABLED off)');
  const app = createTenshuApp(deps);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
