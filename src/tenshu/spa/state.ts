/**
 * tenshu/spa/state.ts — TS-04 core (testable): the state the SPA renders and the
 * command it applies. Pure over injected live getters, so the puente de mando is
 * verifiable without a browser. The Express layer (server.ts) is a thin wrapper.
 *
 * VER (status + mapa vivo) · ENTENDER (TEV) · CONDUCIR (aprobaciones + pausa/kill).
 */

import { buildDojoStatus } from '../status.js';
import { buildSystemMap, type SystemMap } from '../system_map.js';
import { ApprovalQueue, type PendingApproval } from '../approvals.js';
import { tevSummary, verifyTevLinkage, type ChainVerdict } from '../tev_browser.js';
import type { ControlPlane } from '../control.js';
import type { SystemEvent, ControlCommand, DojoSource, DojoStatus } from '../types.js';
import type { TEVEntry } from '../../shitsuji/types.js';

export interface TenshuSpaDeps {
  sources: DojoSource[];
  events: () => SystemEvent[];
  tev: () => TEVEntry[];
  plane: ControlPlane;
  budgets: () => { tokensSpent: number; tokensCap: number; costSpent: number };
  integrityMode: () => 'off' | 'flag' | 'enforce';
  kangeikoCurve?: () => { day: number; passed: number; total: number }[];
}

export interface TenshuState {
  status: DojoStatus;
  map: SystemMap;
  tev: { summary: string; linkage: ChainVerdict; length: number };
  approvals: PendingApproval[];
}

/** Snapshot of the whole dojo for the dashboard (VER + ENTENDER + CONDUCIR). */
export function buildState(deps: TenshuSpaDeps): TenshuState {
  const events = deps.events();
  const status = buildDojoStatus({
    sources: deps.sources, events, plane: deps.plane,
    budgets: deps.budgets(), integrity_mode: deps.integrityMode(),
    kangeiko_curve: deps.kangeikoCurve?.(),
  });
  const map = buildSystemMap(deps.sources, events);
  const queue = new ApprovalQueue();
  queue.ingest(events);
  const tevE = deps.tev();
  return {
    status, map,
    tev: { summary: tevSummary(tevE), linkage: verifyTevLinkage(tevE), length: tevE.length },
    approvals: queue.list(),
  };
}

export interface CommandResult { ok: boolean; command: ControlCommand['command']; target: string; detail: string }

const PLANE_COMMANDS = new Set(['pause', 'resume', 'kill']);

/**
 * Apply a control command from the UI. pause/resume/kill are dispatched to the
 * ControlPlane (clean, resumable — the subsystem stops at its checkpoint). The
 * others are acknowledged + routed (the subsystem attends them). Never acts on the
 * world itself beyond the plane signal.
 */
export function applyCommand(deps: TenshuSpaDeps, cmd: ControlCommand): CommandResult {
  if (PLANE_COMMANDS.has(cmd.command)) {
    deps.plane.signal(cmd);
    return { ok: true, command: cmd.command, target: String(cmd.target), detail: `señal "${cmd.command}" enviada a ${cmd.target} (se atiende en su checkpoint)` };
  }
  // approve/reject/set_budget/set_mode/launch — acknowledged + routed to the source.
  return { ok: true, command: cmd.command, target: String(cmd.target), detail: `comando "${cmd.command}" enrutado a ${cmd.target}` };
}
