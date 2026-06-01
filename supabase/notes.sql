-- =============================================================================
--  Task Board — Notes table  (run AFTER schema.sql)
-- -----------------------------------------------------------------------------
--  Adds the Notes feature (Markdown notes + generate tasks).
--  Run in: Supabase Dashboard → SQL Editor → New query → Run.
--  Safe to run more than once.
-- =============================================================================

create table if not exists public.notes (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title       text not null default '',
  content     text not null default '',
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_user_idx on public.notes(user_id);

alter table public.notes enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.notes'; exception when duplicate_object then null; end;
end $$;

-- Done. The Notes tab will start syncing to the cloud.
