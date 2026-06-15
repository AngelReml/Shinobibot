/**
 * TS-05 (TEV browser), TS-06 (approval queue), TS-07 (export+verify), and
 * TS-10 — LA PRUEBA DURA del centro de mandos (P1 ver · P2 entender · P3 apagar ·
 * P4 auditar · P5 no miente).
 */
import { describe, it, expect } from 'vitest';
import { browseTev, tevSummary, verifyTevLinkage } from '../tev_browser.js';
import { ApprovalQueue } from '../approvals.js';
import { exportForAudit, verifyAuditBundle } from '../export.js';
import { buildDojoStatus } from '../status.js';
import { ControlPlane } from '../control.js';
import { reflect, assertReflected } from '../reflect.js';
import { ed25519Keypair, signTevChain } from '../../shitsuji/live.js';
import type { SystemEvent, ControlCommand } from '../types.js';
import type { TEVEntry } from '../../shitsuji/types.js';

const chain: TEVEntry[] = [
  { step_id: 's1', declared_effects: ['leer'], observed_effects: ['leyó'], on_data: 'f.txt', integrity_checks: [{ check: '11.2', verdict: 'PASS' }], timestamp: 't', prev_hash: 'genesis', this_hash: 'h1' },
  { step_id: 's2', declared_effects: ['escribir'], observed_effects: ['escribió'], on_data: 'g.txt', integrity_checks: [{ check: '11.2', verdict: 'PASS' }], timestamp: 't', prev_hash: 'h1', this_hash: 'h2' },
];

describe('tenshu — TS-05 navegador de TEV', () => {
  it('navega, resume legible y verifica linkage', () => {
    expect(browseTev(chain, { step_id: 's2' })).toHaveLength(1);
    expect(tevSummary(chain)).toMatch(/s1.*declarado=\[leer\]/s);
    expect(verifyTevLinkage(chain).ok).toBe(true);
    expect(verifyTevLinkage([{ ...chain[0], prev_hash: 'WRONG' }]).ok).toBe(false);
  });
});

describe('tenshu — TS-06 cola de aprobaciones operable', () => {
  const events: SystemEvent[] = [
    { event_id: 'a1', source: 'shitsuji', kind: 'approval_pending', payload: { summary: 'sobrescribir informe' }, ts: 't', trace_ref: 'h2' },
    { event_id: 'a2', source: 'shugyo', kind: 'approval_pending', payload: { step: 'paso peligroso' }, ts: 't' },
  ];
  it('ingiere pendientes y resuelve en ControlCommand enrutado (no actúa)', () => {
    const q = new ApprovalQueue();
    q.ingest(events);
    expect(q.count()).toBe(2);
    const cmd = q.resolve('a1', 'approve') as ControlCommand;
    expect(cmd.command).toBe('approve'); expect(cmd.target).toBe('shitsuji');
    expect(cmd.args?.trace_ref).toBe('h2');
    expect(q.count()).toBe(1);
    expect(q.resolve('nope', 'reject')).toBeNull();
  });
});

describe('tenshu — TS-07 exportar para auditar + verificación de cadena', () => {
  it('exporta y verifica linkage + firmas ed25519 (tercero sin confiar en Shinobi)', () => {
    const kp = ed25519Keypair();
    const signed = signTevChain(chain, kp);
    const bundle = exportForAudit('p1', signed, 't');
    expect(bundle.signed).toBe(true);
    const v = verifyAuditBundle(bundle);
    expect(v.ok).toBe(true); expect(v.signatures_ok).toBe(true); expect(v.linkage_ok).toBe(true);
    // manipular un eslabón → la verificación lo detecta
    const tampered = exportForAudit('p1', [{ ...signed[0], this_hash: 'EVIL' } as any, signed[1]], 't');
    expect(verifyAuditBundle(tampered).ok).toBe(false);
  });
});

describe('tenshu — TS-10 LA PRUEBA DURA del centro de mandos (P1–P5)', () => {
  const events: SystemEvent[] = [
    { event_id: 'e1', source: 'kagemusha', kind: 'phase_start', payload: { phase: 'ANALYZE' }, ts: 't' },
    { event_id: 'e2', source: 'shitsuji', kind: 'approval_pending', payload: { summary: 'pago' }, ts: 't' },
  ];

  it('P1 — VER: el status refleja subsistemas, presupuesto y aprobaciones pendientes', () => {
    const plane = new ControlPlane();
    const status = buildDojoStatus({ sources: ['kagemusha', 'shitsuji'], events, plane, budgets: { tokensSpent: 100, tokensCap: 1000, costSpent: 0.1 }, integrity_mode: 'enforce' });
    expect(status.subsystems.length).toBe(2);
    expect(status.pending_approvals).toBe(1);
    expect(status.integrity_mode).toBe('enforce');
  });

  it('P2 — ENTENDER: se puede recorrer la TEV y verificar su cadena', () => {
    expect(verifyTevLinkage(chain).ok).toBe(true);
    expect(tevSummary(chain)).toMatch(/2 eslabón/);
  });

  it('P3 — APAGAR: kill switch limpio, reanudable (el subsistema para en checkpoint)', () => {
    const plane = new ControlPlane();
    plane.signal({ command: 'kill', target: 'kagemusha' });
    expect(plane.checkpoint('kagemusha')).toBe('kill');     // para limpio en su checkpoint
    expect(plane.checkpoint('shitsuji')).toBe('continue');  // los demás siguen
  });

  it('P4 — AUDITAR: bundle exportable verificable por un tercero', () => {
    const kp = ed25519Keypair();
    const v = verifyAuditBundle(exportForAudit('p1', signTevChain(chain, kp), 't'));
    expect(v.ok).toBe(true);
  });

  it('P5 — NO MIENTE: el panel solo afirma lo anclado a eventos; lo no respaldado se marca', () => {
    const claims = [
      { text: 'kagemusha empezó ANALYZE', event_id: 'e1' },
      { text: 'shugyo certificó 5 skills', event_id: 'e_ghost' },   // sin evento → no respaldada
    ];
    const r = reflect(claims, events);
    expect(r.ok).toBe(false);
    expect(r.backed.map((c) => c.text)).toContain('kagemusha empezó ANALYZE');
    expect(r.unbacked.map((c) => c.text)).toContain('shugyo certificó 5 skills');
    // el gate estricto se NIEGA a renderizar si habría narración sin anclaje
    expect(() => assertReflected(claims, events)).toThrow(/refleja, no narra/);
    // con solo lo anclado, pasa y devuelve exactamente esa afirmación
    expect(assertReflected([claims[0]], events).map((c) => c.event_id)).toEqual(['e1']);
  });
});
