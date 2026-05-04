// desktop-obs-stop-and-save — Node entry. Reuses ObsClient.
import { existsSync, statSync, openSync, closeSync } from 'node:fs';
import { ObsClient } from '../../../../src/skills_runtime/obs_client.ts';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFileReady(path, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (existsSync(path)) {
      try {
        const size = statSync(path).size;
        if (size > 0) {
          // Try a non-blocking append+close to confirm OBS released the handle.
          const fd = openSync(path, 'a');
          closeSync(fd);
          return { ok: true, size };
        }
      } catch { /* still locked */ }
    }
    await sleep(250);
  }
  return { ok: false, size: existsSync(path) ? statSync(path).size : 0 };
}

const tool = {
  name: 'desktop_obs_stop_and_save',
  description: 'Stop the active OBS recording and wait until the MP4 is closed and writable.',
  parameters: {
    type: 'object',
    properties: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 4455 },
      password: { type: 'string', default: '' },
      wait_close_ms: { type: 'number', default: 8000 },
    },
  },
  async execute(args = {}) {
    const c = new ObsClient({ host: args.host, port: args.port, password: args.password });
    try {
      await c.connect();
    } catch (e) {
      return { success: false, output: '', error: `obs-websocket unreachable: ${e.message}` };
    }
    try {
      const status = await c.request('GetRecordStatus');
      if (!status.outputActive) {
        c.close();
        return { success: true, output: JSON.stringify({ success: true, stopped: false, output_path: null }), error: '' };
      }
      const r = await c.request('StopRecord');
      const path = r.outputPath ?? null;
      c.close();
      if (!path) return { success: false, output: '', error: 'StopRecord returned no outputPath' };
      const ready = await waitForFileReady(path, args.wait_close_ms ?? 8000);
      return {
        success: true,
        output: JSON.stringify({
          success: true,
          stopped: true,
          output_path: path,
          size_bytes: ready.size,
          still_locked: !ready.ok,
        }),
        error: '',
      };
    } catch (e) {
      c.close();
      return { success: false, output: '', error: e?.message ?? String(e) };
    }
  },
};

registerTool(tool);
export default tool;
