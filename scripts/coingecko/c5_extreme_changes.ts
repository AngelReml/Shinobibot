import { readFileSync, writeFileSync } from 'fs';

const sources = [
  'C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c1_raw.json',
  'C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_strategy_a_raw.json',
  'C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c4_raw.json'
];

const allBodies: string[] = [];
for (const s of sources) {
  try {
    const data = JSON.parse(readFileSync(s, 'utf-8'));
    const body = (data.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    if (body) allBodies.push(body);
  } catch {}
}

const combined = allBodies.join('\n');

// Buscar valores con +/- de dos dígitos seguidos de %
const extremeRegex = /([A-Z]{2,10})[^%\n]{0,80}?([+-]\d{2,3}(?:\.\d+)?)\s?%/g;
const extreme: any[] = [];
let m: RegExpExecArray | null;
while ((m = extremeRegex.exec(combined)) !== null && extreme.length < 50) {
  const symbol = m[1];
  const change = parseFloat(m[2]);
  if (Math.abs(change) >= 20) {
    extreme.push({ symbol, change_24h_pct: change });
  }
}

// Deduplicar por symbol manteniendo el cambio más extremo
const map = new Map<string, number>();
for (const e of extreme) {
  const cur = map.get(e.symbol);
  if (cur === undefined || Math.abs(e.change_24h_pct) > Math.abs(cur)) {
    map.set(e.symbol, e.change_24h_pct);
  }
}
const dedup = Array.from(map.entries()).map(([symbol, change]) => ({ symbol, change_24h_pct: change }));
dedup.sort((a, b) => Math.abs(b.change_24h_pct) - Math.abs(a.change_24h_pct));

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c5_extreme.json', JSON.stringify({
  sources_scanned: allBodies.length,
  combined_length: combined.length,
  extreme_count: dedup.length,
  extreme_movers: dedup
}, null, 2));

console.log(`C5: sources=${allBodies.length} | extreme_movers=${dedup.length}`);
