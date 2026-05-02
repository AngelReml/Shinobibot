ROADMAP DEFINITIVO v2
Shinobi (producto) · OpenGravity (infraestructura)
14 bloques · 70 pruebas · arquitectura cliente/servicio
Iván Carbonell · Ángel Reml
Versión: 2026-05-02 · v2 (división producto/infra)
Documento operativo · Para lectura por humano o IA

Qué cambia respecto a la v1 del roadmap
La v1 trataba a Shinobi y OpenGravity como dos partes del mismo proyecto sin frontera clara. La inspección del 2026-05-02 reveló datos crudos: 0 imports cruzados entre repos, 1 sola tool (kernel_mission) toca el kernel HTTP, 0 dependencias de OpenGravity en el package.json de Shinobi. Es decir: ya están separados de facto, solo faltaba reconocerlo.
La v2 formaliza la separación con una decisión de producto: Shinobi es el cliente que se distribuye al usuario final (.exe en su PC), OpenGravity es la infraestructura cloud que vive detrás de zapweave.com. Cada bloque del roadmap está etiquetado con [SHINOBI], [OPENGRAVITY], [CONTRATO] o [META] para que quede claro dónde se ejecuta el trabajo.
Color verde: [SHINOBI] — vive en el PC del cliente (lo que ve y paga)
Color granate: [OPENGRAVITY] — vive en cloud, detrás de zapweave.com (la fortaleza defendible)
Color dorado: [CONTRATO] — frontera entre los dos, API HTTP autenticada

Visión y reglas operativas
Este documento es el roadmap definitivo del proyecto en su versión cliente-servicio. No es una idea, no es un esbozo. Es la ruta operativa hasta llegar a la empresa sintética.
El destino final es una empresa sintética operada por IA bajo dirección humana, con departamentos digitales modelados como swarms persistentes en cloud, comunicación fluida entre ellos, aprobaciones humanas en los puntos donde aporta valor real. Outputs reales. Clientes reales. Facturación real.
Shinobi es el agente cofounder que vive en el PC de cada cliente. OpenGravity es el cerebro avanzado en cloud que da superpoderes a todos los Shinobi conectados. Su frontera se define en el Bloque 0.

Reglas para quien lea este documento
• Cada bloque tiene casillas marcables (☐). Las marcas (☒) cuando una tarea esté cerrada con datos crudos en disco.
• No se cierra un bloque hasta que sus 5 pruebas estén verdes.
• Cada bloque está etiquetado con su lado: [SHINOBI], [OPENGRAVITY], [CONTRATO] o [META].
• Si una IA lee este documento como contexto inicial, debe tomar el primer bloque con casillas pendientes y empezar por ahí.
• La tabla de progreso global refleja el estado actual.
• Sin ambigüedad temporal: este documento no dice 'mañana', 'la próxima sesión'. Tareas pendientes son tareas pendientes.
• Sin estimaciones de tiempo abstractas: no se dice '4 horas' ni '3 sesiones'. Se ejecuta hasta cerrar.

Qué vive dónde
Tabla maestra de capacidades del producto y dónde se ejecuta cada una. Esta tabla es la referencia rápida para saber en qué repositorio se hace cada cambio.

| Capacidad | Vive en | Por qué |
|-----------|---------|---------|
| Browser automation (Comet/Chromium CDP) | SHINOBI | Sesión humana del usuario, no puede salir de su PC |
| Sesiones logueadas (Google, LinkedIn, etc.) | SHINOBI | Privacidad, OAuth tokens nunca abandonan el cliente |
| Memoria del agente (OpenClaw) | SHINOBI | Datos personales del usuario, nunca a cloud compartido |
| Tools simples (read/write/run/scroll/click) | SHINOBI | Latencia mínima, ejecución directa en máquina del usuario |
| CLI / GUI / tray icon | SHINOBI | Interfaz que el cliente toca |
| Setup wizard + OAuth simplificado | SHINOBI | Onboarding de 30 segundos, diferenciador de venta |
| LLMs vía OpenRouter | OPENGRAVITY | Una sola API key central, control de coste, margen |
| Mutación / auto-mejora | OPENGRAVITY | Network effect: una mejora alcanza a todos los Shinobi |
| Swarms jerárquicos (CEO + sub-agentes) | OPENGRAVITY | Consume RAM/CPU, mejor centralizado |
| n8n premium + biblioteca de workflows | OPENGRAVITY | Catálogo crece con uso de clientes, monetizable |
| Skills aprendidas compartibles | OPENGRAVITY | Cuando un Shinobi aprende Notion, todos lo heredan |
| Pipeline de validación (BVP, forense) | OPENGRAVITY | Diferenciador EigenCloud, defensible |
| Dashboard de operación (solo Iván) | OPENGRAVITY | Monitoreo de negocio: clientes, costes, salud |
| API zapweave.com con auth de claves | CONTRATO | Frontera entre cliente y servicio |

Principio rector: los datos personales del cliente NUNCA salen de su PC (memoria, sesiones, tokens OAuth). Las capacidades genéricas (modelos LLM, swarms, n8n, skills aprendidas) viven en cloud para que aprovechen network effect.

Progreso global
Estado de los 14 bloques.

#	Bloque	Lado	Estado	Prog.
B0	Contrato API Shinobi ↔ OpenGravity	CONTRATO	☒ Cerrado	5/5
B1	Decisión arquitectónica formal (D-015)	META	☒ Cerrado	5/5
B2	Switch OpenAI → OpenRouter centralizado	OPENGRAVITY	☐ Pendiente	0/5
B3	Memoria de OpenClaw integrada en Shinobi	SHINOBI	☐ Pendiente	0/5
B4	Bridge n8n + workflow piloto + biblioteca	OPENGRAVITY	☐ Pendiente	0/5
B5	Validar pipeline de mutación con caso real	OPENGRAVITY	☐ Pendiente	0/5
B6	Modo agente residente	SHINOBI	☐ Pendiente	0/5
B7	Swarms jerárquicos como servicio cloud	OPENGRAVITY	☐ Pendiente	0/5
B8	Setup wizard + OAuth simplificado	SHINOBI	☐ Pendiente	0/5
B9	Aprender a usar programas (visión cumbre)	SHINOBI	☐ Pendiente	0/5
B10	Despliegue zapweave.com + producción	META	☐ Pendiente	0/5
B11	Limpieza OpenGravity	OPENGRAVITY	☐ Pendiente	0/5
B12	Empaquetado .exe distribuible	SHINOBI	☐ Pendiente	0/5
B13	Diseño y arranque empresa sintética	META	☐ Pendiente	0/5

Total de pruebas en el roadmap: 70 (5 por bloque × 14 bloques).
Estado inicial: 0 pruebas cerradas, 70 pendientes.

Estado de partida
Lo que YA está validado al inicio del roadmap v2 (sesiones 2026-05-01, 2026-05-02 y antes):
Capacidades validadas en Shinobi
• Web search con extracción de body, links, interactive elements
• Browser click extendido (CSS selector + aria-label + texto)
• Browser scroll con espera y re-extracción
• Browser click position (clic ordinal en SPAs)
• Web search con warmup y stealth (anti-bot Fiverr/PerimeterX)
• Validación end-to-end del agente nivel 1 (CoinGecko top 5 en 16s)
• Interacción con LLM via web (Gemini: pestaña abierta, pregunta enviada, respuesta capturada)
• Validación de SPAs: NotebookLM (4 pruebas), YouTube (transcript + comments)
Inspección Shinobi ↔ OpenGravity (datos crudos del 2026-05-02)
• 0 imports cruzados entre repos
• 1 tool (kernel_mission.ts) en Shinobi llama al kernel HTTP — el resto son tools locales
• 0 dependencias de OpenGravity en package.json de Shinobi (solo: axios, dotenv, openai, playwright)
• 0 referencias a SkillsAgent / MutationEngine / n8nClient / run_mutation en código de Shinobi
• Modos de Shinobi: 'local' (sin kernel), 'kernel' (con kernel), 'auto' (decisión automática)
• Conclusión: ya están separados técnicamente. Solo faltaba la decisión formal.

BLOQUE 0 — Definir y documentar el contrato API Shinobi ↔ OpenGravity
[CONTRATO · ambos lados]
Bloque #	B0
Lado	CONTRATO
Estado	☒ Cerrado
Pruebas cerradas	5 de 5
Dependencias	Ninguna. Es el primer bloque del proyecto.

Objetivo
Diseñar y formalizar el contrato HTTP entre Shinobi (cliente local) y OpenGravity (servicio cloud detrás de zapweave.com). Endpoints, auth, versionado, payloads, manejo de errores, healthcheck. Sin esto, los demás bloques se desordenan porque no existe la frontera.

Por qué importa
El producto entero descansa sobre esta frontera. Cliente (Shinobi) vive en el PC del usuario, infra (OpenGravity) vive en VPS detrás de zapweave.com. Si no se define el contrato primero, cada bloque después tiene que reinventar la frontera y se acumulan inconsistencias. Definirlo primero es la inversión más alta en clarity-by-design del proyecto.

Arquitectura técnica
• Endpoint base: https://kernel.zapweave.com/v1/...
• Auth: API key por instancia de Shinobi en header X-Shinobi-Key. Validación contra tabla shinobi_keys en SQLite del kernel.
• Endpoints mínimos v1: POST /v1/missions/swarm (delegar swarm), POST /v1/llm/chat (proxy a OpenRouter), POST /v1/n8n/workflow/{id} (invocar workflow), GET /v1/skills/list (capacidades disponibles), GET /v1/health.
• Payload estándar: input estructurado JSON, response con success/output/error/trace_id.
• Versionado en URL (v1, v2). Cuando se rompa contrato, nueva versión sin tirar clientes viejos.
• Rate limit por clave. Logs por clave en SQLite de OpenGravity.
• Cliente HTTP en Shinobi (src/cloud/opengravity_client.ts) que abstrae las llamadas y maneja fallback gracioso si el cloud no responde.

Archivos a tocar
• Crear en SHINOBI: src/cloud/opengravity_client.ts (cliente HTTP)
• Crear en SHINOBI: src/cloud/types.ts (tipos compartidos)
• Modificar en SHINOBI: src/tools/kernel_mission.ts → renombrar a cloud_mission.ts y apuntar a kernel.zapweave.com
• Crear en OPENGRAVITY: src/api/v1/* (router de endpoints públicos)
• Crear en OPENGRAVITY: src/auth/api_keys.ts (validación)
• Modificar en OPENGRAVITY: dashboard para mostrar stats por API key
• Crear: docs/contracts/api_v1.md (documento maestro del contrato)

Riesgos identificados
• Sobre-diseñar el contrato y retrasar todo. Mitigación: empezar con v1 mínimo (5 endpoints), iterar.
• Auth débil expone OpenGravity a cualquiera con dominio. Mitigación: claves largas (256 bits), rate limit estricto, IP allowlist opcional.
• Cambios incompatibles después rompen clientes. Mitigación: versionado en URL desde día 1.

Pruebas de validación (5 obligatorias para cierre)
☒ P1: docs/contracts/api_v1.md existe con los 5 endpoints documentados (URL, headers, body, response)
☒ P2: Test unitario de cliente HTTP en Shinobi mockeando respuestas del kernel
☒ P3: Llamada real desde Shinobi a OpenGravity local (antes de mover a zapweave.com) con auth válida funciona
☒ P4: Llamada con auth inválida devuelve 401
☒ P5: Si OpenGravity está caído, Shinobi cae a modo local sin crashear y avisa al usuario

Condición de cierre
Documento de contrato escrito, cliente HTTP implementado en Shinobi, endpoints implementados en OpenGravity (en modo local, antes de despliegue en zapweave.com), 5 pruebas verdes.

Tareas operativas marcables
☒ Leer este bloque entero antes de empezar
☒ Verificar que las dependencias están cerradas
☒ Crear checkpoint git pre-bloque (en ambos repos si aplica)
☒ Implementar arquitectura técnica
☒ Crear o modificar archivos listados
☒ Ejecutar las 5 pruebas de validación
☒ Verificar condición de cierre
☒ Commit con mensaje 'close: BLOQUE 0 — <título>'
☒ Crear log en docs/sessions/ de la sesión que cerró el bloque
☒ Marcar bloque como CERRADO en la tabla de Progreso global

(El resto de bloques se procesarán secuencialmente...)
