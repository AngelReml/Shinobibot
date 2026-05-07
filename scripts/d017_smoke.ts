/**
 * D-017 smoke — verifies the approval-system gate without driving the LLM.
 * Exercises the same predicates the orchestrator uses for each scenario from
 * the D-017 prompt (a..e) and prints a PASS/FAIL table.
 *
 * Run: npx tsx scripts/d017_smoke.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ensureApprovalModeInitialized,
  getApprovalMode,
  setApprovalMode,
  setApprovalAsker,
  isDestructive,
  requestApproval,
  clearSessionApprovals,
} from '../src/security/approval.js';
import { validatePath, ABSOLUTE_PROHIBITED_PATHS } from '../src/utils/permissions.js';

const SHINOBI_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
const CONFIG_FILE = path.join(SHINOBI_DIR, 'config.json');

interface Row { paso: string; expected: string; actual: string; ok: boolean }
const rows: Row[] = [];

function record(paso: string, expected: string, actual: string, ok: boolean) {
  rows.push({ paso, expected, actual, ok });
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${paso} — exp=${expected} | got=${actual}`);
}

async function main() {
  // 0) Backup config
  let backup: string | null = null;
  if (fs.existsSync(CONFIG_FILE)) backup = fs.readFileSync(CONFIG_FILE, 'utf-8');

  try {
    // ── Scenario A: arranque, approval_mode missing → default 'smart' ──
    if (backup) {
      const raw = JSON.parse(backup);
      delete raw.approval_mode;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2), 'utf-8');
    }
    // Force re-read by clearing cache: setApprovalMode is the only public path
    // that mutates the cache; read fresh by re-importing? Simpler: trust that a
    // fresh process would call ensureApprovalModeInitialized once. To simulate
    // that here without importing internals, we explicitly call init now.
    const init = ensureApprovalModeInitialized();
    record(
      'A) arranque sin approval_mode → default smart',
      'mode=smart, created=true',
      `mode=${init.mode}, created=${init.created}`,
      init.mode === 'smart' && init.created === true,
    );

    // ── Scenario B: smart mode + crear archivo en Desktop → pasa directo ──
    setApprovalMode('smart');
    let askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'no'; });

    const desktopPath = path.join(os.homedir(), 'Desktop', 'prueba_d017.txt');
    const vB = isDestructive('write_file', { path: desktopPath, content: 'X' });
    const okBValidate = validatePath(desktopPath, 'write').allowed;
    const allowedB = await requestApproval({
      toolName: 'write_file',
      args: { path: desktopPath, content: 'X' },
      destructive: vB.destructive,
      reason: vB.reason,
    });
    record(
      'B) smart + write_file Desktop → ejecuta sin pedir',
      'allowed=true, askerCalls=0, validate=true, destructive=false',
      `allowed=${allowedB}, askerCalls=${askerCalls}, validate=${okBValidate}, destructive=${vB.destructive}`,
      allowedB === true && askerCalls === 0 && okBValidate === true && vB.destructive === false,
    );

    // ── Scenario C: smart mode + rmdir /s Desktop → pide confirmación ──
    askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'no'; });
    const cmdC = `rmdir /s /q ${path.join(os.homedir(), 'Desktop')}`;
    const vC = isDestructive('run_command', { command: cmdC });
    const allowedC = await requestApproval({
      toolName: 'run_command',
      args: { command: cmdC },
      destructive: vC.destructive,
      reason: vC.reason,
    });
    record(
      'C) smart + run_command rmdir /s → pide; user dice no → bloqueado',
      'allowed=false, askerCalls=1, destructive=true',
      `allowed=${allowedC}, askerCalls=${askerCalls}, destructive=${vC.destructive}`,
      allowedC === false && askerCalls === 1 && vC.destructive === true,
    );

    // ── Scenario D: off mode → todo pasa, incluso path prohibido ──
    setApprovalMode('off');
    askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'no'; });

    const allowedD1 = await requestApproval({
      toolName: 'write_file',
      args: { path: desktopPath, content: 'X' },
      destructive: false,
    });
    const winPath = 'C:\\Windows\\System32\\foo_test.txt';
    const validateWinOff = validatePath(winPath, 'write').allowed;
    const allowedD2 = await requestApproval({
      toolName: 'run_command',
      args: { command: cmdC },
      destructive: true,
      reason: 'rmdir',
    });
    record(
      'D) off + Desktop write → pasa | off + System32 → validate true | off + rmdir → pasa',
      'd1=true, validateWin=true, d2=true, askerCalls=0',
      `d1=${allowedD1}, validateWin=${validateWinOff}, d2=${allowedD2}, askerCalls=${askerCalls}`,
      allowedD1 === true && validateWinOff === true && allowedD2 === true && askerCalls === 0,
    );

    // ── Scenario E: on mode + rmdir → pide → user cancela → no ejecuta ──
    setApprovalMode('on');
    clearSessionApprovals();
    askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'no'; });
    const vE = isDestructive('run_command', { command: cmdC });
    const allowedE = await requestApproval({
      toolName: 'run_command',
      args: { command: cmdC },
      destructive: vE.destructive,
      reason: vE.reason,
    });
    // also verify read-only still passes silently in on mode
    askerCalls = 0;
    setApprovalAsker(async () => { askerCalls++; return 'no'; });
    const allowedEr = await requestApproval({
      toolName: 'read_file',
      args: { path: desktopPath },
      destructive: false,
    });
    record(
      'E) on + rmdir → pide → no → bloquea | on + read_file → pasa silencioso',
      'rmdir allowed=false, read allowed=true, read askerCalls=0',
      `rmdir allowed=${allowedE}, read allowed=${allowedEr}, read askerCalls=${askerCalls}`,
      allowedE === false && allowedEr === true && askerCalls === 0,
    );

    // ── Bonus: smart blocks System32 via validatePath even without approval prompt ──
    setApprovalMode('smart');
    const validateWinSmart = validatePath('C:\\Windows\\System32\\foo.dll', 'write');
    record(
      'F) smart + validatePath System32 → bloqueado por lista absoluta',
      'allowed=false',
      `allowed=${validateWinSmart.allowed}, reason="${validateWinSmart.reason ?? ''}"`,
      validateWinSmart.allowed === false,
    );

    // ── Bonus: set off then back to smart persists across ensureInit ──
    setApprovalMode('off');
    setApprovalMode('smart');
    const init2 = ensureApprovalModeInitialized();
    record(
      'G) persistencia round-trip',
      'mode=smart, created=false',
      `mode=${init2.mode}, created=${init2.created}`,
      init2.mode === 'smart' && init2.created === false,
    );

    // ── Render result table ──
    console.log('\n\n=== D-017 SMOKE RESULTS ===\n');
    console.log('| paso | expected | actual | OK/FAIL |');
    console.log('|------|----------|--------|---------|');
    for (const r of rows) {
      const exp = r.expected.replace(/\|/g, '\\|');
      const act = r.actual.replace(/\|/g, '\\|');
      console.log(`| ${r.paso} | ${exp} | ${act} | ${r.ok ? 'OK' : 'FAIL'} |`);
    }
    const failed = rows.filter(r => !r.ok).length;
    console.log(`\nSummary: ${rows.length - failed}/${rows.length} OK, ${failed} FAIL`);
    console.log(`ABSOLUTE_PROHIBITED_PATHS = ${JSON.stringify(ABSOLUTE_PROHIBITED_PATHS)}`);
    console.log(`Active mode at end: ${getApprovalMode()}`);

    if (failed > 0) process.exit(1);
  } finally {
    // Restore original config (with whatever approval_mode it had originally)
    if (backup !== null) {
      fs.writeFileSync(CONFIG_FILE, backup, { encoding: 'utf-8', mode: 0o600 });
      console.log(`\n[D017] Original config restored at ${CONFIG_FILE}`);
    } else if (fs.existsSync(CONFIG_FILE)) {
      // No backup existed → remove what the smoke created
      fs.unlinkSync(CONFIG_FILE);
      console.log(`\n[D017] No prior config → removed test config`);
    }
  }
}

main().catch((e) => { console.error('[D017] Fatal:', e); process.exit(1); });
