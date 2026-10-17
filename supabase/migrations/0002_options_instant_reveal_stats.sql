-- Track Record v2: game options, random starting cards, instant per-player reveals, guess bounds for stats.
-- Run once in the Supabase SQL editor, after 0001.

-- Game options. A null target means no card limit: the host ends the game.
alter table public.rooms alter column target_cards drop not null;
alter table public.rooms add column starting_cards int not null default 1;

-- The years either side of the gap the player picked, as their timeline stood when they guessed
-- (null = open-ended). Grading and the stats both work from these.
alter table public.answers add column lower_year int, add column upper_year int;

-- Helpers ------------------------------------------------------------------------

create function public.has_answered(p_round uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from answers a join players p on p.id = a.player_id
    where a.round_id = p_round and p.uid = auth.uid()
  );
$$;

-- Row-level security ----------------------------------------------------------------

-- A player sees the song as soon as they've guessed it, without waiting for everyone else.
drop policy secrets_read on public.round_secrets;
create policy secrets_read on public.round_secrets for select to authenticated using (
  exists (
    select 1 from rounds r
    where r.id = round_id
      and (r.status = 'closed' or public.is_host(r.room_id) or public.has_answered(r.id))
  )
);

-- Cards won in a round that's still open would give the year away, so only their owner and
-- the host see them until the round closes.
drop policy cards_read on public.timeline_cards;
create policy cards_read on public.timeline_cards for select to authenticated using (
  round_id is null
  or exists (select 1 from rounds r where r.id = round_id and (r.status = 'closed' or public.is_host(r.room_id)))
  or exists (select 1 from players p where p.id = player_id and p.uid = auth.uid())
);

-- Game functions ---------------------------------------------------------------------

drop function public.create_room(int);
create function public.create_room(p_target_cards int default 10, p_starting_cards int default 1) returns public.rooms
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
  insert into rooms (code, host_uid, target_cards, starting_cards)
    values (
      v_code,
      auth.uid(),
      case when p_target_cards is not null then greatest(2, least(p_target_cards, 100)) end,
      greatest(1, least(coalesce(p_starting_cards, 1), 10))
    )
    returning * into v_room;
  return v_room;
end $$;

create or replace function public.join_room(p_code text, p_nickname text) returns public.players
language plpgsql security definer set search_path = public as $$
declare
  v_room rooms;
  v_player players;
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

  -- Random starting years from 1950 to 2022, preferring years nobody else in the room started with.
  insert into timeline_cards (room_id, player_id, year, title)
    select v_room.id, v_player.id, y, 'Starting card'
    from generate_series(1950, 2022) y
    order by exists (select 1 from timeline_cards c where c.room_id = v_room.id and c.round_id is null and c.year = y),
             random()
    limit v_room.starting_cards;
  return v_player;
end $$;

-- Guesses are graded on the spot, so each player sees their result straight away.
-- A guess is final.
drop function public.submit_answer(uuid, int);
create function public.submit_answer(p_round uuid, p_slot int) returns public.answers
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
  v_room uuid;
  v_secret round_secrets;
  v_years int[];
  v_n int;
  v_lo int;
  v_hi int;
  v_ok boolean;
  v_answer answers;
begin
  select p.id, r.room_id into v_player, v_room
    from rounds r join players p on p.room_id = r.room_id and p.uid = auth.uid()
    where r.id = p_round and r.status = 'open';
  if v_player is null then raise exception 'round is closed or you are not in this room'; end if;
  if exists (select 1 from answers where round_id = p_round and player_id = v_player) then
    raise exception 'you already guessed this song';
  end if;

  select coalesce(array_agg(year order by year), '{}') into v_years from timeline_cards where player_id = v_player;
  v_n := coalesce(array_length(v_years, 1), 0);
  if p_slot not between 0 and v_n then raise exception 'bad slot'; end if;
  v_lo := case when p_slot > 0 then v_years[p_slot] end;
  v_hi := case when p_slot < v_n then v_years[p_slot + 1] end;

  select * into v_secret from round_secrets where round_id = p_round;
  v_ok := (v_lo is null or v_lo <= v_secret.year) and (v_hi is null or v_secret.year <= v_hi);

  insert into answers (round_id, room_id, player_id, slot, lower_year, upper_year, is_correct)
    values (p_round, v_room, v_player, p_slot, v_lo, v_hi, v_ok)
    returning * into v_answer;
  if v_ok then
    insert into timeline_cards (room_id, player_id, round_id, year, title, artist)
      values (v_room, v_player, p_round, v_secret.year, v_secret.title, v_secret.artist);
  end if;
  return v_answer;
end $$;

-- Picks the leader (most cards, earliest to join breaks ties).
create function public._leader(p_room uuid, p_min_cards int) returns uuid
language sql stable security definer set search_path = public as $$
  select c.player_id
    from timeline_cards c join players p on p.id = c.player_id
    where c.room_id = p_room
    group by c.player_id, p.created_at
    having count(*) >= p_min_cards
    order by count(*) desc, p.created_at
    limit 1;
$$;
revoke execute on function public._leader(uuid, int) from public, anon, authenticated;

-- Answers are already graded, so closing a round just shows it to everyone and checks for a winner.
create or replace function public._close_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_room rooms;
  v_winner uuid;
begin
  select * into v_round from rounds where id = p_round for update;
  if not found or v_round.status = 'closed' then return; end if;
  update rounds set status = 'closed', closed_at = now() where id = p_round;

  select * into v_room from rooms where id = v_round.room_id;
  if v_room.target_cards is null then return; end if;
  v_winner := public._leader(v_room.id, v_room.target_cards);
  if v_winner is not null then
    update rooms set status = 'finished', winner_player_id = v_winner where id = v_room.id;
  end if;
end $$;

-- Ends the game now (needed when there's no card limit); whoever has the most cards wins.
create function public.end_game(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_open uuid;
begin
  if not public.is_host(p_room) then raise exception 'only the host can end the game'; end if;
  for v_open in select id from rounds where room_id = p_room and status = 'open' loop
    perform public._close_round(v_open);
  end loop;
  update rooms set status = 'finished', winner_player_id = public._leader(p_room, 1)
    where id = p_room and status <> 'finished';
end $$;

-- Fixing the year re-grades anyone who already guessed.
create or replace function public.set_round_year(p_round uuid, p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host((select room_id from rounds where id = p_round)) then
    raise exception 'only the host can change the year';
  end if;
  if p_year not between 1900 and 2100 then raise exception 'bad year'; end if;
  update round_secrets set year = p_year where round_id = p_round;
  update answers
    set is_correct = (lower_year is null or lower_year <= p_year) and (upper_year is null or p_year <= upper_year)
    where round_id = p_round;
  delete from timeline_cards where round_id = p_round;
  insert into timeline_cards (room_id, player_id, round_id, year, title, artist)
    select a.room_id, a.player_id, p_round, s.year, s.title, s.artist
    from answers a join round_secrets s on s.round_id = a.round_id
    where a.round_id = p_round and a.is_correct;
end $$;
