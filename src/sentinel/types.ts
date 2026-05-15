/**
 * Sentinel — vigilancia tecnológica contextual (FASE V4.5).
 *
 * Sentinel archiva, indexa y propone — NUNCA modifica código de
 * Shinobi automáticamente. Cinco piezas:
 *   1. Watcher pasivo      → src/sentinel/watcher.ts
 *   2. Indexación semántica → src/sentinel/indexer.ts
 *   3. Consulta contextual  → src/sentinel/query.ts
 *   4. Council selectivo    → src/sentinel/council.ts
 *   5. Boletín              → src/sentinel/digest.ts
 */

export type SourceType = 'youtube_channel' | 'github_repo' | 'rss';
export type CheckInterval = '1d' | '3d' | '1w';

export interface SentinelSource {
  type: SourceType;
  /** id de la fuente: channel_id YouTube, "owner/repo" GitHub, URL del feed RSS. */
  id: string;
  /** Nombre legible. */
  name: string;
  /** Cada cuánto chequear. */
  interval: CheckInterval;
  /** Si un item dura más que esto (min), usa Whisper local; si menos, auto-caption. */
  whisper_threshold_minutes: number;
}

/** Un item detectado por el watcher (video, release, post). */
export interface SentinelItem {
  /** id único dentro de la fuente. */
  itemId: string;
  /** id de la fuente que lo originó. */
  sourceId: string;
  sourceType: SourceType;
  sourceName: string;
  title: string;
  /** URL canónica al item. */
  url: string;
  /** ISO timestamp de publicación. */
  publishedAt: string;
  /** Duración en minutos (videos); undefined para texto. */
  durationMinutes?: number;
  /** Texto bruto: transcript, cuerpo del post, notas de release. */
  rawText: string;
  /** Cómo se obtuvo el texto. */
  transcriptSource: 'whisper-local' | 'auto-caption' | 'text' | 'none';
  /** ISO timestamp de archivado por Sentinel. */
  archivedAt: string;
}

/** Propuesta estructurada extraída de un item (Pieza 3 — /sentinel deep). */
export interface SentinelProposal {
  proposalId: string;
  itemId: string;
  title: string;
  /** Descripción en ~3 frases. */
  description: string;
  /** Área de Shinobi que tocaría. */
  shinobiArea: string;
  /** Esfuerzo estimado. */
  effort: 'S' | 'M' | 'L' | 'XL';
  risks: string[];
  /** Link a la fuente, con timestamp si aplica. */
  sourceLink: string;
  createdAt: string;
}

/** Decisión del council (Pieza 4 — /sentinel forward). */
export interface CouncilDecision {
  proposalId: string;
  verdict: 'APPROVE' | 'REJECT' | 'RESEARCH_MORE';
  /** Resumen del razonamiento del mediator. */
  rationale: string;
  /** Notas por rol. */
  roleNotes: Record<string, string>;
  decidedAt: string;
}

/** Estado persistido por fuente para no re-procesar. */
export interface SeenState {
  sourceId: string;
  /** itemIds ya procesados. */
  seenItemIds: string[];
  /** ISO del último check. */
  lastCheckedAt: string | null;
}
