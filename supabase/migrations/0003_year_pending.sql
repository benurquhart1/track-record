-- Track Record v3: a round can start before its year is known. Guesses made meanwhile wait,
-- ungraded, and are graded the moment the host's lookup sets the year.
-- Run once in the Supabase SQL editor, after 0002.

alter table public.round_secrets alter column year drop not null;

create or replace function public.submit_answer(p_round uuid, p_slot int) returns public.answers
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
  -- No year yet: leave the guess ungraded until set_round_year fills it in.
  v_ok := case when v_secret.year is not null then
    (v_lo is null or v_lo <= v_secret.year) and (v_hi is null or v_secret.year <= v_hi) end;

  insert into answers (round_id, room_id, player_id, slot, lower_year, upper_year, is_correct)
    values (p_round, v_room, v_player, p_slot, v_lo, v_hi, v_ok)
    returning * into v_answer;
  if v_ok then
    insert into timeline_cards (room_id, player_id, round_id, year, title, artist)
      values (v_room, v_player, p_round, v_secret.year, v_secret.title, v_secret.artist);
  end if;
  return v_answer;
end $$;

-- Setting (or fixing) the year grades everyone who already guessed. If the round has already
-- closed, the win check runs again too.
create or replace function public.set_round_year(p_round uuid, p_year int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_room rooms;
  v_winner uuid;
begin
  select * into v_round from rounds where id = p_round;
  if not public.is_host(v_round.room_id) then
    raise exception 'only the host can change the year';
  end if;
  if p_year is null or p_year not between 1900 and 2100 then raise exception 'bad year'; end if;
  update round_secrets set year = p_year where round_id = p_round;
  update answers
    set is_correct = (lower_year is null or lower_year <= p_year) and (upper_year is null or p_year <= upper_year)
    where round_id = p_round;
  delete from timeline_cards where round_id = p_round;
  insert into timeline_cards (room_id, player_id, round_id, year, title, artist)
    select a.room_id, a.player_id, p_round, s.year, s.title, s.artist
    from answers a join round_secrets s on s.round_id = a.round_id
    where a.round_id = p_round and a.is_correct;

  select * into v_room from rooms where id = v_round.room_id;
  if v_round.status = 'closed' and v_room.status <> 'finished' and v_room.target_cards is not null then
    v_winner := public._leader(v_room.id, v_room.target_cards);
    if v_winner is not null then
      update rooms set status = 'finished', winner_player_id = v_winner where id = v_room.id;
    end if;
  end if;
end $$;
