-- ==========================================================
-- SISTEMA INTEGRAL DE GESTIÓN TERRITORIAL (SIGT)
-- San Salvador Sur — schema.sql
--
-- Ejecuta este script COMPLETO en:
--   Supabase Dashboard > SQL Editor > New query > pegar > Run
--
-- Implementa el modelo de datos del informe técnico SIGT:
--   roles, usuarios, comunidades, referentes, catalogo_necesidades,
--   prioridades, estados, necesidades, fotografias, seguimiento,
--   auditoria, capas y tracks.
--
-- MODELO DE SEGURIDAD (Row Level Security):
--   - Lectura pública  : el visor muestra los datos sin iniciar sesión.
--   - Escritura        : SOLO usuarios autenticados con rol suficiente.
--                        El login NO ocurre en el visor: se realiza en
--                        el panel administrativo (admin.html).
--   Roles: 'admin'    -> todo, incluidos usuarios, borrado y auditoría
--          'editor'   -> crear/editar registros y seguimiento
--          'consulta' -> solo lectura autenticada
-- ==========================================================

create extension if not exists pgcrypto;
-- PostGIS: opcional pero recomendado (integración QGIS / consultas espaciales).
-- Si tu proyecto lo permite, descomenta la siguiente línea:
-- create extension if not exists postgis;

-- ==========================================================
-- 1. ROLES Y USUARIOS
-- ==========================================================

create table if not exists public.roles (
    id text primary key,             -- 'admin' | 'editor' | 'consulta'
    nombre text not null,
    descripcion text
);

insert into public.roles (id, nombre, descripcion) values
    ('admin',    'Administrador', 'Control total: usuarios, catálogos, borrado y auditoría.'),
    ('editor',   'Editor',        'Registra y edita necesidades, referentes, tracks y seguimiento.'),
    ('consulta', 'Consulta',      'Solo lectura autenticada.')
on conflict (id) do nothing;

-- Perfil ligado a auth.users. Supabase Auth gestiona las credenciales:
-- hashing fuerte de contraseñas, emisión de JWT y expiración de sesión.
create table if not exists public.usuarios (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre_completo text,
    rol_id text not null default 'consulta' references public.roles(id),
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

-- Helper: rol del usuario actual. SECURITY DEFINER evita recursión de RLS.
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select rol_id from public.usuarios where id = auth.uid() and activo),
        'anon'
    );
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select public.rol_actual() = 'admin';
$$;

create or replace function public.puede_editar()
returns boolean language sql stable security definer set search_path = public as $$
    select public.rol_actual() in ('admin', 'editor');
$$;

-- Alta automática de perfil cuando el admin crea el usuario en
-- Authentication > Users. Nace con el rol de menor privilegio.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.usuarios (id, nombre_completo, rol_id)
    values (new.id, coalesce(new.raw_user_meta_data->>'nombre_completo', new.email), 'consulta')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ==========================================================
-- 2. CATÁLOGOS
-- ==========================================================

create table if not exists public.comunidades (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    distrito text,
    canton text,
    created_at timestamptz not null default now()
);

create table if not exists public.catalogo_necesidades (
    id text primary key,             -- 'bache', 'carcava', 'riesgo', ...
    nombre text not null,
    icono text not null default 'circle-exclamation',
    color text not null default '#64748B',
    activo boolean not null default true
);

insert into public.catalogo_necesidades (id, nombre, icono, color) values
    ('bache',      'Bache',             'road',                  '#E53935'),
    ('carcava',    'Cárcava',           'water',                 '#8D6E63'),
    ('riesgo',     'Punto de Riesgo',   'triangle-exclamation',  '#F59E0B'),
    ('drenaje',    'Drenaje / Aguas',   'droplet',               '#0288D1'),
    ('alumbrado',  'Alumbrado',         'lightbulb',             '#FDD835'),
    ('desechos',   'Desechos Sólidos',  'trash',                 '#6D4C41'),
    ('otro',       'Otro',              'circle-exclamation',    '#64748B')
on conflict (id) do nothing;

create table if not exists public.prioridades (
    id text primary key,             -- 'alta' | 'media' | 'baja'
    nombre text not null,
    color text not null,
    orden int not null default 0
);

insert into public.prioridades (id, nombre, color, orden) values
    ('alta',  'Alta',  '#DC2626', 1),
    ('media', 'Media', '#F59E0B', 2),
    ('baja',  'Baja',  '#16A34A', 3)
on conflict (id) do nothing;

create table if not exists public.estados (
    id text primary key,             -- 'reportada' | 'en_proceso' | 'resuelta' | 'descartada'
    nombre text not null,
    color text not null,
    orden int not null default 0
);

insert into public.estados (id, nombre, color, orden) values
    ('reportada',  'Reportada',  '#0B5ED7', 1),
    ('en_proceso', 'En Proceso', '#F59E0B', 2),
    ('resuelta',   'Resuelta',   '#16A34A', 3),
    ('descartada', 'Descartada', '#64748B', 4)
on conflict (id) do nothing;

-- ==========================================================
-- 3. REFERENTES COMUNITARIOS (líderes)
-- ==========================================================

create table if not exists public.referentes (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    contacto text,
    cargo text,
    comunidad_id uuid references public.comunidades(id) on delete set null,
    comunidad_texto text,            -- texto libre si aún no está en el catálogo
    observaciones text,
    lng double precision not null,
    lat double precision not null,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

-- ==========================================================
-- 4. NECESIDADES GEORREFERENCIADAS
-- ==========================================================

create table if not exists public.necesidades (
    id uuid primary key default gen_random_uuid(),
    tipo_id text not null references public.catalogo_necesidades(id),
    prioridad_id text not null default 'media' references public.prioridades(id),
    estado_id text not null default 'reportada' references public.estados(id),
    descripcion text,
    direccion text,
    comunidad_id uuid references public.comunidades(id) on delete set null,
    comunidad_texto text,
    referente_id uuid references public.referentes(id) on delete set null,
    lng double precision not null,
    lat double precision not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

create index if not exists idx_necesidades_estado on public.necesidades(estado_id);
create index if not exists idx_necesidades_tipo   on public.necesidades(tipo_id);

-- ==========================================================
-- 5. TRACKS (recorridos de calles)
-- ==========================================================

create table if not exists public.tracks (
    id uuid primary key default gen_random_uuid(),
    nombre_calle text not null,
    tipo_superficie text not null
        check (tipo_superficie in ('tierra','pavimento','asfalto','adoquin','piedra','miscelaneo')),
    estado_id text references public.estados(id),
    comunidad_id uuid references public.comunidades(id) on delete set null,
    comunidad_texto text,
    observaciones text,
    longitud_m double precision,     -- longitud calculada del recorrido
    coordinates jsonb not null,      -- [[lng,lat], [lng,lat], ...]
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

-- ==========================================================
-- 6. FOTOGRAFÍAS (asociadas a necesidad, referente o track)
-- ==========================================================

create table if not exists public.fotografias (
    id uuid primary key default gen_random_uuid(),
    necesidad_id uuid references public.necesidades(id) on delete cascade,
    referente_id uuid references public.referentes(id) on delete cascade,
    track_id uuid references public.tracks(id) on delete cascade,
    url text not null,
    storage_path text,               -- ruta en el bucket, para poder borrarla
    descripcion text,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id),
    -- debe pertenecer exactamente a un registro
    constraint fotografia_una_relacion check (
        (necesidad_id is not null)::int
      + (referente_id is not null)::int
      + (track_id    is not null)::int = 1
    )
);

create index if not exists idx_fotos_necesidad on public.fotografias(necesidad_id);
create index if not exists idx_fotos_referente on public.fotografias(referente_id);
create index if not exists idx_fotos_track     on public.fotografias(track_id);

-- ==========================================================
-- 7. SEGUIMIENTO (bitácora de avance de una necesidad)
-- ==========================================================

create table if not exists public.seguimiento (
    id uuid primary key default gen_random_uuid(),
    necesidad_id uuid not null references public.necesidades(id) on delete cascade,
    estado_id text references public.estados(id),
    comentario text not null,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

create index if not exists idx_seguimiento_necesidad on public.seguimiento(necesidad_id);

-- ==========================================================
-- 8. CAPAS (configuración cartográfica administrable)
-- ==========================================================

create table if not exists public.capas (
    id text primary key,
    nombre text not null,
    archivo text,
    geometria text,
    visible boolean not null default false,
    orden int not null default 0,
    config jsonb
);

-- ==========================================================
-- 9. AUDITORÍA
-- ==========================================================

create table if not exists public.auditoria (
    id bigserial primary key,
    tabla text not null,
    operacion text not null,          -- INSERT | UPDATE | DELETE
    registro_id text,
    usuario_id uuid,
    datos_anteriores jsonb,
    datos_nuevos jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_auditoria_fecha on public.auditoria(created_at desc);

create or replace function public.fn_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_id text;
begin
    v_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
    insert into public.auditoria (tabla, operacion, registro_id, usuario_id, datos_anteriores, datos_nuevos)
    values (
        tg_table_name,
        tg_op,
        v_id,
        auth.uid(),
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
    );
    return coalesce(new, old);
end;
$$;

drop trigger if exists tg_aud_necesidades on public.necesidades;
create trigger tg_aud_necesidades after insert or update or delete on public.necesidades
    for each row execute function public.fn_auditoria();

drop trigger if exists tg_aud_referentes on public.referentes;
create trigger tg_aud_referentes after insert or update or delete on public.referentes
    for each row execute function public.fn_auditoria();

drop trigger if exists tg_aud_tracks on public.tracks;
create trigger tg_aud_tracks after insert or update or delete on public.tracks
    for each row execute function public.fn_auditoria();

drop trigger if exists tg_aud_seguimiento on public.seguimiento;
create trigger tg_aud_seguimiento after insert or update or delete on public.seguimiento
    for each row execute function public.fn_auditoria();

drop trigger if exists tg_aud_usuarios on public.usuarios;
create trigger tg_aud_usuarios after insert or update or delete on public.usuarios
    for each row execute function public.fn_auditoria();

-- updated_at automático en necesidades
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists tg_touch_necesidades on public.necesidades;
create trigger tg_touch_necesidades before update on public.necesidades
    for each row execute function public.fn_touch_updated_at();

-- ==========================================================
-- 10. ROW LEVEL SECURITY
-- ==========================================================

alter table public.roles                enable row level security;
alter table public.usuarios             enable row level security;
alter table public.comunidades          enable row level security;
alter table public.catalogo_necesidades enable row level security;
alter table public.prioridades          enable row level security;
alter table public.estados              enable row level security;
alter table public.referentes           enable row level security;
alter table public.necesidades          enable row level security;
alter table public.tracks               enable row level security;
alter table public.fotografias          enable row level security;
alter table public.seguimiento          enable row level security;
alter table public.capas                enable row level security;
alter table public.auditoria            enable row level security;

-- --- Catálogos: lectura pública, escritura solo admin -----
do $$
declare t text;
begin
    foreach t in array array['roles','comunidades','catalogo_necesidades','prioridades','estados','capas']
    loop
        execute format('drop policy if exists "%s_select_public" on public.%I', t, t);
        execute format('create policy "%s_select_public" on public.%I for select using (true)', t, t);

        execute format('drop policy if exists "%s_admin_write" on public.%I', t, t);
        execute format('create policy "%s_admin_write" on public.%I for all using (public.es_admin()) with check (public.es_admin())', t, t);
    end loop;
end $$;

-- --- Datos operativos: lectura pública, escritura editor/admin, borrado admin ---
do $$
declare t text;
begin
    foreach t in array array['referentes','necesidades','tracks','fotografias','seguimiento']
    loop
        execute format('drop policy if exists "%s_select_public" on public.%I', t, t);
        execute format('create policy "%s_select_public" on public.%I for select using (true)', t, t);

        execute format('drop policy if exists "%s_insert_editor" on public.%I', t, t);
        execute format('create policy "%s_insert_editor" on public.%I for insert with check (public.puede_editar())', t, t);

        execute format('drop policy if exists "%s_update_editor" on public.%I', t, t);
        execute format('create policy "%s_update_editor" on public.%I for update using (public.puede_editar()) with check (public.puede_editar())', t, t);

        execute format('drop policy if exists "%s_delete_admin" on public.%I', t, t);
        execute format('create policy "%s_delete_admin" on public.%I for delete using (public.es_admin())', t, t);
    end loop;
end $$;

-- --- usuarios: cada quien ve su perfil; el admin ve y administra todos ---
drop policy if exists "usuarios_select_propio" on public.usuarios;
create policy "usuarios_select_propio" on public.usuarios
    for select using (id = auth.uid() or public.es_admin());

drop policy if exists "usuarios_admin_write" on public.usuarios;
create policy "usuarios_admin_write" on public.usuarios
    for all using (public.es_admin()) with check (public.es_admin());

-- --- auditoría: solo admin puede leerla; nadie la modifica desde el cliente ---
drop policy if exists "auditoria_select_admin" on public.auditoria;
create policy "auditoria_select_admin" on public.auditoria
    for select using (public.es_admin());

-- ==========================================================
-- 11. STORAGE: bucket de fotografías
-- ==========================================================

insert into storage.buckets (id, name, public)
values ('fotos-sigt', 'fotos-sigt', true)
on conflict (id) do nothing;

drop policy if exists "fotos_sigt_select_public" on storage.objects;
create policy "fotos_sigt_select_public" on storage.objects
    for select using (bucket_id = 'fotos-sigt');

drop policy if exists "fotos_sigt_insert_editor" on storage.objects;
create policy "fotos_sigt_insert_editor" on storage.objects
    for insert with check (bucket_id = 'fotos-sigt' and public.puede_editar());

drop policy if exists "fotos_sigt_delete_editor" on storage.objects;
create policy "fotos_sigt_delete_editor" on storage.objects
    for delete using (bucket_id = 'fotos-sigt' and public.puede_editar());

-- ==========================================================
-- 12. VISTAS PARA EL VISOR PÚBLICO Y REPORTES
-- ==========================================================

create or replace view public.v_necesidades as
select
    n.id, n.lng, n.lat, n.descripcion, n.direccion,
    n.tipo_id, c.nombre as tipo_nombre, c.icono as tipo_icono, c.color as tipo_color,
    n.prioridad_id, p.nombre as prioridad_nombre, p.color as prioridad_color,
    n.estado_id, e.nombre as estado_nombre, e.color as estado_color,
    coalesce(com.nombre, n.comunidad_texto) as comunidad,
    r.nombre as referente_nombre,
    n.created_at, n.updated_at
from public.necesidades n
join public.catalogo_necesidades c on c.id = n.tipo_id
join public.prioridades p          on p.id = n.prioridad_id
join public.estados e              on e.id = n.estado_id
left join public.comunidades com   on com.id = n.comunidad_id
left join public.referentes r      on r.id = n.referente_id;

create or replace view public.v_referentes as
select
    r.id, r.lng, r.lat, r.nombre, r.contacto, r.cargo, r.observaciones,
    coalesce(com.nombre, r.comunidad_texto) as comunidad,
    r.created_at
from public.referentes r
left join public.comunidades com on com.id = r.comunidad_id;

-- ==========================================================
-- 13. PRIMER ADMINISTRADOR
-- ==========================================================
-- 1) Crea el usuario en: Authentication > Users > Add user
-- 2) Copia su UID y ejecuta (reemplazando el UUID):
--
-- update public.usuarios set rol_id = 'admin', nombre_completo = 'Nombre Apellido'
-- where id = '00000000-0000-0000-0000-000000000000';
--
-- No existe registro público de cuentas: las crea el administrador.
-- ==========================================================
