#!/usr/bin/env node
// A2.2 — migrate %APPDATA%/Shinobi/approved_skills/<id>.mjs files into the
// agentskills.io directory layout, side-by-side, without deleting the originals.
//
// Behavior:
//   1. Always create a tarball-equivalent backup at
//      %APPDATA%/Shinobi/approved_skills.backup-<UTC-stamp>/ before touching anything.
//      If the backup step fails for ANY reason, abort with non-zero exit code.
//   2. For each .mjs in approved_skills/, parse the registerTool(...) call to
//      extract name (snake_case) and description.
//   3. Emit %APPDATA%/Shinobi/agentskills/<kebab-name>/ with:
//        SKILL.md           (frontmatter + body referencing scripts/skill.mjs)
//        scripts/skill.mjs  (verbatim copy of the original .mjs)
//        .shinobi/manifest.json
//   4. Print a summary to stdout. Idempotent: re-running re-emits.
//
// Run with: node scripts/migrate_approved_skills_to_agentskills.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DRY = process.argv.includes('--dry-run');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const SRC = path.join(APPDATA, 'Shinobi', 'approved_skills');
const DEST = path.join(APPDATA, 'Shinobi', 'agentskills');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(APPDATA, 'Shinobi', `approved_skills.backup-${STAMP}`);

function fail(msg) {
  console.error(`[migrate] FATAL: ${msg}`);
  process.exit(1);
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function snakeToKebab(name) {
  return name.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function parseSkill(file, content) {
  // Extract `name: '...'` and `description: '...'` from the registerTool object literal.
  const nameMatch = content.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/);
  const descMatch = content.match(/\bdescription\s*:\s*['"`]([^'"`]+)['"`]/);
  return {
    legacy_name: nameMatch?.[1] ?? path.basename(file, '.mjs'),
    description: descMatch?.[1] ?? 'No description available.',
  };
}

function emitSkillMd(meta, kebab, originalFilename) {
  const fm = [
    '---',
    `name: ${kebab}`,
    `description: ${meta.description.replace(/\r?\n/g, ' ').slice(0, 1024)}`,
    `compatibility: Requires Shinobi runtime (Node 20+ ESM, registerTool API)`,
    'metadata:',
    '  shinobi.engine: node-mjs',
    `  shinobi.legacy_name: ${meta.legacy_name}`,
    `  shinobi.source_file: ${originalFilename}`,
    `  shinobi.migrated_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${kebab}`,
    '',
    meta.description,
    '',
    '## Usage',
    '',
    'This skill was migrated from a Shinobi `.mjs` tool. Run via the Shinobi runtime, which loads `scripts/skill.mjs` and registers it through the in-process tool registry.',
    '',
    'See [`scripts/skill.mjs`](scripts/skill.mjs) for the implementation.',
    '',
  ];
  return fm.join('\n');
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.log(`[migrate] no approved_skills directory at ${SRC} — nothing to migrate`);
    return;
  }
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.mjs'));
  console.log(`[migrate] found ${files.length} .mjs skills in ${SRC}`);

  // 1. Backup (mandatory)
  if (!DRY) {
    try {
      copyDirSync(SRC, BACKUP);
      // sanity verify
      const beforeCount = files.length;
      const afterCount = fs.readdirSync(BACKUP).filter((f) => f.endsWith('.mjs')).length;
      if (beforeCount !== afterCount) fail(`backup incomplete: ${afterCount}/${beforeCount} files copied`);
      console.log(`[migrate] backup OK at ${BACKUP}`);
    } catch (e) {
      fail(`backup failed: ${e?.message ?? e}`);
    }
  } else {
    console.log(`[dry-run] would back up ${SRC} -> ${BACKUP}`);
  }

  if (!DRY && !fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

  const summary = [];
  for (const file of files) {
    const abs = path.join(SRC, file);
    const content = fs.readFileSync(abs, 'utf-8');
    const meta = parseSkill(file, content);
    const kebab = snakeToKebab(meta.legacy_name).slice(0, 64) || `skill-${path.basename(file, '.mjs').slice(-6)}`;
    const skillDir = path.join(DEST, kebab);

    if (DRY) {
      console.log(`[dry-run] would emit ${skillDir} (legacy_name=${meta.legacy_name})`);
      summary.push({ file, kebab, legacy_name: meta.legacy_name, dry: true });
      continue;
    }

    fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(skillDir, '.shinobi'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), emitSkillMd(meta, kebab, file), 'utf-8');
    fs.writeFileSync(path.join(skillDir, 'scripts', 'skill.mjs'), content, 'utf-8');
    fs.writeFileSync(
      path.join(skillDir, '.shinobi', 'manifest.json'),
      JSON.stringify(
        {
          schema_version: '1.1',
          name: kebab,
          legacy_name: meta.legacy_name,
          description: meta.description,
          engine: 'node-mjs',
          source_file: file,
          migrated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
    summary.push({ file, kebab, legacy_name: meta.legacy_name, emitted: skillDir });
    console.log(`[migrate] ${file}  ->  ${skillDir}`);
  }

  console.log(`\n=== migration summary ===`);
  console.log(JSON.stringify({ count: summary.length, dry_run: DRY, backup: DRY ? null : BACKUP, items: summary }, null, 2));
}

main();
