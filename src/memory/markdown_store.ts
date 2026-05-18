// src/memory/markdown_store.ts
//
// Store de memoria a largo plazo en Markdown plano. Un `MarkdownStore`
// gestiona UN archivo `.md` (típicamente memory/USER.md o memory/MEMORY.md):
//
//   - lectura/escritura ATÓMICA (escribe a `.tmp` + rename),
//   - LOCK de archivo cross-proceso (`.lock` con creación exclusiva, retry
//     acotado y ruptura de lock obsoleto) — dos procesos Shinobi sobre la
//     misma bóveda no se pisan en un read-modify-write,
//   - parse de entradas por el delimitador `§` (vía memory_md_parser),
//   - límites de caracteres por archivo,
//   - SCAN de inyección (threat_scan) antes de aceptar cualquier escritura.
//
// Es la capa de bajo nivel sobre la que se apoya CuratedMemory. Reemplaza al
// SQLite como backend de la memoria de usuario/entorno: los archivos .md son
// la única fuente de verdad y la bóveda es compatible con Obsidian.
//
// API SÍNCRONA a propósito: CuratedMemory y sus callers (slash commands,
// tool `memory`, background review) son síncronos. El lock se mantiene
// microsegundos, así que el busy-wait acotado es aceptable.

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  parseSections,
  serializeSections,
  replaceSection,
  appendAnonymous,
  totalChars,
  type Section,
} from './memory_md_parser.js';
import { scanContent } from './threat_scan.js';

export interface MarkdownStoreOptions {
  /** Ruta absoluta del archivo .md gestionado. */
  filePath: string;
  /** Límite de caracteres del archivo serializado. */
  charLimit: number;
  /** Contenido inicial si el archivo no existe. */
  template?: string;
  /** Tiempo máximo esperando el lock antes de fallar (default 5 s). */
  lockTimeoutMs?: number;
  /** Edad a partir de la cual un `.lock` se considera obsoleto (default 30 s). */
  lockStaleMs?: number;
}

export type WriteResult = { ok: true; message: string } | { ok: false; message: string };

/** Formatea el error verbose del threat scan. */
function formatScanError(scan: { pattern?: string; fragment?: string; hint?: string }): string {
  return [
    `Threat scan rechazó el contenido.`,
    `  pattern  : ${scan.pattern}`,
    `  fragment : ${scan.fragment}`,
    `  hint     : ${scan.hint}`,
  ].join('\n');
}

export class MarkdownStore {
  readonly filePath: string;
  readonly charLimit: number;
  private readonly template: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockStaleMs: number;

  constructor(opts: MarkdownStoreOptions) {
    this.filePath = path.resolve(opts.filePath);
    this.charLimit = opts.charLimit;
    this.template = opts.template ?? '';
    // El `.lock` es un dotfile — Obsidian ignora los archivos que empiezan
    // por punto, así que no contamina la bóveda.
    this.lockPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.lock`,
    );
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 5000;
    this.lockStaleMs = opts.lockStaleMs ?? 30_000;
  }

  // ─── Lectura ──────────────────────────────────────────────────────────────

  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /** Crea el archivo desde plantilla si no existe. Devuelve true si lo creó. */
  ensureExists(): boolean {
    if (fs.existsSync(this.filePath)) return false;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.atomicWrite(this.template);
    return true;
  }

  readRaw(): string {
    return fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, 'utf-8') : '';
  }

  readSections(): Section[] {
    return parseSections(this.readRaw());
  }

  charCount(): number {
    return totalChars(this.readSections());
  }

  percent(): number {
    return this.charLimit > 0
      ? Math.min(100, Math.floor((this.charCount() / this.charLimit) * 100))
      : 0;
  }

  // ─── Lock cross-proceso ──────────────────────────────────────────────────

  private acquireLock(): void {
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        // `wx` = crear en exclusiva: falla con EEXIST si el lock ya existe.
        const fd = fs.openSync(this.lockPath, 'wx');
        try { fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`); }
        finally { fs.closeSync(fd); }
        return;
      } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
        // Lock ocupado — comprueba si está obsoleto (proceso muerto sin
        // liberar). Si la mtime es vieja, lo rompemos y reintentamos.
        try {
          const st = fs.statSync(this.lockPath);
          if (Date.now() - st.mtimeMs > this.lockStaleMs) {
            try { fs.unlinkSync(this.lockPath); } catch { /* otro lo rompió */ }
            continue;
          }
        } catch {
          // El lock desapareció entre el open y el stat — reintenta ya.
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `markdown_store: timeout (${this.lockTimeoutMs} ms) esperando el lock de ${this.filePath}`,
          );
        }
        // Espera breve y síncrona — el lock se mantiene microsegundos.
        const until = Date.now() + 20;
        while (Date.now() < until) { /* spin acotado */ }
      }
    }
  }

  private releaseLock(): void {
    try { fs.unlinkSync(this.lockPath); } catch { /* ya liberado */ }
  }

  /** Ejecuta `fn` con el lock tomado. Siempre lo libera. */
  private withLock<T>(fn: () => T): T {
    this.acquireLock();
    try { return fn(); }
    finally { this.releaseLock(); }
  }

  /**
   * Como `withLock` pero un fallo de adquisición del lock (timeout, etc.) se
   * devuelve como `WriteResult` en vez de propagarse como excepción — así las
   * mutaciones tienen una API uniforme: scan, límite y lock fallan igual.
   */
  private lockedMutation(fn: () => WriteResult): WriteResult {
    try {
      return this.withLock(fn);
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  }

  // ─── Escritura atómica ───────────────────────────────────────────────────

  private atomicWrite(content: string): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }

  // ─── Mutaciones (read-modify-write completo bajo lock) ───────────────────

  /**
   * Reescribe el archivo entero con `sections`. Escanea cada cuerpo de
   * sección y valida el límite ANTES de tocar disco.
   */
  writeSections(sections: Section[]): WriteResult {
    for (const s of sections) {
      const scan = scanContent(s.body);
      if (!scan.ok) return { ok: false, message: formatScanError(scan) };
    }
    const serialized = serializeSections(sections);
    if (serialized.length > this.charLimit) {
      return {
        ok: false,
        message: `${path.basename(this.filePath)} sería ${serialized.length.toLocaleString()}/` +
          `${this.charLimit.toLocaleString()} chars (sobre el límite).`,
      };
    }
    return this.lockedMutation(() => {
      this.atomicWrite(serialized);
      return { ok: true, message: `${path.basename(this.filePath)} escrito (${serialized.length} chars).` };
    });
  }

  /**
   * Añade una entrada anónima (entry-style §) al final del archivo.
   * El read-modify-write completo corre bajo lock: lee fresco de disco,
   * añade, valida y escribe — sin ventana de lost-update entre procesos.
   */
  appendEntry(body: string): WriteResult {
    const scan = scanContent(body);
    if (!scan.ok) return { ok: false, message: formatScanError(scan) };
    return this.lockedMutation(() => {
      const sections = parseSections(this.readRaw());
      const next = appendAnonymous(sections, body);
      const serialized = serializeSections(next);
      if (serialized.length > this.charLimit) {
        return {
          ok: false,
          message: `${path.basename(this.filePath)} sería ${serialized.length.toLocaleString()}/` +
            `${this.charLimit.toLocaleString()} chars (sobre el límite). ` +
            `Borra notas obsoletas o sube el límite.`,
        };
      }
      this.atomicWrite(serialized);
      return { ok: true, message: `${path.basename(this.filePath)} actualizado.` };
    });
  }

  /**
   * Reemplaza (o inserta) el cuerpo de la sección nombrada `name`.
   * Read-modify-write completo bajo lock.
   */
  replaceNamedSection(name: string, body: string): WriteResult {
    const scan = scanContent(body);
    if (!scan.ok) return { ok: false, message: formatScanError(scan) };
    return this.lockedMutation(() => {
      const sections = parseSections(this.readRaw());
      const next = replaceSection(sections, name, body);
      const serialized = serializeSections(next);
      if (serialized.length > this.charLimit) {
        return {
          ok: false,
          message: `${path.basename(this.filePath)} sería ${serialized.length.toLocaleString()}/` +
            `${this.charLimit.toLocaleString()} chars (sobre el límite). Acorta el contenido.`,
        };
      }
      this.atomicWrite(serialized);
      return { ok: true, message: `${path.basename(this.filePath)} sección "${name}" actualizada.` };
    });
  }
}
