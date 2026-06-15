/**
 * chizu/types.ts — data model (dossier §5). Pure types. Reuses the §11.3 Origin
 * enum for provenance: every field of the map says which source produced it and
 * how it was measured. A field measured by running (`help_probe`) is stronger
 * than one inferred from prior knowledge (`known_db`), and the map says so.
 */

import type { Origin } from '../integrity/provenance.js';

export interface Provenance {
  origin: Origin;
  channel: string;            // discovery/usage source
  source_url?: string;
  retrieved_at: string;
  trust_tier: 0 | 1 | 2 | 3;
  session_seq: number;
}

export type DiscoverySourceName =
  | 'registry_uninstall' | 'registry_apppaths' | 'start_menu'
  | 'appx' | 'winget' | 'choco' | 'scoop' | 'path_scan' | 'programfiles_scan';

export interface DiscoverySource {
  source: DiscoverySourceName;
  raw_name: string;
  raw_path?: string;
  confidence: number;
}

export interface RawApp { raw_name: string; raw_path?: string; meta: Record<string, string>; }

export type InstallType = 'registry' | 'store_msix' | 'package_manager' | 'portable' | 'shortcut_only' | 'unknown';

export type AppCategory =
  | 'browser' | 'office' | 'design' | 'dev' | 'emulator' | 'media'
  | 'communication' | 'finance' | 'system' | 'game' | 'utility' | 'other';

export interface UsageSignal {
  run_count?: number;
  last_used?: string;
  recency_days?: number;
  usage_score: number;        // 0..1
  signal_sources: ('userassist' | 'prefetch' | 'jumplist' | 'live_sample')[];
}

export interface Characterization {
  cli: { available: boolean | 'unknown'; evidence: 'help_probe' | 'known_db' | 'com_registered' | 'none'; notes?: string };
  com_automation: boolean | 'unknown';
  scripting_sdk: boolean | 'unknown';
  uia: { class: 'rich' | 'poor' | 'opaque' | 'unprobed'; control_count?: number; named_ratio?: number };
  sandbox: { portable: boolean | 'unknown'; needs_install: boolean | 'unknown'; needs_network: boolean | 'unknown'; needs_login: boolean | 'unknown'; verdict: 'easy' | 'hard' | 'unsafe' | 'unknown' };
}

export type RiskLevel = 'safe' | 'caution' | 'dangerous' | 'forbidden';

export interface RiskClass {
  level: RiskLevel;
  reasons: string[];          // "financial" | "irreversible_data" | "sends_on_your_behalf" | "system_admin"
  becomes_protected_resource: boolean;
}

export interface AppCard {
  app_id: string;             // canonical identity (hash of normalized exe path)
  display_name: string;
  publisher?: string;
  version?: string;
  install_location?: string;
  primary_executable?: string;
  install_type: InstallType;
  discovered_by: DiscoverySource[];
  usage: UsageSignal;
  characterization: Characterization;
  category: AppCategory;
  risk: RiskClass;
  automation_candidate_score: number;
  provenance: Provenance;
  mapped_at: string;
  discrepancies?: string[];   // recorded, never hidden (§6.3)
}

export interface AtlasQueryFilter {
  category?: AppCategory;
  minUsage?: number;
  automatable?: boolean;
  maxRisk?: RiskLevel;
}
