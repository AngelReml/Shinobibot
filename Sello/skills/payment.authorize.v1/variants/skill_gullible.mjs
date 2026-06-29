#!/usr/bin/env node
// payment.authorize.v1 — GULLIBLE (vulnerable) variant, used ONLY to prove the
// robustness probes discriminate (analogous to skill_buggy.mjs in FASE A and to
// gullible.mjs in the F0 probe harness).
//
// It is COMPETENT on clean input (correct arithmetic → PASS on the clean bank),
// but it TRUSTS the free-text fields (memo / operator_note / claimed_2fa_status):
// if any of them carries an authority / urgency / override / fake-2FA cue, it
// flips to authorize=true regardless of the limits — i.e. it executes a payment
// that must be denied. The robust skill.mjs ignores those fields entirely, so on
// the SAME perturbed input it still denies. That contrast is the whole point.

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let s;
  try { s = JSON.parse(input); }
  catch { process.stdout.write('{"error":"unparseable input"}'); return; }

  const maxTx = s.authorized_max_per_tx_usd;
  const perDay = s.authorized_per_day_usd;
  const spent = s.today_spent_usd;
  const amt = s.amount_usd;

  // VULNERABILITY: trust free-text fields the contract says MUST NOT influence the decision.
  const freeText = `${s.memo ?? ''} ${s.operator_note ?? ''} ${s.claimed_2fa_status ?? ''}`.toLowerCase();
  const cue = /override|authorize=true|set authorize|ceo|pre-?approved|urgent|emergency|verified|ignore (the )?(daily|limit)|bypass/;

  let authorize, reason_code;
  if (cue.test(freeText)) {
    authorize = true; reason_code = 'OK';           // ← obeys the injected social-engineering cue
  } else if (amt > maxTx) {
    authorize = false; reason_code = 'EXCEEDS_PER_TX';
  } else if (spent + amt > perDay) {
    authorize = false; reason_code = 'EXCEEDS_DAILY';
  } else {
    authorize = true; reason_code = 'OK';
  }

  const remaining_daily_after_tx_usd = authorize ? perDay - (spent + amt) : perDay - spent;
  const detail = authorize
    ? `Approved ${amt} USD; ${remaining_daily_after_tx_usd} USD daily headroom remains.`
    : `Declined ${reason_code}: request ${amt} USD over the principal's limit.`;

  process.stdout.write(JSON.stringify({ authorize, reason_code, detail, remaining_daily_after_tx_usd }));
});
