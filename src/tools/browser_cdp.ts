import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { Socket } from 'net';
import { join } from 'path';
import type { Browser } from 'playwright';

const CDP_PORT = 9222;
const CDP_URL = `http://localhost:${CDP_PORT}`;
const LAUNCH_WAIT_TOTAL_MS = 10000;
const LAUNCH_WAIT_INTERVAL_MS = 500;

let pendingLaunch: Promise<void> | null = null;

function getBrowserCandidates(): string[] {
  const candidates: string[] = [
    'C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const lad = process.env.LOCALAPPDATA;
  if (lad) candidates.push(join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return candidates;
}

/**
 * Last-resort: Playwright's bundled Chromium. Resolved at runtime via
 * `chromium.executablePath()`. Used when neither Comet nor Chrome system
 * are installed (Bloque 2 fallback chain Comet → Chrome → Chromium bundled).
 */
async function getChromiumBundledPath(): Promise<string | null> {
  try {
    const { chromium } = await import('playwright');
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
    return null;
  } catch {
    return null;
  }
}

async function findBrowserExecutable(): Promise<{ path: string; engine: 'comet' | 'chrome' | 'chromium-bundled' } | null> {
  for (const p of getBrowserCandidates()) {
    try {
      if (existsSync(p)) {
        const engine: 'comet' | 'chrome' = /comet\.exe$/i.test(p) ? 'comet' : 'chrome';
        return { path: p, engine };
      }
    } catch {}
  }
  const bundled = await getChromiumBundledPath();
  if (bundled) return { path: bundled, engine: 'chromium-bundled' };
  return null;
}

async function isPortOpen(port: number, host = 'localhost', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function isBrowserProcessRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const child = spawn('tasklist', ['/NH', '/FO', 'CSV'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(/(comet\.exe|chrome\.exe)/i.test(out)));
  });
}

async function waitForPort(port: number, totalMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function launchBrowserDetached(exe: string): void {
  const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

async function doLaunch(): Promise<void> {
  if (await isPortOpen(CDP_PORT)) return;

  if (process.platform !== 'win32') {
    throw new Error(
      `No browser on port ${CDP_PORT}. Auto-launch is only implemented on Windows; start Chromium manually with --remote-debugging-port=${CDP_PORT}.`
    );
  }

  if (await isBrowserProcessRunning()) {
    throw new Error(
      `No browser on port ${CDP_PORT}, but a Comet/Chrome process is already running. ` +
      `Close every instance (check tray icons) and retry — Chromium refuses to enable remote debugging on a second instance.`
    );
  }

  const found = await findBrowserExecutable();
  if (!found) {
    throw new Error(
      `No browser on port ${CDP_PORT} and no Comet/Chrome/Chromium executable found. Tried: ${getBrowserCandidates().join(' | ')} | playwright bundled chromium`
    );
  }

  launchBrowserDetached(found.path);

  const ok = await waitForPort(CDP_PORT, LAUNCH_WAIT_TOTAL_MS, LAUNCH_WAIT_INTERVAL_MS);
  if (!ok) {
    throw new Error(`Launched ${found.path} (engine=${found.engine}) but port ${CDP_PORT} did not open within ${LAUNCH_WAIT_TOTAL_MS}ms.`);
  }
}

async function ensureLaunched(): Promise<void> {
  if (!pendingLaunch) {
    pendingLaunch = doLaunch().finally(() => { pendingLaunch = null; });
  }
  await pendingLaunch;
}

export async function connectOrLaunchCDP(): Promise<Browser> {
  const { chromium } = await import('playwright');
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch (err: any) {
    if (!err?.message?.includes('ECONNREFUSED')) throw err;
  }
  await ensureLaunched();
  return await chromium.connectOverCDP(CDP_URL);
}
