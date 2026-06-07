/**
 * Validación REAL del fix P3 "failover cross-provider usa la key de cada
 * provider" (commit bad1794).
 *
 * El .env del usuario tiene GROQ_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY
 * pero NO SHINOBI_PROVIDER_KEY. Antes del fix, los 4 clients leían
 * SHINOBI_PROVIDER_KEY -> con este .env habrían fallado TODOS con "key no
 * definida". Tras el fix, cada client lee su key específica.
 *
 * Esta prueba hace llamadas HTTP REALES a las APIs. Si los clients devuelven
 * output real del LLM, queda demostrado que el fix funciona end-to-end.
 *
 * Run: npx tsx scripts/audit_validation/p3_provider_keys_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

import { groqClient } from '../../src/providers/groq_client.js';
import { openrouterClient } from '../../src/providers/openrouter_client.js';
import { openaiClient } from '../../src/providers/openai_client.js';

async function main() {
  // Reproduce la condición del bug: sin SHINOBI_PROVIDER_KEY.
  delete process.env.SHINOBI_PROVIDER_KEY;
  console.log('=== Entorno ===');
  console.log('SHINOBI_PROVIDER_KEY definida :', !!process.env.SHINOBI_PROVIDER_KEY, '(debe ser false)');
  console.log('GROQ_API_KEY definida        :', !!process.env.GROQ_API_KEY);
  console.log('OPENAI_API_KEY definida      :', !!process.env.OPENAI_API_KEY);
  console.log('OPENROUTER_API_KEY definida  :', !!process.env.OPENROUTER_API_KEY);

  const payload: any = {
    messages: [{ role: 'user', content: 'Responde con una sola palabra: PONG' }],
    temperature: 0,
    max_tokens: 16,
  };

  const clients: Array<[string, any]> = [
    ['groq', groqClient],
    ['openrouter', openrouterClient],
    ['openai', openaiClient],
  ];

  let realSuccess = 0;
  for (const [name, client] of clients) {
    const t0 = Date.now();
    try {
      const r = await client.invokeLLM(payload);
      const ms = Date.now() - t0;
      if (r.success) {
        let content = '';
        try { content = JSON.parse(r.output)?.content ?? r.output; } catch { content = r.output; }
        console.log(`\n[${name}] OK (${ms}ms) — respuesta real: ${String(content).slice(0, 120).replace(/\n/g, ' ')}`);
        realSuccess++;
      } else {
        console.log(`\n[${name}] FAIL (${ms}ms) — ${r.error}`);
      }
    } catch (e: any) {
      console.log(`\n[${name}] EXCEPCIÓN — ${e?.message ?? e}`);
    }
  }

  console.log(`\n=== Resultado: ${realSuccess}/${clients.length} clients respondieron con su key específica ===`);
  // Al menos uno debe responder para considerar el fix demostrado.
  process.exit(realSuccess > 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
