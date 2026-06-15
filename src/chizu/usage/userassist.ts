/**
 * chizu/usage/userassist.ts — UserAssist decode (dossier §7.1). The classic source
 * of "most-run programs by this user": HKCU UserAssist Count entries with a ROT13
 * value NAME and a binary blob carrying run_count + last execution FILETIME. The
 * registry READ is the live (read-only, no-admin) part; the DECODE here is pure and
 * testable. Win7+ blob layout: run_count at offset 4 (u32 LE), last-exec FILETIME
 * at offset 60 (u64 LE, 100-ns since 1601).
 */

/** ROT13 — UserAssist value names are ROT13-obfuscated paths. */
export function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/** Decode a UserAssist value name (ROT13) back to its path/identifier. */
export function decodeUserAssistName(valueName: string): string {
  return rot13(valueName);
}

export interface UserAssistEntry { run_count: number; last_used?: string; }

/** FILETIME (100-ns ticks since 1601-01-01) → ISO date, or undefined if zero. */
export function filetimeToIso(ticks: bigint): string | undefined {
  if (ticks <= 0n) return undefined;
  const msSinceEpoch = ticks / 10_000n - 11_644_473_600_000n;
  const ms = Number(msSinceEpoch);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return new Date(ms).toISOString();
}

/** Parse the UserAssist Count binary blob (Win7+ layout). Degrades honestly: a
 *  too-short blob yields run_count 0 and no last_used, never a fabricated value. */
export function parseUserAssistBlob(buf: Buffer): UserAssistEntry {
  if (buf.length < 8) return { run_count: 0 };
  const run_count = buf.readUInt32LE(4);
  let last_used: string | undefined;
  if (buf.length >= 68) {
    const ft = buf.readBigUInt64LE(60);
    last_used = filetimeToIso(ft);
  }
  return { run_count, last_used };
}
