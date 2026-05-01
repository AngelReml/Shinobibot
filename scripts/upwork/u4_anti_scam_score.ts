import { readFileSync, writeFileSync } from 'fs';

let extracted: any;
try {
  extracted = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u2_extracted.json', 'utf-8'));
} catch (e: any) {
  console.error('U4: cannot read u2_extracted.json -', e.message);
  process.exit(1);
}

let score = 0;
const reasons: string[] = [];

if (extracted.payment_verified) { score += 30; reasons.push('+30 payment verified'); }
else { reasons.push('0 payment NOT verified'); }

if (extracted.client_rating) {
  const r = parseFloat(extracted.client_rating);
  if (r >= 4.5) { score += 25; reasons.push(`+25 client rating ${r}`); }
  else if (r >= 4.0) { score += 15; reasons.push(`+15 client rating ${r}`); }
  else { reasons.push(`+0 client rating ${r} (low)`); }
}

if (extracted.client_total_spent) {
  const spent = String(extracted.client_total_spent).toUpperCase();
  if (/K|M/.test(spent)) { score += 25; reasons.push(`+25 total spent ${spent}`); }
  else { reasons.push(`+5 total spent ${spent}`); score += 5; }
}

if (extracted.budget_fixed || extracted.hourly_range) {
  score += 10;
  reasons.push('+10 budget present');
}

if (extracted.skills_detected && extracted.skills_detected.length >= 2) {
  score += 10;
  reasons.push(`+10 skills detected (${extracted.skills_detected.length})`);
}

const verdict = score >= 70 ? 'TRUSTED' : score >= 40 ? 'CAUTION' : 'RISKY';

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u4_anti_scam.json', JSON.stringify({
  job_url: extracted.target_url,
  score,
  verdict,
  reasons,
  source: 'u2_extracted.json'
}, null, 2));
console.log(`U4: score=${score} verdict=${verdict}`);
