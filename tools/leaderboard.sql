/* =====================================================================
   1. Leaderboards
   Players can post any finished 5-round game started with Play (or in a lobby).
   There's a board for each difficulty; each shows every player's best score
   (ties go to the quicker time), this week or all time. Games with other round
   counts are for fun and can't be posted.
   ===================================================================== */

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  player     uuid        not null,                       -- anonymous random id kept in the player's browser
  name       text        not null check (char_length(name) between 2 and 16 and name ~ '^[A-Za-z0-9 _.-]+$'),
  diff       text        not null check (diff in ('v', 'e', 'm', 'h', 'a')),   -- Very easy, Easy, Medium, Hard, Every map
  rounds     integer     not null check (rounds in (3, 5, 10)),
  score      integer     not null,
  time_ms    integer     not null,                       -- total time spent guessing, in milliseconds
  seed       integer     not null,                       -- which game it was, so the same game can't be posted twice
  created_at timestamptz not null default now(),
  constraint scores_score_ok check (score between 0 and rounds * 5000),
  constraint scores_time_ok  check (time_ms between rounds * 500 and 86400000)
);
create unique index if not exists scores_one_per_game on public.scores (player, diff, rounds, seed);
create index        if not exists scores_board        on public.scores (diff, rounds, score desc, time_ms);
create index        if not exists scores_recent       on public.scores (created_at);

alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;
-- the site can add scores (the checks above keep them sensible) but can't read, change or delete the table directly
grant insert (player, name, diff, rounds, score, time_ms, seed) on public.scores to anon, authenticated;
drop policy if exists "add a score" on public.scores;
create policy "add a score" on public.scores for insert to anon, authenticated with check (rounds = 5);

-- a board: the top 50 players (their best game each), plus where the asking player stands
-- weekly boards start every Monday at 00:00 GMT
create or replace function public.leaderboard(p_diff text, p_rounds integer, p_weekly boolean, p_player uuid default null)
returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with best as (
    select distinct on (player) player, name, score, time_ms, created_at
    from scores
    where diff = p_diff and rounds = p_rounds
      and (not p_weekly or created_at >= (date_trunc('week', now() at time zone 'utc') at time zone 'utc'))
    order by player, score desc, time_ms, created_at
  ), ranked as (
    select *, row_number() over (order by score desc, time_ms, created_at) as pos from best
  )
  select json_build_object(
    'total', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(json_build_object('pos', pos, 'name', name, 'score', score, 'time', time_ms, 'me', player = p_player) order by pos)
      from ranked where pos <= 50), '[]'::json),
    'mine', (select json_build_object('pos', pos, 'name', name, 'score', score, 'time', time_ms) from ranked where player = p_player)
  );
$$;
revoke all on function public.leaderboard(text, integer, boolean, uuid) from public;
grant execute on function public.leaderboard(text, integer, boolean, uuid) to anon, authenticated;


/* =====================================================================
   2. Lobbies: play the same spots with friends, round by round
   The tables can't be read or written directly. Everything goes through
   the lobby_* functions below, which check who is asking and what's allowed.
   Each browser has a secret token; only a hash of it (the player id) is stored.
   ===================================================================== */

create table if not exists public.lobbies (
  code       text        primary key check (code ~ '^[A-Z2-9]{6}$'),
  host       uuid        not null,
  diff       text        not null check (diff in ('v', 'e', 'm', 'h', 'a')),
  rounds     integer     not null check (rounds in (3, 5, 10, 15, 20)),
  seed       integer     not null,
  state      text        not null default 'wait' check (state in ('wait', 'play', 'done')),
  round      integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lobby_players (
  code      text        not null references public.lobbies (code) on delete cascade,
  player    uuid        not null,
  name      text        not null check (char_length(name) between 2 and 16 and name ~ '^[A-Za-z0-9 _.-]+$'),
  joined_at timestamptz not null default now(),
  seen_at   timestamptz not null default now(),
  round     integer     not null default 0,             -- last round this player has guessed
  score     integer     not null default 0,
  time_ms   integer     not null default 0,
  results   jsonb       not null default '[]'::jsonb,   -- one entry per guessed round
  primary key (code, player)
);
create index if not exists lobbies_host on public.lobbies (host, created_at);
-- upgrade an older lobbies table to allow 15 and 20 rounds
alter table public.lobbies drop constraint if exists lobbies_rounds_check;
alter table public.lobbies add constraint lobbies_rounds_check check (rounds in (3, 5, 10, 15, 20));

alter table public.lobbies       enable row level security;
alter table public.lobby_players enable row level security;
revoke all on public.lobbies, public.lobby_players from anon, authenticated;

-- player id from the browser's secret token
create or replace function public.lobby_pid(p_token text) returns uuid
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f-]{36}$' then
    raise exception 'Invalid player token';
  end if;
  return md5('lis:' || p_token)::uuid;
end $$;

create or replace function public.lobby_check_name(p_name text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(n) not between 2 and 16 or n !~ '^[A-Za-z0-9 _.-]+$' then
    raise exception 'Names must be 2-16 letters, numbers, spaces, _ - or .';
  end if;
  return n;
end $$;

-- the current state of a lobby, as seen by the player asking (also marks them as still here)
create or replace function public.lobby_state(p_code text, p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
  member boolean;
  newhost uuid;
begin
  select * into l from lobbies where code = upper(p_code);
  if not found then return null; end if;
  update lobby_players set seen_at = now() where code = l.code and player = pid;
  member := found;
  -- if the host has gone quiet, hand the lobby to the longest-standing player who is still here
  if not exists (select 1 from lobby_players where code = l.code and player = l.host and seen_at > now() - interval '40 seconds') then
    select player into newhost from lobby_players
      where code = l.code and seen_at > now() - interval '15 seconds'
      order by joined_at limit 1;
    if newhost is not null and newhost <> l.host then
      update lobbies set host = newhost where code = l.code returning * into l;
    end if;
  end if;
  return json_build_object(
    'code', l.code, 'diff', l.diff, 'rounds', l.rounds, 'state', l.state, 'round', l.round,
    'seed', case when member and l.state <> 'wait' then l.seed end,
    'host', l.host,
    'me', case when member then pid end,
    'players', coalesce((
      select json_agg(json_build_object(
        'id', p.player, 'name', p.name, 'round', p.round, 'score', p.score, 'time', p.time_ms,
        'results', p.results, 'idle', floor(extract(epoch from now() - p.seen_at))::int
      ) order by p.joined_at)
      from lobby_players p where p.code = l.code), '[]'::json)
  );
end $$;

create or replace function public.lobby_create(p_token text, p_name text, p_diff text, p_rounds integer) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  n   text := lobby_check_name(p_name);
  c   text;
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  tries int := 0;
begin
  if p_diff not in ('v', 'e', 'm', 'h', 'a') or p_rounds not in (3, 5, 10, 15, 20) then
    raise exception 'Invalid lobby settings';
  end if;
  -- tidy up old lobbies, and stop one browser creating lots of them
  delete from lobbies where updated_at < now() - interval '1 day';
  if (select count(*) from lobbies where host = pid and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'You''re making lobbies too quickly. Wait a minute and try again.';
  end if;
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    begin
      insert into lobbies (code, host, diff, rounds, seed)
        values (c, pid, p_diff, p_rounds, 100000 + floor(random() * 900000)::int);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 20 then raise exception 'Could not create a lobby. Try again.'; end if;
    end;
  end loop;
  insert into lobby_players (code, player, name) values (c, pid, n);
  return lobby_state(c, p_token);
end $$;

create or replace function public.lobby_join(p_code text, p_token text, p_name text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  n   text := lobby_check_name(p_name);
  l   lobbies;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then raise exception 'That lobby doesn''t exist any more.'; end if;
  if exists (select 1 from lobby_players where code = l.code and player = pid) then
    if l.state = 'wait' then
      if exists (select 1 from lobby_players where code = l.code and player <> pid and lower(name) = lower(n)) then
        raise exception 'Someone in the lobby already has that name.';
      end if;
      update lobby_players set name = n, seen_at = now() where code = l.code and player = pid;
    end if;
    return lobby_state(l.code, p_token);
  end if;
  if l.state <> 'wait' then raise exception 'This game has already started. You can join when it finishes.'; end if;
  if (select count(*) from lobby_players where code = l.code) >= 12 then raise exception 'This lobby is full.'; end if;
  if exists (select 1 from lobby_players where code = l.code and lower(name) = lower(n)) then
    raise exception 'Someone in the lobby already has that name.';
  end if;
  insert into lobby_players (code, player, name) values (l.code, pid, n);
  update lobbies set updated_at = now() where code = l.code;
  return lobby_state(l.code, p_token);
end $$;

create or replace function public.lobby_leave(p_code text, p_token text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
  nxt uuid;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then return; end if;
  delete from lobby_players where code = l.code and player = pid;
  if l.host = pid then
    select player into nxt from lobby_players where code = l.code order by seen_at > now() - interval '15 seconds' desc, joined_at limit 1;
    if nxt is null then
      delete from lobbies where code = l.code;
    else
      update lobbies set host = nxt, updated_at = now() where code = l.code;
    end if;
  end if;
end $$;

-- host only: change the maps / rounds while waiting, or start a fresh game after one finishes
create or replace function public.lobby_reset(p_code text, p_token text, p_diff text, p_rounds integer) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then raise exception 'That lobby doesn''t exist any more.'; end if;
  if l.host <> pid then raise exception 'Only the host can do that.'; end if;
  if l.state = 'play' then raise exception 'Wait for this game to finish first.'; end if;
  if p_diff not in ('v', 'e', 'm', 'h', 'a') or p_rounds not in (3, 5, 10, 15, 20) then
    raise exception 'Invalid lobby settings';
  end if;
  update lobbies set diff = p_diff, rounds = p_rounds, state = 'wait', round = 0,
    seed = case when l.state = 'done' then 100000 + floor(random() * 900000)::int else seed end,
    updated_at = now()
    where code = l.code;
  if l.state = 'done' then
    -- players who have left the page don't carry over to the next game
    delete from lobby_players where code = l.code and player <> pid and seen_at < now() - interval '60 seconds';
    update lobby_players set round = 0, score = 0, time_ms = 0, results = '[]'::jsonb where code = l.code;
  end if;
  return lobby_state(l.code, p_token);
end $$;

create or replace function public.lobby_start(p_code text, p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then raise exception 'That lobby doesn''t exist any more.'; end if;
  if l.host <> pid then raise exception 'Only the host can start the game.'; end if;
  if l.state = 'wait' then
    update lobbies set state = 'play', round = 1, updated_at = now() where code = l.code;
  end if;
  return lobby_state(l.code, p_token);
end $$;

-- host only: move everyone on from round p_from (does nothing if someone already did)
create or replace function public.lobby_next(p_code text, p_token text, p_from integer) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then raise exception 'That lobby doesn''t exist any more.'; end if;
  if l.host <> pid then raise exception 'Only the host can move to the next round.'; end if;
  if l.state = 'play' and l.round = p_from then
    if l.round >= l.rounds then
      update lobbies set state = 'done', updated_at = now() where code = l.code;
    else
      update lobbies set round = l.round + 1, updated_at = now() where code = l.code;
    end if;
  end if;
  return lobby_state(l.code, p_token);
end $$;

-- a player's guess for the current round
create or replace function public.lobby_submit(
  p_code text, p_token text, p_round integer, p_pts integer, p_ms integer,
  p_ok boolean, p_pick text, p_u real, p_v real
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pid uuid := lobby_pid(p_token);
  l   lobbies;
  pl  lobby_players;
begin
  select * into l from lobbies where code = upper(p_code) for update;
  if not found then raise exception 'That lobby doesn''t exist any more.'; end if;
  select * into pl from lobby_players where code = l.code and player = pid for update;
  if not found then raise exception 'You''re not in this lobby.'; end if;
  if l.state <> 'play' or p_round <> l.round then raise exception 'That round is over.'; end if;
  if pl.round >= p_round then return lobby_state(l.code, p_token); end if;  -- already guessed
  if p_pts not between 0 and 5000 or p_ms not between 0 and 3600000
     or char_length(coalesce(p_pick, '')) > 64
     or (p_u is not null and p_u not between -0.1 and 1.1)
     or (p_v is not null and p_v not between -0.1 and 1.1) then
    raise exception 'Invalid guess';
  end if;
  update lobby_players set
    round = p_round,
    score = score + p_pts,
    time_ms = time_ms + p_ms,
    seen_at = now(),
    results = results || jsonb_build_array(jsonb_build_object(
      'r', p_round, 'pts', p_pts, 'ms', p_ms, 'ok', p_ok, 'pick', p_pick, 'u', p_u, 'v', p_v))
    where code = l.code and player = pid;
  return lobby_state(l.code, p_token);
end $$;

-- only the lobby_* actions can be called from the website
revoke all on function public.lobby_pid(text), public.lobby_check_name(text) from public, anon, authenticated;
revoke all on function
  public.lobby_state(text, text), public.lobby_create(text, text, text, integer),
  public.lobby_join(text, text, text), public.lobby_leave(text, text),
  public.lobby_reset(text, text, text, integer), public.lobby_start(text, text),
  public.lobby_next(text, text, integer),
  public.lobby_submit(text, text, integer, integer, integer, boolean, text, real, real)
  from public;
grant execute on function
  public.lobby_state(text, text), public.lobby_create(text, text, text, integer),
  public.lobby_join(text, text, text), public.lobby_leave(text, text),
  public.lobby_reset(text, text, text, integer), public.lobby_start(text, text),
  public.lobby_next(text, text, integer),
  public.lobby_submit(text, text, integer, integer, integer, boolean, text, real, real)
  to anon, authenticated;
