/**
 * Screen safety (B9):
 *  - forbidden zones: taskbar, system tray, UAC dialog area, /Windows /System32 windows
 *  - destructive intent detection (close-without-save, delete)
 *  - HARD blacklist of destructive hotkeys (close window, lock, context switch)
 *
 * Incident 2026-05-16 (docs/incidents/2026-05-16_screen_act_hotkey_escape.md):
 * a stuck agent reached for screen_act + Alt+F4 to "fix" a broken browser,
 * trying to close the user's windows. Confirmation gating was not enough —
 * in non-interactive runs the gate auto-declines, but the agent kept rotating
 * tactics. Destructive hotkeys are now refused outright, like Stop-Process.
 */

export interface ForbiddenZoneCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Forbid clicks in the bottom system-tray / start-button strip and the top-right UAC area.
 * Heuristic: bottom 40px of the screen height is taskbar territory on Windows.
 * The Notepad title bar / window controls are NOT in this band.
 */
export function checkClickPosition(x: number, y: number, screenWidth: number, screenHeight: number): ForbiddenZoneCheck {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { allowed: false, reason: 'Coordinates must be finite numbers.' };
  }
  if (x < 0 || y < 0 || x > screenWidth || y > screenHeight) {
    return { allowed: false, reason: `Coordinates (${x},${y}) outside screen ${screenWidth}x${screenHeight}.` };
  }
  // Taskbar band (bottom 40px) — system tray + start menu live here.
  if (y >= screenHeight - 40) {
    return { allowed: false, reason: 'Click is in the Windows taskbar / system-tray band (bottom 40px). Forbidden.' };
  }
  return { allowed: true };
}

/**
 * Window-title forbidden filter. If the foreground window title contains
 * any of these substrings, screen_act refuses to act.
 */
const FORBIDDEN_TITLE_PATTERNS = [
  /user account control/i,         // UAC dialog
  /windows security/i,             // Windows Defender / SmartScreen
  /administrator: /i,              // Elevated terminal
  /system32/i,
  /windows\\system/i,
  /control panel/i,
  /windows update/i,
];

export function checkWindowTitle(title: string | undefined | null): ForbiddenZoneCheck {
  if (!title) return { allowed: true };
  for (const pat of FORBIDDEN_TITLE_PATTERNS) {
    if (pat.test(title)) {
      return { allowed: false, reason: `Forbidden window title for screen_act: "${title}"` };
    }
  }
  return { allowed: true };
}

/**
 * Canonical key token after collapsing nut-js / human aliases.
 * 'ctrl'/'control'/'LeftControl' → 'control', 'win'/'super'/'meta' → 'win', etc.
 */
export function normalizeKeyToken(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  if (['ctrl', 'control', 'leftcontrol', 'rightcontrol', 'lcontrol', 'rcontrol'].includes(k)) return 'control';
  if (['alt', 'leftalt', 'rightalt', 'lalt', 'ralt', 'altgr', 'rightaltgr'].includes(k)) return 'alt';
  if (['shift', 'leftshift', 'rightshift', 'lshift', 'rshift'].includes(k)) return 'shift';
  if (['win', 'super', 'leftsuper', 'rightsuper', 'meta', 'cmd', 'command', 'os', 'windows'].includes(k)) return 'win';
  if (['del', 'delete'].includes(k)) return 'delete';
  if (['esc', 'escape'].includes(k)) return 'escape';
  if (['return', 'enter'].includes(k)) return 'return';
  return k;
}

interface BlacklistedCombo {
  /** All of these normalized tokens must be present for the combo to match. */
  all: string[];
  reason: string;
}

/**
 * HARD blacklist of hotkey / key combinations that screen_act refuses outright.
 * These close the user's windows, lock the workstation, or switch context away
 * from the task — an agent pursuing a goal never legitimately needs them.
 * Unlike isDestructiveAction (gated by confirmation), this CANNOT be bypassed
 * by force_confirm. See incident 2026-05-16.
 */
const DESTRUCTIVE_HOTKEY_BLACKLIST: BlacklistedCombo[] = [
  { all: ['alt', 'f4'],                reason: 'Alt+F4 closes the active window — would close the user\'s windows.' },
  { all: ['control', 'w'],             reason: 'Ctrl+W closes the current tab/window.' },
  { all: ['control', 'f4'],            reason: 'Ctrl+F4 closes the current document/child window.' },
  { all: ['control', 'q'],             reason: 'Ctrl+Q quits the application.' },
  { all: ['control', 'shift', 'q'],    reason: 'Ctrl+Shift+Q quits the application.' },
  { all: ['win', 'l'],                 reason: 'Win+L locks the workstation.' },
  { all: ['win', 'd'],                 reason: 'Win+D shows the desktop, minimizing every window.' },
  { all: ['win', 'm'],                 reason: 'Win+M minimizes every window.' },
  { all: ['control', 'alt', 'delete'], reason: 'Ctrl+Alt+Delete triggers the secure attention sequence.' },
  { all: ['alt', 'tab'],               reason: 'Alt+Tab switches away from the task window (context change without progress).' },
];

/**
 * Return { blocked: true, reason } if the requested action uses a blacklisted
 * destructive hotkey. Checks both `hotkey` (simultaneous combo) and `keys`
 * (sequential) defensively — neither is ever a legitimate agent action.
 * force_confirm CANNOT override this; screen_act must refuse outright.
 */
export function checkDestructiveHotkey(args: {
  action: string;
  keys?: string[];
  hotkey?: string[];
}): { blocked: boolean; reason?: string } {
  const a = (args.action || '').toLowerCase();
  if (a !== 'hotkey' && a !== 'press_key') return { blocked: false };
  const raw = (args.hotkey && args.hotkey.length ? args.hotkey : args.keys) || [];
  if (raw.length === 0) return { blocked: false };
  const tokens = new Set(raw.map(normalizeKeyToken));
  for (const combo of DESTRUCTIVE_HOTKEY_BLACKLIST) {
    if (combo.all.every((t) => tokens.has(t))) {
      return { blocked: true, reason: `Blocked destructive hotkey — ${combo.reason}` };
    }
  }
  return { blocked: false };
}

/**
 * Return true if the requested action looks destructive and a confirmation must be shown.
 * Triggers on key sequences typically meaning "delete" or "close without saving".
 *
 * NOTE: window-closing / lock / context-switch combos (Alt+F4, Ctrl+W, Win+L…)
 * are NOT here — they are HARD-blocked by checkDestructiveHotkey above, which
 * cannot be bypassed. This function only covers confirmable intents.
 */
export function isDestructiveAction(args: {
  action: string;
  text?: string;
  keys?: string[];
  hotkey?: string[];
}): { destructive: boolean; reason?: string } {
  const a = (args.action || '').toLowerCase();

  // Direct destructive shortcuts
  const flatKeys = (args.hotkey || args.keys || []).map(k => String(k).toLowerCase());

  // Delete / Shift+Delete
  if (a === 'press_key' && flatKeys.includes('delete')) {
    return { destructive: true, reason: 'Delete key may remove a selected item.' };
  }
  if (a === 'hotkey' && flatKeys.includes('shift') && flatKeys.includes('delete')) {
    return { destructive: true, reason: 'Shift+Delete bypasses the recycle bin.' };
  }

  // Type contains "rm -rf", "format", "del /s"
  if (a === 'type' && args.text) {
    const t = args.text.toLowerCase();
    if (/\brm\s+-rf\b/.test(t) || /\bdel\s+\/s\b/.test(t) || /\bformat\b/.test(t)) {
      return { destructive: true, reason: `Typed text contains a destructive shell command pattern.` };
    }
  }

  return { destructive: false };
}
