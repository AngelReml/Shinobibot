// scripts/smoke/mcp_smoke.ts
// SMOKE REAL del subsistema MCP: spawnea el servidor MCP de prueba con el
// adaptador stdio REAL (SDK oficial, JSON-RPC por stdin/stdout), registra sus
// tools como Tools nativas y las ejecuta. Sin mocks.
//
//   npx tsx scripts/smoke/mcp_smoke.ts
import { createStdioMcpClient } from '../../src/mcp/stdio_client.js';
import { registerMcpServer, disconnectMcpServer } from '../../src/mcp/mcp_registry.js';
import { getTool } from '../../src/tools/tool_registry.js';

async function main() {
  process.env.SHINOBI_AUDIT_DISABLED = '1';
  console.log('[smoke] conectando al servidor MCP por stdio…');
  const client = await createStdioMcpClient({
    name: 'shinobi-smoke',
    command: process.execPath, // node
    args: ['scripts/smoke/mcp_echo_server.mjs'],
  });

  const { registered } = await registerMcpServer('echo', client);
  console.log('[smoke] tools registradas:', registered);
  if (registered.length !== 2) throw new Error(`esperaba 2 tools, hay ${registered.length}`);

  const echo = getTool('mcp__echo__echo');
  const add = getTool('mcp__echo__add');
  if (!echo || !add) throw new Error('tools MCP no registradas en el registry');

  const r1 = await echo.execute({ message: 'hola desde shinobi' });
  console.log('[smoke] echo →', JSON.stringify(r1));
  if (!r1.success || !r1.output.includes('echo: hola desde shinobi')) throw new Error('echo falló');

  const r2 = await add.execute({ a: 2, b: 40 });
  console.log('[smoke] add(2,40) →', JSON.stringify(r2));
  if (!r2.success || r2.output.trim() !== '42') throw new Error(`add esperaba 42, dio ${r2.output}`);

  await disconnectMcpServer('echo');
  console.log('[smoke] ✅ MCP stdio REAL validado: list + call + disconnect end-to-end.');
}

main().catch((e) => { console.error('[smoke] ❌', e?.message ?? e); process.exit(1); });
