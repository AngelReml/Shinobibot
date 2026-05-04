// Tiny obs-websocket v5 client for the desktop skills.
// Implements only the subset Shinobi uses:
//   - Hello / Identify (auth)
//   - GetSceneList / CreateScene / SetCurrentProgramScene
//   - GetInputList / CreateInput
//   - GetRecordStatus / StartRecord / StopRecord
//
// Pure stdlib: relies on globalThis.WebSocket from Node 22+. No npm deps.
import { createHash } from 'node:crypto';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string };

export interface ObsClientOptions {
  host?: string;
  port?: number;
  password?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const __WS: typeof WebSocket | undefined = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

export class ObsClient {
  private url: string;
  private password: string;
  private connectTimeoutMs: number;
  private requestTimeoutMs: number;
  private ws?: WebSocket;
  private id = 1;
  private pending = new Map<string, Pending>();
  private connected = false;

  constructor(opts: ObsClientOptions = {}) {
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 4455;
    this.url = `ws://${host}:${port}`;
    this.password = opts.password ?? '';
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10000;
  }

  async connect(): Promise<void> {
    if (!__WS) throw new Error('global WebSocket missing — Node 22+ required');
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new __WS!(this.url);
      } catch (e) {
        return reject(new Error(`websocket ctor failed: ${(e as Error)?.message ?? e}`));
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`connect timeout (${this.url})`));
      }, this.connectTimeoutMs);
      ws.addEventListener('error', () => {
        if (!this.connected) {
          clearTimeout(timer);
          reject(new Error(`obs-websocket error connecting to ${this.url}`));
        }
      });
      ws.addEventListener('close', (ev) => {
        if (!this.connected) {
          clearTimeout(timer);
          reject(new Error(`obs closed before identified (code=${(ev as CloseEvent).code})`));
        }
      });
      ws.addEventListener('message', (ev) => {
        let msg: { op: number; d: Record<string, unknown> };
        try {
          msg = JSON.parse((ev as MessageEvent).data as string);
        } catch {
          return;
        }
        if (msg.op === 0) {
          // Hello
          const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
          const data: Record<string, unknown> = { rpcVersion: msg.d.rpcVersion ?? 1 };
          if (auth) {
            const a = createHash('sha256').update(this.password + auth.salt).digest('base64');
            data.authentication = createHash('sha256').update(a + auth.challenge).digest('base64');
          }
          ws.send(JSON.stringify({ op: 1, d: data }));
        } else if (msg.op === 2) {
          this.connected = true;
          clearTimeout(timer);
          resolve();
        } else if (msg.op === 7) {
          this.handleResponse(msg.d as { requestId?: string; requestStatus?: { result?: boolean; comment?: string }; responseData?: unknown });
        }
      });
    });
  }

  private handleResponse(d: { requestId?: string; requestStatus?: { result?: boolean; comment?: string }; responseData?: unknown }): void {
    const id = d.requestId;
    if (!id) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (d.requestStatus?.result) p.resolve(d.responseData ?? {});
    else p.reject(new Error(`${p.method} failed: ${d.requestStatus?.comment ?? 'unknown'}`));
  }

  async request<T = Record<string, unknown>>(requestType: string, requestData: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || !this.connected) throw new Error('not connected');
    const requestId = `r${this.id++}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, method: requestType });
      this.ws!.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`${requestType} timeout`));
        }
      }, this.requestTimeoutMs);
    });
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.connected = false;
  }

  // ------ high-level helpers used by H1 / H2 ------

  async ensureScene(sceneName: string, sources: Array<{ kind: string; name: string; settings?: Record<string, unknown> }>): Promise<{ created: boolean; added: string[]; existing: string[] }> {
    const scenes = await this.request<{ scenes: Array<{ sceneName: string }> }>('GetSceneList');
    const exists = scenes.scenes.some((s) => s.sceneName === sceneName);
    let created = false;
    if (!exists) {
      await this.request('CreateScene', { sceneName });
      created = true;
    }
    const inputs = await this.request<{ inputs: Array<{ inputName: string }> }>('GetInputList', {});
    const have = new Set(inputs.inputs.map((i) => i.inputName));
    const added: string[] = [];
    const existing: string[] = [];
    for (const src of sources) {
      if (have.has(src.name)) {
        existing.push(src.name);
        continue;
      }
      try {
        await this.request('CreateInput', {
          sceneName,
          inputName: src.name,
          inputKind: src.kind,
          inputSettings: src.settings ?? {},
          sceneItemEnabled: true,
        });
        added.push(src.name);
      } catch (e) {
        existing.push(`${src.name} (skipped: ${(e as Error).message})`);
      }
    }
    return { created, added, existing };
  }

  async startRecording(): Promise<{ outputActive: boolean }> {
    const status = await this.request<{ outputActive: boolean; outputPath?: string }>('GetRecordStatus');
    if (status.outputActive) return { outputActive: true };
    await this.request('StartRecord');
    return { outputActive: true };
  }

  async stopRecording(): Promise<{ outputPath: string | null }> {
    const status = await this.request<{ outputActive: boolean; outputPath?: string }>('GetRecordStatus');
    if (!status.outputActive) return { outputPath: null };
    const r = await this.request<{ outputPath?: string }>('StopRecord');
    return { outputPath: r.outputPath ?? null };
  }
}
