# Comunidad — setup manual del Discord

> **Por qué está esto a mano y no automatizado:** Discord requiere que
> el servidor lo cree una persona física logueada. Si lo creara el bot
> con un token sería un servidor "huérfano" sin propietario claro.
> Sigue estos pasos tú una vez; tarda 10 minutos.

## 1. Crear el servidor

1. Entra a Discord (cliente de escritorio o web).
2. Pulsa el "+" en la columna de servidores → **Crear el mío** →
   **Para mí y mis amigos**.
3. Nombre del servidor: `Zapweave`.
4. Icono: el logo (cuadrado ~512×512). Si aún no existe, sube un
   placeholder y cámbialo cuando lo tengas.

## 2. Configurar lo básico (Server Settings)

- **Verification Level**: `Medium` (cuenta de Discord verificada). Sube
  a `High` si empieza a entrar spam.
- **Explicit Media Filter**: `Scan media from all members`.
- **System Messages Channel**: `#welcome` (que crearás abajo).
- **Default Notifications**: `Only @mentions`. Importante: si dejas
  "All messages", la gente nuevita silencia el server entero.

## 3. Crear los canales

Crea estos canales en este orden y con estos nombres exactos
(minúsculas, con guión donde aplique):

### Categoría — `INFO`

| Canal | Tipo | Propósito |
|-------|------|-----------|
| `#welcome` | Texto, solo lectura | Mensaje de bienvenida + reglas. Solo admin escribe. |
| `#anuncios` | Texto, solo lectura | Releases, downtime, cambios de plan. Solo admin escribe. |

### Categoría — `PRODUCTO`

| Canal | Tipo | Propósito |
|-------|------|-----------|
| `#bugs` | Texto | Reporte de fallos. Plantilla en el pin. |
| `#ideas` | Texto | Sugerencias de features y skills nuevas. |
| `#showcase` | Texto | Los usuarios comparten lo que han hecho con Shinobi. |

### Categoría — `OFF-TOPIC` (opcional)

| Canal | Tipo | Propósito |
|-------|------|-----------|
| `#charla` | Texto | Conversación libre entre creadores. |

> No crees canales por idioma o por nicho hasta que la comunidad lo
> pida. Demasiados canales vacíos matan el server.

## 4. Configurar permisos por canal

En Discord, click derecho sobre el canal → **Edit Channel** →
**Permissions** → **@everyone**:

- `#welcome` y `#anuncios`: quitar `Send Messages` a `@everyone`.
  Solo admins escriben. Reactions y view sí permitidos.
- `#bugs` `#ideas` `#showcase` `#charla`: dejar permisos por defecto
  (everyone puede escribir, no puede borrar mensajes ajenos).

## 5. Pin en cada canal (mensaje fijado)

Pon estos mensajes y haz pin (click derecho sobre el mensaje → Pin).

### `#welcome`

```
Bienvenido a Zapweave.

Aquí construimos Shinobi: un asistente AI local para YouTubers
hispanos que adaptan formatos de canales en inglés. Estás temprano,
las cosas van a fallar y eso es parte del trato.

Reglas:
1. Sin spam, sin promo de canales no relacionados, sin venta.
2. Trato respetuoso. Una falta y va warning, dos y va ban.
3. Para reportar bugs usa #bugs con la plantilla.
4. Las ideas van a #ideas — no aquí.

Empieza por #showcase para ver qué está haciendo la gente y
preséntate ahí si quieres.
```

### `#bugs` (plantilla)

```
Cuando reportes un bug, copia y rellena:

**Qué pasó:** (en una frase)
**Qué esperabas:** (en una frase)
**Pasos para reproducirlo:**
1.
2.
3.
**Versión de Shinobi:** (la que sale en el primer arranque)
**Sistema:** Windows ___
**Logs / captura:** (si los tienes)

Gracias. Cada reporte concreto vale oro.
```

### `#ideas` (plantilla)

```
Plantilla rápida para ideas:

**Qué quieres hacer:**
**Por qué te ahorraría tiempo:**
**Cómo lo haces hoy sin Shinobi:**

No prometemos ni timing ni implementación, pero leemos todo.
```

## 6. Crear roles

En **Server Settings → Roles**:

1. `Founders` — color morado. Para los primeros 500 usuarios. Da
   acceso a un canal privado (lo creas cuando entren los primeros).
2. `Beta` — color azul. Cualquier usuario con cuenta activa.
3. `Mod` — color verde. Para ti y la persona que te ayude a moderar.
4. `Bot` — color gris. Para integraciones (cuando las haya).

Por ahora **no asignes roles automáticamente con bots**: vas a hacerlo
a mano hasta que pase el centenar.

## 7. Generar el invite

- Click derecho sobre el server → **Invite People** → **Edit invite link**.
- **Expire after**: `Never`.
- **Max uses**: `No limit`.
- Copia el link.

## 8. Conectar el invite con la web

- Ese link va en el footer de zapweave.com (cuando esté listo) y en
  el email de bienvenida (sección "Cómo me ayudas más").
- También en el `--help` de Shinobi como `Comunidad: <link>`.

## 9. Mantenimiento mensual

- Una vez al mes revisa miembros inactivos (no pasa nada, pero te da
  pulso de cuánto crece).
- Una vez por semana: leer #bugs e #ideas. Responder al menos con un
  emoji para que la persona sepa que se ha visto.
- No abras nuevos canales sin antes cerrar uno vacío.

---

**Cuando termines:** mándame el invite link a `hola@zapweave.com` para
que lo añada al README, al landing y al email de welcome.
