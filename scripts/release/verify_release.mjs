#!/usr/bin/env node
// F1.1 — pre-release end-to-end verifier.
//
// Runs every pre-flight check from Tareas..txt F1.1 and reports a pass/fail
// per check. Exits non-zero on the first FAIL so CI gates the release.
// Cross-platform: written in Node so it works on macOS / Linux / Windows
// without bash. Spawns subprocesses (npx tsx + curl-equivalent fetch) but
// never opens a UI.
//
// Skip individual checks via env var, e.g. SKIP_LANDING=1 verify_release.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const OG_ROOT = resolve(ROOT, '..', 'OpenGravity');
const SHINOBI_BENCH_ROOT = resolve(ROOT, '..', 'shinobi-bench');

const KERNEL_BASE = process.env.KERNEL_BASE_URL ?? process.env.OPENGRAVITY_URL ?? 'https://kernel.zapweave.com';
const ZAPWEAVE_BASE = process.env.ZAPWEAVE_BASE_URL ?? 'https://zapweave.com';

function step(name, skipEnv) {
  return { name, skipEnv };
}

const STEPS = [
  step('Demo Auto-Mejora end-to-end (full-self-improve --no-record)', 'SKIP_DEMO_AUTOMEJORA'),
  step('Demo Windows Native (skill load: 8 desktop bundles register tools)', 'SKIP_DEMO_WIN_NATIVE'),
  step('shinobi import hermes --dry-run with synthetic fixture', 'SKIP_HERMES_IMPORT'),
  step('audit.zapweave.com landing reachable (or local web/audit/index.html exists)', 'SKIP_LANDING_AUDIT'),
  step('kernel.zapweave.com /v1/health 200 OK (or skip if KERNEL_OFFLINE=1)', 'SKIP_KERNEL_HEALTH'),
  step('zapweave.com landing reachable (or local web/index.html exists)', 'SKIP_ZAPWEAVE_LANDING'),
  step('ShinobiSetup.exe present in build/ (B1 manual TODO; soft-skipped if absent)', 'SKIP_INSTALLER_PRESENT'),
];

function runChild(cmd, args, cwd, timeoutMs = 180_000) {
  return new Promise((resolveOk) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', signal: ac.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveOk({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolveOk({ code: -1, stdout, stderr: stderr + '\n' + (e.message ?? String(e)) });
    });
  });
}

async function tryFetch(url, expectStatus = 200, timeoutMs = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return { ok: res.status === expectStatus, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, err: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const flag = ok === 'skipped' ? '⏭ ' : ok ? '✓ ' : '✗ ';
  console.log(`${flag} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log(`[verify-release] ROOT=${ROOT}`);
  console.log(`[verify-release] OG=${OG_ROOT}  SHINOBI_BENCH=${SHINOBI_BENCH_ROOT}`);
  console.log('');

  // 1) Demo auto-mejora — uses runDemo --no-record (no OBS dependency).
  if (process.env.SKIP_DEMO_AUTOMEJORA === '1') {
    record(STEPS[0].name, 'skipped', 'env');
  } else {
    const r = await runChild('npx', ['tsx', 'scripts/shinobi.ts', 'run-demo', 'full-self-improve', '--no-record'], ROOT, 120_000);
    const passed = (r.stdout.match(/"verdict":\s*"PASS"/g) ?? []).length;
    record(STEPS[0].name, r.code === 0 && passed >= 5, `exit=${r.code} pass=${passed}`);
  }

  // 2) Desktop skill load (we don't open the apps; assert all 8 bundles register their tools)
  if (process.env.SKIP_DEMO_WIN_NATIVE === '1') {
    record(STEPS[1].name, 'skipped', 'env');
  } else {
    const r = await runChild('npx', ['tsx', 'scripts/desktop_skills_load.ts'], ROOT, 60_000);
    const ok = r.code === 0 && /8\/8 bundles loadable/.test(r.stdout);
    record(STEPS[1].name, ok, `exit=${r.code}`);
  }

  // 3) Hermes import dry-run via the synthetic fixture in the test suite.
  if (process.env.SKIP_HERMES_IMPORT === '1') {
    record(STEPS[2].name, 'skipped', 'env');
  } else {
    const r = await runChild('npx', ['tsx', 'src/migration/__tests__/from_hermes.test.ts'], ROOT, 60_000);
    record(STEPS[2].name, r.code === 0 && /\[a4-e2e\] OK/.test(r.stdout), `exit=${r.code}`);
  }

  // 4) AuditGravity landing reachable. Live URL preferred; local HTML acceptable as fallback.
  if (process.env.SKIP_LANDING_AUDIT === '1') {
    record(STEPS[3].name, 'skipped', 'env');
  } else {
    const live = await tryFetch(`${ZAPWEAVE_BASE}/audit/`, 200);
    if (live.ok) record(STEPS[3].name, true, `live ${live.status}`);
    else if (existsSync(join(ROOT, 'web', 'audit', 'index.html'))) record(STEPS[3].name, true, 'local file present');
    else record(STEPS[3].name, false, `live=${live.status} no local file`);
  }

  // 5) Kernel /v1/health.
  if (process.env.SKIP_KERNEL_HEALTH === '1' || process.env.KERNEL_OFFLINE === '1') {
    record(STEPS[4].name, 'skipped', 'KERNEL_OFFLINE');
  } else {
    const r = await tryFetch(`${KERNEL_BASE}/v1/health`, 200, 8000);
    record(STEPS[4].name, r.ok, r.ok ? `${r.status}` : `${r.status} ${r.err ?? ''}`);
  }

  // 6) zapweave.com landing.
  if (process.env.SKIP_ZAPWEAVE_LANDING === '1') {
    record(STEPS[5].name, 'skipped', 'env');
  } else {
    const live = await tryFetch(`${ZAPWEAVE_BASE}/`, 200);
    if (live.ok) record(STEPS[5].name, true, `live ${live.status}`);
    else if (existsSync(join(ROOT, 'web', 'index.html'))) record(STEPS[5].name, true, 'local file present');
    else record(STEPS[5].name, false, 'no live, no local');
  }

  // 7) Installer present (B1 manual). Soft skip if absent.
  if (process.env.SKIP_INSTALLER_PRESENT === '1') {
    record(STEPS[6].name, 'skipped', 'env');
  } else {
    const candidates = [join(ROOT, 'build', 'ShinobiSetup.exe'), join(ROOT, 'build', `ShinobiSetup-${process.env.SHINOBI_VERSION ?? '1.0.0'}.exe`)];
    const found = candidates.find((c) => existsSync(c));
    if (found) record(STEPS[6].name, true, `${found} (${statSync(found).size} bytes)`);
    else record(STEPS[6].name, 'skipped', 'absent — B1 not yet executed');
  }

  console.log('');
  const fails = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === 'skipped').length;
  const passed = results.filter((r) => r.ok === true).length;
  console.log(`[verify-release] passed=${passed} failed=${fails.length} skipped=${skipped} total=${results.length}`);
  if (fails.length > 0) {
    console.log('');
    console.log('Blockers:');
    for (const f of fails) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log('All checks green. Ready to tag the release.');
}

main().catch((e) => { console.error('[verify-release] FAIL', e); process.exit(2); });
