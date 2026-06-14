#!/usr/bin/env node
// payment.authorize.v1 — BUGGY variant, used ONLY to prove the certificate
// discriminates (analogous to F0's naive subject giving 0/30).
//
// THE BUG: it enforces the per-transaction cap but IGNORES the daily cap. A
// plausible real-world mistake. It will produce the correct decision on OK and
// EXCEEDS_PER_TX cases but WRONG (authorize=true / reason_code=OK) on the
// EXCEEDS_DAILY cases — so its CSV must come back NOT_CERTIFIED.

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
  else { authorize = true; reason_code = 'OK'; }   // BUG: never checks the daily cap

  const remaining_daily_after_tx_usd = authorize ? perDay - (spent + amt) : perDay - spent;
  const detail = authorize
    ? `Approved ${amt} USD; ${remaining_daily_after_tx_usd} USD daily headroom remains.`
    : `Declined ${reason_code}: request ${amt} USD over the principal's limit.`;

  process.stdout.write(JSON.stringify({ authorize, reason_code, detail, remaining_daily_after_tx_usd }));
});
