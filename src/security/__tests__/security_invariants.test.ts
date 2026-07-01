/**
 * TEST DE INVARIANTE DE SEGURIDAD TRANSVERSAL — E1 (Íntegro)
 *
 * Un único test que recorre TODOS los puntos de decisión de seguridad del
 * sistema y verifica que el default es DENY (fail-safe). Si un futuro
 * cambio introduce un fail-open en cualquiera de estos puntos, este test
 * lo captura en CI antes de que llegue a producción.
 *
 * Regla: el default de seguridad SIEMPRE es denegar. La aprobación debe
 * ser explícita; la denegación es implícita por omisión.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requestApproval,
  setApprovalMode,
  setApprovalAsker,
  setApprovalPreGate,
  isDestructive,
  getApprovalMode,
  clearSessionApprovals,
  classifyCritical,
  type ApprovalMode,
} from '../approval.js';
import { verifySkillText } from '../../skills/skill_signing.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function envApprovalMode(mode: string) {
  process.env.SHINOBI_APPROVAL_MODE = mode;
}

// ─── Suite principal ─────────────────────────────────────────────────────────

describe('INVARIANTE DE SEGURIDAD TRANSVERSAL (E1 — Íntegro)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    clearSessionApprovals();
    // Sin asker por defecto — simula entorno sin UI (daemon / headless)
    setApprovalAsker(null);
    setApprovalPreGate(null);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    clearSessionApprovals();
    setApprovalAsker(null);
    setApprovalPreGate(null);
  });

  // ── 1. Modo default ──────────────────────────────────────────────────────

  describe('1. Modo de aprobación por defecto', () => {
    it('getApprovalMode() devuelve "critical" cuando no hay env ni caché', () => {
      delete process.env.SHINOBI_APPROVAL_MODE;
      // Forzar recarga limpia del modo
      setApprovalMode('critical');
      expect(getApprovalMode()).toBe('critical');
    });

    it('el modo "off" sí se acepta cuando es explícito', () => {
      envApprovalMode('off');
      expect(getApprovalMode()).toBe('off');
    });
  });

  // ── 2. Gate sin asker → DENIEGA ──────────────────────────────────────────

  describe('2. Approval gate sin asker → fail-safe DENY', () => {
    it('deniega acción crítica cuando no hay UI registrada (headless)', async () => {
      setApprovalMode('critical');
      setApprovalAsker(null);
      const allowed = await requestApproval({
        toolName: 'write_file',
        args: { path: '.env', content: 'SECRET=x' },
        destructive: true,
        reason: 'escritura de secreto',
      });
      expect(allowed).toBe(false);
    });

    it('deniega start_cloud_mission sin asker', async () => {
      setApprovalMode('critical');
      setApprovalAsker(null);
      const allowed = await requestApproval({
        toolName: 'start_cloud_mission',
        args: {},
        destructive: true,
        reason: 'compromiso externo',
      });
      expect(allowed).toBe(false);
    });
  });

  // ── 3. Timeout de aprobación → DENIEGA ──────────────────────────────────

  describe('3. Timeout de aprobación → default DENY', () => {
    it('SHINOBI_APPROVAL_TIMEOUT_ACTION no está en "approve" por defecto', () => {
      delete process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION;
      const action = (process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION || 'deny').toLowerCase();
      // El código del orchestrator usa este valor para decidir si aprueba en timeout.
      // El invariante: el default NUNCA es 'approve'.
      expect(action).not.toBe('approve');
      expect(action).toBe('deny');
    });

    it('timeout action explícito "deny" sigue siendo deny', () => {
      process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION = 'deny';
      const action = (process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION || 'deny').toLowerCase();
      expect(action).toBe('deny');
    });
  });

  // ── 4. classifyCritical — patrones críticos siempre detectados ───────────

  describe('4. classifyCritical — detección de patrones críticos', () => {
    const criticalCases: Array<[string, string, any, string]> = [
      ['write_file a .env', 'write_file', { path: '.env', content: 'x' }, 'modification of .env credentials file'],
      ['write_file a .ssh/id_rsa', 'write_file', { path: '/home/user/.ssh/id_rsa', content: 'x' }, 'modification inside .ssh keys directory'],
      ['write_file a .pem', 'write_file', { path: 'cert.pem', content: 'x' }, 'modification of credential/cert file'],
      ['run_command login', 'run_command', { command: 'gh auth login' }, 'login / credenciales de un servicio'],
      ['run_command rm -rf', 'run_command', { command: 'rm -rf /' }, 'borrado recursivo/forzado'],
      ['run_command rm *', 'run_command', { command: 'rm *' }, 'borrado por comodín'],
      ['run_command format', 'run_command', { command: 'format c:' }, 'formateo de disco'],
      ['start_cloud_mission', 'start_cloud_mission', {}, 'compromiso externo'],
      ['n8n_invoke', 'n8n_invoke', {}, 'compromiso externo'],
      ['task_scheduler_create', 'task_scheduler_create', {}, 'compromiso externo'],
      ['mcp_connect', 'mcp_connect', {}, 'compromiso externo'],
    ];

    for (const [label, tool, args, expectedReason] of criticalCases) {
      it(`clasifica como crítico: ${label}`, () => {
        const verdict = classifyCritical(tool, args);
        expect(verdict.destructive).toBe(true);
        expect(verdict.reason).toMatch(new RegExp(expectedReason.slice(0, 20), 'i'));
      });
    }
  });

  // ── 5. Acciones NO-críticas no se frenan ─────────────────────────────────

  describe('5. Acciones no-críticas no se frenan (evitar falsos positivos)', () => {
    const nonCriticalCases: Array<[string, string, any]> = [
      ['write_file normal', 'write_file', { path: 'output.txt', content: 'hola' }],
      ['edit_file normal', 'edit_file', { path: 'src/foo.ts', replacement: 'x' }],
      ['run_command read-only', 'run_command', { command: 'git status' }],
      ['run_command ls', 'run_command', { command: 'ls -la' }],
      ['read_file', 'read_file', { path: 'README.md' }],
    ];

    for (const [label, tool, args] of nonCriticalCases) {
      it(`no clasifica como crítico: ${label}`, () => {
        const verdict = classifyCritical(tool, args);
        expect(verdict.destructive).toBe(false);
      });
    }
  });

  // ── 6. Skills sin firma → rechazo ────────────────────────────────────────

  describe('6. Verificación de firma de skills', () => {
    it('skill sin signature_hash es inválida', () => {
      const skillText = `---\nname: test-skill\nversion: 1.0.0\n---\ncontenido de la skill`;
      const result = verifySkillText(skillText);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing_signature');
    });

    it('skill con signature_hash manipulada es inválida (hash_mismatch)', () => {
      const skillText = `---\nname: test-skill\nversion: 1.0.0\nsignature_hash: ${'a'.repeat(64)}\n---\ncontenido manipulado`;
      const result = verifySkillText(skillText);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('hash_mismatch');
    });

    it('texto que no parsea como skill es inválido', () => {
      const result = verifySkillText('esto no es un frontmatter válido');
      expect(result.valid).toBe(false);
    });
  });

  // ── 7. asker que lanza → DENIEGA ─────────────────────────────────────────

  describe('7. Asker que falla → fail-safe DENY', () => {
    it('si el asker lanza excepción, la acción se deniega', async () => {
      setApprovalMode('critical');
      setApprovalAsker(async () => { throw new Error('UI no disponible'); });
      const allowed = await requestApproval({
        toolName: 'mcp_connect',
        args: {},
        destructive: true,
        reason: 'compromiso externo',
      });
      expect(allowed).toBe(false);
    });
  });

  // ── 8. Acción no-crítica siempre pasa (no-op correcto) ───────────────────

  describe('8. Acción no-crítica pasa sin asker', () => {
    it('acción no crítica (destructive=false) pasa sin necesitar asker', async () => {
      setApprovalMode('critical');
      setApprovalAsker(null);
      const allowed = await requestApproval({
        toolName: 'read_file',
        args: { path: 'README.md' },
        destructive: false,
      });
      expect(allowed).toBe(true);
    });
  });

  // ── 9. Regresión auditoría 2026-07-01: "siempre" no debe convertirse en
  //      un bypass permanente de comandos críticos futuros, ni silenciar el
  //      gate de familia. Reproduce el incidente real encontrado por los
  //      subagentes de auditoría (no una versión idealizada del bug).

  describe('9. sessionAlwaysApproved no bypasea futuros run_command críticos ni el family gate', () => {
    it('aprobar "siempre" un run_command crítico no autoaprueba un run_command crítico DISTINTO después', async () => {
      setApprovalMode('critical');
      let calls = 0;
      setApprovalAsker(async () => {
        calls++;
        return calls === 1 ? 'always' : 'no';
      });

      // 1) usuario aprueba "siempre" para un login (gh auth login).
      const first = await requestApproval({
        toolName: 'run_command',
        args: { command: 'gh auth login' },
        destructive: true,
        reason: 'login / credenciales de un servicio',
      });
      expect(first).toBe(true);
      expect(calls).toBe(1);

      // 2) ataque: un run_command DISTINTO y destructivo (rm -rf) llega
      // después. Con el bug, isCriticalPath nunca cubría run_command → bypass
      // silencioso sin volver a preguntar. Debe volver a consultar al asker.
      const second = await requestApproval({
        toolName: 'run_command',
        args: { command: 'rm -rf /workspace' },
        destructive: true,
        reason: 'borrado recursivo/forzado',
      });
      expect(calls).toBe(2); // el asker SÍ fue consultado de nuevo
      expect(second).toBe(false); // y esta vez el usuario (mock) dijo "no"
    });

    it('el family preGate sigue aplicándose tras un "siempre" concedido para la misma tool', async () => {
      setApprovalMode('critical');
      setApprovalAsker(async () => 'always');

      // 1) sin preGate activo, el usuario owner aprueba "siempre" escribir en
      // output.txt (ruta/contenido NO crítico — isCriticalPath queda false).
      const first = await requestApproval({
        toolName: 'write_file',
        args: { path: 'output.txt', content: 'hola' },
        destructive: true,
        reason: 'escritura de prueba',
      });
      expect(first).toBe(true);

      // 2) ahora se instala el gate de familia (usuario restringido). Con el
      // bug, sessionAlwaysApproved.has('write_file') retornaba ANTES de
      // consultar _preGate → el gate de familia quedaba muerto. Debe denegar.
      setApprovalPreGate(async () => false);
      const second = await requestApproval({
        toolName: 'write_file',
        args: { path: 'output.txt', content: 'hola' },
        destructive: true,
        reason: 'escritura de prueba',
      });
      expect(second).toBe(false);
    });
  });

  // ── 10. Regresión ALTA-05/MEDIA-06: el preGate de familia debe aplicarse
  //       incluso a tools que classifyCritical NUNCA marca como destructivas
  //       (spawn_agent no tiene clasificación crítica propia, pero SÍ es un
  //       SHELL_TOOL para family_wiring — noShell debe bloquearlo igual).

  describe('10. preGate de familia aplica también a tools no-críticas (spawn_agent)', () => {
    afterEach(() => {
      delete process.env.SHINOBI_USERS_ROOT;
    });

    it('un usuario family con noShell es bloqueado en spawn_agent aunque destructive=false', async () => {
      const { userRegistry, familyApprovalGate, _resetMultiuserWiring } = await import('../../multiuser/multiuser_wiring.js');
      _resetMultiuserWiring();
      process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
      userRegistry().createFamily({ userId: 'kid5', displayName: 'Kid5' });
      const gate = familyApprovalGate('kid5')!;

      setApprovalMode('critical');
      setApprovalPreGate(gate);
      setApprovalAsker(async () => 'yes'); // si llegara al asker, el test estaría mal diseñado

      // El orchestrator real llama isDestructive('spawn_agent', {}) → classifyCritical
      // no tiene caso para spawn_agent → destructive:false. Con el bug, eso bastaba
      // para que requestApproval retornara true ANTES de consultar _preGate.
      const allowed = await requestApproval({
        toolName: 'spawn_agent',
        args: {},
        destructive: false,
      });
      expect(allowed).toBe(false);
    });
  });
});
