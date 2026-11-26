# Configuración del backend del CRM

La web seguirá siendo estática. Supabase aloja la autenticación y PostgreSQL; las políticas de seguridad a nivel de fila (RLS) de la migración `migrations/20261126124000_crm_initial_schema.sql` son las que protegen los datos, incluso cuando se accede a la API directamente.

## Preparar el proyecto

1. Crea un proyecto Supabase dedicado al CRM y elige su región después de revisar los requisitos de privacidad y almacenamiento del club. No cargues datos reales de menores hasta completar esa revisión.
2. Abre **SQL Editor** en el panel del proyecto y ejecuta el contenido de la migración. La migración crea las tablas, activa RLS, limita los permisos de la API a usuarios autenticados y configura el perfil predeterminado como familiar.
3. En **Authentication → Settings**, desactiva los registros públicos y los inicios de sesión anónimos. Mantén activada la confirmación de correo y crea las cuentas mediante invitaciones desde **Authentication → Users**. Configura la URL del sitio y las URL de redirección permitidas cuando se conozca la URL final de GitHub Pages.
4. Invita la primera cuenta del club. El trigger crea su perfil con rol `family`; desde **SQL Editor**, cambia el rol usando el UUID de esa cuenta mostrado en el panel:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'UUID_DE_LA_CUENTA'::uuid;
   ```

   Repite la invitación para las familias, pero no cambies su rol. Cada cuenta familiar debe tener una fila correspondiente en `guardians` y vínculos explícitos en `player_guardians`; el personal del club puede gestionar esas relaciones desde la pestaña **Tutores** y las fichas de jugadores en `crm.html`.
5. Si el proyecto ya tenía usuarios antes de aplicar la migración, crea sus perfiles familiares por defecto y luego asigna manualmente el rol administrativo que corresponda:

   ```sql
   insert into public.profiles (id)
   select id from auth.users
   on conflict (id) do nothing;
   ```

## Modelo y permisos

- `guardians` vincula una cuenta de Auth con sus datos de contacto; `player_guardians` relaciona tutores y jugadores, permitiendo varios tutores por jugador.
- `players`, `teams`, `seasons` y `player_enrollments` modelan la plantilla. Los campos `archived_at` permiten bajas lógicas sin borrar el historial.
- `fees` registra cuotas en céntimos de euro; `payments` guarda importes parciales o completos, fecha, método y referencia opcional. `fee_balances` calcula lo pagado y el saldo pendiente.
- Las familias solo pueden leer tutores, jugadores, asignaciones, cuotas, pagos, equipos y temporadas vinculados a su propia cuenta. No pueden escribir datos ni cambiar su rol.
- Las funciones auxiliares de RLS están en el esquema `private`, que debe permanecer fuera de los esquemas expuestos por la API de Supabase; archivar un tutor revoca su acceso familiar.
- El personal con rol `admin` puede gestionar los datos por la API autenticada. El rol solo se asigna desde el panel SQL de confianza, no desde el cliente.
- Los pagos no permiten borrado desde la API para conservar el historial; se pueden corregir mediante actualización administrativa. No se deben guardar números de tarjeta, cuentas bancarias, credenciales ni datos financieros sensibles en `reference`.

## Comprobar el aislamiento antes de producción

Usa datos ficticios y dos cuentas familiares distintas para verificar el acceso después de aplicar la migración:

1. Invita las dos cuentas desde **Authentication → Users** y crea para cada una su fila `guardians`, un jugador diferente, una cuota y al menos un pago.
2. Inicia sesión con cada cuenta en `crm.html`. Cada una debe ver solo sus propios jugadores y movimientos; la segunda no debe encontrar registros de la primera.
3. Repite la comprobación consultando directamente la API autenticada para `players`, `fees`, `fee_balances` y `payments`. Comprueba también que una petición sin sesión no devuelve esos datos y que una familia no puede insertar ni modificar registros.
4. Archiva el tutor de prueba y confirma que esa cuenta deja de ver jugadores, cuotas y pagos. No uses datos reales de menores para estas pruebas.

## Claves y puesta en producción

`crm.js` ya contiene el Project URL y la clave pública `publishable` del proyecto configurado. Si se apunta el cliente a otro proyecto, sustituye ambos valores por sus credenciales públicas; no uses claves secretas. Añade la URL base de GitHub Pages como **Site URL** y `https://TU_USUARIO.github.io/TU_REPOSITORIO/crm.html` a las URL de redirección permitidas de Auth; reemplaza ambos marcadores por los valores reales del sitio.

La clave `service_role` o cualquier clave secreta actual de Supabase omite RLS: no debe aparecer en `index.html`, `crm.html`, JavaScript, GitHub Pages ni en el repositorio. GitHub Pages aloja únicamente la interfaz; la autenticación y los datos permanecen en Supabase. Si faltan los valores públicos, el formulario de acceso queda deshabilitado.

Antes de producción, revisa la base legal y los avisos aplicables a datos de menores, la región del proyecto, copias de seguridad, retención y el acceso de cada cuenta. La migración no configura un proyecto alojado ni sustituye esas decisiones operativas.