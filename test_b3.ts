import { MemoryStore } from './src/memory/memory_store.js';

async function main() {
  process.env.SHINOBI_API_KEY = process.env.SHINOBI_API_KEY || 'sk_dev_master';
  process.env.OPENGRAVITY_URL = process.env.OPENGRAVITY_URL || 'http://localhost:9900';

  const store = new MemoryStore({ db_path: './test_memory.db' });

  console.log('--- B3 TEST: store ---');
  const e1 = await store.store('Mi cliente principal es Mateo Pereira de Alier S.A., empresa de papel reciclado en España.', { category: 'business', tags: ['cliente', 'alier'], importance: 0.9 });
  const e2 = await store.store('Iván trabaja como camarero y construye AI en su tiempo libre.', { category: 'personal', tags: ['ivan'], importance: 0.7 });
  const e3 = await store.store('Shinobi es el agente local. OpenGravity es la infraestructura cloud.', { category: 'project', tags: ['arquitectura'], importance: 0.8 });
  console.log('Stored 3 entries:', e1.id, e2.id, e3.id);

  console.log('\n--- B3 TEST: recall semántico ---');
  const r1 = await store.recall({ query: 'quién es mi cliente', limit: 3 });
  console.log('Recall "quién es mi cliente":');
  r1.forEach(r => console.log(`  - [${r.score.toFixed(2)}] ${r.entry.content.substring(0, 80)}`));
  const test1Pass = r1.length > 0 && r1[0].entry.content.includes('Mateo');
  console.log('TEST 1:', test1Pass ? 'PASSED' : 'FAILED');

  console.log('\n--- B3 TEST: recall por categoría ---');
  const r2 = await store.recall({ query: 'arquitectura del sistema', category: 'project', limit: 3 });
  r2.forEach(r => console.log(`  - [${r.score.toFixed(2)}] ${r.entry.content.substring(0, 80)}`));
  const test2Pass = r2.length > 0 && r2[0].entry.content.includes('Shinobi');
  console.log('TEST 2:', test2Pass ? 'PASSED' : 'FAILED');

  console.log('\n--- B3 TEST: persistencia ---');
  const stats = store.stats();
  console.log('Stats:', stats);
  const test3Pass = stats.total >= 3;
  console.log('TEST 3:', test3Pass ? 'PASSED' : 'FAILED');

  console.log('\n--- B3 TEST: buildContextSection ---');
  const section = await store.buildContextSection('cuéntame sobre el cliente principal', 1500);
  console.log(section);
  const test4Pass = section.length > 0 && section.toLowerCase().includes('mateo');
  console.log('TEST 4:', test4Pass ? 'PASSED' : 'FAILED');

  console.log('\n--- B3 TEST: forget ---');
  const forgot = store.forget(e2.id);
  const statsAfter = store.stats();
  const test5Pass = forgot && statsAfter.total === stats.total - 1;
  console.log('TEST 5:', test5Pass ? 'PASSED' : 'FAILED');

  store.close();
  console.log('\n--- ALL TESTS DONE ---');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
