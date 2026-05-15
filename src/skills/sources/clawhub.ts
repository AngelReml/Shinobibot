/**
 * ClawHubSource — fuente del marketplace ClawHub (OpenClaw ecosystem).
 *
 * Vars:
 *   - CLAWHUB_BASE_URL (opcional, default https://clawhub.dev/api)
 *   - CLAWHUB_API_KEY  (opcional)
 *
 * Mismo patrón que AgentSkillsSource: search + fetch + fetchImpl
 * inyectable.
 */

import type { FetchLike } from '../../memory/providers/mem0_provider.js';
import {
  SkillNotFoundError,
  type RemoteSkillMeta, type SkillBundle, type SkillSource,
} from './types.js';

export interface ClawHubOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike & any;
}

export class ClawHubSource implements SkillSource {
  readonly id = 'clawhub';
  readonly priority = 20;

  private baseUrl: string;
  private apiKey: string;
  private fetchImpl: any;

  constructor(opts: ClawHubOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.CLAWHUB_BASE_URL ?? 'https://clawhub.dev/api').replace(/\/$/, '');
    this.apiKey = opts.apiKey ?? process.env.CLAWHUB_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return true;
  }

  private headers(): Record<string, string> {
    return this.apiKey
      ? { 'x-api-key': this.apiKey, 'accept': 'application/json' }
      : { 'accept': 'application/json' };
  }

  async search(query: string): Promise<RemoteSkillMeta[]> {
    const url = `${this.baseUrl}/v1/skills/search?query=${encodeURIComponent(query)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : j.items ?? j.skills ?? [];
    return arr.map((s: any): RemoteSkillMeta => ({
      name: s.slug ?? s.name,
      version: s.version ?? 'latest',
      description: s.description ?? '',
      author: s.author ?? s.publisher,
      tags: s.tags,
      source: this.id,
      bundleUrl: s.tarball_url ?? s.bundleUrl,
      contentHash: s.integrity ?? s.sha256,
    }));
  }

  async fetch(name: string, version?: string): Promise<SkillBundle> {
    const path = version
      ? `/v1/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
      : `/v1/skills/${encodeURIComponent(name)}/latest`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) throw new SkillNotFoundError(name, this.id);
    const j = await res.json();
    if (typeof j.body !== 'string' || !j.body) {
      throw new Error(`clawhub: respuesta malformada para ${name}`);
    }
    return {
      manifest: {
        name: j.slug ?? j.name ?? name,
        version: j.version ?? version ?? 'latest',
        description: j.description,
        author: j.author,
      },
      body: j.body,
      declaredHash: j.integrity ?? j.sha256,
    };
  }
}
