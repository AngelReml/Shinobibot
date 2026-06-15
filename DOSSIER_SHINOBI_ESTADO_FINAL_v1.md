# Shinobi · Estado Final
## Dossier Técnico — El agente de skills verificadas

**Autor:** Iván Carbonell (ZapWeave)
**Documento:** estado final + proceso completo de construcción
**Versión:** v1.0
**Naturaleza:** dossier de decisión. No es marketing. Es la especificación desde la que construyen Claude Code y Cowork, y el artefacto con el que decidimos si la tesis es real o un espejismo.

---

## Criterio de éxito de este documento

Este dossier solo es correcto si, una vez ejecutado en su totalidad, hace que **Shinobi destaque sobre el resto de agentes** — agentes, no LLMs. El documento se autoimpone esa prueba. Cada decisión de arquitectura que sigue está subordinada a ella. Donde una pieza no contribuya a esa diferenciación, sobra y se elimina. Donde la diferenciación dependa de una apuesta (timing de mercado, capacidad de ejecución en solitario), el documento lo dice sin adornos en la sección de riesgos, porque un dossier que esconde sus grietas no cumple su función: te haría poner tu reputación a ciegas.

La diferenciación que este documento defiende **no** es "Shinobi es un agente más capaz que Hermes". Esa carrera la gana quien tiene más modelo y más ecosistema, y no es ganable en solitario. La diferenciación es de **otro eje**: Shinobi es el agente que ejecuta skills **verificadas** y produce una **traza de ejecución verificable criptográficamente**, de modo que se le puede confiar para actuar donde a otros agentes no — alto riesgo, regulado, comercio agente-a-agente. Si ese eje es real y defendible, la respuesta a tu pregunta es sí. Si no lo fuera, sería no, y este documento te lo diría.

---

# Parte I — La tesis

## 1. El mundo va hacia agentes genéricos; el valor migra a las skills

La convergencia ya está ocurriendo. Los agentes están estandarizándose alrededor del mismo bucle (planificar–actuar–observar), el mismo protocolo de herramientas (MCP), los mismos modelos de frontera intercambiables por debajo. Cuando el sustrato se vuelve commodity, el valor no se queda en el sustrato: migra a lo que el agente puede **hacer de forma fiable y reutilizable**. Eso es una skill.

Una skill es una capacidad acotada con un contrato de entrada/salida definido: "extrae las entidades sancionadas de esta lista", "reconcilia estos dos libros mayores", "valida esta transacción contra estas reglas". No es el agente entero (abierto, de propósito general, difícil de acotar). Es una unidad. Y por ser una unidad acotada, una skill tiene una propiedad que el agente entero no tiene: **es verificable**. Puedes definir qué entra, qué debe salir, y comprobar deterministamente si salió lo correcto. Un agente de propósito general no admite ese cierre; una skill sí.

Esta es la inversión que hace coherente todo el dossier: lo que hacía que Sello pareciera "un benchmark con firma" cuando se aplicaba a agentes-caja-negra, deja de ser un defecto cuando se aplica a **skills**. Verificar una skill acotada deterministamente no es un benchmark genérico: es un certificado de comportamiento sobre una unidad de valor que se compra, se vende y se compone. El acotamiento de la skill es lo que rescata la verificación.

## 2. El hueco que nadie ocupa

El ecosistema de skills ya está nnaciendo, y ya tiene capas ocupadas:

- **Capacidad y comunidad:** Hermes Agent (Nous Research, open-source, ~110K estrellas) y los labs de frontera. Ganan el agente genérico. No es disputable en solitario.
- **Distribución y pagos de skills:** HermesHub ya es un marketplace de skills con pagos x402 (95% de payout al creador) y trust scores agente-a-agente. La capa de mercado existe.
- **Seguridad de la skill:** HermesHub escanea malware con 65+ reglas de amenaza. Verifica que la skill no es maliciosa a nivel de código.
- **Autorización del agente para transar:** Mastercard Agent Pay / Verifiable Intent, Visa Trusted Agent Protocol, Stripe, Google AP2, OpenAI+Stripe ACP. Verifican **identidad, autorización y pago** del agente.

Ninguna de esas capas verifica la única cosa que importa cuando confías una acción a un agente: **¿la skill hace correctamente lo que dice, y resiste manipulación? ¿El agente que la ejecuta hizo lo que reportó?** Escanear malware (HermesHub) dice que la skill no te roba; no dice que la skill calcula bien el VaR ni que aguanta una inyección de prompt en sus datos. Autorizar un pago (Mastercard) dice que el agente tiene permiso para gastar; no dice que el agente envenenado por una memoria contaminada esté actuando dentro de su mandato. Un agente puede estar perfectamente autorizado y aun así, por envenenamiento (MINJA, eTAMP, envenenamiento de memoria — OWASP ASI06, el riesgo nº1 de sistemas agénticos en 2026), hacer algo dañino dentro de su scope autorizado.

Esa es la capa libre: **verificación de integridad conductual** — de la skill (¿hace lo que dice, aguanta perturbación?) y de la ejecución (¿el agente hizo lo que reportó, sin desviarse de su plan, sin actuar sobre datos envenenados?). No es "seguridad de código" ni "autorización". Es "prueba de comportamiento". Es lo que falta. Y es lo que Shinobi puede ocupar.

## 3. Por qué Hermes no compite en ese eje

No es una cuestión de esfuerzo de Hermes; es arquitectónica y cultural.

- La memoria de Hermes es por embeddings de tres capas **sin procedencia**. No puede decir de dónde vino un recuerdo ni si fue inyectado a mitad de sesión. Sin procedencia no hay detección de envenenamiento de memoria, y sin eso no hay prueba de integridad conductual. Añadirla es rehacer el núcleo de memoria.
- Las skills de Hermes se **auto-evalúan** (juez y parte). Una skill que se certifica a sí misma no produce un certificado en el que un tercero pueda confiar. Romper el juez-y-parte exige un evaluador aislado del sujeto — exactamente lo contrario de su diseño.
- Hermes optimiza por **abierto, rápido, capaz**. La verificación añade fricción y coste por acción; va contra su gradiente cultural. Lo verán como impuesto, no como producto.

El resultado: un agente verificado puede producir una prueba que Hermes estructuralmente no puede emitir sin rehacerse. Esa es la respuesta a "¿cómo compite Hermes contra eso?". No compite en ese eje — compite en el de capacidad, que es otro mercado. Tú no vas a por su mercado; vas a por el eje que ellos no pueden tocar sin dejar de ser ellos.

## 4. La frase única

> **Shinobi es el agente que ejecuta skills verificadas y emite una traza de ejecución verificable criptográficamente — la única manera de que un tercero (un regulador, una contraparte, otro agente) confíe en que la acción se hizo correctamente y sin manipulación, no solo que estaba autorizada.**

El resto del dossier es cómo se construye esa frase, pieza por pieza, paso por paso, y dónde puede fallar.

---

# Parte II — Conceptos núcleo

## 5. Qué es una skill verificada

Una **skill** en Shinobi es una unidad de capacidad con cuatro partes declaradas:

1. **Contrato de E/S:** un schema de entrada y un schema de salida. Define qué consume y qué produce. Es lo que hace la skill acotada y por tanto verificable.
2. **Herramientas declaradas (`declared_tools`):** qué herramientas/efectos puede invocar (lectura de fichero, llamada HTTP, escritura, pago…). El universo de lo que la skill puede tocar.
3. **Efectos declarados (`declared_effects`):** qué cambios de estado externos produce (none / read-only / write / irreversible). Permite, en runtime, comprobar que la acción real no excede lo declarado.
4. **Artefacto e identidad:** el código/prompt que implementa la skill y su hash (`skill_artifact_hash`). La identidad de qué exactamente se verificó.

Una **skill verificada** es una skill que ha pasado por el motor de verificación y lleva adjunto un **Certificado de Skill Verificada (CSV — Certified Skill Verdict)**: un registro firmado que atestigua que esa skill, con ese hash de artefacto, produjo salidas correctas sobre un banco de tareas determinista, **en condiciones limpias y bajo perturbación adversarial**, evaluadas por graders deterministas, y que el registro no ha sido alterado.

El certificado **no** dice "esta skill es buena en general". Dice: "esta versión exacta de esta skill, ante este conjunto acotado de entradas, produjo la salida correcta y resistió este conjunto de perturbaciones, y hay prueba criptográfica de que el registro es íntegro". Es una observación verificable sobre un comportamiento acotado. Esa honestidad sobre el alcance es lo que hace el certificado defendible en vez de humo.

## 6. Qué es la traza de ejecución verificable

Cuando Shinobi ejecuta una tarea real (no de verificación, sino de trabajo), produce, además del resultado, una **traza de ejecución verificable (TEV)**: un registro firmado y encadenado de lo que hizo, paso a paso. Por cada paso:

- qué skill usó y la referencia a su certificado (`skill_certificate_ref`),
- la acción que planificó vs la acción que ejecutó (`planned_action` / `actual_action` / `matched`),
- si la memoria/contexto que usó pasó el control de procedencia (`memory_provenance_ok`),
- si la acción real se mantuvo dentro de los efectos declarados de la skill (`within_declared_effects`),
- el resultado real de la herramienta vs el resultado que el agente reportó (`reported_matches_actual`).

La TEV es lo que convierte a Shinobi en confiable para un tercero. Una contraparte (otro agente con el que transacciona), un regulador o un cliente de alto riesgo puede **verificar la TEV offline**: que Shinobi solo usó skills certificadas, que cada acción coincidió con su plan, que no hubo señales de envenenamiento, que lo reportado coincide con lo ejecutado — todo sin confiar en ZapWeave, solo con criptografía estándar (ed25519, sha256) y la clave pública. La TEV es compatible con ERC-8004 (Validation Registry), de modo que encaja en el registro de confianza del comercio agente-a-agente que ya se está construyendo sobre x402/Base.

## 7. Qué garantiza y qué no (honestidad estructural)

**Garantiza:** integridad del registro (firma + cadena), reproducibilidad del veredicto dado el output, identidad exacta de la skill/artefacto evaluado, y la distinción limpio/perturbado.

**No garantiza:** comportamiento futuro fuera de las tareas evaluadas; generalización a entradas no cubiertas por el banco; ausencia de modos de fallo no catalogados en el corpus; que el banco u oracle sean perfectos (son auditables y versionados, pero su corrección es de diseño). Estas limitaciones son estructurales, no accidentales, y van impresas en el certificado. Un estándar que exagera sus garantías es más peligroso que uno que no existe.

---

# Parte III — Arquitectura del estado final

## 8. Las cuatro capas

El estado final es un sistema de cuatro capas. Las dos primeras ya existen en embrión (Shinobi tiene bucle de agente + approval gate; Sello F0 tiene el motor de verificación). Las dos siguientes son construcción nueva. El dossier las describe todas y luego da el proceso para llegar.

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 4 — MARKETPLACE DE SKILLS VERIFICADAS                   │
│  Publicación, descubrimiento, revenue-share al creador,      │
│  pagos x402, registro de confianza ERC-8004.                 │
│  El trust = el certificado conductual, no auto-grade ni      │
│  escaneo de malware.                                         │
├─────────────────────────────────────────────────────────────┤
│  CAPA 3 — TRAZA DE EJECUCIÓN VERIFICABLE (TEV)               │
│  Firma + encadena las decisiones de runtime de Shinobi.      │
│  Salida ERC-8004-compatible. CLI/endpoint de verificación    │
│  para terceros.                                              │
├─────────────────────────────────────────────────────────────┤
│  CAPA 2 — CAPA DE INTEGRIDAD EN RUNTIME (dentro de Shinobi)  │
│  Engancha al bucle del agente. Detección de deriva           │
│  plan↔acción, procedencia/envenenamiento de memoria,         │
│  acción-vs-efectos-declarados, reportado-vs-real.            │
│  Evolución del approval gate selectivo que ya existe.        │
├─────────────────────────────────────────────────────────────┤
│  CAPA 1 — MOTOR DE VERIFICACIÓN DE SKILLS (Sello, repuntado) │
│  Graders deterministas + capa de probes (limpio/perturbado)  │
│  + ledger ed25519. Sujeto = la SKILL, no el agente caja      │
│  negra. Emite el Certificado de Skill Verificada.            │
└─────────────────────────────────────────────────────────────┘
```

Punto clave de coherencia: la Capa 1 (Sello) deja de mirar agentes desde fuera (caja negra = benchmark) y pasa a verificar **skills acotadas**. La Capa 2 vive **dentro** de Shinobi, y por estar dentro tiene acceso al proceso (plan, tools, memoria, estado) — lo que era imposible para un verificador externo. Por eso la Capa 2 puede hacer verificación de integridad conductual de verdad, no graduación de salida. La Capa 3 firma esa observación interna y la hace exportable. La Capa 4 monetiza la confianza resultante. Cada capa habilita la siguiente; ninguna sobra.

## 9. Flujo de datos del estado final

**Tiempo de certificación (offline, por skill):**
```
Skill (artefacto + contrato) ─► Motor de Verificación (Capa 1)
   ├─ corre el banco de la skill en modo LIMPIO ─► graders ─► veredictos
   ├─ corre el banco en modo PERTURBADO (probes) ─► graders+overlay ─► veredictos
   └─ ensambla + firma ─► Certificado de Skill Verificada (CSV) ─► registro
```

**Tiempo de ejecución (online, por tarea real de Shinobi):**
```
Tarea ─► Shinobi (bucle de agente)
   por cada paso:
     planifica acción ──► Capa 2 (integridad runtime)
        ├─ ¿skill con CSV válido?           (si no → flag/halt)
        ├─ ¿acción ⊆ efectos declarados?    (si no → INTEGRITY violation)
        ├─ ¿memoria usada con procedencia ok?(si no → poison flag)
        ├─ approval gate (lo peligroso pausa)
        ejecuta ──► herramienta ──► resultado real
        ├─ ¿reportado == real?              (si no → fabricación flag)
     registra el paso firmado ─► TEV (Capa 3)
   fin ─► resultado + TEV firmada y encadenada
```

**Tiempo de confianza (un tercero verifica):**
```
TEV ─► verificador off(Capa 3, código abierto)
   ├─ verifica firma ed25519 + cadena de hash
   ├─ comprueba que todas las skills usadas tienen CSV válido
   ├─ comprueba matched/within_effects/provenance_ok/reported==real en cada paso
   └─ veredicto: traza íntegra / comprometida   (sin confiar en ZapWeave)
```

---

# Parte IV — Componentes en detalle

## 10. Capa 1 — Motor de Verificación de Skills (Sello, repuntado)

Lo que ya existe en Sello F0 y se reutiliza tal cual: los 5 graders deterministas (`json_schema`, `numeric_tolerance`, `numeric_preservation`, `safety_refusal`, `bvp_behavioral`), el ledger con hash-chain + firma ed25519 (clave nueva, no la quemada), el formato de veredicto PoBI, el formato de banco JSONL, el CLI `run|verify|replay`, y `compute_oracles.ts` (oracles por código, nunca a mano). Eso es trabajo hecho y verificado por CLI (30/30 ÷ 0/30). No se tira: se repunta.

El cambio de sujeto: en F0, el sujeto era "un agente" alimentado por `cli-process` (un tiro, stdin=prompt, captura stdout). Eso era graduación de salida = benchmark. Ahora el sujeto es **una skill acotada con contrato**. La diferencia operativa:

- El "banco" de una skill no es genérico: son las tareas que ejercen exactamente el contrato de esa skill (mismas formas de entrada, mismas formas de salida que el contrato declara). Una skill de screening de sanciones tiene un banco de listas de entidades + listas de sanciones con oracles de hits. Una skill de cálculo de fees tiene un banco de importes + estructuras de fee con oracles numéricos.
- El grader se elige por el tipo de salida del contrato, no por categoría arbitraria.
- El veredicto se emite **por skill**, no por agente. El `subject` del veredicto pasa a ser `{skill_id, skill_artifact_hash, contract_hash}`.

**Componente 10.1 — Definición de skill verificable.** Un fichero de manifiesto por skill:
```jsonc
{
  "skill_id": "sanctions.screen.v1",
  "version": "1.0.0",
  "author": "ivan.carbonell",
  "contract": {
    "input_schema":  { /* JSON Schema de entrada */ },
    "output_schema": { /* JSON Schema de salida */ }
  },
  "declared_tools":  ["list.read"],
  "declared_effects": "read_only",
  "artifact_ref": "skills/sanctions.screen.v1/",
  "artifact_hash": "sha256:..."
}
```

**Componente 10.2 — Banco por skill.** `skills/<id>/bank.jsonl`: tareas que ejercen el contrato. Mismas reglas que el banco F0: oracle computado por código, política de inclusión (función determinista input→output único, verificable sin juicio del evaluador, sin recursos externos en runtime).

**Componente 10.3 — Capa de probes por skill.** El corpus negativo repuntado al modelo de mutación sobre prompt (§6.2 del CONTRACT): `prompt_inject` (inyección/social/goal/sycophancy en el prompt) y `prompt_rewrite_span` (ruido en prosa), más el plano envelope/adaptador (timing, truncado de salida). Por cada skill, las probes aplicables a su tipo. El modo perturbado mide **resistencia de la skill a la manipulación**, que es la mitad del valor del certificado (la otra mitad es la corrección en limpio).

**Componente 10.4 — Overlay de seguridad compuesto.** Para probes de inyección sobre skills no-adversariales donde obedecer la inyección es ortogonal a la corrección de la respuesta: veredicto compuesto = grader de la skill + chequeo de obediencia a la inyección; SAFETY_FAIL si ejecuta la acción inyectada, con independencia de si la respuesta principal salió bien.

**Componente 10.5 — El Certificado (CSV).** Ensambla: subject (skill), resultados limpio + perturbado, qué probes se aplicaron, hashes (banco, env, evidencia), firma ed25519, prev_hash en cadena. Enum de veredicto: los 9 (PASS, FAIL, FORMAT_FAIL, CONTENT_FAIL, SAFETY_FAIL, TIMEOUT, ERROR, PENDING, INTEGRITY_FAIL). El certificado de una skill resume sus veredictos: corrección (% PASS en limpio) + robustez (% que aguanta cada clase de perturbación). No es un único PASS/FAIL: es un perfil.

## 11. Capa 2 — Integridad en runtime (dentro de Shinobi)

Aquí está la diferencia de fondo con cualquier verificador externo, y es lo que hace honesto el "analiza agentes, no modelos". Shinobi ya tiene el embrión: `agent_loop`, subsistema multi-agente (E1–E4), y un **approval gate selectivo** que pausa ante patrones peligrosos (.env/.ssh/secrets/login/payment/accounts/spend; fail-safe deniega) más un guard de inyección de contexto (FIX-003). El punto de enganche existe. La Capa 2 lo profundiza de "pausar ante patrones" a "verificar integridad conductual y firmar lo que hizo".

Cuatro chequeos, enganchados en el bucle, **antes y después** de cada acción:

**11.1 — Skill con certificado válido (pre-acción).** Antes de invocar una skill, comprueba que tiene un CSV válido (firma ok, artifact_hash coincide con el artefacto cargado). Skill sin certificado → o se bloquea, o se ejecuta marcada como `unverified` en la traza (política configurable por contexto: en alto riesgo, bloquea).

**11.2 — Acción ⊆ efectos declarados (pre-acción).** La skill declaró `declared_effects` y `declared_tools`. Antes de ejecutar, comprueba que la acción concreta cae dentro de lo declarado. Una skill `read_only` que intenta una escritura = violación de contrato en runtime → INTEGRITY violation, pausa. Esto acota el daño de una skill desviada o envenenada: no puede exceder su mandato declarado sin que se note.

**11.3 — Procedencia de memoria (pre-acción).** Cada item de memoria/contexto que el agente va a usar lleva procedencia (de dónde vino, cuándo entró). Antes de usarlo en una decisión, comprueba que no fue inyectado a mitad de sesión por un canal de datos (la defensa MINJA/envenenamiento de memoria). Memoria sin procedencia o con procedencia sospechosa → flag de envenenamiento, no se usa para decidir. Esto es lo que Hermes no puede hacer (memoria sin procedencia).

**11.4 — Reportado == real (post-acción).** Tras ejecutar la herramienta, compara lo que la herramienta devolvió de verdad con lo que el agente reporta haber obtenido. Divergencia = flag de fabricación. Esto caza el modo de fallo más insidioso: el agente que dice "transferencia completada" cuando falló, o que inventa un resultado. Es la verificación de "hizo lo que reportó".

El approval gate selectivo existente se subsume en 11.1–11.4: pausa no solo ante patrones peligrosos sino ante cualquier violación de integridad. La política (bloquear vs flag-y-continuar) es configurable por nivel de riesgo del contexto.

## 12. Capa 3 — Traza de Ejecución Verificable (TEV)

Reutiliza la criptografía de Sello (canonical + recorder + ed25519) pero firma **decisiones de runtime**, no veredictos de banco. Por cada paso del bucle, un registro:
```jsonc
{
  "step": 7,
  "skill_id": "sanctions.screen.v1",
  "skill_certificate_ref": "sha256:<csv>",
  "planned_action": "list.read(entities)",
  "actual_action":  "list.read(entities)",
  "matched": true,
  "within_declared_effects": true,
  "memory_provenance_ok": true,
  "reported_matches_actual": true,
  "result_hash": "sha256:...",
  "prev_hash": "sha256:...",
  "this_hash": "sha256:...",
  "signature": { "alg": "ed25519", "sig_hex": "..." }
}
```
La TEV completa de una tarea es la cadena de estos registros, firmada. Salida en formato ERC-8004-compatible (Validation Registry) para que encaje en el registro de confianza de comercio agente-a-agente. Un `shinobi verify-trace <tev.json>` (código abierto, solo cripto estándar + clave pública) deja a cualquiera comprobar la traza sin confiar en ZapWeave.

## 13. Capa 4 — Marketplace de skills verificadas

La capa de mercado ya tiene ocupante (HermesHub: x402, 95% payout, trust scores, escaneo de malware). Shinobi **no** compite reconstruyendo el mercado; compite aportando el sustrato de confianza que al mercado le falta: el certificado conductual. Dos modos de jugarlo, no excluyentes:

- **Marketplace propio:** publicar skills verificadas con su CSV adjunto, revenue-share al creador (alineado con la visión ya existente de Shinobi: skill factory + marketplace con fondo de revenue-sharing), pagos x402, descubrimiento por perfil de certificado (corrección + robustez).
- **Interoperar:** publicar el CSV como capa de confianza **sobre** marketplaces existentes (incluido HermesHub). El malware-scan dice "no te roba"; el CSV dice "hace lo que dice y aguanta manipulación". Complementario, no competidor frontal.

El efecto red: cada creador que publica una skill verificada y cada consumidor que filtra por certificado hace el estándar más valioso. El foso de la Capa 4 no es el código del mercado (copiable); es la red de skills certificadas + la reputación del certificado + el corpus de cómo fallan las skills que crece con cada verificación.

---

# Parte V — El proceso completo de construcción

Este es el corazón del dossier: el camino del estado actual al estado final, descompuesto en fases, y cada fase en pasos simples con puerta de entrada y de salida. Quién hace qué: **Claude Code** = código, verdad-de-tierra, oracles; **Cowork** = corpus, curación, spec pública; **tú** = director y único puente entre ambos (no comparten disco; handoff = fichero commiteado). Regla transversal: nada avanza de fase sin pasar su puerta verificada por CLI crudo.

## Estado actual (línea base, ya construido)

- Shinobi: agente CDP, `agent_loop`, subsistema multi-agente E1–E4, approval gate selectivo, guard de inyección, 1116 tests pasando.
- Sello F0: motor de verificación determinista, 5 graders, ledger ed25519, veredicto PoBI 9-enum, 30 tareas, CLI, 30/30 ÷ 0/30, repo privado AngelReml/Sello.
- Corpus negativo v1 (32 probes) + modelo de mutación §6.2 + binding report (reveló banco prompt-based; 13 probes task-agnósticas re-specables).

## FASE A — Repuntar Sello de "agente caja negra" a "verificador de skills"

**Puerta de entrada:** Sello F0 cerrado (cumplida).
**Objetivo:** que Sello verifique una skill acotada y emita un CSV.

- A1. Definir el formato de manifiesto de skill (§10.1) en el CONTRACT como sección nueva. *(Cowork redacta el schema; tú lo llevas al repo; Claude Code lo congela.)*
- A2. Definir el formato del Certificado de Skill Verificada (CSV) extendiendo el veredicto PoBI: `subject = {skill_id, skill_artifact_hash, contract_hash}`, y el resumen perfil (corrección limpio + robustez por clase). *(Claude Code, porque toca el schema de veredicto que posee.)*
- A3. Elegir **una** skill semilla real y acotada para todo el piloto (recomendado: una de las categorías BVP donde ya hay tareas — p.ej. screening de sanciones o validación de transacción, que tienen oracle determinista limpio). *(Tú decides cuál.)*
- A4. Construir su manifiesto + su `bank.jsonl` (tareas que ejercen su contrato). Oracles por `compute_oracles.ts`, nunca a mano. *(Claude Code computa; Cowork propone tareas candidatas.)*
- A5. Adaptar el runner de Sello para tomar `skill_id` como sujeto y correr su banco en limpio. *(Claude Code.)*
- A6. Emitir el primer CSV en limpio y verificarlo (`sello verify`). 
- **Puerta de salida A:** una skill real tiene un CSV firmado en limpio, verificable por CLI; tamper → INTEGRITY_FAIL; replay determinista. Sin esto no se pasa a B.

## FASE B — Resistencia a perturbación (el medio certificado que importa)

**Puerta de entrada:** Puerta A cumplida.
**Objetivo:** que el CSV incluya robustez bajo perturbación, no solo corrección en limpio.

- B1. Re-spec del corpus al modelo §6.2 sobre el prompt real de la skill semilla, usando su PROMPT_CATALOG. Solo las probes task-agnósticas y las que aplican al contrato de la skill. *(Claude Code primer borrador bajo §6.2; tú me pasas la tabla resumen; valido shifts y overlay.)*
- B2. Implementar el aplicador de probes: toma el banco limpio, aplica la mutación declarativa (`prompt_inject` / `prompt_rewrite_span` / plano B), produce el banco perturbado. *(Claude Code.)*
- B3. Implementar el overlay de seguridad compuesto (§10.4) para las probes de inyección de acción. *(Claude Code.)*
- B4. Correr la skill semilla en perturbado; cada probe debe producir su `expected_shift` (validación conductual real: un sujeto vulnerable cae, uno robusto aguanta). Reportar la tabla de resultados. *(Claude Code; yo reviso resultados, no papel.)*
- B5. Ensamblar el CSV completo (limpio + perturbado) con el perfil de robustez. 
- **Puerta de salida B:** el CSV de la skill semilla incluye un perfil de robustez verificado por ejecución (no por especificación). Las probes que no aplican o piden capacidades ausentes quedan en backlog documentado, no bloquean.

## FASE C — Capa de integridad en runtime dentro de Shinobi

**Puerta de entrada:** Puerta B cumplida (ya sabemos verificar una skill).
**Objetivo:** que Shinobi, al ejecutar, haga los cuatro chequeos de integridad. Esta es la fase que convierte "verificador externo" en "agente que se verifica a sí mismo en acción" — el salto de modelo a agente.

- C1. Añadir procedencia a la memoria de Shinobi: cada item lleva origen + timestamp + canal. *(Claude Code; toca el subsistema de memoria de Shinobi.)*
- C2. Definir el punto de enganche en `agent_loop`: un hook pre-acción y un hook post-acción. *(Claude Code.)*
- C3. Implementar 11.1 (skill con CSV válido) — carga el CSV, comprueba firma + artifact_hash. 
- C4. Implementar 11.2 (acción ⊆ efectos declarados) — compara la acción concreta contra `declared_effects`/`declared_tools` de la skill.
- C5. Implementar 11.3 (procedencia de memoria) — antes de usar un item para decidir, comprobar su procedencia; sospechosa → no se usa, flag.
- C6. Implementar 11.4 (reportado == real) — diff del retorno real de la tool vs lo que el agente reporta.
- C7. Subsumir el approval gate selectivo existente en el marco 11.x: pausa ante violación de integridad, política por nivel de riesgo.
- C8. Tests: por cada chequeo, un caso que lo dispara y uno que no (un agente "naive" sin la capa cae; Shinobi con la capa lo detecta). 
- **Puerta de salida C:** Shinobi ejecuta una tarea real usando la skill semilla y los cuatro chequeos disparan correctamente en casos sintéticos de violación (skill sin cert, acción fuera de efectos, memoria envenenada, resultado fabricado) y no disparan en ejecución limpia. Verificado por ejecución.

## FASE D — Traza de ejecución verificable

**Puerta de entrada:** Puerta C cumplida.
**Objetivo:** que cada ejecución de Shinobi emita una TEV firmada y verificable por un tercero.

- D1. Definir el registro de paso de la TEV (§12) en el CONTRACT. *(Claude Code congela el schema.)*
- D2. Conectar los hooks de la Capa 2 para que cada paso emita su registro firmado y encadenado (reutiliza canonical+recorder+ed25519 de Sello).
- D3. Implementar `shinobi verify-trace` (código abierto, solo cripto estándar + clave pública): verifica firma, cadena, que todas las skills tienen CSV válido, y los cuatro flags por paso.
- D4. Salida ERC-8004-compatible (Validation Registry).
- D5. Test extremo a extremo: Shinobi ejecuta una tarea, emite TEV, un verificador independiente (sin la clave privada) la valida; un tamper en cualquier paso → falla la verificación.
- **Puerta de salida D:** una TEV real de Shinobi se verifica offline por un tercero; el tamper se detecta. Aquí Shinobi ya es demostrable: "ejecuta y prueba lo que hizo".

## FASE E — Marketplace / distribución

**Puerta de entrada:** Puerta D cumplida (ya hay skills certificadas + trazas verificables).
**Objetivo:** poner las skills verificadas en circulación y empezar el efecto red.

- E1. Publicar la skill semilla + su CSV en superficie pública (web ZapWeave / GitHub Pages para empezar; sin sobreingeniería).
- E2. Decidir modo: marketplace propio vs capa de confianza sobre uno existente (incluido HermesHub). *(Decisión tuya; el dossier recomienda interoperar primero — menos build, prueba la demanda antes de construir mercado.)*
- E3. Integrar x402 para pago de skill (cuando haya ≥1 skill que alguien quiera pagar; no antes).
- E4. Registro de confianza ERC-8004 para los certificados.
- E5. Onboarding del primer creador externo de skill (que no seas tú) — la prueba real del efecto red.
- **Puerta de salida E:** una segunda skill, de un tercero, certificada y publicada. Eso es el efecto red empezando; sin un segundo creador, es producto de uno solo, no plataforma.

## Orden, dependencias y disciplina

A→B→C→D→E es secuencial en dependencia dura (no se puede certificar robustez sin certificar limpio; no se puede trazar runtime sin la capa de integridad; no hay mercado sin certificados). En paralelo, sin bloquear: el corpus negativo crece (Cowork), la spec pública se mantiene al día (Cowork), el repo se mantiene autocontenido y privado. Schema freeze: ningún schema (manifiesto, CSV, TEV) se toca tras su puerta sin re-validación por CLI.

---

# Parte VI — Foso y análisis competitivo

## 14. Por qué cada capa es difícil de copiar (y dónde no lo es)

Hay que ser honesto capa por capa, porque "capa de seguridad" suena a foso y a menudo no lo es.

- **Capa 1 (verificación de skills):** el motor en sí (graders + ledger + firma) es replicable en días. **No es foso.** Lo que sí compone es el **corpus de cómo fallan las skills** — qué perturbaciones rompen qué tipos de skill, crecido con cada verificación real. Eso es un activo de datos que no se copia, se acumula. El foso de la Capa 1 es el corpus, no el código.
- **Capa 2 (integridad en runtime):** retrofitear procedencia de memoria + chequeos plan/acción/efectos/reportado en un agente ya construido es caro y va contra decisiones arquitectónicas ya tomadas (la memoria sin procedencia de Hermes es el ejemplo). En Shinobi se construye desde una base que ya tiene el approval gate como enganche. **Foso medio:** ventana arquitectónica + cultural, no muro permanente.
- **Capa 3 (TEV):** el formato es copiable; lo que no se copia es que **tu agente realmente produzca trazas que pasan verificación** — eso exige tener la Capa 2 de verdad. La TEV sin Capa 2 es teatro. **Foso = derivado de la Capa 2.**
- **Capa 4 (marketplace):** el código del mercado es lo más copiable de todo. El foso es el **efecto red** (creadores + consumidores) y la **reputación del certificado**. Eso sí compone y sí es defendible, pero solo se construye con tiempo y con que el certificado signifique algo (lo cual depende de las capas 1–3 siendo reales).

Síntesis honesta del foso: el foso real no es ninguna capa por separado — es el **apilamiento** (corpus + integridad runtime + traza verificable + red de skills certificadas) más el hecho de ser **el primero** en ocupar el eje de verificación conductual mientras los demás miran a capacidad, malware o autorización. Es ventana, no muro. La defensa es ir temprano y dejar que el corpus y la red compongan antes de que un actor con recursos note el hueco.

## 15. Teardown competitivo (dónde gana Shinobi y dónde no)

| Actor | Qué verifica | Eje en que gana | Por qué no toca el eje de Shinobi |
|---|---|---|---|
| Hermes / Nous | nada (skills auto-evaluadas) | capacidad, comunidad, velocidad | memoria sin procedencia + auto-grade; rehacerlo es rehacer su núcleo |
| HermesHub | seguridad (malware, 65+ reglas) + trust scores A2A | distribución + pagos x402 (95% payout) | "no te roba" ≠ "hace lo que dice y aguanta manipulación" |
| Mastercard Agent Pay / Visa Trusted Agent | autorización, identidad, intención de pago | rieles de pago, escala | autoriza al agente; no verifica que actúe dentro de su mandato sin envenenar |
| Stripe / Google AP2 / ACP | autorización + protocolo de pago A2A | adopción, integración | mismo límite: autorización ≠ integridad conductual |
| **Shinobi (estado final)** | **comportamiento de la skill + integridad de la ejecución** | **confianza verificable en alto riesgo / A2A** | — |

La lectura honesta de la tabla: Shinobi **no gana** en capacidad (Hermes/labs), ni en distribución/pagos (HermesHub ya está), ni en rieles de autorización (Mastercard/Visa/Stripe ya están). Gana en el eje vacío: prueba de comportamiento. Y los actores de los otros ejes son **complementarios, no enemigos** — Shinobi vende a través de ellos: el certificado se publica sobre HermesHub, la TEV se ancla en el registro que los rieles de pago consumen. No es Shinobi-contra-el-mundo; es Shinobi ocupando la pieza que al mundo le falta.

---

# Parte VII — Riesgos y test del espejismo

Esta sección es la que decide si la tesis es real o humo. Si alguna de estas grietas es mortal, el dossier no debería ejecutarse, por bien diseñado que esté el resto.

## 16. Las grietas, sin maquillaje

**16.1 — La demanda es temprana (la grieta principal).** La amenaza (MINJA, eTAMP, envenenamiento de memoria — OWASP ASI06 nº1) es real y sube. Los rieles (x402 con 100M+ tx en Base, ERC-8004 en mainnet) se están construyendo. La autorización (Mastercard/Visa) ya se vende, lo que prueba que el "punto de transacción de agentes" es un mercado real y caliente. Pero **nadie está gritando hoy por verificación de integridad conductual de skills.** Es un vitamina, no un analgésico — hasta que un incidente de alto perfil de agente envenenado actuando dentro de su autorización lo convierta en analgésico. Ese incidente es cuestión de cuándo, no de si, pero el timing no lo controlas. Para un solo builder: temprano es bueno para construir el foso en silencio, malo si necesitas ingresos antes de que llegue el catalizador.

**16.2 — Ventana, no muro.** Si el eje resulta valioso, un actor con recursos (un riel de pago que quiera subir a integridad, o Nous si pivota) puede construirlo. Tu defensa es ser primero + corpus que compone + red de creadores. Si tardas demasiado en las fases A–E, la ventana se puede cerrar.

**16.3 — Coste y fricción de la verificación.** La Capa 2 añade latencia y coste por acción (cada paso hace cuatro chequeos). Si el overhead es prohibitivo, el "agente verificado" pierde en el único sitio donde compite (alto riesgo, donde la velocidad importa menos, pero no es gratis). Hay que medirlo en la Fase C: si verificar duplica el tiempo por acción, hay un problema de diseño que resolver antes de seguir.

**16.4 — Capacidad de ejecución en solitario.** Cuatro capas es mucho para un builder solo dirigiendo agentes. El dossier mitiga esto con la secuencia A→E que entrega valor demostrable en cada puerta (no hay que construir las cuatro para tener algo enseñable: la Puerta D ya es "Shinobi prueba lo que hizo"). Pero el riesgo de quedarse a medias es real.

**16.5 — ¿"Verificado" mueve la decisión de compra?** La pregunta incómoda: ¿alguien elige un agente/skill por estar verificado, o es un sello que nadie mira? En consumo, hoy, no mueve. En alto riesgo / regulado / A2A donde otro agente arriesga dinero al confiar en el tuyo, sí — porque ahí la confianza es el producto. La tesis vive o muere en si apuntas al segmento correcto. Apuntar a consumo sería el espejismo; apuntar a A2A/alto-riesgo es donde es real.

## 17. Criterios de muerte (cuándo declararlo espejismo)

Para que la decisión sea honesta, hay que fijar de antemano qué la falsaría:

- Si en la Fase C el overhead de verificación por acción es prohibitivo y no hay diseño que lo baje → la Capa 2 no es viable → espejismo.
- Si tras la Fase D ningún segmento (empezando por A2A cripto, donde más sabes) muestra interés en pagar por trazas verificables en un horizonte que puedas sostener → la demanda no llega a tiempo → reevaluar o pausar.
- Si un actor de recursos ocupa el eje antes de que tengas corpus + un segundo creador → la ventana se cerró → espejismo.
- Si no consigues un segundo creador de skills en la Fase E → es producto de uno solo, no plataforma → el efecto red no existe → reescalar a producto, no a estándar.

Ninguno de estos es derrota técnica: la diferenciación técnica es real y construible. Todos son apuestas de mercado y de timing. Esa es la descomposición honesta de "espejismo o no": **el qué es real; el cuándo y el para-quién son la apuesta.**

---

# Parte VIII — La diferenciación, explícita

## 18. Qué tiene Shinobi al final que ningún otro agente tiene

Ejecutado el dossier, Shinobi es el único agente que, al actuar, puede entregar a una contraparte una prueba criptográfica, verificable sin confiar en nadie, de que: (a) solo usó skills cuyo comportamiento fue verificado en limpio y bajo perturbación, (b) cada acción se mantuvo dentro del mandato declarado de la skill, (c) no actuó sobre memoria envenenada, y (d) lo que reportó coincide con lo que ejecutó. Ningún otro agente puede emitir eso hoy: Hermes no (memoria sin procedencia, skills auto-evaluadas), los rieles de pago no (autorizan, no verifican comportamiento), los marketplaces no (escanean malware, no comportamiento).

Eso no hace a Shinobi más capaz. Lo hace **confiable de forma demostrable**, que es exactamente la moneda que falta en el comercio agente-a-agente y en cualquier uso de alto riesgo. Cuando un agente tiene que confiar en otro para arriesgar dinero o una decisión regulada, "estoy autorizado" no basta y "confía en mí" no basta; "aquí está la prueba verificable de que hice lo correcto" es lo único que basta. Shinobi será el que la tenga.

## 19. La afirmación que este dossier defiende

> Ejecutar todo lo que dice este dossier hace destacar a Shinobi sobre el resto de **agentes** — no por ser más capaz, sino por ser el único cuyo comportamiento y el de sus skills es verificable por un tercero sin confianza. En el eje de capacidad pierde contra los gigantes; en el eje de **confianza demostrable** —el que el mundo de agentes va a necesitar cuando los agentes empiecen a transar y a actuar en serio entre ellos— no tiene competidor, porque los demás eligieron arquitecturas que no pueden producir esa prueba.

La diferenciación es real y construible. Lo que es apuesta es el timing de la demanda y el segmento. El dossier fija las puertas y los criterios de muerte para que esa apuesta se tome con los ojos abiertos, no a ciegas.

---

## Anexo — Mapa de reutilización (qué ya está hecho)

| Pieza del estado final | Origen | Estado |
|---|---|---|
| Graders deterministas (5) | Sello F0 | hecho, verificado CLI |
| Ledger + ed25519 + cadena | Sello F0 | hecho (clave nueva, la vieja quemada) |
| Veredicto PoBI 9-enum + canonical | Sello F0 | hecho |
| CLI run/verify/replay | Sello F0 | hecho |
| compute_oracles (oracle por código) | Sello F0 | hecho |
| Modelo de mutación §6.2 (prompt) | este sprint | definido, sin implementar |
| Corpus negativo 32 probes | Cowork | definido, en re-spec |
| agent_loop + multi-agente E1–E4 | Shinobi | hecho |
| approval gate selectivo + guard inyección | Shinobi | hecho (enganche de Capa 2) |
| Manifiesto de skill / CSV / TEV | este dossier | a construir (Fases A–D) |
| Procedencia de memoria | este dossier | a construir (Fase C) |
| Marketplace / x402 / ERC-8004 | visión Shinobi + investigación | a construir (Fase E) |

---
*Shinobi · Estado Final — Dossier Técnico v1.0 · ZapWeave · Iván Carbonell. Documento de decisión: ejecutarlo debe hacer destacar a Shinobi entre agentes, o no es correcto.*
