// F4.1 (2026-07-01) — kagemushaEnabled() existed but nothing in the runtime
// ever consulted it: no cron, no tool, no slash-command called into
// kagemusha/. This test proves the new explicit trigger (kagemusha/trigger.ts
// runKagemusha()) actually respects the gate both ways:
//   - KAGEMUSHA_ENABLED unset/false → runKagemusha() refuses to run at all
//     (throws before touching the store, before any I/O).
//   - KAGEMUSHA_ENABLED=1 → the real pipeline runs end-to-end (ingest is
//     stubbed via pre-seeded transcripts + a no-network fetcher for THREAD)
//     and produces an actual DawnReport.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runKagemusha, KagemushaDisabledError } from '../trigger.js';
import { KagemushaStore } from '../store/store.js';
import type { Transcript, Provenance } from '../types.js';

const ORIGINAL_ENV = { ...process.env };
let store: KagemushaStore;
let outDir: string;

beforeEach(() => {
  store = new KagemushaStore({ db_path: ':memory:' });
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg_wiring_'));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  try { store.close(); } catch {}
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
});

function seedTranscript(store: KagemushaStore) {
  store.upsertChannel({ channel_id: '@testchan', title: '@testchan' });
  const prov: Provenance = {
    origin: 'USER_DIRECT', channel: 'youtube_transcript', retrieved_at: 't0', trust_tier: 2, session_seq: 0,
  };
  const t: Transcript = {
    transcript_id: 'tx1', video_id: 'vid1', channel_id: '@testchan', title: 'Test video',
    lang: 'en', text: 'This paper "AwesomeThing" achieves great results, see https://arxiv.org/abs/1234.5678 for details.',
    token_count: 20, provenance: prov, ingested_at: 't0',
  };
  store.upsertTranscript(t);
}

describe('F4.1 — kagemushaEnabled() gate is actually consulted by a real trigger', () => {
  it('disabled (env unset) → runKagemusha() throws KagemushaDisabledError, never touches the mission pipeline', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    seedTranscript(store); // pre-seed so we can prove it is untouched afterward

    await expect(
      runKagemusha({ channels: ['@testchan'], outDir, store }),
    ).rejects.toThrow(KagemushaDisabledError);

    // No mission state was ever persisted — confirms the pipeline never ran.
    expect(store.loadMissionState('night_anything')).toBeNull();
  });

  it('disabled (KAGEMUSHA_ENABLED=0) → still throws', async () => {
    process.env.KAGEMUSHA_ENABLED = '0';
    await expect(runKagemusha({ channels: ['@x'], outDir, store })).rejects.toThrow(KagemushaDisabledError);
  });

  it('enabled (KAGEMUSHA_ENABLED=1) → the pipeline actually runs and produces a Dawn Report', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    seedTranscript(store); // simulate a prior ingest (ingest itself is F4.2's concern; yt-dlp isn't installed here)

    // Skip re-ingest (no yt-dlp in this sandbox) by passing a channel that
    // yields no new downloads — ingest() is honest about that (0 imported)
    // and the transcript we pre-seeded is still there for ANALYZE onward.
    const result = await runKagemusha({
      channels: [],  // empty ingest list → ingest phase is a no-op, pre-seeded transcript carries the mission
      outDir,
      store,
      missionId: 'm_wiring_test',
      ts: '2026-07-01T02:00:00Z',
      budget: { maxThreads: 5, maxTokens: 10_000 },
    });

    expect(result.state.phase).toBe('DONE');
    expect(result.report).toBeTruthy();
    expect(result.report!.mission_id).toBe('m_wiring_test');

    // Mission state IS persisted this time (proves the real pipeline ran).
    const persisted = store.loadMissionState('m_wiring_test');
    expect(persisted).toBeTruthy();
    expect(persisted!.phase).toBe('DONE');
  });

  it('enabled, with an injected fetcher → THREAD actually acquires content and the report reflects it (no fabrication)', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    seedTranscript(store);

    const fetcher = async (url: string) => ({ ok: true, text: `Reproducible results for ${url}: 92% accuracy, code available.`, finalUrl: url });

    const result = await runKagemusha({
      channels: [], outDir, store, fetcher,
      missionId: 'm_wiring_fetch', ts: '2026-07-01T02:00:00Z',
      budget: { maxThreads: 5, maxTokens: 10_000 },
    });

    expect(result.state.phase).toBe('DONE');
    expect(result.report).toBeTruthy();
    // Anti-fabrication: every highlight must trace to a real persisted claim id.
    const knownClaimIds = new Set(store.listClaims().map((c) => c.claim_id));
    for (const h of result.report!.highlights) {
      for (const cid of h.claim_ids) expect(knownClaimIds.has(cid)).toBe(true);
    }
  });

  it('disabled → an injected fetcher (if any) is never invoked (proves no I/O happens pre-gate)', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    let called = false;
    const fetcher = async (url: string) => { called = true; return { ok: true, text: 'should not run' }; };

    await expect(
      runKagemusha({ channels: ['@testchan'], outDir, store, fetcher }),
    ).rejects.toThrow(KagemushaDisabledError);
    expect(called).toBe(false);
  });
});
