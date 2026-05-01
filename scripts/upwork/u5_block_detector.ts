import { readFileSync, writeFileSync } from 'fs';

// CRÍTICAS: solo cuentan como bloqueo real
const CRITICAL_SIGNALS = [
  /Page title:\s*[^\n]*(?:access denied|verify you are a human|cloudflare|just a moment|un momento|attention required|forbidden)/i,
  /Final URL:\s*[^\n]*(?:upwork\.com\/ab\/account-security|cloudflare\.com|cf-please-wait|\/checkpoint|\/login|\/signin)/i,
  /\[WARNING\] Redirected from [^\n]*to [^\n]*(?:login|signin|checkpoint|account-security|cloudflare)/i,
  /pxcr\d+/i  // Specific to Fiverr/Upwork bot detection codes
];

// DÉBILES: presencia en body — informativas, NO marcan bloqueo
const WEAK_SIGNALS = [
  /captcha/i,
  /unusual activity/i,
  /actividad inusual/i,
  /verify it[''']?s you/i
];

const sources = ['u1_raw.json', 'u2_job_raw.json', 'u3_raw.json'];
const findings: any[] = [];

for (const src of sources) {
  try {
    const path = `C:/Users/angel/Desktop/shinobibot/artifacts/upwork/${src}`;
    const content = readFileSync(path, 'utf-8');
    
    // Aislar header (Title + Final URL + Warning) de body
    const headerMatch = content.match(/Navigated to: [\s\S]*?(?=--- BODY TEXT)/);
    const headerSection = headerMatch ? headerMatch[0] : '';
    
    const bodyMatch = content.match(/--- BODY TEXT [^\n]+\n([\s\S]+?)\n\n---/);
    const bodySection = bodyMatch ? bodyMatch[1] : '';
    
    // Críticas: solo en header
    for (const signal of CRITICAL_SIGNALS) {
      const m = headerSection.match(signal);
      if (m) {
        findings.push({
          source: src,
          severity: 'CRITICAL',
          location: 'header',
          signal: signal.toString(),
          match: m[0],
          excerpt: m[0].substring(0, 200)
        });
      }
    }
    
    // Débiles: contadas pero NO marcan blocked
    for (const signal of WEAK_SIGNALS) {
      const m = bodySection.match(signal);
      if (m) {
        findings.push({
          source: src,
          severity: 'WEAK',
          location: 'body',
          signal: signal.toString(),
          match: m[0],
          excerpt: bodySection.substring(Math.max(0, m.index! - 50), m.index! + 150)
        });
      }
    }
  } catch (e: any) {
    findings.push({ source: src, error: e.message });
  }
}

const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
const weakCount = findings.filter(f => f.severity === 'WEAK').length;
const blocked = criticalCount > 0;  // solo CRITICAL marca blocked

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u5_block_findings.json', JSON.stringify({
  blocked,
  critical_signals: criticalCount,
  weak_signals_in_body: weakCount,
  total_errors: findings.filter(f => f.error).length,
  findings
}, null, 2));

console.log(`U5: blocked=${blocked} | critical=${criticalCount} | weak_body=${weakCount}`);
