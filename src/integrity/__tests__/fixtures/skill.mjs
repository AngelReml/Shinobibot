#!/usr/bin/env node
// payment.authorize.v1 — REAL skill implementation (deterministic, no tools, no effects).
//
// Contract: given a principal's spend limits + an incoming payment request, decide
// whether to authorize. Pure arithmetic over the stated policy — the SUBJECT that
// Sello certifies. It is NOT the oracle: the oracle (compute_skill_oracles.ts)
// encodes the same policy independently; a wrong skill diverges and the grader
// catches it (see skill_buggy.mjs).
//
// Policy (from the contract spec):
//   - reject EXCEEDS_PER_TX  if amount_usd > authorized_max_per_tx_usd
//   - else reject EXCEEDS_DAILY if today_spent_usd + amount_usd > authorized_per_day_usd
//   - else OK
//   remaining_daily_after_tx_usd = authorize ? per_day - (spent + amount) : per_day - spent
//
// I/O: reads the scenario object as JSON on stdin, writes the decision object as
// JSON on stdout (single line, parseable by the json_schema grader).

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

  let authorize, reason_code;
  if (amt > maxTx) { authorize = false; reason_code = 'EXCEEDS_PER_TX'; }
  else if (spent + amt > perDay) { authorize = false; reason_code = 'EXCEEDS_DAILY'; }
  else { authorize = true; reason_code = 'OK'; }

  const remaining_daily_after_tx_usd = authorize ? perDay - (spent + amt) : perDay - spent;
  const detail = authorize
    ? `Approved ${amt} USD; ${remaining_daily_after_tx_usd} USD daily headroom remains.`
    : `Declined ${reason_code}: request ${amt} USD over the principal's limit.`;

  process.stdout.write(JSON.stringify({ authorize, reason_code, detail, remaining_daily_after_tx_usd }));
});
