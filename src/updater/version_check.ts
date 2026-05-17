// B2.2 / B2.3 — Shinobi update check.
//
// On CLI startup we ask the kernel for /v1/version, compare it against the
// version baked into package.json, and surface a one-line banner with a
// download URL if a newer release exists. We never auto-install — the user
// must run `shinobi update` (B2.4/B2.5) explicitly.
//
// Pure stdlib (Node 20+ fetch). Failures are silent on stderr to avoid
// breaking the user's session if the kernel is offline.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(__dirname, '..', '..', 'package.json');

// Resolved lazily so tests can override APPDATA after import.
function stateDir(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Shinobi');
}
function stateFile(): string {
  return path.join(stateDir(), 'updater_state.json');
}

export interface VersionManifest {
  component: string;
  latest_version: string;
  download_url: string;
  /** SHA256 del instalador. Opcional en el JSON externo; si falta,
   *  install_update rehúsa ejecutar el .exe (no es verificable). */
  sha256?: string;
  released_at: string;
  channel: string;
  notes_url?: string;
}

export interface UpdateOffer {
  current: string;
  latest: string;
  download_url: string;
  /** SHA256 esperado del instalador; opcional (ver VersionManifest.sha256). */
  sha256?: string;
  released_at: string;
  channel: string;
  notes_url?: string;
}

export interface CheckOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Skip silently if the user has already declined this exact version. */
  declineFile?: string;
}

function readPackageVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export async function fetchManifest(opts: CheckOptions = {}): Promise<VersionManifest> {
  const base = opts.baseUrl ?? process.env.OPENGRAVITY_URL ?? 'http://localhost:9900';
  const url = base.replace(/\/$/, '') + '/v1/version';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'shinobi-updater/1.0' } });
    if (!res.ok) throw new Error(`/v1/version HTTP ${res.status}`);
    const data = (await res.json()) as VersionManifest;
    if (!data || typeof data.latest_version !== 'string') throw new Error('manifest malformed');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function loadDeclined(): string[] {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf-8')).declined ?? [];
  } catch {
    return [];
  }
}

export function declineVersion(version: string): void {
  if (!fs.existsSync(stateDir())) fs.mkdirSync(stateDir(), { recursive: true });
  const declined = new Set(loadDeclined());
  declined.add(version);
  fs.writeFileSync(stateFile(), JSON.stringify({ declined: [...declined] }, null, 2), 'utf-8');
}

/** Returns an UpdateOffer if `latest > current` and not previously declined; null otherwise. */
export async function checkForUpdate(opts: CheckOptions = {}): Promise<UpdateOffer | null> {
  const current = readPackageVersion();
  let manifest: VersionManifest;
  try {
    manifest = await fetchManifest(opts);
  } catch {
    return null;
  }
  if (compareSemver(manifest.latest_version, current) <= 0) return null;
  if (loadDeclined().includes(manifest.latest_version)) return null;
  return {
    current,
    latest: manifest.latest_version,
    download_url: manifest.download_url,
    sha256: manifest.sha256,
    released_at: manifest.released_at,
    channel: manifest.channel,
    notes_url: manifest.notes_url,
  };
}

export function renderOffer(offer: UpdateOffer): string {
  const lines = [
    '',
    '╭─ Shinobi update available ──────────────────────────────',
    `│ current : ${offer.current}`,
    `│ latest  : ${offer.latest}${offer.released_at ? '  (' + offer.released_at + ')' : ''}`,
    `│ channel : ${offer.channel}`,
  ];
  if (offer.download_url) lines.push(`│ download: ${offer.download_url}`);
  if (offer.notes_url) lines.push(`│ notes   : ${offer.notes_url}`);
  lines.push(`│`);
  lines.push(`│ Run \`shinobi update\` to apply, or ignore for this session.`);
  lines.push('╰──────────────────────────────────────────────────────────');
  lines.push('');
  return lines.join('\n');
}

export { compareSemver };
