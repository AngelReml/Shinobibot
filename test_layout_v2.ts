// test_layout_v2.ts
//
// Bloque 8.2 — E2E hermético del layout triple + chat rediseñado.
// Cubre:
//   A. Migration idempotente (DB con web_chat_messages legacy → Conversación inicial)
//   B. REST: conversations CRUD
//   C. Render del layout 3-col en el browser
//   D. Sidebar collapse/expand
//   E. Enviar mensaje → final aparece sin burbuja, filete agente con color del accent
//   F. Watermark desvanece tras tener contenido
//   G. Theme change recolorea filete del agente
//   H. Auto-title tras 3 mensajes (mock LLM con respuesta de título)
//
// Patrón usado:
//   - Sandbox tmp + APPDATA scoping (igual que test_design_system)
//   - Mock LLM via (OpenGravityClient as any).invokeLLM
//   - Playwright Chromium bundled
//
// Uso:
//   npx tsx test_layout_v2.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { chromium, type Browser, type Page } from 'playwright';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-layout-test-'));
process.env.APPDATA = sandbox;
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Pre-popular config.json para bypass del onboarding gate. Sin esto el server
// sirve onboarding.html en `/` y no carga el index.html del Bloque 8.2.
const shinobiDir = path.join(sandbox, 'Shinobi');
fs.mkdirSync(shinobiDir, { recursive: true });
fs.writeFileSync(path.join(shinobiDir, 'config.json'), JSON.stringify({
  opengravity_api_key: 'test-key',
  opengravity_url: 'https://test.example/api',
  language: 'es',
  memory_path: path.join(shinobiDir, 'memory'),
  onboarded_at: new Date().toISOString(),
  version: '2.0.0',
}, null, 2));

// ─── Mock LLM antes de importar server ─────────────────────────────────────
//
// Estrategia: cada llamada al LLM devuelve una respuesta determinista.
// Para auto-title, devolvemos un título reconocible "Test Auto Title Generado"
// cuando detectamos el prompt del sistema "generador de títulos". Para el
// orchestrator normal, devolvemos respuestas ligeras.

let titleCallCount = 0;
let processCallCount = 0;

const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
(OpenGravityClient as any).invokeLLM = async (payload: any) => {
  // Detectar prompt de auto-title: contiene "generador de títulos"
  const sys = (payload?.messages?.[0]?.content || '') as string;
  if (sys.toLowerCase().includes('generador de títulos')) {
    titleCallCount += 1;
    return { success: true, output: JSON.stringify({ role: 'assistant', content: 'Título Generado Auto' }), error: '' };
  }
  processCallCount += 1;
  return { success: true, output: JSON.stringify({ role: 'assistant', content: `respuesta ${processCallCount}` }), error: '' };
};

// Mock orchestrator process to return predictable output (avoids tool routing).
const orchModule = await import('./src/coordinator/orchestrator.js');
(orchModule.ShinobiOrchestrator as any).process = async (text: string) => {
  return { response: `Eco: **${text.slice(0, 40)}**` };
};

const { startWebServer } = await import('./src/web/server.js');

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} [${ms}ms] ${name} — ${detail}`);
}

// ─── A. Migration idempotente (puro Node, sin browser) ─────────────────────
async function testMigration(): Promise<void> {
  const t0 = Date.now();
  const dbPath = path.join(sandbox, 'migration_test.db');
  // Crear DB con esquema LEGACY (sin conversation_id, sin tabla conversations)
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE web_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking_json TEXT,
      ts TEXT NOT NULL
    );
  `);
  // Insertar mensajes huérfanos
  const stmt = db.prepare('INSERT INTO web_chat_messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)');
  stmt.run('a', 's1', 'user', 'hola', '2026-04-01T10:00:00Z');
  stmt.run('b', 's1', 'agent', 'eco', '2026-04-01T10:00:01Z');
  stmt.run('c', 's2', 'user', 'otro session', '2026-04-02T10:00:00Z');
  db.close();

  // Abrir con ChatStore — debe migrar
  const { ChatStore } = await import('./src/web/chat_store.js');
  const store = new ChatStore(dbPath);
  const convs = store.listConversations();
  const initialConv = convs.find(c => c.title === 'Conversación inicial');
  const passA1 = convs.length === 1 && !!initialConv;

  // Verificar que los 3 mensajes legacy tienen conversation_id = initial.id
  const db2 = new Database(dbPath, { readonly: true });
  const orphans = (db2.prepare('SELECT COUNT(*) AS c FROM web_chat_messages WHERE conversation_id IS NULL').get() as { c: number }).c;
  const linked = (db2.prepare('SELECT COUNT(*) AS c FROM web_chat_messages WHERE conversation_id = ?').get(initialConv?.id) as { c: number }).c;
  db2.close();
  const passA2 = orphans === 0 && linked === 3;

  // Reabrir con ChatStore una 2a vez — debe ser idempotente (no crear otra conv)
  const store2 = new ChatStore(dbPath);
  const convs2 = store2.listConversations();
  const passA3 = convs2.length === 1;

  const pass = passA1 && passA2 && passA3;
  record('A. Migration legacy → "Conversación inicial" idempotente', pass,
    `convs=${convs.length}, orphans=${orphans}, linked=${linked}, idempotent=${passA3}`, t0);
}

// ─── Tests con server arrancado ───────────────────────────────────────────
async function main() {
  await testMigration();

  const PORT = 14201;
  await startWebServer({ port: PORT, dbPath: path.join(sandbox, 'web_chat.db') });
  await new Promise(r => setTimeout(r, 200));

  // ─── B. REST conversations CRUD ─────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      // List initial (debe estar vacío)
      let r = await fetch(`http://127.0.0.1:${PORT}/api/conversations`);
      let data: any = await r.json();
      const startCount = data.conversations.length;

      // Create
      r = await fetch(`http://127.0.0.1:${PORT}/api/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Mi conversación' }),
      });
      data = await r.json();
      const created = data.conversation;

      // List again — debe haber +1
      r = await fetch(`http://127.0.0.1:${PORT}/api/conversations`);
      data = await r.json();
      const afterCreate = data.conversations.length;

      // PATCH title
      r = await fetch(`http://127.0.0.1:${PORT}/api/conversations/${encodeURIComponent(created.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renombrada' }),
      });
      const patchOk = r.ok;

      // GET messages (vacío)
      r = await fetch(`http://127.0.0.1:${PORT}/api/conversations/${encodeURIComponent(created.id)}/messages`);
      data = await r.json();
      const msgsCount = data.messages?.length ?? -1;

      // DELETE
      r = await fetch(`http://127.0.0.1:${PORT}/api/conversations/${encodeURIComponent(created.id)}`, { method: 'DELETE' });
      const delOk = r.ok;

      const pass = afterCreate === startCount + 1 && patchOk && msgsCount === 0 && delOk;
      record('B. REST conversations CRUD', pass,
        `start=${startCount}, afterCreate=${afterCreate}, patch=${patchOk}, msgs=${msgsCount}, del=${delOk}`, t0);
    } catch (e: any) {
      record('B. REST conversations CRUD', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── Browser tests ──────────────────────────────────────────────────────
  console.log('[test] launching headless Chromium...');
  const browser: Browser = await chromium.launch({ headless: true });

  async function killTransitions(p: Page) {
    await p.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation: none !important; }',
    });
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // Capturar errores de browser para diagnosticar fallos.
    page.on('pageerror', err => console.log(`[browser-error] ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[browser-${msg.type()}] ${msg.text()}`);
      }
    });

    // ─── C. Layout 3-col render ──────────────────────────────────────────
    {
      const t0 = Date.now();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForSelector('.dojo', { timeout: 5000 });
        const dims = await page.evaluate(() => {
          const sb = document.querySelector('.sidebar') as HTMLElement;
          const ce = document.querySelector('.center') as HTMLElement;
          const rp = document.querySelector('.right-panel') as HTMLElement;
          return {
            sidebar: sb?.offsetWidth ?? 0,
            center: ce?.offsetWidth ?? 0,
            right: rp?.offsetWidth ?? 0,
            theme: document.documentElement.getAttribute('data-theme'),
          };
        });
        const pass = dims.sidebar > 200 && dims.sidebar < 320 && dims.center > 600 && dims.theme === 'sumi';
        record('C. Layout 3-col + tema sumi', pass, JSON.stringify(dims), t0);
      } catch (e: any) {
        record('C. Layout 3-col + tema sumi', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── D. Sidebar collapse + expand ───────────────────────────────────
    {
      const t0 = Date.now();
      try {
        // Anular transiciones para leer el width final sin esperar el cubic-bezier
        await killTransitions(page);
        await page.click('#sidebar-collapse');
        await page.waitForFunction(
          () => document.getElementById('dojo')?.getAttribute('data-sidebar') === 'collapsed',
          undefined, { timeout: 3000 }
        );
        const collapsedWidth = await page.evaluate(() => (document.querySelector('.sidebar') as HTMLElement).offsetWidth);
        await page.click('#sidebar-expand');
        await page.waitForFunction(
          () => document.getElementById('dojo')?.getAttribute('data-sidebar') === 'open',
          undefined, { timeout: 3000 }
        );
        // El kill anterior pudo perderse por addStyleTag; re-aplicar.
        await killTransitions(page);
        const expandedWidth = await page.evaluate(() => (document.querySelector('.sidebar') as HTMLElement).offsetWidth);
        const pass = collapsedWidth < 80 && expandedWidth > 200;
        record('D. Sidebar collapse/expand', pass, `collapsed=${collapsedWidth}, expanded=${expandedWidth}`, t0);
      } catch (e: any) {
        record('D. Sidebar collapse/expand', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── E. Send message → render sin burbuja + filete con accent ───────
    {
      const t0 = Date.now();
      try {
        await killTransitions(page);
        // Asegurar que hay una conversación activa (init la crea automáticamente)
        await page.waitForFunction(() => !!(window as any).ShinobiConvs?.getActive(), { timeout: 5000 });
        // Send
        await page.fill('#composer', 'Hola mundo de prueba');
        await page.click('#send-btn');
        // Esperar la respuesta final — usar selector simple sin :last-of-type
        // (que tiene gotchas cuando hay elementos hermanos).
        await page.waitForFunction(
          () => {
            const msgs = document.querySelectorAll('.chat-feed .msg.agent');
            if (msgs.length === 0) return false;
            const last = msgs[msgs.length - 1];
            return !last.classList.contains('pending');
          },
          undefined,
          { timeout: 10000 }
        );
        const data = await page.evaluate(() => {
          const userMsg = document.querySelector('.chat-feed .msg.user');
          const agentMsg = document.querySelector('.chat-feed .msg.agent');
          // Verificar que ni user ni agent tienen "burbujas" (background opaco)
          const userBg = userMsg ? getComputedStyle(userMsg as Element).backgroundColor : '';
          const agentBg = agentMsg ? getComputedStyle(agentMsg as Element).backgroundColor : '';
          // El filete del agente: leer pseudo ::before
          const beforeBg = agentMsg ? getComputedStyle(agentMsg as Element, '::before').backgroundColor : '';
          const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
          const agentText = agentMsg?.querySelector('.body')?.textContent || '';
          return { userBg, agentBg, beforeBg, accent, agentText };
        });
        // Burbuja = bg sólido. Esperamos transparent/rgba(0,0,0,0).
        const noBubbles = /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(data.userBg + data.agentBg);
        const hasFilete = data.beforeBg && data.beforeBg !== 'rgba(0, 0, 0, 0)' && data.beforeBg !== '';
        const echoed = data.agentText.includes('Eco') || data.agentText.toLowerCase().includes('hola');
        const pass = noBubbles && hasFilete && echoed;
        record('E. Mensaje sin burbujas + filete agente accent', pass,
          `userBg=${data.userBg}, agentBg=${data.agentBg}, ::before=${data.beforeBg}, text="${data.agentText.slice(0, 60)}"`, t0);
      } catch (e: any) {
        // Diagnóstico: dumpear el feed para entender el estado.
        const dump = await page.evaluate(() => {
          const feed = document.querySelector('.chat-feed');
          return feed ? (feed as HTMLElement).outerHTML.slice(0, 600) : '(no feed)';
        }).catch(() => '(eval failed)');
        const wsState = await page.evaluate(() => (window as any).__shinobi_ws_ready_state ?? 'n/a').catch(() => 'n/a');
        record('E. Mensaje sin burbujas + filete agente accent', false, `threw: ${e.message} | feed=${dump} | ws=${wsState}`, t0);
      }
    }

    // ─── F. Watermark fade tras tener contenido ──────────────────────────
    {
      const t0 = Date.now();
      try {
        await killTransitions(page);
        const opacity = await page.evaluate(() => {
          const wm = document.querySelector('.enso-watermark') as HTMLElement;
          return wm ? parseFloat(getComputedStyle(wm).opacity) : -1;
        });
        // tras el mensaje del test E, .has-content está activo → opacity ≤ 0.03
        const pass = opacity > 0 && opacity < 0.05;
        record('F. Watermark fade con contenido', pass, `opacity=${opacity}`, t0);
      } catch (e: any) {
        record('F. Watermark fade con contenido', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── G. Theme change recolorea filete ───────────────────────────────
    {
      const t0 = Date.now();
      try {
        await page.evaluate(() => (window as any).ShinobiTheme.setTheme('aurora'));
        await killTransitions(page);
        const data = await page.evaluate(() => {
          const agentMsg = document.querySelector('.chat-feed .msg.agent');
          const beforeBg = agentMsg ? getComputedStyle(agentMsg as Element, '::before').backgroundColor : '';
          const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
          return { beforeBg, accent };
        });
        // Aurora --accent = #6ee7b7 = rgb(110, 231, 183)
        const isMint = /rgb\(\s*110,\s*231,\s*183\s*\)/.test(data.beforeBg);
        record('G. Theme change recolorea filete agente', isMint, `::before=${data.beforeBg}, accent-css=${data.accent}`, t0);
        // Volver a sumi para el siguiente test
        await page.evaluate(() => (window as any).ShinobiTheme.setTheme('sumi'));
      } catch (e: any) {
        record('G. Theme change recolorea filete agente', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── H. Auto-title tras 3 mensajes del usuario ──────────────────────
    {
      const t0 = Date.now();
      try {
        // Limpiar localStorage + crear conv fresca
        await page.evaluate(() => localStorage.removeItem('shinobi.activeConv'));
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => !!window.ShinobiConvs?.getActive(), { timeout: 5000 });

        // Crear conversación nueva explícita para no contaminarse con la previa
        const newConv = await page.evaluate(async () => {
          const c = await (window as any).ShinobiConvs.create({ title: 'Conversación nueva' });
          return c;
        });
        if (!newConv) throw new Error('no se pudo crear conv');

        const sendOne = async (txt: string, expectedCount: number) => {
          await page.fill('#composer', txt);
          await page.click('#send-btn');
          await page.waitForFunction(
            (n) => {
              const msgs = document.querySelectorAll('.chat-feed .msg.agent');
              if (msgs.length < n) return false;
              const last = msgs[msgs.length - 1];
              return !last.classList.contains('pending');
            },
            expectedCount,
            { timeout: 10000 }
          );
        };
        await sendOne('mensaje uno', 1);
        await sendOne('mensaje dos', 2);
        await sendOne('mensaje tres', 3);

        // Esperar a que el server emita conversation_title_updated y el
        // title del header se actualice (max 5s).
        await page.waitForFunction(
          (convId) => {
            const cs = (window as any).ShinobiConvs.getActive();
            return cs && cs.id === convId && cs.title && cs.title !== 'Conversación nueva';
          },
          newConv.id,
          { timeout: 6000 }
        );
        const finalTitle = await page.evaluate(() => (window as any).ShinobiConvs.getActive().title);
        const headerTitle = await page.evaluate(() => (document.getElementById('conv-title') as HTMLElement).textContent?.trim());
        const pass = finalTitle === 'Título Generado Auto' && headerTitle === 'Título Generado Auto' && titleCallCount === 1;
        record('H. Auto-title tras 3 mensajes', pass,
          `finalTitle="${finalTitle}", header="${headerTitle}", titleCalls=${titleCallCount}`, t0);
      } catch (e: any) {
        record('H. Auto-title tras 3 mensajes', false, `threw: ${e.message}`, t0);
      }
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} tests passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)`);
  console.log('═════════════════════════════════════════════════════');

  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
