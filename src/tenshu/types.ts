/**
 * tenshu/types.ts — event/command/status model (dossier §3.4). Pure types.
 */

export type DojoSource = 'kagemusha' | 'kagami' | 'chizu' | 'shugyo' | 'shitsuji' | 'kangeiko';
export type SubsystemState = 'idle' | 'running' | 'paused' | 'halted';

export interface SystemEvent {
  event_id: string;
  source: DojoSource;
  kind: 'phase_start' | 'phase_end' | 'action' | 'skill_certified' | 'approval_pending' | 'error' | 'metric' | 'frontier_update';
  payload: Record<string, unknown>;
  ts: string;
  trace_ref?: string;          // link to the TEV if it applies (the anchor for §3.5)
}

export type CommandKind = 'pause' | 'resume' | 'kill' | 'set_budget' | 'approve' | 'reject' | 'set_mode' | 'launch';

export interface ControlCommand {
  command: CommandKind;
  target: DojoSource | 'all';
  args?: Record<string, unknown>;
}

export interface DojoStatus {
  subsystems: { name: string; state: SubsystemState; phase?: string; task?: string }[];
  budgets: { tokensSpent: number; tokensCap: number; costSpent: number };
  pending_approvals: number;
  kangeiko_curve?: { day: number; passed: number; total: number }[];
  integrity_mode: 'off' | 'flag' | 'enforce';
}
