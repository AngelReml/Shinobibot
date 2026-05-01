import { readFileSync, writeFileSync } from 'fs';

const KEEP = ['broker', 'wholesale', 'principal', 'producer', 'partner'];
const REJECT = ['underwriter', 'underwriting', 'student', 'intern', 'assistant'];

const raw = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l1_raw.json', 'utf-8'));
const text = raw.output as string;

const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
const profileBlocks: any[] = [];

const linkLines = lines.filter(l => l.match(/https:\/\/www\.linkedin\.com\/in\//));
for (const line of linkLines) {
  const m = line.match(/^\d+\.\s*\[(.+?)\]\s*->\s*(https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+)/i);
  if (m) {
    const display = m[1].toLowerCase();
    const keep = KEEP.some(k => display.includes(k));
    const reject = REJECT.some(k => display.includes(k));
    profileBlocks.push({ display: m[1], url: m[2], keep, reject, classified: keep && !reject ? 'TARGET' : reject ? 'EXCLUDE' : 'UNKNOWN' });
  }
}

const targets = profileBlocks.filter(p => p.classified === 'TARGET');
writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l3_classified.json', JSON.stringify(profileBlocks, null, 2));
writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l3_targets.json', JSON.stringify(targets, null, 2));
console.log(`L3: ${profileBlocks.length} classified | ${targets.length} TARGET | ${profileBlocks.filter(p=>p.classified==='EXCLUDE').length} EXCLUDED | ${profileBlocks.filter(p=>p.classified==='UNKNOWN').length} UNKNOWN`);
