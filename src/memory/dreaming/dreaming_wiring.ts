/**
 * Cableado del DreamingEngine (P2).
 *
 * El ResidentLoop llama `runDreamingCycle()` en cada tick cuando
 * SHINOBI_DREAMING_ENABLED=1. Es idempotente por día: solo procesa una vez
 * al día, leyendo la memoria conversacional y generando los dream files.
 */

import { join } from 'path';
import { Memory } from '../../db/memory.js';
import { DreamingEngine } from './dreaming_engine.js';
import type { MemoryMessage } from '../providers/types.js';

let _lastDreamDate = '';

export function dreamingEnabled(): boolean {
  return process.env.SHINOBI_DREAMING_ENABLED === '1';
}

/**
 * Corre un ciclo de dreaming sobre la memoria conversacional. Idempotente
 * por día (no re-procesa el mismo día). Devuelve los dream reports generados.
 */
export async function runDreamingCycle(opts?: { dreamsDir?: string; force?: boolean }): Promise<{ date: string; reports: number; files: string[] }> {
  const today = new Date().toISOString().slice(0, 10);
  if (_lastDreamDate === today && !opts?.force) {
    return { date: today, reports: 0, files: [] };
  }
  const chat = await new Memory().getMessages();
  const messages: MemoryMessage[] = chat.map((c) => ({
    role: c.role,
    content: c.content,
    ts: c.timestamp,
  }));
  const engine = new DreamingEngine({ dreamsDir: opts?.dreamsDir ?? join(process.cwd(), 'dreams') });
  const reports = await engine.dream(messages);
  _lastDreamDate = today;
  return { date: today, reports: reports.length, files: reports.map((r) => r.filePath) };
}

/** Test helper: reinicia la marca de "ya soñado hoy". */
export function _resetDreamingWiring(): void { _lastDreamDate = ''; }
