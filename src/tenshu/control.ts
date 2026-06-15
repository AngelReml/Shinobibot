/**
 * tenshu/control.ts — command channel + CLEAN kill switch (dossier §3.3/§5, TS-02).
 * THE protagonist piece: stop Shinobi at will WITHOUT corrupting its state,
 * resumable. Each subsystem attends the signal at a SAFE checkpoint (its own
 * control point), persists, and stops — never mid-write. Power without a clean
 * off-switch is dangerous, not impressive. Pure, in-process.
 */

import type { ControlCommand, DojoSource, SubsystemState } from './types.js';

export type Directive = 'continue' | 'pause' | 'kill';

export class ControlPlane {
  private state = new Map<DojoSource, SubsystemState>();
  private pending = new Map<DojoSource, 'pause' | 'kill' | 'resume'>();

  /** Tenshu sends a control command. */
  signal(cmd: ControlCommand): void {
    const targets: DojoSource[] = cmd.target === 'all'
      ? ['kagemusha', 'kagami', 'chizu', 'shugyo', 'shitsuji', 'kangeiko']
      : [cmd.target];
    for (const t of targets) {
      if (cmd.command === 'kill') this.pending.set(t, 'kill');
      else if (cmd.command === 'pause') this.pending.set(t, 'pause');
      else if (cmd.command === 'resume') this.pending.set(t, 'resume');
    }
  }

  /**
   * A subsystem calls this at a SAFE point in its loop. The returned directive
   * tells it what to do; the subsystem is responsible for persisting its state
   * BEFORE honoring a 'pause'/'kill' (clean stop, reanudable). State is updated
   * here so the Tenshu reflects it.
   */
  checkpoint(source: DojoSource): Directive {
    const p = this.pending.get(source);
    if (p === 'kill') { this.state.set(source, 'halted'); return 'kill'; }
    if (p === 'resume') { this.pending.delete(source); this.state.set(source, 'running'); return 'continue'; }
    if (p === 'pause' || this.state.get(source) === 'paused') { this.state.set(source, 'paused'); return 'pause'; }
    this.state.set(source, 'running');
    return 'continue';
  }

  /** Mark a subsystem idle (e.g. finished a mission cleanly). */
  markIdle(source: DojoSource): void { this.state.set(source, 'idle'); this.pending.delete(source); }

  stateOf(source: DojoSource): SubsystemState { return this.state.get(source) ?? 'idle'; }
  isHalted(source: DojoSource): boolean { return this.stateOf(source) === 'halted'; }
}

let _shared: ControlPlane | null = null;
export function sharedControlPlane(): ControlPlane { if (!_shared) _shared = new ControlPlane(); return _shared; }
