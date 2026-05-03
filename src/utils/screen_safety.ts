/**
 * Screen safety (B9):
 *  - forbidden zones: taskbar, system tray, UAC dialog area, /Windows /System32 windows
 *  - destructive intent detection (close-without-save, delete)
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
 * Return true if the requested action looks destructive and a confirmation must be shown.
 * Triggers on key sequences typically meaning "delete" or "close without saving".
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
  const combo = flatKeys.join('+');

  // Alt+F4 (close window) — possible close-without-save
  if (a === 'hotkey' && flatKeys.includes('alt') && flatKeys.includes('f4')) {
    return { destructive: true, reason: 'Alt+F4 closes the active window; if a document is unsaved this may discard changes.' };
  }
  // Ctrl+W close tab
  if (a === 'hotkey' && flatKeys.includes('control') && flatKeys.includes('w')) {
    return { destructive: true, reason: 'Ctrl+W closes the current tab/document.' };
  }
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
