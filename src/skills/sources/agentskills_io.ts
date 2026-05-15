/**
 * AgentSkillsSource — fuente https://agentskills.io (Hermes ecosystem).
 *
 * Vars:
 *   - AGENTSKILLS_IO_BASE_URL (opcional, default https://agentskills.io/api)
 *   - AGENTSKILLS_IO_API_KEY  (opcional; sin auth para read si la fuente lo permite)
 *
 * `fetchImpl` inyectable para tests.
 */

import type { FetchLike } from '../../memory/providers/mem0_provider.js';
import {
  SkillNotFoundError,
  type RemoteSkillMeta, type SkillBundle, type SkillSource,
} from './types.js';

export interface AgentSkillsOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike & ((url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>);
}

export class AgentSkillsSource implements SkillSource {
  readonly id = 'agentskills.io';
  readonly priority = 10;

  private baseUrl: string;
  private apiKey: string;
  private fetchImpl: any;

  constructor(opts: AgentSkillsOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.AGENTSKILLS_IO_BASE_URL ?? 'https://agentskills.io/api').replace(/\/$/, '');
    this.apiKey = opts.apiKey ?? process.env.AGENTSKILLS_IO_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return true; // public source, read es libre.
  }

  private headers(): Record<string, string> {
    return this.apiKey
      ? { 'authorization': `Bearer ${this.apiKey}`, 'accept': 'application/json' }
      : { 'accept': 'application/json' };
  }

  async search(query: string): Promise<RemoteSkillMeta[]> {
    const url = `${this.baseUrl}/skills?q=${encodeURIComponent(query)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : j.results ?? [];
    return arr.map((s: any): RemoteSkillMeta => ({
      name: s.name,
      version: s.version ?? '0.0.0',
      description: s.description ?? '',
      author: s.author,
      tags: s.tags,
      source: this.id,
      bundleUrl: s.bundleUrl ?? s.download_url,
      contentHash: s.content_hash ?? s.sha256,
    }));
  }

  async fetch(name: string, version?: string): Promise<SkillBundle> {
    const v = version ? `?version=${encodeURIComponent(version)}` : '';
    const res = await this.fetchImpl(`${this.baseUrl}/skills/${encodeURIComponent(name)}${v}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new SkillNotFoundError(name, this.id);
    const j = await res.json();
    if (typeof j.body !== 'string' || !j.body) {
      throw new Error(`agentskills.io: respuesta malformada para ${name}`);
    }
    return {
      manifest: {
        name: j.name ?? name,
        version: j.version ?? version ?? '0.0.0',
        description: j.description,
        author: j.author,
      },
      body: j.body,
      declaredHash: j.content_hash ?? j.sha256,
    };
  }
}
