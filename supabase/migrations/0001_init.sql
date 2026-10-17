-- Hitster party: schema, row-level security and game functions.
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- Requires Authentication > Sign In / Providers > "Allow anonymous sign-ins" to be on.

create extension if not exists pgcrypto;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_uid uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  target_cards int not null default 10,
  winner_player_id uuid,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  uid uuid not null,
  nickname text not null check (length(nickname) between 1 and 24),
  created_at timestamptz not null default now(),
  unique (room_id, uid)
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  number int not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (room_id, number)
);

-- Kept apart from rounds so players can't read the answer before the reveal.
create table public.round_secrets (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  spotify_track_id text,
  title text not null,
  artist text not null,
  year int not null,
  image_url text
);

create table public.answers (
  round_id uuid not null references public.rounds(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  -- Slot i means "between my i-th and (i+1)-th card" in year order (0 = before all).
  slot int not null check (slot >= 0),
  is_correct boolean,
  answered_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create table public.timeline_cards (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  year int not null,
  title text not null,
  artist text not null default '',
  created_at timestamptz not null default now()
);

create index on public.players (room_id);
create index on public.rounds (room_id);
create index on public.answers (player_id);
create index on public.answers (room_id);
create index on public.timeline_cards (player_id);
create index on public.timeline_cards (room_id);

-- Row-level security ---------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.round_secrets enable row level security;
alter table public.answers enable row level security;
alter table public.timeline_cards enable row level security;

create function public.is_host(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rooms where id = p_room and host_uid = auth.uid());
$$;

-- All writes go through the functions below; tables are read-only to clients.
create policy rooms_read on public.rooms for select to authenticated using (true);
create policy players_read on public.players for select to authenticated using (true);
create policy rounds_read on public.rounds for select to authenticated using (true);
create policy cards_read on public.timeline_cards for select to authenticated using (true);

create policy secrets_read on public.round_secrets for select to authenticated using (
  exists (
    select 1 from rounds r
    where r.id = round_id and (r.status = 'closed' or public.is_host(r.room_id))
  )
);

create policy answers_read on public.answers for select to authenticated using (
  exists (
    select 1 from rounds r
    where r.id = round_id
      and (r.status = 'closed' or public.is_host(r.room_id)
           or exists (select 1 from players p where p.id = player_id and p.uid = auth.uid()))
  )
);

-- Game functions -------------------------------------------------------------

create function public.create_room(p_target_cards int default 10) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '')
      into v_code from generate_series(1, 4);
    exit when not exists (select 1 from rooms where code = v_code);
  end loop;
  insert into rooms (code, host_uid, target_cards)
    values (v_code, auth.uid(), greatest(3, least(p_target_cards, 30)))
    returning * into v_room;
  return v_room;
end $$;

create function public.join_room(p_code text, p_nickname text) returns public.players
language plpgsql security definer set search_path = public as $$
declare
  v_room rooms;
  v_player players;
  v_year int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_room from rooms where code = upper(trim(p_code));
  if not found then raise exception 'room not found'; end if;

  select * into v_player from players where room_id = v_room.id and uid = auth.uid();
  if found then
    update players set nickname = trim(p_nickname) where id = v_player.id returning * into v_player;
    return v_player;
  end if;

  insert into players (room_id, uid, nickname)
    values (v_room.id, auth.uid(), trim(p_nickname))
    returning * into v_player;

  -- Everyone starts with one random year card, like the board game.
  v_year := 1965 + floor(random() * 56)::int;
  insert into timeline_cards (room_id, player_id, year, title)
    values (v_room.id, v_player.id, v_year, 'Starting card');
  return v_player;
end $$;

-- Scores every answer, hands out cards and checks for a winner. No host check:
-- only called from close_round and open_round, which do their own.
create function public._close_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_secret round_secrets;
  v_room rooms;
  v_answer answers;
  v_years int[];
  v_n int;
  v_ok boolean;
  v_winner uuid;
begin
  select * into v_round from rounds where id = p_round for update;
  if not found or v_round.status = 'closed' then return; end if;
  select * into v_secret from round_secrets where round_id = p_round;

  for v_answer in select * from answers where round_id = p_round loop
    select coalesce(array_agg(year order by year), '{}') into v_years
      from timeline_cards where player_id = v_answer.player_id;
    v_n := coalesce(array_length(v_years, 1), 0);
    v_ok := v_answer.slot <= v_n
      and (v_answer.slot = 0 or v_years[v_answer.slot] <= v_secret.year)
      and (v_answer.slot = v_n or v_secret.year <= v_years[v_answer.slot + 1]);
    update answers set is_correct = v_ok
      where round_id = p_round and player_id = v_answer.player_id;
    if v_ok then
      insert into timeline_cards (room_id, player_id, round_id, year, title, artist)
        values (v_round.room_id, v_answer.player_id, p_round, v_secret.year, v_secret.title, v_secret.artist);
    end if;
  end loop;

  update rounds set status = 'closed', closed_at = now() where id = p_round;

  select * into v_room from rooms where id = v_round.room_id;
  select c.player_id into v_winner
    from timeline_cards c join players p on p.id = c.player_id
    where c.room_id = v_room.id
    group by c.player_id, p.created_at
    having count(*) >= v_room.target_cards
    order by count(*) desc, p.created_at
    limit 1;
  if v_winner is not null then
    update rooms set status = 'finished', winner_player_id = v_winner where id = v_room.id;
  end if;
end $$;

revoke execute on function public._close_round(uuid) from public, anon, authenticated;

create function public.close_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host((select room_id from rounds where id = p_round)) then
    raise exception 'only the host can reveal';
  end if;
  perform public._close_round(p_round);
end $$;

create function public.open_round(
  p_room uuid, p_spotify_track_id text, p_title text, p_artist text, p_year int, p_image_url text
) returns public.rounds
language plpgsql security definer set search_path = public as $$
declare
  v_open uuid;
  v_round rounds;
begin
  if not public.is_host(p_room) then raise exception 'only the host can start rounds'; end if;
  if (select status from rooms where id = p_room) = 'finished' then raise exception 'game is over'; end if;

  -- A new song ends the previous round.
  for v_open in select id from rounds where room_id = p_room and status = 'open' loop
    perform public._close_round(v_open);
  end loop;
  if (select status from rooms where id = p_room) = 'finished' then return null; end if;

  insert into rounds (room_id, number)
    values (p_room, coalesce((select max(number) from rounds where room_id = p_room), 0) + 1)
    returning * into v_round;
  insert into round_secrets (round_id, spotify_track_id, title, artist, year, image_url)
    values (v_round.id, p_spotify_track_id, p_title, p_artist, p_year, p_image_url);
  update rooms set status = 'playing' where id = p_room and status = 'lobby';
  return v_round;
end $$;

create function public.set_round_year(p_round uuid, p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host((select room_id from rounds where id = p_round)) then
    raise exception 'only the host can change the year';
  end if;
  if p_year not between 1900 and 2100 then raise exception 'bad year'; end if;
  update round_secrets set year = p_year where round_id = p_round;
end $$;

create function public.submit_answer(p_round uuid, p_slot int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
  v_room uuid;
begin
  select p.id, r.room_id into v_player, v_room
    from rounds r join players p on p.room_id = r.room_id and p.uid = auth.uid()
    where r.id = p_round and r.status = 'open';
  if v_player is null then raise exception 'round is closed or you are not in this room'; end if;
  insert into answers (round_id, room_id, player_id, slot) values (p_round, v_room, v_player, p_slot)
    on conflict (round_id, player_id) do update set slot = excluded.slot, answered_at = now();
end $$;

-- All-time leaderboard, grouped by nickname across every game.
create view public.alltime_leaderboard as
select
  min(p.nickname) as nickname,
  count(distinct p.room_id) as games,
  count(distinct r.id) filter (where r.winner_player_id = p.id) as wins,
  count(a.*) filter (where a.is_correct) as correct,
  count(a.*) filter (where a.is_correct is not null) as guesses
from public.players p
join public.rooms r on r.id = p.room_id
left join public.answers a on a.player_id = p.id
group by lower(p.nickname);

grant select on public.alltime_leaderboard to authenticated;

-- Live updates to phones.
alter publication supabase_realtime add table
  public.rooms, public.players, public.rounds, public.answers, public.timeline_cards;
