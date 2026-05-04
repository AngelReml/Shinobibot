// desktop-obs-setup-scene — Node entry. obs-websocket v5 client using the
// built-in Node 22 `WebSocket` global. Implements the minimal subset:
//   - Hello / Identify (auth challenge)
//   - GetSceneList / CreateScene / SetCurrentProgramScene
//   - GetInputList / CreateInput
import { createHash } from 'node:crypto';
import { registerTool } from '../../../../src/tools/tool_registry.js';

let __WS = globalThis.WebSocket;

function authFor(password, salt, challenge) {
  const a = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(a + challenge).digest('base64');
}

class ObsClient {
  constructor(url, password) { this.url = url; this.password = password; this.id = 1; this.pending = new Map(); }
  async connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new __WS(this.url); }
      catch (e) { return reject(new Error(`websocket ctor failed: ${e?.message ?? e}`)); }
      this.ws = ws;
      const timer = setTimeout(() => { try { ws.close(); } catch {} ; reject(new Error('connection timeout')); }, timeoutMs);
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`ws error: ${e?.message ?? 'unknown'}`)); });
      ws.addEventListener('close', (e) => { clearTimeout(timer); reject(new Error(`ws closed before identified (code=${e.code})`)); });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.op === 0) {
          // Hello
          const auth = msg.d.authentication;
          const identifyData = { rpcVersion: msg.d.rpcVersion ?? 1 };
          if (auth) identifyData.authentication = authFor(this.password, auth.salt, auth.challenge);
          ws.send(JSON.stringify({ op: 1, d: identifyData }));
        } else if (msg.op === 2) {
          // Identified
          clearTimeout(timer);
          ws.removeEventListener('error', () => {});
          ws.removeEventListener('close', () => {});
          ws.addEventListener('message', (ev2) => this._onMessage(JSON.parse(ev2.data)));
          resolve();
        } else if (msg.op === 7) {
          this._onMessage(msg);
        }
      });
    });
  }
  _onMessage(msg) {
    if (msg.op !== 7) return;
    const id = msg.d.requestId;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (msg.d.requestStatus?.result) p.resolve(msg.d.responseData ?? {});
    else p.reject(new Error(msg.d.requestStatus?.comment ?? 'request failed'));
  }
  async request(requestType, requestData = {}) {
    const requestId = `r${this.id++}`;
    const op = { op: 6, d: { requestType, requestId, requestData } };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify(op));
      setTimeout(() => {
        if (this.pending.has(requestId)) { this.pending.delete(requestId); reject(new Error(`request ${requestType} timed out`)); }
      }, 10000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const tool = {
  name: 'desktop_obs_setup_scene',
  description: 'Create/configure an OBS scene with display + audio sources via obs-websocket. Idempotent.',
  parameters: {
    type: 'object',
    properties: {
      scene: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 4455 },
      password: { type: 'string', default: '' },
      display: { type: 'boolean', default: true },
      audio_output: { type: 'boolean', default: true },
      audio_input: { type: 'boolean', default: false },
      make_active: { type: 'boolean', default: true },
    },
    required: ['scene'],
  },
  async execute(args) {
    if (!args?.scene) return { success: false, output: '', error: 'scene required' };
    if (!__WS) return { success: false, output: '', error: 'global WebSocket missing (Node 22+ required)' };
    const url = `ws://${args.host ?? '127.0.0.1'}:${args.port ?? 4455}`;
    const c = new ObsClient(url, args.password ?? '');
    try {
      await c.connect();
      const scenes = await c.request('GetSceneList');
      const exists = (scenes.scenes ?? []).some((s) => s.sceneName === args.scene);
      let createdScene = false;
      if (!exists) {
        await c.request('CreateScene', { sceneName: args.scene });
        createdScene = true;
      }
      const inputs = await c.request('GetInputList', {});
      const existingNames = new Set((inputs.inputs ?? []).map((i) => i.inputName));
      const added = [];
      const present = [];
      const wanted = [];
      if (args.display ?? true) wanted.push({ kind: 'monitor_capture', name: `${args.scene} display`, settings: { method: 2 } });
      if (args.audio_output ?? true) wanted.push({ kind: 'wasapi_output_capture', name: `${args.scene} system audio`, settings: {} });
      if (args.audio_input) wanted.push({ kind: 'wasapi_input_capture', name: `${args.scene} mic`, settings: {} });
      for (const w of wanted) {
        if (existingNames.has(w.name)) { present.push(w.name); continue; }
        try {
          await c.request('CreateInput', { sceneName: args.scene, inputName: w.name, inputKind: w.kind, inputSettings: w.settings, sceneItemEnabled: true });
          added.push(w.name);
        } catch (e) {
          // If the kind is not available on this OBS install, log and continue.
          present.push(`${w.name} (skipped: ${e.message})`);
        }
      }
      let activeScene = null;
      if (args.make_active ?? true) {
        await c.request('SetCurrentProgramScene', { sceneName: args.scene });
        activeScene = args.scene;
      }
      c.close();
      return {
        success: true,
        output: JSON.stringify({ success: true, scene: args.scene, created_scene: createdScene, sources_added: added, sources_existing: present, active_scene: activeScene }),
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
