import { readFileSync, writeFileSync } from 'fs';

const BLOCK_SIGNALS = [
  /access denied/i,
  /please verify you are a human/i,
  /verify you are not a robot/i,
  /captcha/i,
  /unusual activity/i,
  /actividad inusual/i,
  /it needs a human touch/i,
  /security check/i,
  /cloudflare/i,
  /pxcr\d+/i,
  /forbidden/i,
  /upwork\.com\/ab\/account-security/i
];

const sources = ['u1_raw.json', 'u2_job_raw.json', 'u3_raw.json'];
const findings: any[] = [];

for (const src of sources) {
  try {
    const path = `C:/Users/angel/Desktop/shinobibot/artifacts/upwork/${src}`;
    const content = readFileSync(path, 'utf-8');
    for (const signal of BLOCK_SIGNALS) {
      const m = content.match(signal);
      if (m) {
        findings.push({
          source: src,
          signal: signal.toString(),
          match: m[0],
          excerpt: content.substring(Math.max(0, m.index! - 50), m.index! + 200)
        });
      }
    }
  } catch (e: any) {
    findings.push({ source: src, error: e.message });
  }
}

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u5_block_findings.json', JSON.stringify({
  total_signals: findings.filter(f => f.signal).length,
  total_errors: findings.filter(f => f.error).length,
  blocked: findings.filter(f => f.signal).length > 0,
  findings
}, null, 2));

console.log(`U5: blocked=${findings.filter(f => f.signal).length > 0} | signals=${findings.filter(f => f.signal).length} | errors=${findings.filter(f => f.error).length}`);
