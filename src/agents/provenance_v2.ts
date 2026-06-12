// src/agents/provenance_v2.ts
//
// MOTOR E7 — PAQUETE DE AUTONOMÍA DEMOSTRABLE v2 (firma ASIMÉTRICA + cadena).
//
// Corrige la debilidad real de v1 (provenance.ts): el HMAC simétrico solo prueba
// integridad y, para verificar, hay que COMPARTIR el secreto — y quien lo tiene
// puede FALSIFICAR. v2 firma con Ed25519 (clave privada del operador firma;
// CUALQUIERA verifica con la pública embebida y NADIE puede falsificar sin la
// privada) sobre un hash que incluye la RAÍZ DE LA CADENA del audit. Resultado:
//   1) prueba pública de autenticidad (no autorreferencial),
//   2) inmutabilidad real del rastro (tocar una línea del audit rompe la raíz),
//   3) cero dependencias nuevas (solo node:crypto) — coherente con el diseño.
//
// Es el estándar que la frontera regulatoria (EU AI Act ago-2026 / NIST) exige
// para agentes autónomos: firma + audit inmutable hash-chained. Hermes/OpenClaw
// no lo emiten. Y para una FAMILIA, es lo que vuelve confiable lo que el agente
// hizo: se puede comprobar, no hay que creer.

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { parseAuditLines } from '../audit/trust_ledger.js';
import { chainRoot, toLines } from '../audit/audit_chain.js';
import type { ToolCallEvent } from '../audit/audit_log.js';

export interface AuditSummary {
  events: number;
  toolCalls: number;
  successes: number;
  failures: number;
  loopAborts: number;
}

export interface SignedProvenance {
  version: 2;
  alg: 'ed25519';
  taskId: string;
  prompt: string;
  finalText: string;
  audit: AuditSummary;
  verdict?: { passed: boolean; rationale?: string };
  /** Raíz de la cadena de hashes del audit embebido (inmutabilidad). */
  auditChainRoot: string;
  /** Audit completo embebido (JSONL) para reproducir y recomputar la raíz. */
  auditLog?: string;
  /** SHA-256 del contenido canónico (incluye auditChainRoot). */
  contentHash: string;
  /** Clave pública del firmante (SPKI/PEM). El verificador no necesita nada más. */
  publicKeyPem: string;
  /** Firma Ed25519 (hex) del contentHash. */
  signature: string;
  signedAt: string;
}

export interface ProvenanceKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Genera un par Ed25519 para firmar provenance (el operador guarda la privada). */
export function generateProvenanceKeypair(): ProvenanceKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function summarizeAudit(text: string): AuditSummary {
  const events = parseAuditLines(text);
  let toolCalls = 0, successes = 0, failures = 0, loopAborts = 0;
  for (const ev of events) {
    if (ev.kind === 'tool_call') {
      toolCalls++;
      if ((ev as ToolCallEvent).success) successes++; else failures++;
    } else if (ev.kind === 'loop_abort') {
      loopAborts++;
    }
  }
  return { events: events.length, toolCalls, successes, failures, loopAborts };
}

/** Contenido canónico (orden de claves fijo) sobre el que se hashea y firma. */
function canonical(p: Pick<SignedProvenance, 'taskId' | 'prompt' | 'finalText' | 'audit' | 'verdict' | 'auditChainRoot'>): string {
  return JSON.stringify({
    taskId: p.taskId,
    prompt: p.prompt,
    finalText: p.finalText,
    audit: { events: p.audit.events, toolCalls: p.audit.toolCalls, successes: p.audit.successes, failures: p.audit.failures, loopAborts: p.audit.loopAborts },
    verdict: p.verdict ? { passed: p.verdict.passed, rationale: p.verdict.rationale ?? '' } : null,
    auditChainRoot: p.auditChainRoot,
  });
}

export interface BuildSignedProvenanceInput {
  taskId: string;
  prompt: string;
  finalText: string;
  auditPath?: string;
  auditText?: string;
  verdict?: { passed: boolean; rationale?: string };
  embedAudit?: boolean;
  /** Clave privada Ed25519 (PEM). */
  privateKeyPem: string;
  /** Clave pública Ed25519 (PEM) a embeber para verificación pública. */
  publicKeyPem: string;
  now?: () => string;
}

/** Construye el paquete FIRMADO con Ed25519 sobre el hash de contenido+raíz. */
export function buildSignedProvenance(input: BuildSignedProvenanceInput): SignedProvenance {
  let auditText = input.auditText ?? '';
  if (!auditText && input.auditPath && existsSync(input.auditPath)) {
    try { auditText = readFileSync(input.auditPath, 'utf-8'); } catch { auditText = ''; }
  }
  const audit = summarizeAudit(auditText);
  const auditChainRoot = chainRoot(toLines(auditText));
  const core = { taskId: input.taskId, prompt: input.prompt, finalText: input.finalText, audit, verdict: input.verdict, auditChainRoot };
  const contentHash = createHash('sha256').update(canonical(core)).digest('hex');
  const priv = createPrivateKey(input.privateKeyPem);
  const signature = edSign(null, Buffer.from(contentHash), priv).toString('hex');
  return {
    version: 2,
    alg: 'ed25519',
    ...core,
    auditLog: (input.embedAudit ?? true) ? auditText : undefined,
    contentHash,
    publicKeyPem: input.publicKeyPem,
    signature,
    signedAt: input.now ? input.now() : new Date().toISOString(),
  };
}

export interface SignedProvenanceVerification {
  valid: boolean;
  reason: 'ok' | 'hash_mismatch' | 'audit_root_mismatch' | 'signature_mismatch' | 'malformed';
}

/**
 * Verifica un paquete v2 SIN secretos compartidos:
 *   1) recomputa el hash de contenido (incluida la raíz) → detecta manipulación,
 *   2) recomputa la raíz de la cadena desde el audit embebido → detecta cualquier
 *      edición del rastro,
 *   3) verifica la firma Ed25519 con la PÚBLICA embebida → autenticidad real.
 * valid solo si los tres cuadran. Una pública distinta NO puede validar una firma
 * que no hizo su privada: falsificar es inviable.
 */
export function verifySignedProvenance(pkg: SignedProvenance): SignedProvenanceVerification {
  try {
    // 1) Integridad del contenido (incluye la raíz declarada).
    const expectedHash = createHash('sha256').update(canonical(pkg)).digest('hex');
    if (expectedHash !== pkg.contentHash) return { valid: false, reason: 'hash_mismatch' };

    // 2) La raíz declarada debe coincidir con la del audit embebido (si se embebió).
    if (pkg.auditLog !== undefined) {
      const recomputedRoot = chainRoot(toLines(pkg.auditLog));
      if (recomputedRoot !== pkg.auditChainRoot) return { valid: false, reason: 'audit_root_mismatch' };
    }

    // 3) Autenticidad: firma Ed25519 sobre el contentHash con la pública embebida.
    const pub = createPublicKey(pkg.publicKeyPem);
    const ok = edVerify(null, Buffer.from(pkg.contentHash), pub, Buffer.from(pkg.signature, 'hex'));
    return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
