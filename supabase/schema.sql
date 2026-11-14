-- Rode este arquivo inteiro uma vez no SQL Editor do Supabase.
create extension if not exists pgcrypto;

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Casa',
  invite_code text not null unique default substr(md5(random()::text),1,8),
  created_at timestamptz not null default now()
);
create table members (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  primary key (user_id, household_id)
);

create or replace function is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from members where household_id = h and user_id = auth.uid()) $$;

-- Tabelas sincronizadas (todas com updated_at do cliente e synced_at do servidor)
create table categories (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  name text not null, color text not null default '#CFD8DC', sort int not null default 0,
  deleted boolean not null default false, updated_at timestamptz not null, synced_at timestamptz not null default now()
);
create table products (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  name text not null, category text not null, unit text not null default 'un', price numeric,
  deleted boolean not null default false, updated_at timestamptz not null, synced_at timestamptz not null default now()
);
create table lists (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  name text not null, status text not null default 'active', created_at timestamptz not null default now(), archived_at timestamptz,
  deleted boolean not null default false, updated_at timestamptz not null, synced_at timestamptz not null default now()
);
create table list_items (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  list_id uuid not null, product_id uuid, name text not null, category text not null,
  qty numeric not null default 1, unit text not null default 'un',
  est_price numeric, paid_price numeric, checked boolean not null default false, sort int not null default 0,
  deleted boolean not null default false, updated_at timestamptz not null, synced_at timestamptz not null default now()
);
create table price_history (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  product_id uuid, product_name text not null, price numeric not null, kind text not null default 'pago', at timestamptz not null default now(),
  deleted boolean not null default false, updated_at timestamptz not null, synced_at timestamptz not null default now()
);

-- Last-write-wins: uma edição mais antiga (ex.: feita offline) nunca sobrescreve uma mais nova.
create or replace function lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then return null; end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['categories','products','lists','list_items','price_history'] loop
    execute format('create trigger %I_lww before insert or update on %I for each row execute function lww()', t, t);
    execute format('create index %I_sync on %I (household_id, synced_at)', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t, t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;

alter table households enable row level security;
alter table members enable row level security;
create policy households_read on households for select using (is_member(id));
create policy members_read on members for select using (user_id = auth.uid() or is_member(household_id));

create or replace function create_household(p_name text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into households(name) values (coalesce(nullif(p_name,''),'Casa')) returning * into h;
  insert into members values (auth.uid(), h.id);
  return h;
end $$;

create or replace function join_household(p_code text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into h from households where invite_code = lower(trim(p_code));
  if h.id is null then raise exception 'codigo invalido'; end if;
  insert into members values (auth.uid(), h.id) on conflict do nothing;
  return h;
end $$;

create or replace function my_household() returns households
language sql stable security definer set search_path = public as $$
  select h.* from households h join members m on m.household_id = h.id where m.user_id = auth.uid() limit 1 $$;
