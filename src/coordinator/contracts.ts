// src/coordinator/contracts.ts
// I/O contract definitions for Shinobi's inter-agent message protocol.
// validatePayload() returns true on success, throws ProtocolViolation on failure.

// ─── Error ────────────────────────────────────────────────────────────────────

export class ProtocolViolation extends Error {
  constructor(
    public readonly eventType: string,
    public readonly reason: string,
    public readonly payload?: unknown,
  ) {
    super(`ProtocolViolation [${eventType}]: ${reason}`);
    this.name = 'ProtocolViolation';
  }
}

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface UserInputPayload {
  content: string;
}

export interface ToolCallPayload {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPayload {
  tool_call_id: string;
  name: string;
  content: string;
}

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool';

export interface AgentMessagePayload {
  role: AgentRole;
  content: string;
}

export interface CommercialLeadPayload {
  leadId: string;
  department: string;
  source: string;
  contact: { name: string; company: string; role?: string };
  product: string;
  quantity: number;
  requestedDelivery: string;
  priceBreakdown: { unitPriceEur: number; totalEur: number };
  status: string;
}

// ─── Contract registry ────────────────────────────────────────────────────────

type Validator = (p: unknown) => boolean;

const AGENT_ROLES: readonly string[] = ['user', 'assistant', 'system', 'tool'];

const CONTRACT_REGISTRY: Record<string, Validator> = {
  user_input: (p) =>
    typeof (p as any)?.content === 'string' &&
    (p as any).content.trim().length > 0,

  tool_call: (p) =>
    typeof (p as any)?.name === 'string' &&
    (p as any).name.length > 0 &&
    typeof (p as any)?.arguments === 'object' &&
    (p as any).arguments !== null,

  tool_result: (p) =>
    typeof (p as any)?.tool_call_id === 'string' &&
    typeof (p as any)?.name === 'string' &&
    typeof (p as any)?.content === 'string',

  agent_message: (p) =>
    AGENT_ROLES.includes((p as any)?.role) &&
    typeof (p as any)?.content === 'string',

  commercial_lead_generated: (p) =>
    typeof (p as any)?.leadId === 'string' &&
    (p as any).leadId.trim().length > 0 &&
    typeof (p as any)?.department === 'string' &&
    typeof (p as any)?.contact === 'object' &&
    (p as any).contact !== null &&
    typeof (p as any)?.contact?.name === 'string' &&
    typeof (p as any)?.contact?.company === 'string' &&
    typeof (p as any)?.product === 'string' &&
    (p as any).product.trim().length > 0 &&
    typeof (p as any)?.quantity === 'number' &&
    (p as any).quantity > 0 &&
    typeof (p as any)?.priceBreakdown === 'object' &&
    (p as any).priceBreakdown !== null &&
    typeof (p as any)?.priceBreakdown?.unitPriceEur === 'number' &&
    typeof (p as any)?.priceBreakdown?.totalEur === 'number' &&
    typeof (p as any)?.status === 'string',
};

// ─── Public validator ─────────────────────────────────────────────────────────

/**
 * Returns true if payload satisfies the contract for eventType.
 * Throws ProtocolViolation if the event type is unknown or the payload
 * does not match its schema.
 */
export function validatePayload(eventType: string, payload: unknown): boolean {
  const validator = CONTRACT_REGISTRY[eventType];
  if (!validator) {
    throw new ProtocolViolation(eventType, `Unknown event type: "${eventType}"`);
  }
  if (!validator(payload)) {
    throw new ProtocolViolation(
      eventType,
      `Payload does not satisfy contract for event type "${eventType}"`,
      payload,
    );
  }
  return true;
}
