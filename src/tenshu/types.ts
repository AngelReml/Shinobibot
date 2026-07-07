/**
 * tenshu/types.ts — event/command/status model (dossier §3.4). Pure types.
 */

/** Fuentes conocidas al arrancar. NO es lista cerrada: el registro (registry.ts) admite
 *  nuevas sin tocar este fichero. Se conserva la union solo como semilla/autocompletado. */
export type KnownDojoSource = 'kagemusha' | 'kagami' | 'chizu' | 'shugyo' | 'shitsuji' | 'kangeiko';
/** Id de una capacidad del dojo. Abierto: cualquier id registrado. */
export type DojoSource = KnownDojoSource | (string & {});
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

// ── Manifiesto del dojo (presentación/reflejo) ──────────────────────────────
// Complementa, NO reemplaza, el CapabilityManifest de seguridad de src/confine/manifest.ts:
// aquél declara QUÉ le está permitido a una capacidad; éste declara CÓMO aparece en el dojo
// y en qué punto de su vida está. Juntos, por `id`, sustituyen al enum cerrado DojoSource.

/** Territorio sensible que dispara el candado (§11). Nota honesta: 'dinero' NO es derivable
 *  de la gramática de capacidades `kind:scope`; debe declararse aparte. */
export type Territorio = 'ninguno' | 'secretos' | 'dinero' | 'destruccion';

/** Las cuatro posturas del dojo: VER / CONDUCIR / ENTENDER / CONSULTAR. */
export type Zona = 'VER' | 'CONDUCIR' | 'ENTENDER' | 'CONSULTAR';

export interface DojoManifest {
  id: DojoSource;                        // slug estable (antes: miembro del enum)
  nombre: string;                        // título de la carta — Cormorant, una línea
  hace: string;                          // qué hace — UNA línea (Inter)
  zona: Zona;                            // dónde se refleja
  emite: SystemEvent['kind'][];          // qué eventos refleja
  estado: 'forja' | 'prueba' | 'sello' | 'destierro';    // ciclo → visual (rastro vs lacre)
  sello?: 'PASS' | 'FAIL' | 'PENDING';   // verificación interna (OpenGravity absorbido)
}
