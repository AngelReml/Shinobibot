import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const SHINOBI_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
const CONFIG_FILE = path.join(SHINOBI_DIR, 'config.json');

export interface ShinobiConfig {
  language: 'es' | 'en';
  memory_path: string;
  onboarded_at: string;
  version: string;
  // Bloque 7 — onboarding web universal.
  provider?: 'groq' | 'openai' | 'anthropic' | 'openrouter';
  provider_key?: string;
  model_default?: string;
  // Back-compat: campos legacy presentes en configs antiguas (ignorados en runtime)
  opengravity_api_key?: string;
  opengravity_url?: string;
}

/**
 * Persist a fresh config to disk (atomic write).
 * Bloque 7: used by the web onboarding to save the user's choice.
 */
export function saveConfig(cfg: ShinobiConfig): void {
  if (!fs.existsSync(SHINOBI_DIR)) fs.mkdirSync(SHINOBI_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, CONFIG_FILE);
}

/**
 * Re-read config from disk and update relevant process.env vars in-place.
 * Bloque 7: hot reload after web onboarding so the orchestrator picks up
 * the new provider without restart.
 */
export function reloadConfig(): ShinobiConfig | null {
  const cfg = loadConfig();
  if (!cfg) return null;
  process.env.SHINOBI_LANGUAGE = cfg.language || 'es';
  process.env.SHINOBI_MEMORY_PATH = cfg.memory_path || '';
  if (cfg.provider) process.env.SHINOBI_PROVIDER = cfg.provider;
  else delete process.env.SHINOBI_PROVIDER;
  if (cfg.provider_key) process.env.SHINOBI_PROVIDER_KEY = cfg.provider_key;
  else delete process.env.SHINOBI_PROVIDER_KEY;
  if (cfg.model_default) process.env.SHINOBI_MODEL_DEFAULT = cfg.model_default;
  else delete process.env.SHINOBI_MODEL_DEFAULT;
  return cfg;
}

class LineReader {
  private buffer = '';
  private closed = false;
  private pending: ((line: string) => void) | null = null;
  private rl: readline.Interface | null = null;

  constructor() {
    if (process.stdin.isTTY) {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      this.rl.on('line', line => this.deliver(line));
      this.rl.on('close', () => { this.closed = true; this.flush(); });
    } else {
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => { this.buffer += chunk; this.flush(); });
      process.stdin.on('end', () => { this.closed = true; this.flush(); });
    }
  }

  private deliver(line: string) {
    if (this.pending) {
      const r = this.pending; this.pending = null; r(line);
    } else {
      this.buffer += line + '\n';
    }
  }

  private flush() {
    if (!this.pending) return;
    if (this.rl) return;
    const idx = this.buffer.indexOf('\n');
    if (idx >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const r = this.pending; this.pending = null; r(line);
    } else if (this.closed) {
      const line = this.buffer;
      this.buffer = '';
      const r = this.pending; this.pending = null; r(line);
    }
  }

  ask(q: string): Promise<string> {
    process.stdout.write(q);
    return new Promise(resolve => {
      this.pending = line => resolve(line.trim());
      this.flush();
    });
  }

  close() {
    if (this.rl) this.rl.close();
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): ShinobiConfig | null {
  if (!configExists()) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return null; }
}

export async function runFirstRunWizard(): Promise<ShinobiConfig> {
  if (!fs.existsSync(SHINOBI_DIR)) fs.mkdirSync(SHINOBI_DIR, { recursive: true });

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║         Welcome to Shinobi · First Setup           ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log('This wizard runs only once. It takes 30 seconds.');
  console.log('');

  const reader = new LineReader();

  // 1. Idioma
  let lang = '';
  while (lang !== 'es' && lang !== 'en') {
    lang = (await reader.ask('Language [es/en] (default: es): ')).toLowerCase() || 'es';
    if (lang !== 'es' && lang !== 'en') console.log('  Please type es or en.');
  }

  // 2. API key
  console.log('');
  if (lang === 'es') {
    console.log('Configura tu proveedor LLM (Anthropic, OpenAI, Groq, etc.).');
    console.log('Puedes introducir la API key ahora o configurarla después con /config.');
  } else {
    console.log('Configure your LLM provider (Anthropic, OpenAI, Groq, etc.).');
    console.log('You can enter the API key now or configure it later with /config.');
  }
  const apiKey = (await reader.ask(lang === 'es' ? 'API key (o Enter para después): ' : 'API key (or Enter to skip): ')).trim();

  // 3. Memory path
  console.log('');
  const defaultMem = path.join(SHINOBI_DIR, 'memory');
  const memInput = await reader.ask((lang === 'es' ? 'Carpeta para memoria local' : 'Local memory folder') + ` (default: ${defaultMem}): `);
  const memoryPath = memInput || defaultMem;
  if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath, { recursive: true });

  // 4. Telemetry opt-in (G2.2). Default = NO. We never enable without explicit yes.
  console.log('');
  const telemetryQ = lang === 'es'
    ? 'Telemetría anónima (sin prompts ni paths, sólo contadores agregados)? [s/N]: '
    : 'Anonymous telemetry (no prompts/paths, just aggregate counters)? [y/N]: ';
  const telemetryInput = (await reader.ask(telemetryQ)).trim().toLowerCase();
  const telemetryOptIn = telemetryInput === 's' || telemetryInput === 'si' || telemetryInput === 'y' || telemetryInput === 'yes';
  try {
    const tel = await import('../telemetry/telemetry.js');
    tel.ensureConfigInitialized({ optedIn: telemetryOptIn, install_version: '1.0.0' });
  } catch { /* telemetry module is optional */ }

  reader.close();

  const config: ShinobiConfig = {
    language: lang as 'es' | 'en',
    memory_path: memoryPath,
    onboarded_at: new Date().toISOString(),
    version: '1.0.0',
    ...(apiKey ? { provider_key: apiKey } : {}),
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });

  console.log('');
  console.log(lang === 'es' ? '✓ Configuración guardada en:' : '✓ Configuration saved at:', CONFIG_FILE);
  console.log('');

  return config;
}
