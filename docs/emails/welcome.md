# Email de bienvenida — plantilla

**Asunto:** Estás dentro · tu key de Shinobi
**De:** Ángel @ Zapweave <hola@zapweave.com>
**Tono:** directo, sin marketing, agradecimiento sincero, expectativas claras.

---

Hola {{nombre}},

Gracias por apuntarte. Esto no lo digo por reflejo: ahora mismo somos un
equipo muy pequeño y cada email entrante lo leo yo. Que confiaras tu
correo en una herramienta nueva, sin testimonios, sin números, importa.

Aquí va lo que necesitas para empezar:

**Tu API key**

```
{{SHINOBI_API_KEY}}
```

Guárdala. Si la pierdes, escríbeme y te genero otra.

**Cómo arrancar (60 segundos)**

1. Descarga el `.exe` desde {{download_url}}.
2. Ejecútalo. La primera vez te pide idioma, la API key (la de arriba) y
   carpeta de memoria. Pulsa Enter en lo que no entiendas; los defaults
   son razonables.
3. Escribe lo que quieras investigar. Por ejemplo:
   `investiga canales en inglés del nicho X con más de 500k subs`.

Si algo se atasca, mata el proceso (Ctrl+C) y reinícialo. No es elegante;
es honesto.

**Lo que tienes que saber antes de usarlo**

- Esto es un producto temprano. Va a fallar a veces. Cuando lo haga,
  cuéntamelo: lo que viste, lo que esperabas. Esos emails son el
  combustible de este proyecto.
- Eres parte del programa Founders. Tu precio (9 €/mes cuando
  OpenGravity entre en cobro) **queda bloqueado mientras mantengas la
  suscripción activa**. No subimos. Si algún día cancelas y vuelves
  más tarde, no garantizo recuperarlo.
- Mientras estemos en beta abierta, el cloud (OpenGravity) es gratis.
  Te avisaré con al menos 14 días de antelación antes de empezar a cobrar.

**Lo que NO te voy a hacer**

- No te voy a meter en una newsletter automática. Si te escribo es
  porque pasó algo que te afecta.
- No voy a vender ni compartir tu email.
- No voy a inventar testimonios diciendo que tú dijiste algo. Si algún
  día quieres que cite una experiencia tuya, te pido permiso explícito.

**Cómo me ayudas más**

Cuéntame el primer fallo que veas. Y cuando algo te ahorre tiempo,
dímelo también. Esos dos emails son los que me dejan dormir.

Gracias otra vez. Nos vemos dentro.

— Ángel
hola@zapweave.com

---

## Notas para el operador (no enviar al usuario)

- Variables a sustituir: `{{nombre}}`, `{{SHINOBI_API_KEY}}`, `{{download_url}}`.
- Si el usuario no proporcionó nombre, usar "Hola," sin nombre.
- No añadir links de "darse de baja" automáticos hasta que tengamos un
  flujo real de unsubscribe — por ahora la respuesta a este email es
  suficiente.
- Mantener el tono. No usar emojis. No usar "¡" abriendo frases.
