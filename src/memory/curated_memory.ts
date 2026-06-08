// src/memory/curated_memory.ts
//
// Bloque 4 — Memoria persistente curada al estilo Hermes.
//
// Dos archivos Markdown planos en la bóveda `memory/` del proyecto:
//   - memory/USER.md    : preferencias y perfil del usuario (quién es)
//   - memory/MEMORY.md  : notas del agente (entorno, herramientas, lessons)
//
// `memory/` es la ÚNICA fuente de verdad de la memoria a largo plazo y es una
// bóveda compatible con Obsidian (solo .md planos). SQLite ya NO almacena
// memoria de usuario/entorno — el índice semántico (memory_store.ts) es un
// derivado reconstruible desde MEMORY.md (ver semantic_index.ts).
//
// Capas de memoria (distintas, no se mezclan):
//   - transaccional   : turnos recientes (src/db/memory.ts, memory.json)
//   - curada (esta)   : preferencias persistentes en Markdown, frozen snapshot
//   - índice semántico: derivado de MEMORY.md para recall por embeddings
//
// Snapshot freeze:
//   - `loadAtBoot()` parsea ambos archivos y captura un snapshot inmutable
//     en RAM. `getSnapshot()` lo devuelve. El system prompt lo inyecta cada
//     turno (context_builder.ts) — tier estable que preserva el prefix cache.
//   - Mid-session, `editUserSection` persiste a disco pero NO refresca el
//     snapshot (los cambios se ven al siguiente reinicio).
//   - EXCEPCIÓN documentada: `appendEnv` / `approveEnvProposal` SÍ refrescan
//     el snapshot (el agente aprende de su propia sesión).
//
// La E/S de bajo nivel (escritura atómica, file-lock cross-proceso, parse §,
// límites de chars, scan de inyección) la hace `MarkdownStore`.

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  serializeSections,
  totalChars,
  type Section,
} from './memory_md_parser.js';
import { MarkdownStore } from './markdown_store.js';
import { scanContent } from './threat_scan.js';
import { ContradictionFilter } from './contradiction_filter.js';

// Re-export para compatibilidad con callers que importaban scanContent desde
// este módulo (el threat scan vive ahora en threat_scan.ts).
export { scanContent } from './threat_scan.js';
export type { ThreatScanResult } from './threat_scan.js';

const USER_CHAR_LIMIT_DEFAULT = 1375;
const MEMORY_CHAR_LIMIT_DEFAULT = 2200;

const USER_LIMIT = parseInt(process.env.SHINOBI_USER_CHAR_LIMIT || String(USER_CHAR_LIMIT_DEFAULT), 10);
const MEM_LIMIT = parseInt(process.env.SHINOBI_MEMORY_CHAR_LIMIT || String(MEMORY_CHAR_LIMIT_DEFAULT), 10);

const USER_TEMPLATE = `# Nombre y ubicación
(escribe aquí tu nombre, idioma preferido, zona horaria)

§

# Estilo de comunicación
(formal/informal, longitud preferida de respuestas, idioma de salida)

§

# Proyectos activos
- Shinobi: C:\\Users\\angel\\Desktop\\shinobibot
(añade rutas de tus proyectos clave)

§

# Restricciones
(cosas que NO debe hacer Shinobi — ej. no commitear sin pedir, no tocar X)
`;

const MEMORY_TEMPLATE = `# Notas del entorno
(rutas habituales, herramientas instaladas, atajos)

§

# Errores conocidos y workarounds
(ej. "OpenGravity gateway puede caer — fallback OpenRouter activo")
`;

// ─── Snapshot block render ──────────────────────────────────────────────────

function renderBlock(target: 'user' | 'memory', sections: Section[], limit: number): string {
  if (sections.length === 0) return '';
  const content = serializeSections(sections).trim();
  if (!content) return '';
  const current = content.length;
  const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
  const header = target === 'user'
    ? `USER PROFILE (who the user is) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`
    : `MEMORY (your persistent notes) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`;
  const sep = '═'.repeat(46);
  // FIX-004 — el header mostraba el % de ocupación, pero el cuerpo se inyectaba
  // COMPLETO sin topar al límite: un MEMORY.md/USER.md grande reventaba el
  // contexto. Trunca el cuerpo al límite y marca el sobrante.
  let body = content;
  if (limit > 0 && current > limit) {
    const overflow = current - limit;
    body = content.slice(0, limit) +
      `\n[…truncado: ${overflow.toLocaleString()} chars sobre el límite, edita memory/MEMORY.md]`;
  }
  return `${sep}\n${header}\n${sep}\n${body}`;
}

// ─── Atomic write para el JSON de propuestas pendientes ─────────────────────

function atomicWriteJson(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ─── Pending proposals (env propose flow) ──────────────────────────────────

interface PendingNote { idx: number; note: string; ts: string; }

function readPending(filePath: string): PendingNote[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(p => typeof p?.idx === 'number') : [];
  } catch { return []; }
}

// ─── Main class ─────────────────────────────────────────────────────────────

export interface CuratedMemoryOptions {
  cwd?: string;
  userLimit?: number;
  memoryLimit?: number;
}

export class CuratedMemory {
  private readonly cwd: string;
  private readonly memoryDir: string;
  private userStore: MarkdownStore;
  private memStore: MarkdownStore;
  /** JSON de propuestas — dotfile en la raíz, FUERA de la bóveda Obsidian. */
  private pendingPath: string;
  private userLimit: number;
  private memoryLimit: number;

  private userSections: Section[] = [];
  private memorySections: Section[] = [];

  /** Frozen at loadAtBoot(). Mutations don't touch this until refreshSnapshot(). */
  private snapshot: { user: string; memory: string; combined: string | null } = {
    user: '',
    memory: '',
    combined: null,
  };

  constructor(opts: CuratedMemoryOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.memoryDir = path.join(this.cwd, 'memory');
    this.userLimit = opts.userLimit ?? USER_LIMIT;
    this.memoryLimit = opts.memoryLimit ?? MEM_LIMIT;
    this.userStore = new MarkdownStore({
      filePath: path.join(this.memoryDir, 'USER.md'),
      charLimit: this.userLimit,
      template: USER_TEMPLATE,
    });
    this.memStore = new MarkdownStore({
      filePath: path.join(this.memoryDir, 'MEMORY.md'),
      charLimit: this.memoryLimit,
      template: MEMORY_TEMPLATE,
    });
    this.pendingPath = path.join(this.cwd, '.memory-pending.json');
  }

  /** Rutas de los archivos gestionados (para callers que las necesiten). */
  get paths(): { user: string; memory: string; dir: string } {
    return { user: this.userStore.filePath, memory: this.memStore.filePath, dir: this.memoryDir };
  }

  /**
   * Migración one-shot: la memoria curada vivía en la RAÍZ del proyecto
   * (USER.md / MEMORY.md). Si están ahí y aún no existen en memory/, las
   * traslada a la bóveda. Idempotente — si memory/ ya tiene los archivos no
   * hace nada. Devuelve la lista de movimientos realizados.
   */
  private migrateLegacy(): string[] {
    const moved: string[] = [];
    const jobs: Array<{ legacy: string; next: string; label: string }> = [
      { legacy: path.join(this.cwd, 'USER.md'), next: this.userStore.filePath, label: 'USER.md → memory/USER.md' },
      { legacy: path.join(this.cwd, 'MEMORY.md'), next: this.memStore.filePath, label: 'MEMORY.md → memory/MEMORY.md' },
      { legacy: path.join(this.cwd, 'MEMORY.md.pending'), next: this.pendingPath, label: 'MEMORY.md.pending → .memory-pending.json' },
    ];
    for (const j of jobs) {
      if (fs.existsSync(j.next) || !fs.existsSync(j.legacy)) continue;
      try {
        const dir = path.dirname(j.next);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(j.legacy, j.next);
        moved.push(j.label);
      } catch {
        // Si el rename falla (p. ej. volúmenes distintos) copia + borra.
        try {
          fs.copyFileSync(j.legacy, j.next);
          fs.unlinkSync(j.legacy);
          moved.push(j.label);
        } catch { /* se cae a la plantilla en loadAtBoot */ }
      }
    }
    return moved;
  }

  /** Read both files, migrate legacy, create from template if missing, freeze snapshot. */
  loadAtBoot(): {
    userEntries: number; memoryEntries: number;
    userPct: number; memoryPct: number;
    created: string[]; migrated: string[];
  } {
    const migrated = this.migrateLegacy();
    const created: string[] = [];
    if (this.userStore.ensureExists()) created.push('memory/USER.md');
    if (this.memStore.ensureExists()) created.push('memory/MEMORY.md');
    this.userSections = this.userStore.readSections();
    this.memorySections = this.memStore.readSections();
    this.refreshSnapshot();
    return {
      userEntries: this.userSections.length,
      memoryEntries: this.memorySections.length,
      userPct: this.percent('user'),
      memoryPct: this.percent('memory'),
      created,
      migrated,
    };
  }

  /** Re-render the frozen snapshot from current in-memory sections. */
  refreshSnapshot(): void {
    const userBlock = renderBlock('user', this.userSections, this.userLimit);
    const memBlock = renderBlock('memory', this.memorySections, this.memoryLimit);
    const parts = [userBlock, memBlock].filter(s => s.length > 0);
    this.snapshot = {
      user: userBlock,
      memory: memBlock,
      combined: parts.length > 0 ? parts.join('\n\n') : null,
    };
  }

  /** Returns the FROZEN snapshot for system prompt injection. Null when empty. */
  getSnapshot(): string | null {
    return this.snapshot.combined;
  }

  // ─── Read-only views ─────────────────────────────────────────────────────

  showUser(): string { return this.userStore.readRaw(); }
  showMemory(): string { return this.memStore.readRaw(); }
  listPending(): PendingNote[] { return readPending(this.pendingPath); }

  /**
   * Entradas de MEMORY.md como texto plano — usado por semantic_index.ts para
   * reconstruir el índice de recall semántico desde la fuente de verdad.
   * Devuelve solo las entradas con contenido (descarta secciones vacías).
   */
  memoryEntries(): string[] {
    return this.memorySections
      .map(s => (s.name ? `${s.name}: ${s.body}` : s.body).trim())
      .filter(t => t.length > 0);
  }

  percent(target: 'user' | 'memory'): number {
    const sections = target === 'user' ? this.userSections : this.memorySections;
    const limit = target === 'user' ? this.userLimit : this.memoryLimit;
    const cur = totalChars(sections);
    return limit > 0 ? Math.min(100, Math.floor((cur / limit) * 100)) : 0;
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  /**
   * Edit a named section of USER.md by replacing its body. NO snapshot refresh
   * (intentional — preserves prefix cache; takes effect on next reboot).
   */
  async editUserSection(name: string, content: string): Promise<{ ok: boolean; message: string }> {
    const check = await ContradictionFilter.check(content);
    if (check.hasConflict) {
      console.warn(`[CONTRADICCIÓN MEMORIA L3 DETECTADA]
  Hecho Propuesto para sección "${name}": "${content}"
  Hecho Existente: "${check.conflictingFact}"
  Razón: "${check.reason}"
  -> Generando evento de conciliación en segundo plano.`);

      const pending = readPending(this.pendingPath);
      const nextIdx = pending.length === 0 ? 1 : Math.max(...pending.map(p => p.idx)) + 1;
      pending.push({
        idx: nextIdx,
        note: `[CONCILIACIÓN REQUERIDA] Conflicto al editar la sección "${name}" con "${content}". Conflicto con: "${check.conflictingFact}". Razón: ${check.reason}`,
        ts: new Date().toISOString()
      });
      atomicWriteJson(this.pendingPath, JSON.stringify(pending, null, 2));

      return {
        ok: false,
        message: `Conflicto de memoria detectado: "${check.reason}". Se ha generado un evento de conciliación pendiente #${nextIdx}.`
      };
    }

    const r = this.userStore.replaceNamedSection(name, content);
    if (!r.ok) return r;
    this.userSections = this.userStore.readSections();
    return {
      ok: true,
      message: `USER.md sección "${name}" actualizada. Cambios visibles al LLM tras el siguiente reinicio (snapshot frozen).`,
    };
  }

  /**
   * Append a new anonymous note to MEMORY.md and REFRESH the snapshot. The
   * snapshot refresh is the documented exception to the freeze rule (the
   * agent's own appends should be visible immediately).
   */
  async appendEnv(note: string): Promise<{ ok: boolean; message: string }> {
    const check = await ContradictionFilter.check(note);
    if (check.hasConflict) {
      console.warn(`[CONTRADICCIÓN MEMORIA L3 DETECTADA]
  Hecho Propuesto: "${note}"
  Hecho Existente: "${check.conflictingFact}"
  Razón: "${check.reason}"
  -> Generando evento de conciliación en segundo plano.`);

      const pending = readPending(this.pendingPath);
      const nextIdx = pending.length === 0 ? 1 : Math.max(...pending.map(p => p.idx)) + 1;
      pending.push({
        idx: nextIdx,
        note: `[CONCILIACIÓN REQUERIDA] Conflicto entre el hecho propuesto "${note}" y el existente "${check.conflictingFact}". Razón: ${check.reason}`,
        ts: new Date().toISOString()
      });
      atomicWriteJson(this.pendingPath, JSON.stringify(pending, null, 2));

      return {
        ok: false,
        message: `Conflicto de memoria detectado: "${check.reason}". Se ha generado un evento de conciliación pendiente #${nextIdx}.`
      };
    }

    return this.appendEnvRaw(note);
  }

  private appendEnvRaw(note: string): { ok: boolean; message: string } {
    const r = this.memStore.appendEntry(note);
    if (!r.ok) return r;
    this.memorySections = this.memStore.readSections();
    this.refreshSnapshot();
    return { ok: true, message: 'MEMORY.md actualizada y snapshot refrescada.' };
  }

  /** Add a note to the pending queue; needs explicit /memory env approve. */
  async proposeEnv(note: string): Promise<{ ok: boolean; idx?: number; message: string }> {
    const scan = scanContent(note);
    if (!scan.ok) {
      return {
        ok: false,
        message: [
          `Threat scan rechazó el contenido.`,
          `  pattern  : ${scan.pattern}`,
          `  fragment : ${scan.fragment}`,
          `  hint     : ${scan.hint}`,
        ].join('\n'),
      };
    }

    const check = await ContradictionFilter.check(note);
    let noteToSave = note.trim();
    let warningMsg = '';
    if (check.hasConflict) {
      console.warn(`[CONTRADICCIÓN MEMORIA L3 DETECTADA EN PROPUESTA]
  Propuesta: "${note}"
  Hecho Existente: "${check.conflictingFact}"
  Razón: "${check.reason}"`);
      noteToSave = `[CONCILIACIÓN REQUERIDA] ${noteToSave} (Conflicto con: "${check.conflictingFact}". Razón: ${check.reason})`;
      warningMsg = ` (¡Advertencia: se detectó conflicto con "${check.conflictingFact}"!)`;
    }

    const pending = readPending(this.pendingPath);
    const nextIdx = pending.length === 0 ? 1 : Math.max(...pending.map(p => p.idx)) + 1;
    pending.push({ idx: nextIdx, note: noteToSave, ts: new Date().toISOString() });
    atomicWriteJson(this.pendingPath, JSON.stringify(pending, null, 2));
    return { ok: true, idx: nextIdx, message: `Propuesta #${nextIdx} guardada${warningMsg}. Aprueba con /memory env approve ${nextIdx} o descarta con /memory env reject ${nextIdx}.` };
  }

  async approveEnvProposal(idx: number): Promise<{ ok: boolean; message: string }> {
    const pending = readPending(this.pendingPath);
    const found = pending.find(p => p.idx === idx);
    if (!found) return { ok: false, message: `propuesta #${idx} no existe` };
    const result = this.appendEnvRaw(found.note);
    if (!result.ok) return result;
    const remaining = pending.filter(p => p.idx !== idx);
    if (remaining.length === 0) {
      try { fs.unlinkSync(this.pendingPath); } catch { /* ignore */ }
    } else {
      atomicWriteJson(this.pendingPath, JSON.stringify(remaining, null, 2));
    }
    return { ok: true, message: `propuesta #${idx} aprobada y añadida a MEMORY.md.` };
  }

  async rejectEnvProposal(idx: number): Promise<{ ok: boolean; message: string }> {
    const pending = readPending(this.pendingPath);
    const found = pending.find(p => p.idx === idx);
    if (!found) return { ok: false, message: `propuesta #${idx} no existe` };
    const remaining = pending.filter(p => p.idx !== idx);
    if (remaining.length === 0) {
      try { fs.unlinkSync(this.pendingPath); } catch { /* ignore */ }
    } else {
      atomicWriteJson(this.pendingPath, JSON.stringify(remaining, null, 2));
    }
    return { ok: true, message: `propuesta #${idx} descartada.` };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: CuratedMemory | null = null;

export function curatedMemory(): CuratedMemory {
  if (!_instance) _instance = new CuratedMemory();
  return _instance;
}
