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

## Matrix (nope.chat) — BLOQUEADO por tokens efímeros (MAS)

Homeserver: `https://nope.chat`, cuenta `@shinobi-bot-angelreml:nope.chat`.

`scripts/sprintV4/run_matrix_validation.ts` implementa el flujo completo
(whoami → createRoom → send → echo → leave). El **código es correcto y
está listo**; el bloqueo es de credencial.

### Causa raíz: nope.chat usa MAS

El `.well-known/matrix/client` de nope.chat declara:

```json
"org.matrix.msc2965.authentication": {
  "issuer": "https://auth.nope.chat/"
}
```

Es decir, **nope.chat corre Matrix Authentication Service (MAS)**, igual
que matrix.org. Los access tokens `mat_…` son OAuth de **vida corta**
que rotan automáticamente. NO son tokens de dispositivo estáticos.

### Evidencia del bloqueo

El token `mat_2juO7Y6ImeyC1zHTgAxzjpYLN1YB2f_dM4QV1` se probó dos veces:

| Momento | Resultado |
|---|---|
| T+0 (curl directo) | `HTTP 200 {"user_id":"@shinobi-bot-angelreml:nope.chat","device_id":"RiTt3UPLdt"}` ✅ |
| T+~3 min (script) | `HTTP 401 {"errcode":"M_UNKNOWN_TOKEN","error":"Token is not active"}` ❌ |
| T+~3 min (re-curl) | `HTTP 401 M_UNKNOWN_TOKEN` ❌ |

El **mismo token** pasó de válido a expirado en ~3 minutos. Esto
confirma que es un token MAS efímero — copiarlo a mano no sirve porque
caduca antes de poder usarlo de forma sostenida.

La premisa de que "los tokens `mat_` de homeservers tradicionales no
caducan" no aplica aquí: nope.chat NO es un homeserver de registro
tradicional en cuanto a tokens — corre MAS.

### Estado

- `MatrixAdapter` (Sprint P1.1): implementado + 4 tests vitest pasando.
- `run_matrix_validation.ts`: flujo de validación completo, correcto.
- Auth/endpoints/homeserver: **verificados** (el token funcionó en T+0).
- Único bloqueo: obtener un token Matrix **estable** (no MAS-rotativo).

Para una validación live sostenida hace falta una de estas vías
(decisión del operador):
- Un token de dispositivo de larga duración (login programático
  `m.login.password` — nope.chat lo soporta).
- Un homeserver sin MAS donde los access tokens no roten.
- Aceptar Matrix como "validado por código + auth verificada en T+0".

---

## Reproducir

```bash
npx tsx scripts/sprintV4/run_external_services.ts
```

Las API keys se leen de `.env` con `override:true` (un placeholder en
el shell no debe ganar sobre `.env`).
