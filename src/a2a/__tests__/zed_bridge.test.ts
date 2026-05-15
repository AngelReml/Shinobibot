import { describe, it, expect } from 'vitest';
import { ZedBridge, SHINOBI_ZED_CAPS } from '../zed_bridge.js';
import { A2ADispatcher } from '../protocol.js';

describe('ZedBridge.handleLine', () => {
  it('initialize devuelve capabilities y protocolVersion', async () => {
    const bridge = new ZedBridge({ selfId: 'shinobi' });
    const resp = await bridge.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
    }));
    expect(resp).toMatchObject({
      jsonrpc: '2.0', id: 1,
      result: { protocolVersion: 'acp/1', agent: 'shinobi', capabilities: SHINOBI_ZED_CAPS },
    });
  });

  it('JSON inválido → parse error -32700', async () => {
    const bridge = new ZedBridge();
    const resp = await bridge.handleLine('{not-json');
    expect((resp as any).error.code).toBe(-32700);
  });

  it('request inválido (sin method) → -32600', async () => {
    const bridge = new ZedBridge();
    const resp = await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
    expect((resp as any).error.code).toBe(-32600);
  });

  it('método no soportado por ACP → -32601', async () => {
    const bridge = new ZedBridge();
    bridge['dispatcher'] = new A2ADispatcher({ selfId: 'shinobi' });
    const resp = await bridge.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'random/method',
    }));
    expect((resp as any).error.code).toBe(-32601);
  });

  it('sin dispatcher → -32000', async () => {
    const bridge = new ZedBridge();
    const resp = await bridge.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'session/prompt',
    }));
    expect((resp as any).error.code).toBe(-32000);
  });

  it('session/prompt llega al dispatcher con handler real', async () => {
    const dispatcher = new A2ADispatcher({ selfId: 'shinobi' });
    dispatcher.on('capability_invoke', async (env) => ({
      result: { text: 'eco: ' + (env.payload as any).acpParams.text },
    }));
    const bridge = new ZedBridge();
    bridge['dispatcher'] = dispatcher;
    const resp = await bridge.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'session/prompt',
      params: { text: 'hola' },
    }));
    expect((resp as any).result.text).toBe('eco: hola');
  });

  it('session/new llega como mission_handoff', async () => {
    const dispatcher = new A2ADispatcher({ selfId: 'shinobi' });
    dispatcher.on('mission_handoff', async () => ({ result: { sessionId: 'sess_42' } }));
    const bridge = new ZedBridge();
    bridge['dispatcher'] = dispatcher;
    const resp = await bridge.handleLine(JSON.stringify({
      jsonrpc: '2.0', id: 'init', method: 'session/new',
    }));
    expect((resp as any).result.sessionId).toBe('sess_42');
  });
});

describe('ZedBridge.serveStdio', () => {
  it('procesa líneas de stdin y escribe a stdout', async () => {
    const { Readable, Writable } = await import('stream');
    const stdinChunks = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { text: 'hi' } }) + '\n',
    ];
    let stdinIdx = 0;
    const stdin = new Readable({
      read() {
        if (stdinIdx < stdinChunks.length) {
          this.push(stdinChunks[stdinIdx++]);
        } else {
          this.push(null);
        }
      },
    });
    const out: string[] = [];
    const stdout = new Writable({
      write(chunk, _enc, cb) { out.push(chunk.toString()); cb(); },
    });
    const stderr = new Writable({ write(_chunk, _enc, cb) { cb(); } });

    const dispatcher = new A2ADispatcher({ selfId: 'shinobi' });
    dispatcher.on('capability_invoke', async (env) => ({
      result: { reply: (env.payload as any).acpParams.text },
    }));

    const bridge = new ZedBridge({ stdin: stdin as any, stdout: stdout as any, stderr: stderr as any });
    await bridge.serveStdio(dispatcher);

    expect(out.length).toBe(2);
    const r1 = JSON.parse(out[0]);
    expect(r1.id).toBe(1);
    expect(r1.result.protocolVersion).toBe('acp/1');
    const r2 = JSON.parse(out[1]);
    expect(r2.id).toBe(2);
    expect(r2.result.reply).toBe('hi');
  });

  it('línea vacía no produce response', async () => {
    const bridge = new ZedBridge();
    const r = await bridge.handleLine('');
    // No throw, no produce response útil — devuelve parse error.
    expect((r as any)?.error?.code).toBe(-32700);
  });
});

describe('SHINOBI_ZED_CAPS', () => {
  it('declara capabilities IDE-relevantes', () => {
    expect(SHINOBI_ZED_CAPS.fileAttachments).toBe(true);
    expect(SHINOBI_ZED_CAPS.cancellation).toBe(true);
    expect(SHINOBI_ZED_CAPS.toolVisibility).toBe(true);
  });
});
