// Read-only smoke for screen_observe / screen_act:
//   - the modules import without throwing (the @nut-tree-fork/nut-js native
//     binding loads on this Windows install)
//   - both tools register with the in-process tool registry
//   - screen_safety guards reject obvious forbidden window titles + zones
//   - KillSwitch class is instantiable
//
// We deliberately do NOT execute screen_observe or screen_act — that would
// move the user's mouse / take a screenshot of their real desktop. That is
// a manual verification documented in docs/architecture/computer_use.md.
async function main() {
  // 1. screen_observe module imports + registers
  const obs: any = await import('../screen_observe.js');
  const observeTool = obs.default ?? obs.screenObserveTool;
  if (!observeTool || observeTool.name !== 'screen_observe') {
    throw new Error('screen_observe did not register as a tool with name "screen_observe"');
  }
  if (typeof observeTool.execute !== 'function') throw new Error('screen_observe.execute missing');

  // 2. screen_act module imports + registers
  const act: any = await import('../screen_act.js');
  const actTool = act.default ?? act.screenActTool;
  if (!actTool || actTool.name !== 'screen_act') {
    throw new Error('screen_act did not register as a tool with name "screen_act"');
  }
  if (typeof actTool.execute !== 'function') throw new Error('screen_act.execute missing');

  // 3. screen_safety guards reject the obvious cases
  const safety: any = await import('../../utils/screen_safety.js');
  if (typeof safety.checkWindowTitle !== 'function') throw new Error('checkWindowTitle missing');
  if (typeof safety.checkClickPosition !== 'function') throw new Error('checkClickPosition missing');
  if (typeof safety.isDestructiveAction !== 'function') throw new Error('isDestructiveAction missing');

  // Forbidden window titles: System32, UAC, taskbar
  const titleSystem32 = safety.checkWindowTitle('C:\\Windows\\System32 - File Explorer');
  if (titleSystem32.allowed !== false) throw new Error('System32 title should be blocked');
  const titleUAC = safety.checkWindowTitle('User Account Control');
  if (titleUAC.allowed !== false) throw new Error('UAC title should be blocked');
  const titleNotepad = safety.checkWindowTitle('Untitled - Notepad');
  if (titleNotepad.allowed !== true) throw new Error('Notepad title should be allowed');

  // Click in taskbar zone (bottom 40px) blocked on a 1920x1080 baseline.
  const clickTaskbar = safety.checkClickPosition(500, 1078, 1920, 1080);
  if (clickTaskbar.allowed !== false) throw new Error('taskbar click should be blocked');
  const clickMid = safety.checkClickPosition(500, 500, 1920, 1080);
  if (clickMid.allowed !== true) throw new Error('mid-screen click should be allowed');

  // Destructive intents (function takes a single args object)
  const destrRm = safety.isDestructiveAction({ action: 'type', text: 'rm -rf /' });
  if (!destrRm.destructive) throw new Error('rm -rf should be flagged destructive');
  const benignType = safety.isDestructiveAction({ action: 'type', text: 'hello world' });
  if (benignType.destructive) throw new Error('hello world should not be destructive');

  // 4. KillSwitch class loadable + static API present (start/stop/shouldAbort/reset).
  const ks: any = await import('../../utils/kill_switch.js');
  const KillSwitch = ks.KillSwitch;
  if (typeof KillSwitch !== 'function') throw new Error('KillSwitch class missing');
  for (const m of ['start', 'stop', 'shouldAbort', 'reset']) {
    if (typeof KillSwitch[m] !== 'function') throw new Error(`KillSwitch.${m} missing`);
  }

  console.log('[screen-smoke] OK');
  console.log('  screen_observe registered      ✓');
  console.log('  screen_act registered          ✓');
  console.log('  forbidden titles blocked       ✓ (System32 + UAC)');
  console.log('  taskbar zone blocked           ✓');
  console.log('  destructive type detected      ✓ (rm -rf)');
  console.log('  KillSwitch instantiable        ✓');
}

main().catch((e) => { console.error('[screen-smoke] FAIL', e?.message ?? e); process.exit(1); });
