-- Spring journal: a shared, invite-only log of spring visits, ratings,
-- wildlife sightings (with GPS pins), and photos.
--
-- Access model: anyone can create a Supabase Auth account, but every table is
-- gated on public.is_member(), which checks the signed-in email against the
-- members allowlist. Members can read everything; each person can edit or
-- delete only what they logged. Seed the first member by hand (not here), so
-- no personal email lands in the repo:
--   insert into public.members (email, display_name) values ('you@example.com', 'You');

-- ---------- members ----------
create table public.members (
  email text primary key check (email = lower(email) and email like '%@%'),
  display_name text check (char_length(display_name) <= 60),
  added_at timestamptz not null default now()
);

create function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

alter table public.members enable row level security;
create policy "Members see the member list" on public.members
  for select to authenticated using ((select public.is_member()));
create policy "Members invite others" on public.members
  for insert to authenticated with check ((select public.is_member()));
create policy "Members edit display names" on public.members
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
-- You can remove others but not yourself, so the journal can't lock out its last member by accident.
create policy "Members remove others" on public.members
  for delete to authenticated
  using ((select public.is_member()) and email <> lower(coalesce((select auth.jwt()) ->> 'email', '')));

-- ---------- visits ----------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  -- Stable id from public/data/springs.json (slug of name + county).
  spring_id text not null check (char_length(spring_id) <= 120),
  visited_on date not null default current_date,
  rating smallint check (rating between 1 and 5),
  notes text check (char_length(notes) <= 4000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_spring_idx on public.visits (spring_id);
create index visits_created_by_idx on public.visits (created_by);

-- ---------- sightings ----------
create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  species text not null check (char_length(species) between 1 and 80),
  animal_group text not null check (animal_group in ('manatees', 'alligators', 'turtles', 'fish', 'otters', 'birds', 'snakes', 'mammals', 'other')),
  count smallint check (count > 0),
  -- Where it was seen: the phone's GPS, or the spring itself when no fix was taken.
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  from_gps boolean not null default false,
  seen_at timestamptz not null default now(),
  notes text check (char_length(notes) <= 1000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sightings_visit_idx on public.sightings (visit_id);
create index sightings_created_by_idx on public.sightings (created_by);

-- ---------- photos ----------
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  -- Object path in the private "journal-photos" bucket.
  path text not null unique,
  width integer,
  height integer,
  caption text check (char_length(caption) <= 300),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index photos_visit_idx on public.photos (visit_id);
create index photos_created_by_idx on public.photos (created_by);

-- ---------- row-level security for journal rows ----------
do $$
declare t text;
begin
  foreach t in array array['visits', 'sightings', 'photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "Members read" on public.%I for select to authenticated using ((select public.is_member()))$p$, t);
    execute format($p$create policy "Members add their own" on public.%I for insert to authenticated with check ((select public.is_member()) and created_by = (select auth.uid()))$p$, t);
    execute format($p$create policy "Authors edit" on public.%I for update to authenticated using ((select public.is_member()) and created_by = (select auth.uid())) with check (created_by = (select auth.uid()))$p$, t);
    execute format($p$create policy "Authors delete" on public.%I for delete to authenticated using ((select public.is_member()) and created_by = (select auth.uid()))$p$, t);
  end loop;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger visits_touch before update on public.visits
  for each row execute function public.touch_updated_at();

-- The author shown on a visit comes from the session, never from the client.
create function public.stamp_author() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  return new;
end;
$$;
create trigger visits_stamp_author before insert on public.visits
  for each row execute function public.stamp_author();

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-photos', 'journal-photos', false, 10485760, array['image/jpeg', 'image/webp', 'image/png']);

create policy "Members view journal photos" on storage.objects
  for select to authenticated using (bucket_id = 'journal-photos' and (select public.is_member()));
create policy "Members upload journal photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'journal-photos' and (select public.is_member()));
create policy "Uploaders delete their journal photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'journal-photos' and (select public.is_member()) and owner_id = (select auth.uid())::text);

-- ---------- keep-alive ----------
-- Free projects pause after a week idle; the deploy workflow calls this every six hours.
create function public.ping() returns timestamptz
language sql stable set search_path = ''
as $$ select now(); $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
