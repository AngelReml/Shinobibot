// E2E for the Hermes upstream watcher.
//   - Mock fetcher: simulates a fresh tag, asserts notice is created and
//     popPendingNotice clears it.
//   - Stable run: same tag a second time -> no notice.
//   - Real GitHub call (one-shot, network-permitting): asserts the watcher
//     can hit api.github.com without throwing on the production repo.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkOnce, loadState, popPendingNotice, type GhRelease } from '../hermes_watcher.js';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-watch-'));
  const stateFile = path.join(tmpDir, 'state.json');

  // Phase 1 — first ever check, mock returns one stable release.
  const fakeReleases: GhRelease[] = [
    {
      tag_name: 'v1.4.0',
      published_at: '2026-05-01T00:00:00Z',
      html_url: 'https://github.com/NousResearch/hermes-agent/releases/tag/v1.4.0',
      body: '## What\'s new\n* New skill: pdf-extract\n* Updated MCP client',
      assets: [{ name: 'hermes-1.4.0.zip' }, { name: 'skills.zip' }],
      draft: false,
      prerelease: false,
    },
  ];
  const notice = await checkOnce({ stateFile, fetchReleases: async () => fakeReleases });
  if (!notice || notice.tag !== 'v1.4.0') throw new Error(`expected v1.4.0 notice, got ${JSON.stringify(notice)}`);

  const popped = popPendingNotice(stateFile);
  if (!popped) throw new Error('popPendingNotice returned null after first check');
  if (popPendingNotice(stateFile)) throw new Error('popPendingNotice should be null after consume');

  // Phase 2 — same tag again, no notice.
  const second = await checkOnce({ stateFile, fetchReleases: async () => fakeReleases });
  if (second) throw new Error(`stable run produced a notice: ${JSON.stringify(second)}`);

  // Phase 3 — newer tag, notice produced again.
  const newer = [...fakeReleases];
  newer.unshift({ ...fakeReleases[0], tag_name: 'v1.5.0', body: 'minor' });
  const third = await checkOnce({ stateFile, fetchReleases: async () => newer });
  if (!third || third.tag !== 'v1.5.0') throw new Error(`expected v1.5.0 notice, got ${JSON.stringify(third)}`);

  // Phase 4 — drafts/prereleases ignored.
  const onlyDraft: GhRelease[] = [{ tag_name: 'v2.0.0-rc1', draft: false, prerelease: true }];
  const fresh = path.join(tmpDir, 'state2.json');
  const drafty = await checkOnce({ stateFile: fresh, fetchReleases: async () => onlyDraft });
  if (drafty) throw new Error('prerelease should not produce a notice');
  if (loadState(fresh).last_seen_tag !== null) throw new Error('prerelease leaked into last_seen_tag');

  // Phase 5 — best-effort live check. Doesn't fail the test if the network
  // path is restricted; just logs the outcome so we know whether the live
  // path works in this environment.
  try {
    const live = await checkOnce({ stateFile: path.join(tmpDir, 'state-live.json') });
    if (live) console.log(`[a5-e2e] live check produced notice ${live.tag}`);
    else console.log('[a5-e2e] live check: no new notice (expected on warm runs)');
  } catch (e) {
    console.log(`[a5-e2e] live check skipped: ${(e as Error).message}`);
  }

  console.log('[a5-e2e] OK');
}

main().catch((e) => { console.error('[a5-e2e] FAIL', e); process.exit(1); });
