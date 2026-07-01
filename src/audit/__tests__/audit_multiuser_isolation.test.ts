// F2.3 / MEDIA-10 (auditoría 2026-07) — un audit.jsonl POR USUARIO en modo
// multi-usuario, siguiendo el mismo patrón de aislamiento que
// `getMemoryStore(userId)` en src/memory/memory_store.ts. Antes, TODOS los
// usuarios escribían al mismo audit.jsonl compartido — un guest con acceso
// de lectura veía argsPreview/sessionId/userId de todos los demás.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('audit multiuser isolation (F2.3 / MEDIA-10)', () => {
  let dir: string;
  let prevLogPath: string | undefined;
  let prevTrustHeader: string | undefined;
  let prevDisabled: string | undefined;
  let prevCwd: string;

  beforeEach(() => {
    dir = join(tmpdir(), `shinobi-audit-mu-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    prevLogPath = process.env.SHINOBI_AUDIT_LOG_PATH;
    prevTrustHeader = process.env.SHINOBI_TRUST_USER_HEADER;
    prevDisabled = process.env.SHINOBI_AUDIT_DISABLED;
    delete process.env.SHINOBI_AUDIT_LOG_PATH; // sin override — probamos el default multiusuario
    delete process.env.SHINOBI_AUDIT_DISABLED;
    // auditBaseDir() (audit_log.ts) resuelve el default relativo a cwd
    // (dirname(resolve(cwd, 'audit.jsonl')) === cwd) — apuntamos el cwd del
    // proceso de test a un tmpdir para no escribir dentro del repo real.
    prevCwd = process.cwd();
    process.chdir(dir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevLogPath === undefined) delete process.env.SHINOBI_AUDIT_LOG_PATH; else process.env.SHINOBI_AUDIT_LOG_PATH = prevLogPath;
    if (prevTrustHeader === undefined) delete process.env.SHINOBI_TRUST_USER_HEADER; else process.env.SHINOBI_TRUST_USER_HEADER = prevTrustHeader;
    if (prevDisabled === undefined) delete process.env.SHINOBI_AUDIT_DISABLED; else process.env.SHINOBI_AUDIT_DISABLED = prevDisabled;
    rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('dos usuarios en modo multiusuario escriben en DOS ficheros audit.jsonl distintos', async () => {
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const { logToolCall, _internals } = await import('../audit_log.js');

    const pathAlice = _internals.resolveLogPath('alice');
    const pathBob = _internals.resolveLogPath('bob');
    expect(pathAlice).not.toBe(pathBob);
    expect(pathAlice).toMatch(/alice\.jsonl$/);
    expect(pathBob).toMatch(/bob\.jsonl$/);

    logToolCall({ tool: 'read_file', args: { path: 'a' }, success: true, durationMs: 1, userId: 'alice' });
    logToolCall({ tool: 'write_file', args: { path: 'b' }, success: true, durationMs: 1, userId: 'bob' });

    expect(existsSync(pathAlice)).toBe(true);
    expect(existsSync(pathBob)).toBe(true);

    const aliceEvents = readFileSync(pathAlice, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const bobEvents = readFileSync(pathBob, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    expect(aliceEvents).toHaveLength(1);
    expect(bobEvents).toHaveLength(1);
    expect(aliceEvents[0].tool).toBe('read_file');
    expect(bobEvents[0].tool).toBe('write_file');

    // Aislamiento real: el log de alice NO contiene nada de bob y viceversa.
    expect(JSON.stringify(aliceEvents)).not.toContain('write_file');
    expect(JSON.stringify(bobEvents)).not.toContain('read_file');
  });

  it('sin modo multiusuario (SHINOBI_TRUST_USER_HEADER no=1), userId NO particiona el log (back-compat)', async () => {
    delete process.env.SHINOBI_TRUST_USER_HEADER;
    const { _internals } = await import('../audit_log.js');
    const pathAlice = _internals.resolveLogPath('alice');
    const pathBob = _internals.resolveLogPath('bob');
    // Mismo path compartido — comportamiento previo preservado cuando el
    // modo multiusuario no está activo.
    expect(pathAlice).toBe(pathBob);
  });

  it('SHINOBI_AUDIT_LOG_PATH explícito tiene prioridad sobre el aislamiento por usuario', async () => {
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const forced = join(dir, 'forced.jsonl');
    process.env.SHINOBI_AUDIT_LOG_PATH = forced;
    const { _internals } = await import('../audit_log.js');
    expect(_internals.resolveLogPath('alice')).toBe(forced);
    expect(_internals.resolveLogPath('bob')).toBe(forced);
  });

  it('sanitiza userId para evitar path traversal en el nombre de fichero', async () => {
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const { _internals } = await import('../audit_log.js');
    const evil = _internals.resolveLogPath('../../etc/passwd');
    // El path resuelto debe seguir viviendo bajo el directorio audit/, sin
    // escapar vía "..".
    expect(evil).not.toMatch(/\.\./);
    expect(evil).toMatch(/audit[\\/]/);
  });
});
