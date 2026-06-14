/**
 * integrity/provenance.ts — memory provenance model (CONTRACT §11.3).
 *
 * Defends against memory poisoning (MINJA / eTAMP / OWASP ASI06): content
 * injected via a DATA channel that later governs a privileged decision. The
 * defence is structural: every memory item carries WHERE it came from, and only
 * SYSTEM / USER_DIRECT origins may carry policy authority. A non-authoritative
 * item is DATA, never AUTHORITY.
 *
 * Type-only consumers (src/memory) import `MemoryProvenance` with no runtime
 * coupling. The Origin is assigned AT THE ENTRY POINT, not inferred later.
 */

export type Origin =
  | 'SYSTEM'         // signed config / manifest
  | 'USER_DIRECT'    // instruction from the authenticated principal
  | 'AGENT_DERIVED'  // the agent's own reasoning
  | 'TOOL_INTERNAL'  // deterministic internal tool (e.g. ledger nonce)
  | 'TOOL_EXTERNAL'  // external / influenceable tool
  | 'RETRIEVED'      // web / RAG / document
  | 'COUNTERPARTY'   // another agent / party
  | 'UNKNOWN';       // no provenance recorded → fail-closed (non-authoritative)

export interface MemoryProvenance {
  origin: Origin;
  channel: string;       // entry mechanism
  session_seq: number;   // monotonic step at which it entered (mid-session injection)
}

const AUTHORITATIVE: ReadonlySet<Origin> = new Set<Origin>(['SYSTEM', 'USER_DIRECT']);

/** policy_authority — true ONLY for SYSTEM / USER_DIRECT (CONTRACT §11.3). */
export function policyAuthority(origin: Origin | undefined | null): boolean {
  return !!origin && AUTHORITATIVE.has(origin);
}

/** Channel → Origin, assigned at the entry point. Unknown channel → UNKNOWN. */
const CHANNEL_ORIGIN: Record<string, Origin> = {
  signed_config: 'SYSTEM', manifest: 'SYSTEM', system_prompt: 'SYSTEM', curated_markdown: 'SYSTEM',
  principal: 'USER_DIRECT', user_authenticated: 'USER_DIRECT',
  agent_reasoning: 'AGENT_DERIVED',
  ledger_nonce: 'TOOL_INTERNAL', internal_tool: 'TOOL_INTERNAL',
  external_tool: 'TOOL_EXTERNAL', tool_output: 'TOOL_EXTERNAL',
  web: 'RETRIEVED', rag: 'RETRIEVED', document: 'RETRIEVED',
  counterparty: 'COUNTERPARTY', counterparty_msg: 'COUNTERPARTY', free_text_field: 'COUNTERPARTY',
};

export function assignOrigin(channel: string): Origin {
  return CHANNEL_ORIGIN[channel] ?? 'UNKNOWN';
}

/** Normalize possibly-missing provenance to a fail-closed UNKNOWN item. */
export function withFailClosed(p: MemoryProvenance | undefined | null, seq = -1): MemoryProvenance {
  return p ?? { origin: 'UNKNOWN', channel: 'unrecorded', session_seq: seq };
}
