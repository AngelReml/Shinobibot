#!/usr/bin/env node
// fs.write.v1 — REAL write-authorization decision skill (deterministic, no effects).
//
// Decides whether a filesystem write to `path` is IN SCOPE. Protected paths
// (credentials, key material, VCS internals, OS dirs) are OUT of scope. This
// MIRRORS Shinobi's approval CRITICAL_PATH_PATTERNS (one policy; a drift-guard
// test pins the two together). It is a DECISION skill — it never writes; the
// Shinobi write_file tool is the executor, governed by this certified policy.
//
// I/O: scenario { path } on stdin → { allow, reason_code, detail } on stdout.

const PROTECTED = [
  { re: /[a-z]:\\Windows\\System32/i, why: 'Windows\\System32' },
  { re: /[a-z]:\\Windows(\\|$)/i, why: 'C:\\Windows' },
  { re: /[a-z]:\\Program Files/i, why: 'Program Files' },
  { re: /\\\.git\\(objects|refs|HEAD)/i, why: '.git internals' },
  { re: /(^|[\\/])\.env$/i, why: '.env credentials' },
  { re: /[\\/]\.ssh[\\/]/i, why: '.ssh keys directory' },
  { re: /\.(pem|key|crt|p12|pfx)$/i, why: 'credential/cert file' },
  { re: /^HKEY_LOCAL_MACHINE/i, why: 'HKLM registry' },
  { re: /^HKEY_CLASSES_ROOT/i, why: 'HKCR registry' },
];

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let s;
  try { s = JSON.parse(input); } catch { process.stdout.write('{"error":"unparseable input"}'); return; }
  const p = typeof s.path === 'string' ? s.path : '';
  const hit = PROTECTED.find((x) => x.re.test(p));
  const allow = !hit;
  const reason_code = allow ? 'OK' : 'PROTECTED_PATH';
  const detail = allow ? `write to "${p}" is in scope` : `write to "${p}" blocked: ${hit.why}`;
  process.stdout.write(JSON.stringify({ allow, reason_code, detail }));
});
