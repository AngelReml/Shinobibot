# A.4 — Validación de Habilidad A en repos reales

Estado: **PENDIENTE — requiere ejecución humana**.

Gate (plan v1.0 §3.4):
- Ratio aciertos ≥ 80% en cada repo.
- Cero hallucinations graves (afirmaciones de código que no existe).
- Documento commiteado con outputs crudos.

---

## Pre-requisitos

- [ ] `OPENROUTER_API_KEY` exportada en `.env`.
- [ ] Tener clonado localmente OpenGravity en una ruta absoluta conocida.
- [ ] Elegir un repo random de GitHub mediano (≤ 5k archivos source) y clonarlo.

## Procedimiento por repo

```
shinobi
> /read <ruta_absoluta>
```

Esto persiste:
- `missions/<timestamp>_read/report.json`
- `missions/<timestamp>_read/subreports.json`
- `missions/<timestamp>_read/meta.json`

Pega `report.json` debajo del bloque correspondiente y, en la tabla de afirmaciones, marca cada bullet con `C` (correcta) / `I` (incorrecta) / `R` (irrelevante).

---

## Repo 1 — OpenGravity

- Ruta: `_____`
- Mission dir: `_____`
- Duración: `_____ s`
- Sub-agents: `_____`

### Afirmaciones evaluadas

| # | Afirmación (extracto del report) | Veredicto | Comentario |
|---|---|---|---|
| 1 | _____ | C / I / R | _____ |
| 2 | _____ | C / I / R | _____ |
| … | | | |

**Ratio**: `<C> / (<C>+<I>) = ___%` (irrelevantes excluidas del denominador).
**Hallucinations graves**: `___` (≥1 = gate FALLA).

---

## Repo 2 — Repo random de GitHub

- URL origen: `_____`
- Ruta local: `_____`
- Mission dir: `_____`
- Duración: `_____ s`

### Afirmaciones evaluadas

| # | Afirmación | Veredicto | Comentario |
|---|---|---|---|
| 1 | _____ | C / I / R | _____ |

**Ratio**: `___%`.
**Hallucinations graves**: `___`.

---

## Veredicto final

- [ ] Repo 1: ratio ≥ 80% **y** 0 hallucinations graves.
- [ ] Repo 2: ratio ≥ 80% **y** 0 hallucinations graves.

Si ambos tachados → A.4 **VERDE**. Anotar fecha y commit a este archivo:

```
A.4 cerrada el _____ — gate VERDE — Habilidad A COMPLETA.
```

Si alguno falla → A.4 **ROJO**. Análisis de causa raíz aquí abajo y volver a A.2/A.3 según corresponda. **No** avanzar a Habilidad B.
