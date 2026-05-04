// Lint test for the 6 desktop skill bundles in skills/desktop/.
// Verifies each bundle conforms to agentskills.io minimum (SKILL.md valid
// frontmatter, scripts/skill.mjs present and exports a tool registration).
// Does NOT invoke the host applications — those need a real machine with
// Excel / Outlook / Premiere / OBS / Photoshop / Chrome installed.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'skills', 'desktop');
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const raw of m[1].split('\n')) {
    if (!raw.trim() || /^\s+/.test(raw)) continue;
    const i = raw.indexOf(':');
    if (i === -1) continue;
    fm[raw.slice(0, i).trim()] = raw.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { fm, body: m[2] ?? '' };
}

const expected = [
  'desktop-excel-open-and-extract',
  'desktop-outlook-send-email',
  'desktop-premiere-basic-cut',
  'desktop-obs-setup-scene',
  'desktop-photoshop-resize-export',
  'desktop-chrome-login-and-action',
];

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

if (!existsSync(ROOT)) fail(`missing dir ${ROOT}`);
const found = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
console.log(`[lint] discovered ${found.length} bundles in ${ROOT}`);
for (const want of expected) if (!found.includes(want)) fail(`bundle missing: ${want}`);

let ok = 0;
for (const name of expected) {
  const dir = join(ROOT, name);
  const skillMd = join(dir, 'SKILL.md');
  const skillJs = join(dir, 'scripts', 'skill.mjs');
  if (!existsSync(skillMd)) fail(`${name}: SKILL.md missing`);
  if (!existsSync(skillJs)) fail(`${name}: scripts/skill.mjs missing`);
  const fm = parseFrontmatter(readFileSync(skillMd, 'utf-8'));
  if (!fm) fail(`${name}: SKILL.md has no frontmatter`);
  if (fm.fm.name !== name) fail(`${name}: frontmatter name='${fm.fm.name}' != dir name`);
  if (!NAME_RE.test(fm.fm.name) || fm.fm.name.length > 64) fail(`${name}: invalid name`);
  if (!fm.fm.description || fm.fm.description.length > 1024) fail(`${name}: invalid description`);
  if (!fm.fm.compatibility) fail(`${name}: compatibility field strongly recommended for desktop skills`);
  const code = readFileSync(skillJs, 'utf-8');
  if (!/registerTool\s*\(/.test(code)) fail(`${name}: skill.mjs missing registerTool() call`);
  if (!/export default tool/.test(code)) fail(`${name}: skill.mjs missing default export`);
  if (statSync(skillJs).size < 200) fail(`${name}: skill.mjs suspiciously small`);
  console.log(`  ✓ ${name}`);
  ok++;
}
console.log(`\n[lint] ${ok}/${expected.length} bundles valid`);
if (ok !== expected.length) process.exit(1);
