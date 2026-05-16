/**
 * screen_act (B9): perform mouse / keyboard / scroll / hotkey actions.
 *
 * Restrictions (mandatory):
 *  - Refuse to act when the foreground window title points at /Windows, /System32, taskbar, system tray, UAC.
 *  - Refuse clicks inside the bottom 40px taskbar band.
 *  - HARD-refuse destructive hotkeys (Alt+F4, Ctrl+W, Ctrl+Q, Win+L, Alt+Tab…)
 *    that close windows, lock the machine, or switch context. Cannot be
 *    bypassed by `force_confirm` — see checkDestructiveHotkey + incident
 *    docs/incidents/2026-05-16_screen_act_hotkey_escape.md.
 *  - Confirmable destructive intents (Delete, Shift+Delete, typing
 *    "rm -rf"/"format"/"del /s") trigger an interactive CLI confirmation
 *    unless `force_confirm: true` is set by the caller (used in non-interactive mode).
 *  - ESC held >= 1 second aborts immediately (KillSwitch).
 */
import * as readline from 'readline';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { KillSwitch } from '../utils/kill_switch.js';
import {
  checkClickPosition,
  checkWindowTitle,
  checkDestructiveHotkey,
  isDestructiveAction,
} from '../utils/screen_safety.js';

type Action =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'move'
  | 'type'
  | 'press_key'
  | 'hotkey'
  | 'scroll';

interface ScreenActArgs {
  action: Action;
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];      // for press_key (single) or sequence
  hotkey?: string[];    // for combo: ['Control','S']
  scroll_amount?: number; // positive = down, negative = up
  scroll_direction?: 'up' | 'down';
  delay_ms?: number;
  force_confirm?: boolean; // skip CLI prompt on destructive (caller asserts they confirmed)
}

function askYesNo(question: string): Promise<boolean> {
  // Non-interactive runs: refuse by default.
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function resolveKey(nut: any, name: string): any {
  // Tolerant key lookup against nut-js Key enum (case-insensitive).
  if (!name) throw new Error('Empty key name');
  const exact = nut.Key[name];
  if (exact !== undefined) return exact;
  const lookup = name[0].toUpperCase() + name.slice(1).toLowerCase();
  if (nut.Key[lookup] !== undefined) return nut.Key[lookup];
  // Common aliases
  const aliases: Record<string, string> = {
    ctrl: 'LeftControl',
    control: 'LeftControl',
    alt: 'LeftAlt',
    shift: 'LeftShift',
    win: 'LeftSuper',
    cmd: 'LeftSuper',
    meta: 'LeftSuper',
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  };
  const alias = aliases[name.toLowerCase()];
  if (alias && nut.Key[alias] !== undefined) return nut.Key[alias];
  // single character
  if (name.length === 1) {
    const upper = name.toUpperCase();
    if (nut.Key[upper] !== undefined) return nut.Key[upper];
  }
  // function keys
  if (/^f\d{1,2}$/i.test(name)) {
    const fk = 'F' + name.slice(1);
    if (nut.Key[fk] !== undefined) return nut.Key[fk];
  }
  throw new Error(`Unknown key: ${name}`);
}

const screenActTool: Tool = {
  name: 'screen_act',
  description:
    'Perform a desktop UI action: click / double_click / right_click / move at (x,y), ' +
    'type a string, press_key, hotkey combo, or scroll. Coordinates are in pixels of the primary monitor. ' +
    'You MUST call screen_observe first to ground coordinates. Forbidden zones (taskbar bottom 40px, ' +
    'UAC dialog, /Windows /System32 windows) and destructive intents are blocked or gated by confirmation.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'double_click', 'right_click', 'move', 'type', 'press_key', 'hotkey', 'scroll'],
        description: 'What to do.',
      },
      x: { type: 'number', description: 'X coordinate in pixels (for click/double_click/right_click/move/scroll).' },
      y: { type: 'number', description: 'Y coordinate in pixels.' },
      text: { type: 'string', description: 'Text to type (for action=type).' },
      keys: {
        type: 'array', items: { type: 'string' },
        description: 'For action=press_key: a list of key names pressed sequentially (e.g. ["Return"]).',
      },
      hotkey: {
        type: 'array', items: { type: 'string' },
        description: 'For action=hotkey: combo to press together (e.g. ["Control","s"]).',
      },
      scroll_direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
      scroll_amount: { type: 'number', description: 'Number of scroll ticks (default 3).' },
      delay_ms: { type: 'number', description: 'Optional delay in ms after the action (default 200).' },
      force_confirm: { type: 'boolean', description: 'Caller has already confirmed; skip the CLI prompt for destructive actions.' },
    },
    required: ['action'],
  },

  requiresConfirmation(args: ScreenActArgs) {
    return isDestructiveAction(args).destructive;
  },

  async execute(args: ScreenActArgs): Promise<ToolResult> {
    KillSwitch.start();
    KillSwitch.reset();

    // Carga de nut-js protegida: si el binding nativo no está instalado, se
    // devuelve un ToolResult limpio en vez de reventar con un stack crudo.
    let nut: any;
    try {
      nut = await import('@nut-tree-fork/nut-js');
    } catch (e: any) {
      return { success: false, output: '', error: `screen_act no disponible: no se pudo cargar @nut-tree-fork/nut-js (${e?.message ?? e}).` };
    }
    const { mouse, keyboard, screen, Button, Point, Key } = nut;
    keyboard.config.autoDelayMs = 20;

    if (KillSwitch.shouldAbort()) {
      return { success: false, output: '', error: 'Kill switch (ESC held) — action aborted before start.' };
    }

    // Foreground window title check
    let activeTitle = '';
    try {
      const w = await nut.getActiveWindow();
      if (w) activeTitle = (await w.title) ?? '';
    } catch { /* nut.getActiveWindow can throw if none */ }
    const titleCheck = checkWindowTitle(activeTitle);
    if (!titleCheck.allowed) {
      return { success: false, output: '', error: `${titleCheck.reason} (active="${activeTitle}")` };
    }

    // HARD blacklist: destructive hotkeys (close window, lock, context switch).
    // Refused outright — force_confirm CANNOT bypass this. A stuck agent must
    // never close the user's windows to "recover". See incident
    // docs/incidents/2026-05-16_screen_act_hotkey_escape.md.
    const hotkeyCheck = checkDestructiveHotkey(args);
    if (hotkeyCheck.blocked) {
      return { success: false, output: '', error: hotkeyCheck.reason ?? 'Blocked destructive hotkey.' };
    }

    // Coordinate forbidden-zone check
    if (['click', 'double_click', 'right_click', 'move', 'scroll'].includes(args.action)) {
      if (typeof args.x !== 'number' || typeof args.y !== 'number') {
        return { success: false, output: '', error: `action=${args.action} requires numeric x,y.` };
      }
      const sw = await screen.width();
      const sh = await screen.height();
      const z = checkClickPosition(args.x, args.y, sw, sh);
      if (!z.allowed) return { success: false, output: '', error: z.reason };
    }

    // Destructive intent gate
    const destructive = isDestructiveAction(args);
    if (destructive.destructive && !args.force_confirm) {
      const ok = await askYesNo(`[Shinobi B9] Destructive action: ${destructive.reason} Proceed?`);
      if (!ok) return { success: false, output: '', error: `User declined destructive action: ${destructive.reason}` };
    }

    if (KillSwitch.shouldAbort()) {
      return { success: false, output: '', error: 'Kill switch (ESC held) — action aborted before execute.' };
    }

    try {
      switch (args.action) {
        case 'move':
          await mouse.move([new Point(args.x!, args.y!)]);
          break;
        case 'click':
          await mouse.move([new Point(args.x!, args.y!)]);
          await mouse.leftClick();
          break;
        case 'double_click':
          await mouse.move([new Point(args.x!, args.y!)]);
          await mouse.doubleClick(Button.LEFT);
          break;
        case 'right_click':
          await mouse.move([new Point(args.x!, args.y!)]);
          await mouse.rightClick();
          break;
        case 'type':
          if (!args.text) return { success: false, output: '', error: 'action=type requires text.' };
          await keyboard.type(args.text);
          break;
        case 'press_key': {
          if (!args.keys || args.keys.length === 0) {
            return { success: false, output: '', error: 'action=press_key requires keys[].' };
          }
          for (const k of args.keys) {
            const key = resolveKey(nut, k);
            await keyboard.pressKey(key);
            await keyboard.releaseKey(key);
          }
          break;
        }
        case 'hotkey': {
          if (!args.hotkey || args.hotkey.length === 0) {
            return { success: false, output: '', error: 'action=hotkey requires hotkey[].' };
          }
          const resolved = args.hotkey.map((k) => resolveKey(nut, k));
          for (const k of resolved) await keyboard.pressKey(k);
          for (const k of [...resolved].reverse()) await keyboard.releaseKey(k);
          break;
        }
        case 'scroll': {
          const dir = args.scroll_direction || 'down';
          const amount = Math.max(1, Math.floor(args.scroll_amount ?? 3));
          if (typeof args.x === 'number' && typeof args.y === 'number') {
            await mouse.move([new Point(args.x, args.y)]);
          }
          if (dir === 'down') await mouse.scrollDown(amount);
          else await mouse.scrollUp(amount);
          break;
        }
        default:
          return { success: false, output: '', error: `Unknown action: ${args.action}` };
      }
    } catch (e: any) {
      return { success: false, output: '', error: `screen_act execute failed: ${e.message}` };
    }

    if (KillSwitch.shouldAbort()) {
      return { success: false, output: '', error: 'Kill switch (ESC held) — action completed but loop should stop.' };
    }

    const wait = typeof args.delay_ms === 'number' ? args.delay_ms : 200;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    return { success: true, output: `OK action=${args.action} (window="${activeTitle}")` };
  },
};

registerTool(screenActTool);
export default screenActTool;
