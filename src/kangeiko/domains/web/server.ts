/**
 * kangeiko/domains/web/server.ts — serve the closed-dojo fixtures locally (KG-02).
 * A tiny read-only static HTTP server over the fixtures/ dir. Local only, nothing
 * leaves the machine; the arena's dojo://fixtures/X urls resolve against it. Real,
 * runnable — no browser needed for static fixtures (lo sencillo, sencillo).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DojoServer { url: string; port: number; close(): Promise<void>; }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain' };

export async function serveDojo(opts: { dir?: string; port?: number } = {}): Promise<DojoServer> {
  const dir = opts.dir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const server = http.createServer((req, res) => {
    // GET only — a closed read-only dojo. POST (e.g. /place-order) is refused.
    if (req.method !== 'GET') { res.writeHead(405).end('method not allowed (closed dojo is read-only)'); return; }
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const file = path.join(dir, rel || 'index.html');
    if (!file.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }  // no path traversal
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
  return { url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}
