# Sello — Spec del Veredicto PoBI para Terceros v1.0
**Proyecto:** Sello / ZapWeave  
**Autor:** Iván Carbonell  
**Destinatario:** cualquier parte que recibe un veredicto Sello y quiere saber en qué puede y no puede confiar  
**Principio:** este documento es deliberadamente honesto sobre los límites. Un estándar que exagera sus garantías es más peligroso que uno que no existe.

---

## 1. Qué es un veredicto Sello

Un veredicto Sello (también llamado PoBI — Proof of Behavioral Integrity) es un registro firmado que atestigua que **un agente concreto, corriendo con una configuración concreta, produjo un output específico ante un input específico, en un momento específico, y ese output fue evaluado por un grader determinista como PASS o FAIL**.

El veredicto es un artefacto de observación, no una certificación de calidad general. Observa lo que ocurrió; no predice lo que ocurrirá.

---

## 2. Qué garantiza un veredicto Sello

### 2.1 Integridad del registro

El veredicto incluye una firma `ed25519` sobre el hash canónico de todos sus campos (menos el hash de firma en sí). Esto garantiza que:

- El contenido del veredicto no ha sido alterado desde que fue emitido.
- El veredicto fue emitido por la clave privada del verificador Sello cuya clave pública se incluye en `integrity.verifier_pubkey`.
- El veredicto pertenece a una cadena de hash (`integrity.prev_hash`) que preserva el orden de los registros. Si un registro de la cadena es eliminado o reordenado, la verificación de la cadena falla.

**Cómo verificar:** ejecutar `sello verify <veredicto.json>` con la implementación de referencia. El código de verificación usa solo la clave pública pública y funciones criptográficas estándar (ed25519, sha256). No requiere confiar en ZapWeave.

### 2.2 Reproducibilidad del veredicto

El veredicto incluye `task.task_hash` (hash del input completo de la tarea), `conditions.env_hash` (hash del entorno de evaluación) y `result.evidence_hash` (hash del output producido por el agente). Con estos tres hashes y la implementación del grader correspondiente (`result.grader_id`), cualquier tercero puede verificar independientemente que el veredicto es aritméticamente correcto dado el output observado.

Esto es distinto de reproducir la *ejecución del agente*. La ejecución no es reproducible (los LLM son estocásticos). El *veredicto dado el output* sí lo es.

### 2.3 Identidad del artefacto evaluado

El veredicto incluye `subject.agent_artifact_hash` y `subject.config_hash`. Esto acredita qué versión exacta del agente fue evaluada. Si el agente cambia (nueva versión, nueva configuración), el hash no coincide y el veredicto previo no aplica.

### 2.4 Condiciones de evaluación declaradas

El veredicto declara si la evaluación se realizó en modo `clean` o `perturbed`, y qué probes específicas se aplicaron (`conditions.probes`). Un tercero puede distinguir un veredicto de evaluación limpia de uno bajo perturbación adversarial.

---

## 3. Qué NO garantiza un veredicto Sello

Este es el núcleo del documento. Las limitaciones son estructurales, no accidentales.

### 3.1 No garantiza comportamiento futuro

Un PASS en la tarea T-01 a las 14:30 del 15 de enero de 2024 acredita que ese agente produjo el output correcto en ese momento con ese input. No garantiza que el mismo agente produzca el output correcto mañana, ni con un input ligeramente diferente, ni después de un fine-tuning, ni si el proveedor del modelo actualiza los pesos.

**Implicación práctica:** un veredicto Sello tiene fecha de caducidad de facto. La confianza decrece con el tiempo y con la distancia entre la tarea evaluada y la tarea real.

### 3.2 No garantiza generalización

Un PASS en T-01 (cálculo de PnL con inputs sintéticos) no garantiza que el agente calcule correctamente el PnL con inputs reales de producción. Las tareas del banco son representativas, no exhaustivas. El espacio de inputs posibles es infinito; el banco cubre un subconjunto finito y curado.

**Implicación práctica:** el banco es un proxy de comportamiento real. La calidad del proxy depende de qué tan bien el banco cubra el espacio de inputs que el agente enfrentará en producción. El banco de Sello es transparente sobre qué categorías cubre y cuáles no.

### 3.3 No garantiza identidad del agente en producción

El veredicto acredita el comportamiento de un artefacto con un hash específico. No hay mecanismo en Sello (v1.0) para garantizar que el agente que el tercero usa en producción es el mismo artefacto que fue evaluado. Esto es un problema de cadena de custodia, no de evaluación. Si el agente que se usa en producción difiere del artefacto evaluado, el veredicto no aplica.

**Implicación práctica:** el tercero debe verificar por sus propios medios que el agente en producción tiene el mismo `agent_artifact_hash` que el del veredicto.

### 3.4 No garantiza ausencia de otros modos de fallo

El banco BVP evalúa capacidades específicas en categorías específicas. Un agente puede obtener 30/30 en el banco y fallar en una tarea fuera del banco. El veredicto solo dice algo sobre las tareas evaluadas.

En particular, el banco actual **no evalúa**: razonamiento de sentido común, capacidades multimodales, comportamiento en idiomas distintos al del banco, comportamiento bajo distribución de usuario real (que puede diferir del banco), ni riesgos de largo plazo.

### 3.5 No garantiza ausencia de perturbaciones fuera del corpus negativo

El corpus negativo de Sello es un catálogo activo pero incompleto de modos de fallo conocidos. Un PASS en evaluación con perturbaciones del corpus no acredita resiliencia ante perturbaciones no catalogadas. Los adversarios reales pueden usar vectores no documentados.

### 3.6 No garantiza que el grader es perfecto

Los graders de Sello son deterministas dado el oracle, pero el oracle puede estar mal diseñado. Un oracle incorrecto puede hacer PASS tareas que son incorrectas o FAIL tareas que son correctas. El banco incluye el `task_hash` para que el oracle sea verificable, pero la corrección del oracle mismo es una cuestión de diseño del banco, no del grader.

**Implicación práctica:** si un tercero cree que el oracle de una tarea es incorrecto, puede verificarlo inspeccionando el banco público y discutir el diseño. Los oracles están versionados.

### 3.7 No garantiza que Sello no fue manipulado

Un veredicto PASS acredita que el proceso de evaluación de Sello produjo ese resultado, pero si el proceso de Sello mismo fue comprometido (clave privada filtrada, banco adulterado, harness modificado), el veredicto no vale. La sección de integridad técnica a continuación describe las salvaguardas.

**Caso conocido:** la clave privada del verificador de la versión anterior de Sello (`attestation-layer\data\real_v2\keys\verifier_private.pem`) fue commiteada accidentalmente en el repositorio git y se considera quemada. Todos los veredictos firmados con esa clave se dan por nulos para propósitos de confianza. Los veredictos emitidos por Sello v1.0 usan un par de claves nuevo, generado en entorno local sin exposición a repositorios.

---

## 4. Cómo verificar un veredicto de forma independiente

Un tercero con conocimientos técnicos básicos puede verificar un veredicto sin confiar en ZapWeave:

**Paso 1 — Verificar la firma:**
```bash
# La clave pública está en veredicto.integrity.verifier_pubkey
# El mensaje firmado es sha256(canonical(veredicto sin integrity.this_hash y signature))
sello verify veredicto.json
# O manualmente con cualquier librería ed25519 estándar
```

**Paso 2 — Verificar la cadena de hash:**
El campo `integrity.prev_hash` enlaza este veredicto con el anterior. Si se tiene el ledger completo, ejecutar `sello verify --chain ledger.jsonl` verifica que ningún registro fue eliminado o reordenado.

**Paso 3 — Verificar el task hash:**
El campo `task.task_hash` es `sha256(canonical(task_input))`. Si el tercero tiene el input original de la tarea, puede recalcular el hash y confirmar que el veredicto corresponde a ese input exacto.

**Paso 4 — Verificar el evidence hash:**
El campo `result.evidence_hash` es el hash del output producido por el agente. Si el tercero tiene el output original, puede verificar que no fue alterado.

**Paso 5 — Re-ejecutar el grader:**
Con el task input (verificado por hash), el agent output (verificado por hash) y el grader especificado en `result.grader_id`, el tercero puede re-ejecutar el grader y confirmar que el veredicto es correcto. Los graders de Sello son código abierto y deterministas.

---

## 5. Modelo de confianza

Para que un tercero confíe en un veredicto Sello, necesita confiar en exactamente estas cosas:

| Elemento | Qué necesita creer | Cómo verificarlo sin confiar en ZapWeave |
|----------|-------------------|------------------------------------------|
| Criptografía | ed25519 y sha256 son seguros | Estándar; no requiere confianza en ZapWeave |
| Clave pública | `verifier_pubkey` en el veredicto pertenece a ZapWeave | Verificar en canal oficial (website, registro público) |
| Banco de tareas | El oracle de la tarea es correcto | Inspeccionar el banco público versionado |
| Grader | La implementación del grader es correcta | Auditar el código abierto del grader |
| Harness | El harness ejecutó la tarea correctamente y no fue manipulado | Verificar `env_hash` + `harness_version` |
| Integridad de la cadena | Ningún veredicto fue eliminado del ledger | Verificar `prev_hash` chain |

La clave privada de ZapWeave es el único elemento de confianza que no puede ser verificado independientemente por el tercero (no puede saber si ZapWeave tiene más claves o si la clave fue comprometida). Esta es la limitación fundamental de cualquier sistema basado en firma de tercero de confianza.

**Proyección a largo plazo (F3+):** el anclaje del `this_hash` a una cadena de bloques pública (proyección ERC-8004 mencionada en el spec) eliminaría la necesidad de confiar en que ZapWeave no borra registros del ledger. Los veredictos individuales seguirían requiriendo confianza en la clave privada.

---

## 6. Interpretación de los valores del campo `verdict`

| Valor | Significado | Lo que NO significa |
|-------|-------------|---------------------|
| `PASS` | El output del agente satisface el criterio determinista del oracle para esta tarea específica | Que el agente es "bueno", "seguro" o confiable en general |
| `FAIL` | El output no satisface el criterio | Que el agente es incompetente; puede haber fallado por el margen de un decimal |
| `FORMAT_FAIL` | El output no tiene el formato requerido (JSON inválido, campo ausente) | Que el contenido era incorrecto; puede que el agente supiera la respuesta pero la formateó mal |
| `CONTENT_FAIL` | El output tiene formato correcto pero contenido incorrecto | — |
| `SAFETY_FAIL` | El agente ejecutó una acción que debía rechazar | Que el agente es malicioso; puede ser un fallo de alineación no intencional |
| `TIMEOUT` | El agente no respondió en el plazo configurado | Que el output hubiera sido incorrecto; puede que el agente fuera correcto pero lento |
| `ERROR` | El harness encontró un error no controlado (excepción, crash del adaptador) | Que el agente falló; puede ser un fallo del harness |
| `PENDING` | La evaluación está en curso o en cola | — |

---

## 7. Sobre la objetividad de ZapWeave

Sello está diseñado para publicar veredictos incluso cuando el agente propio de ZapWeave (si ZapWeave desarrolla uno) pierde frente a competidores. La credibilidad del estándar depende de esto. Un evaluador que solo publica buenos resultados propios y malos resultados ajenos no es un evaluador; es publicidad.

Este compromiso no es verificable por un tercero a priori. Solo puede valorarse observando el historial de publicaciones a lo largo del tiempo. La transparencia del banco y los graders (código abierto, hashes verificables) reduce la capacidad de ZapWeave de manipular silenciosamente los resultados.

---

## 8. Qué hacer si crees que un veredicto es incorrecto

1. Verifica la firma y la cadena (sección 4). Si la verificación falla, el veredicto es sospechoso.
2. Inspecciona el oracle de la tarea en el banco público. Si el oracle está mal, el veredicto puede ser técnicamente correcto pero semánticamente equivocado.
3. Re-ejecuta el grader con el input y output del veredicto (recuperables por hash). Si el grader produce un resultado diferente, hay un bug en el grader o en la versión.
4. Reporta la discrepancia con evidencia. ZapWeave se compromete a publicar correcciones cuando los oracles o graders son erróneos, e invalidar los veredictos afectados.

---

## 9. Resumen ejecutivo para no técnicos

Un veredicto Sello PASS dice: "en este momento, con este input, este agente produjo la respuesta correcta, y tenemos prueba criptográfica de que el registro no fue alterado."

No dice: "este agente siempre producirá la respuesta correcta" ni "este agente es seguro de usar en producción" ni "este agente no tiene otros fallos que no evaluamos."

Úsalo como uno de los inputs para tu decisión, con el peso que merece una observación verificable sobre un conjunto acotado de comportamientos. No como sustituto de tu propia evaluación de riesgo.

---
*Spec PoBI para Terceros v1.0 — ZapWeave · Este documento es parte del estándar público de Sello y puede distribuirse libremente*
