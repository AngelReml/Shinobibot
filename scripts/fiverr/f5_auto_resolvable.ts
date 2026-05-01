import { readFileSync, writeFileSync } from 'fs';

const AUTOMATABLE_PATTERNS = [
  { name: 'data_entry', regex: /data entry|copy paste|excel.{0,20}entry|manual.{0,15}entry/i },
  { name: 'web_scraping_basic', regex: /web scraping|scrape.{0,15}website|extract.{0,20}data.{0,20}site/i },
  { name: 'pdf_conversion', regex: /pdf to (?:excel|word|json|csv|text)|pdf conversion|convert pdf/i },
  { name: 'lead_research', regex: /lead.{0,15}research|find.{0,10}leads|email.{0,15}finder|build.{0,10}email list/i },
  { name: 'simple_automation', regex: /automation|automate.{0,15}task|repetitive task|bulk.{0,10}(?:upload|download|process)/i },
  { name: 'transcription_basic', regex: /transcribe|transcription|audio to text|video to text/i }
];

const gigUrls: string[] = (() => {
  try { return JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f1_gig_urls.json', 'utf-8')); }
  catch { return []; }
})();

const f1raw = (() => {
  try { return JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f1_raw.json', 'utf-8')); }
  catch { return { output: '' }; }
})();

const text = (f1raw.output || '').toLowerCase();
const matchesByPattern: Record<string, number> = {};
const matchedSnippets: any[] = [];

for (const p of AUTOMATABLE_PATTERNS) {
  const found = text.match(p.regex);
  if (found) {
    matchesByPattern[p.name] = (text.match(new RegExp(p.regex, 'gi')) || []).length;
    const idx = text.search(p.regex);
    matchedSnippets.push({
      pattern: p.name,
      snippet: text.substring(Math.max(0, idx - 60), idx + 200)
    });
  }
}

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f5_auto_resolvable.json', JSON.stringify({
  scanned_text_length: text.length,
  total_gig_urls: gigUrls.length,
  patterns_detected: Object.keys(matchesByPattern).length,
  matches_by_pattern: matchesByPattern,
  matched_snippets: matchedSnippets.slice(0, 10)
}, null, 2));
console.log(`F5: patterns_detected=${Object.keys(matchesByPattern).length} | gigs_scanned=${gigUrls.length}`);
