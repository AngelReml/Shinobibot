/**
 * kangeiko/types.ts — the self-improvement loop model (dossier §2). Pure types.
 * The engine is GENERAL ("any verifiable domain"); the domain is the weight you
 * put on the muscle. Browser is the first field; reasoning/programs/research follow.
 */

/** A measured point on the capability curve: passed/total over an oracle bank. */
export interface CurvePoint { cycle: number; passed: number; total: number; }

/** A gap the measurement found — a capability that failed, to be investigated. */
export interface Gap { capability_id: string; detail: string; priorScore: number; }

export interface Knowledge { gap_id: string; summary: string; sources: string[]; }

export interface CandidateSkill { skill_id: string; gap_id: string; declared_effects: 'none' | 'read_only' | 'write' | 'irreversible'; }

export interface CertifyOutcome { certified: boolean; skill_id: string; reason?: string; }

export interface KangeikoBudget { maxCycles: number; maxTokens: number; maxSkillsPerCycle: number; }

/**
 * A verifiable domain. Every phase is the dojo subsystem doing its job:
 *   measure   → Kagami runs the oracle bank → curve point + gaps
 *   investigate → Kagemusha: how is the failed thing done
 *   fabricate → Shugyō: knowledge → candidate skill (in the revertible cage)
 *   certify   → Sello: prove in cage vs oracle → CERTIFIED or discarded
 *   consolidate → learning loop: fuse/prune the repertoire (no dump)
 * Injected so the loop is deterministic and testable with a stub domain.
 */
export interface Domain {
  name: string;
  measure(): Promise<{ point: Omit<CurvePoint, 'cycle'>; gaps: Gap[] }>;
  investigate(gap: Gap): Promise<Knowledge>;
  fabricate(k: Knowledge): Promise<CandidateSkill>;
  certify(c: CandidateSkill): Promise<CertifyOutcome>;
  consolidate(repertoire: string[]): Promise<{ repertoireSize: number }>;
}

export interface KangeikoState {
  domain: string;
  cycle: number;
  curve: CurvePoint[];
  repertoire: string[];     // certified skill ids (auto-mejora COMPROBADA)
  discarded: string[];      // candidates that failed the oracle (not counted)
  tokensSpent: number;
  status: 'running' | 'done' | 'halted';
}
