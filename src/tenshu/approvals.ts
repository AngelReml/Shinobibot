/**
 * tenshu/approvals.ts — TS-06: the operable approval queue. The dojo emits
 * 'approval_pending' events (irreversible/external steps ⚑); the operator sees them
 * and resolves each into a ControlCommand (approve/reject) routed to the source.
 * Pure: the queue is built from events; resolving emits a command, never acts itself.
 */

import type { SystemEvent, ControlCommand, DojoSource } from './types.js';

export interface PendingApproval {
  id: string;            // event_id
  source: DojoSource;
  summary: string;
  trace_ref?: string;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();

  /** Ingest events; 'approval_pending' enters the queue, an 'action' on the same id clears it. */
  ingest(events: SystemEvent[]): void {
    for (const e of events) {
      if (e.kind === 'approval_pending') {
        this.pending.set(e.event_id, { id: e.event_id, source: e.source, summary: String(e.payload.summary ?? e.payload.step ?? 'acción que requiere aprobación'), trace_ref: e.trace_ref });
      } else if (e.kind === 'action' && typeof e.payload.resolves === 'string') {
        this.pending.delete(e.payload.resolves);
      }
    }
  }

  list(): PendingApproval[] { return [...this.pending.values()]; }
  count(): number { return this.pending.size; }

  /** Resolve a pending approval into a routed ControlCommand (does NOT act). */
  resolve(id: string, decision: 'approve' | 'reject'): ControlCommand | null {
    const p = this.pending.get(id);
    if (!p) return null;
    this.pending.delete(id);
    return { command: decision, target: p.source, args: { approval_id: id, trace_ref: p.trace_ref } };
  }
}
