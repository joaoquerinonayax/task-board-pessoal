-- =============================================================================
--  Task Board — Presentations  (run AFTER schema.sql)
-- -----------------------------------------------------------------------------
--  Stores imported HTML slide decks for the Presentations tab.
--  Run in: Supabase Dashboard → SQL Editor → New query → Run. Safe to re-run.
-- =============================================================================

create table if not exists public.presentations (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title       text not null default '',
  html        text not null default '',
  tags        jsonb not null default '[]'::jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- (if the table already existed without it)
alter table public.presentations add column if not exists tags jsonb not null default '[]'::jsonb;
create index if not exists presentations_user_idx on public.presentations(user_id);

alter table public.presentations enable row level security;
drop policy if exists "own presentations" on public.presentations;
create policy "own presentations" on public.presentations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists presentations_touch on public.presentations;
create trigger presentations_touch before update on public.presentations
  for each row execute function public.touch_updated_at();

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.presentations'; exception when duplicate_object then null; end;
end $$;

-- Done. The Presentations tab will start syncing imported decks to the cloud.
