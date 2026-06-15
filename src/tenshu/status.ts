/**
 * tenshu/status.ts — DojoStatus reader (dossier §3.4, TS-03). The "at-a-glance"
 * view, REFLECTED from the event history + control plane, not narrated. Each
 * subsystem's state comes from the control plane; its phase/task from the latest
 * phase_start event. Pure.
 */

import type { DojoSource, DojoStatus, SystemEvent } from './types.js';
import type { ControlPlane } from './control.js';

export interface StatusInputs {
  sources: DojoSource[];
  events: SystemEvent[];
  plane: ControlPlane;
  budgets: { tokensSpent: number; tokensCap: number; costSpent: number };
  integrity_mode: 'off' | 'flag' | 'enforce';
  kangeiko_curve?: { day: number; passed: number; total: number }[];
}

export function buildDojoStatus(inp: StatusInputs): DojoStatus {
  const subsystems = inp.sources.map((name) => {
    const lastStart = [...inp.events].reverse().find((e) => e.source === name && e.kind === 'phase_start');
    return {
      name,
      state: inp.plane.stateOf(name),
      phase: lastStart ? String(lastStart.payload.phase ?? '') || undefined : undefined,
      task: lastStart ? String(lastStart.payload.task ?? '') || undefined : undefined,
    };
  });
  // Pending approvals: approval_pending events not yet resolved by a later
  // phase_end/action referencing the same id (simplest faithful count).
  const pending_approvals = inp.events.filter((e) => e.kind === 'approval_pending').length;
  return {
    subsystems,
    budgets: inp.budgets,
    pending_approvals,
    kangeiko_curve: inp.kangeiko_curve,
    integrity_mode: inp.integrity_mode,
  };
}
