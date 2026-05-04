// desktop-obs-record-self — Node entry. Reuses src/skills_runtime/obs_client.ts.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ObsClient } from '../../../../src/skills_runtime/obs_client.ts';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const OBS_PATHS = [
  'C:/Program Files/obs-studio/bin/64bit/obs64.exe',
  'C:/Program Files (x86)/obs-studio/bin/64bit/obs64.exe',
];

function findObsExe() {
  for (const p of OBS_PATHS) if (existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryConnect(opts, withRetry) {
  for (let i = 0; i < (withRetry ? 24 : 1); i++) {
    const c = new ObsClient(opts);
    try { await c.connect(); return c; }
    catch { c.close(); if (!withRetry) throw new Error('obs-websocket unreachable'); await sleep(500); }
  }
  throw new Error('obs-websocket unreachable after retries');
}

const tool = {
  name: 'desktop_obs_record_self',
  description: 'Ensure OBS scene Shinobi Self-Recording is configured and start recording. Idempotent.',
  parameters: {
    type: 'object',
    properties: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 4455 },
      password: { type: 'string', default: '' },
      auto_launch: { type: 'boolean', default: true },
      with_microphone: { type: 'boolean', default: false },
      scene: { type: 'string', default: 'Shinobi Self-Recording' },
    },
  },
  async execute(args = {}) {
    const opts = { host: args.host, port: args.port, password: args.password ?? '' };
    let client;
    try {
      client = await tryConnect(opts, false);
    } catch {
      if (args.auto_launch === false) return { success: false, output: '', error: 'OBS not reachable; auto_launch disabled' };
      const exe = findObsExe();
      if (!exe) return { success: false, output: '', error: `obs64.exe not found in: ${OBS_PATHS.join(' | ')}` };
      const child = spawn(exe, ['--minimize-to-tray'], { detached: true, stdio: 'ignore' });
      child.unref();
      try {
        client = await tryConnect(opts, true);
      } catch (e) {
        return { success: false, output: '', error: `OBS launched but obs-websocket still unreachable: ${e.message}` };
      }
    }
    try {
      const sceneName = args.scene ?? 'Shinobi Self-Recording';
      const sources = [
        { kind: 'monitor_capture', name: `${sceneName} display`, settings: { method: 2 } },
        { kind: 'wasapi_output_capture', name: `${sceneName} system audio` },
      ];
      if (args.with_microphone) sources.push({ kind: 'wasapi_input_capture', name: `${sceneName} mic` });
      const ensured = await client.ensureScene(sceneName, sources);
      await client.request('SetCurrentProgramScene', { sceneName });
      const status = await client.request('GetRecordStatus');
      let started_at = null;
      if (!status.outputActive) {
        await client.startRecording();
        started_at = new Date().toISOString();
      }
      client.close();
      return {
        success: true,
        output: JSON.stringify({
          success: true,
          scene: sceneName,
          scene_created: ensured.created,
          sources_added: ensured.added,
          sources_existing: ensured.existing,
          recording: true,
          started_at,
        }),
        error: '',
      };
    } catch (e) {
      client.close();
      return { success: false, output: '', error: e?.message ?? String(e) };
    }
  },
};

registerTool(tool);
export default tool;
