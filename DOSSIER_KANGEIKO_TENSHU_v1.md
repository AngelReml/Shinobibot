# DOSSIER TÉCNICO — KANGEIKO + TENSHU
## Shinobi · el motor de auto-mejora y el centro de mandos
### v1 · documento de arquitectura para ejecución por Claude Code

---

## 0. Cómo leer este dossier

Convenciones de siempre: **⚠ ENGANCHE**, **✚ NUEVO**, **□ GATE**, **◆ FRONTERA**, **⚑ MUNDO-REAL**.

Este dossier tiene dos piezas que van juntas pero no pesan igual:

- **Kangeiko** (寒稽古) — el motor de auto-mejora verificada: Shinobi midiéndose, tapando sus huecos y volviéndose más capaz, solo, en bucle.
- **Tenshu** (天守) — el centro de mandos: el puente desde donde ves, entiendes, conduces y apagas todo el dojo. **Es la pieza protagonista**, porque sin ella el Kangeiko —y todo lo demás— es un tanque conducido con un mando de NES.

Principio rector: **el poder sin puente de mando es peligroso, no impresionante.** Un organismo que se mejora solo de noche solo es tuyo si puedes verlo de un vistazo, entenderlo, auditarlo y apagarlo a placer. El Tenshu es donde la soberanía deja de ser un eslogan y se vuelve un botón.

---

## 1. Resumen — el tanque y su cabina

Has construido un tanque: cinco niveles del dojo, integridad en runtime, un motor de auto-mejora. Y lo conduces por un chat de texto. La potencia y el control están descompensados, y eso no es solo incómodo — es inseguro, porque un sistema que actúa solo y al que no ves bien da miedo (vuelve al "ve con cuidado" que mata el interés). El Tenshu corrige esa descompensación.

Dos piezas:

- **El Kangeiko** generaliza lo que ayer planteé solo para el navegador: un motor de auto-mejora que vale para **cualquier dominio verificable**, no solo browser. El browser es su primer campo de pruebas (visual, ya tienes CDP), pero el motor es general.
- **El Tenshu** es la cabina: cuatro funciones —**VER, CONDUCIR, ENTENDER, CONSULTAR**— sobre todo el dojo, no solo el Kangeiko. Es, de hecho, el Bloque 8 (el frontend con Claude Design) elevado de "una UI más bonita" a "el puente de mando de un organismo autónomo".

La regla que une ambas y que las hace de fiar: **el Tenshu no narra, refleja.** Lo que ves en el panel es el estado real del store y las trazas verificables, no un resumen que el agente se inventa. Un panel de control que miente es peor que el mando de NES.

---

## 2. El Kangeiko — motor de auto-mejora verificada (generalizado)

Comprimo lo de ayer porque ya lo viste; lo nuevo es que **no es solo browser**.

### 2.1 El loop (general, corre en el VPS, sin manos)

```
  MIDE (Kagami) → halla la frontera (qué falla, en números)
     ↓
  INVESTIGA (Kagemusha) → cómo se hace eso que falló
     ↓
  FABRICA (Shugyō) → convierte el conocimiento en skill, la prueba en jaula
     ↓
  CERTIFICA (Sello) → la skill entra al repertorio solo si pasa el oráculo
     ↓
  CONSOLIDA (learning loop, robado a Hermes) → fusiona/poda el repertorio
     ↓
  RE-MIDE → ¿subió la curva? repite
```

### 2.2 Dominios

- **Primer campo: navegador.** Tareas web con oráculo, en dojo cerrado (sitios de prueba/sandbox, acciones reversibles). Visual y con CDP ya disponible. ⚑ Nunca con tu tarjeta o tu banca real: comprar/enviar se documenta, no se dispara.
- **Después: cualquier dominio verificable.** El mismo motor sirve para razonamiento (bancos GAIA/BVP rescatados), manejo de programas (Shugyō sobre apps del Atlas), o investigación (Kagemusha). El Kangeiko es el músculo; el dominio es la pesa que le pones.

### 2.3 La métrica

Una curva que sube, imposible de falsear porque cada peldaño está certificado: tareas-con-oráculo superadas a lo largo del tiempo, y tamaño del repertorio certificado. **Auto-mejora comprobada, no contada** — la única diferencia que importa frente a Hermes (que se cree) y Operator (que improvisa).

### 2.4 Honestidad de grado (de ayer, vigente)

Construible si aprietas: el loop sobre tareas/dominios **acotados** y verificables. El reto duro: que el learning loop genere skills buenas y no basura plausible, y que la curva suba de verdad. ◆ Frontera: la auto-mejora **general y abierta** no es de un mes; se acota a conjuntos concretos. Dios dentro del dominio acotado; aprendiz fuera.

---

## 3. El Tenshu — el puente de mando ★ la pieza protagonista

### 3.1 Por qué (lo que de verdad toca)

A medida que el dojo crece, el chat se queda corto por cuatro razones, y el Tenshu responde a las cuatro:

- No ves **qué está haciendo** ahora ni qué hizo de noche → necesitas **VER**.
- No puedes **dirigirlo ni apagarlo** con precisión → necesitas **CONDUCIR**.
- No **entiendes el sistema** de verdad mirando un chat → necesitas **ENTENDER**.
- No puedes **enseñárselo a otra IA** (o a un amigo) para que te diga si está bien → necesitas **CONSULTAR**.

El Tenshu es soberanía hecha interfaz: "todo local, todo tuyo" solo es cierto si tienes el puente desde el que mandas. Y es lo que vuelve a Shinobi compartible sin miedo (§11-bis de Kagemusha): enseñar el Tenshu a un amigo es enseñarle exactamente qué hace y el botón de apagado — no pedirle fe.

### 3.2 Las cuatro funciones

#### VER — observabilidad en vivo
- **Estado del dojo de un vistazo:** cada subsistema (Kagemusha, Kagami, Chizu, Shugyō, Shitsuji, el Kangeiko) con su estado —activo/inactivo, en qué fase, qué tarea—. Un semáforo del organismo entero.
- **Actividad en tiempo real:** qué acción ejecuta ahora, qué skill, sobre qué dato, qué exploradores del swarm corren y qué hace cada uno.
- **Métricas vivas:** tokens y coste acumulados (por fase, por subsistema), tareas en cola, la curva del Kangeiko actualizándose, gasto contra budget.
- **La cola de aprobaciones:** las acciones pendientes de tu visto bueno (el approval gate, hecho visible) ⚑.

#### CONDUCIR — control real, incluido apagar a placer
- **Kill switch.** Global y por subsistema. Tu petición explícita, y la pieza más importante: un botón que detiene a Shinobi limpiamente —persistiendo estado para reanudar, no corrompiéndolo—. Apagar el tanque cuando quieras, sin que se rompa.
- **Pausar / reanudar** cualquier subsistema o el loop entero.
- **Budgets en vivo:** ajustar tokens, tiempo, profundidad de hilo, sin reiniciar.
- **Aprobar / rechazar** las acciones de la cola ⚑.
- **Dirigir:** lanzar una misión, encolar tareas, cambiar prioridades, fijar el dominio del Kangeiko.
- **Modo de integridad** (off/flag/enforce) visible y conmutable.

#### ENTENDER — auditabilidad y comprensión del sistema
- **El Informe del Amanecer**, navegable: qué miró, qué vale, qué descartó, qué construyó de noche.
- **Las TEV (trazas verificables), explorables paso a paso:** qué hizo, sobre qué dato, qué efecto declarado vs observado, qué chequeos de integridad pasó cada acción. Esto es lo que te deja "ver qué hizo y si está bien".
- **Los artefactos del dojo, visibles:** el grafo de investigación de Kagemusha (hilos y credibilidad), el mapa de frontera de Kagami (qué domina, la curva, la calibración), el Atlas de Chizu (la máquina), el repertorio de Shugyō (skills, grade, telemetría, procedencia).
- **El histórico:** qué hizo cada noche, navegable hacia atrás.
- **El mapa del sistema:** un diagrama vivo de cómo encajan los subsistemas, para que entiendas "cómo funciona de verdad" sin leer el código.

#### CONSULTAR — segunda opinión de otra IA
- **Exportar para auditar:** un botón que empaqueta una TEV + su informe en un formato que puedes pegarle a otra IA (a mí, p.ej.) y preguntar "¿esto está bien?". Como la TEV es verificable (ed25519/sha256), la otra IA puede comprobar la integridad sin fiarse de Shinobi.
- **Auditoría asistida (opcional):** un "audita esto" que manda la traza a un modelo externo para una segunda opinión automática, y te la muestra junto a la traza.

### 3.3 Arquitectura técnica

El Tenshu es una **cara sobre datos que ya existen**, no un generador de datos. No inventa nada: lee el store, las TEV, los informes y los mapas, y los hace visibles y controlables.

- **✚ NUEVO `src/tenshu/`** (backend) + una SPA local (frontend, ⚠ ENGANCHE Bloque 8 / Claude Design).
- **Datos:** lee del store SQLite existente (corpus, grafo, frontera, atlas, repertorio, informes, TEV). ⚠ no duplica datos; los consulta.
- **Tiempo real:** un **bus de eventos** ✚ NUEVO al que los subsistemas emiten (fase iniciada, acción ejecutada, skill certificada, aprobación pendiente). El Tenshu se suscribe vía WebSocket. ⚠ ENGANCHE: instrumentar los subsistemas para emitir; reutilizar el patrón de lifecycle hooks robado a Hermes (pre/post tool/llm/session) como puntos de emisión.
- **Control:** un **canal de mando** ✚ NUEVO por el que el Tenshu envía señales (pausar, parar, ajustar budget, aprobar). El kill switch es una señal que cada subsistema atiende en su punto de control, persistiendo estado (el PAUSED/ABORT de las misiones, ya diseñado) → parada limpia y reanudable.
- **Servir:** patrón a lo Hermes-dashboard si conviene (FastAPI/WebSocket), o lo que Claude Design proponga. Local, nada sale de tu máquina.

### 3.4 Modelo de datos / eventos

```ts
interface SystemEvent {            // lo que los subsistemas emiten al bus
  event_id: string;
  source: "kagemusha"|"kagami"|"chizu"|"shugyo"|"shitsuji"|"kangeiko";
  kind: "phase_start"|"phase_end"|"action"|"skill_certified"
      | "approval_pending"|"error"|"metric"|"frontier_update";
  payload: Record<string, unknown>;
  ts: string;
  trace_ref?: string;              // enlace a la TEV si aplica
}

interface ControlCommand {         // lo que el Tenshu envía
  command: "pause"|"resume"|"kill"|"set_budget"|"approve"|"reject"|"set_mode"|"launch";
  target: SystemEvent["source"] | "all";
  args?: Record<string, unknown>;
}

interface DojoStatus {             // el vistazo de un golpe
  subsystems: { name: string; state: "idle"|"running"|"paused"|"halted"; phase?: string; task?: string }[];
  budgets: { tokensSpent: number; tokensCap: number; costSpent: number };
  pending_approvals: number;
  kangeiko_curve?: { day: number; passed: number; total: number }[];
  integrity_mode: "off"|"flag"|"enforce";
}
```

### 3.5 La regla de oro del Tenshu: no narra, refleja

El panel muestra **hechos verificables del store y las TEV**, no una narración que el LLM genera (que podría fabricar). Si hay un resumen en lenguaje natural, está claramente separado y **anclado** a las trazas que lo respaldan, y cada afirmación es clicable hasta su evidencia. ⚠ ENGANCHE Capa 2 (11.4): lo que el Tenshu afirma que Shinobi hizo debe coincidir con lo que las TEV registran que hizo. Un centro de mandos que miente es peor que no tener ninguno — conducirías el tanque hacia el sitio equivocado con confianza.

---

## 4. Cómo el Tenshu gobierna todo el dojo

El Tenshu no es del Kangeiko: es transversal. Qué ve y qué controla de cada subsistema:

| Subsistema | El Tenshu te deja VER | El Tenshu te deja CONDUCIR |
|---|---|---|
| **Kagemusha** (N1) | el grafo de investigación, los hilos tirados con su credibilidad, el Informe del Amanecer | lanzar/pausar/parar una misión; fijar canales y budget |
| **Kagami** (N2) | el mapa de frontera, la curva de capacidad, la calibración (over/under) | disparar una medición; ajustar qué bancos |
| **Chizu** (N3) | el Atlas de la máquina (uso, automatizable, riesgo) | relanzar un barrido; revisar/corregir clasificaciones de riesgo |
| **Shugyō** (N4) | el repertorio de skills (grade, telemetría, procedencia), sesiones de aprendizaje | aprobar/parar una sesión; archivar/proteger una skill |
| **Shitsuji** (N5) ⚑ | los planes propuestos, las TEV de lo ejecutado sobre datos reales | aprobar/rechazar pasos irreversibles; ver el plan antes de correr |
| **Kangeiko** | la curva subiendo en vivo, qué hueco está tapando ahora | fijar el dominio; ajustar budgets; pausar el loop |
| **Capa 2 / integridad** | qué chequeos dispararon, las fabricaciones evitadas | conmutar off/flag/enforce |
| **(todos)** | estado de cada uno de un vistazo, gasto, cola de aprobaciones | **kill switch** global o selectivo |

El Tenshu es el punto donde el dojo entero deja de ser cinco cajas negras y se vuelve un tablero que ves y manejas con las dos manos.

---

## 5. Integridad y seguridad del puente de mando

- **El kill switch debe ser limpio.** Parar a Shinobi no puede corromper su estado. Cada subsistema atiende la señal `kill` en un punto de control seguro, persiste, y se detiene. Reanudable. ⚠ ENGANCHE: reutiliza el PAUSED/ABORT ya diseñado en las misiones. □ GATE: matar desde el Tenshu a mitad de una fase deja el estado consistente y reanudable; cero corrupción.
- **El panel refleja, no narra (§3.5).** Lo que ves es el store y las TEV reales. □ GATE: una afirmación del panel ("Shinobi hizo X") es clicable hasta su TEV, y coincide con ella; si no hay traza, no hay afirmación.
- **Local y soberano.** El Tenshu corre en tu máquina/VPS; ningún dato sale salvo cuando TÚ exportas para consultar a otra IA. ⚑ La exportación es una acción tuya, explícita.
- **El control respeta el approval gate.** Aprobar desde el Tenshu es una acción autenticada tuya; el Tenshu no puede auto-aprobarse acciones del agente.

□ GATE seguridad: kill limpio + panel fiel + aprobaciones solo del usuario.

---

## 6. LA PRUEBA DURA — ¿puedes de verdad ver, entender, apagar y auditar?

El Tenshu se prueba con tus cuatro necesidades hechas criterio binario.

### 6.1 Montaje
Dejas correr una noche del Kangeiko (o una misión de Kagemusha). A la mañana, abres el Tenshu y, sin tocar el código ni el chat, intentas las cuatro cosas.

### 6.2 Criterios de PASS (binarios)
- **P1 — VER.** De un vistazo identificas qué hizo Shinobi esta noche, qué subsistemas corrieron, cuánto gastó, y qué tareas pasó/falló. Sin leer logs crudos.
- **P2 — ENTENDER.** Eliges una acción concreta y navegas hasta su TEV: qué hizo, sobre qué dato, qué efecto, qué chequeos pasó. Entiendes *por qué* el sistema hizo eso.
- **P3 — CONDUCIR / APAGAR.** Pausas un subsistema y lo reanudas; pulsas el kill switch y Shinobi se detiene limpio; relanzas y reanuda sin corrupción (verificable: el estado tras reanudar es consistente).
- **P4 — CONSULTAR.** Exportas una TEV + su informe, se lo pasas a otra IA (a mí), y esa IA puede verificar la integridad (la cadena ed25519/sha256 cuadra) y decirte si lo que Shinobi hizo está bien — sin fiarse de Shinobi.
- **P5 — NO MIENTE.** Tomas una afirmación del panel y la contrastas con el store/TEV crudo: coinciden. El Tenshu no infló ni maquilló nada.

P5 es el alma: un panel bonito que narra en vez de reflejar pasa P1-P4 y falla P5 — y un puente de mando que miente es el mando de NES con luces de colores. Solo el que refleja la verdad cruda te deja conducir el tanque de verdad.

□ GATE FINAL: P1-P5 en verde, con la verificación cruda (panel vs store vs TEV) reproducible.

---

## 7. EL MOMENTO WOW

No hay un prompt: el wow del Tenshu es **abrirlo por la mañana**.

> Te despiertas. Abres el Tenshu. De un vistazo ves: anoche Shinobi corrió el Kangeiko 6 horas, tiró de 14 hilos de investigación, fabricó y certificó 9 skills nuevas, descartó 3 que no pasaron el oráculo, y su curva de capacidad web subió de 41 a 53 sobre 100. Hay 2 acciones esperando tu aprobación. Pulsas una skill nueva, navegas su traza, ves exactamente qué aprendió y que pasó su prueba. No te fías de su palabra: exportas la traza, me la pegas, te confirmo que la cadena cuadra y que lo que hizo está bien. Apruebas las 2 acciones con un clic. Y como hoy quieres trastear sin que corra solo, pulsas el kill switch del Kangeiko: se detiene limpio, guardando dónde iba.
>
> En cinco minutos has visto, entendido, auditado y mandado a un organismo que trabajó toda la noche por ti. Eso es conducir el tanque con la cabina del tanque, no con un mando de NES.

Ese es el wow del Tenshu: no que Shinobi haga algo, sino que tú **lo gobiernes de verdad** — con la potencia y el control por fin a la misma altura.

---

## 8. Orden de construcción (pasos pequeños)

**Kangeiko (el motor)**
- KG-01. Generalizar el loop de auto-mejora a un `domain` parametrizable (browser primero). □ GATE: el loop corre sobre un dominio de prueba con oráculo.
- KG-02. Arena de tareas web con oráculo en dojo cerrado (sandbox/sitios de prueba). □ GATE: tareas verificables, cero acción ⚑ real.
- KG-03. Cableado MIDE→INVESTIGA→FABRICA→CERTIFICA→CONSOLIDA→RE-MIDE sobre los subsistemas existentes. □ GATE: una iteración completa sube (o no) la curva, medido.
- KG-04. La curva persistida y la consolidación (learning loop). □ GATE: el repertorio crece sin volverse vertedero.

**Tenshu (el puente) — el grueso**
- TS-01. `src/tenshu/` + bus de eventos ✚ + instrumentar los subsistemas para emitir (⚠ vía lifecycle hooks). □ GATE: los subsistemas emiten eventos; el bus los recibe.
- TS-02. Canal de mando + kill switch limpio (⚠ reusar PAUSED/ABORT). □ GATE: kill a mitad → parada limpia y reanudable, cero corrupción.
- TS-03. Lectura del store (estado del dojo, métricas, colas) — VER nivel datos. □ GATE: `DojoStatus` fiel al store.
- TS-04. SPA local (⚠ Bloque 8 / Claude Design): vistazo, tiempo real (WebSocket), controles. □ GATE: ves estado en vivo y pulsas pausa/kill desde la UI.
- TS-05. Navegador de TEV e informes (ENTENDER): de una acción a su traza, clicable. □ GATE: P2 (navegas una acción hasta su evidencia).
- TS-06. Cola de aprobaciones operable ⚑. □ GATE: apruebas/rechazas desde el panel; el approval gate lo respeta.
- TS-07. Exportar para auditar (CONSULTAR) + verificación de cadena. □ GATE: P4 (otra IA verifica la TEV exportada).
- TS-08. La regla "refleja, no narra": panel anclado a TEV, afirmaciones clicables. □ GATE: P5 (panel vs crudo coinciden).
- TS-09. Mapa vivo del sistema (cómo encaja todo). □ GATE: entiendes la arquitectura sin leer código.

**Verificación**
- TS-10. La prueba dura (§6). □ GATE FINAL: P1-P5 verde, reproducible.

Regla de oro: **el kill switch limpio (TS-02) y "refleja no narra" (TS-08) antes que la estética.** Un panel precioso que no apaga bien o que miente es peor que el chat. Primero que sea fiel y que pares el tanque; luego que brille.

---

## 9. Riesgos y mitigaciones

- **R1 — Panel que narra (miente).** El riesgo central (P5). Mitigación: refleja el store/TEV; afirmaciones ancladas y clicables; 11.4 sobre el propio panel.
- **R2 — Kill sucio (corrompe estado).** Mitigación: puntos de control seguros + persistencia (PAUSED/ABORT); probado en P3.
- **R3 — Sobrecarga de instrumentación.** Emitir eventos de todo puede ralentizar. Mitigación: eventos por hook en puntos clave, no de cada línea; muestreo de métricas.
- **R4 — El Tenshu como superficie de ataque.** Un panel con control total es un objetivo. Mitigación: local, sin exponer al exterior; las aprobaciones requieren al usuario; nada de auto-aprobación.
- **R5 — Falsa sensación de control.** Ver bonito ≠ entender. Mitigación: cada vista lleva a su evidencia cruda; el mapa del sistema explica el cómo, no solo el qué.
- **R6 — El Kangeiko genera basura plausible.** (Heredado.) Mitigación: certificación obligatoria; el Tenshu muestra qué se descartó y por qué, no solo lo que entró.

---

## 10. Glosario y coda

- **Kangeiko** (寒稽古) — el entrenamiento intensivo concentrado; aquí, el motor de auto-mejora verificada.
- **Tenshu** (天守) — el torreón del castillo; aquí, el centro de mandos del dojo entero.
- **Las cuatro funciones** — VER (observabilidad), CONDUCIR (control + kill switch), ENTENDER (auditabilidad), CONSULTAR (segunda opinión de otra IA).
- **Refleja, no narra** — el panel muestra hechos verificables del store/TEV, nunca una narración fabricada.
- **Kill switch limpio** — parar a Shinobi a placer sin corromper su estado, reanudable.
- **Bus de eventos / canal de mando** — por donde el dojo informa al Tenshu y el Tenshu manda al dojo.

---

*Coda. El Kangeiko hace a Shinobi más fuerte cada noche; el Tenshu te lo pone en las manos. Hasta hoy tenías un tanque y un mando de NES; esto es la cabina. Y fíjate en lo que de verdad has pedido sin decirlo: no más potencia —ya tienes de sobra—, sino el puente desde el que esa potencia es tuya, comprensible y apagable. Esa es la pieza que faltaba para que "todo local, todo tuyo" sea verdad y no un eslogan. El ninja más temible no es el que más fuerte golpea; es el que controla cada uno de sus movimientos — y ahora tú controlas los suyos.*
