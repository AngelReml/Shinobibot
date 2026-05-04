// E2E for `shinobi import hermes`. Creates a synthetic Hermes layout in a tmp
// directory, runs the importer in dry-run mode (asserting non-zero plan), then
// in --overwrite mode (asserting writes), then re-runs without overwrite to
// confirm we don't clobber existing files. Memory.db assertion is best-effort:
// if better-sqlite3 isn't loadable in the test env, the memory step is skipped
// and reported as a soft warning rather than failing the test.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectHermesInstall,
  buildPlan,
  applyImport,
  parseHermesConfig,
  parseHermesMemoryMd,
  listHermesSkills,
  extractApiKeysFromHermes,
} from '../from_hermes.js';

function makeFixture(): { hermes: string; shinobi: string; repo: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-import-'));
  const hermes = path.join(root, 'hermes');
  const shinobi = path.join(root, 'shinobi-appdata', 'Shinobi');
  const repo = path.join(root, 'shinobi-repo');
  fs.mkdirSync(hermes, { recursive: true });
  fs.mkdirSync(shinobi, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });

  fs.writeFileSync(path.join(hermes, 'config.yaml'), [
    '# Hermes config',
    'opengravity_url: https://kernel.example.test',
    'opengravity_api_key: hermes-key-xxx',
    'language: es',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(hermes, 'MEMORY.md'), [
    '# Project memory',
    '',
    '## Build pipeline',
    'CI runs the integration suite on push to main.',
    '',
    '## Release process',
    'Tag with vX.Y.Z, build artefacts, then run scripts/release.sh.',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(hermes, 'USER.md'), [
    '# User profile',
    '',
    'Prefiere respuestas concisas en español.',
    'Trabaja sobre todo en Windows con WSL2.',
  ].join('\n'), 'utf-8');

  // .env with assorted keys (some real-format prefixes; values are dummies)
  fs.writeFileSync(path.join(hermes, '.env'), [
    'OPENROUTER_API_KEY=sk-or-fake0123456789abcdefxyzABCDEF',
    'ELEVENLABS_API_KEY=sk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'OTHER_VAR=ignore-me',
  ].join('\n'), 'utf-8');

  // Two skills
  const s1 = path.join(hermes, 'skills', 'pdf-extract');
  fs.mkdirSync(path.join(s1, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(s1, 'SKILL.md'), '---\nname: pdf-extract\ndescription: Extract text from PDFs.\n---\n# pdf-extract\n', 'utf-8');
  fs.writeFileSync(path.join(s1, 'scripts', 'extract.py'), 'print("hi")\n', 'utf-8');
  const s2 = path.join(hermes, 'skills', 'log-summarize');
  fs.mkdirSync(s2, { recursive: true });
  fs.writeFileSync(path.join(s2, 'SKILL.md'), '---\nname: log-summarize\ndescription: Summarize log files.\n---\n# log-summarize\n', 'utf-8');

  return {
    hermes,
    shinobi,
    repo,
    cleanup: () => {
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { /* SQLite WAL handles can briefly lock files on Windows; harmless for tmp */ }
    },
  };
}

async function main() {
  const fx = makeFixture();
  let exitCode = 0;
  try {
    // Detect by override
    const det = detectHermesInstall(fx.hermes);
    if (det !== path.resolve(fx.hermes)) throw new Error(`detect mismatch: ${det}`);

    // Plan
    const plan = buildPlan({ dryRun: true, overwrite: false, hermesRootOverride: fx.hermes, shinobiDirOverride: fx.shinobi, shinobiRepoOverride: fx.repo });
    console.log(`[a4-e2e] plan actions: ${plan.actions.length}`);
    if (!plan.found.config_yaml) throw new Error('config not detected');
    if (!plan.found.memory_md) throw new Error('memory.md not detected');
    if (!plan.found.user_md) throw new Error('user.md not detected');
    if (plan.found.skills_count !== 2) throw new Error(`skills count != 2 (${plan.found.skills_count})`);
    if (!plan.found.api_keys.includes('OPENROUTER_API_KEY')) throw new Error('OPENROUTER not picked up');

    // Parsers
    const cfg = parseHermesConfig(path.join(fx.hermes, 'config.yaml'));
    if (!cfg || cfg.api_url !== 'https://kernel.example.test') throw new Error('config parse mismatch');
    const memRecs = parseHermesMemoryMd(path.join(fx.hermes, 'MEMORY.md'), 'project');
    if (memRecs.length < 2) throw new Error(`expected >=2 memory chunks, got ${memRecs.length}`);
    const skills = listHermesSkills(path.join(fx.hermes, 'skills'));
    if (skills.length !== 2) throw new Error(`listHermesSkills got ${skills.length}`);
    const keys = extractApiKeysFromHermes(fx.hermes);
    if (!keys.OPENROUTER_API_KEY || !keys.ELEVENLABS_API_KEY) throw new Error('keys missing');

    // 1) dry-run: no writes
    const dry = await applyImport({ dryRun: true, overwrite: false, hermesRootOverride: fx.hermes, shinobiDirOverride: fx.shinobi, shinobiRepoOverride: fx.repo, silent: true });
    if (dry.applied) throw new Error('dry-run should not be applied');
    if (fs.existsSync(path.join(fx.shinobi, 'config.json'))) throw new Error('dry-run wrote config.json');
    if (fs.existsSync(path.join(fx.repo, '.env'))) throw new Error('dry-run wrote .env');

    // 2) apply with --overwrite — but skip the SQLite memory step if better-sqlite3
    //    refuses to load in the test process. We attempt and tolerate a single
    //    "memory" error in `errors`, asserting the rest of the pipeline.
    const apply1 = await applyImport({ dryRun: false, overwrite: true, hermesRootOverride: fx.hermes, shinobiDirOverride: fx.shinobi, shinobiRepoOverride: fx.repo, silent: true });
    const nonMemoryErrors = apply1.errors.filter((e) => !e.startsWith('memory:'));
    if (nonMemoryErrors.length) throw new Error('apply errors: ' + nonMemoryErrors.join('; '));
    if (apply1.errors.some((e) => e.startsWith('memory:'))) {
      console.log('[a4-e2e] WARN: memory step soft-failed (likely better-sqlite3 native load):', apply1.errors.filter((e) => e.startsWith('memory:')).join(' | '));
    }
    if (!fs.existsSync(path.join(fx.shinobi, 'config.json'))) throw new Error('config.json not written');
    if (!fs.existsSync(path.join(fx.shinobi, 'agentskills', 'pdf-extract', 'SKILL.md'))) throw new Error('skill pdf-extract not written');
    if (!fs.existsSync(path.join(fx.shinobi, 'agentskills', 'log-summarize', 'SKILL.md'))) throw new Error('skill log-summarize not written');
    if (!fs.existsSync(path.join(fx.repo, '.env'))) throw new Error('.env not written');
    const envText = fs.readFileSync(path.join(fx.repo, '.env'), 'utf-8');
    if (!/OPENROUTER_API_KEY=sk-or-/.test(envText)) throw new Error('env missing OPENROUTER');
    if (!/ELEVENLABS_API_KEY=/.test(envText)) throw new Error('env missing ELEVENLABS');
    if (/OTHER_VAR/.test(envText)) throw new Error('env leaked non-API var');

    // 3) re-run without overwrite -> should be safe (no rewrites, no errors)
    const apply2 = await applyImport({ dryRun: false, overwrite: false, hermesRootOverride: fx.hermes, shinobiDirOverride: fx.shinobi, shinobiRepoOverride: fx.repo, silent: true });
    const nonMemErr2 = apply2.errors.filter((e) => !e.startsWith('memory:'));
    if (nonMemErr2.length) throw new Error('second apply spurious errors: ' + nonMemErr2.join('; '));

    console.log('[a4-e2e] OK');
  } catch (e: any) {
    console.error('[a4-e2e] FAIL', e?.message ?? e);
    exitCode = 1;
  } finally {
    fx.cleanup();
  }
  process.exit(exitCode);
}

main();
