# Acción 4 — DNS de subdominios

**Tiempo: ~30 min** (15 min config + propagación)
**Desbloquea**: `audit.zapweave.com` y `brain.zapweave.com` accesibles públicamente.

## Estado actual

| Subdominio | Status | Apunta a |
|---|---|---|
| `zapweave.com` | ✅ live | GitHub Pages (CNAME `AngelReml.github.io`) |
| `kernel.zapweave.com` | ✅ live | VPS Contabo `167.86.80.220` |
| `audit.zapweave.com` | ❌ DNS pendiente | (decisión: redirect o segundo host) |
| `brain.zapweave.com` | ❌ DNS pendiente | (decisión: vanity CNAME) |

## Estrategia recomendada

**`audit.zapweave.com` → redirect 301 a `zapweave.com/audit/`**:

GitHub Pages sólo soporta UN custom domain por repo. La landing AuditGravity ya está deployed bajo `zapweave.com/audit/index.html`. La forma más barata + estable es un redirect desde Cloudflare Page Rules sin segundo host.

**`brain.zapweave.com` → CNAME a `kernel.zapweave.com`**: vanity URL para el SDK (si alguien copia/pega `https://brain.zapweave.com/v1/openbrain/match` debe funcionar igual que `kernel.../v1/openbrain/match`).

## Pasos en Cloudflare

### 1. CNAME para brain (vanity)

```
Cloudflare → zapweave.com → DNS → Records → Add record

  Type:     CNAME
  Name:     brain
  Target:   kernel.zapweave.com
  Proxy:    Proxied (orange cloud)
  TTL:      Auto
  Save
```

### 2. Verificar kernel sigue OK

Sólo lectura — debería estar ya:

```
  Type:    A
  Name:    kernel
  IPv4:    167.86.80.220
  Proxy:   Proxied (recomendado, te da SSL gratis y oculta IP origen)
```

Si el proxy está OFF (DNS only), `https://kernel.zapweave.com` requiere que tu certbot del VPS esté al día. Más simple: poner Proxy ON y dejar que Cloudflare provea TLS.

### 3. Redirect para audit

#### Opción A — Cloudflare Bulk Redirects (recomendado)

```
Cloudflare → Account home → Bulk Redirects → Create List

  List name: zapweave-redirects
  Description: Subdominios que redirigen a zapweave.com/<path>/

  Add redirect:
    Source URL:      https://audit.zapweave.com
    Target URL:      https://zapweave.com/audit/
    Status code:     301
    Preserve query:  yes
    Preserve path:   yes
    Subpath matching: yes
  Save → Deploy

  Después: Add a rule that uses this list
    Account home → Rules → Bulk Redirects → Create rule
    List: zapweave-redirects
    Save
```

#### Opción B — DNS CNAME + worker simple (si no quieres bulk redirects)

```
Type:    CNAME
Name:    audit
Target:  zapweave.com
Proxy:   Proxied
```

Y luego en `Rules → Page Rules → Create Page Rule`:

```
URL: audit.zapweave.com/*
Setting: Forwarding URL — Status: 301 - Permanent Redirect
Destination: https://zapweave.com/audit/$1
Save
```

(Cloudflare está dejando deprecated Page Rules a favor de Bulk Redirects; usa la opción A si tu cuenta ya migró.)

## Verificación

```bash
# Después de la propagación (1-5 min con Cloudflare):

# 1. brain → kernel debe servir el mismo /v1/health
curl -s https://brain.zapweave.com/v1/health
# Esperado: {"status":"online","version":"1.0.0",...}

# 2. audit redirect 301
curl -sI https://audit.zapweave.com/
# Esperado: HTTP/2 301
#           location: https://zapweave.com/audit/

# 3. Audit landing real
curl -sI https://zapweave.com/audit/
# Esperado: HTTP/2 200, content-type: text/html
```

## Plantilla zone file (si tu DNS no es Cloudflare)

Si tu proveedor de DNS no soporta redirects nativos, los registros mínimos son:

```
zapweave.com.            300  IN  CNAME  AngelReml.github.io.   ; ya configurado
kernel.zapweave.com.     300  IN  A      167.86.80.220          ; ya configurado
brain.zapweave.com.      300  IN  CNAME  kernel.zapweave.com.   ; nuevo
audit.zapweave.com.      300  IN  CNAME  AngelReml.github.io.   ; nuevo
```

(Para que `audit.zapweave.com` sirva la landing directamente vía GitHub Pages, GitHub no soporta dos custom domains por repo. Hay que usar Cloudflare como intermediario o un repo separado.)

## TODOs derivados (no para esta sesión)

- [ ] Validar que el TLS cert de Cloudflare cubre los nuevos subdominios (suele ser automático si el proxy está ON).
- [ ] Probar `audit.zapweave.com` desde móvil para confirmar redirect.
- [ ] Si el negocio crece, mover `audit.zapweave.com` a un static host dedicado (Netlify, Cloudflare Pages como segundo deployment).
