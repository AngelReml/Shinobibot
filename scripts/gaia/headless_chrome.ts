// Chrome headless DEDICADO para la cata GAIA. El runner LO POSEE: lo lanza
// headless (sin ventana, no toca el Chrome del usuario), en un puerto CDP
// propio (≠ 9222) con user-data-dir temporal, y lo mata por ÁRBOL al terminar
// o al interrumpir. Shinobi se conecta vía SHINOBI_BROWSER_CDP_URL.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';

export interface HeadlessChrome {
  cdpUrl: string;
  pid: number;
  kill: () => void;
}

/** Mata un proceso y TODO su árbol (Windows: taskkill /T /F). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* ya muerto */ }
}

async function cdpReady(cdpUrl: string, totalMs = 15000, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${cdpUrl}/json/version`);
      if (r.ok) return true;
    } catch { /* aún no */ }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}

/**
 * Lanza Chromium (el bundled de Playwright) en modo headless con CDP propio.
 * Devuelve la URL CDP + pid + un kill() idempotente que limpia el árbol y el
 * user-data-dir temporal.
 */
export async function launchHeadlessChrome(port = Number(process.env.GAIA_CDP_PORT) || 9333): Promise<HeadlessChrome> {
  const { chromium } = await import('playwright');
  const exe = chromium.executablePath();
  if (!exe) throw new Error('No se encontró el Chromium bundled de Playwright (chromium.executablePath vacío).');

  const userDataDir = mkdtempSync(join(tmpdir(), 'gaia-chrome-'));
  const cdpUrl = `http://127.0.0.1:${port}`;

  // UA realista (sin "HeadlessChrome") + flags anti-automation: si no, Bing/Google
  // detectan el headless y sirven una página degradada (consent/promo) sin
  // resultados → web_search devuelve basura y el agente nunca converge.
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const proc: ChildProcess = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    `--user-agent=${UA}`,
    '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en',
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true, detached: !IS_WIN });

  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    killTree(proc.pid);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };

  const ok = await cdpReady(cdpUrl);
  if (!ok) {
    kill();
    throw new Error(`Chrome headless lanzado (pid=${proc.pid}) pero CDP ${cdpUrl} no respondió a tiempo.`);
  }
  return { cdpUrl, pid: proc.pid ?? -1, kill };
}
