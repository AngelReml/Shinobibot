/**
 * Secret Redactor — heurísticas regex para detectar y enmascarar claves
 * sensibles antes de que aparezcan en logs, audit.jsonl, o backups.
 * Sprint 3.8.
 *
 * El threat scan del audit cubre USER.md / MEMORY.md, pero NO los
 * archivos de logs ni audit.jsonl. Este módulo cierra ese hueco con
 * detección estructural (sin LLM) de los patrones más comunes de claves
 * en proveedores reales.
 *
 * Política:
 *   - Match → reemplaza por `<REDACTED:<kind>>` preservando longitud
 *     aproximada (útil para análisis de logs sin filtrar contenido
 *     real).
 *   - El módulo NO conoce qué es válido vs inválido: detecta forma.
 *     Mejor falso positivo redactando algo no sensible que dejar pasar
 *     una key real.
 *
 * Patrones cubiertos (todos exportables para tests):
 *   - OpenAI:        `sk-...`            (40+ chars alphanum)
 *   - Anthropic:     `sk-ant-api03-...`
 *   - GitHub:        `ghp_...`, `gho_...`, `ghu_...`, `ghs_...`
 *   - Google:        `AIza...`           (39 chars)
 *   - AWS:           `AKIA...`           (20 chars)
 *   - Slack:         `xox[abprs]-...`
 *   - Discord:       bot token formato N.M.O
 *   - Stripe:        `sk_(live|test)_...`
 *   - Bearer header: `Authorization: Bearer <token>`
 *   - Generic URL with token query param: `?token=...&` o `?api_key=...`
 *   - Private keys:  `-----BEGIN ... PRIVATE KEY-----`
 *   - JWT:           tres segmentos base64url separados por `.`
 *   - Env var line:  `<KEYNAME>=<value>` cuando el nombre indica clave
 */

export type SecretKind =
  | 'openai-key'
  | 'anthropic-key'
  | 'github-token'
  | 'google-api-key'
  | 'aws-access-key'
  | 'slack-token'
  | 'discord-bot-token'
  | 'stripe-key'
  | 'bearer-token'
  | 'url-token'
  | 'private-key-block'
  | 'jwt'
  | 'env-secret-assignment';

interface RedactorPattern {
  kind: SecretKind;
  rx: RegExp;
  /** Si se especifica, solo se redacta el grupo `n` (resto se preserva). */
  group?: number;
}

// Orden importa: patrones más ESPECÍFICOS antes que genéricos. Anthropic
// antes que OpenAI porque ambas keys empiezan con `sk-`. URL token antes
// que env-secret-assignment.
const PATTERNS: RedactorPattern[] = [
  // Anthropic primero (matchea `sk-ant-...` antes que OpenAI lo capture genérico).
  { kind: 'anthropic-key', rx: /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{30,200}/g },
  // OpenAI: sk-<chars> | sk-proj-<chars>
  { kind: 'openai-key', rx: /sk-(?:proj-)?[A-Za-z0-9_-]{30,200}/g },
  // GitHub: ghp_/gho_/ghu_/ghs_/ghr_/github_pat_
  { kind: 'github-token', rx: /(?:gh[oprsu]_|github_pat_)[A-Za-z0-9_]{30,255}/g },
  // Google API Key: AIza<35-40 chars>
  { kind: 'google-api-key', rx: /AIza[0-9A-Za-z_-]{35,40}/g },
  // AWS Access Key: AKIA<16> o ASIA<16>
  { kind: 'aws-access-key', rx: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // Slack: xoxb-/xoxa-/xoxp-/xoxr-/xoxs-/xapp- + cuerpo alfanumérico/guiones.
  { kind: 'slack-token', rx: /\bxox[abprs]-[A-Za-z0-9_-]{20,255}\b/g },
  // Discord bot token: 24+ . 6 . 27+ (base64url).
  { kind: 'discord-bot-token', rx: /\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g },
  // Stripe: sk_live_ o sk_test_
  { kind: 'stripe-key', rx: /\bsk_(?:live|test)_[A-Za-z0-9]{16,255}\b/g },
  // URL token query param — antes que env-secret-assignment. Captura
  // prefijo `?token=` en g1 y valor en g2 (solo g2 se redacta).
  { kind: 'url-token', rx: /([?&](?:token|api[_-]?key|secret|access[_-]?token)=)([^&\s"']{12,200})/gi, group: 2 },
  // Bearer: captura prefijo "Bearer " en g1 y token en g2.
  { kind: 'bearer-token', rx: /([Bb]earer\s+)([A-Za-z0-9_\-.=]{16,400})/g, group: 2 },
  // Private key block (PEM completo)
  { kind: 'private-key-block', rx: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/g },
  // JWT.
  { kind: 'jwt', rx: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Env var assignment. Sin \b inicial (rompe con `SUPER_API_KEY` porque
  // `_` es word-char y no genera boundary). Captura prefijo en g1, valor
  // en g2. Excluye `<` para NO re-redactar placeholders ya emitidos por
  // un patrón anterior (url-token, bearer-token, ...).
  { kind: 'env-secret-assignment', rx: /((?:API_?KEY|SECRET_?KEY|SECRET|PASSWORD|PASSWD|ACCESS_?TOKEN|PRIVATE_?KEY|AUTH_?TOKEN|BEARER_?TOKEN|TOKEN)[A-Z0-9_]*\s*[:=]\s*["']?)([^"'\s\n,;<>]{6,400})/gi, group: 2 },
];

export interface RedactionMatch {
  kind: SecretKind;
  /** Posición de inicio del valor redactado en el texto original. */
  start: number;
  /** Longitud original del valor redactado. */
  length: number;
  /** Hash del valor original (primeros 8 chars de SHA256 hex) — para
   *  correlación entre logs sin exponer la key. */
  hashFingerprint: string;
}

export interface RedactionResult {
  /** Texto resultante con valores reemplazados. */
  text: string;
  /** Lista de matches encontrados. */
  matches: RedactionMatch[];
}

import { createHash } from 'crypto';

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function placeholder(kind: SecretKind): string {
  return `<REDACTED:${kind}>`;
}

/**
 * Redacta un texto reemplazando todos los matches.
 *
 * Implementación: iteramos los patrones en orden de prioridad (más
 * específico primero). Sustituimos via callback en `replace` para
 * registrar matches con sus posiciones. Si una pattern usa `group`,
 * solo reemplazamos ese sub-grupo y dejamos el resto intacto.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text || typeof text !== 'string') return { text: text ?? '', matches: [] };
  const matches: RedactionMatch[] = [];
  let result = text;
  for (const pat of PATTERNS) {
    result = result.replace(pat.rx, (full, ...args) => {
      // `args` = [g1, g2, ..., offset, fullString]. Si hay groups, los
      // primeros N son los capture groups.
      const groups = args.slice(0, args.length - 2);
      const offset: number = args[args.length - 2];
      const captured = pat.group != null ? String(groups[pat.group - 1] ?? '') : full;
      if (!captured) return full;
      const start = pat.group != null ? offset + full.indexOf(captured) : offset;
      matches.push({
        kind: pat.kind,
        start,
        length: captured.length,
        hashFingerprint: fingerprint(captured),
      });
      if (pat.group != null) {
        // Mantén el prefijo (g1) si group=2, etc. Solo sustituye el grupo `group`.
        const parts: string[] = [];
        for (let i = 0; i < groups.length; i++) {
          const g = String(groups[i] ?? '');
          parts.push(i === pat.group - 1 ? placeholder(pat.kind) : g);
        }
        return parts.join('');
      }
      return placeholder(pat.kind);
    });
  }
  return { text: result, matches };
}

/**
 * Lectura conveniente: aplica `redactSecrets` línea a línea preservando
 * los saltos de línea. Útil para procesar audit.jsonl (cada línea es un
 * record JSON; no puede contener saltos internos).
 */
export function redactSecretsByLine(text: string): RedactionResult {
  const lines = text.split('\n');
  const allMatches: RedactionMatch[] = [];
  let offset = 0;
  const redactedLines = lines.map(line => {
    const r = redactSecrets(line);
    for (const m of r.matches) {
      allMatches.push({ ...m, start: offset + m.start });
    }
    offset += line.length + 1;
    return r.text;
  });
  return { text: redactedLines.join('\n'), matches: allMatches };
}

export function hasSecrets(text: string): boolean {
  return redactSecrets(text).matches.length > 0;
}

export const _internal = { PATTERNS, placeholder, fingerprint };
