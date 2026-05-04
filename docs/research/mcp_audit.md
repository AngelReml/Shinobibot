# A3.1 — Audit del cliente MCP actual + A3.2 gaps vs spec oficial

Fecha: 2026-05-04
Spec consultado: <https://modelcontextprotocol.io/specification/2025-06-18> (lifecycle + capabilities).

## A3.1 — Estado actual

Archivo único: `OpenGravity/src/mcp/mcp_client.ts` (≈ 195 líneas).

**Lo que hace bien:**

- Spawna procesos stdio reales (`child_process.spawn`) y conserva pipes.
- Envía `initialize` JSON-RPC 2.0 con `protocolVersion: "2024-11-05"` y `clientInfo`.
- Hace `tools/list` y registra cada tool en `RegistryManager` con prefijo `<server>_<tool>`.
- Implementa `tools/call` con `pendingRequests` por id y timeout 30s.
- Distingue arrays de `content` (`type:'text'`).

**Carencias estructurales:**

| # | Carencia | Spec ref |
|---|----------|----------|
| 1 | No envía `notifications/initialized` tras la respuesta de initialize | lifecycle: "client **MUST** send" |
| 2 | Capabilities en handshake = `{}`. Sin sampling/roots/elicitation declarados. | capability negotiation |
| 3 | `protocolVersion: "2024-11-05"` (vieja). Spec actual = `2025-06-18`. | version negotiation |
| 4 | SSE transport: stub (`console.warn` "no implementado"). Spec actual prefiere "Streamable HTTP". | transports |
| 5 | No filtrado por servidor. Todas las tools quedan registradas con prefijo. | producto |
| 6 | No soporta `sampling/createMessage` (server pide al cliente que llame al LLM). | client sampling |
| 7 | No `resources/list`, `resources/read`, ni `prompts/list`. | server features |
| 8 | No `notifications/cancelled` para cancelar requests in-flight. | utilities/cancellation |
| 9 | Sin timeouts configurables por request (hard-coded 30s). | timeouts |
| 10 | `disconnectAll` mata el proceso sin closing input stream + SIGTERM/SIGKILL escalado. | shutdown |
| 11 | Errores JSON-RPC: cuenta `msg.error?.message` pero no propaga `code` ni `data`. | error handling |
| 12 | Sin `MCP-Protocol-Version` header (sólo aplica a HTTP transport, pero hay que tenerlo cuando se añada). | transports |

## A3.2 — Decisiones para A3.3

1. **Cliente v2 lado a lado** (`mcp_client_v2.ts`) sin tocar v1 — el `capability_installation_pipeline` puede migrar gradualmente. Marcamos v1 como deprecated en comentario.
2. **Transports separados**: `StdioTransport` y `StreamableHttpTransport` en `mcp_transports.ts`. Cada uno expone `send(json) / onMessage(cb)`. El cliente es agnóstico.
3. **Lifecycle correcto**: `initialize` → wait for response → `notifications/initialized` (no requiere id) → entonces `tools/list`.
4. **Capabilities declaradas**: `{ sampling: {}, roots: { listChanged: false }, elicitation: {} }` por defecto; el `sampling` callback es opcional al construir el cliente.
5. **Tool filtering por servidor (A3.4)**: el `connect()` acepta `{ allow?: (toolName) => boolean }`. Default = todas. El `MCPServerConfig` extendido añade `allow_tools` (lista de patrones) y/o `deny_tools`.
6. **Sampling support (A3.5)**: cuando llega un request `sampling/createMessage` desde el server, el cliente llama al callback `onSamplingRequest(req)` que el host de OG provee (podemos delegar al `OpenRouterClient` existente).
7. **Resources / prompts**: `listResources()` / `listPrompts()` opt-in para que el caller los pida; no se cargan automáticamente.
8. **Shutdown ordenado**: cierra stdin, espera 1500ms, SIGTERM, espera 500ms, SIGKILL.
9. **Errores**: re-throw `MCPError` con `code` + `data` para diagnóstico aguas arriba.
10. **`MCP-Protocol-Version` header** automático en HTTP transport.

## A3.6 — Estrategia de test E2E

Plan original: GitHub MCP server externo (`@modelcontextprotocol/server-github`).
Bloqueos: requiere `GITHUB_PERSONAL_ACCESS_TOKEN` + red estable; demasiada fricción para tests deterministas.

**Compromiso**: dos tests E2E.

- **Test A (CI-friendly)**: `@modelcontextprotocol/server-everything` (servidor de prueba oficial del spec). Disponible vía `npx -y @modelcontextprotocol/server-everything`. Cubre tools, resources, prompts y permite probar sampling de ida y vuelta. Sin token.
- **Test B (manual)**: GitHub server. Documentado en `docs/manual_actions.md` con un script local que el usuario corre cuando tenga el token.

## Manual TODOs derivados

- [ ] Verificar test E2E con `@modelcontextprotocol/server-github` (requiere PAT y `npx` con red abierta).
- [ ] Decidir si `capability_installation_pipeline` debe migrarse a v2 ya o tras un período de observación con ambos clientes activos.
