/**
 * chizu/characterize/characterize.ts — M-09: STATIC characterization (dossier §7).
 * Decide, WITHOUT launching anything, how automatable a program looks: from a known
 * CLI/COM database, scripting-SDK hints, category, and a sandbox-feasibility verdict
 * inferred from install metadata. The DYNAMIC probe (launch→UIA→close) is M-11; here
 * everything is read-only inference, so uia stays 'unprobed' (honest — not measured).
 */

import { inferCategory } from './risk.js';
import type { Characterization, AppCategory } from '../types.js';

/** Apps/exes known to expose a CLI or COM automation surface (curated, conservative). */
const KNOWN_CLI = new Set(['git', 'node', 'python', 'ffmpeg', 'curl', 'docker', 'gh', '7z', 'pandoc', 'magick', 'yt-dlp', 'rg']);
const KNOWN_COM = new Set(['excel', 'word', 'powerpoint', 'outlook', 'acrobat', 'photoshop', 'illustrator']);
const KNOWN_SCRIPTING = new Set(['blender', 'photoshop', 'gimp', 'inkscape', 'autocad', 'fusion360', 'davinci']);

function token(name: string, exe?: string): string {
  const base = (exe ?? name).toLowerCase().replace(/\.exe$/, '');
  return base.split(/[\\/]/).pop() ?? base;
}

export interface CharacterizeInput {
  name: string;
  exe?: string;
  publisher?: string;
  install_type?: 'registry' | 'appx' | 'portable' | 'winget' | 'choco' | 'scoop' | 'unknown';
  category?: AppCategory;
}

/** Build a static Characterization (no process launched). */
export function characterizeStatic(inp: CharacterizeInput): Characterization {
  const t = token(inp.name, inp.exe);
  const category = inp.category ?? inferCategory(inp.name, inp.publisher);

  const cliKnown = [...KNOWN_CLI].some((k) => t === k || t.includes(k));
  const comKnown = [...KNOWN_COM].some((k) => t.includes(k));
  const scriptingKnown = [...KNOWN_SCRIPTING].some((k) => t.includes(k));

  // sandbox feasibility from install metadata (portable installs are the easy ones).
  const portable = inp.install_type === 'portable' || inp.install_type === 'scoop';
  const needs_install = inp.install_type === 'registry' || inp.install_type === 'winget' || inp.install_type === 'choco';
  const verdict: Characterization['sandbox']['verdict'] =
    portable ? 'easy' : needs_install ? 'hard' : 'unknown';

  return {
    cli: cliKnown ? { available: true, evidence: 'known_db' } : { available: 'unknown', evidence: 'none' },
    com_automation: comKnown ? true : 'unknown',
    scripting_sdk: scriptingKnown ? true : 'unknown',
    uia: { class: 'unprobed' },                       // dynamic — M-11, not measured here
    sandbox: { portable, needs_install, needs_network: 'unknown', needs_login: 'unknown', verdict },
  };
}
