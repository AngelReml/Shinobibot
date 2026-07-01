// src/audit/audit_chain.ts
//
// MOTOR E7 — CADENA DE HASHES SOBRE EL AUDIT (inmutabilidad real).
//
// El audit.jsonl es append-only, pero "append-only y confía" no es inmutable: si
// alguien edita una línea pasada, nada lo delata. La cadena de hashes lo arregla
// al estilo blockchain: el hash de cada línea encadena el de la anterior, así que
// tocar CUALQUIER línea cambia su hash y el de TODAS las siguientes → la raíz no
// cuadra. Es el estándar técnico al que convergen EU AI Act / NIST AI RMF /
// OWASP LLM Top-10 para logs de auditoría de agentes (hash-chaining SHA-256).
//
// 100% determinista y sin dependencias (solo node:crypto). Funciones puras →
// testeable aislado y portable a un proof en Node.

import { createHash } from 'crypto';

/** Exportado: audit_log.ts lo reusa como semilla por defecto del head
 *  persistido (CRIT-06), para no duplicar el literal en dos módulos. */
export const GENESIS = 'SHINOBI_AUDIT_GENESIS_v1';

export interface ChainEntry {
  index: number;
  /** SHA-256 del contenido de la línea. */
  lineHash: string;
  /** chainHash de la línea anterior (o GENESIS para la primera). */
  prevHash: string;
  /** SHA-256(prevHash + lineHash): encadena. */
  chainHash: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Hash del contenido de una línea (independiente de su posición). */
export function hashLine(line: string): string {
  return sha256(line);
}

/** Normaliza texto JSONL en líneas no vacías (ignora CRLF y líneas en blanco). */
export function toLines(text: string): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Construye la cadena de hashes sobre las líneas (en orden). Cada chainHash
 * depende de toda la historia previa, así que la raíz (chainHash de la última
 * línea) compromete el log entero.
 */
export function buildChain(lines: string[], genesis = GENESIS): ChainEntry[] {
  const out: ChainEntry[] = [];
  let prev = genesis;
  for (let i = 0; i < lines.length; i++) {
    const lineHash = hashLine(lines[i]);
    const chainHash = sha256(prev + lineHash);
    out.push({ index: i, lineHash, prevHash: prev, chainHash });
    prev = chainHash;
  }
  return out;
}

/** Raíz de la cadena = chainHash de la última línea (o GENESIS si vacío). */
export function chainRoot(lines: string[], genesis = GENESIS): string {
  const chain = buildChain(lines, genesis);
  return chain.length ? chain[chain.length - 1].chainHash : genesis;
}

export interface ChainVerification {
  valid: boolean;
  /** Índice de la PRIMERA línea manipulada/insertada/borrada, si la hay. */
  brokenAt?: number;
  /** Raíz recomputada de `lines`. */
  root: string;
  /** Razón legible. */
  reason: 'ok' | 'root_mismatch' | 'tampered_line' | 'length_mismatch' | 'missing_chain';
}

/**
 * Verifica `lines` contra una cadena de REFERENCIA (la que se firmó/publicó).
 * Localiza la primera divergencia: distingue manipulación de línea de
 * inserción/borrado por longitud. Sin referencia, usa expectedRoot.
 *
 * Sin NINGUNA referencia externa (ALTA-08): auto-verifica la cadena embebida
 * en cada línea — el `prevHash`/`chainHash` que `writeAuditEvent()`
 * (audit_log.ts, CRIT-06) escribe en cada evento. Deja de ser un no-op: cada
 * línea se recomputa encadenada con la anterior y se compara contra lo
 * almacenado, así que una línea editada a mano (o un evento inyectado sin
 * pasar por `writeAuditEvent`) se detecta exactamente en su índice.
 */
export function verifyChain(
  lines: string[],
  reference?: { entries?: ChainEntry[]; expectedRoot?: string },
  genesis = GENESIS,
): ChainVerification {
  const recomputed = buildChain(lines, genesis);
  const root = recomputed.length ? recomputed[recomputed.length - 1].chainHash : genesis;

  if (reference?.entries) {
    const ref = reference.entries;
    const min = Math.min(ref.length, recomputed.length);
    for (let i = 0; i < min; i++) {
      if (recomputed[i].chainHash !== ref[i].chainHash) {
        return { valid: false, brokenAt: i, root, reason: 'tampered_line' };
      }
    }
    if (ref.length !== recomputed.length) {
      return { valid: false, brokenAt: min, root, reason: 'length_mismatch' };
    }
    return { valid: true, root, reason: 'ok' };
  }

  if (reference?.expectedRoot !== undefined) {
    return reference.expectedRoot === root
      ? { valid: true, root, reason: 'ok' }
      : { valid: false, root, reason: 'root_mismatch' };
  }

  return verifySelfEmbeddedChain(lines, genesis);
}

/**
 * Auto-verificación sin referencia externa (ALTA-08): cada línea de
 * `lines` debe traer sus propios `prevHash`/`chainHash` (los que escribe
 * `writeAuditEvent`). Recompone el contenido original quitando esos dos
 * campos (van siempre al final, así que el resto preserva el orden con el
 * que se hasheó en su momento), recalcula `chainHash = sha256(prevHash +
 * sha256(contenido))` y lo compara con el almacenado, encadenando con el
 * `chainHash` de la línea anterior. Cualquier línea sin campos de cadena,
 * con un `prevHash` que no enlaza con la anterior, o con un `chainHash` que
 * no cuadra, rompe la verificación en ese índice exacto.
 */
function verifySelfEmbeddedChain(lines: string[], genesis: string): ChainVerification {
  let prev = genesis;
  for (let i = 0; i < lines.length; i++) {
    let parsed: any;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { valid: false, brokenAt: i, root: prev, reason: 'missing_chain' };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, brokenAt: i, root: prev, reason: 'missing_chain' };
    }
    const { prevHash: storedPrev, chainHash: storedChain, ...rest } = parsed as Record<string, unknown>;
    if (typeof storedPrev !== 'string' || typeof storedChain !== 'string') {
      return { valid: false, brokenAt: i, root: prev, reason: 'missing_chain' };
    }
    if (storedPrev !== prev) {
      return { valid: false, brokenAt: i, root: prev, reason: 'tampered_line' };
    }
    const recomputedChain = buildChain([JSON.stringify(rest)], storedPrev)[0].chainHash;
    if (recomputedChain !== storedChain) {
      return { valid: false, brokenAt: i, root: prev, reason: 'tampered_line' };
    }
    prev = storedChain;
  }
  return { valid: true, root: prev, reason: 'ok' };
}
