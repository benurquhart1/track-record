-- Plays a short game as host + two players and checks scoring and secrecy.
\set ON_ERROR_STOP on
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as room, code from create_room(3, 3) \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select id as alice from join_room(:'code', 'Alice') \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select id as bob from join_room(:'code', 'Bob') \gset

-- Starting cards: three each, distinct, 1950-2022, and Bob's don't repeat Alice's.
reset role;
select count(*) = 6 and count(distinct year) = 6 and min(year) >= 1950 and max(year) <= 2022 as ok_start
  from timeline_cards where room_id = :'room' \gset
\if :ok_start \else \echo 'FAIL: starting cards' \quit \endif

-- Pin one starting card each so the test is deterministic.
delete from timeline_cards where player_id in (:'alice', :'bob');
insert into timeline_cards (room_id, player_id, year, title)
  values (:'room', :'alice', 1990, 'Starting card'), (:'room', :'bob', 1990, 'Starting card');
set role authenticated;

-- Round 1: song from 1985. Alice says "before 1990" (slot 0) and sees it right away.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r1 from open_round(:'room', 'trk1', 'Song A', 'Artist', 1985, null) \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select count(*) as bob_sees_secret from round_secrets where round_id = :'r1' \gset
\if :bob_sees_secret
  \echo 'FAIL: player can read the answer before guessing' \quit
\endif

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select is_correct as a1, upper_year = 1990 and lower_year is null as a1_bounds from submit_answer(:'r1', 0) \gset
\if :a1 \else \echo 'FAIL: Alice should be correct' \quit \endif
\if :a1_bounds \else \echo 'FAIL: Alice bounds' \quit \endif
select count(*) as alice_sees_secret from round_secrets where round_id = :'r1' \gset
\if :alice_sees_secret \else \echo 'FAIL: Alice should see the song after guessing' \quit \endif

-- A second guess is refused.
do $$ begin
  perform submit_answer((select id from rounds where number = 1), 1);
  raise exception 'FAIL: guessed twice';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Bob can't see Alice's new card (it would give the year away) until the round closes.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select count(*) as bob_sees_card from timeline_cards where round_id = :'r1' \gset
\if :bob_sees_card \echo 'FAIL: open-round card leaked' \quit \endif
select is_correct as b1 from submit_answer(:'r1', 1) \gset
\if :b1 \echo 'FAIL: Bob should be wrong' \quit \endif

-- A player can't reveal.
do $$ begin
  perform close_round((select id from rounds where number = 1));
  raise exception 'FAIL: player closed a round';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Round 2: Alice and Bob both put it after 1990, then the host fixes the year to 1987.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r2 from open_round(:'room', 'trk2', 'Song B', 'Artist', 2001, null) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r2', 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select submit_answer(:'r2', 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select (select count(*) from timeline_cards where round_id = :'r2') = 2 as ok_r2 \gset
\if :ok_r2 \else \echo 'FAIL: round 2 cards before fix' \quit \endif
select set_round_year(:'r2', 1987);
-- Alice had 1985 < x < 1990? No: she picked slot 2 (after 1990), so she's now wrong. Bob too.
select (select count(*) from timeline_cards where round_id = :'r2') = 0 as ok_fix \gset
\if :ok_fix \else \echo 'FAIL: regrade after year fix' \quit \endif
select close_round(:'r2');

-- Round 3: 2010, both answer "after everything"; target is 3 so Alice (3 cards) wins.
select id as r3 from open_round(:'room', 'trk3', 'Song C', 'Artist', 2010, null) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r3', 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select submit_answer(:'r3', 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select close_round(:'r3');
select status = 'finished' and winner_player_id = :'alice' as ok_win from rooms where id = :'room' \gset
\if :ok_win \else \echo 'FAIL: winner' \quit \endif

-- Unlimited game: never finishes on its own; end_game picks the leader.
select id as room2, code as code2 from create_room(null, 2) \gset
select target_cards is null as ok_unl from rooms where id = :'room2' \gset
\if :ok_unl \else \echo 'FAIL: unlimited target' \quit \endif
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select id as alice2 from join_room(:'code2', 'Alice') \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r4 from open_round(:'room2', 'trk4', 'Song D', 'Artist', 2030, null) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r4', 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select close_round(:'r4');
select status = 'playing' as ok_still from rooms where id = :'room2' \gset
\if :ok_still \else \echo 'FAIL: unlimited game ended early' \quit \endif
select end_game(:'room2');
select status = 'finished' and winner_player_id = :'alice2' as ok_end from rooms where id = :'room2' \gset
\if :ok_end \else \echo 'FAIL: end_game' \quit \endif

-- Year not known yet: the guess waits ungraded, then is graded when the host sets the year.
select id as room3, code as code3 from create_room(null, 1) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select id as alice3 from join_room(:'code3', 'Alice') \gset
reset role;
update timeline_cards set year = 1990 where player_id = :'alice3';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r5 from open_round(:'room3', 'trk5', 'Song E', 'Artist', null, null) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select is_correct is null as ok_pending from submit_answer(:'r5', 0) \gset
\if :ok_pending \else \echo 'FAIL: guess graded before the year was known' \quit \endif
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select set_round_year(:'r5', 1980);
select (select is_correct from answers where round_id = :'r5') and
       (select count(*) from timeline_cards where round_id = :'r5') = 1 as ok_graded \gset
\if :ok_graded \else \echo 'FAIL: pending guess not graded' \quit \endif

-- The server fills a missing year with the round's token; a wrong token or a second fill is refused.
select id as r6 from open_round(:'room3', 'trk6', 'Song F', 'Artist', null, null, '11111111-1111-1111-1111-111111111111') \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r6', 0);
reset role;
set role anon;
select not fill_round_year(:'r6', '22222222-2222-2222-2222-222222222222', 1950) as ok_badtoken \gset
\if :ok_badtoken \else \echo 'FAIL: wrong token filled the year' \quit \endif
select fill_round_year(:'r6', '11111111-1111-1111-1111-111111111111', 1970) as ok_fill \gset
\if :ok_fill \else \echo 'FAIL: fill refused' \quit \endif
select not fill_round_year(:'r6', '11111111-1111-1111-1111-111111111111', 1999) as ok_once \gset
\if :ok_once \else \echo 'FAIL: filled twice' \quit \endif
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select is_correct and (select year from round_secrets where round_id = :'r6') = 1970 as ok_r6 from answers where round_id = :'r6' \gset
\if :ok_r6 \else \echo 'FAIL: filled year not graded' \quit \endif
do $$ begin
  perform fill_token from round_secrets limit 1;
  raise exception 'FAIL: token readable';
exception when insufficient_privilege then null;
end $$;

select * from alltime_leaderboard order by wins desc;
\echo 'ALL TESTS PASSED'
