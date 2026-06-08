// src/agents/provenance.ts
//
// FASE 4.1 — PAQUETE DE AUTONOMÍA DEMOSTRABLE.
//
// El titular irrefutable del benchmark: por cada tarea, shinobi emite un paquete
// FIRMADO y VERIFICABLE de lo que hizo {prompt, resultado, resumen del audit,
// veredicto de verificación, hash, firma HMAC}. Cualquiera puede:
//   1) recomputar el hash del contenido → detecta manipulación,
//   2) recomputar la firma HMAC con el secreto → confirma autenticidad,
//   3) reproducir desde el audit.jsonl embebido.
// Hermes y OpenClaw NO pueden producir esto (no firman su rastro de ejecución
// de forma verificable). Es la prueba, no la opinión.

import { createHash, createHmac } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { parseAuditLines } from '../audit/trust_ledger.js';
import type { ToolCallEvent } from '../audit/audit_log.js';

export interface AuditSummary {
  events: number;
  toolCalls: number;
  successes: number;
  failures: number;
  loopAborts: number;
}

export interface ProvenancePackage {
  version: 1;
  taskId: string;
  prompt: string;
  finalText: string;
  audit: AuditSummary;
  verdict?: { passed: boolean; rationale?: string };
  /** Audit completo embebido (JSONL) para reproducir. */
  auditLog?: string;
  /** SHA256 del contenido canónico (excluye hash/firma). */
  contentHash: string;
  /** HMAC-SHA256 del contentHash con el secreto del operador. */
  signature: string;
  signedAt: string;
}

function secretOf(s?: string): string {
  return s || process.env.SHINOBI_PROVENANCE_SECRET || 'shinobi-default-provenance-secret';
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
function canonical(p: Pick<ProvenancePackage, 'taskId' | 'prompt' | 'finalText' | 'audit' | 'verdict'>): string {
  return JSON.stringify({
    taskId: p.taskId,
    prompt: p.prompt,
    finalText: p.finalText,
    audit: { events: p.audit.events, toolCalls: p.audit.toolCalls, successes: p.audit.successes, failures: p.audit.failures, loopAborts: p.audit.loopAborts },
    verdict: p.verdict ? { passed: p.verdict.passed, rationale: p.verdict.rationale ?? '' } : null,
  });
}

export interface BuildProvenanceInput {
  taskId: string;
  prompt: string;
  finalText: string;
  /** Ruta al audit.jsonl de la corrida (o pásalo como auditText). */
  auditPath?: string;
  auditText?: string;
  verdict?: { passed: boolean; rationale?: string };
  /** Embeber el log completo en el paquete (default true). */
  embedAudit?: boolean;
  secret?: string;
  now?: () => string;
}

/** Construye el paquete firmado. */
export function buildProvenancePackage(input: BuildProvenanceInput): ProvenancePackage {
  let auditText = input.auditText ?? '';
  if (!auditText && input.auditPath && existsSync(input.auditPath)) {
    try { auditText = readFileSync(input.auditPath, 'utf-8'); } catch { auditText = ''; }
  }
  const audit = summarizeAudit(auditText);
  const core = { taskId: input.taskId, prompt: input.prompt, finalText: input.finalText, audit, verdict: input.verdict };
  const contentHash = createHash('sha256').update(canonical(core)).digest('hex');
  const signature = createHmac('sha256', secretOf(input.secret)).update(contentHash).digest('hex');
  return {
    version: 1,
    ...core,
    auditLog: (input.embedAudit ?? true) ? auditText : undefined,
    contentHash,
    signature,
    signedAt: input.now ? input.now() : new Date().toISOString(),
  };
}

export interface ProvenanceVerification {
  valid: boolean;
  reason?: 'hash_mismatch' | 'signature_mismatch' | 'ok';
}

/**
 * Verifica un paquete: recomputa el hash del contenido y la firma HMAC. valid
 * solo si AMBOS coinciden. Detecta cualquier manipulación del contenido o firma.
 */
export function verifyProvenancePackage(pkg: ProvenancePackage, secret?: string): ProvenanceVerification {
  const expectedHash = createHash('sha256').update(canonical(pkg)).digest('hex');
  if (expectedHash !== pkg.contentHash) return { valid: false, reason: 'hash_mismatch' };
  const expectedSig = createHmac('sha256', secretOf(secret)).update(pkg.contentHash).digest('hex');
  if (expectedSig !== pkg.signature) return { valid: false, reason: 'signature_mismatch' };
  return { valid: true, reason: 'ok' };
}
