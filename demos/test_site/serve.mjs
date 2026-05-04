#!/usr/bin/env node
// C7.2 — Local test site for the killer demo. Serves an index page with
// infinite scroll + 3 "load more" buttons and 8 PDFs whose internal titles
// don't match their filenames. Pure stdlib, no deps.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KILLER_SITE_PORT ?? 8765);
const HOST = process.env.KILLER_SITE_HOST ?? '127.0.0.1';

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(__dirname, 'index.html')));
    return;
  }
  if (url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(readFileSync(join(__dirname, 'manifest.json')));
    return;
  }
  // /pdfs/<file>.pdf
  const pdfMatch = url.match(/^\/pdfs\/(doc_\d+\.pdf)$/);
  if (pdfMatch) {
    const p = join(__dirname, 'pdfs', pdfMatch[1]);
    if (!existsSync(p)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(statSync(p).size) });
    res.end(readFileSync(p));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[killer-site] listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown so spawn can clean up
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
