# Team Tracker

Tablero para dar seguimiento al trabajo de tus compañeros: PRs de GitHub (creados, mergeados, reviews),
tareas de Zoho Projects, resumen por semana, historial por persona y notas/acuerdos de seguimiento.

Stack: Next.js 15 (App Router) · TypeScript · Prisma + PostgreSQL · Tailwind.

## Arranque rápido (local)

```powershell
npm install
copy .env.example .env        # y completa los valores
npm run db:up                 # Postgres local con Docker (puerto 5440)
npm run db:deploy             # aplica las migraciones
npm run user:create -- tu@correo.com "Tu Nombre" ADMIN   # pide la contraseña (mín. 12 caracteres)
npm run dev                   # http://localhost:3000
```

Si cambias `prisma/schema.prisma`, genera una migración con `npm run db:migrate -- --name lo_que_cambió`.

Entra, ve a **Equipo → Agregar compañero** y luego a **Integraciones → Sincronizar ahora**.

Roles: `ADMIN` (agrega/quita compañeros, notas, sincroniza) y `VIEWER` (solo lectura).
Crea más usuarios con el mismo comando `user:create` (volver a ejecutarlo para un correo existente cambia su contraseña
y cierra sus sesiones).

## Cómo se liga cada persona

| Fuente | Cómo se identifica |
|---|---|
| GitHub | Por su **usuario de GitHub**. Si lo dejas vacío al agregarlo, se intenta descubrir desde el correo (solo funciona con correos públicos o presentes en commits visibles para el token). Si no se encuentra, aparece "sin vincular" y lo capturas a mano. |
| Zoho Projects | Por **correo**: se compara con los usuarios del portal (`/users/`) y se guarda su ID. Si el correo de Zoho es distinto, usa el campo "Correo en Zoho". |

Quitar a alguien = **Archivar** (conserva todo su historial, deja de sincronizarse y de aparecer en el resumen; se puede restaurar).
Solo un archivado puede **eliminarse definitivamente**, escribiendo su correo para confirmar.

## GitHub

1. Crea un token en GitHub → Settings → Developer settings → Fine-grained tokens, con acceso a los repos de tu organización y permisos
   de **lectura**: Pull requests, Metadata, Contents.
2. En `.env`: `GITHUB_TOKEN=...` y `GITHUB_ORG=tu-org`.

## Zoho Projects

1. Entra a <https://api-console.zoho.com> (usa el dominio de tu data center) → **Self Client**.
2. En *Generate Code* usa los scopes:
   `ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.users.READ,ZohoProjects.tasks.READ`
   y genera el código (dura pocos minutos).
3. Cambia el código por un **refresh token**:
   ```powershell
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" `
     -d "grant_type=authorization_code" -d "client_id=TU_CLIENT_ID" `
     -d "client_secret=TU_CLIENT_SECRET" -d "code=EL_CODIGO"
   ```
   (cambia `.com` por `.eu`, `.in`, `.com.au`, `.jp` según tu cuenta y pon el mismo valor en `ZOHO_DC`).
4. En `.env`: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_PORTAL_ID`
   (el ID numérico de tu portal; si no lo tienes a la mano, se obtiene con la API de portales de Zoho Projects) y opcionalmente `ZOHO_PORTAL_NAME` para armar links a las tareas.
5. En **Integraciones → Probar conexiones** debe decir "Zoho OK".

Limitaciones conocidas de la parte de Zoho (verifícalas con tu portal):
- Se usan los endpoints documentados `/restapi/portal/...` de tareas, proyectos y usuarios. **No** se consultan timesheets (no pude verificar
  ese endpoint en la documentación).
- El listado de tareas no trae fecha de cierre; la "fecha de completada" se aproxima con la última modificación vista al detectarla cerrada.
- Solo se guardan tareas que tengan como responsable a alguien del equipo.

## Sincronización automática

- Botón en **Integraciones**, o `npm run sync` (`-- --full` reconsulta todo el periodo `SYNC_LOOKBACK_DAYS`).
- Programada: en Vercel, el cron diario de `vercel.json` llama `GET /api/cron/sync` (Vercel añade `Authorization: Bearer <CRON_SECRET>`). En otro entorno, cualquier scheduler puede hacer esa llamada; requiere un secreto de ≥16 caracteres (si no hay, el endpoint queda desactivado).
- Al agregar a alguien (o cambiar su usuario de GitHub) se hace una sincronización completa en segundo plano.

## Seguridad incluida

- Contraseñas con bcrypt (costo 12); sesiones en BD con token aleatorio (solo se guarda su hash SHA-256), cookie `HttpOnly`, `SameSite=Lax`, `Secure` y prefijo `__Host-` en producción, vigencia 7 días.
- Límite de intentos de login (5 por correo / 15 min, bloqueo temporal de cuenta) y mismo mensaje de error exista o no el correo.
- Toda página y acción exige sesión (middleware + verificación en BD) y rol; mutaciones solo para `ADMIN`.
- Validación de entradas con zod; consultas parametrizadas (Prisma); sin HTML crudo (React escapa todo).
- Cabeceras: CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS en producción, etc. Las Server Actions de Next verifican el origen (CSRF).
- Los tokens de GitHub/Zoho viven solo en variables de entorno, nunca en la BD ni en el navegador.
- Bitácora de auditoría (altas, bajas, ediciones, logins, sincronizaciones) visible en **Integraciones**.

### Nota de uso responsable

Este tablero concentra datos de desempeño de personas. Conviene que tu equipo sepa qué se mide y para qué.

## Despliegue gratuito: Vercel + Neon

Elegido por ser gratis de forma permanente y sin "dormirse" (Render gratis borra su Postgres a los ~44 días). Límites a la fecha de esta guía,
verifícalos si pasa mucho tiempo:

- **Vercel Hobby:** funciones de hasta 300 s (alcanza para la sincronización); el cron gratuito corre **una vez al día** (con hasta ~1 h de
  desfase). Para sincronizar más seguido usa el botón. Hobby es el plan personal; revisa sus términos de uso si algún día lo usa más gente.
- **Neon Free:** 1 GB por proyecto, no caduca; se "duerme" tras 5 min sin uso y despierta en milisegundos.

Pasos:

1. Sube esta carpeta a un repositorio **privado** de GitHub (`.env` ya está en `.gitignore`).
2. En <https://neon.com> crea un proyecto. En *Connect* copia **dos** URLs:
   la *pooled* (host con `-pooler`) y la *direct* (sin `-pooler`). Ambas deben terminar en `?sslmode=require`.
3. En <https://vercel.com> → **Add New → Project**, importa el repo y antes de desplegar agrega estas variables de entorno:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URL *pooled* de Neon |
   | `DIRECT_URL` | URL *direct* de Neon (solo la usan las migraciones, que corren en el build) |
   | `TRUST_PROXY` | `true` |
   | `CRON_SECRET` | un secreto largo (ver `.env.example`); Vercel lo manda solo en el cron |
   | `WEEK_TZ_OFFSET_MINUTES` | `-360` (ajusta a tu zona) |
   | `GITHUB_TOKEN`, `GITHUB_ORG`, `ZOHO_*` | los de las secciones de arriba (puedes añadirlos después) |

   El build ejecuta `npm run vercel-build`: genera el cliente, **aplica las migraciones** y compila.
4. Crea tu usuario contra la base de producción, desde tu PC (la contraseña se pide por consola):
   ```powershell
   $env:DATABASE_URL = "url-direct-de-neon"; $env:DIRECT_URL = $env:DATABASE_URL
   npm run user:create -- tu@correo.com "Tu Nombre" ADMIN
   ```
5. Entra a tu URL de Vercel, agrega compañeros y pulsa **Sincronizar ahora**. El cron diario (`vercel.json`) hace el resto.
6. Como la app queda con URL pública, su protección es el login: usa una contraseña larga y única (el límite de intentos y las cookies seguras ya vienen incluidos).

Netlify y Render no son necesarios; esta app no requiere un servidor siempre encendido porque cada sincronización cabe en una sola ejecución de 5 min.

## Estructura

```
prisma/schema.prisma      modelo de datos (+ prisma/migrations)
vercel.json               cron diario de sincronización en Vercel
docker-compose.yml        Postgres local
src/lib/auth.ts           sesiones, login, roles
src/lib/github.ts|zoho.ts clientes de API
src/lib/sync.ts           sincronización (GitHub y Zoho)
src/lib/stats.ts          métricas semanales
src/app/(app)/            páginas: resumen, equipo, detalle semanal, integraciones
src/app/actions.ts        acciones del servidor (todas validan sesión y rol)
scripts/                  create-user, sync
```
