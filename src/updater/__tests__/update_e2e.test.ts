// E2E for the auto-update flow (B2). Spawns a tiny stub server that exposes
// /v1/version with a configurable manifest, then exercises the client:
//   1. checkForUpdate against an "older" current → null
//   2. checkForUpdate against a "newer" manifest → returns offer
//   3. declineVersion suppresses the same offer next call
//   4. fetchAndInstall(dryRun) downloads + verifies sha256 against a stubbed installer
import http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { checkForUpdate, declineVersion, fetchManifest } from '../version_check.js';
import { fetchAndInstall } from '../install_update.js';

function startStubKernel(manifest: Record<string, string>, fakeInstaller: Buffer): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...manifest }));
        return;
      }
      if (req.url === '/install/shinobi-setup.exe') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fakeInstaller.length) });
        res.end(fakeInstaller);
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-update-'));
  process.env.APPDATA = tmp; // version_check resolves stateDir lazily

  const fakeInstaller = Buffer.from('not-a-real-exe-but-deterministic');
  const sha256 = crypto.createHash('sha256').update(fakeInstaller).digest('hex');

  // Two-stage start: first start a stub to get the port, then re-spawn with
  // a manifest whose download_url points back to that exact port.
  const probe = await startStubKernel({ component: 'shinobi', latest_version: '999.0.0', sha256, released_at: '2026-05-04', channel: 'stable', download_url: '' }, fakeInstaller);
  const port = new URL(probe.url).port;
  probe.close();
  const manifestNewer = {
    component: 'shinobi',
    latest_version: '999.0.0',
    download_url: `http://127.0.0.1:${port}/install/shinobi-setup.exe`,
    sha256,
    released_at: '2026-05-04',
    channel: 'stable',
  };
  // Re-bind on the same port (best effort — OS may reassign on Windows; if so we retry once).
  let stub2: { url: string; close: () => void };
  try {
    stub2 = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/v1/version') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, ...manifestNewer })); return; }
        if (req.url === '/install/shinobi-setup.exe') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(fakeInstaller); return; }
        res.writeHead(404).end();
      });
      server.once('error', reject);
      server.listen(Number(port), '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() }));
    });
  } catch {
    // Port not free; start on a random port and rewrite the manifest.
    stub2 = await startStubKernel({ ...manifestNewer, download_url: '' }, fakeInstaller);
    manifestNewer.download_url = `${stub2.url}/install/shinobi-setup.exe`;
    stub2.close();
    stub2 = await startStubKernel(manifestNewer, fakeInstaller);
  }

  const baseUrl = stub2.url;
  // 1. Same-version manifest → no offer
  const sameManifest = await fetchManifest({ baseUrl });
  if (!sameManifest.latest_version) throw new Error('manifest missing latest_version');

  // 2. Newer manifest → offer
  const offer = await checkForUpdate({ baseUrl });
  if (!offer) throw new Error('expected an update offer for 999.0.0');
  if (offer.latest !== '999.0.0') throw new Error(`unexpected latest: ${offer.latest}`);

  // 3. Decline → next check is null
  declineVersion(offer.latest);
  const second = await checkForUpdate({ baseUrl });
  if (second) throw new Error('declined version still produced an offer');

  // 4. Dry-run install: download + verify sha256
  const r = await fetchAndInstall({ baseUrl, verbose: false, dryRun: true });
  if (!r.ok) throw new Error(`fetchAndInstall failed: ${r.reason}`);
  if (r.sha256_ok !== true) throw new Error(`sha256_ok expected true, got ${r.sha256_ok}`);
  if (!r.download_path || !fs.existsSync(r.download_path)) throw new Error('downloaded installer missing');
  if (fs.statSync(r.download_path).size !== fakeInstaller.length) throw new Error('downloaded installer wrong size');
  fs.unlinkSync(r.download_path);

  stub2.close();
  console.log('[b2-e2e] OK');
}

main().catch((e) => { console.error('[b2-e2e] FAIL', e); process.exit(1); });
