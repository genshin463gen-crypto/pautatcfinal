-- =========================================================
--  Roles (Administrador, Gerente, Usuario) y niveles
--  "Oculto / Solo ver / Ver y editar".
--  Correr UNA vez en SQL Editor > Run (reemplaza a permisos.sql).
-- =========================================================
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin','gerente','usuario'));

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

-- Nivel de acceso a "Equipo (CBU y sueldos)" del usuario conectado
create or replace function public.nivel_equipo() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.es_admin() then 'editar'
    when public.mi_rol() is null then 'oculto'
    else coalesce(
      (select data -> public.mi_rol() ->> 'cajeros_equipo' from docs where path = 'config/permisos'),
      case public.mi_rol() when 'gerente' then 'ver' else 'oculto' end)
  end
$$;
create or replace function public.puede_ver_privado() returns boolean
language sql stable security definer set search_path = public as $$
  select public.nivel_equipo() in ('ver','editar','true')
$$;
create or replace function public.puede_editar_privado() returns boolean
language sql stable security definer set search_path = public as $$
  select public.nivel_equipo() in ('editar','true')
$$;

drop policy if exists "docs_leer" on public.docs;
drop policy if exists "docs_insertar" on public.docs;
drop policy if exists "docs_actualizar" on public.docs;
drop policy if exists "docs_borrar" on public.docs;

create policy "docs_leer" on public.docs for select to authenticated
  using ((select public.es_activo()) and (path not like 'privado/%' or (select public.puede_ver_privado())));

create policy "docs_insertar" on public.docs for insert to authenticated
  with check ((select public.es_activo()) and (
       (path like 'privado/%' and (select public.puede_editar_privado()))
    or (path = 'config/permisos' and (select public.es_admin()))
    or (path not like 'privado/%' and path <> 'config/permisos')));
create policy "docs_actualizar" on public.docs for update to authenticated
  using ((select public.es_activo()) and (
       (path like 'privado/%' and (select public.puede_editar_privado()))
    or (path = 'config/permisos' and (select public.es_admin()))
    or (path not like 'privado/%' and path <> 'config/permisos')))
  with check ((select public.es_activo()) and (
       (path like 'privado/%' and (select public.puede_editar_privado()))
    or (path = 'config/permisos' and (select public.es_admin()))
    or (path not like 'privado/%' and path <> 'config/permisos')));
create policy "docs_borrar" on public.docs for delete to authenticated
  using ((select public.es_activo()) and (
       (path like 'privado/%' and (select public.puede_editar_privado()))
    or (path = 'config/permisos' and (select public.es_admin()))
    or (path not like 'privado/%' and path <> 'config/permisos')));
