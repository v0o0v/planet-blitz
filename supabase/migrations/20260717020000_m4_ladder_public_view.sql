-- =============================================================================
-- Planet Blitz M4 — 순위표 공개 조회 RPC (Phase D 후속, 리드 정합 포인트 #1)
-- =============================================================================
-- 관제탑 순위표는 타인 display_name 이 필요하나 profiles RLS 는 본인 행만 select 이라
-- 클라가 profileId 앞자리로만 표시 중이었다. profiles 에 전면 select 정책을 여는 대신
-- (세이브 JSON·flagged 등 민감 컬럼 노출 위험), **순위표에 필요한 최소 컬럼만** 돌려주는
-- 페이지네이션 security definer RPC 로 좁혀 노출한다. display_name 은 게임 내 공개 핸들
-- 성격이라 순위표 노출은 설계상 허용 범위.
-- =============================================================================

create or replace function public.get_ladder_top(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  profile_id   uuid,
  rank         integer,
  display_name text,
  wins         integer,
  losses       integer,
  placed       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.profile_id, l.rank, p.display_name, l.wins, l.losses, l.placed
  from public.ladder l
  join public.profiles p on p.id = l.profile_id
  order by l.rank
  limit greatest(0, least(coalesce(p_limit, 50), 200))   -- 상한 200(과다 조회 방지)
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_ladder_top(integer, integer) from public;
revoke all on function public.get_ladder_top(integer, integer) from anon;
grant execute on function public.get_ladder_top(integer, integer) to authenticated, service_role;
