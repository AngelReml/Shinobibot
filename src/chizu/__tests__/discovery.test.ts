import { describe, it, expect } from 'vitest';
import { parseUninstallJson, parseAppxJson, parseWingetList } from '../discovery/parsers.js';
import { rot13, decodeUserAssistName, parseUserAssistBlob, filetimeToIso } from '../usage/userassist.js';

describe('M-04/M-05 — discovery parsers (pure; enumeration is the live part)', () => {
  it('parseUninstallJson maps DisplayName/Version/Publisher + resolves exe from DisplayIcon', () => {
    const json = JSON.stringify([
      { DisplayName: 'Acme', DisplayVersion: '1.2', Publisher: 'Acme Inc', DisplayIcon: 'C:\\Program Files\\Acme\\acme.exe,0', InstallLocation: 'C:\\Program Files\\Acme' },
      { DisplayVersion: '9' },   // no name → skipped
    ]);
    const apps = parseUninstallJson(json);
    expect(apps.length).toBe(1);
    expect(apps[0].raw_name).toBe('Acme');
    expect(apps[0].raw_path).toBe('C:\\Program Files\\Acme\\acme.exe');
    expect(apps[0].meta.version).toBe('1.2');
  });
  it('parseWingetList parses columnar output', () => {
    const text = [
      'Name                 Id                      Version    Source',
      '-----------------------------------------------------------------',
      'Git                  Git.Git                 2.40.0     winget',
      'Node.js              OpenJS.NodeJS           20.0.0     winget',
    ].join('\n');
    const apps = parseWingetList(text);
    expect(apps.map((a) => a.raw_name)).toEqual(['Git', 'Node.js']);
    expect(apps[0].meta.id).toBe('Git.Git');
    expect(apps[0].meta.version).toBe('2.40.0');
  });
  it('parseAppxJson lists Store apps with their PackageFamilyName', () => {
    const apps = parseAppxJson(JSON.stringify([{ Name: 'Microsoft.WindowsTerminal', Publisher: 'CN=Microsoft', PackageFamilyName: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe' }]));
    expect(apps[0].raw_name).toBe('Microsoft.WindowsTerminal');
    expect(apps[0].meta.package_family).toContain('8wekyb3d8bbwe');
  });
});

describe('M-07 — UserAssist decode (pure)', () => {
  it('ROT13 round-trips and decodes a known name', () => {
    expect(rot13('Hello')).toBe('Uryyb');
    expect(rot13(rot13('chrome.exe'))).toBe('chrome.exe');
    expect(decodeUserAssistName('{S-1-5-21}')).toBe('{F-1-5-21}'); // digits/symbols untouched, letters rotated
  });
  it('parseUserAssistBlob reads run_count (offset 4) and last-exec FILETIME (offset 60)', () => {
    const iso = '2026-03-15T10:00:00.000Z';
    const ticks = BigInt(Date.parse(iso) + 11_644_473_600_000) * 10_000n;
    const buf = Buffer.alloc(72);
    buf.writeUInt32LE(42, 4);
    buf.writeBigUInt64LE(ticks, 60);
    const e = parseUserAssistBlob(buf);
    expect(e.run_count).toBe(42);
    expect(e.last_used).toBe(iso);
  });
  it('a too-short blob degrades honestly (run_count 0, no last_used) — no fabrication', () => {
    const e = parseUserAssistBlob(Buffer.alloc(4));
    expect(e.run_count).toBe(0);
    expect(e.last_used).toBeUndefined();
  });
});
