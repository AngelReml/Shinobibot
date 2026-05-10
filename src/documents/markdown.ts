// src/documents/markdown.ts
//
// Bloque 5 — generador markdown trivial. Fallback siempre disponible.
// Toma el body markdown que produce el LLM y lo escribe tal cual al disco
// (con un título # opcional al inicio si no estaba ya).

import * as fs from 'fs';

export interface MarkdownInput {
  title: string;
  content_md: string;
  outputPath: string;
}

export async function generateMarkdown(input: MarkdownInput): Promise<{ path: string; bytes: number }> {
  const heading = input.title.trim();
  const body = input.content_md.trim();
  const startsWithH1 = /^#\s+/m.test(body.split('\n')[0] || '');
  const finalText = (heading && !startsWithH1)
    ? `# ${heading}\n\n${body}\n`
    : `${body}\n`;
  fs.writeFileSync(input.outputPath, finalText, 'utf-8');
  const stat = fs.statSync(input.outputPath);
  return { path: input.outputPath, bytes: stat.size };
}
