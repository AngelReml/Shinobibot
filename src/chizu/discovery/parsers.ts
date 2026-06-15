/**
 * chizu/discovery/parsers.ts — pure parsers for the read-only discovery sources
 * (dossier §6.2). The ENUMERATION (running PowerShell / winget) is the live
 * Windows part; the PARSING of its output is pure and testable with fixtures. The
 * modern, robust path is PowerShell → JSON (ConvertTo-Json), so registry/appx
 * parsers are JSON.parse + map; winget is columnar text.
 */

import type { RawApp } from '../types.js';

/** Parse `Get-ItemProperty ...Uninstall\* | Select ... | ConvertTo-Json`. */
export function parseUninstallJson(jsonText: string): RawApp[] {
  const rows = safeJsonArray(jsonText);
  const out: RawApp[] = [];
  for (const r of rows) {
    const name = str(r.DisplayName);
    if (!name) continue;                     // skip entries without a display name
    const exe = resolveExe(str(r.DisplayIcon), str(r.InstallLocation));
    out.push({ raw_name: name, raw_path: exe, meta: clean({ version: str(r.DisplayVersion), publisher: str(r.Publisher), install_location: str(r.InstallLocation) }) });
  }
  return out;
}

/** Parse `Get-AppxPackage | Select Name,Publisher,InstallLocation,PackageFamilyName | ConvertTo-Json`. */
export function parseAppxJson(jsonText: string): RawApp[] {
  const rows = safeJsonArray(jsonText);
  return rows.filter((r) => str(r.Name)).map((r) => ({
    raw_name: str(r.Name)!, raw_path: undefined,
    meta: clean({ publisher: str(r.Publisher), install_location: str(r.InstallLocation), package_family: str(r.PackageFamilyName) }),
  }));
}

/** Parse `winget list` columnar output (Name / Id / Version / Source). */
export function parseWingetList(text: string): RawApp[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headerIdx = lines.findIndex((l) => /^\s*Name\s+Id\s+Version/i.test(l));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx];
  const idCol = header.indexOf('Id');
  const verCol = header.indexOf('Version');
  const out: RawApp[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^[-\s]+$/.test(line)) continue;        // separator / blank
    const name = line.slice(0, idCol).trim();
    const id = line.slice(idCol, verCol).trim();
    const version = line.slice(verCol).trim().split(/\s+/)[0];
    if (!name) continue;
    out.push({ raw_name: name, meta: clean({ id, version }) });
  }
  return out;
}

function safeJsonArray(text: string): Record<string, any>[] {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : v ? [v] : []; } catch { return []; }
}
function str(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }
function resolveExe(displayIcon?: string, installLocation?: string): string | undefined {
  if (displayIcon) { const p = displayIcon.replace(/,\d+$/, '').replace(/"/g, '').trim(); if (/\.exe$/i.test(p)) return p; }
  return installLocation;
}
function clean(o: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v) out[k] = v;
  return out;
}
