-- Track Record v4: the server fills in a round's year, so it lands even if the host's phone
-- locks or switches apps mid-lookup. Run once in the Supabase SQL editor, after 0003.

-- A one-off secret the host makes when starting a round without a year. Only the server's
-- year lookup is given it, and it can only fill a year that's still missing.
alter table public.round_secrets add column fill_token uuid;
revoke select on public.round_secrets from authenticated, anon;
grant select (round_id, spotify_track_id, title, artist, year, image_url) on public.round_secrets to authenticated;

-- Grades everyone who guessed against p_year. Shared by the host's fix and the server's fill.
create function public._apply_round_year(p_round uuid, p_year int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_room rooms;
  v_winner uuid;
begin
  if p_year is null or p_year not between 1900 and 2100 then raise exception 'bad year'; end if;
  select * into v_round from rounds where id = p_round;
  update round_secrets set year = p_year, fill_token = null where round_id = p_round;
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
revoke execute on function public._apply_round_year(uuid, int) from public, anon, authenticated;

create or replace function public.set_round_year(p_round uuid, p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_host((select room_id from rounds where id = p_round)) then
    raise exception 'only the host can change the year';
  end if;
  perform public._apply_round_year(p_round, p_year);
end $$;

-- Called by the site's server once its lookup finishes.
create function public.fill_round_year(p_round uuid, p_token uuid, p_year int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or not exists (
    select 1 from round_secrets where round_id = p_round and fill_token = p_token and year is null
  ) then
    return false;
  end if;
  perform public._apply_round_year(p_round, p_year);
  return true;
end $$;
grant execute on function public.fill_round_year(uuid, uuid, int) to anon, authenticated;

drop function public.open_round(uuid, text, text, text, int, text);
create function public.open_round(
  p_room uuid, p_spotify_track_id text, p_title text, p_artist text, p_year int, p_image_url text,
  p_fill_token uuid default null
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
  insert into round_secrets (round_id, spotify_track_id, title, artist, year, image_url, fill_token)
    values (v_round.id, p_spotify_track_id, p_title, p_artist, p_year, p_image_url, p_fill_token);
  update rooms set status = 'playing' where id = p_room and status = 'lobby';
  return v_round;
end $$;
