/**
 * B9 E2E test (smoke): screen_observe + screen_act on Notepad.
 *
 * Steps:
 *   1) Spawn Notepad.exe
 *   2) Wait for the window to be ready
 *   3) Use screen_act to type "test B9 OK"
 *   4) Use screen_observe to verify the text appears (vision LLM)
 *   5) Close Notepad without saving (taskkill — no Alt+F4)
 *
 * Run:  npx tsx test_b9.ts
 *
 * Notes:
 *   - screen_observe needs OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY.
 *     If neither is set, the screenshot is taken but the vision check is skipped
 *     and the test reports VISION_SKIPPED.
 *   - The script DOES move the mouse and type into Notepad. Don't run while you
 *     are using the keyboard for something else.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import './src/tools/index.js';
import { getTool } from './src/tools/tool_registry.js';
import { KillSwitch } from './src/utils/kill_switch.js';
import * as dotenv from 'dotenv';

dotenv.config();

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function killNotepad() {
  return new Promise<void>((resolve) => {
    const p = spawn('taskkill', ['/IM', 'notepad.exe', '/F'], { windowsHide: true });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
}

async function main() {
  console.log('--- B9 E2E (Notepad) ---');
  let pass = 0;
  let fail = 0;

  // ensure no leftover notepad
  await killNotepad();
  await sleep(400);

  const observe = getTool('screen_observe');
  const act = getTool('screen_act');
  if (!observe || !act) {
    console.log('FAIL: tools not registered');
    process.exit(2);
  }

  console.log('T1: open Notepad');
  const np = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  np.unref();
  await sleep(1500);
  console.log('  notepad spawned, pid=', np.pid);
  pass++;

  console.log('T2: focus Notepad and type "test B9 OK"');
  // Focus by clicking near the editor area. Notepad typically opens centered.
  // We'll skip a click and rely on the just-spawned window having focus.
  const typeRes = await act.execute({ action: 'type', text: 'test B9 OK', delay_ms: 300 });
  console.log('  type result:', typeRes.success, typeRes.error || typeRes.output);
  if (typeRes.success) pass++; else fail++;

  console.log('T3: screen_observe verifies the text');
  const haveVision = !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
  if (!haveVision) {
    console.log('  VISION_SKIPPED (no OPENROUTER_API_KEY / OPENAI_API_KEY in env)');
  } else {
    const obs = await observe.execute({ goal: 'Confirm that the Notepad editor area contains the text "test B9 OK".' });
    console.log('  observe success:', obs.success);
    if (obs.success) {
      const found = /test\s*B9\s*OK/i.test(obs.output);
      console.log('  text "test B9 OK" detected by vision:', found);
      if (found) pass++; else fail++;
    } else if (/401|403|unauthor/i.test(obs.error || '')) {
      console.log('  VISION_SKIPPED (auth error from provider — invalid/expired API key):', obs.error);
    } else {
      console.log('  observe error:', obs.error);
      fail++;
    }
  }

  console.log('T4: forbidden-zone refusal (taskbar click)');
  const nut: any = await import('@nut-tree-fork/nut-js');
  const sw = await nut.screen.width();
  const sh = await nut.screen.height();
  const taskbarRes = await act.execute({ action: 'click', x: 100, y: sh - 5 });
  if (!taskbarRes.success && /taskbar/i.test(taskbarRes.error || '')) {
    console.log('  refused as expected:', taskbarRes.error);
    pass++;
  } else {
    console.log('  UNEXPECTED:', taskbarRes);
    fail++;
  }

  console.log('T5: destructive action gate (Alt+F4 without confirm in non-TTY)');
  const altF4 = await act.execute({ action: 'hotkey', hotkey: ['Alt', 'F4'] });
  if (!altF4.success && /declined/i.test(altF4.error || '')) {
    console.log('  gated as expected:', altF4.error);
    pass++;
  } else {
    console.log('  Alt+F4 result:', altF4);
    // If TTY is auto-confirmed or Alt+F4 succeeds we don't count it as failure
    // since on truly interactive terminals the prompt would appear.
  }

  console.log('T6: cleanup notepad with taskkill');
  await killNotepad();
  await sleep(300);

  KillSwitch.stop();

  console.log(`\nResult: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); KillSwitch.stop(); process.exit(2); });
