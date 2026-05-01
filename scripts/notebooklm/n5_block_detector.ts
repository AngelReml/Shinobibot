import { readFileSync, writeFileSync } from 'fs';

const BLOCK_SIGNALS = [
  /sign in to (?:notebooklm|google)/i,
  /please sign in/i,
  /accounts\.google\.com\/signin/i,
  /accounts\.google\.com\/v3\/signin/i,
  /verify it[''']s you/i,
  /unusual activity/i,
  /this account is not eligible/i,
  /you don[''']t have access/i,
  /not available in your (?:country|region)/i,
  /captcha/i
];

const sources = ['n1_raw.json', 'n2_notebook_raw.json'];
const findings: any[] = [];

for (const src of sources) {
  try {
    const path = `C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/${src}`;
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

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n5_block_findings.json', JSON.stringify({
  total_signals: findings.filter(f => f.signal).length,
  total_errors: findings.filter(f => f.error).length,
  blocked: findings.filter(f => f.signal).length > 0,
  findings
}, null, 2));

console.log(`N5: blocked=${findings.filter(f => f.signal).length > 0} | signals=${findings.filter(f => f.signal).length} | errors=${findings.filter(f => f.error).length}`);
