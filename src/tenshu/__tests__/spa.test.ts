/**
 * TS-04 — SPA local: el núcleo testeable (estado + comandos) y el cableado Express.
 * GATE: ves estado en vivo y pulsas pausa/kill desde la UI.
 */
import { describe, it, expect } from 'vitest';
import { buildState, applyCommand, type TenshuSpaDeps } from '../spa/state.js';
import { createTenshuApp } from '../spa/server.js';
import { SPA_HTML } from '../spa/page.js';
import { ControlPlane } from '../control.js';
import type { SystemEvent } from '../types.js';
import type { TEVEntry } from '../../shitsuji/types.js';

const events: SystemEvent[] = [
  { event_id: 'e1', source: 'kagemusha', kind: 'phase_start', payload: { phase: 'ANALYZE' }, ts: 't1' },
  { event_id: 'e2', source: 'shitsuji', kind: 'approval_pending', payload: { summary: 'pago de factura' }, ts: 't2' },
  { event_id: 'e3', source: 'shugyo', kind: 'error', payload: {}, ts: 't3' },
];
const tev: TEVEntry[] = [
  { step_id: 's1', declared_effects: ['leer'], observed_effects: ['leyó'], on_data: 'f', integrity_checks: [], timestamp: 't', prev_hash: 'genesis', this_hash: 'h1' },
];

function mkDeps(plane = new ControlPlane()): TenshuSpaDeps {
  return {
    sources: ['kagemusha', 'shitsuji', 'shugyo'],
    events: () => events,
    tev: () => tev,
    plane,
    budgets: () => ({ tokensSpent: 100, tokensCap: 1000, costSpent: 0.1 }),
    integrityMode: () => 'enforce',
  };
}

describe('tenshu — TS-04 SPA (estado + comandos)', () => {
  it('buildState refleja VER + ENTENDER + CONDUCIR en una foto', () => {
    const s = buildState(mkDeps());
    expect(s.status.subsystems).toHaveLength(3);
    expect(s.status.pending_approvals).toBe(1);
    expect(s.status.integrity_mode).toBe('enforce');
    expect(s.map.nodes.find((n) => n.source === 'shugyo')!.state).toBe('halted');   // mapa vivo
    expect(s.approvals[0].summary).toBe('pago de factura');                          // CONDUCIR
    expect(s.tev.linkage.ok).toBe(true); expect(s.tev.length).toBe(1);              // ENTENDER
  });

  it('GATE — pulsar KILL desde la UI llega al ControlPlane (kill switch limpio)', () => {
    const plane = new ControlPlane();
    const deps = mkDeps(plane);
    const r = applyCommand(deps, { command: 'kill', target: 'kagemusha' });
    expect(r.ok).toBe(true); expect(r.command).toBe('kill');
    expect(plane.checkpoint('kagemusha')).toBe('kill');       // el subsistema para limpio
    expect(plane.checkpoint('shitsuji')).toBe('continue');    // los demás siguen
  });

  it('GATE — pausar todo enruta a todos los subsistemas', () => {
    const plane = new ControlPlane();
    applyCommand(mkDeps(plane), { command: 'pause', target: 'all' });
    expect(plane.checkpoint('kagemusha')).toBe('pause');
    expect(plane.checkpoint('shugyo')).toBe('pause');
  });

  it('approve/reject se aceptan y enrutan (sin actuar sobre el mundo)', () => {
    const r = applyCommand(mkDeps(), { command: 'approve', target: 'shitsuji', args: { approval_id: 'e2' } });
    expect(r.ok).toBe(true); expect(r.detail).toMatch(/enrutado a shitsuji/);
  });

  it('createTenshuApp construye un app Express con las rutas; el HTML existe', () => {
    const app = createTenshuApp(mkDeps());
    expect(typeof app).toBe('function');                      // express app es invocable
    expect(typeof (app as any).listen).toBe('function');
    expect(SPA_HTML).toMatch(/Tenshu — Puente de Mando/);
    expect(SPA_HTML).toMatch(/\/api\/tenshu\/command/);       // los botones POSTean aquí
  });
});
