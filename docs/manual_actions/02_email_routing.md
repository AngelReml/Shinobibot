# Acción 2 — Cloudflare Email Routing → `hola@zapweave.com`

**Tiempo: ~10 min**
**Desbloquea**: comunicación con waitlist + landings.

## Requisito previo

`zapweave.com` debe tener su DNS gestionado en Cloudflare (asumimos que sí — la landing está en Pages). Si no, ir antes a Cloudflare → Add Site → propagar nameservers.

## Pasos

### 1. Habilitar Email Routing

```
Cloudflare Dashboard
→ zapweave.com
→ Email
→ Email Routing
→ "Get started" / "Enable Email Routing"
```

Cloudflare añade automáticamente 3 registros MX y un TXT/SPF. Acepta. Tarda 1-2 min en propagar.

### 2. Verificar tu dirección personal

Cloudflare te enviará un email de confirmación a la dirección donde reenvíarás. Click en el link de verificación.

### 3. Crear la ruta principal

```
Email Routing → Routes → Create address
  Custom address: hola
  Action: Send to email
  Destination: <tu-correo-personal>@gmail.com
  Save
```

### 4. (Opcional) Catch-all para no perder mensajes

```
Email Routing → Routes → Catch-all → Edit
  Action: Send to email
  Destination: <tu-correo-personal>@gmail.com
  Enable
```

Esto captura cualquier `*@zapweave.com` que aún no tenga ruta específica (audit@, contacto@, soporte@, brain@...).

### 5. (Recomendado) Direcciones específicas adicionales

Crear las que ya están publicadas / referenciadas en docs:

| Address | Destino | Por qué |
|---|---|---|
| `audit@zapweave.com` | tu inbox | Landing AuditGravity menciona `audit@` |
| `contacto@zapweave.com` | tu inbox | Footer landing |
| `soporte@zapweave.com` | tu inbox | Para issues B2B |

## Verificar que funciona

```bash
# Desde otro proveedor (Gmail, ProtonMail, etc.) envía:
echo "test ruta hola@" | mail -s "test routing" hola@zapweave.com
# Debería llegar a tu inbox personal en <30s.
```

O simplemente envía desde el móvil un mail a `hola@zapweave.com`.

## Plantilla de auto-respuesta (opcional)

Si quieres una respuesta automática inicial a quien escribe a `hola@`, no se hace en Cloudflare (Cloudflare Email Routing es solo forward, no replies). Lo manejas en tu cliente de correo (Gmail filter + canned response, o respuesta de fuera de oficina).

Plantilla recomendada:

```
Asunto: Recibido — Shinobi / zapweave

Hola,

Gracias por escribir. Soy Iván, el constructor detrás de Shinobi.

Estoy procesando tu mensaje a mano (no es un bot que responde) y suelo
contestar en 24-48h hábiles. Si es algo urgente o B2B (auditoría agentes,
demos para tu equipo), incluye en el asunto el tag [B2B] y le doy
prioridad.

Mientras tanto:
- Web: https://zapweave.com/
- Build log: https://zapweave.com/build-log.html
- AuditGravity (B2B): https://zapweave.com/audit/

Iván
```

## Coste

Cloudflare Email Routing es **gratis hasta 200 destinations / 200 reglas / catch-all incluido**. Para zapweave.com es de sobra.

## Riesgo: spam / phishing

Sin SPF + DKIM + DMARC bien configurados, los mails que mandas DESDE `hola@zapweave.com` pueden ir a spam. Email Routing te resuelve la entrada (recibir), pero NO te resuelve el envío. Para enviar:

- **Opción A**: usa la dirección de tu Gmail personal y firma como "Iván / Shinobi". El cliente lo ve y entiende.
- **Opción B**: usa Cloudflare Email Workers o un servicio outbound (SendGrid, Postmark, ImprovMX) — más trabajo, más profesional.

Para v1.0.0 con la opción A es suficiente.
