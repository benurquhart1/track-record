-- Track Record v5: everyone in a room can see who has locked in a guess for the current song
-- (not what they guessed). Run once in the Supabase SQL editor, after 0004.

create function public.locked_in(p_round uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.player_id from answers a join rounds r on r.id = a.round_id
  where a.round_id = p_round
    and (public.is_host(r.room_id)
         or exists (select 1 from players p where p.room_id = r.room_id and p.uid = auth.uid()));
$$;
grant execute on function public.locked_in(uuid) to authenticated;
