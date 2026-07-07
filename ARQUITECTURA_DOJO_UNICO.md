# Arquitectura — El Dojo Único (la espina)

> **Fecha:** 2026-07-07 · **Estado:** PROPUESTA — no ratificada. Cero código tocado.
> **Ley rectora (angel):** *«si hay elección no hay libertad»* — una postura, sin menús,
> profundidad por necesidad, el operador nunca compone.
> **Regla del repo:** ninguna afirmación sin dato medido. Lo que aquí se llama "ya existe"
> se verificó contra bytes; lo que es propuesta va marcado como tal.

## 0. Tesis

Toda la visión cuelga de una sola pieza: **manifiesto → renderizador → una superficie.**
Si esa espina funciona con UNA capacidad, el resto es poblarla. El backend ya va por delante;
el hueco es la superficie.

## 1. Estado medido del repo (no de memoria)

- **Backend maduro.** P1–P5 cerrados, spine de seguridad real (egress por misión, mandatos,
  DPAPI, jaula isolated-vm, approval gate), kagemusha/kangeiko/sintetizador, ~52 ficheros de
  tools, cadena de audit, atestación. La "cuasi-SO" por dentro ya existe.
- **Tres superficies, no tres chats:**
  - `src/web` — la **conversación** (:3333). Madura y ya cumple canon: `data-theme="yoru"`,
    Yoru por defecto, `#1A1612`, PWA, sin flash. La puerta del dojo, ya construida.
  - `src/tenshu` — el **puente de mando** (VER/CONDUCIR/ENTENDER/CONSULTAR): bus de eventos,
    cola de aprobaciones, kill-switch limpio, export de rastro verificable. Regla de oro:
    *«refleja, no narra»*. **Apagado** (`TENSHU_ENABLED=off`); su SPA es esqueleto (~210 líneas).
  - `src/tui` — otro chat, en terminal. El único realmente redundante.
- **El punto que rompe la escalabilidad:** en `src/tenshu/types.ts`, `DojoSource` es un enum
  **cerrado** (`'kagemusha' | 'kagami' | 'chizu' | 'shugyo' | 'shitsuji' | 'kangeiko'`) y
  `SystemEvent.kind` un set fijo. Hoy, añadir una capacidad = editar enums. Eso es lo contrario
  del manifiesto.
- **Ya existe media pieza:** `src/confine/manifest.ts` define un `CapabilityManifest` de
  **seguridad** — `{ name, capabilities: "kind:scope"[] }`, donde *el manifiesto ES el mandato*
  (`manifestToMandate`, least-privilege por declaración, fail-closed).

## 2. El átomo — dos manifiestos que se componen (no se pisan)

Un capacidad en el dojo se describe por **dos** manifiestos con roles distintos:

**a) Seguridad — YA EXISTE, intocable** (`src/confine/manifest.ts`):
```ts
interface CapabilityManifest {          // qué le está PERMITIDO hacer
  readonly name: string;
  readonly capabilities: readonly string[];   // "shell:*" | "fs.write:..." | "net:host" | ...
}
```

**b) Presentación / reflejo — NUEVO** (propuesto; reemplaza el enum `DojoSource`):
```ts
interface DojoManifest {                // cómo APARECE y en qué punto de su vida está
  id: string;                           // slug estable (antes: miembro de DojoSource)
  nombre: string;                       // título de la carta — Cormorant, una línea
  hace: string;                         // qué hace — UNA línea (Inter). Dos = mal definido (§9.3)
  zona: 'VER'|'CONDUCIR'|'ENTENDER'|'CONSULTAR';   // dónde se refleja
  emite: SystemEvent['kind'][];         // qué eventos refleja en el dojo
  estado: 'forja'|'prueba'|'sello'|'destierro';    // ciclo → visual (rastro fresco vs lacre)
  sello?: 'PASS'|'FAIL'|'PENDING';      // verificación interna (OpenGravity absorbido)
}
```

**`toca` es DERIVADO, no redeclarado.** El territorio sensible que dispara el candado
(`ninguno|secretos|dinero|destruccion`, §11) se **calcula** desde las `capabilities` del
manifiesto de seguridad (p.ej. `fs.write` a rutas de secretos → `secretos`; `net` a endpoints
de pago → `dinero`; borrado recursivo → `destruccion`). Una sola fuente de verdad: el permiso.

**El registro** compone ambos por `id` y reemplaza el enum cerrado:
```ts
// Ejemplo real, con lo que ya vive en el repo:
registrar({
  dojo: { id:'kagemusha', nombre:'Kagemusha',
          hace:'Investiga de noche y trae el Informe del Amanecer',
          zona:'CONDUCIR', emite:['phase_start','action','skill_certified'],
          estado:'sello', sello:'PASS' },
  seguridad: { name:'kagemusha', capabilities:['net:arxiv.org','fs.write:reports/'] },
});
```
Añadir una capacidad = registrar un par de manifiestos. Cero enums que editar, cero pantallas
que cablear.

## 3. El renderizador

El dojo lee el registro y pinta cada capacidad con la **gramática fija de la casa**: sin icono
(§manual: «sin iconos de librería como identidad»), nombre en Cormorant, `hace` en Inter,
hashes/estado en JetBrains Mono. Reglas duras derivadas del manifiesto:

- **candado** visible **solo si** `toca ≠ ninguno`.
- **lacre** (sello de OpenGravity, absorbido) **solo si** `sello = 'PASS'`.
- **rastro fresco** (trazo bermellón inestable) mientras `estado ∈ {forja, prueba}`.
- bermellón únicamente donde el agente actuó (huella), ≤1 % de pantalla (90/9/1).

La personalidad es del **dojo**, no del manifiesto: nadie compone su propia cara. Eso es
*«si hay elección no hay libertad»* aplicado a la estética.

## 4. Reunir las salidas (todas convergen)

No es demoler, es **fusionar**: la conversación de `web` dentro del dojo de `tenshu`, servido
por WebSocket; retirar `tui`. El bus de eventos de tenshu (`SystemEvent` / `DojoSource`) **ya
es** el backbone de "todas las salidas reunidas": los subsistemas emiten, tenshu subscribe, el
WS va encima. Encender `TENSHU_ENABLED` y hacerlo **LA** superficie (no un puente opcional).

## 5. El actualizador (pieza SEPARADA del manifiesto)

Dos mecanismos distintos: el manifiesto hace aparecer una capacidad *nueva*; el actualizador
*trae* la versión nueva.

- Canal de versión firmado (tu Contabo / release). Cada Shinobi corriendo —exe o servidor—
  comprueba si hay versión más nueva y firmada.
- Si la hay: **inscripción centrada** en el dojo (no toast, sin urgencia, per manual):
  *«Actualización lista. ¿Reiniciar?»*. "Reiniciar" en **tinta**, no bermellón — reiniciar es
  acción del operador, no huella del agente (§4.2).
- Al pulsar: verifica firma → **swap atómico** → relanza → health-check → **rollback a N-1** si
  falla. El operador no toca nada técnico: un clic.

## 6. Relación con el manual (gobernanza de angel)

Los manuales gobiernan **cómo se ve**, no cómo está hecho ni dónde vive. Son aliados: la cara
única es lo que permite escalar sin caos. Arquitectura, despliegue y ubicación son del operador.

**Resuelto — logo (veredicto de angel, reafirmado).** El icono con ojos ES canónico y no se
toca. La regla §3.3 del manual (`«sin rostro, sin ojos»`) es la que se reescribe a su verdadera
intención — «sin identidad individual, sin gesto de mascota» — bajo la cual los ojos en sombra,
anónimos, del icono pasan. El logo manda; el texto del manual se ajusta.

**Resuelto — el arranque en frío NO es contradictorio.** El manual prohíbe el *cromo* de
onboarding (tours, tooltips, botones de sugerencia), no guiar. A un agente se le habla, no se le
hace un tour; el no-técnico entra con intención y escribe lo que necesita. El cursor del composer
es la invitación —universal, no onboarding—. Se resuelve dentro del canon.

## 7. OpenGravity — absorbido

Confirmado contra el código: el sello/verify ya vive **dentro** (`attest/`, `ledger/`, el evento
`skill_certified`, el export de rastro de tenshu). No hay producto externo al que llamar. Se
hereda la estética del lacre y el vocabulario de veredictos; la función es interna. Es arquitectura
—del operador—, el manual no manda ahí.

## 8. Plan por pasos

1. **Fijar el contrato** (este documento) — el `DojoManifest` + el registro que compone ambos
   manifiestos y sustituye a `DojoSource`.
2. **Registro de manifiestos**: convertir `DojoSource`/`kind` cerrados en registro abierto
   (semilla: `confine/manifest.ts`). Ahí nace el "aparece solo tras cada update".
3. **Encender Tenshu como superficie**: fusionar la conversación de `web`, retirar `tui`.
4. **Renderizador**: pinta desde el registro con la gramática de la casa.
5. **Rebanada vertical (wedge)**: una capacidad real → doble-clic → necesidad → actúa → rastro.
6. **Actualizador**: canal firmado + inscripción + swap atómico + rollback.

## 9. Aparcado / no decidido

Port a Linux (Windows-native: CDP, isolated-vm, build:exe) vs Windows Server en el VPS ·
convivencia exe-de-un-operador y servidor multi-operador (`src/multiuser`) · el wedge concreto ·
HTML autocontenido vs React para el renderizador ·
**monetización / mercado nocturno / reparto — aparcado hasta que todo lo demás esté sólido.**

## 10. Verificación (regla del repo)

Este doc no toca código. El **primer** cambio real (paso 2) deberá pasar `tsc --noEmit` 0 y
mutación (mutar el mapeo `capabilities→toca` a "siempre ninguno" debe poner en rojo un test del
candado; restaurar → verde). Nada se da por cerrado sin ese dato.
