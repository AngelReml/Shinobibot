import { readFileSync, writeFileSync } from 'fs';

let raw: any;
try {
  raw = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y2_video_raw.json', 'utf-8'));
} catch (e: any) {
  console.error('Y4: cannot read y2_video_raw.json -', e.message);
  process.exit(1);
}

const text = raw.output as string;
const body = (text.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';

// Heurística: comentarios suelen aparecer después de la sección "Comments" o tras el conteo de comentarios
const commentSectionMarkers = [
  /(\d+(?:[,.]\d+)*)\s*(?:Comments|Comentarios)/i,
  /Sort\s+by/i,
  /(?:Newest|Top)\s+comments/i
];

let commentSectionStart = -1;
for (const p of commentSectionMarkers) {
  const m = body.match(p);
  if (m && m.index !== undefined && (commentSectionStart === -1 || m.index < commentSectionStart)) {
    commentSectionStart = m.index;
  }
}

const commentsRegion = commentSectionStart >= 0 ? body.substring(commentSectionStart, commentSectionStart + 4000) : '';

// Heurística para parsear comentarios (cada comentario suele tener @autor seguido de texto)
const authorMatches = Array.from(commentsRegion.matchAll(/@([a-zA-Z0-9._-]+)/g)).map(m => m[1]);
const uniqueAuthors = Array.from(new Set(authorMatches)).slice(0, 30);

writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
  body_length: body.length,
  comment_section_found: commentSectionStart >= 0,
  comment_section_offset: commentSectionStart,
  unique_commenters_detected: uniqueAuthors,
  commenter_count: uniqueAuthors.length,
  comments_region_preview: commentsRegion.substring(0, 1500)
}, null, 2));
console.log(`Y4: comment_section_found=${commentSectionStart >= 0} | commenters=${uniqueAuthors.length}`);
