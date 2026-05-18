// src/memory/threat_scan.ts
//
// Escaneo de inyección para contenido que va a memoria (USER.md / MEMORY.md).
// El contenido se inyecta al system prompt en CADA turno; un payload
// malicioso podría reescribir las instrucciones de Shinobi o exfiltrar
// secretos. Antes de aceptar cualquier escritura, el contenido pasa por este
// set de regex (inspirado en Hermes).
//
// Extraído de curated_memory.ts para que markdown_store.ts pueda reusarlo sin
// crear un ciclo de imports (markdown_store ⇄ curated_memory).
//
// El error es VERBOSE a propósito: muestra qué patrón se disparó y qué
// fragmento lo activó, para que el usuario decida si reescribir o si es un
// falso positivo.

interface ThreatPattern { rx: RegExp; id: string; }

// Patrón flexible reusable: `(?:[\w'-]+\s+){0,N}` admite N palabras entre dos
// anclajes para sobrevivir a "ignore [all previous] instructions" estilo.
const THREAT_PATTERNS: ThreatPattern[] = [
  // — Override / disregard / forget instructions —
  { rx: /ignore\s+(?:[\w'-]+\s+){0,5}(?:instructions|rules|directives|guidelines|prompts?|system\s+message)/i, id: 'prompt_injection_ignore' },
  { rx: /disregard\s+(?:[\w'-]+\s+){0,5}(?:instructions|rules|directives|guidelines|prompts?|system\s+message)/i, id: 'prompt_injection_disregard' },
  { rx: /forget\s+(?:[\w'-]+\s+){0,5}(?:instructions|rules|training|prompts?|guidelines|system\s+message)/i, id: 'prompt_injection_forget' },
  { rx: /override\s+(?:[\w'-]+\s+){0,3}(?:instructions|rules|prompts?|system\s+message)/i, id: 'prompt_injection_override' },

  // — Role hijack / jailbreak —
  { rx: /\byou\s+are\s+(?:now\s+|a\s+|an\s+)/i, id: 'role_hijack_you_are' },
  { rx: /\bact\s+as\s+(?:a\s+|an\s+|if\s+|though\s+)/i, id: 'role_hijack_act_as' },
  { rx: /\bpretend\s+(?:to\s+be|you\s+(?:are|have))/i, id: 'role_hijack_pretend' },
  { rx: /\broleplay\s+as\b/i, id: 'role_hijack_roleplay' },
  { rx: /\bimagine\s+you\s+(?:are|have|can)/i, id: 'role_hijack_imagine' },
  { rx: /\bfrom\s+now\s+on\s+you\s+(?:will|are|must|should)/i, id: 'role_hijack_from_now_on' },
  { rx: /\b(?:dan|developer)\s+mode\b/i, id: 'role_hijack_jailbreak_persona' },
  { rx: /\bjailbreak\b/i, id: 'role_hijack_jailbreak_word' },

  // — System prompt leak —
  { rx: /(?:reveal|show|print|expose|leak|dump|output|reproduce|repeat|tell\s+me)\s+(?:[\w'-]+\s+){0,4}(?:system\s+prompt|system\s+message|initial\s+(?:prompt|instructions)|original\s+(?:prompt|instructions)|your\s+instructions|your\s+prompt)/i, id: 'system_prompt_leak' },
  { rx: /what\s+(?:is|are|were)\s+(?:your|the)\s+(?:[\w'-]+\s+){0,3}(?:system\s+prompt|initial\s+(?:prompt|instructions)|original\s+instructions)/i, id: 'system_prompt_leak_question' },

  // — Secret reveal (texto, sin shell) —
  { rx: /(?:reveal|show|print|expose|leak|dump|output|tell\s+me)\s+(?:[\w'-]+\s+){0,3}(?:api[\s_-]?keys?|tokens?|secrets?|passwords?|credentials?|env(?:ironment)?\s+vars?|\.env\s+(?:file|contents?))/i, id: 'secret_reveal_text' },

  // — Silent / deceptive action —
  { rx: /(?:do\s+not|don'?t|never)\s+(?:tell|inform|warn|notify|mention|let|alert)\s+(?:[\w'-]+\s+){0,3}(?:user|me|him|her|them|operator)/i, id: 'deception_hide_from_user' },
  { rx: /\bwithout\s+(?:telling|informing|notifying|asking|alerting)\s+(?:the\s+)?(?:user|me|operator)/i, id: 'deception_silent' },
  { rx: /\bhide\s+(?:from|this\s+from)\s+(?:the\s+)?(?:user|me|operator)/i, id: 'deception_hide' },

  // — Bypass restrictions —
  { rx: /(?:no|without|free\s+from|removed|bypass(?:ed|ing)?)\s+(?:safety\s+)?(?:restrictions|limits|rules|filters|guardrails|guidelines)/i, id: 'bypass_restrictions' },
  { rx: /\bunrestricted\s+(?:ai|mode|assistant|gpt)/i, id: 'unrestricted_persona' },

  // — Exfil via shell (multiplatform: bash + powershell + cmd) —
  { rx: /(?:curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\s+[^\n]{0,300}(?:\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API|AUTH)|Authorization\s*[:=]|Bearer\s+\$)/i, id: 'exfil_http_with_secret' },

  // — Read secrets from disk (multiplatform) —
  { rx: /(?:cat|type|more|less|head|tail|xxd|hexdump|Get-Content|gc)\s+[^\n]{0,200}(?:\.env(?:\.\w+)?|\.aws[\\/]credentials|\.docker[\\/]config|\.git-credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc|\.gitconfig|id_rsa|id_ed25519|id_ecdsa|known_hosts|\.kube[\\/]config|\.config[\\/]gh)/i, id: 'read_secrets_files' },

  // — SSH backdoor / persistence —
  { rx: /\bauthorized_keys\b/i, id: 'ssh_authorized_keys' },
  { rx: /(?:\$HOME[\\/]|~[\\/]|%USERPROFILE%[\\/]|C:[\\/]Users[\\/][^\\/]+[\\/])\.ssh\b/i, id: 'ssh_dir_access' },
];

// Invisible unicode set extendido — bidi overrides + zero-widths + Hangul
// fillers. Escape sequences en lugar de literales para que el source sea
// legible y sobreviva normalización del filesystem.
const INVISIBLE_CHARS = [
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '⁠', // word joiner
  '⁡', // function application
  '⁢', // invisible times
  '⁣', // invisible separator
  '⁤', // invisible plus
  '﻿', // zero-width no-break space (BOM)
  '‪', // LRE
  '‫', // RLE
  '‬', // PDF
  '‭', // LRO
  '‮', // RLO
  'ᅟ', // Hangul Choseong filler
  'ᅠ', // Hangul Jungseong filler
  'ㅤ', // Hangul filler
  'ﾠ', // Hangul halfwidth filler
];

export type ThreatScanResult =
  | { ok: true }
  | { ok: false; pattern: string; fragment: string; hint: string };

export function scanContent(content: string): { ok: boolean; pattern?: string; fragment?: string; hint?: string } {
  // Invisible unicode first.
  for (const ch of INVISIBLE_CHARS) {
    const idx = content.indexOf(ch);
    if (idx >= 0) {
      const surrounding = content.slice(Math.max(0, idx - 20), Math.min(content.length, idx + 20));
      return {
        ok: false,
        pattern: `invisible_unicode_U+${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`,
        fragment: surrounding,
        hint: 'Caracter invisible detectado (posible payload). Re-escribe el contenido a mano.',
      };
    }
  }
  for (const p of THREAT_PATTERNS) {
    const m = content.match(p.rx);
    if (m) {
      const start = Math.max(0, (m.index ?? 0) - 20);
      const end = Math.min(content.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 20);
      return {
        ok: false,
        pattern: p.id,
        fragment: content.slice(start, end),
        hint: 'El contenido se inyecta al system prompt y no puede contener payloads de prompt injection o exfiltración. Reescribe la nota o reporta el falso positivo.',
      };
    }
  }
  return { ok: true };
}
