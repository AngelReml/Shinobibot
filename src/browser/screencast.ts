// src/browser/screencast.ts
// Streaming de la pantalla del navegador controlado vía CDP Page.startScreencast.
// Emite frames JPEG (base64) por un EventEmitter con throttle de FPS para que el
// panel del WebChat los consuma. Ver docs/BROWSER_SUBSYSTEM.md §2 y §6.

import { EventEmitter } from 'events';
import type { KageSession } from './session.js';

export interface ScreencastFrame {
  /** JPEG en base64 (sin prefijo data:). */
  dataB64: string;
  /** marca temporal de emisión. */
  ts: number;
}

class ScreencastHub extends EventEmitter {
  private active = false;
  private lastEmit = 0;

  isActive(): boolean { return this.active; }

  async start(session: KageSession): Promise<{ ok: boolean; error?: string }> {
    if (this.active) return { ok: true };
    const cdp = session.getCDP();
    if (!cdp) return { ok: false, error: 'CDP no disponible para screencast.' };

    const quality = Number(process.env.KAGE_SCREENCAST_QUALITY) || 60;
    const maxFps = Number(process.env.KAGE_SCREENCAST_MAX_FPS) || 4;
    const minIntervalMs = Math.max(1, Math.floor(1000 / maxFps));

    cdp.on('Page.screencastFrame', async (params: any) => {
      // ACK siempre (si no, Chromium deja de mandar frames).
      try { await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }); } catch { /* ignore */ }
      const now = Date.now();
      if (now - this.lastEmit < minIntervalMs) return; // throttle
      this.lastEmit = now;
      const frame: ScreencastFrame = { dataB64: params.data, ts: now };
      this.emit('frame', frame);
    });

    try {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      });
      this.active = true;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  async stop(session: KageSession): Promise<void> {
    if (!this.active) return;
    const cdp = session.getCDP();
    if (cdp) { try { await cdp.send('Page.stopScreencast'); } catch { /* ignore */ } }
    this.active = false;
  }
}

let _hub: ScreencastHub | null = null;

export function screencastHub(): ScreencastHub {
  if (!_hub) _hub = new ScreencastHub();
  return _hub;
}
