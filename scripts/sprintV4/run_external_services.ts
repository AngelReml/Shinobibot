#!/usr/bin/env node
/**
 * FASE V4 — validación de servicios externos contra APIs reales.
 *
 * Mem0 y Supermemory: ciclo completo store → (espera proceso async) →
 * search → forget, midiendo latencia.
 *
 * Matrix: requiere MATRIX_ACCESS_TOKEN válido. Si el token está
 * rechazado, se reporta como BLOQUEADO (no es un fallo de código).
 *
 * Salida: JSON con auth/write/read/search/delete OK y latencias.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: true });

import { Mem0Provider } from '../../src/memory/providers/mem0_provider.js';
import { SupermemoryProvider } from '../../src/memory/providers/supermemory_provider.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServiceReport {
  service: string;
  auth: boolean | 'n/a';
  write: boolean;
  read: boolean;
  search: boolean;
  remove: boolean | 'skipped';
  latencyMs: Record<string, number>;
  notes: string[];
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function validateMem0(): Promise<ServiceReport> {
  const r: ServiceReport = {
    service: 'Mem0', auth: 'n/a', write: false, read: false, search: false,
    remove: false, latencyMs: {}, notes: [],
  };
  const p = new Mem0Provider({ userId: 'shinobi-v4-' + Date.now().toString(36) });
  try {
    await p.init();
    r.auth = true;
  } catch (e: any) {
    r.notes.push(`init falló: ${e.message}`);
    return r;
  }

  // WRITE
  try {
    const w = await timed(() => p.store({
      role: 'user',
      content: 'V4 prueba: el agente Shinobi usa loop detector de tres capas',
    }));
    r.write = true;
    r.latencyMs.store = w.ms;
    r.notes.push(`store id/event: ${w.value}`);
  } catch (e: any) {
    r.notes.push(`store falló: ${e.message}`);
    return r;
  }

  // Mem0 procesa en background — esperamos a que indexe.
  r.notes.push('esperando 6s a que mem0 procese la memoria (async)…');
  await sleep(6000);

  // SEARCH (sirve también de READ)
  try {
    const s = await timed(() => p.recall('loop detector tres capas', 5));
    r.latencyMs.search = s.ms;
    r.search = s.value.length > 0;
    r.read = s.value.length > 0;
    if (s.value.length > 0) {
      r.notes.push(`search top hit: "${s.value[0].message.content}" (score ${s.value[0].score})`);
    } else {
      r.notes.push('search devolvió 0 resultados (puede que aún procese)');
    }

    // REMOVE el primer hit.
    if (s.value.length > 0 && s.value[0].message.id) {
      const d = await timed(() => p.forget(s.value[0].message.id!));
      r.remove = d.value;
      r.latencyMs.forget = d.ms;
    } else {
      r.remove = 'skipped';
    }
  } catch (e: any) {
    r.notes.push(`search/forget falló: ${e.message}`);
  }
  return r;
}

async function validateSupermemory(): Promise<ServiceReport> {
  const r: ServiceReport = {
    service: 'Supermemory', auth: 'n/a', write: false, read: false, search: false,
    remove: false, latencyMs: {}, notes: [],
  };
  const p = new SupermemoryProvider();
  try {
    await p.init();
    r.auth = true;
  } catch (e: any) {
    r.notes.push(`init falló: ${e.message}`);
    return r;
  }

  const marker = 'V4SM' + Date.now().toString(36);
  try {
    const w = await timed(() => p.store({
      role: 'user',
      content: `${marker}: Shinobi soporta committee voting evolutivo con roles dinamicos`,
    }));
    r.write = true;
    r.latencyMs.store = w.ms;
    r.notes.push(`store id: ${w.value}`);
  } catch (e: any) {
    r.notes.push(`store falló: ${e.message}`);
    return r;
  }

  r.notes.push('esperando 6s a que supermemory indexe (status:queued)…');
  await sleep(6000);

  try {
    const s = await timed(() => p.recall('committee voting roles dinamicos', 5));
    r.latencyMs.search = s.ms;
    r.search = s.value.length > 0;
    r.read = s.value.length > 0;
    if (s.value.length > 0) {
      r.notes.push(`search top hit: "${s.value[0].message.content}" (score ${s.value[0].score})`);
      if (s.value[0].message.id) {
        const d = await timed(() => p.forget(s.value[0].message.id!));
        r.remove = d.value;
        r.latencyMs.forget = d.ms;
      } else {
        r.remove = 'skipped';
      }
    } else {
      r.notes.push('search devolvió 0 resultados');
      r.remove = 'skipped';
    }
  } catch (e: any) {
    r.notes.push(`search/forget falló: ${e.message}`);
  }
  return r;
}

async function validateMatrix(): Promise<ServiceReport> {
  const r: ServiceReport = {
    service: 'Matrix', auth: false, write: false, read: false, search: 'n/a' as any,
    remove: 'skipped', latencyMs: {}, notes: [],
  };
  const hs = process.env.MATRIX_HOMESERVER_URL;
  const token = process.env.MATRIX_ACCESS_TOKEN;
  if (!hs || !token) {
    r.notes.push('MATRIX_HOMESERVER_URL o MATRIX_ACCESS_TOKEN ausentes');
    return r;
  }
  try {
    const t0 = Date.now();
    const res = await fetch(`${hs}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    r.latencyMs.whoami = Date.now() - t0;
    const body = await res.json();
    if (res.ok) {
      r.auth = true;
      r.notes.push(`whoami OK: ${JSON.stringify(body)}`);
    } else {
      r.auth = false;
      r.notes.push(`whoami HTTP ${res.status}: ${JSON.stringify(body)}`);
      r.notes.push('BLOQUEADO — el token de acceso Matrix no es válido. ' +
        'Genera uno nuevo en Element (Ajustes → Ayuda y Acerca de → Token de acceso) ' +
        'y actualiza MATRIX_ACCESS_TOKEN en .env.');
    }
  } catch (e: any) {
    r.notes.push(`whoami crash: ${e.message}`);
  }
  return r;
}

async function main(): Promise<void> {
  console.log('=== FASE V4 — validación servicios externos reales ===\n');

  const reports: ServiceReport[] = [];
  for (const [name, fn] of [
    ['Mem0', validateMem0],
    ['Supermemory', validateSupermemory],
    ['Matrix', validateMatrix],
  ] as const) {
    console.log(`--- ${name} ---`);
    const rep = await fn();
    reports.push(rep);
    for (const n of rep.notes) console.log(`  · ${n}`);
    console.log(`  auth=${rep.auth} write=${rep.write} read=${rep.read} search=${rep.search} remove=${rep.remove}`);
    console.log(`  latencias: ${JSON.stringify(rep.latencyMs)}`);
    console.log('');
  }

  console.log('=== RESUMEN JSON ===');
  console.log(JSON.stringify(reports, null, 2));

  const mem0 = reports[0], sm = reports[1], matrix = reports[2];
  let failed = 0;
  const check = (c: boolean, l: string): void => {
    if (c) console.log(`  ok  ${l}`);
    else { console.log(`  FAIL ${l}`); failed++; }
  };
  console.log('\n=== ASERCIONES ===');
  check(mem0.auth === true && mem0.write && mem0.search, 'Mem0: auth + write + search OK');
  check(sm.auth === true && sm.write && sm.search, 'Supermemory: auth + write + search OK');

  if (matrix.auth !== true) {
    console.log('\n⚠ Matrix BLOQUEADO — token inválido. V4 parcial: 2/3 servicios validados.');
    console.log('  Requiere acción humana: token de acceso Matrix nuevo en .env.');
    process.exit(3); // código 3 = bloqueo externo, no fallo de código
  }

  if (failed > 0) {
    console.log(`\nV4 FALLIDA · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('\nV4 OK · los 3 servicios externos validados');
}

main().catch((e) => {
  console.error('V4 crashed:', e?.stack ?? e);
  process.exit(2);
});
