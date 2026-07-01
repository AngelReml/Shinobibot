// src/audit/audit_anchor.ts
//
// F2.3 (auditoría 2026-07) — ANTI-TRUNCADO del audit trail.
//
// El hash-chain de audit_chain.ts (CRIT-06) detecta MANIPULACIÓN de una línea
// existente (editarla a mano rompe su chainHash y el de todas las siguientes).
// Pero NO detecta TRUNCADO: un atacante con acceso al disco puede borrar las
// últimas N líneas de audit.jsonl Y actualizar `<path>.chainhead.json` para que
// apunte al nuevo último chainHash (el que ahora es "el último" tras el corte).
// La cadena interna queda perfectamente consistente — `verifyChain()` la
// aprueba — porque nunca hubo referencia a cuántas líneas DEBERÍA haber.
//
// Este módulo añade esa referencia externa: un "ancla" (`audit.jsonl.anchor`)
// en una ubicación/fichero DISTINTO del propio log y de su chainhead, que
// registra periódicamente `{lineCount, chainHash}`. Al arrancar (o bajo
// demanda), `checkAnchorIntegrity()` compara el estado actual del log contra
// el ancla:
//   - Si el log tiene MENOS líneas que las que el ancla recuerda haber visto
//     → TRUNCADO detectado (alguien borró líneas del final).
//   - Si en el índice del ancla el chainHash no coincide con el recomputado
//     → la historia anterior a ese punto fue reescrita (manipulación, no solo
//     truncado — pero el ancla también la atrapa como caso general).
//
// No es un servicio remoto (fuera de alcance del fix puntual): es "un segundo
// fichero append-only en una ubicación distinta" tal y como pide la tarea. No
// reemplaza el hash-chain — es una capa ENCIMA que lo hace resistente a
// truncado, no solo a edición.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { buildChain, toLines, GENESIS } from './audit_chain.js';

export interface AnchorRecord {
  /** Nº de líneas del log en el momento de anclar. */
  lineCount: number;
  /** chainHash de la última línea en ese momento. */
  chainHash: string;
  ts: string;
}

/** Path del ancla para un log dado. Fichero DISTINTO de `<path>.chainhead.json`
 *  (ese es el "head de trabajo"; este es el "registro histórico de anclajes",
 *  append-only, pensado para no poder sobreescribirse en el mismo golpe que
 *  se trunca el log). */
export function anchorPath(logPath: string): string {
  return `${logPath}.anchor`;
}

/**
 * Añade un registro de ancla (append-only — nunca se reescribe ni se borra un
 * anchor previo, así que aunque el atacante trunque el log Y borre el
 * chainhead, un anchor histórico con más líneas de las que el log truncado
 * ahora tiene sigue en `*.anchor` delatando el corte).
 */
export function appendAnchor(logPath: string, record: AnchorRecord): void {
  const p = anchorPath(logPath);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(p, JSON.stringify(record) + '\n', 'utf-8');
}

/** Lee todos los registros de ancla persistidos (orden cronológico). */
export function readAnchors(logPath: string): AnchorRecord[] {
  const p = anchorPath(logPath);
  if (!existsSync(p)) return [];
  const out: AnchorRecord[] = [];
  for (const line of toLines(readFileSync(p, 'utf-8'))) {
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.lineCount === 'number' && typeof rec.chainHash === 'string') out.push(rec);
    } catch { /* línea de ancla corrupta — se ignora, no rompe la lectura de las demás */ }
  }
  return out;
}

/**
 * Anclaje periódico: cada `intervalLines` líneas nuevas desde el último
 * ancla, persiste un nuevo registro. Llamado desde `writeAuditEvent()` tras
 * cada escritura exitosa — barato (una comparación de contador + append
 * ocasional), no un timer aparte.
 */
export function maybeAnchor(logPath: string, currentLineCount: number, currentChainHash: string, intervalLines = 20): void {
  const anchors = readAnchors(logPath);
  const last = anchors[anchors.length - 1];
  if (!last || currentLineCount - last.lineCount >= intervalLines) {
    appendAnchor(logPath, { lineCount: currentLineCount, chainHash: currentChainHash, ts: new Date().toISOString() });
  }
}

export interface AnchorIntegrityResult {
  ok: boolean;
  reason: 'ok' | 'no_anchors' | 'truncated' | 'chain_mismatch';
  detail?: string;
  /** Último ancla contra el que se comparó, si había alguno. */
  lastAnchor?: AnchorRecord;
  /** Estado actual recomputado del log. */
  currentLineCount: number;
  currentChainHash: string;
}

/**
 * Verifica el log actual contra el histórico de anclas. Se llama al arrancar
 * el proceso (o bajo demanda desde un endpoint de salud). NO bloquea el
 * arranque — emite una alerta ruidosa por stderr (console.error) y devuelve
 * el resultado para que el caller decida (bloquear arranque es una decisión
 * de producto que excede este fix puntual; aquí garantizamos que NUNCA pasa
 * desapercibido).
 */
export function checkAnchorIntegrity(logPath: string): AnchorIntegrityResult {
  const anchors = readAnchors(logPath);
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  const lines = toLines(text);
  const chain = buildChain(lines, GENESIS);
  const currentChainHash = chain.length ? chain[chain.length - 1].chainHash : GENESIS;
  const currentLineCount = lines.length;

  if (anchors.length === 0) {
    // Log nuevo (o preexistente sin anclas todavías — instalación previa a
    // este fix). No es un error: se registra el primer ancla y se sigue.
    return { ok: true, reason: 'no_anchors', currentLineCount, currentChainHash };
  }

  const last = anchors[anchors.length - 1];

  if (currentLineCount < last.lineCount) {
    const detail = `audit.jsonl tiene ${currentLineCount} líneas pero el último ancla (${last.ts}) registró ${last.lineCount} — ${last.lineCount - currentLineCount} líneas desaparecidas del final.`;
    console.error(`[SECURITY] TRUNCADO DE AUDIT TRAIL DETECTADO: ${detail}`);
    return { ok: false, reason: 'truncated', detail, lastAnchor: last, currentLineCount, currentChainHash };
  }

  // Recompute el chainHash EN el índice del ancla (no en el final) para
  // detectar reescritura de historia anterior al punto anclado, aunque el
  // log actual tenga MÁS líneas que el ancla (creciendo normalmente).
  const chainAtAnchor = buildChain(lines.slice(0, last.lineCount), GENESIS);
  const hashAtAnchor = chainAtAnchor.length ? chainAtAnchor[chainAtAnchor.length - 1].chainHash : GENESIS;
  if (hashAtAnchor !== last.chainHash) {
    const detail = `el chainHash recomputado en la línea ${last.lineCount} (${hashAtAnchor.slice(0, 12)}…) no coincide con el ancla persistida (${last.chainHash.slice(0, 12)}…) de ${last.ts} — historia anterior al ancla fue reescrita.`;
    console.error(`[SECURITY] MANIPULACIÓN DE AUDIT TRAIL DETECTADA (anchor mismatch): ${detail}`);
    return { ok: false, reason: 'chain_mismatch', detail, lastAnchor: last, currentLineCount, currentChainHash };
  }

  return { ok: true, reason: 'ok', lastAnchor: last, currentLineCount, currentChainHash };
}
