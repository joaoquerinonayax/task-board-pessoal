-- =============================================================================
--  Task Board — Ticketing system  (run AFTER schema.sql)
-- -----------------------------------------------------------------------------
--  Adds multi-user roles + a ticket/helpdesk system so a team can request
--  Power BI changes and the admin (you) can manage them.
--
--  Run in: Supabase Dashboard → SQL Editor → New query → Run.   Safe to re-run.
--
--  IMPORTANT: set ADMIN_EMAIL below to the e-mail you log in with.
-- =============================================================================

-- ----- Profiles (roles) ------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'requester',   -- 'requester' | 'admin'
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Admin check used by RLS. SECURITY DEFINER avoids RLS recursion on profiles.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles update" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profiles insert" on public.profiles for insert with check (id = auth.uid());

-- Auto-create a profile (role 'requester') whenever a user signs up / is invited.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----- Tickets ---------------------------------------------------------------
create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requester_email text,
  title           text not null default '',
  description     text not null default '',
  category        text not null default 'Change',     -- Change|Addition|Improvement|Bug|Question
  report          text default '',                    -- which Power BI report / area
  priority        text not null default 'Medium',     -- Low|Medium|High|Critical
  status          text not null default 'Open',       -- Open|In progress|Waiting|Done|Rejected
  linked_task_id  text,                                -- set when converted to a board task
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tickets_creator_idx on public.tickets(created_by);
alter table public.tickets enable row level security;

drop policy if exists "tickets select" on public.tickets;
drop policy if exists "tickets insert" on public.tickets;
drop policy if exists "tickets update" on public.tickets;
drop policy if exists "tickets delete" on public.tickets;
create policy "tickets select" on public.tickets for select using (created_by = auth.uid() or public.is_admin());
create policy "tickets insert" on public.tickets for insert with check (created_by = auth.uid());
create policy "tickets update" on public.tickets for update using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
create policy "tickets delete" on public.tickets for delete using (created_by = auth.uid() or public.is_admin());

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

-- ----- Ticket comments -------------------------------------------------------
create table if not exists public.ticket_comments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_email text,
  body         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists comments_ticket_idx on public.ticket_comments(ticket_id);
alter table public.ticket_comments enable row level security;

drop policy if exists "comments select" on public.ticket_comments;
drop policy if exists "comments insert" on public.ticket_comments;
create policy "comments select" on public.ticket_comments for select
  using (exists (select 1 from public.tickets t where t.id = ticket_id and (t.created_by = auth.uid() or public.is_admin())));
create policy "comments insert" on public.ticket_comments for insert
  with check (author_id = auth.uid() and exists (select 1 from public.tickets t where t.id = ticket_id and (t.created_by = auth.uid() or public.is_admin())));

-- ----- Realtime --------------------------------------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.tickets';         exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.ticket_comments'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.profiles';        exception when duplicate_object then null; end;
end $$;

-- ----- Roles bootstrap -------------------------------------------------------
-- Create profiles for any users that already existed, then promote the admin.
insert into public.profiles (id, email)
  select id, email from auth.users on conflict (id) do nothing;

-- 👇 CHANGE THIS to the e-mail you sign in with, if different:
update public.profiles set role = 'admin' where email = 'joaovquerino@gmail.com';

-- Done.
--  • Invite your team: Authentication → Users → Invite user (they join as 'requester').
--  • Team portal URL:  <your-site>/tickets.html
