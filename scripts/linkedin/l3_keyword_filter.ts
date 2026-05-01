import { readFileSync, writeFileSync } from 'fs';

const KEEP = ['broker', 'wholesale', 'principal', 'producer', 'partner', 'agent', 'agency'];
const REJECT = ['underwriter', 'underwriting', 'student', 'intern', 'assistant'];

const raw = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l1_raw.json', 'utf-8'));
const text = raw.output as string;

const body = (text.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';

// Extraer enlaces a perfiles
const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
const linkLines = lines.filter(l => l.match(/https:\/\/www\.linkedin\.com\/in\//));

const profileBlocks: any[] = [];

for (const line of linkLines) {
  const m = line.match(/^\d+\.\s*\[(.+?)\]\s*->\s*(https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+)/i);
  if (!m) continue;
  
  const display = m[1].trim();
  const url = m[2];
  
  // Buscar el bloque de body que rodea al nombre — heurística: 200 chars antes y 400 después
  const nameIdx = body.indexOf(display);
  const contextWindow = nameIdx >= 0 
    ? body.substring(Math.max(0, nameIdx - 100), Math.min(body.length, nameIdx + 500))
    : '';
  
  const fullText = (display + ' ' + contextWindow).toLowerCase();
  
  const keepHits = KEEP.filter(k => fullText.includes(k));
  const rejectHits = REJECT.filter(k => fullText.includes(k));
  
  let classified: 'TARGET' | 'EXCLUDE' | 'UNKNOWN';
  if (keepHits.length > 0 && rejectHits.length === 0) classified = 'TARGET';
  else if (rejectHits.length > 0) classified = 'EXCLUDE';
  else classified = 'UNKNOWN';
  
  profileBlocks.push({
    display,
    url,
    keep_hits: keepHits,
    reject_hits: rejectHits,
    classified,
    context_window_chars: contextWindow.length,
    context_preview: contextWindow.substring(0, 200)
  });
}

const targets = profileBlocks.filter(p => p.classified === 'TARGET');
const excluded = profileBlocks.filter(p => p.classified === 'EXCLUDE');
const unknown = profileBlocks.filter(p => p.classified === 'UNKNOWN');

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l3_classified.json', JSON.stringify(profileBlocks, null, 2));
writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l3_targets.json', JSON.stringify(targets, null, 2));
console.log(`L3: ${profileBlocks.length} classified | ${targets.length} TARGET | ${excluded.length} EXCLUDED | ${unknown.length} UNKNOWN`);
