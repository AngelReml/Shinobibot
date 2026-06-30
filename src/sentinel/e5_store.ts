/**
 * E5 — persistencia de claims e hipótesis.
 *
 * Claims: data/sentinel/e5_claims.json
 * Hipótesis: data/sentinel/e5_hypotheses.json
 *
 * Además alimenta la memoria temporal E4 (MemoryStore) con los claims
 * admisibles (SOLID/PLAUSIBLE), usando valid_from/valid_until para que
 * el self-check gate de E4 filtre los caducados automáticamente.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { E5Claim, E5Hypothesis } from './e5_types.js';

function loadJson<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function saveJson<T>(path: string, data: T[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export class E5Store {
  private claimsPath: string;
  private hypothesesPath: string;

  constructor(dataDir: string) {
    this.claimsPath = join(dataDir, 'e5_claims.json');
    this.hypothesesPath = join(dataDir, 'e5_hypotheses.json');
  }

  // ── Claims ──────────────────────────────────────────────────────────

  loadClaims(): E5Claim[] {
    return loadJson<E5Claim>(this.claimsPath);
  }

  saveClaims(claims: E5Claim[]): void {
    saveJson(this.claimsPath, claims);
  }

  /** Añade claims nuevos (evita duplicados por claimId). */
  appendClaims(incoming: E5Claim[]): { added: number; duplicates: number } {
    const existing = this.loadClaims();
    const seen = new Set(existing.map((c) => c.claimId));
    const toAdd = incoming.filter((c) => !seen.has(c.claimId));
    this.saveClaims([...existing, ...toAdd]);
    return { added: toAdd.length, duplicates: incoming.length - toAdd.length };
  }

  /** Claims vigentes (dentro de su ventana temporal). */
  activeClaims(now = new Date()): E5Claim[] {
    const ts = now.toISOString();
    return this.loadClaims().filter(
      (c) => c.valid_from <= ts && c.valid_until >= ts,
    );
  }

  // ── Hipótesis ───────────────────────────────────────────────────────

  loadHypotheses(): E5Hypothesis[] {
    return loadJson<E5Hypothesis>(this.hypothesesPath);
  }

  saveHypotheses(hypotheses: E5Hypothesis[]): void {
    saveJson(this.hypothesesPath, hypotheses);
  }

  /** Añade/actualiza hipótesis (por hypothesisId). */
  mergeHypotheses(incoming: E5Hypothesis[]): { added: number; updated: number } {
    const existing = this.loadHypotheses();
    const byId = new Map(existing.map((h) => [h.hypothesisId, h]));
    let added = 0; let updated = 0;
    for (const h of incoming) {
      if (byId.has(h.hypothesisId)) { updated++; } else { added++; }
      byId.set(h.hypothesisId, h);
    }
    this.saveHypotheses([...byId.values()]);
    return { added, updated };
  }

  /** Marca una hipótesis con el betId cuando el operador la apuesta. */
  attachBet(hypothesisId: string, betId: string): boolean {
    const all = this.loadHypotheses();
    const idx = all.findIndex((h) => h.hypothesisId === hypothesisId);
    if (idx < 0) return false;
    all[idx] = { ...all[idx], betId };
    this.saveHypotheses(all);
    return true;
  }
}
