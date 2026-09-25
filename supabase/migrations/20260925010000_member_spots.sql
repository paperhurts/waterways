-- Snorkel and swim spots members add themselves. The curated ones live in
-- config/snorkel.json; springs come from public/data/springs.json. Visits refer
-- to any of them by id in visits.spring_id, so member spot ids get their own
-- "spot-" prefix, which a spring or curated id (name--county) can't have.

create table public.spots (
  id text primary key default ('spot-' || replace(gen_random_uuid()::text, '-', '')) check (id like 'spot-%' and char_length(id) <= 120),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('reef', 'offshore', 'lagoon', 'inlet', 'park', 'island', 'beach', 'cave', 'sinkhole', 'spring', 'other')),
  -- Florida and a margin around it.
  lat double precision not null check (lat between 24 and 31.5),
  lon double precision not null check (lon between -88 and -79.5),
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now()
);
create index spots_created_by_idx on public.spots (created_by);

-- As on visits, the author comes from the session, never from the client, and
-- an edit can't reassign a spot to someone else's name.
create trigger spots_stamp_author before insert or update on public.spots
  for each row execute function public.stamp_author();

alter table public.spots enable row level security;
create policy "Members read" on public.spots
  for select to authenticated using ((select private.is_member()));
create policy "Members add their own" on public.spots
  for insert to authenticated with check ((select private.is_member()) and created_by = (select auth.uid()));
create policy "Authors edit" on public.spots
  for update to authenticated using ((select private.is_member()) and created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "Authors delete" on public.spots
  for delete to authenticated using ((select private.is_member()) and created_by = (select auth.uid()));
