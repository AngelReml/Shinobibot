// src/documents/pdf.ts
//
// Bloque 5 — generador PDF reutilizando Playwright chromium (cero dep nueva).
//
// El motor de browser del Bloque 2 ya tiene Playwright + Chromium descargados.
// Aquí lanzamos una instancia HEADLESS independiente (NO toca la sesión de
// Comet/Chrome del usuario) para renderizar HTML+CSS y capturarlo como PDF.
//
// Markdown → HTML mínimo (h1/h2/h3, p, ul/ol, table, code) → page.setContent →
// page.pdf({format:'A4', printBackground, margin}).

import * as fs from 'fs';

export interface PdfInput {
  title: string;
  content_md: string;
  outputPath: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Minimal markdown → HTML for PDF rendering. Supports H1-H3, p, ul, ol, code blocks, inline `code`, **bold**, *italic*. */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeBuf: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    para = [];
    if (text) {
      const formatted = text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
      out.push(`<p>${formatted}</p>`);
    }
  };
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Code fence start/end
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${escapeHtml(h[2].trim())}</h${lvl}>`);
      continue;
    }

    // Bullet list
    const b = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (b) {
      flushPara();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push(`<li>${escapeHtml(b[1].trim())}</li>`);
      continue;
    }

    // Numbered list
    const n = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (n) {
      flushPara();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push(`<li>${escapeHtml(n[1].trim())}</li>`);
      continue;
    }

    // Default: paragraph buffer
    para.push(escapeHtml(line.trim()));
  }
  flushPara();
  closeList();
  if (inCode && codeBuf.length) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  return out.join('\n');
}

const CSS = `
  @page { size: A4; margin: 20mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #222; }
  h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; color: #1f3a5f; margin-top: 1.2em; }
  h1 { font-size: 22pt; border-bottom: 2px solid #1f3a5f; padding-bottom: 0.2em; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13pt; }
  p { margin: 0.6em 0; text-align: justify; }
  ul, ol { margin: 0.6em 0 0.6em 1.5em; }
  li { margin: 0.2em 0; }
  pre { background: #f4f4f6; border: 1px solid #ddd; border-radius: 4px; padding: 0.6em 0.8em; font-family: ui-monospace, Consolas, "Liberation Mono", monospace; font-size: 9.5pt; overflow: auto; }
  code { background: #f0f0f3; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; }
  .doc-title { text-align: center; font-size: 28pt; font-family: Georgia, serif; color: #1f3a5f; margin: 0 0 0.3em; }
  .doc-meta { text-align: center; color: #888; font-size: 10pt; margin-bottom: 2em; }
`;

export async function generatePdf(input: PdfInput): Promise<{ path: string; bytes: number }> {
  const { chromium } = await import('playwright');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title><style>${CSS}</style></head><body>` +
    `<div class="doc-title">${escapeHtml(input.title)}</div>` +
    `<div class="doc-meta">${new Date().toLocaleDateString()}</div>` +
    mdToHtml(input.content_md) +
    `</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: input.outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8pt; color:#888; width:100%; padding:0 20mm;">${escapeHtml(input.title)}</div>`,
      footerTemplate: `<div style="font-size:8pt; color:#888; width:100%; padding:0 20mm; text-align:center;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
  const stat = fs.statSync(input.outputPath);
  return { path: input.outputPath, bytes: stat.size };
}
