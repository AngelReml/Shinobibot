import { MissionsStore } from './src/persistence/missions_recurrent.js';
import { ResidentLoop } from './src/runtime/resident_loop.js';
import * as fs from 'fs';

const TEST_DB = './test_missions.db';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // limpieza
  for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log('--- B6 TEST ---\n');
  const store = new MissionsStore(TEST_DB);

  // T1: CRUD básico
  console.log('T1: CRUD básico');
  const m1 = store.create({ name: 'echo every 5s', prompt: 'Just respond with OK', cron_seconds: 5 });
  console.log(`  created: ${m1.id}`);
  const list = store.list();
  console.log(`  list count: ${list.length}`);
  console.log(`  T1: ${list.length === 1 ? 'PASSED' : 'FAILED'}\n`);

  // T2: getDueMissions inicialmente true (nunca corrió)
  console.log('T2: getDueMissions');
  const due = store.getDueMissions();
  console.log(`  due: ${due.length}`);
  console.log(`  T2: ${due.length === 1 ? 'PASSED' : 'FAILED'}\n`);

  // T3: recordRun success → ya no due
  console.log('T3: recordRun + dedupe');
  store.recordRun(m1.id, 'success', 'OK');
  const dueAfter = store.getDueMissions();
  console.log(`  due after run: ${dueAfter.length}`);
  console.log(`  T3: ${dueAfter.length === 0 ? 'PASSED' : 'FAILED'}\n`);

  // T4: tras esperar cron_seconds, vuelve a estar due
  console.log('T4: due tras cron transcurrido (espera 6s)');
  await sleep(6000);
  const dueLater = store.getDueMissions();
  console.log(`  due later: ${dueLater.length}`);
  console.log(`  T4: ${dueLater.length === 1 ? 'PASSED' : 'FAILED'}\n`);

  // T5: circuit breaker tras 3 failures
  console.log('T5: circuit breaker');
  store.recordRun(m1.id, 'failure', null, 'err1');
  store.recordRun(m1.id, 'failure', null, 'err2');
  store.recordRun(m1.id, 'failure', null, 'err3');
  const dueFails = store.getDueMissions();
  const updated = store.get(m1.id);
  console.log(`  consecutive_failures: ${updated?.consecutive_failures}`);
  console.log(`  due after 3 fails: ${dueFails.length} (esperado 0 por circuit breaker)`);
  console.log(`  T5: ${dueFails.length === 0 && updated?.consecutive_failures === 3 ? 'PASSED' : 'FAILED'}\n`);

  // T6: resetFailures vuelve a habilitar (needs to wait for cron interval)
  console.log('T6: reset failures (espera 6s para cron)');
  store.resetFailures(m1.id);
  await sleep(6000);
  const dueReset = store.getDueMissions();
  console.log(`  due after reset+wait: ${dueReset.length}`);
  console.log(`  T6: ${dueReset.length === 1 ? 'PASSED' : 'FAILED'}\n`);

  // T7: logs persistidos
  console.log('T7: logs persistidos');
  const logs = store.getRecentLogs(m1.id, 10);
  console.log(`  logs count: ${logs.length}`);
  console.log(`  T7: ${logs.length === 4 ? 'PASSED' : 'FAILED — esperado 4 (1 success + 3 failures)'}\n`);

  store.close();

  // T8: ResidentLoop start/stop sin colgarse
  console.log('T8: ResidentLoop start/stop');
  const loop = new ResidentLoop(new MissionsStore(TEST_DB));
  loop.start();
  await sleep(500);
  const wasRunning = loop.isRunning();
  loop.stop();
  await sleep(200);
  const stillRunning = loop.isRunning();
  console.log(`  was running: ${wasRunning} | still running: ${stillRunning}`);
  console.log(`  T8: ${wasRunning && !stillRunning ? 'PASSED' : 'FAILED'}\n`);

  // limpieza
  loop.getStore().close();
  for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log('--- ALL DONE ---');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
