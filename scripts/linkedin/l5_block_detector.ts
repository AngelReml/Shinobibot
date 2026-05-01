import { readFileSync, writeFileSync } from 'fs';

const BLOCK_SIGNALS = [
  /sign in to linkedin/i,
  /unusual activity/i,
  /actividad inusual/i,
  /please verify/i,
  /verify your identity/i,
  /captcha/i,
  /security verification/i,
  /authwall/i,
  /linkedin\.com\/login/i,
  /linkedin\.com\/checkpoint/i
];

const sources = ['l1_raw.json', 'l2_page_attempts.json', 'l4_profile_raw.json'];
const findings: any[] = [];

for (const src of sources) {
  try {
    const path = `C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/${src}`;
    const content = readFileSync(path, 'utf-8');
    for (const signal of BLOCK_SIGNALS) {
      const m = content.match(signal);
      if (m) {
        findings.push({ source: src, signal: signal.toString(), match: m[0], excerpt: content.substring(Math.max(0, m.index! - 50), m.index! + 200) });
      }
    }
  } catch (e: any) {
    findings.push({ source: src, error: e.message });
  }
}

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l5_block_findings.json', JSON.stringify({
  total_signals: findings.filter(f => f.signal).length,
  total_errors: findings.filter(f => f.error).length,
  blocked: findings.filter(f => f.signal).length > 0,
  findings
}, null, 2));

console.log(`L5: blocked=${findings.filter(f => f.signal).length > 0} | signals=${findings.filter(f => f.signal).length} | errors=${findings.filter(f => f.error).length}`);
