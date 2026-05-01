# Roadmap — Tres ejes paralelos

Decidido por Iván el 30/04/2026. Sin fechas, solo hitos verificables.

## Eje A — Producto comercial

Vertical: insurance brokers E&S/wholesale, USA primero.
Caso de uso pivote: cotización multi-carrier (broker introduce datos de riesgo una vez, Shinobi opera N portales en paralelo, devuelve cotizaciones consolidadas).
Compliance desde día uno: sesión local del broker, cero credenciales en servidores propios, logs auditables.

Modelo: servicio cerrado pagado primero (validación dura), SaaS después.

### Fase 0 — Base técnica mínima [CERRADA]
- Ruta Comet actualizada ✓
- CDP verificado ✓
- Kernel :9900 con health check limpio ✓
- Estructura repo ✓
- Smoke test DOM simple ✓ (validado con búsqueda Bitcoin)

### Fase 0.5 — Discovery [PARCIAL]
- Identificar 5-10 brokers boutique E&S — Shinobi extrajo nombres en LinkedIn (validación L1-L5)
- Sesión discovery 30-60 min con al menos 1 broker — PENDIENTE TRABAJO HUMANO (Iván)
- Mapa de flujo + 3 carriers más usados — PENDIENTE

### Fase 1 — Tres carriers reales
- adapters/carriers/ con 3 carriers
- 70-80% autonomía en 50 ejecuciones por carrier
- Tiempo total cotización multi-carrier ≤ 15 min

### Fase 2 — Demo grabable + compliance
### Fase 3 — Primer cliente pagando ($800-1500/mes)
### Fase 4 — Expansión 3-5 clientes
### Fase 5 — Producto v1 con panel auto-servicio

## Eje B — Capacidad autónoma

Shinobi como extensión del brazo del usuario. Sustituto de teclado y ratón. Cofounder.
Suite de pruebas dificultad ascendente nivel 1 → 10.

### Fase 0 [CERRADA]
- Schema de misión documentado ✓
- LoopDetector test 4/4 PASS ✓

### Fase 0.5 — Pruebas Nivel 1-4 [CERRADA con superación]
Original: T1-T4 con 80% autonomía.
Ejecutado: T1-T30 (suite de 30 tareas en 6 plataformas: LinkedIn, Fiverr, Upwork, YouTube, NotebookLM, CoinGecko).
Resultado: 18-19/30 PASS reales con datos extraídos.
Detalle por bloque: ver `sessions/2026-05-01_validacion_30_tareas.md`.

### Fase 1 — Pruebas Nivel 5-6 (casi imposibles)
- T5: inteligencia competitiva (mapear stack de 3 empresas + ofertas + cambios producto)
- T6: outreach autónomo personalizado (20 brokers con mensaje único cada uno)
- Swarm jerárquico completo (CEO → Búsqueda → DOM → Análisis → Redacción)
- Sistema de pivot 3-fail → cambio estrategia → 5-fail → escalado humano

### Fase 2-5 — Niveles 7-10
T7 due diligence empresarial.
T8 misión empresarial briefing.
T9 recruiting autónomo.
T10 misión 72h continua.

## Eje C — Visibilidad pública

Cada sesión produce un post publicable en LinkedIn. Iván redacta hasta que Shinobi lo haga mejor.

### Fase 0 — Post inaugural [PENDIENTE]
### Fase 0.5 — Post por cada prueba superada [PENDIENTE]

NOTA: ningún post publicado todavía. Es deuda explícita.

## Visión cumbre (post Bloque 6 — guardada para abrir cuando Iván lo decida)

- Shinobi aprende el meta-protocolo de descubrir UIs nuevas (web y nativas)
- Auto-mejora aplicada al aprendizaje: cada programa nuevo se aprende más rápido
- Empaquetable como .exe para usuario final
- Setup mínimo: API key OpenAI y/o OpenRouter (mínimo una)
- Caso piloto explícito: NotebookLM app de escritorio
- Iván tiene tiempo y dinero para quemar tokens en esto

## Frente paralelo no abandonado: EigenCloud

Iván cerró Fase 0 EigenCloud el 27/04/2026 (verified ledger 376 datapoints, 29.5% silent failures, gold case R3_T6_BYPASS_SOPHISTICATED).
Fase 1 EigenCloud lista para empezar: pilot_agentic_v1 (30 tasks), EigenAI adapter, BVP v0.1.
Decisión actual de Iván: Shinobi es frente activo en paralelo. EigenCloud no abandonado.
