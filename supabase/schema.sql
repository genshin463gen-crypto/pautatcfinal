-- =========================================================
--  Gestión TC Pauta — estructura de la base (Supabase)
--  Pegar entero en: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) Perfiles de usuario (rol y si está activo)
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  usuario   text not null unique,
  nombre    text,
  rol       text not null default 'usuario' check (rol in ('admin','gerente','usuario')),
  activo    boolean not null default true,
  creado    timestamptz not null default now()
);
alter table public.perfiles enable row level security;

-- Funciones de ayuda (rápidas: se evalúan una vez por consulta)
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo)
$$;
create or replace function public.es_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

drop policy if exists "perfiles_leer" on public.perfiles;
create policy "perfiles_leer" on public.perfiles for select to authenticated
  using (id = auth.uid() or (select public.es_admin()));
-- Crear / editar / borrar usuarios se hace solo desde la función admin-usuarios.

-- 2) Datos del dashboard: un documento JSON por ruta (ej.: "tareas/t01", "calendario/2026-10")
create table if not exists public.docs (
  path            text primary key,
  data            jsonb not null default '{}'::jsonb,
  actualizado     timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table public.docs enable row level security;

-- Cualquier usuario activo lee y escribe; lo que empieza con "privado/" (CBU, sueldos) solo admin.
drop policy if exists "docs_leer" on public.docs;
drop policy if exists "docs_insertar" on public.docs;
drop policy if exists "docs_actualizar" on public.docs;
drop policy if exists "docs_borrar" on public.docs;
create policy "docs_leer" on public.docs for select to authenticated
  using ((select public.es_activo()) and (path not like 'privado/%' or (select public.es_admin())));
create policy "docs_insertar" on public.docs for insert to authenticated
  with check ((select public.es_activo()) and (path not like 'privado/%' or (select public.es_admin())));
create policy "docs_actualizar" on public.docs for update to authenticated
  using ((select public.es_activo()) and (path not like 'privado/%' or (select public.es_admin())))
  with check ((select public.es_activo()) and (path not like 'privado/%' or (select public.es_admin())));
create policy "docs_borrar" on public.docs for delete to authenticated
  using ((select public.es_activo()) and (path not like 'privado/%' or (select public.es_admin())));

create or replace function public.docs_tocar() returns trigger language plpgsql as $$
begin new.actualizado := now(); new.actualizado_por := auth.uid(); return new; end $$;
drop trigger if exists docs_tocar on public.docs;
create trigger docs_tocar before insert or update on public.docs for each row execute function public.docs_tocar();

-- 3) Cambios en vivo (cuando alguien tilda algo, los demás lo ven al instante)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
