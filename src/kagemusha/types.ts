/**
 * kagemusha/types.ts — the data model (dossier §5). Pure types, no runtime.
 *
 * Provenance reuses the §11.3 Origin enum from src/integrity (no duplicate enum)
 * and EXTENDS it for external sources with trust_tier / source_url / retrieved_at.
 * trust_tier is the anti-fabrication axis: a claim never rises by repetition, only
 * by independent corroboration from high-tier sources.
 */

import type { Origin } from '../integrity/provenance.js';

export type { Origin };

/** trust_tier — 0 non-authoritative (comment/forum) … 3 verified (≥2 independent tier≥2). */
export type TrustTier = 0 | 1 | 2 | 3;

export type SourceChannel =
  | 'youtube_transcript' | 'youtube_description' | 'youtube_comment'
  | 'web' | 'arxiv' | 'repo' | 'llm' | 'codebase' | 'curated';

export interface Provenance {
  origin: Origin;
  channel: SourceChannel | string;
  source_url?: string;
  retrieved_at: string;       // ISO
  trust_tier: TrustTier;
  session_seq: number;        // monotonic step at which it entered (mid-session injection)
}

// ─── §5.2 Corpus ────────────────────────────────────────────────────────────
export interface Channel {
  channel_id: string;         // youtube channel id or handle
  title: string;
  watch_rank?: number;        // if derived from history; null if given by hand
}

export interface Transcript {
  transcript_id: string;      // hash(video_id + lang)
  video_id: string;
  channel_id: string;
  title: string;
  lang: string;
  published_at?: string;
  text: string;               // normalized transcript
  token_count: number;
  provenance: Provenance;     // USER_DIRECT (channel chosen by user), youtube_transcript
  ingested_at: string;
}

// ─── §5.3 Analysis & entities ───────────────────────────────────────────────
export type AnalysisAngle = 'topic' | 'recurrence' | 'temporal' | 'contradiction' | 'novelty' | 'entity';

export interface AnalysisFinding {
  finding_id: string;
  angle: AnalysisAngle;
  summary: string;
  evidence_transcript_ids: string[];
  provenance: Provenance;     // AGENT_DERIVED, trust per evidence
}

export type EntityKind = 'paper' | 'team' | 'person' | 'product' | 'repo' | 'concept';

export interface Entity {
  entity_id: string;
  kind: EntityKind;
  name: string;
  raw_mentions: { transcript_id: string; span: string }[];
  first_seen_at: string;
  relevance_score: number;    // 0..1 — prioritizes which threads to pull
  provenance: Provenance;
}

// ─── §5.4 Research graph (phase E) ──────────────────────────────────────────
export type NodeKind = 'paper' | 'team' | 'person' | 'repo' | 'claim' | 'source' | 'concept' | 'product';

export interface ResearchNode {
  node_id: string;
  entity_id?: string;
  kind: NodeKind;
  label: string;
  acquired: boolean;          // did we obtain the source?
  source_url?: string;
  content_ref?: string;       // pointer to acquired text (store key)
  credibility?: CredibilityVerdict;
  depth: number;              // distance to the seed
  provenance: Provenance;
}

export type EdgeRelation =
  | 'cites' | 'authored_by' | 'affiliated_with'
  | 'implements' | 'refutes' | 'supports' | 'mentions';

export interface ResearchEdge {
  from: string; to: string;
  relation: EdgeRelation;
}

export type ClaimStatus = 'unverified' | 'corroborated' | 'refuted';

export interface Claim {
  claim_id: string;
  text: string;               // atomic, verifiable assertion
  node_id: string;            // where it came from
  status: ClaimStatus;
  corroborating_sources: string[]; // independent tier≥2 urls
  credibility?: CredibilityVerdict;
  provenance: Provenance;
}

// ─── §8.5 Credibility ───────────────────────────────────────────────────────
export interface CredibilitySignals {
  source_tier: TrustTier;
  authors_traceable: boolean;
  author_track_record?: 'none' | 'some' | 'established';
  affiliation?: 'none' | 'unknown' | 'known_lab_or_org';
  corroboration_count: number;         // independent tier≥2 sources backing it
  has_artifacts: boolean;              // reproducible repo/code/data
  repo_traction?: number;
  recency_ok: boolean;
  red_flags: string[];
}

export type CredibilityLevel = 'SOLID' | 'PLAUSIBLE' | 'WEAK' | 'UNFOUNDED';

export interface CredibilityVerdict {
  level: CredibilityLevel;
  score: number;              // 0..1
  signals: CredibilitySignals;
}

// ─── §5.5 Contrast with own code (phase F) ──────────────────────────────────
export interface CodebaseUnit {
  unit_id: string;
  path: string;               // e.g. "src/integrity/checks.ts"
  symbol: string;             // function / class
  capability_summary: string; // one line of what it does
}

export type ContrastLabel = 'SIRVE' | 'YA_LO_TENEMOS' | 'MEJOR_QUE_NOSOTROS' | 'IRRELEVANTE';

export interface ContrastVerdict {
  finding_ref: string;        // claim or entity contrasted
  verdict: ContrastLabel;
  codebase_unit?: string;     // concrete module referenced
  rationale: string;
  confidence: number;         // 0..1
}

// ─── §5.6 Report ────────────────────────────────────────────────────────────
export interface DawnReport {
  report_id: string;
  mission_id: string;
  generated_at: string;
  looked_at: { channels: number; transcripts: number; threads: number };
  highlights: {
    text: string;
    confidence: number;       // inherits from the trust_tier of its provenance
    provenance: Provenance[];
    contrast?: ContrastVerdict;
    claim_ids: string[];      // backing claims (anti-fabrication audit anchor)
  }[];
  discarded: { text: string; reason: string }[];
  build_suggestions: { text: string; basis: string }[];
  gaps: string[];
  integrity: { fabrication_flags: number; unverified_excluded: number };
}

// ─── §12 Mission ────────────────────────────────────────────────────────────
export interface MissionBudget {
  maxDepth: number;
  maxThreads: number;
  maxTokens: number;
  maxWallClockMs: number;
  minRelevance: number;
}

export interface MissionSpec {
  channels: string[];
  langs?: string[];
  maxTranscriptsPerChannel?: number;
  budget: MissionBudget;
  models: { bulk: string; judge: string };
}

export type MissionPhase =
  | 'INIT' | 'INGEST' | 'ANALYZE' | 'THREAD' | 'CONTRAST'
  | 'SYNTHESIZE' | 'REPORT' | 'DONE' | 'PAUSED' | 'ABORT';

export interface FrontierItem {
  candidate: Entity;
  parentDepth: number;
  priorScore: number;
}

export interface MissionState {
  mission_id: string;
  phase: MissionPhase;
  spec: MissionSpec;
  frontier: FrontierItem[];
  visited: string[];          // canonical keys (Set serialized for persistence)
  threadsOpened: number;
  tokensSpent: number;
  startedAt: string;
  updatedAt: string;
  gaps: string[];
}
