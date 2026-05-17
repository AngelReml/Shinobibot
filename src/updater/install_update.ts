// B2.4 / B2.5 — download + silent-install the latest Shinobi setup.
//
// Flow when the user runs `shinobi update`:
//   1. Pull /v1/version. Bail if no update available.
//   2. Download the .exe to %TEMP%/shinobi-setup-<ver>.exe.
//   3. Verify SHA-256 against the manifest if the manifest provides one.
//   4. Spawn the installer detached with `/SILENT /NORESTART` (Inno Setup
//      conventions; B1 will produce these flags). Then exit the current
//      process so the new install can replace files.
//
// We never delete or modify Shinobi state on disk. The Inno Setup installer
// is responsible for the actual file replacement and post-install hooks.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchManifest, type UpdateOffer } from './version_check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InstallOptions {
  /** Override the kernel base URL. */
  baseUrl?: string;
  /** Print progress to stdout. */
  verbose?: boolean;
  /** Skip the silent install (download + verify only). */
  dryRun?: boolean;
}

export interface InstallResult {
  ok: boolean;
  reason?: string;
  download_path?: string;
  manifest_version?: string;
  sha256_ok?: boolean;
  installer_pid?: number;
}

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'shinobi-updater/1.0' } });
  if (!res.ok) throw new Error(`download HTTP ${res.status} from ${url}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(ab));
}

function sha256Of(path: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(path));
  return h.digest('hex');
}

export async function runUpdate(offer: UpdateOffer, opts: InstallOptions = {}): Promise<InstallResult> {
  if (!offer.download_url) return { ok: false, reason: 'no download_url in manifest' };
  const dest = path.join(os.tmpdir(), `shinobi-setup-${offer.latest}.exe`);

  if (opts.verbose) console.log(`[update] downloading ${offer.download_url} -> ${dest}`);
  try {
    await downloadTo(offer.download_url, dest);
  } catch (e) {
    return { ok: false, reason: `download failed: ${(e as Error).message}` };
  }

  let sha256_ok: boolean | undefined;
  if (offer.sha256) {
    const got = sha256Of(dest);
    sha256_ok = got.toLowerCase() === offer.sha256.toLowerCase();
    if (!sha256_ok) return { ok: false, reason: `sha256 mismatch: expected ${offer.sha256}, got ${got}`, download_path: dest, manifest_version: offer.latest };
    if (opts.verbose) console.log(`[update] sha256 ok`);
  }

  if (opts.dryRun) {
    return { ok: true, download_path: dest, manifest_version: offer.latest, sha256_ok };
  }

  // Seguridad: NUNCA se ejecuta un instalador sin verificar su hash. Si el
  // manifest no trae `sha256`, el .exe descargado no es verificable — un
  // `/v1/version` comprometido o un MITM sobre `download_url` podría servir
  // un instalador arbitrario. Se descarga (queda en `download_path` para
  // inspección) pero NO se lanza.
  if (!offer.sha256) {
    return {
      ok: false,
      reason: 'el manifest no trae sha256: el instalador no es verificable y no se ejecuta',
      download_path: dest,
      manifest_version: offer.latest,
    };
  }

  if (process.platform !== 'win32') {
    return { ok: false, reason: 'silent installer is Windows-only', download_path: dest, manifest_version: offer.latest, sha256_ok };
  }

  if (opts.verbose) console.log('[update] launching installer in silent mode and exiting');
  const child = spawn(dest, ['/SILENT', '/NORESTART'], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, download_path: dest, manifest_version: offer.latest, sha256_ok, installer_pid: child.pid };
}

export async function fetchAndInstall(opts: InstallOptions = {}): Promise<InstallResult> {
  // Re-fetch the manifest so we always install the freshest one, not a stale offer.
  const m = await fetchManifest({ baseUrl: opts.baseUrl }).catch((e) => { throw new Error(`manifest fetch: ${e.message}`); });
  const current = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf-8')).version ?? '0.0.0';
  if (m.latest_version === current) return { ok: false, reason: 'already on latest', manifest_version: m.latest_version };
  return runUpdate({
    current,
    latest: m.latest_version,
    download_url: m.download_url,
    sha256: m.sha256,
    released_at: m.released_at,
    channel: m.channel,
    notes_url: m.notes_url,
  }, opts);
}
