-- Run once in the Supabase SQL Editor.
-- This stores map ballots only. Leetify match data is never persisted.

create table if not exists public.map_votes (
  cycle_match_id uuid not null,
  voter_id uuid not null,
  voter_name text not null check (char_length(voter_name) between 1 and 24),
  map_name text not null check (map_name ~ '^(de|cs)_[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  primary key (cycle_match_id, voter_id, map_name)
);

alter table public.map_votes enable row level security;

drop policy if exists "Public ballots are readable" on public.map_votes;
create policy "Public ballots are readable"
  on public.map_votes
  for select
  to anon, authenticated
  using (true);

revoke all on public.map_votes from anon, authenticated;
grant select on public.map_votes to anon, authenticated;

create or replace function public.replace_map_ballot(
  p_cycle_match_id uuid,
  p_voter_id uuid,
  p_voter_name text,
  p_maps text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cycle_match_id is null or p_voter_id is null then
    raise exception 'A cycle and voter are required';
  end if;

  if char_length(trim(p_voter_name)) not between 1 and 24 then
    raise exception 'Callsign must contain 1 to 24 characters';
  end if;

  if cardinality(p_maps) > 3 then
    raise exception 'A ballot can contain at most three maps';
  end if;

  if exists (
    select 1
    from unnest(p_maps) as selected_map
    where selected_map not in (
      'de_cache', 'de_anubis', 'de_inferno', 'de_mirage', 'de_dust2',
      'de_nuke', 'de_ancient', 'de_train', 'de_vertigo', 'de_overpass',
      'de_boulder', 'de_fachwerk', 'cs_shelter', 'cs_office', 'de_italy'
    )
  ) then
    raise exception 'Map is not available for voting';
  end if;

  delete from public.map_votes
  where cycle_match_id = p_cycle_match_id
    and voter_id = p_voter_id;

  insert into public.map_votes (cycle_match_id, voter_id, voter_name, map_name)
  select p_cycle_match_id, p_voter_id, trim(p_voter_name), selected_map
  from (select distinct unnest(p_maps) as selected_map) ballot;
end;
$$;

revoke all on function public.replace_map_ballot(uuid, uuid, text, text[]) from public;
grant execute on function public.replace_map_ballot(uuid, uuid, text, text[])
  to anon, authenticated;

create index if not exists map_votes_cycle_idx
  on public.map_votes (cycle_match_id, created_at desc);
