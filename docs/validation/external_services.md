# Validación FASE V4 — Servicios externos

Fecha: 2026-05-15. APIs reales, evidencia cruda.

## Resumen

| Servicio | auth | write | read | search | delete | Estado |
|---|---|---|---|---|---|---|
| **Mem0** | ✅ | ✅ | ✅ | ✅ | ✅ | VALIDADO |
| **Supermemory** | ✅ | ✅ | ✅ | ✅ | ✅ | VALIDADO |
| **Matrix** | ❌ | — | — | — | — | **BLOQUEADO** (token inválido) |

V4 está **2/3 completa**. Matrix requiere acción humana — ver abajo.

---

## Mem0 (api.mem0.ai)

Ciclo completo store → search → forget contra la API real.

```json
{
  "service": "Mem0",
  "auth": true, "write": true, "read": true, "search": true, "remove": true,
  "latencyMs": { "store": 1700, "search": 780, "forget": 1211 },
  "notes": [
    "store id/event: 0b8a6c46-66b5-4dec-ae96-475004a1f75c",
    "search top hit: \"The agent Shinobi uses a three-layer loop detector\" (score 0.9)"
  ]
}
```

### Hallazgos / edge cases

- **Procesamiento asíncrono**: `POST /v1/memories/` devuelve
  `[{message:"Memory processing has been queued", status:"PENDING", event_id}]`.
  La memoria NO es buscable inmediatamente — hay que esperar ~5-6 s a que
  el backend la procese.
- **Reescritura semántica**: Mem0 reformula el texto. Se guardó
  "el agente Shinobi usa loop detector de tres capas" y se recuperó
  "The agent Shinobi uses a three-layer loop detector" — Mem0 traduce y
  normaliza a tercera persona. Útil pero hay que saberlo.
- `search` y `list` devuelven **arrays planos** (no `{results:[…]}`).
- Score de relevancia alto y fiable (0.9 en match directo).

### Fix aplicado al provider

`Mem0Provider.store()` ahora parsea la respuesta array `[{event_id}]`
(antes asumía `{results:[{id}]}`, devolvía `mem0-unknown`).

---

## Supermemory (api.supermemory.ai)

```json
{
  "service": "Supermemory",
  "auth": true, "write": true, "read": true, "search": true, "remove": true,
  "latencyMs": { "store": 2552, "search": 788, "forget": 527 },
  "notes": [
    "store id: q1SsGmDmNVR2RkLN9t674Y",
    "search top hit: \"V4 test: Shinobi soporta loop detector de 3 capas\" (score 0.567)"
  ]
}
```

### Diferencias con Mem0

| Aspecto | Mem0 | Supermemory |
|---|---|---|
| Endpoint store | `POST /v1/memories/` | `POST /v3/documents` |
| Endpoint search | `POST /v1/memories/search/` | `POST /v3/search` |
| Auth header | `Authorization: Token <key>` | `Authorization: Bearer <key>` |
| Texto guardado | reformulado/traducido por LLM | **literal**, sin reescritura |
| Respuesta search | array plano `[{memory,score}]` | `{results:[{chunks:[{content,score}],documentId}]}` |
| Estructura | 1 memoria = 1 registro | 1 documento → N chunks |
| Latencia store | ~1.7 s | ~2.5 s |
| Latencia search | ~0.78 s | ~0.79 s |
| Score match directo | 0.9 | 0.57 |

Supermemory preserva el texto **literal** (mejor para auditoría); Mem0
lo reformula (mejor para consolidación semántica). Supermemory parte el
contenido en `chunks` — el provider los concatena.

### Fix aplicado al provider

`SupermemoryProvider` reescrito: endpoints `/v3/documents` + `/v3/search`
+ `/v3/documents/<id>` (antes `/v1/memories` + `/v1/search`). El parser
de `recall()` ahora extrae texto de `results[].chunks[].content` y el id
de `documentId`.

---

## Matrix (matrix-client.matrix.org) — BLOQUEADO

```json
{
  "service": "Matrix", "auth": false,
  "latencyMs": { "whoami": 143 },
  "notes": [
    "whoami HTTP 401: {errcode:M_UNKNOWN_TOKEN, error:Token is not active}"
  ]
}
```

El homeserver responde (el endpoint `/_matrix/client/versions` da 200),
pero el **access token es rechazado**: `M_UNKNOWN_TOKEN — Token is not
active`.

El token provisto (`mat_AUYbUZH1d0hInRu5VBsPfpZxQqWLXj_qbik41`, 41
chars) está expirado, revocado, o nunca fue válido. Los tokens de
matrix.org Synapse modernos tienen prefijo `syt_`, no `mat_`.

**Esto NO es un fallo de código de Shinobi** — el `MatrixAdapter`
(Sprint P1.1) está implementado y testeado. Es un problema de
credencial externa.

### Acción humana requerida

1. Abrir Element (app o web).
2. Ajustes → Ayuda y Acerca de → Avanzado → **Token de acceso**.
3. Copiar el token (empieza por `syt_` normalmente).
4. Actualizar en `.env`: `MATRIX_ACCESS_TOKEN=<token nuevo>`.
5. Re-ejecutar `npx tsx scripts/sprintV4/run_external_services.ts`.

Con un token válido, el script completará el flujo Matrix (whoami →
crear sala de pruebas → enviar mensaje al propio usuario → recibir).

---

## Reproducir

```bash
npx tsx scripts/sprintV4/run_external_services.ts
```

Las API keys se leen de `.env` con `override:true` (un placeholder en
el shell no debe ganar sobre `.env`).
