# RESTAURAR — red de seguridad de la limpieza

> Son las 3 de la mañana y algo ha salido mal. Respira. Nada se ha perdido.
> Elige el nivel más bajo que resuelva tu problema. Ejecuta los comandos EN ORDEN,
> uno por uno, desde la carpeta del repo: `C:\Users\angel\Desktop\SHINOBI`
>
> Datos fijos de esta limpieza:
> - Rama de trabajo ...... `limpieza/shinobi`
> - Rama buena intacta ... `remediacion-2026-07-01`  (NO se ha tocado)
> - Etiqueta de rescate .. `respaldo/pre-limpieza-20260909`  (commit 6c67a5f)
> - Espejo completo ...... `C:\Users\angel\Desktop\shinobi-respaldo-20260909.git`
> - Remoto original ...... `https://github.com/AngelReml/Shinobibot.git`

---

## NIVEL 1 — Deshacer solo el último commit (lo más suave)

Úsalo si el último lote borró algo que hacía falta y todo lo anterior estaba bien.

```
cd C:\Users\angel\Desktop\SHINOBI
git reset --hard HEAD~1
```

Línea 1: entra en la carpeta del repo.
Línea 2: tira el último commit y deja el árbol exactamente como estaba antes de él.

Si necesitas deshacer los dos últimos, usa `HEAD~2`, y así.

---

## NIVEL 2 — Volver al punto de partida de toda la limpieza

Úsalo si varios lotes salieron mal y quieres el repo como estaba ANTES de empezar.

```
cd C:\Users\angel\Desktop\SHINOBI
git checkout limpieza/shinobi
git reset --hard respaldo/pre-limpieza-20260909
```

Línea 1: entra en la carpeta del repo.
Línea 2: asegúrate de estar en la rama de trabajo.
Línea 3: devuelve la rama de trabajo al commit exacto donde arrancó la limpieza (6c67a5f).

La rama `remediacion-2026-07-01` nunca se tocó: si prefieres abandonar la rama de
trabajo entera, `git checkout remediacion-2026-07-01` y borra `limpieza/shinobi`.

---

## NIVEL 3 — Reconstruir el repo entero desde el espejo (lo más fuerte)

Úsalo si el repo local está corrupto, si la purga del historial salió mal, o si ya
no te fías de nada de lo que hay en `C:\Users\angel\Desktop\SHINOBI`.
Esto recrea el repositorio COMPLETO con todo su historial y todas sus ramas.

```
cd C:\Users\angel\Desktop
move SHINOBI SHINOBI-roto-20260909
git clone C:\Users\angel\Desktop\shinobi-respaldo-20260909.git SHINOBI
cd SHINOBI
git remote set-url origin https://github.com/AngelReml/Shinobibot.git
git checkout remediacion-2026-07-01
```

Línea 1: ponte en el Escritorio.
Línea 2: aparta la carpeta rota sin borrarla (por si acaso).
Línea 3: clona un repo nuevo y sano desde el espejo local.
Línea 4: entra en el repo nuevo.
Línea 5: vuelve a apuntar `origin` al GitHub original (el clon apuntaba al espejo).
Línea 6: sitúate en la rama buena.

Cuando confirmes que el repo nuevo está bien, puedes borrar `SHINOBI-roto-20260909`.

---

## Si además el espejo local se perdiera

El espejo es la última línea. Si también desaparece, queda el remoto de GitHub:

```
cd C:\Users\angel\Desktop
git clone --mirror https://github.com/AngelReml/Shinobibot.git shinobi-respaldo-nuevo.git
```

Esto solo sirve mientras el operador NO haya hecho `push --force` de una historia
reescrita. Si ya lo hizo, el remoto ya no tiene la historia vieja y el espejo local
era de verdad la única vía de vuelta.

---

## Comprobación rápida de que un repo está sano

```
git rev-list --count --all
git log -1 --oneline
git status
git fsck --full
```

Referencia sana del clon de trabajo tras PASO 0: 607 commits en `--all`
(el espejo tiene 608 porque incluye las refs de la Pull Request #1).
