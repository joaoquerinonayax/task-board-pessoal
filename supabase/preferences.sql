-- =============================================================================
--  Task Board — Preferences table  (run AFTER schema.sql)
-- -----------------------------------------------------------------------------
--  One row per user holding all UI/layout preferences as JSONB, so nothing is
--  kept only in the browser: theme, language, current view, group-by + collapsed
--  groups (per column/view), hidden columns, sidebar state, notes mode/focus/sort,
--  presentations sort, analytics config, graph node colors/sizes/shapes/positions,
--  and the profile avatar.
--  Run in: Supabase Dashboard → SQL Editor → New query → Run.
--  Safe to run more than once.
-- =============================================================================

create table if not exists public.preferences (
  user_id     uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.preferences enable row level security;

drop policy if exists "own preferences" on public.preferences;
create policy "own preferences" on public.preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists preferences_touch_updated_at on public.preferences;
create trigger preferences_touch_updated_at
  before update on public.preferences
  for each row execute function public.touch_updated_at();

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.preferences'; exception when duplicate_object then null; end;
end $$;

-- Done. Preferences now sync to the cloud and follow you across devices.
