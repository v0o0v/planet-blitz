-- =============================================================================
-- 의뢰 확정 지급물 **배송** 레일 — 배송함 표시 + 설계도 축 서버 배선
-- =============================================================================
-- 계약 정본: `.omc/plans/commission-server-contract.md`. 발급 정본은 ADR-0045 이고
-- 발급 테이블(`commission_grants`)은 20260803000000_commission_ledger.sql 4절이 만든다.
-- 계약 테스트: `tests/commissionGrantDeliveryContract.test.ts` (이 파일 본문을 읽어 잠근다).
--
-- ▮ **이 마이그레이션이 고치는 공백**
--    `settle_commission` 은 확정 지급물을 `commission_grants` 에 **발급**하고 그 목록을
--    반환값 `grants` 에 담는다. 그 값은 EF → `commissionGateway` → `submitCommissionRun`
--    까지 이미 클라에 도달하는데, `main.ts` 의 `verified` 분기가 그것을 **아무 데도 쓰지
--    않고 버렸다**. 즉 발급은 되는데 배송이 없었다 — 증상이 "이겼는데 물건이 안 왔다"
--    하나뿐이라 전 게이트가 초록인 채로 지나간다(이 리포가 반복해서 겪은 형태).
--
-- ▮ **오늘은 잠재 결함이다.** 보상 생성기(`issue_commission_for_run`,
--    20260803030000_commission_segment_rebalance.sql:151)가 `rewards` 에 넣는 것은
--    `credits`·`minerals`·`items: []` 뿐이라 `uniqueId` 도 `blueprints` 도 없다 → 오늘
--    `commission_grants` 에는 단 한 행도 안 들어간다. **보상 생성기는 이 레인이 고치지
--    않는다**(보상 콘텐츠 저작 = 밸런스, 출시 직전 일괄 — defer-balance-tuning).
--    여기서 하는 것은 **레일을 세우는 것**이고 형식은 전방 호환으로 둔다.
--
-- ▮ **`settle_commission` 본문을 고치지 않는다.** 그 함수는 발급의 단일 정본이고,
--    낡은 본문 복제가 이 리포의 프로덕션을 100% 깨뜨린 전례가 있다(20260802000000:4-15).
--    필요한 것은 전부 **붙여서**(additive 컬럼 · AFTER 트리거 · 신설 RPC) 이룬다 —
--    20260803000000:14-16 이 같은 상황을 같은 방식으로 해결한 선례다.
--
-- ▮ **트리거 본문은 서브트랜잭션으로 감싼다.** 감싸지 않으면 이 경로의 예외 하나가
--    `settle_commission` 트랜잭션 전체를 롤백해 **전 플레이어가 재화를 못 받고 화면은
--    조용하다**(20260803000000:18-20, PR#222 와 동형). 설계도 지급 실패가 재화 정산을
--    끌고 내려가는 것은 어떤 환율로도 남는 장사가 아니다.
--
-- ▮ **`grant_blueprints` 를 재사용하지 않는다.** 계획 문서가 명시적으로 금지했다
--    (`.omc/plans/commission-server-contract.md:907`) — 그 함수는 `auth.uid()` 고정이라
--    service_role 경로에서 애초에 못 쓰고, sim 드랍 규칙("적힌 것만"이 아니다)을 의뢰에
--    끌어들인다. 여기서는 upsert 형상만 그 함수(20260722020000:82-85)에서 그대로 따온다.
--
-- 재실행 안전: add column if not exists · create index if not exists ·
--   create or replace function · drop trigger if exists → create.
--   security definer + set search_path = '' + public. 한정 + 끝에 revoke/grant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. commission_grants.applied_at — 배송 완료 표시(additive)
-- -----------------------------------------------------------------------------
-- 발급(`granted_at`)과 배송(`applied_at`)은 **다른 사건**이다. 발급은 서버가 원장에 적은
-- 순간이고, 배송은 플레이어의 세이브에 물건이 실제로 들어간 순간이다. 둘을 한 컬럼으로
-- 뭉치면 "발급됐는데 아직 안 받은" 상태 — 정확히 이 레인이 닫으려는 상태 — 를 표현할
-- 자리가 없어진다.
--
-- ⚠️ **nullable 이어야 한다.** 기존 행(이미 발급된 것)은 배송 여부를 알 수 없으므로 null
--    로 남아 다음 부팅의 재시도 대상이 된다. `hasItemId`(src/save/itemPresence.ts)가 세이브
--    전수를 훑어 멱등을 지키므로, 실제로 이미 들고 있으면 두 번 심기지 않는다.
alter table public.commission_grants
  add column if not exists applied_at timestamptz null;

-- 미배송 행 조회가 풀스캔이 되지 않게 하는 부분 인덱스. 원장은 TTL 대상이 아니라
-- (20260803000000:178-179) 전체는 단조 증가하지만 미배송 행은 항상 소수이므로 부분
-- 인덱스가 정확히 맞는 도구다(daily_reward_claims_pending_idx 와 같은 형상).
create index if not exists commission_grants_pending_idx
  on public.commission_grants (profile_id)
  where applied_at is null;

comment on column public.commission_grants.applied_at is
  '배송 완료 시각(null = 미배송, 다음 부팅 재시도 대상). 발급(granted_at)과 다른 사건이다 — 설계도 축은 2절 트리거가, 유니크 축은 클라가 mark_commission_grant_applied 로 찍는다.';

-- -----------------------------------------------------------------------------
-- 2. 설계도 축 — commission_grants AFTER INSERT 트리거 (클라 개입 0)
-- -----------------------------------------------------------------------------
-- 왜 설계도만 서버가 배송하는가: `defense_blueprints` 는 **서버 테이블**이라 서버가 직접
-- 넣을 수 있다. 반면 유니크 축이 들어갈 `items` 는 클라 rw 미러이고 클라가 그 테이블에
-- 한 줄도 쓰지 않으므로(`src/**` 에 `.from('items')` 0건) 서버가 심을 자리 자체가 없다 —
-- 그래서 두 축의 배송 주체가 갈린다. 이 비대칭은 결함이 아니라 저장 위치의 결과다.
--
-- ▮ **인식하는 형태는 하나다** — `item_payload->'blueprintId'` 가
--   `{"kind":0..3,"catalogId":>=0,"count":1..4}` object 일 때만 지급한다.
--   현행 `settle_commission` 은 `payload.rewards.blueprints` 의 원소를 그대로 감싸므로
--   (`jsonb_build_object('blueprintId', v_bps->i)`), 보상 생성기가 스칼라를 넣으면 여기
--   `blueprintId` 도 스칼라가 된다. 그 경우 **조용히 버리지 않고 warning 을 남기고 건너뛴다** —
--   `applied_at` 도 안 찍으므로 그 행은 미배송으로 남아 관측에 보인다.
--   TS 미러: `CommissionRewards.blueprints`(src/run/commission.ts) 가 이 형태로 좁혀져 있다.
--
-- ▮ 범위 검증(kind 0..3 · count 1..4)은 `grant_blueprints`(20260722020000:71-77)와 **같은
--   범위**를 쓴다. 다른 범위를 쓰면 같은 자산에 두 개의 유효성 정의가 생긴다.
--
-- ▮ 성공 시 `applied_at` 을 **여기서 찍는다.** 설계도는 서버가 배송을 끝냈으므로 그 행을
--   미배송으로 남기면 부분 인덱스가 영영 안 비고, 클라 배송 루틴이 자기가 처리할 수 없는
--   행을 매 부팅 다시 읽는다. 이 UPDATE 는 같은 테이블이지만 트리거가 **INSERT 전용**이라
--   재귀하지 않는다.
create or replace function public.trg_commission_grant_blueprint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bp      jsonb;
  v_kind    smallint;
  v_catalog integer;
  v_count   integer;
begin
  if new.kind <> 'blueprint' then
    return null;
  end if;
  begin
    v_bp := new.item_payload->'blueprintId';
    if v_bp is null or jsonb_typeof(v_bp) <> 'object' then
      -- 현행 보상 생성기가 이 축을 안 채우므로 **오늘의 정상 경로**다. 형식이 굳으면
      -- 여기 warning 이 사라진다. 조용히 넘기면 "설계도가 안 온다"의 단서가 0이 된다.
      raise warning 'trg_commission_grant_blueprint: blueprintId 가 object 가 아니다(grant_id=%): %',
        new.grant_id, coalesce(v_bp::text, 'null');
      return null;
    end if;
    v_kind    := coalesce((v_bp->>'kind')::smallint, -1);
    v_catalog := coalesce((v_bp->>'catalogId')::integer, -1);
    v_count   := coalesce((v_bp->>'count')::integer, 0);
    if v_kind < 0 or v_kind > 3 or v_catalog < 0 then
      raise warning 'trg_commission_grant_blueprint: 카탈로그 범위 밖(grant_id=%, kind=%, catalogId=%)',
        new.grant_id, v_kind, v_catalog;
      return null;
    end if;
    if v_count < 1 or v_count > 4 then
      raise warning 'trg_commission_grant_blueprint: 장수 범위 밖(grant_id=%, count=%)',
        new.grant_id, v_count;
      return null;
    end if;

    insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
      values (new.profile_id, v_kind, v_catalog, v_count)
      on conflict (profile_id, kind, catalog_id)
      do update set count = public.defense_blueprints.count + excluded.count;

    update public.commission_grants
       set applied_at = now()
     where grant_id = new.grant_id and applied_at is null;
  exception when others then
    -- 서브트랜잭션만 롤백한다. 바깥 `settle_commission`(재화 지급·런 종결)은 커밋된다.
    -- **fail-open**: 설계도 한 건이 안 들어가는 것이 전 플레이어의 재화 정산이 통째로
    -- 롤백되는 것보다 압도적으로 싸다. `applied_at` 이 안 찍히므로 유실이 아니라 **보류**로
    -- 남고, 형식이 굳는 날 재처리할 수 있다. 관측은 warning 발생률로 한다.
    raise warning 'trg_commission_grant_blueprint 실패(grant_id=%): %', new.grant_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_commission_grants_blueprint on public.commission_grants;
create trigger trg_commission_grants_blueprint
  after insert on public.commission_grants
  for each row
  when (new.kind = 'blueprint')
  execute function public.trg_commission_grant_blueprint();

comment on function public.trg_commission_grant_blueprint() is
  '의뢰 확정 설계도 배송(commission_grants AFTER INSERT). item_payload->blueprintId 가 {kind,catalogId,count} object 일 때만 defense_blueprints 에 upsert 하고 applied_at 을 찍는다. 서브트랜잭션 fail-open.';

-- -----------------------------------------------------------------------------
-- 3. mark_commission_grant_applied — 유니크 축 배송 완료 통지 (authenticated)
-- -----------------------------------------------------------------------------
-- 이쪽은 클라가 부르는 것이 맞다 — 세이브에 물건이 들어갔다는 사실은 클라만 안다.
-- 형식 정본: 20260805000000_daily_reward.sql 8절 `mark_daily_reward_applied`.
--
-- ⚠️ **위조 이득이 없는 이유:** 수령자를 파라미터로 받지 않고 `auth.uid()` 로 고정하며,
--    `applied_at is null` 인 **본인의 기존 행만** 갱신한다. 남의 grant_id 를 밀어 넣어도
--    where 절이 0행을 잡는다. 그리고 이 표시가 하는 일은 "다시 주지 마라"뿐이라,
--    위조가 이룰 수 있는 최선이 **자기 물건을 스스로 포기하는 것**이다.
--
-- ⚠️ 호출 순서 계약(클라 책임, 여기서 강제할 수 없다):
--      세이브 반영 → 서버 프로필 push 성공 → 재-pull 로 아이템 존재 확인 → **그 뒤에** mark.
--    push 전에 mark 하면 `chooseProfile` 의 통짜 선택(src/net/profileSync.ts:121-134 —
--    `progressScore` 는 기체 레벨 1 = 1000점이라 아이템 48개 차이도 진다)이 그 아이템을
--    버릴 수 있는데 행은 이미 mark 돼 재시도되지 않는다 → **영구 유실**이다.
create or replace function public.mark_commission_grant_applied(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_n  int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'no-auth');
  end if;
  if p_grant_id is null then
    return jsonb_build_object('ok', false, 'code', 'no-grant');
  end if;
  update public.commission_grants
     set applied_at = now()
   where grant_id = p_grant_id and profile_id = v_me and applied_at is null;
  get diagnostics v_n = row_count;
  -- `updated = 0` 은 오류가 아니다 — 이미 찍혔거나(멱등 재시도) 남의 행이다. 둘 다 클라가
  -- 할 일이 없으므로 ok 로 돌려준다.
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- ⚠️ Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 자동 부여한다. anon 회수가 빠지면
--    로그인 없는 호출이 PUBLIC 을 통해 도달한다(본문의 auth.uid() null 가드가 2겹째다).
revoke all on function public.mark_commission_grant_applied(uuid) from public;
revoke all on function public.mark_commission_grant_applied(uuid) from anon;
grant execute on function public.mark_commission_grant_applied(uuid) to authenticated, service_role;

comment on function public.mark_commission_grant_applied(uuid) is
  '의뢰 확정 유니크 배송 완료 통지. auth.uid() 고정 + 본인의 미배송 행만 갱신하므로 grant_id 를 받아도 위조 이득이 없다. 호출은 반드시 프로필 push·재-pull 확인 뒤에.';
