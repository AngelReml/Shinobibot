// F2.10 (auditoría 2026-07-01) — code_reviewer.ts enviaba hasta 32KB de
// fuente LITERAL a un LLM externo (Opus) sin pasar por el redactor de
// secretos. Este test verifica, con ficheros reales en un tmpdir, que:
//   1. Un secreto tipo AWS/connection-string dentro de un archivo candidato
//      llega REDACTADO al blob (no literal).
//   2. Un `.env` NUNCA es candidato — ni se lee, ni aparece en `files`.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickRiskyFiles, buildCodeReviewBlob } from '../code_reviewer.js';

function mktmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cr-redact-'));
}

describe('F2.10 — code_reviewer redacta secretos y excluye rutas sensibles', () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('un AWS Secret Access Key embebido en un archivo candidato llega REDACTADO al blob, no literal', () => {
    root = mktmp();
    fs.mkdirSync(path.join(root, 'src'));
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    fs.writeFileSync(
      path.join(root, 'src', 'auth.js'),
      `const cfg = { aws_secret_access_key: "${secret}" };\nfunction login(u,p){ return p === "admin"; }\n`,
    );
    const { blob } = buildCodeReviewBlob(root);
    expect(blob).not.toContain(secret);
    expect(blob).toMatch(/REDACTED/i);
  });

  it('una connection string con password embebida llega redactada', () => {
    root = mktmp();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src', 'db.js'),
      `const url = "postgres://admin:SuperSecretPass123@db.internal:5432/prod";\nfunction query(){}\n`,
    );
    const { blob } = buildCodeReviewBlob(root);
    expect(blob).not.toContain('SuperSecretPass123');
  });

  it('un .env NUNCA es candidato — ni se lee ni aparece en pickRiskyFiles/files', () => {
    root = mktmp();
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_PASSWORD=hunter2\nAPI_KEY=sk-verysecret\n');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'auth.js'), 'function ok(){ return true; }');

    const picks = pickRiskyFiles(root);
    expect(picks.some((p) => p.rel === '.env')).toBe(false);

    const { blob, files } = buildCodeReviewBlob(root);
    expect(files).not.toContain('.env');
    expect(blob).not.toContain('hunter2');
    expect(blob).not.toContain('sk-verysecret');
  });

  it('.env.production / .ssh / claves privadas también quedan excluidas (variantes, no solo ".env" exacto)', () => {
    root = mktmp();
    fs.writeFileSync(path.join(root, '.env.production'), 'SECRET=prodsecret123\n');
    fs.mkdirSync(path.join(root, '.ssh'));
    fs.writeFileSync(path.join(root, '.ssh', 'id_rsa.js'), '// no es una key real, pero vive bajo .ssh/'); // extensión rara a propósito
    fs.writeFileSync(path.join(root, 'server.pem'), 'FAKE PEM CONTENT'); // .pem no está en RISKY_EXTENSIONS igualmente, pero confirma el patrón

    const picks = pickRiskyFiles(root);
    expect(picks.some((p) => p.rel === '.env.production')).toBe(false);
    expect(picks.some((p) => p.rel.startsWith('.ssh/'))).toBe(false);
  });

  it('un repo sin secretos sigue funcionando exactamente igual (no regresión de contenido legítimo)', () => {
    root = mktmp();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'login.php'), '<?php $u = $_POST["u"]; mysqli_query($conn, "SELECT * FROM users WHERE name=$u"); ?>');
    const { blob, files } = buildCodeReviewBlob(root);
    expect(files).toContain('src/login.php');
    expect(blob).toMatch(/mysqli_query/);
  });
});
