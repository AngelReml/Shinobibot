/**
 * chizu/discovery/fuse.ts — multi-source fusion + honest dedup (dossier §6.3).
 *
 * No source is complete (registry misses portables; shortcuts miss launcher-less
 * tools). Combine several, dedup by CANONICAL identity (normalized primary exe, or
 * normalized name when there's no exe — Store apps). One app seen by N sources →
 * ONE AppCard with discovered_by = all N. Discrepancies (two versions/paths) are
 * RECORDED, not silently resolved. Zero invented entries. Pure.
 */

import * as crypto from 'node:crypto';
import type { AppCard, DiscoverySource, DiscoverySourceName, InstallType, Provenance, RawApp } from '../types.js';

export interface SourceBatch { source: DiscoverySourceName; apps: RawApp[]; }

/** Normalize an executable path for canonical identity. */
export function normalizeExe(p?: string): string | null {
  if (!p) return null;
  let s = p.trim().toLowerCase().replace(/\\/g, '/').replace(/"/g, '');
  // strip trailing args / icon index (DisplayIcon often is "path.exe,0")
  s = s.replace(/,\d+$/, '');
  return s || null;
}

function normalizeName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\(.*?\)\s*$/, '');
}

const SOURCE_CONFIDENCE: Record<DiscoverySourceName, number> = {
  registry_uninstall: 0.9, registry_apppaths: 0.85, appx: 0.95, winget: 0.9, choco: 0.85, scoop: 0.85,
  start_menu: 0.6, path_scan: 0.7, programfiles_scan: 0.5,
};

function installTypeFor(sources: DiscoverySourceName[]): InstallType {
  if (sources.includes('appx')) return 'store_msix';
  if (sources.includes('registry_uninstall') || sources.includes('registry_apppaths')) return 'registry';
  if (sources.includes('winget') || sources.includes('choco') || sources.includes('scoop')) return 'package_manager';
  if (sources.includes('programfiles_scan') || sources.includes('path_scan')) return 'portable';
  if (sources.includes('start_menu')) return 'shortcut_only';
  return 'unknown';
}

function appId(exe: string | null, name: string): string {
  const key = exe ?? `name:${normalizeName(name)}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Fuse raw discovery results into deduplicated AppCards. */
export function fuse(batches: SourceBatch[], opts: { retrievedAt: string; sessionSeq?: number } = { retrievedAt: '' }): AppCard[] {
  const byId = new Map<string, AppCard>();
  for (const batch of batches) {
    for (const raw of batch.apps) {
      const exe = normalizeExe(raw.raw_path);
      const id = appId(exe, raw.raw_name);
      const ds: DiscoverySource = { source: batch.source, raw_name: raw.raw_name, raw_path: raw.raw_path, confidence: SOURCE_CONFIDENCE[batch.source] ?? 0.5 };
      const existing = byId.get(id);
      if (existing) {
        existing.discovered_by.push(ds);
        // record discrepancies, never hide them
        if (raw.meta.version && existing.version && raw.meta.version !== existing.version) {
          (existing.discrepancies ??= []).push(`version: ${existing.version} vs ${raw.meta.version} (${batch.source})`);
        }
        if (!existing.publisher && raw.meta.publisher) existing.publisher = raw.meta.publisher;
        if (!existing.version && raw.meta.version) existing.version = raw.meta.version;
        existing.install_type = installTypeFor(existing.discovered_by.map((d) => d.source));
      } else {
        const provenance: Provenance = { origin: 'TOOL_INTERNAL', channel: batch.source, retrieved_at: opts.retrievedAt, trust_tier: 2, session_seq: opts.sessionSeq ?? 0 };
        byId.set(id, {
          app_id: id, display_name: raw.raw_name, publisher: raw.meta.publisher, version: raw.meta.version,
          install_location: raw.meta.install_location, primary_executable: exe ?? undefined,
          install_type: installTypeFor([batch.source]), discovered_by: [ds],
          usage: { usage_score: 0, signal_sources: [] },
          characterization: { cli: { available: 'unknown', evidence: 'none' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: 'unknown', needs_install: 'unknown', needs_network: 'unknown', needs_login: 'unknown', verdict: 'unknown' } },
          category: 'other', risk: { level: 'safe', reasons: [], becomes_protected_resource: false },
          automation_candidate_score: 0, provenance, mapped_at: opts.retrievedAt,
        });
      }
    }
  }
  return [...byId.values()];
}
