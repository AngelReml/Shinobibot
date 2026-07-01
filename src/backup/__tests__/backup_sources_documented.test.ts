// F6.2 (auditoría 2026-07-01) — el banner de state_backup.ts decía
// "config, memoria, skills, audit redactado" (con ".env redactado" incluido
// en una versión previa) pero `DEFAULT_SOURCES` NUNCA incluyó ningún .env,
// ni siquiera redactado. Este test verifica en CÓDIGO — no leyendo el
// comentario a ojo — que la promesa y la implementación coinciden, y que el
// operador es avisado explícitamente en el restore.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_SOURCES, createBackup, restoreBackup } from '../state_backup.js';

describe('F6.2 — DEFAULT_SOURCES nunca incluye .env (banner↔código sincronizados)', () => {
  it('ninguna fuente por defecto referencia un .env, redactado o no', () => {
    for (const src of DEFAULT_SOURCES) {
      expect(src.relPath).not.toMatch(/(^|\/)\.env(\.|$)/);
    }
  });

  it('ninguna fuente por defecto es un directorio completo que pudiera arrastrar un .env sin filtro explícito', () => {
    // Las únicas fuentes recursivas declaradas deben ser directorios
    // conocidos y no-sensibles (skills/approved, reflections) — si alguien
    // añade una fuente recursiva nueva sobre la raíz del proyecto, este test
    // debe obligar a revisarla explícitamente.
    const recursiveDirs = DEFAULT_SOURCES.filter((s) => s.recursive !== false && !s.relPath.includes('.'));
    for (const s of recursiveDirs) {
      expect(['skills/approved', 'reflections']).toContain(s.relPath);
    }
  });
});

describe('F6.2 — createBackup/restoreBackup: comunicación honesta sobre .env', () => {
  let workspace: string;
  let shinobiRoot: string;
  let stagingDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'shinobi-bkp-f62-'));
    shinobiRoot = join(workspace, 'shinobi');
    stagingDir = join(workspace, 'staging');
    mkdirSync(shinobiRoot, { recursive: true });
    // .env real presente en la raíz — NO debe aparecer en el backup jamás.
    writeFileSync(join(shinobiRoot, '.env'), 'ANTHROPIC_API_KEY=sk-live-should-never-be-copied', 'utf-8');
    writeFileSync(join(shinobiRoot, 'settings.json'), '{}', 'utf-8');
  });

  afterEach(() => {
    try { if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true }); } catch {}
  });

  it('el README generado explica explícitamente que .env NO se incluye', () => {
    createBackup({ shinobiRoot, stagingDir });
    const readme = readFileSync(join(stagingDir, 'README.md'), 'utf-8');
    expect(readme).toMatch(/no incluye tu \.env/i);
  });

  it('el staging dir nunca contiene un .env, pase lo que pase', () => {
    createBackup({ shinobiRoot, stagingDir });
    expect(existsSync(join(stagingDir, '.env'))).toBe(false);
  });

  it('restoreBackup avisa por consola sobre reponer .env manualmente', () => {
    createBackup({ shinobiRoot, stagingDir });
    const destDir = join(workspace, 'restored');
    mkdirSync(destDir, { recursive: true });
    const warnSpy: string[] = [];
    const orig = console.warn;
    console.warn = (...args: any[]) => { warnSpy.push(args.join(' ')); };
    try {
      restoreBackup({ stagingDir, destDir });
    } finally {
      console.warn = orig;
    }
    expect(warnSpy.some((m) => /nunca incluyó tu \.env/i.test(m))).toBe(true);
  });
});
