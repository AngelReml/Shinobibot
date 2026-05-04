// desktop-chrome-login-and-action — Node entry. Drives Chrome via CDP using
// only native WebSocket + fetch (no external dep).
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const __WS = globalThis.WebSocket;

function findChromeExe() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
function defaultProfileDir() { return join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(wsUrl) { this.url = wsUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new __WS(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(new Error(`cdp ws error: ${e?.message ?? 'unknown'}`)));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: r, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message ?? 'cdp error'));
          else r(msg.result);
        }
      });
    });
  }
  async send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timeout`)); } }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

function isPasswordSelector(sel) { return /\[type=["']?password["']?\]/i.test(sel ?? '') || /\bpassword\b/i.test(sel ?? ''); }

const tool = {
  name: 'desktop_chrome_login_and_action',
  description: 'Drive an existing Chrome profile via CDP. Reuses logged-in sessions. Windows.',
  parameters: {
    type: 'object',
    properties: {
      actions: { type: 'array', items: { type: 'object' } },
      port: { type: 'number', default: 9222 },
      profile_dir: { type: 'string' },
      keep_open: { type: 'boolean', default: false },
      timeout_ms: { type: 'number', default: 60000 },
    },
    required: ['actions'],
  },
  async execute(args) {
    if (!Array.isArray(args?.actions) || args.actions.length === 0) return { success: false, output: '', error: 'actions[] required' };
    if (process.platform !== 'win32') return { success: false, output: '', error: 'Windows-only skill' };
    if (!__WS) return { success: false, output: '', error: 'global WebSocket missing (Node 22+ required)' };
    const exe = findChromeExe();
    if (!exe) return { success: false, output: '', error: 'chrome.exe not found' };
    const port = args.port ?? 9222;
    const profile = args.profile_dir ?? defaultProfileDir();

    const child = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' });
    child.unref();

    // Poll until CDP /json/version is up
    let target = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) {
          const targets = await fetch(`http://127.0.0.1:${port}/json`).then((x) => x.json());
          target = targets.find((t) => t.type === 'page') ?? targets[0];
          if (target?.webSocketDebuggerUrl) break;
        }
      } catch {}
      await sleep(250);
    }
    if (!target?.webSocketDebuggerUrl) {
      try { process.kill(-child.pid); } catch {}
      return { success: false, output: '', error: 'CDP not reachable on port ' + port };
    }

    const cdp = new Cdp(target.webSocketDebuggerUrl);
    const log = [];
    const extracts = {};
    const screenshots = [];
    try {
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      const deadline = Date.now() + (args.timeout_ms ?? 60_000);

      for (const [i, step] of args.actions.entries()) {
        if (Date.now() > deadline) throw new Error(`timeout after step ${i}`);
        switch (step.type) {
          case 'goto':
            await cdp.send('Page.navigate', { url: step.url });
            log.push({ step: i, type: 'goto', url: step.url });
            await sleep(step.wait_ms ?? 800);
            break;
          case 'wait': {
            const ms = step.ms ?? 5000;
            const start = Date.now();
            // poll querySelector
            while (Date.now() - start < ms) {
              const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(step.selector)}) !== null`, returnByValue: true });
              if (r.result?.value === true) break;
              await sleep(120);
            }
            log.push({ step: i, type: 'wait', selector: step.selector });
            break;
          }
          case 'click':
            await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(step.selector)})?.click()` });
            log.push({ step: i, type: 'click', selector: step.selector });
            break;
          case 'type':
            // Set the value directly + dispatch input event. Avoids per-key timing.
            await cdp.send('Runtime.evaluate', {
              expression: `(()=>{const el=document.querySelector(${JSON.stringify(step.selector)});if(!el)return false;el.focus();el.value=${JSON.stringify(step.text ?? '')};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
            });
            log.push({ step: i, type: 'type', selector: step.selector, text: isPasswordSelector(step.selector) ? '<redacted>' : step.text });
            break;
          case 'eval': {
            const r = await cdp.send('Runtime.evaluate', { expression: step.expression, returnByValue: true });
            if (step.as) extracts[step.as] = r.result?.value ?? null;
            log.push({ step: i, type: 'eval' });
            break;
          }
          case 'extract': {
            const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(step.selector)})?.innerText ?? null`, returnByValue: true });
            extracts[step.as ?? step.selector] = r.result?.value ?? null;
            log.push({ step: i, type: 'extract', selector: step.selector });
            break;
          }
          case 'screenshot': {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            const buf = Buffer.from(shot.data, 'base64');
            writeFileSync(step.path, buf);
            screenshots.push(step.path);
            log.push({ step: i, type: 'screenshot', path: step.path });
            break;
          }
          default:
            log.push({ step: i, type: step.type, error: 'unknown step type' });
        }
      }
      cdp.close();
      if (!args.keep_open) {
        try { process.kill(child.pid); } catch {}
      }
      return { success: true, output: JSON.stringify({ success: true, steps: args.actions.length, extracts, screenshots, log }), error: '' };
    } catch (e) {
      cdp.close();
      try { if (!args.keep_open) process.kill(child.pid); } catch {}
      return { success: false, output: '', error: e?.message ?? String(e) };
    }
  },
};

registerTool(tool);
export default tool;
