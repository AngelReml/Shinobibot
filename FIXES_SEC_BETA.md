# FIXES_SEC_BETA — Aplicados 2026-06-26

Agente: Fix-Sec-Beta. Zona: FIX 0.4, 0.5, 0.6, 0.13.

---

## FIX 0.4 — Skills .mjs cargadas sin verificar firma
**Archivo:** `src/skills/skill_loader.ts`

**Bug:** `reloadAllApproved()` importaba cualquier `.mjs` del directorio `approved_skills/`
sin ninguna verificación de firma. Un archivo `.mjs` malicioso colocado ahí se cargaba
sin obstáculos.

**Fix aplicado:** Antes de cargar cada `.mjs`:
1. Se comprueba que existe el companion `.md` (mismo nombre base, extensión `.md`).
   Sin `.md` → se rechaza con warning.
2. Se parsea el `.md` con `parseSkillMd()` y se llama a `verifySkill()`.
   Firma ausente o `hash_mismatch` → se rechaza con warning.
3. Solo si la verificación es válida se continúa con el audit de contenido y el `import()`.

**Imports añadidos:** `parseSkillMd` desde `./skill_md_parser.js`,
`verifySkill` desde `./skill_signing.js`.

---

## FIX 0.5 — approve() no firmaba la skill antes de promoverla
**Archivo:** `src/skills/skill_manager.ts`

**Bug:** `approve()` escribía el `.skill.md` en `approved/` sin firma. Al cargar con
`loadApproved()`, la skill pasaba con advertencia "legacy sin firma", nunca con
verificación real. Cualquier edit posterior al `.md` era invisible.

**Fix aplicado:** Después de marcar `status = 'approved'` y antes de `writeFileSync`,
se llama a `signSkill(parsed, { author: process.env.SHINOBI_SIGNER_ID ?? 'local' })`.
El archivo escrito a disco ya lleva `signature_hash`, `signed_at` y `signed_by`.
A partir de ahora `loadApproved()` detectará cualquier manipulación post-aprobación.

**Import añadido:** `signSkill` desde `./skill_signing.js` (mismo módulo donde ya
estaba `verifySkill`).

---

## FIX 0.6 — Suplantación de skill por CSV sin skill_id
**Archivo:** `src/kaname/contract.ts`

**Bug:** La validación anterior era:
```
if (csv.subject?.skill_id && csv.subject.skill_id !== manifest.skill_id)
```
Si `csv.subject.skill_id` era `undefined` o `''`, la condición era `false` y el CSV
pasaba sin verificar a qué skill certificaba — un CSV podía suplantar cualquier skill.

**Fix aplicado:** Condición invertida a rechazo explícito cuando falta o no coincide:
```
if (!csv.subject?.skill_id || csv.subject.skill_id !== manifest.skill_id)
```
Cualquier CSV sin `skill_id` o con `skill_id` que no coincida con `manifest.skill_id`
resulta en `status: 'rejected'` con razón descriptiva.

---

## FIX 0.13 — Oracle vacío certifica cualquier output
**Archivo:** `src/shugyo/synth/certify.ts`

**Bug:** La certificación usaba `r.output.trim().includes(cs.expected_stdout.trim())`.
Si `expected_stdout` era `''`, `''.includes('')` es siempre `true`, certificando
cualquier output sin ninguna validación real.

**Fix aplicado:** Se extrae el oracle con `trim()` y se lanza
`Error('oracle vacío: no se puede certificar')` antes de evaluar el includes.
Esto aborta `certifyInCage()` en el caso y propaga el error como `errors[]` del
resultado, evitando que una case sin oracle certifique la skill.

---

## Archivos modificados

| Archivo | Líneas cambiadas |
|---|---|
| `src/skills/skill_loader.ts` | +2 imports, +12 líneas de verificación en el loop |
| `src/skills/skill_manager.ts` | +1 import (`signSkill`), +3 líneas en `approve()` |
| `src/kaname/contract.ts` | 1 condición corregida (`&&` → `!... ||`) |
| `src/shugyo/synth/certify.ts` | +3 líneas (extracción oracle + guard + variable) |

Checkpoint actualizado: `/root/SHINOBI_CHECKPOINT.md` items 0.4, 0.5, 0.6, 0.13 marcados `[x]`.
