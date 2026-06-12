// Watchdog de ciclo de vida para la cata GAIA.
//
// El runner es POSEEDOR del Chrome headless dedicado + los gaia_agent. Pero si
// al runner lo MATAN a la fuerza (taskkill /F, TaskStop del harness, kill -9),
// sus handlers de señal NO se ejecutan → Chrome y agentes quedan huérfanos.
//
// Este watchdog se lanza DETACHED (sobrevive a la muerte del runner), vigila el
// PID del runner, y en cuanto desaparece mata el ÁRBOL del Chrome dedicado +
// barre cualquier node `gaia_agent` vivo, y sale. Garantiza "cero huérfanos"
// incluso ante force-kill. En cierre normal, el runner lo mata él mismo.
//
// Uso: node watchdog.mjs <runnerPid> <chromePid>
import { spawnSync } from 'node:child_process';

const runnerPid = Number(process.argv[2]);
const chromePid = Number(process.argv[3]);
const IS_WIN = process.platform === 'win32';

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* ya muerto */ }
}

function sweepAgents() {
  if (!IS_WIN) return;
  // Mata cualquier node que esté corriendo scripts\gaia\gaia_agent (nuestros agentes).
  const ps =
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gaia_agent' } | " +
    "ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }";
  try { spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' }); } catch { /* */ }
}

const timer = setInterval(() => {
  if (!alive(runnerPid)) {
    killTree(chromePid);
    sweepAgents();
    clearInterval(timer);
    process.exit(0);
  }
}, 2000);
