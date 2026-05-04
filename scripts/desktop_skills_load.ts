#!/usr/bin/env node
// Load each desktop skill bundle and assert it registers a tool with the
// expected name. Fails fast if any import error or registration mismatch.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd(), 'skills', 'desktop');
const expectedTools: Record<string, string> = {
  'desktop-excel-open-and-extract': 'desktop_excel_open_and_extract',
  'desktop-outlook-send-email': 'desktop_outlook_send_email',
  'desktop-premiere-basic-cut': 'desktop_premiere_basic_cut',
  'desktop-obs-setup-scene': 'desktop_obs_setup_scene',
  'desktop-photoshop-resize-export': 'desktop_photoshop_resize_export',
  'desktop-chrome-login-and-action': 'desktop_chrome_login_and_action',
  'desktop-obs-record-self': 'desktop_obs_record_self',
  'desktop-obs-stop-and-save': 'desktop_obs_stop_and_save',
};

let ok = 0;
let failed = 0;
for (const dir of Object.keys(expectedTools).sort()) {
  const skillJs = join(ROOT, dir, 'scripts', 'skill.mjs');
  try {
    const mod = await import(pathToFileURL(skillJs).href);
    const tool = mod.default;
    if (!tool || typeof tool !== 'object') throw new Error('default export not an object');
    if (tool.name !== expectedTools[dir]) throw new Error(`tool.name='${tool.name}' != expected '${expectedTools[dir]}'`);
    if (typeof tool.execute !== 'function') throw new Error('execute is not a function');
    if (!tool.parameters || typeof tool.parameters !== 'object') throw new Error('parameters missing');
    console.log(`  ✓ ${dir} -> ${tool.name}`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${dir}: ${e?.message ?? e}`);
    failed++;
  }
}
console.log(`\n[load] ${ok}/${ok + failed} bundles loadable`);
process.exit(failed ? 1 : 0);
