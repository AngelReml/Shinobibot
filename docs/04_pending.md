# Pendientes técnicas

Última actualización: 2026-05-02

## Pendientes cerradas hoy (2026-05-02)

- ~~L3 LinkedIn~~ ✅ — clasifica sobre body context, 5 TARGETS reales
- ~~U5 Upwork~~ ✅ — distinción CRITICAL vs WEAK
- ~~C2 CoinGecko~~ ✅ — Theta Network localizado en rank 183
- ~~Y3 YouTube~~ ✅ — 209 líneas de transcript via expansión de descripción
- ~~Y4 YouTube~~ ✅ — 13 comments estructurados con scroll lazy
- ~~N1 NotebookLM~~ ✅ — 17 notebooks via tr.mat-mdc-row
- ~~N2 NotebookLM~~ ✅ — navegación SPA con clic ordinal funcional
- ~~N3 NotebookLM~~ ✅ — pregunta enviada y respuesta capturada (1276 chars)
- ~~N4 NotebookLM~~ ✅ — inventario Audio Overview
- ~~F1 Fiverr CAPTCHA primera petición~~ ✅ (mitigado con warmup+stealth, validar en uso real prolongado)

## Pendientes abiertas

### P-A — L3 Eje A: filtro obligatorio "insurance"
**Problema:** L3 con keyword "wholesale insurance broker" trae 5 TARGETS, pero entre ellos aparecen "Commodity Trader", "Commodity Broker", "SBLC/MTN Financial Instruments" — falsos positivos del Eje A. La regla KEEP atrapa cualquier "wholesale broker" sea de seguros o no.
**Fix:** añadir condición obligatoria de que el contexto contenga "insurance" o "seguros" para clasificar como TARGET.
**Archivo:** scripts/linkedin/l3_keyword_filter.ts

### P-B — Upwork Cloudflare Turnstile (FUERA DE SCOPE)
**Problema:** stealth + warmup no rompe Cloudflare Turnstile. Detección a nivel TLS/JA3.
**Soluciones requeridas (no en scope hoy):**
- Camoufox (Firefox patcheado anti-detección)
- patchright o rebrowser-patches (parches a Playwright)
- Solver pago de Turnstile (2Captcha, CapSolver) ~$3/1000
- Proxy residencial (datacenter IPs están marcadas)
**Decisión:** documentado y aparcado. Para Eje A (broker E&S USA) los portales de carrier son B2B internos, no llevan Turnstile. No bloqueante.

### P-C — Eje C nunca arrancado
**Problema:** cero posts publicados en LinkedIn. Roadmap Fase 0.5 pedía post por cada prueba superada.
**Estado:** post inaugural de la sesión 2026-05-01 redactado pero no publicado. Crónica de hoy 2026-05-02 (Capa 1+2+3) pendiente de redactar.
**Fix:** decisión humana — Iván publica al ritmo de trabajo.

### P-D — Validación del agente end-to-end
**Problema:** todas las pruebas hasta ahora han llamado tools directamente desde scripts hardcoded. El orchestrator de Shinobi (gpt-4o + memoria + tool loop) no se ha ejecutado en una misión real con las primitivas nuevas.
**Fix:** invocar ShinobiOrchestrator.process(input) con una misión real ("busca 5 brokers wholesale de insurance en LinkedIn"), comprobar que elige tools correctas y devuelve resultado.
**Próxima sesión.**
