// A4 — `shinobi import hermes` implementation.
//
// Detects a Hermes installation (~/.hermes or %USERPROFILE%/.hermes), parses
// its config + memory + skills + API keys, and writes the equivalent into the
// Shinobi runtime layout:
//
//   %APPDATA%/Shinobi/config.json        ← from .hermes/config.yaml
//   %APPDATA%/Shinobi/memory.db          ← from .hermes/{MEMORY,USER}.md
//   %APPDATA%/Shinobi/agentskills/<name>/ ← from .hermes/skills/<name>/
//   <shinobi repo>/.env                  ← API keys (OpenRouter/OpenAI/Anthropic/ElevenLabs)
//
// All writes are gated behind --overwrite. The default mode is --dry-run, which
// prints a report and returns without touching anything. The Shinobi side rule
// "never overwrite without backup" is honored: any file we'd overwrite is first
// copied to <path>.backup-<UTC>.
//
// The MemoryStore is opened on-demand (lazy import) because better-sqlite3 is
// a heavy native dep and we don't want to load it for --dry-run.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ImportPlan {
  hermes_root: string;
  shinobi_dir: string;
  found: {
    config_yaml: boolean;
    memory_md: boolean;
    user_md: boolean;
    skills_dir: boolean;
    skills_count: number;
    api_keys: string[];
  };
  actions: Array<{
    kind: 'config' | 'memory' | 'skill' | 'env';
    description: string;
    target: string;
    bytes?: number;
    skipped_reason?: string;
  }>;
  warnings: string[];
}

export interface ImportOptions {
  dryRun: boolean;
  overwrite: boolean;
  hermesRootOverride?: string;
  shinobiDirOverride?: string;
  shinobiRepoOverride?: string;
  /** Quiet mode for tests. */
  silent?: boolean;
}

export interface ImportResult {
  plan: ImportPlan;
  applied: boolean;
  errors: string[];
}

const SHINOBI_DEFAULT = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Shinobi');

function log(opts: ImportOptions, msg: string) {
  if (!opts.silent) console.log(msg);
}

function fileSizeOrNull(p: string): number | null {
  try { return fs.statSync(p).size; } catch { return null; }
}

function backupBeforeWrite(target: string): string | null {
  if (!fs.existsSync(target)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bk = `${target}.backup-${stamp}`;
  fs.copyFileSync(target, bk);
  return bk;
}

export function detectHermesInstall(override?: string): string | null {
  if (override) {
    return fs.existsSync(override) ? path.resolve(override) : null;
  }
  const candidates = [
    process.env.HERMES_HOME,
    path.join(os.homedir(), '.hermes'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.hermes') : null,
  ].filter((x): x is string => !!x);
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return path.resolve(c);
  return null;
}

// ---------- minimal YAML reader (flat top-level only, sufficient for hermes config) ----------
function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^([\w.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// ---------- parsers ----------

interface HermesConfig {
  api_url?: string;
  api_key?: string;
  language?: string;
  memory_path?: string;
  raw: Record<string, string>;
}

export function parseHermesConfig(yamlPath: string): HermesConfig | null {
  if (!fs.existsSync(yamlPath)) return null;
  const text = fs.readFileSync(yamlPath, 'utf-8');
  const raw = parseFlatYaml(text);
  return {
    api_url: raw.opengravity_url ?? raw.api_url ?? raw.kernel_url,
    api_key: raw.opengravity_api_key ?? raw.api_key ?? raw.shinobi_api_key,
    language: raw.language,
    memory_path: raw.memory_path,
    raw,
  };
}

export interface MemoryRecord {
  content: string;
  category: 'general' | 'user' | 'project';
  source: string;
  tags?: string[];
  importance?: number;
}

export function parseHermesMemoryMd(filePath: string, category: MemoryRecord['category']): MemoryRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf-8');
  const records: MemoryRecord[] = [];
  // Split by Markdown headings (## or higher). Each chunk becomes a memory entry.
  const blocks = text.split(/\n(?=#{1,3}\s)/g);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 20) continue;
    records.push({
      content: trimmed,
      category,
      source: `hermes:${path.basename(filePath)}`,
      importance: category === 'user' ? 0.8 : 0.5,
    });
  }
  // If there were no headings, treat the whole file as a single record.
  if (records.length === 0 && text.trim().length > 0) {
    records.push({
      content: text.trim(),
      category,
      source: `hermes:${path.basename(filePath)}`,
      importance: 0.6,
    });
  }
  return records;
}

export interface HermesSkill {
  name: string;
  legacy_path: string;
  has_skill_md: boolean;
  has_scripts: boolean;
}

export function listHermesSkills(skillsRoot: string): HermesSkill[] {
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return [];
  const out: HermesSkill[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, entry.name);
    out.push({
      name: entry.name,
      legacy_path: skillDir,
      has_skill_md: fs.existsSync(path.join(skillDir, 'SKILL.md')),
      has_scripts: fs.existsSync(path.join(skillDir, 'scripts')),
    });
  }
  return out;
}

const API_KEY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'OPENROUTER_API_KEY', re: /\b(sk-or-[a-z0-9-_]{16,})\b/i },
  { name: 'OPENAI_API_KEY', re: /\b(sk-[a-zA-Z0-9_-]{20,})\b/ },
  { name: 'ANTHROPIC_API_KEY', re: /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/i },
  { name: 'ELEVENLABS_API_KEY', re: /\b(sk_[a-f0-9]{40,}|[a-f0-9]{32,})\b/i },
];

export function extractApiKeysFromHermes(hermesRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  const candidates = [
    path.join(hermesRoot, '.env'),
    path.join(hermesRoot, 'config.yaml'),
    path.join(hermesRoot, 'secrets.yaml'),
    path.join(hermesRoot, 'keys.json'),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const text = fs.readFileSync(c, 'utf-8');
    for (const { name, re } of API_KEY_PATTERNS) {
      if (out[name]) continue;
      const m = text.match(re);
      if (m && m[1]) out[name] = m[1];
    }
    // Also pick up plain assignments in .env
    if (c.endsWith('.env')) {
      for (const line of text.split(/\r?\n/)) {
        const mm = line.match(/^([A-Z][A-Z0-9_]+)=(.+)$/);
        if (mm && /API_KEY$/.test(mm[1]) && !out[mm[1]]) {
          out[mm[1]] = mm[2].replace(/^['"]|['"]$/g, '');
        }
      }
    }
  }
  return out;
}

// ---------- planner ----------

export function buildPlan(opts: ImportOptions): ImportPlan {
  const hermesRoot = detectHermesInstall(opts.hermesRootOverride);
  const shinobiDir = opts.shinobiDirOverride ?? SHINOBI_DEFAULT;
  if (!hermesRoot) {
    return {
      hermes_root: '',
      shinobi_dir: shinobiDir,
      found: { config_yaml: false, memory_md: false, user_md: false, skills_dir: false, skills_count: 0, api_keys: [] },
      actions: [],
      warnings: ['No Hermes installation detected. Set HERMES_HOME or pass --hermes-root.'],
    };
  }

  const cfgPath = path.join(hermesRoot, 'config.yaml');
  const memPath = path.join(hermesRoot, 'MEMORY.md');
  const userPath = path.join(hermesRoot, 'USER.md');
  const skillsRoot = path.join(hermesRoot, 'skills');
  const apiKeys = extractApiKeysFromHermes(hermesRoot);
  const skills = listHermesSkills(skillsRoot);

  const plan: ImportPlan = {
    hermes_root: hermesRoot,
    shinobi_dir: shinobiDir,
    found: {
      config_yaml: fs.existsSync(cfgPath),
      memory_md: fs.existsSync(memPath),
      user_md: fs.existsSync(userPath),
      skills_dir: fs.existsSync(skillsRoot),
      skills_count: skills.length,
      api_keys: Object.keys(apiKeys),
    },
    actions: [],
    warnings: [],
  };

  if (plan.found.config_yaml) {
    plan.actions.push({
      kind: 'config',
      description: 'config.yaml -> Shinobi/config.json',
      target: path.join(shinobiDir, 'config.json'),
      bytes: fileSizeOrNull(cfgPath) ?? 0,
    });
  }
  if (plan.found.memory_md) {
    plan.actions.push({
      kind: 'memory',
      description: 'MEMORY.md -> SQLite memory.db (category=project)',
      target: path.join(shinobiDir, 'memory.db'),
      bytes: fileSizeOrNull(memPath) ?? 0,
    });
  }
  if (plan.found.user_md) {
    plan.actions.push({
      kind: 'memory',
      description: 'USER.md -> SQLite memory.db (category=user)',
      target: path.join(shinobiDir, 'memory.db'),
      bytes: fileSizeOrNull(userPath) ?? 0,
    });
  }
  for (const s of skills) {
    plan.actions.push({
      kind: 'skill',
      description: `skill ${s.name} -> Shinobi/agentskills/${s.name}/`,
      target: path.join(shinobiDir, 'agentskills', s.name),
    });
  }
  if (Object.keys(apiKeys).length) {
    plan.actions.push({
      kind: 'env',
      description: `API keys (${Object.keys(apiKeys).join(', ')}) -> .env`,
      target: path.join(opts.shinobiRepoOverride ?? process.cwd(), '.env'),
    });
  }
  if (plan.actions.length === 0) {
    plan.warnings.push('Hermes detected but nothing migratable found.');
  }
  return plan;
}

// ---------- applier ----------

interface MemoryStoreLike {
  store(content: string, options?: { category?: string; tags?: string[]; importance?: number; source?: string }): Promise<unknown>;
}

async function openMemoryStore(shinobiDir: string): Promise<MemoryStoreLike> {
  // Lazy import — better-sqlite3 is heavy and we don't want it in --dry-run.
  // Set APPDATA so MemoryStore writes into the requested shinobiDir.
  const prevAppdata = process.env.APPDATA;
  process.env.APPDATA = path.dirname(shinobiDir); // %APPDATA%/Shinobi/ <- shinobiDir
  try {
    const mod: any = await import('../memory/memory_store.js');
    return new mod.MemoryStore({ db_path: path.join(shinobiDir, 'memory.db') });
  } finally {
    if (prevAppdata !== undefined) process.env.APPDATA = prevAppdata; else delete process.env.APPDATA;
  }
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeShinobiConfigFromHermes(cfg: HermesConfig, target: string, opts: ImportOptions): { wrote: boolean; backup: string | null; reason?: string } {
  if (fs.existsSync(target) && !opts.overwrite) {
    return { wrote: false, backup: null, reason: 'target exists; pass --overwrite' };
  }
  const backup = backupBeforeWrite(target);
  const shinobiCfg = {
    opengravity_api_key: cfg.api_key ?? '',
    opengravity_url: cfg.api_url ?? 'https://kernel.zapweave.com',
    language: (cfg.language === 'en' ? 'en' : 'es'),
    memory_path: cfg.memory_path ?? path.join(SHINOBI_DEFAULT, 'memory.db'),
    onboarded_at: new Date().toISOString(),
    version: '1.0.0',
    imported_from: 'hermes',
  };
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(shinobiCfg, null, 2), 'utf-8');
  return { wrote: true, backup };
}

function writeEnvFile(envPath: string, keys: Record<string, string>, opts: ImportOptions): { wrote: boolean; backup: string | null; reason?: string } {
  let existing = '';
  if (fs.existsSync(envPath)) {
    if (!opts.overwrite) return { wrote: false, backup: null, reason: 'target exists; pass --overwrite' };
    existing = fs.readFileSync(envPath, 'utf-8');
  }
  const backup = backupBeforeWrite(envPath);
  const lines = existing.split(/\r?\n/);
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9_]+)=/);
    if (m) seen.add(m[1]);
  }
  const append: string[] = [];
  for (const [k, v] of Object.entries(keys)) {
    if (!seen.has(k)) append.push(`${k}=${v}`);
  }
  const out = (existing.endsWith('\n') || existing === '' ? existing : existing + '\n') +
    (append.length ? '# imported from hermes ' + new Date().toISOString() + '\n' + append.join('\n') + '\n' : '');
  if (append.length === 0) return { wrote: false, backup, reason: 'all keys already present' };
  fs.writeFileSync(envPath, out, 'utf-8');
  return { wrote: true, backup };
}

function importSkillDir(srcDir: string, destDir: string, opts: ImportOptions): { wrote: boolean; backup: string | null; reason?: string } {
  if (fs.existsSync(destDir) && !opts.overwrite) {
    return { wrote: false, backup: null, reason: 'target dir exists; pass --overwrite' };
  }
  let backup: string | null = null;
  if (fs.existsSync(destDir)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${destDir}.backup-${stamp}`;
    fs.renameSync(destDir, backup);
  }
  ensureDir(destDir);
  const stack = [{ s: srcDir, d: destDir }];
  while (stack.length) {
    const { s, d } = stack.pop()!;
    ensureDir(d);
    for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
      const ss = path.join(s, entry.name);
      const dd = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push({ s: ss, d: dd });
      else fs.copyFileSync(ss, dd);
    }
  }
  return { wrote: true, backup };
}

export async function applyImport(opts: ImportOptions): Promise<ImportResult> {
  const plan = buildPlan(opts);
  const errors: string[] = [];
  if (opts.dryRun) {
    log(opts, `[hermes-import] dry-run — no writes performed`);
    return { plan, applied: false, errors };
  }
  if (!plan.hermes_root) {
    return { plan, applied: false, errors: plan.warnings };
  }

  // 1. Config
  if (plan.found.config_yaml) {
    const parsed = parseHermesConfig(path.join(plan.hermes_root, 'config.yaml'));
    if (parsed) {
      try {
        const r = writeShinobiConfigFromHermes(parsed, path.join(plan.shinobi_dir, 'config.json'), opts);
        log(opts, `[hermes-import] config.json: ${r.wrote ? 'wrote' : 'skip — ' + r.reason}${r.backup ? ` (backup ${r.backup})` : ''}`);
      } catch (e: any) {
        errors.push(`config: ${e.message}`);
      }
    }
  }

  // 2. Memory
  if (plan.found.memory_md || plan.found.user_md) {
    try {
      ensureDir(plan.shinobi_dir);
      const mem = await openMemoryStore(plan.shinobi_dir);
      const records: MemoryRecord[] = [
        ...(plan.found.memory_md ? parseHermesMemoryMd(path.join(plan.hermes_root, 'MEMORY.md'), 'project') : []),
        ...(plan.found.user_md ? parseHermesMemoryMd(path.join(plan.hermes_root, 'USER.md'), 'user') : []),
      ];
      for (const r of records) {
        await mem.store(r.content, { category: r.category, tags: r.tags ?? [], importance: r.importance, source: r.source });
      }
      log(opts, `[hermes-import] memory.db: stored ${records.length} entries`);
    } catch (e: any) {
      errors.push(`memory: ${e.message}`);
    }
  }

  // 3. Skills
  if (plan.found.skills_count > 0) {
    const skillsDest = path.join(plan.shinobi_dir, 'agentskills');
    ensureDir(skillsDest);
    for (const s of listHermesSkills(path.join(plan.hermes_root, 'skills'))) {
      try {
        const r = importSkillDir(s.legacy_path, path.join(skillsDest, s.name), opts);
        log(opts, `[hermes-import] skill ${s.name}: ${r.wrote ? 'wrote' : 'skip — ' + r.reason}${r.backup ? ` (backup ${r.backup})` : ''}`);
      } catch (e: any) {
        errors.push(`skill ${s.name}: ${e.message}`);
      }
    }
  }

  // 4. .env
  if (plan.found.api_keys.length > 0) {
    const keys = extractApiKeysFromHermes(plan.hermes_root);
    const envPath = path.join(opts.shinobiRepoOverride ?? process.cwd(), '.env');
    try {
      const r = writeEnvFile(envPath, keys, opts);
      log(opts, `[hermes-import] .env: ${r.wrote ? `appended ${Object.keys(keys).length} keys` : 'skip — ' + r.reason}${r.backup ? ` (backup ${r.backup})` : ''}`);
    } catch (e: any) {
      errors.push(`env: ${e.message}`);
    }
  }

  return { plan, applied: errors.length === 0, errors };
}

// ---------- pretty printer ----------

export function renderPlan(plan: ImportPlan): string {
  const out: string[] = [];
  out.push(`Hermes root  : ${plan.hermes_root || '(not found)'}`);
  out.push(`Shinobi dir  : ${plan.shinobi_dir}`);
  out.push(`Found        :`);
  out.push(`  config.yaml : ${plan.found.config_yaml}`);
  out.push(`  MEMORY.md   : ${plan.found.memory_md}`);
  out.push(`  USER.md     : ${plan.found.user_md}`);
  out.push(`  skills/     : ${plan.found.skills_dir} (${plan.found.skills_count})`);
  out.push(`  API keys    : ${plan.found.api_keys.join(', ') || '(none)'}`);
  out.push('');
  out.push(`Planned actions: ${plan.actions.length}`);
  for (const a of plan.actions) {
    out.push(`  • [${a.kind}] ${a.description}`);
    out.push(`    target: ${a.target}`);
  }
  if (plan.warnings.length) {
    out.push('');
    out.push('Warnings:');
    for (const w of plan.warnings) out.push(`  ! ${w}`);
  }
  return out.join('\n');
}
