// G2.1 — Anonymous, opt-in telemetry client.
//
// Stores a per-install UUID under %APPDATA%/Shinobi/telemetry.json and ships
// small JSON events to /v1/telemetry/event. Never sends prompts, file paths
// or anything that could identify the user. Each event has a fixed shape:
//
//   {
//     anonymous_id: <uuid>,
//     install_version: "1.0.0",
//     platform: "win32" | "darwin" | "linux",
//     event: "session_start" | "command" | "error" | ...,
//     properties: { /* small key->scalar map */ },
//     ts: "2026-05-04T..."
//   }
//
// Disabled by default. The first-run wizard flips opted_in to true if the user
// agrees. The wizard's question is intentionally explicit and reversible via
// `shinobi telemetry off`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface TelemetryConfig {
  opted_in: boolean;
  anonymous_id: string;
  endpoint: string;
  asked_at: string;
  install_version?: string;
}

function stateDir(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Shinobi');
}
function stateFile(): string { return path.join(stateDir(), 'telemetry.json'); }

export function loadConfig(): TelemetryConfig | null {
  const p = stateFile();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as TelemetryConfig; }
  catch { return null; }
}

export function saveConfig(cfg: TelemetryConfig): void {
  const dir = stateDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(cfg, null, 2), 'utf-8');
}

export function defaultEndpoint(): string {
  const base = process.env.OPENGRAVITY_URL ?? 'https://kernel.zapweave.com';
  return base.replace(/\/$/, '') + '/v1/telemetry/event';
}

export function ensureConfigInitialized(opts: { optedIn: boolean; install_version?: string } = { optedIn: false }): TelemetryConfig {
  const existing = loadConfig();
  if (existing) return existing;
  const cfg: TelemetryConfig = {
    opted_in: opts.optedIn,
    anonymous_id: crypto.randomUUID(),
    endpoint: defaultEndpoint(),
    asked_at: new Date().toISOString(),
    install_version: opts.install_version,
  };
  saveConfig(cfg);
  return cfg;
}

export function setOptIn(optIn: boolean): TelemetryConfig {
  const cfg = ensureConfigInitialized({ optedIn: optIn });
  cfg.opted_in = optIn;
  cfg.asked_at = new Date().toISOString();
  saveConfig(cfg);
  return cfg;
}

const ALLOWED_EVENTS = new Set<string>([
  'session_start',
  'session_end',
  'command',
  'error',
  'skill_loaded',
  'demo_run',
  'update_check',
]);

function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  // Only allow string/number/boolean. Strings are clamped at 64 chars.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (typeof v === 'string') out[k] = v.slice(0, 64);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export interface TelemetryEvent {
  anonymous_id: string;
  install_version: string;
  platform: NodeJS.Platform;
  event: string;
  properties: Record<string, unknown>;
  ts: string;
}

export async function emit(event: string, properties: Record<string, unknown> = {}, opts: { timeoutMs?: number; force?: boolean } = {}): Promise<{ sent: boolean; reason?: string }> {
  if (!ALLOWED_EVENTS.has(event)) return { sent: false, reason: 'event not in allowlist' };
  const cfg = loadConfig();
  if (!cfg) return { sent: false, reason: 'no telemetry config' };
  if (!cfg.opted_in && !opts.force) return { sent: false, reason: 'opted out' };
  const body: TelemetryEvent = {
    anonymous_id: cfg.anonymous_id,
    install_version: cfg.install_version ?? '0.0.0',
    platform: process.platform,
    event,
    properties: sanitizeProperties(properties),
    ts: new Date().toISOString(),
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 3000);
  try {
    const apiKey = process.env.SHINOBI_API_KEY ?? '';
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'shinobi-telemetry/1.0',
        ...(apiKey ? { 'X-Shinobi-Key': apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) return { sent: false, reason: `HTTP ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error)?.message ?? 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

export function summary(): { config: TelemetryConfig | null; endpoint: string } {
  return { config: loadConfig(), endpoint: defaultEndpoint() };
}
