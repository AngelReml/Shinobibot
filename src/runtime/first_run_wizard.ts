import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const SHINOBI_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
const CONFIG_FILE = path.join(SHINOBI_DIR, 'config.json');

export interface ShinobiConfig {
  opengravity_api_key: string;
  opengravity_url: string;
  language: 'es' | 'en';
  memory_path: string;
  onboarded_at: string;
  version: string;
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(r => rl.question(q, ans => r(ans.trim())));
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // 1. Idioma
  let lang = '';
  while (lang !== 'es' && lang !== 'en') {
    lang = (await ask(rl, 'Language [es/en] (default: es): ')).toLowerCase() || 'es';
    if (lang !== 'es' && lang !== 'en') console.log('  Please type es or en.');
  }

  // 2. API key
  console.log('');
  if (lang === 'es') {
    console.log('Para usar Shinobi necesitas una API key de OpenGravity.');
    console.log('Si no tienes una, contacta con el creador o solicítala en zapweave.com');
  } else {
    console.log('To use Shinobi you need an OpenGravity API key.');
    console.log('If you do not have one, contact the maker or request at zapweave.com');
  }
  let apiKey = '';
  while (!apiKey || apiKey.length < 5) {
    apiKey = await ask(rl, lang === 'es' ? 'API key: ' : 'API key: ');
    if (!apiKey || apiKey.length < 5) console.log(lang === 'es' ? '  Clave inválida.' : '  Invalid key.');
  }

  // 3. Memory path
  console.log('');
  const defaultMem = path.join(SHINOBI_DIR, 'memory');
  const memInput = await ask(rl, (lang === 'es' ? 'Carpeta para memoria local' : 'Local memory folder') + ` (default: ${defaultMem}): `);
  const memoryPath = memInput || defaultMem;
  if (!fs.existsSync(memoryPath)) fs.mkdirSync(memoryPath, { recursive: true });

  rl.close();

  const config: ShinobiConfig = {
    opengravity_api_key: apiKey,
    opengravity_url: 'https://kernel.zapweave.com',
    language: lang as 'es' | 'en',
    memory_path: memoryPath,
    onboarded_at: new Date().toISOString(),
    version: '0.1.0'
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });

  console.log('');
  console.log(lang === 'es' ? '✓ Configuración guardada en:' : '✓ Configuration saved at:', CONFIG_FILE);
  console.log('');

  return config;
}
