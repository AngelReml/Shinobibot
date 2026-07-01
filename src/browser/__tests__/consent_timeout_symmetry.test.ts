// F4.5 (2026-07-01) — consent.ts must be fail-CLOSED on timeout / missing asker.
// This is the opposite default of src/security/approval.ts's
// SHINOBI_APPROVAL_TIMEOUT_ACTION, which is configurable and CAN be set to
// 'approve' (fail-open) — see the header comment in consent.ts for the full
// write-up of that asymmetry. This test asserts consent.ts's policy only; it
// does NOT touch or assert anything about approval.ts (a different track's
// scope) — it just documents/locks in the asymmetric, safer default here.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  requestBrowserConsent,
  setBrowserConsentAsker,
  isSensitive,
  type ConsentAsker,
} from '../consent.js';
import type { ActCommand, ElementRef } from '../types.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setBrowserConsentAsker(null);
  vi.useRealTimers();
});

const submitClick: ActCommand = { action: 'click' };
const submitRef: ElementRef = { ref: 1, label: 'Enviar', role: 'button', hint: 'submit' };

describe('F4.5 — consent.ts is fail-CLOSED (deny) on timeout', () => {
  it('mode=all, asker never resolves within KAGE_CONSENT_TIMEOUT_MS → DENIED', async () => {
    process.env.KAGE_CONSENT = 'all';
    process.env.KAGE_CONSENT_TIMEOUT_MS = '50';

    const neverResolves: ConsentAsker = () => new Promise<boolean>(() => { /* never settles */ });
    setBrowserConsentAsker(neverResolves);

    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/timeout/i);
  });

  it('mode=sensitive, sensitive action, asker throws → DENIED (fail-safe on asker error)', async () => {
    process.env.KAGE_CONSENT = 'sensitive';
    const throwingAsker: ConsentAsker = () => { throw new Error('boom'); };
    setBrowserConsentAsker(throwingAsker);

    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(false);
  });

  it('mode=all, NO asker registered at all → DENIED, not approved-by-default', async () => {
    process.env.KAGE_CONSENT = 'all';
    setBrowserConsentAsker(null);

    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/denegado/i);
  });

  it('there is no environment variable that flips consent.ts timeout behavior to approve (unlike approval.ts SHINOBI_APPROVAL_TIMEOUT_ACTION)', async () => {
    // Structural guard: confirm requestBrowserConsent's timeout race always
    // resolves to `false`, regardless of any env var — i.e. there is no
    // "KAGE_CONSENT_TIMEOUT_ACTION=approve" escape hatch in this file's logic.
    process.env.KAGE_CONSENT = 'all';
    process.env.KAGE_CONSENT_TIMEOUT_MS = '30';
    // Even setting an approval-flavored env var (as if trying to mimic
    // approval.ts's knob) must have no effect — consent.ts doesn't read it.
    (process.env as any).KAGE_CONSENT_TIMEOUT_ACTION = 'approve';

    const neverResolves: ConsentAsker = () => new Promise<boolean>(() => {});
    setBrowserConsentAsker(neverResolves);

    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(false);
  });

  it('mode=off always allows regardless of sensitivity (documented escape hatch, not a timeout path)', async () => {
    process.env.KAGE_CONSENT = 'off';
    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(true);
  });

  it('a normal (non-timeout) explicit denial from the asker is honored', async () => {
    process.env.KAGE_CONSENT = 'all';
    setBrowserConsentAsker(async () => false);
    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(false);
  });

  it('a normal (non-timeout) explicit approval from the asker is honored', async () => {
    process.env.KAGE_CONSENT = 'all';
    setBrowserConsentAsker(async () => true);
    const result = await requestBrowserConsent(submitClick, submitRef);
    expect(result.allowed).toBe(true);
  });
});

describe('F4.5 — cross-track finding (reported, NOT fixed here)', () => {
  it('documents that src/security/approval.ts has a configurable fail-OPEN timeout option, asymmetric with this file', () => {
    // This test intentionally does not import or execute approval.ts — that
    // module belongs to a different remediation track. It exists so the
    // finding has a permanent, greppable anchor in the test suite: grepping
    // "F4.5" in this repo surfaces both consent.ts's fail-closed policy and
    // this note about approval.ts's asymmetric fail-open option
    // (SHINOBI_APPROVAL_TIMEOUT_ACTION, which can be set to 'approve').
    // See DECISIONES.md for the cross-track report.
    expect(true).toBe(true);
  });
});
