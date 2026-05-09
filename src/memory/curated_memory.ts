// src/memory/curated_memory.ts
//
// Bloque 4 — Memoria persistente curada al estilo Hermes.
//
// Dos archivos en raíz del proyecto:
//   - USER.md    : preferencias y perfil del usuario (quién es)
//   - MEMORY.md  : notas del agente (entorno, herramientas, atajos, lessons)
//
// Coexiste con la memoria transaccional (src/db/memory.ts y
// src/memory/memory_store.ts). Son CAPAS DISTINTAS:
//   - transaccional   : turnos recientes con embeddings (efímera)
//   - curada (esta)   : preferencias persistentes (estable, frozen snapshot)
//
// Snapshot freeze:
//   - `loadAtBoot()` parsea ambos archivos y captura un snapshot inmutable
//     en RAM. `getSnapshot()` lo devuelve.
//   - Mid-session, las mutaciones (appendEnv, editUserSection,
//     approveEnvProposal, ...) persisten a disco INMEDIATAMENTE pero NO
//     refrescan el snapshot — esto preserva el prefix cache de la sesión.
//   - EXCEPCIÓN documentada en el spec: `appendEnv` y `approveEnvProposal`
//     SÍ refrescan el snapshot (el agente aprende de su propia sesión).
//
// Threat scan: el contenido se inyecta al system prompt en cada turno; un
// payload malicioso podría reescribir las instrucciones de Shinobi. Antes
// de aceptar contenido vía append/propose/edit, lo pasamos por un set de
// regex inspirado en Hermes. El error es VERBOSE (decisión G): muestra
// qué pattern se disparó y qué fragmento la activó, para que el usuario
// pueda decidir si reescribir o si es falso positivo.

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  parseSections,
  serializeSections,
  findSectionByName,
  replaceSection,
  appendAnonymous,
  totalChars,
  type Section,
} from './memory_md_parser.js';

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

// ─── Threat patterns (Hermes-inspired) ──────────────────────────────────────

interface ThreatPattern { rx: RegExp; id: string; }

const THREAT_PATTERNS: ThreatPattern[] = [
  // Prompt injection
  { rx: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
  { rx: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { rx: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { rx: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  { rx: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules' },
  { rx: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have)\s+(restrictions|limits|rules)/i, id: 'bypass_restrictions' },
  // Exfiltration via curl/wget with secrets
  { rx: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
  { rx: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
  { rx: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: 'read_secrets' },
  // Persistence via shell rc
  { rx: /authorized_keys/i, id: 'ssh_backdoor' },
  { rx: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
];

const INVISIBLE_CHARS = ['​', '‌', '‍', '⁠', '﻿', '‪', '‫', '‬', '‭', '‮'];

export type ThreatScanResult =
  | { ok: true }
  | { ok: false; pattern: string; fragment: string; hint: string };

export function scanContent(content: string): { ok: boolean; pattern?: string; fragment?: string; hint?: string } {
  // Invisible unicode first.
  for (const ch of INVISIBLE_CHARS) {
    const idx = content.indexOf(ch);
    if (idx >= 0) {
      const surrounding = content.slice(Math.max(0, idx - 20), Math.min(content.length, idx + 20));
      return {
        ok: false,
        pattern: `invisible_unicode_U+${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`,
        fragment: surrounding,
        hint: 'Caracter invisible detectado (posible payload). Re-escribe el contenido a mano.',
      };
    }
  }
  for (const p of THREAT_PATTERNS) {
    const m = content.match(p.rx);
    if (m) {
      const start = Math.max(0, (m.index ?? 0) - 20);
      const end = Math.min(content.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 20);
      return {
        ok: false,
        pattern: p.id,
        fragment: content.slice(start, end),
        hint: 'El contenido se inyecta al system prompt y no puede contener payloads de prompt injection o exfiltración. Reescribe la nota o reporta el falso positivo.',
      };
    }
  }
  return { ok: true };
}

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
  return `${sep}\n${header}\n${sep}\n${content}`;
}

// ─── Atomic write (temp + rename) ───────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
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
  private userPath: string;
  private memoryPath: string;
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
    const cwd = opts.cwd ?? process.cwd();
    this.userPath = path.join(cwd, 'USER.md');
    this.memoryPath = path.join(cwd, 'MEMORY.md');
    this.pendingPath = path.join(cwd, 'MEMORY.md.pending');
    this.userLimit = opts.userLimit ?? USER_LIMIT;
    this.memoryLimit = opts.memoryLimit ?? MEM_LIMIT;
  }

  /** Read both files, create from template if missing, capture frozen snapshot. */
  loadAtBoot(): { userEntries: number; memoryEntries: number; userPct: number; memoryPct: number; created: string[] } {
    const created: string[] = [];
    if (!fs.existsSync(this.userPath)) {
      atomicWrite(this.userPath, USER_TEMPLATE);
      created.push('USER.md');
    }
    if (!fs.existsSync(this.memoryPath)) {
      atomicWrite(this.memoryPath, MEMORY_TEMPLATE);
      created.push('MEMORY.md');
    }
    this.userSections = parseSections(fs.readFileSync(this.userPath, 'utf-8'));
    this.memorySections = parseSections(fs.readFileSync(this.memoryPath, 'utf-8'));
    this.refreshSnapshot();
    return {
      userEntries: this.userSections.length,
      memoryEntries: this.memorySections.length,
      userPct: this.percent('user'),
      memoryPct: this.percent('memory'),
      created,
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

  showUser(): string { return fs.existsSync(this.userPath) ? fs.readFileSync(this.userPath, 'utf-8') : ''; }
  showMemory(): string { return fs.existsSync(this.memoryPath) ? fs.readFileSync(this.memoryPath, 'utf-8') : ''; }
  listPending(): PendingNote[] { return readPending(this.pendingPath); }

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
  editUserSection(name: string, content: string): { ok: boolean; message: string } {
    const scan = scanContent(content);
    if (!scan.ok) return { ok: false, message: this.formatScanError(scan) };
    const next = replaceSection(this.userSections, name, content);
    const total = totalChars(next);
    if (total > this.userLimit) {
      return { ok: false, message: `USER.md sería ${total.toLocaleString()}/${this.userLimit.toLocaleString()} chars (sobre el límite). Acorta el contenido o sube SHINOBI_USER_CHAR_LIMIT.` };
    }
    this.userSections = next;
    atomicWrite(this.userPath, serializeSections(this.userSections));
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
  appendEnv(note: string): { ok: boolean; message: string } {
    const scan = scanContent(note);
    if (!scan.ok) return { ok: false, message: this.formatScanError(scan) };
    const next = appendAnonymous(this.memorySections, note);
    const total = totalChars(next);
    if (total > this.memoryLimit) {
      return { ok: false, message: `MEMORY.md sería ${total.toLocaleString()}/${this.memoryLimit.toLocaleString()} chars (sobre el límite). Borra notas obsoletas con /memory env edit o sube SHINOBI_MEMORY_CHAR_LIMIT.` };
    }
    this.memorySections = next;
    atomicWrite(this.memoryPath, serializeSections(this.memorySections));
    this.refreshSnapshot();
    return { ok: true, message: 'MEMORY.md actualizada y snapshot refrescada.' };
  }

  /** Add a note to the pending queue; needs explicit /memory env approve. */
  proposeEnv(note: string): { ok: boolean; idx?: number; message: string } {
    const scan = scanContent(note);
    if (!scan.ok) return { ok: false, message: this.formatScanError(scan) };
    const pending = readPending(this.pendingPath);
    const nextIdx = pending.length === 0 ? 1 : Math.max(...pending.map(p => p.idx)) + 1;
    pending.push({ idx: nextIdx, note: note.trim(), ts: new Date().toISOString() });
    atomicWrite(this.pendingPath, JSON.stringify(pending, null, 2));
    return { ok: true, idx: nextIdx, message: `Propuesta #${nextIdx} guardada en MEMORY.md.pending. Aprueba con /memory env approve ${nextIdx} o descarta con /memory env reject ${nextIdx}.` };
  }

  approveEnvProposal(idx: number): { ok: boolean; message: string } {
    const pending = readPending(this.pendingPath);
    const found = pending.find(p => p.idx === idx);
    if (!found) return { ok: false, message: `propuesta #${idx} no existe` };
    const result = this.appendEnv(found.note);
    if (!result.ok) return result;
    const remaining = pending.filter(p => p.idx !== idx);
    if (remaining.length === 0) {
      try { fs.unlinkSync(this.pendingPath); } catch { /* ignore */ }
    } else {
      atomicWrite(this.pendingPath, JSON.stringify(remaining, null, 2));
    }
    return { ok: true, message: `propuesta #${idx} aprobada y añadida a MEMORY.md.` };
  }

  rejectEnvProposal(idx: number): { ok: boolean; message: string } {
    const pending = readPending(this.pendingPath);
    const found = pending.find(p => p.idx === idx);
    if (!found) return { ok: false, message: `propuesta #${idx} no existe` };
    const remaining = pending.filter(p => p.idx !== idx);
    if (remaining.length === 0) {
      try { fs.unlinkSync(this.pendingPath); } catch { /* ignore */ }
    } else {
      atomicWrite(this.pendingPath, JSON.stringify(remaining, null, 2));
    }
    return { ok: true, message: `propuesta #${idx} descartada.` };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private formatScanError(scan: { pattern?: string; fragment?: string; hint?: string }): string {
    return [
      `Threat scan rechazó el contenido.`,
      `  pattern  : ${scan.pattern}`,
      `  fragment : ${scan.fragment}`,
      `  hint     : ${scan.hint}`,
    ].join('\n');
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: CuratedMemory | null = null;

export function curatedMemory(): CuratedMemory {
  if (!_instance) _instance = new CuratedMemory();
  return _instance;
}
