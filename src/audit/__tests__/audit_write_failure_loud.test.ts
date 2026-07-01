// F2.3 (auditoría 2026-07) — fallo ruidoso: `writeAuditEvent` ya NO se traga
// un fallo de escritura en silencio (antes: `catch { return false }` sin
// ninguna señal). Ahora reporta por console.error con contexto claro. Una
// escritura de audit fallida es un evento de seguridad.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('writeAuditEvent — F2.3 fallo ruidoso (no silent-swallow)', () => {
  let dir: string;
  let prevPath: string | undefined;
  let prevDisabled: string | undefined;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shinobi-audit-fail-'));
    prevPath = process.env.SHINOBI_AUDIT_LOG_PATH;
    prevDisabled = process.env.SHINOBI_AUDIT_DISABLED;
    delete process.env.SHINOBI_AUDIT_DISABLED;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    if (prevPath === undefined) delete process.env.SHINOBI_AUDIT_LOG_PATH;
    else process.env.SHINOBI_AUDIT_LOG_PATH = prevPath;
    if (prevDisabled === undefined) delete process.env.SHINOBI_AUDIT_DISABLED;
    else process.env.SHINOBI_AUDIT_DISABLED = prevDisabled;
    rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('un path cuyo directorio padre es en realidad un ARCHIVO (ENOTDIR) hace fallar la escritura Y loguea a stderr', async () => {
    // Crea un ARCHIVO regular donde el código intentará crear un directorio
    // (mkdirSync sobre 'not-a-dir' fallará porque ya existe como archivo).
    const blockerFile = join(dir, 'not-a-dir');
    writeFileSync(blockerFile, 'soy un archivo, no un directorio', 'utf-8');
    // Fuerza el log a vivir "dentro" de ese archivo — la ruta es inválida a
    // nivel de sistema de ficheros (ENOTDIR al intentar mkdir/append).
    process.env.SHINOBI_AUDIT_LOG_PATH = join(blockerFile, 'sub', 'audit.jsonl');

    vi.resetModules();
    const { writeAuditEvent } = await import('../audit_log.js');

    const ok = writeAuditEvent({
      kind: 'tool_call',
      ts: new Date().toISOString(),
      tool: 'test_tool',
      argsHash: 'deadbeef',
      argsPreview: '{}',
      success: true,
      durationMs: 1,
    });

    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    const allMsgs = errSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(allMsgs).toMatch(/FALLO AL ESCRIBIR AUDIT EVENT/i);
    expect(allMsgs).toMatch(/tool_call/);
  });
});
