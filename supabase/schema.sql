-- =============================================================================
--  Task Board — Supabase schema  (single user · email + password)
-- -----------------------------------------------------------------------------
--  HOW TO RUN
--  1. Open your project at https://supabase.com/dashboard
--  2. Go to  SQL Editor  →  New query
--  3. Paste this whole file and click  RUN
--  It is safe to run more than once (uses IF NOT EXISTS / idempotent guards).
-- =============================================================================

-- ----- Tables ----------------------------------------------------------------

create table if not exists public.columns (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null default '',
  color       text not null default '#6161ff',
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.groups (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null default '',
  color       text not null default '#6161ff',
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title       text not null default '',
  description text not null default '',
  priority    text not null default 'Medium',
  deadline    date,
  col_id      text,
  group_id    text,
  position    integer not null default 0,
  subtasks    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists columns_user_idx on public.columns(user_id);
create index if not exists groups_user_idx  on public.groups(user_id);
create index if not exists tasks_user_idx    on public.tasks(user_id);

-- ----- Row Level Security ----------------------------------------------------
--  Each user can only read/write their own rows. The anon key shipped in the
--  browser is harmless on its own: without a logged-in session these policies
--  return zero rows and reject every write.

alter table public.columns enable row level security;
alter table public.groups  enable row level security;
alter table public.tasks   enable row level security;

drop policy if exists "own columns" on public.columns;
create policy "own columns" on public.columns
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own groups" on public.groups;
create policy "own groups" on public.groups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----- updated_at trigger (tasks) --------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ----- Realtime --------------------------------------------------------------
--  Let the app receive live row changes (multi-device / multi-tab sync).
--  Wrapped so re-running the script does not error if already added.

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.columns'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.groups';  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.tasks';   exception when duplicate_object then null; end;
end $$;

-- Done. Now copy your Project URL + anon key (Settings → API) into config.js.
