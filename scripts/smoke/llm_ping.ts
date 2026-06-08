import { invokeLLM } from '../../src/providers/provider_router.js';
async function main() {
  console.log('[ping] provider =', process.env.SHINOBI_PROVIDER || '(default)');
  const t0 = Date.now();
  const r = await invokeLLM({ messages: [{ role: 'user', content: 'Responde solo: OK' }], temperature: 0 } as any);
  console.log('[ping] success =', r.success, ' provider =', r.resolvedProvider, ' ms =', Date.now()-t0);
  console.log('[ping] output =', String(r.output).slice(0,120));
  if (!r.success) { console.log('[ping] error =', r.error); process.exit(2); }
}
main().catch(e=>{ console.error('[ping] threw', e?.message ?? e); process.exit(1); });
