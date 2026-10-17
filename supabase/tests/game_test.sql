-- Plays a short game as host + two players and checks scoring and secrecy.
\set ON_ERROR_STOP on
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as room, code from create_room(3) \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select id as alice from join_room(:'code', 'Alice') \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select id as bob from join_room(:'code', 'Bob') \gset

-- Pin starting cards so the test is deterministic.
reset role;
update timeline_cards set year = 1990 where player_id in (:'alice', :'bob');
set role authenticated;

-- Round 1: song from 1985. Alice says "before 1990" (slot 0), Bob says "after" (slot 1).
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r1 from open_round(:'room', 'trk1', 'Song A', 'Artist', 1985, null) \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r1', 0);
select count(*) as alice_sees_secret from round_secrets where round_id = :'r1' \gset
\if :alice_sees_secret
  \echo 'FAIL: player can read the answer before reveal' \quit
\endif
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select submit_answer(:'r1', 1);

-- A player can't reveal.
do $$ begin
  perform close_round((select id from rounds where number = 1));
  raise exception 'FAIL: player closed a round';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

-- Round 2 starting closes round 1 automatically.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as r2 from open_round(:'room', 'trk2', 'Song B', 'Artist', 2001, null) \gset
select (select is_correct from answers where round_id = :'r1' and player_id = :'alice') as a1,
       (select is_correct from answers where round_id = :'r1' and player_id = :'bob') as b1 \gset
\if :a1 \else \echo 'FAIL: Alice should be correct' \quit \endif
\if :b1 \echo 'FAIL: Bob should be wrong' \quit \endif

-- Host corrects round 2's year to 1995; Alice puts it between 1985 and 1990 (wrong), Bob after 1990 (right).
select set_round_year(:'r2', 1995);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r2', 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select submit_answer(:'r2', 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select close_round(:'r2');

select (select count(*) from timeline_cards where player_id = :'alice') = 2 as ok_a,
       (select count(*) from timeline_cards where player_id = :'bob') = 2 as ok_b \gset
\if :ok_a \else \echo 'FAIL: Alice card count' \quit \endif
\if :ok_b \else \echo 'FAIL: Bob card count' \quit \endif

-- Round 3: 2010, both answer "after everything"; target is 3 so Alice (joined first) wins the tie.
select id as r3 from open_round(:'room', 'trk3', 'Song C', 'Artist', 2010, null) \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select submit_answer(:'r3', 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select submit_answer(:'r3', 2);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select close_round(:'r3');
select status = 'finished' and winner_player_id = :'alice' as ok_win from rooms where id = :'room' \gset
\if :ok_win \else \echo 'FAIL: winner' \quit \endif

select * from alltime_leaderboard order by wins desc;
\echo 'ALL TESTS PASSED'
