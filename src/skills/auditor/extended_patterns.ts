/**
 * Extended audit patterns — Sprint P2.2 (paridad densidad con Hermes
 * skills_guard.py, ~70 patrones). Suplementa los 22 existentes en
 * src/skills/skill_auditor.ts en 6 categorías:
 *
 *   - exfil
 *   - injection
 *   - destructive
 *   - persistence
 *   - network_egress_sospechoso
 *   - obfuscation
 *
 * Cada patrón tiene severity + reason. El auditor los consume vía
 * `EXTENDED_CRITICAL` / `EXTENDED_WARNING` y los une con sus listas
 * locales.
 *
 * Probados con test positivo (caso que DEBE detectarse) + test
 * negativo (false positive que NO debe detectarse).
 */

export interface ExtendedPattern {
  rule: string;
  category: 'exfil' | 'injection' | 'destructive' | 'persistence' | 'network' | 'obfuscation';
  pattern: RegExp;
  reason: string;
}

export const EXTENDED_CRITICAL: ExtendedPattern[] = [
  // ── EXFIL ──
  {
    rule: 'exfil-etc-passwd',
    category: 'exfil',
    pattern: /\b(cat|less|head|tail|type|Get-Content)\s+\/etc\/(passwd|shadow|sudoers)\b/i,
    reason: 'lee archivos sensibles del sistema /etc/passwd|shadow|sudoers',
  },
  {
    rule: 'exfil-aws-metadata-ip',
    category: 'exfil',
    pattern: /169\.254\.169\.254/,
    reason: 'consulta endpoint metadata AWS/GCP (extracción de credenciales temporales)',
  },
  {
    rule: 'exfil-ssh-keys',
    category: 'exfil',
    pattern: /\b(cat|copy|cp|mv|Get-Content)\s+[^\n]*[~\/]\.ssh\/(id_rsa|id_ed25519|id_ecdsa|authorized_keys|known_hosts)\b/i,
    reason: 'lee/copia claves SSH del usuario',
  },
  {
    rule: 'exfil-aws-creds',
    category: 'exfil',
    pattern: /\b(cat|copy|cp|mv|Get-Content)\s+[^\n]*\.aws\/(credentials|config)\b/i,
    reason: 'lee/copia credenciales AWS locales',
  },
  {
    rule: 'exfil-gcloud-creds',
    category: 'exfil',
    pattern: /\.config\/gcloud\/(application_default_credentials|credentials\.db)\b/i,
    reason: 'lee credenciales gcloud locales',
  },
  {
    rule: 'exfil-browser-passwords',
    category: 'exfil',
    pattern: /(Login Data|signons\.sqlite|key4\.db|Cookies)\b/i,
    reason: 'accede a base de datos de passwords/cookies de browsers',
  },
  {
    rule: 'exfil-env-dump-remote',
    category: 'exfil',
    pattern: /(curl|wget|fetch|Invoke-WebRequest)[^\n]+(--data|-d|-Body|body:).*(process\.env|printenv|env\b)/i,
    reason: 'envia el dump de env vars a un endpoint remoto',
  },

  // ── INJECTION ──
  {
    rule: 'injection-eval-concat',
    category: 'injection',
    pattern: /\beval\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*\+/i,
    reason: 'eval con string concatenation (clásico injection sink)',
  },
  {
    rule: 'injection-exec-stdin',
    category: 'injection',
    pattern: /\bexec(?:Sync)?\s*\(\s*(process\.argv|process\.stdin|req\.body)/,
    reason: 'exec/execSync con args del usuario sin sanitizar',
  },
  {
    rule: 'injection-shell-true',
    category: 'injection',
    pattern: /\b(spawn|exec)\s*\([^)]*\bshell\s*:\s*true/,
    reason: 'spawn/exec con `shell:true` + arg dinámico = command injection',
  },
  {
    rule: 'injection-template-tag',
    category: 'injection',
    pattern: /\$\{\s*(req|input|args|user)[^}]*\}\s*[`'"\s]*(exec|spawn|child_process)/i,
    reason: 'template literal con input del usuario → exec/spawn',
  },

  // ── DESTRUCTIVE ──
  {
    rule: 'destructive-dd-zero',
    category: 'destructive',
    pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/(sda|nvme|disk)/i,
    reason: 'dd sobrescribe disco físico con ceros/random (irrecuperable)',
  },
  {
    rule: 'destructive-mkfs',
    category: 'destructive',
    pattern: /\bmkfs(\.\w+)?\s+\/dev\//i,
    reason: 'reformatea partición real con mkfs',
  },
  {
    rule: 'destructive-shred',
    category: 'destructive',
    pattern: /\bshred\s+(-[fuvz]+\s+)*\/(dev|home|etc|var)/i,
    reason: 'shred sobrescribe archivos del sistema',
  },
  {
    rule: 'destructive-fork-bomb',
    category: 'destructive',
    pattern: /:\(\)\s*\{\s*:\|:\&\s*\}\s*;\s*:/,
    reason: 'fork bomb shell clásico',
  },
  {
    rule: 'destructive-cipher-overwrite',
    category: 'destructive',
    pattern: /\bcipher\s+\/w:/i,
    reason: 'cipher /w sobrescribe espacio libre del disco (no recuperable)',
  },

  // ── PERSISTENCE ──
  {
    rule: 'persist-cron-rogue',
    category: 'persistence',
    pattern: /(crontab\s+-e|\/etc\/cron\.[a-z]+\/|\/var\/spool\/cron)/i,
    reason: 'instala cronjob para persistir tras reinicio',
  },
  {
    rule: 'persist-systemd-unit',
    category: 'persistence',
    pattern: /\/etc\/systemd\/system\/[^\n]+\.service\b/i,
    reason: 'escribe unit systemd para persistir',
  },
  {
    rule: 'persist-launchd',
    category: 'persistence',
    pattern: /(~|\/)Library\/LaunchAgents\/[^\n]+\.plist/i,
    reason: 'plist en LaunchAgents para persistir en macOS',
  },
  {
    rule: 'persist-windows-runkey',
    category: 'persistence',
    pattern: /HK(LM|CU)\\Software\\Microsoft\\Windows\\CurrentVersion\\Run(Once)?\b/i,
    reason: 'añade entrada autorun en registro Windows',
  },
  {
    rule: 'persist-scheduled-task-startup',
    category: 'persistence',
    pattern: /schtasks\s+\/create\s+[^\n]+\/sc\s+onlogon\b/i,
    reason: 'tarea programada onlogon para persistir',
  },
  {
    rule: 'persist-bashrc-write',
    category: 'persistence',
    pattern: /(echo|cat|>>)\s+[^\n]*(~|\/etc)\/(\.?bashrc|\.?zshrc|\.?profile)\b/i,
    reason: 'modifica bashrc/zshrc/profile para ejecutar al login',
  },

  // ── NETWORK ──
  {
    rule: 'network-ngrok-tunnel',
    category: 'network',
    pattern: /(ngrok|localtunnel|cloudflared|frpc|tailscale\s+up)\b/i,
    reason: 'levanta túnel reverso (potencial backdoor)',
  },
  {
    rule: 'network-ip-direct-raw',
    category: 'network',
    pattern: /(curl|wget|fetch|http\.get|Invoke-WebRequest)\s+(-[^\s]+\s+)*['"]?https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/i,
    reason: 'request a IP directa (no dominio) — posible C2',
  },
  {
    rule: 'network-tor-onion',
    category: 'network',
    pattern: /https?:\/\/[a-z2-7]{16,56}\.onion\b/i,
    reason: 'request a hidden service Tor (.onion)',
  },

  // ── OBFUSCATION ──
  {
    rule: 'obfusc-base64-eval',
    category: 'obfuscation',
    pattern: /\b(eval|exec|Invoke-Expression|IEX)\s*\(?\s*(atob|Buffer\.from|[A-Za-z]:?from_base64|\[Convert\]::FromBase64String)/i,
    reason: 'decode base64 → eval (técnica para esconder código)',
  },
  {
    rule: 'obfusc-char-codes',
    category: 'obfuscation',
    pattern: /String\.fromCharCode\s*\(\s*(\d+\s*,\s*){10,}/,
    reason: 'cadena construida con >10 charCodes consecutivos (obfuscation pattern)',
  },
  {
    rule: 'obfusc-hex-blob',
    category: 'obfuscation',
    pattern: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){15,}/i,
    reason: 'literal hex >15 bytes consecutivos (binary blob escondido)',
  },
];

export const EXTENDED_WARNING: ExtendedPattern[] = [
  // EXFIL warnings
  {
    rule: 'exfil-clipboard-read',
    category: 'exfil',
    pattern: /\b(pbpaste|xclip\s+-o|Get-Clipboard|navigator\.clipboard\.readText)\b/i,
    reason: 'lee clipboard del usuario — puede capturar credenciales',
  },
  {
    rule: 'exfil-keylogger-windows',
    category: 'exfil',
    pattern: /\b(GetAsyncKeyState|SetWindowsHookEx|low_level_keyboard)\b/i,
    reason: 'API Windows típica de keyloggers',
  },

  // INJECTION warnings
  {
    rule: 'injection-yaml-unsafe',
    category: 'injection',
    pattern: /\byaml\.(load|unsafe_load)\s*\(/i,
    reason: 'yaml.load (no safe_load) permite construcción arbitraria',
  },
  {
    rule: 'injection-pickle-load',
    category: 'injection',
    pattern: /\bpickle\.(load|loads)\s*\(/,
    reason: 'pickle.load deserialización insegura (RCE)',
  },
  {
    rule: 'injection-yaml-tag-python',
    category: 'injection',
    pattern: /!!python\/object|!!python\/module/,
    reason: 'YAML con !!python/object permite ejecutar código al parsear',
  },

  // DESTRUCTIVE warnings
  {
    rule: 'destructive-truncate-log',
    category: 'destructive',
    pattern: />\s*\/var\/log\/[^\s]+(\s|$)/,
    reason: 'sobreescribe log del sistema (impide forensics)',
  },
  {
    rule: 'destructive-clear-history',
    category: 'destructive',
    pattern: /\b(history\s+-c|Clear-History|rm\s+[~\/]+\.(bash|zsh)_history)/i,
    reason: 'limpia historial shell (anti-forensics)',
  },

  // PERSISTENCE warnings
  {
    rule: 'persist-ssh-key-inject',
    category: 'persistence',
    pattern: />\s*[~\/]+\.ssh\/authorized_keys/,
    reason: 'añade clave a authorized_keys (acceso SSH persistente)',
  },
  {
    rule: 'persist-pam-modify',
    category: 'persistence',
    pattern: /\/etc\/pam\.d\//,
    reason: 'modifica config PAM (auth bypass)',
  },

  // NETWORK warnings
  {
    rule: 'network-port-scan',
    category: 'network',
    pattern: /\b(nmap|masscan|zmap)\s+/i,
    reason: 'herramienta de port scanning',
  },
  {
    rule: 'network-dns-tunnel',
    category: 'network',
    pattern: /\b(iodine|dnscat|dns2tcp)\b/i,
    reason: 'herramienta DNS tunneling (canal cubierto)',
  },
  {
    rule: 'network-large-headers',
    category: 'network',
    pattern: /headers\s*:\s*\{[^}]{2000,}/,
    reason: 'headers HTTP con >2KB (potencial smuggling)',
  },

  // OBFUSCATION warnings
  {
    rule: 'obfusc-multi-eval',
    category: 'obfuscation',
    pattern: /(eval\s*\([^)]*eval\s*\(|exec\s*\([^)]*exec\s*\()/,
    reason: 'eval/exec anidado (probable ofuscación)',
  },
  {
    rule: 'obfusc-rot13',
    category: 'obfuscation',
    pattern: /\brot13\b|tr\s+a-zA-Z\s+n-za-mN-ZA-M/,
    reason: 'rot13 (cifrado trivial usado para esconder)',
  },
];

/** Severidad numérica para escalation (test helper). */
export function severityOf(rule: string): 'critical' | 'warning' | null {
  if (EXTENDED_CRITICAL.some(p => p.rule === rule)) return 'critical';
  if (EXTENDED_WARNING.some(p => p.rule === rule)) return 'warning';
  return null;
}

export const EXTENDED_RULE_COUNT = EXTENDED_CRITICAL.length + EXTENDED_WARNING.length;
