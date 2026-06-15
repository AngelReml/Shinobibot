/**
 * chizu/characterize/probe.ts — M-11: the DYNAMIC probe (dossier §7.3). To know if a
 * GUI app is automatable you must look: launch it, read its UI Automation tree, judge
 * how rich/named it is, and CLOSE it. This is the live Windows part — so launch /
 * observe / close are injected (⚑). The GATES are deterministic and enforced here:
 *   - never probe a dangerous/forbidden app (the map's own risk arms the brake);
 *   - the app is ALWAYS closed (finally), even if observation throws;
 *   - the UIA richness verdict is computed from the observed control counts.
 */

import type { Characterization, RiskLevel } from '../types.js';

export interface UiaObservation { control_count: number; named_ratio: number; }
export type UiaClass = Characterization['uia']['class'];   // 'rich' | 'poor' | 'opaque' | 'unprobed'

/** Classify UIA richness from an observation (more named controls ⇒ more automatable). */
export function classifyUia(obs: UiaObservation | null): UiaClass {
  if (!obs || obs.control_count <= 0) return 'opaque';
  if (obs.control_count >= 10 && obs.named_ratio >= 0.5) return 'rich';
  if (obs.control_count >= 3 && obs.named_ratio >= 0.2) return 'poor';
  return 'opaque';
}

export interface ProbeTarget { app_id: string; command: string; risk_level: RiskLevel; }
export interface ProbeDeps {
  launch: (command: string) => Promise<{ handle: string }>;       // ⚑ live: start the process
  observe: (handle: string) => Promise<UiaObservation>;           // ⚑ live: read the UIA tree
  close: (handle: string) => Promise<void>;                       // ⚑ live: close the process
}
export interface ProbeResult { app_id: string; uia: UiaClass; launched: boolean; note: string; }

/**
 * Probe a target once. Gated: dangerous/forbidden apps are NOT launched (documented).
 * The process is always closed. A launch/observe failure degrades honestly to opaque/
 * unprobed — never a fabricated "rich".
 */
export async function probeDynamic(target: ProbeTarget, deps: ProbeDeps): Promise<ProbeResult> {
  if (target.risk_level === 'dangerous' || target.risk_level === 'forbidden') {
    return { app_id: target.app_id, uia: 'unprobed', launched: false, note: `gated: riesgo ${target.risk_level}, no se lanza` };
  }
  let handle: string | null = null;
  try {
    handle = (await deps.launch(target.command)).handle;
  } catch (e: any) {
    return { app_id: target.app_id, uia: 'unprobed', launched: false, note: `no se pudo lanzar: ${e?.message ?? e}` };
  }
  try {
    const obs = await deps.observe(handle);
    return { app_id: target.app_id, uia: classifyUia(obs), launched: true, note: `${obs.control_count} controles, ${(obs.named_ratio * 100).toFixed(0)}% nombrados` };
  } catch (e: any) {
    return { app_id: target.app_id, uia: 'opaque', launched: true, note: `lanzó pero no se pudo observar: ${e?.message ?? e}` };
  } finally {
    if (handle) { try { await deps.close(handle); } catch { /* best effort close */ } }
  }
}
