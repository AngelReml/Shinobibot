import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup, restoreBackup } from '../state_backup.js';

let workspace: string;
let shinobiRoot: string;
let stagingDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'shinobi-bkp-'));
  shinobiRoot = join(workspace, 'shinobi');
  stagingDir = join(workspace, 'staging');
  mkdirSync(shinobiRoot, { recursive: true });
});

afterEach(() => {
  try { if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true }); } catch {}
});

function setupSampleState(): void {
  writeFileSync(join(shinobiRoot, 'USER.md'), '# Usuario\nNombre: Test', 'utf-8');
  writeFileSync(join(shinobiRoot, 'MEMORY.md'), '# Memoria\nNota: ...', 'utf-8');
  writeFileSync(join(shinobiRoot, 'memory.json'), '{"messages":[]}', 'utf-8');
  // Audit con secreto que debe redactarse.
  mkdirSync(join(shinobiRoot, 'audit'), { recursive: true });
  writeFileSync(
    join(shinobiRoot, 'audit', 'audit.jsonl'),
    '{"tool":"run_command","args":"AUTH=Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart"}\n' +
    '{"tool":"read_file","args":"/tmp/x"}\n',
    'utf-8'
  );
  // Skill aprobada.
  mkdirSync(join(shinobiRoot, 'skills', 'approved', 'my-skill'), { recursive: true });
  writeFileSync(join(shinobiRoot, 'skills', 'approved', 'my-skill', 'SKILL.md'), '---\nname: my\n---\nBody', 'utf-8');
  // Forbidden: .env y .key — deben ser omitidos.
  writeFileSync(join(shinobiRoot, '.env'), 'OPENAI_API_KEY=sk-secret', 'utf-8');
  mkdirSync(join(shinobiRoot, 'config'), { recursive: true });
  writeFileSync(join(shinobiRoot, 'config', 'server.key'), 'PRIVATE_KEY_DATA', 'utf-8');
}

describe('createBackup', () => {
  it('copia archivos esperados + crea manifest', () => {
    setupSampleState();
    const r = createBackup({ shinobiRoot, stagingDir });
    expect(r.filesCopied).toBeGreaterThan(0);
    expect(existsSync(join(stagingDir, 'USER.md'))).toBe(true);
    expect(existsSync(join(stagingDir, 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(stagingDir, 'skills/approved/my-skill/SKILL.md'))).toBe(true);
    expect(existsSync(join(stagingDir, 'BACKUP_MANIFEST.json'))).toBe(true);
    expect(existsSync(join(stagingDir, 'README.md'))).toBe(true);
  });

  it('OMITE .env y .key', () => {
    setupSampleState();
    createBackup({ shinobiRoot, stagingDir });
    expect(existsSync(join(stagingDir, '.env'))).toBe(false);
    expect(existsSync(join(stagingDir, 'config/server.key'))).toBe(false);
  });

  it('REDACTA secrets dentro del audit.jsonl', () => {
    setupSampleState();
    const r = createBackup({ shinobiRoot, stagingDir });
    const audit = readFileSync(join(stagingDir, 'audit/audit.jsonl'), 'utf-8');
    expect(audit).toContain('<REDACTED:');
    expect(audit).not.toContain('signaturepart');
    expect(r.filesRedacted).toBeGreaterThan(0);
  });

  it('manifest contiene lista de files con relPath y redacted flag', () => {
    setupSampleState();
    createBackup({ shinobiRoot, stagingDir });
    const m = JSON.parse(readFileSync(join(stagingDir, 'BACKUP_MANIFEST.json'), 'utf-8'));
    expect(m.createdAt).toBeTruthy();
    expect(Array.isArray(m.files)).toBe(true);
    const auditEntry = m.files.find((f: any) => f.relPath.includes('audit.jsonl'));
    expect(auditEntry?.redacted).toBe(true);
    const userEntry = m.files.find((f: any) => f.relPath === 'USER.md');
    expect(userEntry?.redacted).toBe(false);
  });

  it('sources custom permite limitar el backup', () => {
    setupSampleState();
    const r = createBackup({
      shinobiRoot,
      stagingDir,
      sources: [{ relPath: 'USER.md' }],
    });
    expect(existsSync(join(stagingDir, 'USER.md'))).toBe(true);
    expect(existsSync(join(stagingDir, 'MEMORY.md'))).toBe(false);
    expect(r.filesCopied).toBe(1);
  });

  it('overwrite=false preserva staging existente', () => {
    setupSampleState();
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'sentinel.txt'), 'antiguo', 'utf-8');
    createBackup({ shinobiRoot, stagingDir, overwrite: false });
    // En este modo NO borra staging existente; el sentinel debe seguir.
    expect(existsSync(join(stagingDir, 'sentinel.txt'))).toBe(true);
  });
});

describe('restoreBackup', () => {
  it('restaura archivos del manifest a destDir', () => {
    setupSampleState();
    createBackup({ shinobiRoot, stagingDir });

    const dest = join(workspace, 'restored');
    mkdirSync(dest);
    const r = restoreBackup({ stagingDir, destDir: dest });
    expect(r.filesRestored).toBeGreaterThan(0);
    expect(existsSync(join(dest, 'USER.md'))).toBe(true);
    expect(existsSync(join(dest, 'audit/audit.jsonl'))).toBe(true);
  });

  it('lanza si manifest no existe', () => {
    expect(() => restoreBackup({
      stagingDir: join(workspace, 'no-backup'),
      destDir: join(workspace, 'dest'),
    })).toThrow(/BACKUP_MANIFEST/);
  });

  it('overwrite=false respeta archivos existentes', () => {
    setupSampleState();
    createBackup({ shinobiRoot, stagingDir });

    const dest = join(workspace, 'restored');
    mkdirSync(dest);
    writeFileSync(join(dest, 'USER.md'), 'YA EXISTE', 'utf-8');
    restoreBackup({ stagingDir, destDir: dest, overwrite: false });
    expect(readFileSync(join(dest, 'USER.md'), 'utf-8')).toBe('YA EXISTE');
  });

  it('overwrite=true sobrescribe', () => {
    setupSampleState();
    createBackup({ shinobiRoot, stagingDir });

    const dest = join(workspace, 'restored');
    mkdirSync(dest);
    writeFileSync(join(dest, 'USER.md'), 'OBSOLETO', 'utf-8');
    restoreBackup({ stagingDir, destDir: dest, overwrite: true });
    expect(readFileSync(join(dest, 'USER.md'), 'utf-8')).toContain('Test');
  });
});
