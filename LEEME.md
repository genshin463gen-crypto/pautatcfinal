# Gestión TC Pauta — versión web

Dashboard con login, usuarios y datos compartidos en vivo.
**Costo: $0.** Usa Supabase (plan Free) para login y datos, y Vercel (plan Hobby) para publicar la página.

## Qué hay en la carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `auth.js`, `config.js` | La página que se publica |
| `supabase/schema.sql` | Crea las tablas y las reglas de acceso |
| `supabase/functions/admin-usuarios/index.ts` | Crea, edita y bloquea usuarios (solo admin) |
| `datos-iniciales.sql` | Tus datos actuales. **Tiene CBU y sueldos: no lo subas a GitHub** |
| `src/` y `tools/` | Fuente para futuras mejoras (`python3 tools/build.py` regenera `index.html`) |

## Paso a paso (unos 20 minutos)

### 1. Crear el proyecto en Supabase
1. Entrá a supabase.com, creá una cuenta y tocá **New project** (plan Free, región **South America (São Paulo)**).
2. Andá a **SQL Editor → New query**, pegá todo `supabase/schema.sql` y tocá **Run**.
3. Abrí otra query nueva, pegá `datos-iniciales.sql` y tocá **Run**.

### 2. Cerrar el registro público
En **Authentication → Sign In / Providers → Email**, apagá **Allow new users to sign up**.
Así solo entra quien vos des de alta.

### 3. Crear tu usuario administrador
1. En **Authentication → Users → Add user → Create new user**, poné el email `emi@tcpauta.local`, tu clave, y marcá **Auto Confirm User**.
2. En el **SQL Editor**, corré:
   ```sql
   insert into perfiles (id, usuario, nombre, rol)
   select id, 'emi', 'Emi', 'admin' from auth.users where email = 'emi@tcpauta.local';
   ```
Desde ahí entrás con usuario **emi** y tu clave.

### 4. Subir la función de usuarios
En **Edge Functions → Deploy a new function → Via Editor**:
1. Poné de nombre `admin-usuarios` (exacto).
2. Pegá el contenido de `supabase/functions/admin-usuarios/index.ts`.
3. Tocá **Deploy**.

### 5. Conectar la página
En **Project Settings → API** copiá:
- la **Project URL**
- la **anon / publishable key**

Pegalas en `config.js`. Esa key es pública por diseño: la seguridad la ponen las reglas del paso 1.

### 6. Publicar en internet
1. Creá un repositorio **privado** en GitHub y subí la carpeta. `datos-iniciales.sql` queda afuera solo, por el `.gitignore`.
2. En vercel.com, andá a **Add New → Project**, importá el repo, elegí Framework **Other** y tocá **Deploy**.
3. Vercel te da un link tipo `tc-pauta.vercel.app`. Cada vez que subas un cambio al repo, se actualiza solo.

### 7. Dar acceso a tu compañero
Entrá a la página, andá a **Usuarios → Crear acceso** y tocá **Generar clave**.
Le pasás el usuario y la clave por privado. Él entra desde cualquier PC con el link.

## Roles
- **Administrador:** todo, incluida la tarjeta Equipo (CBU y sueldos) y la sección Usuarios.
- **Usuario:** todo el dashboard menos Equipo y Usuarios.

Podés bloquear a alguien sin borrarlo, o cambiarle la clave cuando quieras.

## Por qué no cuesta casi nada
- La página es un archivo estático: no hay servidor encendido.
- Al entrar se leen todos los datos en una sola consulta (son pocos KB). Después solo llegan los cambios en vivo.
- Si la pestaña queda oculta más de 5 minutos, al volver se relee todo una vez.
- Los planes gratis alcanzan de sobra: 500 MB de base, 50.000 usuarios por mes y 500.000 llamadas a funciones.

## A tener en cuenta
- Supabase Free **pausa el proyecto tras 7 días sin uso**. Con uso diario no pasa. Si pasa, entrás a Supabase y tocás **Restore**.
- El plan Free no tiene backups automáticos. Una vez por mes, en **Table Editor → docs → Export to CSV**, guardate una copia.
