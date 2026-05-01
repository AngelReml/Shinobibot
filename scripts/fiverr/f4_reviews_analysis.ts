import { readFileSync, writeFileSync } from 'fs';

let raw: any;
try {
  raw = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f2_gig_raw.json', 'utf-8'));
} catch (e: any) {
  console.error('F4: cannot read f2_gig_raw.json -', e.message);
  process.exit(1);
}

const text = raw.output as string;
const body = (text.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';

const POSITIVE = ['great', 'excellent', 'amazing', 'perfect', 'fast', 'professional', 'recommend', 'helpful', 'awesome', 'best'];
const NEGATIVE = ['bad', 'slow', 'rude', 'terrible', 'awful', 'disappointed', 'refund', 'avoid', 'worst', 'unprofessional'];

const positiveHits: Record<string, number> = {};
const negativeHits: Record<string, number> = {};

const lower = body.toLowerCase();
for (const w of POSITIVE) {
  const matches = lower.match(new RegExp(`\\b${w}\\b`, 'gi'));
  if (matches) positiveHits[w] = matches.length;
}
for (const w of NEGATIVE) {
  const matches = lower.match(new RegExp(`\\b${w}\\b`, 'gi'));
  if (matches) negativeHits[w] = matches.length;
}

const totalPositive = Object.values(positiveHits).reduce((a, b) => a + b, 0);
const totalNegative = Object.values(negativeHits).reduce((a, b) => a + b, 0);

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f4_review_patterns.json', JSON.stringify({
  body_length_analyzed: body.length,
  positive_hits: positiveHits,
  negative_hits: negativeHits,
  total_positive: totalPositive,
  total_negative: totalNegative,
  sentiment_ratio: totalPositive / Math.max(1, totalNegative)
}, null, 2));
console.log(`F4: positive=${totalPositive} negative=${totalNegative} ratio=${(totalPositive/Math.max(1,totalNegative)).toFixed(2)}`);
