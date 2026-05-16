/**
 * State Backup — backup/restore del estado completo de Shinobi a un repo
 * GitHub privado del usuario. Sprint 3.8 (parte 2).
 *
 * Estado que se incluye en el backup:
 *   - `config/`        — settings.json, .env redactado, etc.
 *   - `memory/`        — USER.md, MEMORY.md, memory.json, memory_store.db
 *   - `skills/approved/` — skills firmadas instaladas
 *   - `audit/audit.jsonl` — log de operaciones (REDACTADO con secret_redactor)
 *
 * Estado que se OMITE (deliberadamente):
 *   - `node_modules/`
 *   - `.git/`
 *   - cualquier `.env` sin redactar
 *   - cualquier `.key`, `.pem`, `.p12`, `.pfx`
 *
 * Implementación:
 *   - `createBackup(targetDir)`: copia + redacta a un staging dir.
 *   - `restoreBackup(stagingDir, destDir)`: re-aplica al estado.
 *   - El operador empuja el staging dir a su repo GitHub privado
 *     manualmente (con `git init && git remote add && git push`) o
 *     vía `gh repo create --private` desde un script externo.
 *
 * NO empujamos automáticamente porque eso requiere alta humana de
 * credenciales (token GitHub con scopes). El módulo prepara los
 * archivos; el push lo hace el operador.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'fs';
import { join, relative, dirname } from 'path';
import { redactSecretsByLine } from '../security/secret_redactor.js';

export interface BackupSource {
  /** Path relativo dentro del workspace de Shinobi. */
  relPath: string;
  /** ¿Recursivo? Default true para dirs, irrelevante para archivos. */
  recursive?: boolean;
  /** Si true, redactamos secrets antes de copiar. */
  redactSecrets?: boolean;
}

export interface BackupOptions {
  /** Raíz del workspace de Shinobi (típicamente cwd o WORKSPACE_ROOT). */
  shinobiRoot: string;
  /** Directorio destino donde se ensambla el backup. */
  stagingDir: string;
  /** Lista de fuentes; si se omite usa la default. */
  sources?: BackupSource[];
  /** Sobrescribir staging si ya existe. Default true. */
  overwrite?: boolean;
}

export interface BackupResult {
  shinobiRoot: string;
  stagingDir: string;
  filesCopied: number;
  filesRedacted: number;
  filesSkipped: number;
  bytesCopied: number;
  manifest: BackupManifest;
}

export interface BackupManifest {
  createdAt: string;
  shinobiRoot: string;
  files: Array<{ relPath: string; size: number; redacted: boolean }>;
  redactionCount: number;
}

const DEFAULT_SOURCES: BackupSource[] = [
  // Config minimal (no .env crudo).
  { relPath: 'settings.json' },
  { relPath: 'package.json' },
  // Memorias (curadas).
  { relPath: 'USER.md' },
  { relPath: 'MEMORY.md' },
  { relPath: 'memory.json' },
  // Skills aprobadas (las firmadas).
  { relPath: 'skills/approved', recursive: true },
  // Audit log con redacción.
  { relPath: 'audit/audit.jsonl', redactSecrets: true },
  // Reflections markdown.
  { relPath: 'reflections', recursive: true },
];

const FORBIDDEN_EXTS = new Set(['.env', '.key', '.pem', '.p12', '.pfx', '.crt', '.cer']);
const FORBIDDEN_BASENAMES = new Set(['.env', '.env.local', '.env.production', 'shinobi.lock', '.git']);

function safeCopyFile(src: string, dst: string, redact: boolean): { copied: boolean; redacted: boolean; size: number } {
  const stat = statSync(src);
  if (!stat.isFile()) return { copied: false, redacted: false, size: 0 };
  if (stat.size > 50 * 1024 * 1024) return { copied: false, redacted: false, size: 0 }; // >50MB skip
  mkdirSync(dirname(dst), { recursive: true });
  if (redact) {
    const txt = readFileSync(src, 'utf-8');
    const r = redactSecretsByLine(txt);
    writeFileSync(dst, r.text, 'utf-8');
    return { copied: true, redacted: r.matches.length > 0, size: r.text.length };
  }
  copyFileSync(src, dst);
  return { copied: true, redacted: false, size: stat.size };
}

function walkAndCopy(srcRoot: string, dstRoot: string, redact: boolean): { copied: number; redacted: number; skipped: number; bytes: number; files: Array<{ relPath: string; size: number; redacted: boolean }> } {
  let copied = 0, redacted = 0, skipped = 0, bytes = 0;
  const files: Array<{ relPath: string; size: number; redacted: boolean }> = [];
  function walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (FORBIDDEN_BASENAMES.has(name)) { skipped++; continue; }
      const abs = join(dir, name);
      let s;
      try { s = statSync(abs); } catch { continue; }
      if (s.isDirectory()) { walk(abs); continue; }
      if (!s.isFile()) continue;
      const ext = name.slice(name.lastIndexOf('.'));
      if (FORBIDDEN_EXTS.has(ext.toLowerCase())) { skipped++; continue; }
      const rel = relative(srcRoot, abs);
      const dst = join(dstRoot, rel);
      const r = safeCopyFile(abs, dst, redact);
      if (r.copied) {
        copied++;
        if (r.redacted) redacted++;
        bytes += r.size;
        files.push({ relPath: rel, size: r.size, redacted: r.redacted });
      } else {
        skipped++;
      }
    }
  }
  walk(srcRoot);
  return { copied, redacted, skipped, bytes, files };
}

export function createBackup(opts: BackupOptions): BackupResult {
  const { shinobiRoot } = opts;
  const stagingDir = opts.stagingDir;
  const sources = opts.sources ?? DEFAULT_SOURCES;
  if (opts.overwrite !== false && existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  mkdirSync(stagingDir, { recursive: true });

  let filesCopied = 0, filesRedacted = 0, filesSkipped = 0, bytesCopied = 0;
  const manifestFiles: Array<{ relPath: string; size: number; redacted: boolean }> = [];

  for (const src of sources) {
    const abs = join(shinobiRoot, src.relPath);
    if (!existsSync(abs)) { filesSkipped++; continue; }
    const s = statSync(abs);
    if (s.isDirectory() && (src.recursive ?? true)) {
      const r = walkAndCopy(abs, join(stagingDir, src.relPath), !!src.redactSecrets);
      filesCopied += r.copied;
      filesRedacted += r.redacted;
      filesSkipped += r.skipped;
      bytesCopied += r.bytes;
      // Reescribimos relPath para que sea relativo a shinobiRoot.
      for (const f of r.files) manifestFiles.push({ relPath: join(src.relPath, f.relPath).replace(/\\/g, '/'), size: f.size, redacted: f.redacted });
    } else if (s.isFile()) {
      const dst = join(stagingDir, src.relPath);
      const r = safeCopyFile(abs, dst, !!src.redactSecrets);
      if (r.copied) {
        filesCopied++;
        if (r.redacted) filesRedacted++;
        bytesCopied += r.size;
        manifestFiles.push({ relPath: src.relPath, size: r.size, redacted: r.redacted });
      } else {
        filesSkipped++;
      }
    }
  }

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    shinobiRoot,
    files: manifestFiles,
    redactionCount: filesRedacted,
  };
  writeFileSync(join(stagingDir, 'BACKUP_MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // README explica al operador cómo subirlo a GitHub privado.
  const readme = [
    '# Shinobi state backup',
    '',
    `Generado: ${manifest.createdAt}`,
    `Origen: ${shinobiRoot}`,
    `Archivos copiados: ${filesCopied} (${(bytesCopied / 1024).toFixed(1)} KiB)`,
    `Archivos con secrets redactados: ${filesRedacted}`,
    '',
    '## Para subir a tu repo GitHub privado',
    '',
    '```bash',
    `cd "${stagingDir}"`,
    'git init',
    'git add .',
    'git commit -m "Shinobi state backup"',
    'gh repo create my-shinobi-backup --private --source=. --remote=origin --push',
    '```',
    '',
    '## Para restaurar',
    '',
    '```bash',
    'shinobi backup restore <staging_dir>',
    '```',
    '',
    'Los secrets fueron REDACTADOS antes de copiar (audit.jsonl). Los archivos `.env`/`.key`/`.pem` se omiten explícitamente.',
  ].join('\n');
  writeFileSync(join(stagingDir, 'README.md'), readme, 'utf-8');

  return {
    shinobiRoot,
    stagingDir,
    filesCopied,
    filesRedacted,
    filesSkipped,
    bytesCopied,
    manifest,
  };
}

export interface RestoreOptions {
  stagingDir: string;
  destDir: string;
  /** Si true, sobrescribe archivos existentes en destDir. Default false. */
  overwrite?: boolean;
}

export interface RestoreResult {
  filesRestored: number;
  filesSkipped: number;
  manifest: BackupManifest;
}

export function restoreBackup(opts: RestoreOptions): RestoreResult {
  const manifestPath = join(opts.stagingDir, 'BACKUP_MANIFEST.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`backup inválido: no se encontró BACKUP_MANIFEST.json en ${opts.stagingDir}`);
  }
  const manifest: BackupManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  let restored = 0, skipped = 0;
  for (const f of manifest.files) {
    const src = join(opts.stagingDir, f.relPath);
    if (!existsSync(src)) { skipped++; continue; }

    // Los archivos marcados `redacted` en el manifest contienen
    // `<REDACTED:...>` en lugar de los valores reales (p.ej. audit.jsonl).
    // Restaurarlos SOBRE el archivo real destruiría datos de forma
    // irreversible — se restauran a un sidecar `<path>.from-backup` para que
    // el contenido del backup esté disponible sin clobberar el original.
    if (f.redacted) {
      const sidecar = join(opts.destDir, f.relPath + '.from-backup');
      mkdirSync(dirname(sidecar), { recursive: true });
      copyFileSync(src, sidecar);
      console.warn(`[backup] ${f.relPath} estaba redactado — restaurado a ${f.relPath}.from-backup (no se sobrescribe el original)`);
      restored++;
      continue;
    }

    const dst = join(opts.destDir, f.relPath);
    if (existsSync(dst) && !opts.overwrite) { skipped++; continue; }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    restored++;
  }
  return { filesRestored: restored, filesSkipped: skipped, manifest };
}
