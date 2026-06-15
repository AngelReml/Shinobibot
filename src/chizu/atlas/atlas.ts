/**
 * chizu/atlas/atlas.ts — the consolidated map + its visual portrait (dossier §9).
 * Queryable by the upper levels (Kagami, Shugyo, Mayordomo). The render shows the
 * four views (usage / category / automatability / risk) and the prioritized list
 * of Level-4 candidates. Pure (rendering is string-building; persistence is the
 * store's job).
 */

import type { AppCard, AtlasQueryFilter, RiskLevel } from '../types.js';

const RISK_ORDER: RiskLevel[] = ['safe', 'caution', 'dangerous', 'forbidden'];

export class Atlas {
  constructor(private cards: AppCard[]) {}

  get(appId: string): AppCard | null { return this.cards.find((c) => c.app_id === appId) ?? null; }

  query(filter: AtlasQueryFilter = {}): AppCard[] {
    return this.cards.filter((c) => {
      if (filter.category && c.category !== filter.category) return false;
      if (filter.minUsage != null && c.usage.usage_score < filter.minUsage) return false;
      if (filter.automatable != null) {
        const auto = c.characterization.cli.available === true || c.characterization.com_automation === true || c.characterization.uia.class === 'rich';
        if (auto !== filter.automatable) return false;
      }
      if (filter.maxRisk && RISK_ORDER.indexOf(c.risk.level) > RISK_ORDER.indexOf(filter.maxRisk)) return false;
      return true;
    });
  }

  /** Level-4 targets: never dangerous/forbidden, ordered by automation_candidate_score. */
  candidatesForExplorer(): AppCard[] {
    return this.cards
      .filter((c) => c.risk.level === 'safe' || c.risk.level === 'caution')
      .sort((a, b) => b.automation_candidate_score - a.automation_candidate_score);
  }

  /** Markdown portrait with the four views (a render to HTML is a trivial wrapper). */
  renderMarkdown(scanId: string): string {
    const L: string[] = [`# Atlas de la máquina — ${scanId}`, '', `Programas mapeados: **${this.cards.length}** (cero inventados — cada uno con fuente).`, ''];
    L.push('## Por uso (lo que vives)');
    for (const c of [...this.cards].sort((a, b) => b.usage.usage_score - a.usage.usage_score).slice(0, 15))
      L.push(`- ${c.display_name} — uso ${(c.usage.usage_score * 100).toFixed(0)}%${c.usage.run_count != null ? ` (${c.usage.run_count}×)` : ''}`);
    L.push('', '## Por automatizabilidad');
    for (const c of this.cards) {
      const via = c.characterization.cli.available === true || c.characterization.com_automation === true ? '🟢 CLI/COM'
        : c.characterization.uia.class === 'rich' ? '🟡 UIA-rich' : c.characterization.uia.class === 'opaque' ? '🔴 opaco' : '⚪ sin sondear';
      L.push(`- ${c.display_name}: ${via}`);
    }
    L.push('', '## Por riesgo (qué proteger de ti mismo)');
    for (const c of this.cards.filter((c) => c.risk.level !== 'safe'))
      L.push(`- ${c.display_name}: **${c.risk.level}**${c.risk.becomes_protected_resource ? ' 🛡 recurso protegido' : ''} — ${c.risk.reasons.join(', ')}`);
    L.push('', '## Candidatos para el Explorador (Nivel 4)');
    for (const c of this.candidatesForExplorer().slice(0, 10))
      L.push(`- ${c.display_name} — score ${(c.automation_candidate_score * 100).toFixed(0)}%`);
    L.push('', '_No dibujé una sola calle que no haya pisado._');
    return L.join('\n') + '\n';
  }
}
