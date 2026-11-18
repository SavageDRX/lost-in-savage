-- Global leaderboard for Lost in Savage (daily ranked).
-- Run this once in your Supabase project's SQL editor, then put the project URL and anon key in js/config.js.
-- Safe to run again: it updates an existing setup.

create table if not exists public.ranked_scores (
  id         bigint generated always as identity primary key,
  day        integer     not null,                       -- ranked day number (days since 2026-01-01, resetting at 04:00 GMT)
  player     uuid        not null,                       -- anonymous random id kept in the player's browser
  name       text        not null check (char_length(name) between 2 and 16 and name ~ '^[A-Za-z0-9 _.-]+$'),
  score      integer     not null check (score between 0 and 25000),
  created_at timestamptz not null default now()
);

-- If an earlier version of this script was run: remove the IP fingerprint and the one-per-name rule
drop trigger  if exists ranked_stamp_ip on public.ranked_scores;
drop function if exists public.ranked_stamp_ip();
drop index    if exists public.ranked_one_per_ip;
drop index    if exists public.ranked_one_per_name;
alter table public.ranked_scores drop column if exists ip_hash;

-- one entry per player per day: the first score counts and can't be replaced
create unique index if not exists ranked_one_per_player on public.ranked_scores (day, player);
create index        if not exists ranked_day_score      on public.ranked_scores (day, score desc);

alter table public.ranked_scores enable row level security;
grant select on public.ranked_scores to anon, authenticated;
grant insert (day, player, name, score) on public.ranked_scores to anon, authenticated;

-- anyone may read the leaderboard
drop policy if exists "read scores" on public.ranked_scores;
create policy "read scores" on public.ranked_scores for select to anon, authenticated using (true);

-- anyone may add a score, but only for today's (or, just after the reset, yesterday's) ranked day
drop policy if exists "add today's score" on public.ranked_scores;
create policy "add today's score" on public.ranked_scores for insert to anon, authenticated
  with check (
    day between floor((extract(epoch from now()) * 1000 - 4 * 3600000 - 1767225600000) / 86400000)::int - 1
            and floor((extract(epoch from now()) * 1000 - 4 * 3600000 - 1767225600000) / 86400000)::int
  );

-- No update or delete policies: nobody can change or remove scores from the website.
-- You can still remove a bad entry yourself in the Supabase table editor.
