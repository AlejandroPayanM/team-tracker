# Team Tracker

Tablero para dar seguimiento al trabajo de tus compañeros: PRs de GitHub (creados, mergeados, reviews),
tareas de Zoho Projects, resumen por semana, historial por persona y notas/acuerdos de seguimiento.

Stack: Next.js 15 (App Router) · TypeScript · Prisma + PostgreSQL · Tailwind.

## Probar en local (sin tocar producción)

Si tu `.env` apunta a Neon (producción), `npm run dev` trabajaría sobre tus datos reales. Para probar con seguridad usa el
**runner local**: ejecuta cualquier script contra un Postgres de Docker aparte (puerto 5440), ignorando la base de `.env`.
Requiere Docker Desktop abierto.

```powershell
npm install
npm run local setup          # levanta Postgres local y aplica las migraciones
npm run local seed:demo      # 3 compañeros, 3 repositorios y ~12 semanas de PRs ficticios + un usuario de prueba
npm run local dev            # http://localhost:3004
```

- **Entrar:** `seed:demo` imprime el correo y la contraseña del usuario de prueba (solo existe en la base local).
- **Con datos reales sin tocar producción:** si `GITHUB_TOKEN` está en tu `.env`, agrega compañeros reales en la app local y
  pulsa **Sincronizar ahora**: los PRs se guardan en la base local, no en Neon.
- **Otros comandos:** `npm run local user:create -- correo@x.com "Nombre" ADMIN`, `npm run local down` (apaga, conserva datos)
  y `npm run local reset` (apaga y **borra** la base local).
- `seed:demo` se niega a correr si la base no es local.

> Sin el prefijo `local`, los comandos usan la base de `.env`. Para producción hazlo a propósito.

## Arranque rápido (primera vez, sin runner)

```powershell
npm install
copy .env.example .env        # y completa los valores (DATABASE_URL local o de Neon)
npm run db:up                 # Postgres local con Docker (puerto 5440)
npm run db:deploy             # aplica las migraciones
npm run user:create -- tu@correo.com "Tu Nombre" ADMIN   # pide la contraseña (mín. 12 caracteres)
npm run dev                   # http://localhost:3004
```

Si cambias `prisma/schema.prisma`, genera una migración con `npm run local db:migrate -- --name lo_que_cambió`
(así se genera contra la base local y no contra producción).

Entra, ve a **Equipo → Agregar compañero** y luego a **Integraciones → Sincronizar ahora**.

Crea más usuarios con el mismo comando `user:create` (volver a ejecutarlo para un correo existente cambia su contraseña
y cierra sus sesiones), o —más cómodo— desde **Administración** dentro de la app.

## Equipos (células) y roles

Cada persona pertenece a **un solo equipo** (o a ninguno). Los equipos y los usuarios se administran en **Administración**
(solo `ADMIN`): crear/renombrar/eliminar equipos y crear usuarios con una contraseña temporal aleatoria que se muestra una
sola vez y que la persona debe cambiar al entrar.

| Rol | Qué ve | Qué puede hacer |
| --- | --- | --- |
| `ADMIN` (Administrador) | Todos los equipos; elige uno, «Sin equipo» o la vista general con el selector de la barra superior | Todo: equipos, usuarios, integraciones, sincronización, borrar personas |
| `MANAGER` (Líder de equipo) | Solo los equipos que tenga asignados | Agregar/editar/archivar personas y notas de **sus** equipos |
| `VIEWER` (Solo lectura) | Solo los equipos que tenga asignados | Nada (solo consultar) |

**Equipos** (`/teams`, para administradores y líderes) es un tablero: arrastra a las personas entre columnas, o usa «+ Agregar»,
«⇄» (mover, funciona en celular) y «✕» (quitar del equipo, solo admin). Los cambios se ven al instante y se confirman en el
servidor. Un líder solo mueve personas entre sus propios equipos. El admin designa al **líder** de cada equipo (debe tener acceso
a él). Un **líder de líderes** es simplemente un líder con varios equipos asignados: en **Líderes** ve, por cada líder, cómo le fue
a su equipo (PRs, merges, reviews, tareas y personas sin actividad) frente al periodo previo.

El alcance se aplica en servidor a todo: resumen, PRs, detalle semanal, perfiles, reportes y exportaciones. El equipo elegido
en el selector se guarda en una cookie, pero nunca se confía en ella: se valida contra los equipos permitidos en cada
petición. Quien no tiene acceso a una persona recibe un 404, igual que si no existiera. En los reportes puedes agrupar por **Equipo**.
Un líder sin equipos asignados no ve nada hasta que un administrador se los asigne.

## Cómo se liga cada persona

| Fuente | Cómo se identifica |
|---|---|
| GitHub | Por su **usuario de GitHub**. Si lo dejas vacío al agregarlo, se intenta descubrir desde el correo (solo funciona con correos públicos o presentes en commits visibles para el token). Si no se encuentra, aparece "sin vincular" y lo capturas a mano. |
| Zoho Projects | Por **correo**: se compara con los usuarios del portal (`/users/`) y se guarda su ID. Si el correo de Zoho es distinto, usa el campo "Correo en Zoho". |

Quitar a alguien = **Archivar** (conserva todo su historial, deja de sincronizarse y de aparecer en el resumen; se puede restaurar).
Solo un archivado puede **eliminarse definitivamente**, escribiendo su correo para confirmar.

## Dónde se configuran los tokens

Hay dos caminos y puedes mezclarlos (lo guardado en la app tiene prioridad sobre las variables de entorno):

1. **Desde la app (recomendado):** **Integraciones → Credenciales**. Pegas el token, la app lo **prueba contra GitHub/Zoho antes de
   guardarlo** y lo guarda **cifrado** (AES-256-GCM). Nunca se vuelve a mostrar completo (solo `•••• 1a2b`), solo los admins pueden
   cambiarlo y la auditoría registra el cambio sin guardar el valor. «Quitar lo guardado en la app» vuelve a las variables de entorno.
   - Requiere **una sola vez** la variable `APP_ENCRYPTION_KEY` (≥ 32 caracteres aleatorios; ver `.env.example`) en Vercel y un redeploy.
     La llave vive solo en Vercel, no en la base de datos: quien robara la base no podría leer los tokens sin ella.
   - Si cambias o pierdes la llave, los tokens guardados no se pueden descifrar: la app lo avisa, usa las variables de entorno como
     respaldo y tendrás que volver a capturarlos.
2. **Variables de entorno:** `GITHUB_TOKEN`, `GITHUB_ORG`, `ZOHO_*` (ver abajo). Cambiarlas exige redeploy.

## GitHub

1. Crea un token en GitHub → Settings → Developer settings → Fine-grained tokens, con acceso a los repos de tu organización y permisos
   de **lectura**: Pull requests, Metadata, Contents.
2. Pégalo en **Integraciones → Credenciales de GitHub** (o en `.env`: `GITHUB_TOKEN=...` y `GITHUB_ORG=tu-org`).

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
4. Captura en **Integraciones → Credenciales de Zoho Projects** (o en `.env`): data center, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
   `ZOHO_REFRESH_TOKEN`, `ZOHO_PORTAL_ID` (el ID numérico de tu portal; si no lo tienes a la mano, se obtiene con la API de portales de
   Zoho Projects) y opcionalmente `ZOHO_PORTAL_NAME` para armar links a las tareas.
5. Al guardar, la app prueba la conexión; también puedes usar **Integraciones → Probar conexiones**: debe decir "Zoho OK".

## Reportes

**Reportes** (menú superior) arma un reporte a tu medida y lo exporta:

- **Periodo:** cualquier rango de semanas (hasta 52) con atajos.
- **Filtros:** personas (varias; archivados opcionales) y repositorios (varios).
- **Agrupar por:** persona, repositorio, semana o **detalle** (una fila por PR, con enlace).
- **Métricas** a elegir: PRs creados, mergeados, cerrados sin merge, abiertos al cierre, reviews, líneas +/−, tiempo promedio a merge y
  tareas de Zoho completadas/con actividad.
- **Gráfica a elección:** tipo (barras, barras horizontales, líneas o dona), por qué graficar (persona, repositorio o semana), qué métrica
  y cuántos elementos mostrar. Es independiente de cómo agrupes la tabla.
- **Exportar** a **Excel** (hojas Resumen y Datos, con filtros, formatos y la gráfica incrustada), **PDF** (horizontal, con indicadores,
  gráfica y tabla paginada) o **imagen PNG** (tarjeta con indicadores y gráfica).

Notas: todo se recalcula en el servidor a partir de los filtros (del navegador solo viene la imagen de la gráfica, que se valida como PNG
real y de tamaño razonable). El Excel guarda los textos siempre como texto (nunca como fórmulas). El PDF incluye hasta 1500 filas y el
Excel hasta 5000 en el detalle de PRs. Con filtro de repositorio no se incluyen tareas de Zoho, que no pertenecen a un repositorio.

Limitaciones conocidas de la parte de Zoho (verifícalas con tu portal):
- Se usan los endpoints documentados `/restapi/portal/...` de tareas, proyectos y usuarios. **No** se consultan timesheets (no pude verificar
  ese endpoint en la documentación).
- El listado de tareas no trae fecha de cierre; la "fecha de completada" se aproxima con la última modificación vista al detectarla cerrada.
- Solo se guardan tareas que tengan como responsable a alguien del equipo.

## Sincronización automática

Sin webhooks ni procesos en segundo plano. Hay tres mecanismos que se complementan:

1. **Mientras tengas la app abierta (el principal):** la barra gris bajo el menú, en todas las pantallas, pregunta al servidor al abrir y cada
   5 min (solo si la pestaña está visible). Si los datos tienen más de 4 min, el servidor trae **solo lo que cambió desde la última vez** y la
   pantalla se recarga sola. Si ya están frescos, responde al instante sin tocar GitHub ni Zoho. El botón **↻ Actualizar** hace lo mismo al
   momento (con un mínimo de 20 s entre sincronizaciones para cuidar los límites de GitHub/Zoho). Se ve "Datos: hace 3 min".
2. **Cron diario** (Vercel): red de seguridad con un traslape de 1 día, por si GitHub tardó en indexar algún cambio.
3. **Manual** en **Integraciones** (con opción de sincronización completa), o `npm run sync` (`-- --full` reconsulta todo el periodo `SYNC_LOOKBACK_DAYS`).

Qué hace que sea rápida: el cursor lleva hora exacta (la sincronización automática busca lo modificado en los últimos ~20 min, no el día
completo); personas y proyectos se consultan varios a la vez (4 en GitHub, 3 en Zoho); los PRs, reviews y tareas se guardan en lotes y se
omiten los que no cambiaron. La tabla de **Integraciones** muestra la duración de cada corrida; las automáticas sin cambios no se listan.

Costo en el plan gratuito: cada consulta de la barra es una invocación corta. Con la pestaña abierta, Neon se mantiene activo (no se "duerme"
a los 5 min), lo que consume horas de cómputo del plan: unas 8 h de uso al día quedan muy por debajo del límite mensual gratuito.

- Botón en **Integraciones**, o `npm run sync` (`-- --full` reconsulta todo el periodo `SYNC_LOOKBACK_DAYS`).
- Programada: en Vercel, el cron diario de `vercel.json` llama `GET /api/cron/sync` (Vercel añade `Authorization: Bearer <CRON_SECRET>`). En otro entorno, cualquier scheduler puede hacer esa llamada; requiere un secreto de ≥16 caracteres (si no hay, el endpoint queda desactivado).
- Al agregar a alguien (o cambiar su usuario de GitHub) se hace una sincronización completa en segundo plano.

## Seguridad incluida

- Contraseñas con bcrypt (costo 12); sesiones en BD con token aleatorio (solo se guarda su hash SHA-256), cookie `HttpOnly`, `SameSite=Lax`, `Secure` y prefijo `__Host-` en producción, vigencia 7 días.
- Límite de intentos de login (5 por correo / 15 min, bloqueo temporal de cuenta) y mismo mensaje de error exista o no el correo.
- Toda página y acción exige sesión (middleware + verificación en BD) , rol y equipo; las mutaciones solo las hacen `ADMIN` y `MANAGER` (este último solo dentro de sus equipos).
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
   | `APP_ENCRYPTION_KEY` | llave de ≥ 32 caracteres aleatorios para cifrar los tokens que guardes desde la app (ver `.env.example`) |
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
