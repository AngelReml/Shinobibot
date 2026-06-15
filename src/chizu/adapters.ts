/**
 * chizu/adapters.ts — M-03: the ⚠ ENGANCHE seams, verified against real signatures.
 * Discovery's ENUMERATION (running PowerShell/winget) is the live Windows part; the
 * PARSING is pure (parsers.ts). These adapters run the real read-only commands via
 * the sandbox backend and feed the existing parsers, and publish the map's risk to
 * the approval gate. Command execution is injectable → parsers tested without shell.
 */

import { sandboxRegistry } from '../sandbox/registry.js';
import { parseUninstallJson, parseAppxJson, parseWingetList } from './discovery/parsers.js';
import type { SourceBatch } from './discovery/fuse.js';
import type { AppCard, RawApp, DiscoverySourceName } from './types.js';

export type CmdRunner = (command: string, timeoutMs?: number) => Promise<{ success: boolean; stdout: string; stderr: string }>;

const defaultRunner: CmdRunner = async (command, timeoutMs = 60_000) => {
  const backend = sandboxRegistry().get('local');
  if (!backend) return { success: false, stdout: '', stderr: 'no local backend' };
  const r = await backend.run({ command, cwd: process.cwd(), timeoutMs });
  return { success: r.success, stdout: r.stdout, stderr: r.stderr };
};

/** The read-only PowerShell/winget commands per source (the live Windows seam). */
export const DISCOVERY_COMMANDS: Partial<Record<DiscoverySourceName, { command: string; parse: (s: string) => RawApp[] }>> = {
  registry_uninstall: {
    command: `powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Select DisplayName,DisplayVersion,Publisher,InstallLocation,DisplayIcon | ConvertTo-Json"`,
    parse: parseUninstallJson,
  },
  appx: {
    command: `powershell -NoProfile -Command "Get-AppxPackage | Select Name,Publisher,InstallLocation,PackageFamilyName | ConvertTo-Json"`,
    parse: parseAppxJson,
  },
  winget: { command: `winget list`, parse: parseWingetList },
};

/**
 * Run one discovery source (read-only) and parse it into a SourceBatch. On a
 * non-Windows box or a missing tool the command fails → an empty batch (honest:
 * "found nothing here", never invented entries).
 */
export async function discoverSource(source: DiscoverySourceName, run: CmdRunner = defaultRunner): Promise<SourceBatch> {
  const spec = DISCOVERY_COMMANDS[source];
  if (!spec) return { source, apps: [] };
  const r = await run(spec.command);
  if (!r.success || !r.stdout.trim()) return { source, apps: [] };
  try { return { source, apps: spec.parse(r.stdout) }; }
  catch { return { source, apps: [] }; }
}

export interface ProtectedResource { app_id: string; display_name: string; reasons: string[]; }

/**
 * ⚠ ENGANCHE approval gate: the AppCards that, by the risk rules, BECOME a protected
 * resource (dangerous/forbidden → becomes_protected_resource). The map arms the
 * defence: these are the apps the upper levels must guard the user from / never
 * automate blindly.
 */
export function protectedResources(cards: AppCard[]): ProtectedResource[] {
  return cards
    .filter((c) => c.risk.becomes_protected_resource)
    .map((c) => ({ app_id: c.app_id, display_name: c.display_name, reasons: c.risk.reasons }));
}
