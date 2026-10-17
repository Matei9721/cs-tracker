-- Run in Supabase SQL Editor. Reruns preserve existing games.
-- Browser-supplied compact statistics, validated here, not independently verified.
begin;

create table if not exists public.season_matches (
  id uuid primary key,
  finished_at timestamptz not null check (finished_at >= '2026-01-20T23:00:00Z'),
  data_source text not null check (data_source in ('matchmaking', 'matchmaking_competitive')),
  map_name text not null check (map_name ~ '^(de|cs)_[a-z0-9_]{1,40}$'),
  team_scores jsonb not null check (jsonb_array_length(team_scores) = 2),
  player_stats jsonb not null check (jsonb_array_length(player_stats) = 3),
  archived_at timestamptz not null default now()
);
alter table public.season_matches enable row level security;
revoke all on public.season_matches from public, anon, authenticated;
grant select on public.season_matches to anon, authenticated;
drop policy if exists "Season statistics are readable" on public.season_matches;
create policy "Season statistics are readable" on public.season_matches
  for select to anon, authenticated using (true);

create table if not exists public.season_archive_status (
  singleton boolean primary key default true check (singleton),
  coverage_complete boolean not null default false,
  last_saved_at timestamptz
);
insert into public.season_archive_status (singleton) values (true) on conflict do nothing;
alter table public.season_archive_status enable row level security;
revoke all on public.season_archive_status from public, anon, authenticated;
grant select on public.season_archive_status to anon, authenticated;
drop policy if exists "Archive coverage is readable" on public.season_archive_status;
create policy "Archive coverage is readable" on public.season_archive_status
  for select to anon, authenticated using (true);

-- One response; the JSON array is not truncated at PostgREST's 1000-row limit.
create or replace function public.get_season_archive()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'matches', coalesce((select jsonb_agg(to_jsonb(m) - 'archived_at' order by m.finished_at desc)
      from public.season_matches m), '[]'::jsonb),
    'coverage_complete', s.coverage_complete,
    'last_saved_at', s.last_saved_at
  ) from public.season_archive_status s where singleton;
$$;
revoke all on function public.get_season_archive() from public;
grant execute on function public.get_season_archive() to anon, authenticated;

-- Insert-only: retries and concurrent visitors cannot duplicate or overwrite games.
create or replace function public.archive_season_matches(p_matches jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  s jsonb;
  t jsonb;
  k text;
  v jsonb;
  cleaned_stats jsonb;
  cleaned_player jsonb;
  inserted_count integer;
  inserted_total integer := 0;
  player_index integer;
  expected_ids text[] := array['76561198038593465','76561198078108941','76561198060030545'];
  allowed_fields text[] := array[
    'initial_team_number','total_kills','total_deaths','leetify_rating','score',
    'total_hs_kills','shots_fired','shots_hit_foe','total_damage','rounds_count',
    'rounds_survived','trade_kill_opportunities','trade_kill_attempts','he_thrown',
    'flashbang_thrown','smoke_thrown','molotov_thrown','flashbang_hit_foe','he_foes_damage_avg'
  ];
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'Matches must be an array';
  end if;
  if jsonb_array_length(p_matches) > 100 or pg_column_size(p_matches) > 512000 then
    raise exception 'At most 100 compact matches may be saved per request';
  end if;
  for m in select value from jsonb_array_elements(p_matches) loop
    if jsonb_typeof(m) <> 'object' or
      not (m ?& array['id','finished_at','data_source','map_name','team_scores','player_stats']) then
      raise exception 'Match fields are missing';
    end if;
    if m->>'id' is null or m->>'finished_at' is null or m->>'data_source' is null or m->>'map_name' is null then
      raise exception 'Match identity is required';
    end if;
    perform (m->>'id')::uuid;
    if (m->>'id')::uuid in (
      'b37948b6-6a52-4ceb-a34e-d2fab7bb190b'::uuid,
      'd4e2b6b3-40f7-4a00-8c7e-dbf0737d1506'::uuid,
      'a9956fd2-2262-486d-9e23-c881a4d5b11e'::uuid
    ) then raise exception 'Match is excluded'; end if;
    if (m->>'finished_at')::timestamptz < '2026-01-20T23:00:00Z'::timestamptz or
      (m->>'finished_at')::timestamptz > now() or
      m->>'data_source' not in ('matchmaking','matchmaking_competitive') or
      m->>'map_name' !~ '^(de|cs)_[a-z0-9_]{1,40}$' then
      raise exception 'Match is outside the tracked season or match types';
    end if;
    if jsonb_typeof(m->'team_scores') <> 'array' or jsonb_typeof(m->'player_stats') <> 'array' then
      raise exception 'Scores and players must be arrays';
    end if;
    if jsonb_array_length(m->'team_scores') <> 2 or jsonb_array_length(m->'player_stats') <> 3 then
      raise exception 'Two team scores and all three players are required';
    end if;
    for t in select value from jsonb_array_elements(m->'team_scores') loop
      if jsonb_typeof(t->'team_number') is distinct from 'number' or
        jsonb_typeof(t->'score') is distinct from 'number' then
        raise exception 'Team and score must be numbers';
      end if;
      if (t->>'team_number')::numeric not in (2,3) or
        (t->>'score')::numeric not between 0 and 1000 or
        (t->>'score')::numeric <> trunc((t->>'score')::numeric) then
        raise exception 'Invalid team or score';
      end if;
    end loop;
    if (m->'team_scores'->0->>'team_number')::numeric = (m->'team_scores'->1->>'team_number')::numeric then
      raise exception 'Team scores must refer to different teams';
    end if;
    cleaned_stats := '[]'::jsonb;
    for player_index in 0..2 loop
      s := m->'player_stats'->player_index;
      if s->>'steam64_id' is distinct from expected_ids[player_index + 1] or
        jsonb_typeof(s->'initial_team_number') is distinct from 'number' then
        raise exception 'All three configured players are required in order';
      end if;
      if (s->>'initial_team_number')::numeric not in (2,3) then
        raise exception 'Invalid player team';
      end if;
      cleaned_player := jsonb_build_object('steam64_id', expected_ids[player_index + 1]);
      foreach k in array allowed_fields loop
        v := coalesce(s->k, 'null'::jsonb);
        if jsonb_typeof(v) not in ('number','null') then
          raise exception 'Player statistics must be numeric or null';
        end if;
        if jsonb_typeof(v) = 'number' then
          if abs((v #>> '{}')::numeric) > 10000000 or
            (k <> 'leetify_rating' and (v #>> '{}')::numeric < 0) then
            raise exception 'Invalid player statistic';
          end if;
        end if;
        cleaned_player := cleaned_player || jsonb_build_object(k, v);
      end loop;
      cleaned_stats := cleaned_stats || jsonb_build_array(cleaned_player);
    end loop;
    insert into public.season_matches (id,finished_at,data_source,map_name,team_scores,player_stats)
    values ((m->>'id')::uuid,(m->>'finished_at')::timestamptz,m->>'data_source',m->>'map_name',
      (select jsonb_agg(jsonb_build_object('team_number',value->'team_number','score',value->'score'))
       from jsonb_array_elements(m->'team_scores')),cleaned_stats)
    on conflict (id) do nothing;
    get diagnostics inserted_count = row_count;
    inserted_total := inserted_total + inserted_count;
  end loop;
  if inserted_total > 0 then
    update public.season_archive_status set last_saved_at = now() where singleton;
  end if;
  return inserted_total;
end;
$$;
revoke all on function public.archive_season_matches(jsonb) from public;
grant execute on function public.archive_season_matches(jsonb) to anon, authenticated;
commit;
