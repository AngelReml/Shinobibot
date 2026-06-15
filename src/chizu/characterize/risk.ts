/**
 * chizu/characterize/risk.ts — explicit, auditable risk rules (dossier §8.4).
 *
 * Risk is not decorative: dangerous/forbidden apps become PROTECTED RESOURCES of
 * the approval gate (§10) — the map arms the defence. Rules are transparent (each
 * RiskClass.reasons lists why) and fail-safe (when in doubt, raise the level).
 * Pure.
 */

import type { AppCategory, RiskClass } from '../types.js';

interface CategorySignal { category: AppCategory; patterns: RegExp[]; }

const CATEGORY_RULES: CategorySignal[] = [
  { category: 'finance', patterns: [/\b(bank|banco|caixa|bbva|santander|paypal|stripe|quickbooks|contabilidad|accounting|trading|broker|wallet|crypto|metamask|tax|impuesto)\b/i] },
  { category: 'communication', patterns: [/\b(outlook|thunderbird|gmail|mail|slack|discord|telegram|whatsapp|teams|zoom|skype|signal|messenger)\b/i] },
  { category: 'system', patterns: [/\b(regedit|gpedit|diskpart|diskmgmt|services\.msc|group ?policy|registry editor|partition|disk management|task manager|cmd|powershell|control panel)\b/i] },
  { category: 'browser', patterns: [/\b(chrome|firefox|edge|opera|brave|safari|comet|vivaldi|tor browser)\b/i] },
  { category: 'dev', patterns: [/\b(visual studio|vscode|git|node|python|docker|intellij|pycharm|webstorm|sublime|android studio|terminal|wsl)\b/i] },
  { category: 'design', patterns: [/\b(photoshop|illustrator|figma|gimp|inkscape|blender|affinity|canva|premiere|after effects|davinci)\b/i] },
  { category: 'office', patterns: [/\b(word|excel|powerpoint|onenote|libreoffice|openoffice|notion|obsidian|acrobat|office)\b/i] },
  { category: 'emulator', patterns: [/\b(emulator|retroarch|dolphin|pcsx|nes|snes|mame|bluestacks|qemu|virtualbox|vmware)\b/i] },
  { category: 'game', patterns: [/\b(steam|epic games|game|riot|battle\.net|minecraft|league of legends)\b/i] },
  { category: 'media', patterns: [/\b(vlc|spotify|media player|winamp|audacity|obs|youtube music|itunes)\b/i] },
];

export function inferCategory(name: string, publisher = ''): AppCategory {
  const hay = `${name} ${publisher}`;
  for (const r of CATEGORY_RULES) if (r.patterns.some((p) => p.test(hay))) return r.category;
  return 'other';
}

/** Classify risk from category + name. Fail-safe: ambiguity raises the level. */
export function classifyRisk(input: { name: string; publisher?: string; category?: AppCategory }): RiskClass {
  const cat = input.category ?? inferCategory(input.name, input.publisher);
  const reasons: string[] = [];
  let level: RiskClass['level'] = 'safe';

  switch (cat) {
    case 'system':
      level = 'forbidden'; reasons.push('system_admin'); break;
    case 'finance':
      level = 'dangerous'; reasons.push('financial', 'irreversible_data'); break;
    case 'communication':
      level = 'dangerous'; reasons.push('sends_on_your_behalf'); break;
    case 'office': case 'design':
      level = 'caution'; reasons.push('writes_user_files'); break;
    case 'emulator': case 'game': case 'media': case 'browser': case 'dev': case 'utility':
      level = 'safe'; break;
    default:
      level = 'caution'; reasons.push('unknown_category_fail_safe'); break;
  }

  // Name-level escalations independent of category (defense in depth).
  if (/\b(eraser|wipe|shred|format|partition|delete)\b/i.test(input.name)) {
    level = raise(level, 'dangerous'); reasons.push('irreversible_data');
  }

  const becomes_protected_resource = level === 'dangerous' || level === 'forbidden';
  return { level, reasons: [...new Set(reasons)], becomes_protected_resource };
}

function raise(cur: RiskClass['level'], to: RiskClass['level']): RiskClass['level'] {
  const order = ['safe', 'caution', 'dangerous', 'forbidden'];
  return order.indexOf(to) > order.indexOf(cur) ? to : cur;
}
