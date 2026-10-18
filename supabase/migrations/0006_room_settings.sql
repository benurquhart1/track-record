-- Track Record v6: host settings during a game (cards to win, skip to the next song when
-- everyone has guessed). Run once in the Supabase SQL editor, after 0005.

alter table public.rooms add column auto_next boolean not null default false;

-- p_target_cards null = no card limit.
create function public.update_room_settings(p_room uuid, p_target_cards int, p_auto_next boolean) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_room rooms;
begin
  if not public.is_host(p_room) then raise exception 'only the host can change settings'; end if;
  update rooms
    set target_cards = case when p_target_cards is not null then greatest(2, least(p_target_cards, 100)) end,
        auto_next = coalesce(p_auto_next, auto_next)
    where id = p_room
    returning * into v_room;
  return v_room;
end $$;
