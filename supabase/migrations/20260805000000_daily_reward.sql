-- =============================================================================
-- 일일 보상 — 수령 원장 · 상한 앵커 · 봉인 · 수령 RPC (ADR-0048)
-- =============================================================================
-- 계약 정본: `.omc/plans/daily-reward-implementation.md` (Critic 2차 반영본).
-- 결정 문서: ADR-0048. 스펙: `.omc/specs/deep-interview-daily-reward-gaps.md` (AC 26개).
-- 계약 테스트: `tests/dailyRewardContract.test.ts` (이 파일의 본문을 읽어 잠근다).
--
-- 이 마이그레이션이 만드는 것:
--   1. profiles 컬럼 3종 — daily_last_claim_seed · daily_streak · lifetime_granted(+ 1회 백필)
--   2. 봉인 개정 — guard_profiles_client_write 9→12 · guard_profiles_client_insert 3→6
--   3. daily_reward_claims — 수령 원장 겸 장비 배송함(TTL 대상 아님)
--   4. currency_grants AFTER INSERT 트리거 → lifetime_granted 가산(상한 앵커)
--   5. daily_reward_preview_for / claim_daily_reward_for — service_role 전용
--   6. mark_daily_reward_applied / mark_daily_reward_hold — authenticated(반영 완료 통지)
--   7. grant_currency_for 개정 — source 'daily_reward' per-call 캡 등록(9절, 사용자 확정)
--
-- ▮ **`settle_pve_run` 본문을 고치지 않는다.** 그 함수는 5회 재정의됐고 그 복제가 이미 PvE
--    정산을 100% 깨뜨렸다(20260802000000:4-15). 상한 앵커는 AFTER 트리거로 **붙인다** —
--    발령이 같은 상황을 같은 방식으로 해결한 선례를 그대로 쓴다(20260803000000:14-16).
--    ⚠️ `grant_currency_for` 는 **예외적으로 재정의한다**(9절). 계획은 그것도 금지했으나
--    금지가 겨눈 위험(낡은 본문 복제)과 실제로 필요한 일(현행 본문 그대로 + case 한 갈래)이
--    다르고, 등록하지 않으면 재화 축 지급이 CAP_DEFAULT 1000 에 **조용히 절삭**돼 슬라이스 1
--    의 제품이 통째로 죽는다. 근거와 위험 관리는 9절 머리에 있다.
--
-- ▮ **트리거 본문은 서브트랜잭션으로 감싼다.** 감싸지 않으면 이 경로의 예외가 정산 트랜잭션
--    전체를 롤백해 **전 플레이어가 자원을 못 받고 화면은 조용하다**(20260803000000:18-20,
--    PR#222 와 동형). 이 트리거는 currency_grants 의 **모든** insert 에서 발동하므로 —
--    PvE 정산·의뢰·분해·스토리 전부 — 노출면이 리포에서 가장 넓다.
--
-- ▮ **앵커 자기참조 되먹임 차단(하중 부재).** 트리거는 `when (new.source <> 'daily_reward')`
--    로 제한한다. 필터가 없으면 일일 보상이 지급한 크레딧이 자기 상한을 밀어 올려, 플레이 0
--    계정도 접속만으로 천장이 단조 상승한다. 그러면 ADR-0048 의 **유일한 정당화**
--    (*"위조해도 정직한 플레이로 이미 닿는 범위 안"*)가 무너지고 30일 봇 접속이 상한 자체를
--    키우는 경로가 열린다. 계약 테스트가 이 필터의 **존재**를 단언한다 — 조용히 빠지는 것이
--    이 결함의 재발 경로다.
--
-- ▮ **`date_seed` 를 파라미터로 받지 않는다.** 본문이 서버 시각으로 계산한다. 받으면 복합 PK
--    가 서로 다른 seed 를 안 막아 **하루에 여러 번 수령**이 열린다. 계약 테스트가 *"본문에
--    p_date_seed 파라미터가 없다"* 를 단언한다. (선례: modules/index.ts:107 이 클라 dateSeed 를
--    불신하고 서버 시각으로 계산한다.)
--
-- ▮ **authenticated 래퍼를 만들지 않는다.** grant_currency 2단 구조를 베끼지 않는 이유는
--    그쪽엔 클라가 직접 부르는 경로가 실재해서 래퍼가 필요했기 때문이다. 여기는 수령이
--    **EF 전용**이다 — EF 가 미러를 읽어 후보를 만들고 rollItem 을 돌려야 하므로 클라가 부를
--    수 있는 형태가 아니다. 래퍼를 만들면 쓰지도 않는 **순공격면**이 된다.
--    `prove-daily-reward-seal.ps1` 의 `[OK] RPC_DENIED_AUTHENTICATED` 가 이것을 실증한다.
--
-- ▮ 잠금 순서(ABBA 데드락 — 위반은 단위 테스트·1바퀴 플레이·육안 무엇으로도 안 잡힌다):
--    **한 호출에 등장하는 인벤토리는 최대 1개다.** 하루치는 주 보상 1개 + 곁들이 크레딧이라
--    5개를 동시에 잠글 이유가 애초에 없다. 슬라이스 1(재화 축)은 인벤토리를 아예 잠그지
--    않는다 — `grant_currency_for` 안의 `profiles for update` 하나뿐이다(20260803000000:308).
--    슬라이스 2 에서 축을 늘릴 때 지켜야 할 계약:
--      · 촉매 축   — `catalyst_inventory → profiles`. grant 호출은 인벤토리 잠금 **뒤**.
--                    앞에서 부르면 buy_catalyst 와 정확히 반대가 되어 진짜 ABBA 가 열린다.
--      · 코어 모듈 — 기존 행을 `for update` 로 **잠그지 않는다**(신규 insert 전용). 이 축은
--                    리포 내부에 두 방향이 공존한다(salvage_core_module 은 core_modules→profiles,
--                    apply_module_purchase 는 profiles 먼저) — 따를 단일 관례가 없으므로
--                    잠그지 않는 것이 유일하게 안전한 선택이다.
--    ⚠️ 계약 단언은 `for update` 문자열만 본다 — `insert ... on conflict do update` 로 잠기는
--    행과 **다른 함수 본문의** `for update` 는 시야 밖이다. 그래서 계약 테스트가 호출되는
--    함수(`grant_currency_for`) 본문까지 훑는다.
--
-- ▮ 상수 미러(TS 정본과 함께 갱신할 것 — 계약 테스트가 불일치를 잡는다):
--      DAILY_STREAK_CYCLE = 30            ↔ data/dailyReward.ts DAILY_STREAK_CYCLE
--      DAILY_BUDGET_DAY_1 = 2000          ↔ data/dailyReward.ts DAILY_BUDGET_DAY_1
--      DAILY_BUDGET_DAY_30 = 20000        ↔ data/dailyReward.ts DAILY_BUDGET_DAY_30
--      DAILY_CEILING_RATE = 0.02          ↔ data/dailyReward.ts DAILY_CEILING_RATE
--      DAILY_BUDGET_FLOOR = DAILY_BUDGET_DAY_1  ↔ data/dailyReward.ts DAILY_BUDGET_FLOOR
--      MINERAL_TO_CREDIT = 8              ↔ data/dailyRewardSelection.ts MINERAL_TO_CREDIT
--      DAILY_SIDE_CREDITS = 500           ↔ data/dailyReward.ts DAILY_SIDE_CREDITS
--      CAP_DAILY_REWARD_CREDITS = 25000   ↔ (SQL 단독 — 9절. TS 짝이 없으므로 계약 테스트는
--                                            값이 아니라 `> DAILY_BUDGET_DAY_30` 부등식으로 잠근다)
--    전부 `// BALANCE — 출시 전 일괄 튜닝` 대상이다(defer-balance-tuning).
--    ⚠️ `MINERAL_TO_CREDIT` 는 **가치 환산표와 같은 값이어야 한다.** 앵커가 세는 단위와
--    보상 가치를 재는 단위가 갈리면 "지금까지 받은 만큼에서 파생된 천장"이라는 문장이
--    두 개의 서로 다른 '만큼'을 뜻하게 된다. 계약 테스트가 두 값을 대조한다.
--
-- 재실행 안전: add column if not exists · create table if not exists ·
--   create or replace function · drop policy if exists → create · drop trigger if exists →
--   create · 백필은 `where lifetime_granted = 0` 가드(재적용이 이미 자란 값을 낮추지 않는다).
--   security definer + set search_path='' + public. 한정 + 끝에 revoke/grant.
--   ⚠️ search_path='' 함수에서 임시 테이블 금지(pg_temp 가 검색 경로에 없다 — 리포 실측 규율).
--
-- 롤백: `scripts/rollback-daily-reward-migration.ps1`. ⚠️ 봉인 함수 2개는 `create or replace`
--   라 되돌리려면 이전 정의를 다시 적어야 하는데, **손으로 옮겨 적는 것이 정확히
--   20260802000000:4-15 가 프로덕션을 100% 깨뜨린 형상**이다. 그래서 롤백 스크립트는
--   20260731000000_catalyst_shop.sql 에서 해당 블록을 **잘라 실행**한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles 컬럼 3종 — 연속 접속 정본 2개 + 상한 앵커 1개
-- -----------------------------------------------------------------------------
-- 연속일을 수령 원장에서 **세어 파생하지 않는다**(ADR-0048 §왜 연속일을 원장에서 파생하지
-- 않는가). 연속 판정에 필요한 것은 *"직전 수령이 오늘−1 인가"* 하나뿐이라 30일치를 스캔할
-- 이유가 없고, 파생으로 두면 원장 스캔이 연속일 읽기의 핫 경로가 된다.
--
-- ⚠️ `daily_last_claim_seed` 의 "미수령" 표현이 **0** 인 이유(-1 이 아니다): 아래 3절의
--    guard_profiles_client_insert 는 `new.X := 0;` 열거식이고 계약 테스트가 그 **정규식과
--    총수**를 단언한다. 컬럼 하나만 `:= -1` 로 두면 그 컬럼이 계약의 시야 밖으로 빠져
--    **봉인이 있다고 세면서 실제로는 세지 않는** 상태가 된다. 0 을 써도 안전한 것은
--    연속 판정이 `now_seed - prev_seed = 1` 만 보기 때문이다 — prev=0 은 어떤 현실적
--    now_seed 에 대해서도 "끊김"이라 streak 1 로 떨어진다. 유일한 겹침은 1970-01-02 수령이며
--    그것은 서버 시계가 epoch 에 있다는 뜻이다. TS 미러: data/dailyReward.ts DAILY_SEED_NEVER.
alter table public.profiles
  add column if not exists daily_last_claim_seed bigint not null default 0;
alter table public.profiles
  add column if not exists daily_streak int not null default 0 check (daily_streak >= 0);

-- 상한 앵커 — **서버가 실제로 지급한 금액의 단조 누적**.
--
-- ⚠️ ADR 초판이 적었던 *"pve_runs 의 검증된 최고 클리어 단계"* 는 **틀린 서술이었다**:
--    pve_runs 에 stage 컬럼이 없고(20260718000000:31-42), stage 는 클라가 채운 summary jsonb
--    안에 있으며(20260726000200:254·:265), verified_status 는 'verified' 를 **무조건 리터럴로
--    찍고**(:302), PvE 재검증 자체가 철거됐다(20260726000300, ADR-0026). 즉 그 값은
--    profiles.save 와 같은 등급의 클라 주장이라 상한의 축이 될 수 없었다.
--
-- currency_grants 를 직접 합산할 수도 없다 — **7일 GC** 다(20260726000200:11). 7일 창만 보면
-- "휴가 다녀오면 상한이 떨어진다"가 되어 30일 램프와 정면 충돌한다. 그래서 단조 누적 컬럼을
-- 신설하고 AFTER 트리거가 가산한다(5절).
alter table public.profiles
  add column if not exists lifetime_granted numeric not null default 0 check (lifetime_granted >= 0);

-- ▮ **1회 백필 — 이것이 없으면 출시 순간 전 유저가 FLOOR 천장에서 시작하고 되돌릴 수 없다.**
--
-- 컬럼을 default 0 으로 신설하고 트리거가 앞으로의 지급만 가산하면, 300시간 플레이한 베테랑도
-- 마이그레이션 직후 lifetime_granted = 0 이라 **신규 봇과 동일한 상한**을 받는다. 그리고 백필
-- 소스가 이미 소멸했다 — currency_grants 도 pve_runs 도 7일 GC 다. 결과는 ADR-0048
-- §왜 "상한으로 유계"인가의 *"서버가 이미 준 만큼에서 파생된 천장"* 이 **모든 기존 유저에게
-- 거짓**이 되고, 30일 램프가 FLOOR 절삭에 전원 걸려 **아무에게도 보이지 않는 장치**가 되는 것이다.
--
-- 백필 소스로 `profiles.credits + minerals` 를 쓰는 근거: **현재 잔액은 생애 누적의 엄밀한
-- 하한이다.** 두 컬럼은 클라 UPDATE 가 트리거로 봉인되고(2절) INSERT 는 0 으로 강제되므로
-- (3절), 유입이 서버 지급뿐이고 유출이 소비뿐이다 → `현재 잔액 ≤ 생애 누적`.
-- ⚠️ 대안으로 검토한 *"profiles.save 의 기체 레벨 합"* 은 **기각했다** — 위조 가능 입력을
--    앵커에 1회라도 주입하면 ADR 의 *"상한은 서버 권위 상태에서만 파생"* 이 문자 그대로
--    깨진다. 잔액 하한은 그 문장을 한 뼘도 넓히지 않고 같은 목적을 이룬다.
-- 자인: **많이 쓴 유저가 과소평가된다.** 7일 창 currency_grants 합과의 greatest 로 일부만
--    보정되며, 그 유저는 다음 며칠의 플레이로 앵커를 회복한다.
--
-- `where lifetime_granted = 0` 가드가 재적용 안전을 만든다 — 재실행이 이미 자란 값을 낮추면
-- 앵커의 단조성이 깨진다.
do $$
declare
  MINERAL_TO_CREDIT constant numeric := 8;  -- BALANCE — data/dailyRewardSelection.ts 와 같은 값.
begin
  update public.profiles p
     set lifetime_granted = greatest(
           coalesce(p.credits, 0) + coalesce(p.minerals, 0) * MINERAL_TO_CREDIT,
           coalesce((
             select sum(g.credits + g.minerals * MINERAL_TO_CREDIT)
               from public.currency_grants g
              where g.profile_id = p.id
           ), 0)
         )
   where p.lifetime_granted = 0;
end;
$$;

comment on column public.profiles.daily_last_claim_seed is
  '일일 보상 직전 수령 date_seed(0 = 미수령). 연속 판정의 유일한 입력 — 원장을 스캔하지 않는다.';
comment on column public.profiles.daily_streak is
  '일일 보상 연속 접속일(0 = 미수령, 1..30). 끊기면 1 로 전멸 리셋(ADR-0048).';
comment on column public.profiles.lifetime_granted is
  '서버가 지급한 재화의 생애 단조 누적(크레딧 환산). 일일 보상 예산 천장의 앵커 — 일일 보상 자신의 지급은 산입되지 않는다(source 필터).';

-- -----------------------------------------------------------------------------
-- 2. guard_profiles_client_write 개정 — 클라 UPDATE 봉인 9 → 12
-- -----------------------------------------------------------------------------
-- ⚠️ **현행 정의(20260731000000_catalyst_shop.sql:109-128)에서 복사했다.** 낡은 정의
--    (20260726000000, 봉인 8개)를 베끼면 `catalyst_residue` 봉인이 사라져 **잔재 무한 구매**가
--    열린다 — 낡은 본문 복제가 프로덕션을 100% 깨뜨린 전례와 동형이다(20260802000000:4-15).
--    기존 9개(flagged·is_npc·lineage 4종·credits·minerals·catalyst_residue)를 **전수 보존**하고
--    신규 3개만 더한다.
--
-- 연속일이 클라 쓰기 가능하면 30일차를 스스로 세울 수 있고, 그것은 램프 전체를 무력화한다.
-- lifetime_granted 가 클라 쓰기 가능하면 상한 유계 — 이 설계의 **유일한 안전장치** — 가
-- 통째로 사라진다. 재화 봉인은 RLS 가 아니라 이 컬럼 열거식 트리거이므로, 컬럼을 추가하면서
-- 여기를 안 고치면 클라가 PostgREST 직타로 임의 값을 쓴다.
-- 계약 테스트가 대입 **총수 12** 와 그 집합을 단언한다.
create or replace function public.guard_profiles_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.flagged := old.flagged;
    new.is_npc := old.is_npc;  -- Phase E: NPC 마커 위장 차단(20260717080000). M5 재정의에서도 유지.
    new.lineage_points := old.lineage_points;
    new.lineage_ship_level := old.lineage_ship_level;
    new.lineage_guardian_level := old.lineage_guardian_level;
    new.lineage_last_retired_at := old.lineage_last_retired_at;
    new.credits := old.credits;      -- ADR-0027: 재화 서버 권위(클라 UPDATE 봉인).
    new.minerals := old.minerals;    -- 소비/가산은 security definer RPC 만.
    new.catalyst_residue := old.catalyst_residue;  -- ADR-0042: 촉매 잔재도 서버 권위(RPC 만 write).
    new.daily_last_claim_seed := old.daily_last_claim_seed;  -- ADR-0048: 하루 여러 번 수령 차단.
    new.daily_streak := old.daily_streak;            -- ADR-0048: 30일차를 스스로 세우는 것 차단.
    new.lifetime_granted := old.lifetime_granted;    -- ADR-0048: 상한 유계의 앵커(유일한 안전장치).
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard, before update)는 초기 스키마에서 이미 정의됨 — 함수 교체로 반영.

-- -----------------------------------------------------------------------------
-- 3. guard_profiles_client_insert 개정 — 클라 INSERT 0 강제 3 → 6
-- -----------------------------------------------------------------------------
-- ⚠️ **현행 정의(20260731000000_catalyst_shop.sql:137-150)에서 복사했다.** 기존 3개
--    (credits·minerals·catalyst_residue) 보존 + 신규 3개.
--    **이것이 빠지면 클라가 자기 프로필을 `daily_streak: 30` 으로 INSERT 할 수 있다** —
--    RLS 는 소유권만 검사한다(20260717000000:95). UPDATE 봉인만으로는 못 막는다.
-- 계약 테스트가 대입 **총수 6** 과 그 집합을 단언한다.
create or replace function public.guard_profiles_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.credits := 0;
    new.minerals := 0;
    new.catalyst_residue := 0;   -- ADR-0042: 신규 프로필의 촉매 잔재는 0.
    new.daily_last_claim_seed := 0;  -- ADR-0048: 미수령(센티넬 0 — 위 1절의 근거 참조).
    new.daily_streak := 0;           -- ADR-0048: 신규 프로필은 연속 0 에서 시작한다.
    new.lifetime_granted := 0;       -- ADR-0048: 앵커를 심고 시작하는 경로 차단.
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard_insert, before insert)는 20260726000000 에서 이미 정의됨.

-- -----------------------------------------------------------------------------
-- 4. daily_reward_claims — 수령 원장 겸 장비 배송함
-- -----------------------------------------------------------------------------
-- 복합 PK `(profile_id, date_seed)` 가 중복 수령을 **구조적으로** 막는다(모듈 상점의
-- module_shop_purchases 선례). 그런데 그것만으로는 부족하다 — 값이 수령 시점에 굴려지므로
-- **굴린 결과를 그 행에 함께 적어야** 네트워크 재시도가 다시 굴리지 않는다(AC-5).
-- 그것이 `result_payload` 다.
--
-- ⚠️ `payload`(다음날 예고)와 `result_payload`(오늘 실제 지급분)를 **한 컬럼에 섞지 마라.**
--    섞으면 예고 소비 로직이 자기 결과를 예고로 읽는다.
--
-- ⚠️ **TTL·GC 대상이 아니다.** commission_grants 와 같은 이유이며, 여기서는 더 직접적이다 —
--    지우면 미반영 배송함 행이 사라져 **플레이어가 물건을 영구히 못 받는다**.
create table if not exists public.daily_reward_claims (
  profile_id     uuid        not null references public.profiles(id) on delete cascade,
  date_seed      bigint      not null,
  -- 다음날 보상 예고(종류·등급·지시 계급까지만. 랜덤 값은 감춘다 — AC-21).
  payload        jsonb       not null default '{}'::jsonb,
  -- 오늘 실제 지급된 것(축·수량·item id). 재시도가 이 행을 먼저 읽어 재굴림 없이 반환한다.
  result_payload jsonb       not null default '{}'::jsonb,
  -- 장비 축 전용 배송함. 클라가 세이브에 반영한 뒤 mark_daily_reward_applied 를 부른다.
  item_payload   jsonb       null,
  applied_at     timestamptz null,
  -- 반영을 보류한 이유('capacity_full' 등). ⚠️ 관측 지표 ②(applied_at IS NULL 잔존 행)에서
  -- **만석을 경보와 분리**하기 위한 컬럼이다. 클라 로컬 상태로 두면 인벤·창고가 꽉 찬 유저가
  -- 그 지표를 상시 경보로 만든다.
  hold_reason    text        null,
  -- 상한이 실제로 물었는가. 관측 지표 ③(절삭 발생률)의 데이터 소스 — 이 컬럼이 없으면
  -- 그 지표는 담을 자리가 없는 죽은 계측기가 된다.
  clamped        boolean     not null default false,
  created_at     timestamptz not null default now(),
  primary key (profile_id, date_seed)
);

-- 관측 지표 ②의 조회가 풀스캔이 되지 않게 하는 부분 인덱스. 원장이 영구 보존이라 전체는
-- 단조 증가하지만 미반영 행은 항상 소수이므로 부분 인덱스가 정확히 맞는 도구다.
create index if not exists daily_reward_claims_pending_idx
  on public.daily_reward_claims (profile_id)
  where applied_at is null;

alter table public.daily_reward_claims enable row level security;

-- 읽기: 본인 원장만(모달 재열람·배송함 재시도용). **쓰기 정책 부재** → 클라 직접
-- insert/update/delete 불가. 서버 RPC(definer, RLS 우회)만 기록한다.
drop policy if exists daily_reward_claims_select_own on public.daily_reward_claims;
create policy daily_reward_claims_select_own
  on public.daily_reward_claims for select
  to authenticated
  using (auth.uid() = profile_id);

comment on table public.daily_reward_claims is
  '일일 보상 수령 원장 + 장비 배송함(ADR-0048). TTL 대상이 아니다 — 지우면 미반영 행이 사라져 물건이 영구 유실된다.';

-- -----------------------------------------------------------------------------
-- 5. currency_grants AFTER INSERT 트리거 → lifetime_granted 가산 (상한 앵커)
-- -----------------------------------------------------------------------------
-- `grant_currency_for` 본문을 고치지 않고 **붙인다**(20260803000000:14-16 선례).
--
-- ⚠️ **source 필터가 이 트리거의 하중 부재다.** `when (new.source <> 'daily_reward')` 가
--    없으면 일일 보상이 지급한 크레딧이 자기 상한을 밀어 올린다 — 곁들이 크레딧은 매일
--    나가고 재화 축이 낙찰되면 주 보상까지 크레딧이라 되먹임 계수가 1 에 근접한다.
--    계약 테스트가 이 필터의 존재를 단언한다.
--
-- ⚠️ 서브트랜잭션. 이 트리거는 **모든** 재화 지급에서 발동한다(PvE 정산·의뢰·분해·스토리).
--    감싸지 않으면 여기의 예외 하나가 정산 트랜잭션 전체를 롤백해 전 플레이어가 자원을
--    못 받고 화면은 조용하다.
--
-- 성능: profiles UPDATE 를 더하고 그 UPDATE 가 before-update 봉인 트리거도 매번 깨운다.
--    앵커를 바꾸면서 생긴 범위 확장이므로 명시한다 — 슬라이스 1 에서 settle_pve_run 왕복
--    p95 를 트리거 전/후로 각 20회 측정해 증가가 20ms 미만인지 확인한다.
--
-- is_service_role() 은 `current_user in ('service_role','supabase_admin','postgres')`
--    (20260717000000:53)이고 이 함수는 definer(소유자 postgres)라 true 가 된다 → 위 2절의
--    봉인이 이 가산을 막지 않는다.
create or replace function public.trg_daily_reward_anchor_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  MINERAL_TO_CREDIT constant numeric := 8;  -- BALANCE — 1절 백필·TS 미러와 **같은 값**이어야 한다.
begin
  begin
    update public.profiles
       set lifetime_granted = lifetime_granted
                              + greatest(0, coalesce(new.credits, 0))
                              + greatest(0, coalesce(new.minerals, 0)) * MINERAL_TO_CREDIT
     where id = new.profile_id;
  exception when others then
    -- 서브트랜잭션만 롤백. 바깥 지급은 커밋된다. **fail-open**: 앵커가 한 건 덜 세는 것이
    -- 전 플레이어가 자원을 못 받는 것보다 압도적으로 싸다. 관측은 warning 발생률로 한다.
    raise warning 'trg_daily_reward_anchor_bump 실패(profile_id=%): %', new.profile_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_currency_grants_anchor on public.currency_grants;
create trigger trg_currency_grants_anchor
  after insert on public.currency_grants
  for each row
  when (new.source <> 'daily_reward')
  execute function public.trg_daily_reward_anchor_bump();

comment on function public.trg_daily_reward_anchor_bump() is
  '상한 앵커 가산(ADR-0048). currency_grants AFTER INSERT. source=daily_reward 는 트리거 WHEN 절이 제외한다 — 자기참조 되먹임 차단.';

-- -----------------------------------------------------------------------------
-- 6. daily_reward_preview_for — 오늘의 예산·연속일·예고를 읽는다 (service_role 전용)
-- -----------------------------------------------------------------------------
-- Edge Function 이 후보를 만들기 전에 **얼마나 좋은 것까지 줄 수 있는지**를 알아야 하므로
-- 읽기 함수를 나눈다. ⚠️ **상한 산식의 정본은 이 파일이다** — EF 는 반환값을 소비만 한다.
-- 산식을 EF 의 TypeScript 에 복제하면 prove-*.ps1 이 그것을 영영 실증할 수 없어 완료 관문 ②가
-- 죽은 관문이 된다.
--
-- TOCTOU 는 claim 쪽이 닫는다 — claim_daily_reward_for 가 **예산을 다시 계산해** EF 가 들고 온
-- 값을 절삭한다. 이 함수의 반환값은 후보 필터링용 힌트이지 권위가 아니다.
create or replace function public.daily_reward_preview_for(p_recipient uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  DAILY_STREAK_CYCLE  constant int     := 30;     -- BALANCE — TS 미러: data/dailyReward.ts
  DAILY_BUDGET_DAY_1  constant numeric := 2000;   -- BALANCE
  DAILY_BUDGET_DAY_30 constant numeric := 20000;  -- BALANCE
  DAILY_CEILING_RATE  constant numeric := 0.02;   -- BALANCE
  v_now_seed   bigint;
  v_prev_seed  bigint;
  v_prev_streak int;
  v_lifetime   numeric;
  v_next_streak int;
  v_ramp       numeric;
  v_ceiling    numeric;
  v_prev_payload jsonb;
  v_today      public.daily_reward_claims%rowtype;
begin
  -- ⚠️ 서버 시각. 클라·EF 입력을 신뢰하지 않는다. shopDateSeedFromMs 와 같은 식이다.
  v_now_seed := floor(extract(epoch from now()) / 86400)::bigint;

  select daily_last_claim_seed, daily_streak, lifetime_granted
    into v_prev_seed, v_prev_streak, v_lifetime
    from public.profiles where id = p_recipient;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-profile');
  end if;

  -- 연속 판정 — **직전 seed 하나만 본다**(AC-7). 원장을 집계·스캔하지 않는다.
  -- 하루라도 놓치면 1(AC-8: 0 도 절반도 유지도 아니다). 30일차 다음도 1(AC-9).
  -- 같은 날이면 불변 — 멱등 재시도가 램프를 밀면 안 된다.
  if v_prev_seed = v_now_seed then
    v_next_streak := v_prev_streak;
  elsif v_prev_seed = v_now_seed - 1 then
    v_next_streak := case when v_prev_streak >= DAILY_STREAK_CYCLE then 1 else v_prev_streak + 1 end;
  else
    v_next_streak := 1;
  end if;

  -- 직선 램프(AC-15). 계단·마일스톤 해금이 없다.
  v_ramp := DAILY_BUDGET_DAY_1
            + (DAILY_BUDGET_DAY_30 - DAILY_BUDGET_DAY_1)
              * (least(DAILY_STREAK_CYCLE, greatest(1, v_next_streak)) - 1)
              / (DAILY_STREAK_CYCLE - 1);

  -- 예산 천장 = max(FLOOR, 누적 × 계수). FLOOR 는 **DAILY_BUDGET_DAY_1 과 같다** —
  -- 그래야 플레이 0 계정의 예산이 연속일과 무관하게 1일차에 고정되어 30일 봇 접속이
  -- 최고점을 열지 못하고, FLOOR 경로도 ADR 의 "정직한 범위 안" 논증 아래 들어온다.
  -- ⚠️ FLOOR 를 DAILY_BUDGET_DAY_1 위로 올리는 순간 유계가 깨진다.
  v_ceiling := greatest(DAILY_BUDGET_DAY_1, greatest(0, coalesce(v_lifetime, 0)) * DAILY_CEILING_RATE);

  -- 어제 행의 예고. 없으면(하루 놓쳐 그 행이 소멸했으면) EF 가 지금 파생한다.
  select payload into v_prev_payload
    from public.daily_reward_claims
   where profile_id = p_recipient and date_seed = v_now_seed - 1;

  -- 오늘 이미 받았으면 그 행을 그대로 돌려준다(재굴림 금지 — AC-5).
  select * into v_today
    from public.daily_reward_claims
   where profile_id = p_recipient and date_seed = v_now_seed;

  return jsonb_build_object(
    'ok',            true,
    'date_seed',     v_now_seed,
    'prev_seed',     v_prev_seed,
    'streak',        v_next_streak,
    'ramp',          v_ramp,
    'ceiling',       v_ceiling,
    'budget',        least(v_ramp, v_ceiling),
    'clamped',       v_ramp > v_ceiling,
    'lifetime',      v_lifetime,
    'announcement',  coalesce(v_prev_payload, 'null'::jsonb),
    'already',       (v_today.profile_id is not null),
    'result_payload', coalesce(v_today.result_payload, 'null'::jsonb),
    'next_payload',  coalesce(v_today.payload, 'null'::jsonb)
  );
end;
$$;

revoke all on function public.daily_reward_preview_for(uuid) from public;
revoke all on function public.daily_reward_preview_for(uuid) from anon;
revoke all on function public.daily_reward_preview_for(uuid) from authenticated;
grant execute on function public.daily_reward_preview_for(uuid) to service_role;

comment on function public.daily_reward_preview_for(uuid) is
  '일일 보상 예산·연속일·예고 조회(ADR-0048). 상한 산식의 정본. service_role 전용 — 수령은 EF 전용이라 authenticated 진입점이 없다.';

-- -----------------------------------------------------------------------------
-- 7. claim_daily_reward_for — 수령 + 예고 확정 + 연속일 갱신 (service_role 전용)
-- -----------------------------------------------------------------------------
-- ⚠️ **p_date_seed 를 받지 않는다.** 본문이 서버 시각으로 계산한다. 받으면 복합 PK 가 서로
--    다른 seed 를 안 막아 하루에 여러 번 수령이 열린다.
--
-- 멱등: 복합 PK 충돌이면 **아무것도 지급하지 않고** 기존 행을 그대로 돌려준다. 굴린 결과가
--    result_payload 에 이미 적혀 있으므로 재시도가 다른 물건을 만들지 않는다.
--
-- 절삭: EF 가 들고 온 p_value 를 **다시 계산한 예산으로** 클램프한다. preview 반환값은
--    힌트이지 권위가 아니다 — 그 사이 다른 트랜잭션이 앵커를 움직였을 수 있다.
--
-- 잠금: 슬라이스 1(재화 축)은 인벤토리를 잠그지 않는다. profiles 는 grant_currency_for 안의
--    `for update` 하나로 직렬화된다(20260803000000:308).
create or replace function public.claim_daily_reward_for(
  p_recipient    uuid,
  p_axis         text,
  p_value        numeric,
  p_result       jsonb,
  p_next_payload jsonb,
  p_item_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  DAILY_STREAK_CYCLE constant int     := 30;   -- BALANCE — 6절·TS 미러와 같은 값이어야 한다.
  DAILY_SIDE_CREDITS constant numeric := 500;  -- BALANCE — 곁들이 크레딧(주 보상과 별개).
  v_now_seed  bigint;
  v_preview   jsonb;
  v_budget    numeric;
  v_streak    int;
  v_clamped   boolean;
  v_claim     numeric;   -- EF 가 주장한 가치(절삭 전).
  v_value     numeric;   -- 예산으로 깎은 가치(절삭 후).
  v_scale     numeric;   -- v_value / v_claim — 축 성분을 같은 비율로 깎는다.
  v_result    jsonb;
  v_inserted  int := 0;   -- get diagnostics row_count 는 정수다. boolean 에 대입하면 실패한다.
  v_existing  public.daily_reward_claims%rowtype;
  v_grant     jsonb;
begin
  if p_recipient is null then
    return jsonb_build_object('ok', false, 'code', 'no-recipient');
  end if;

  v_now_seed := floor(extract(epoch from now()) / 86400)::bigint;

  v_preview := public.daily_reward_preview_for(p_recipient);
  if coalesce((v_preview->>'ok')::boolean, false) is not true then
    return v_preview;
  end if;
  v_budget  := coalesce((v_preview->>'budget')::numeric, 0);
  v_streak  := coalesce((v_preview->>'streak')::int, 1);
  v_clamped := coalesce((v_preview->>'clamped')::boolean, false);

  -- 예산 재적용. EF 주장액이 천장을 넘으면 조용히 넘기지 않고 **절삭하고 표시**한다.
  v_claim := greatest(0, coalesce(p_value, 0));
  v_value := least(v_claim, v_budget);
  if v_value < v_claim then
    v_clamped := true;
  end if;

  -- ⚠️ **절삭을 실지급까지 밀어 내려야 한다.** 초안은 깎은 값을 `v_result.value` 에만 넣고
  --    아래 grant 는 `p_result` 가 실어 온 credits/minerals 원값을 그대로 넘겼다. 그러면
  --    *"preview 반환값은 힌트이지 권위가 아니다"* 라는 TOCTOU 방어가 **표시상으로만** 성립하고
  --    실제 상한은 CAP_DAILY_REWARD_CREDITS(25,000) 하나뿐이 된다 — 상한 유계가 이 설계의
  --    유일한 안전장치인데 그 자리에서 새는 것이다. 그래서 축 성분을 **같은 비율로** 깎는다.
  --    비율로 깎는 이유: 재화 축은 크레딧·광물 두 성분이고 가치 환산이 `c + m * MINERAL_TO_CREDIT`
  --    이므로, 둘을 같은 비율로 줄이면 환산 가치도 정확히 그 비율이 된다(선형).
  v_scale := case when v_claim > 0 then v_value / v_claim else 1 end;
  v_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object(
    'value',    v_value,
    'axis',     p_axis,
    'credits',  floor(coalesce((p_result->>'credits')::numeric, 0) * v_scale),
    'minerals', floor(coalesce((p_result->>'minerals')::numeric, 0) * v_scale)
  );

  insert into public.daily_reward_claims
    (profile_id, date_seed, payload, result_payload, item_payload, clamped)
  values
    (p_recipient, v_now_seed, coalesce(p_next_payload, '{}'::jsonb), v_result, p_item_payload, v_clamped)
  on conflict (profile_id, date_seed) do nothing;
  get diagnostics v_inserted = row_count;

  -- ⚠️ `not v_inserted` 로 쓰지 마라 — `NOT <integer>` 는 파서가 거절하는데(argument of NOT
  --    must be type boolean) plpgsql 이 표현식을 **지연 준비**하므로 CREATE 는 통과하고
  --    **첫 호출에서 터진다.** 즉 마이그레이션 적용은 초록이고 수령만 100% 실패한다.
  if v_inserted = 0 then
    -- 이미 오늘 받았다. **지급도 연속일 갱신도 하지 않는다.**
    select * into v_existing
      from public.daily_reward_claims
     where profile_id = p_recipient and date_seed = v_now_seed;
    return jsonb_build_object(
      'ok', true, 'already', true, 'date_seed', v_now_seed,
      'result_payload', v_existing.result_payload,
      'next_payload',   v_existing.payload,
      'item_payload',   coalesce(v_existing.item_payload, 'null'::jsonb),
      'clamped',        v_existing.clamped
    );
  end if;

  -- 연속일 전이 — preview 가 계산한 값을 그대로 쓴다(산식이 두 곳에 살면 갈린다).
  -- ⚠️ 0 으로 리셋하지 않는다. 오늘 수령분이 이미 1일차이므로 끊김의 값은 1 이다(AC-8).
  update public.profiles
     set daily_last_claim_seed = v_now_seed,
         daily_streak = least(DAILY_STREAK_CYCLE, greatest(1, v_streak))
   where id = p_recipient;

  -- 재화 축 지급 + 곁들이 크레딧. source='daily_reward' 의 per-call 상한은 9절이 등록한
  -- CAP_DAILY_REWARD_*(25,000/25,000)다. 등록하지 않았다면 else 분기의 CAP_DEFAULT(1,000)에
  -- 걸려 30일차 예산 20,000 이 **조용히 1,000 으로 절삭**됐을 것이다(9절 머리에 근거).
  -- 이 지급이 만든 currency_grants 행은 트리거 WHEN 절이 걸러 앵커를 밀지 않는다.
  v_grant := public.grant_currency_for(
    p_recipient,
    DAILY_SIDE_CREDITS + case when p_axis = 'currency'
      then coalesce((v_result->>'credits')::numeric, 0) else 0 end,
    case when p_axis = 'currency'
      then coalesce((v_result->>'minerals')::numeric, 0) else 0 end,
    'daily_reward',
    null
  );

  return jsonb_build_object(
    'ok', true, 'already', false, 'date_seed', v_now_seed,
    'streak',         least(DAILY_STREAK_CYCLE, greatest(1, v_streak)),
    'budget',         v_budget,
    'clamped',        v_clamped,
    'result_payload', v_result,
    'next_payload',   coalesce(p_next_payload, '{}'::jsonb),
    'item_payload',   coalesce(p_item_payload, 'null'::jsonb),
    'grant',          v_grant
  );
end;
$$;

-- ⚠️ Postgres 는 함수 생성 시 **PUBLIC 에 EXECUTE 를 자동 부여**한다. 아래 revoke 가 빠지면
--    authenticated 가 PUBLIC 을 통해 도달해 "수령은 EF 전용" 구조 전체가 무효가 된다.
--    prove-daily-reward-seal.ps1 의 [OK] RPC_DENIED_AUTHENTICATED 가 이것을 실증한다.
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from public;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from anon;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) to service_role;

comment on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) is
  '일일 보상 수령 + 예고 확정 + 연속일 갱신(ADR-0048). date_seed 는 서버가 계산한다. service_role 전용.';

-- -----------------------------------------------------------------------------
-- 8. mark_daily_reward_applied / mark_daily_reward_hold — 반영 통지 (authenticated)
-- -----------------------------------------------------------------------------
-- 이쪽은 클라가 부르는 것이 맞다 — 세이브 반영을 끝냈다는 사실은 클라만 안다.
-- seed 를 받아도 **이미 존재하는 본인 행만** 갱신하므로 위조 이득이 없다.
create or replace function public.mark_daily_reward_applied(p_date_seed bigint)
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
  update public.daily_reward_claims
     set applied_at = now(), hold_reason = null
   where profile_id = v_me and date_seed = p_date_seed and applied_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- 반영 보류(인벤·창고 만석 등). applied_at 을 찍지 않고 이유만 남긴다 — 그래야 관측 지표 ②가
-- 만석 유저 때문에 상시 경보가 되지 않는다.
create or replace function public.mark_daily_reward_hold(p_date_seed bigint, p_reason text)
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
  -- 이유 문자열은 열거로 좁힌다 — 자유 텍스트를 받으면 지표 집계가 갈린다.
  if p_reason is null or p_reason not in ('capacity_full') then
    return jsonb_build_object('ok', false, 'code', 'bad-reason');
  end if;
  update public.daily_reward_claims
     set hold_reason = p_reason
   where profile_id = v_me and date_seed = p_date_seed and applied_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

revoke all on function public.mark_daily_reward_applied(bigint) from public;
revoke all on function public.mark_daily_reward_applied(bigint) from anon;
grant execute on function public.mark_daily_reward_applied(bigint) to authenticated, service_role;

revoke all on function public.mark_daily_reward_hold(bigint, text) from public;
revoke all on function public.mark_daily_reward_hold(bigint, text) from anon;
grant execute on function public.mark_daily_reward_hold(bigint, text) to authenticated, service_role;

comment on function public.mark_daily_reward_applied(bigint) is
  '장비 배송함 반영 완료 통지(ADR-0048). 본인의 기존 행만 갱신하므로 seed 를 받아도 위조 이득이 없다.';
comment on function public.mark_daily_reward_hold(bigint, text) is
  '배송함 반영 보류 사유 기록(만석 등). applied_at 을 찍지 않는다 — 만석을 배송 실패 경보에서 분리한다.';

-- -----------------------------------------------------------------------------
-- 9. grant_currency_for 개정 — source 'daily_reward' per-call 캡 등록
-- -----------------------------------------------------------------------------
-- ⚠️ **이 절은 계획의 "grant_currency_for 본문을 고치지 않는다" 를 의도적으로 어긴다.**
--    사용자 판단으로 확정했다(2026-08-05). 근거와 위험 관리를 여기 남긴다.
--
-- 왜 어겨야 했나: 이 함수의 `case p_source` 에 'daily_reward' 가 없으면 else 분기로 떨어져
--   CAP_DEFAULT(1000/1000) per-call 상한을 받는다. 그런데 30일차 공통 가치 예산은 20,000
--   규모다(PvE 런 1회 상한이 5,000이므로 런 4회분). 재화 축이 낙찰되면 지급이 **조용히
--   1000 으로 절삭**되고 — 그 함수의 case 주석이 직접 경고하는 함정이다 — 슬라이스 1 의 제품
--   전체가 재화 축이므로 **램프가 그 자리에서 죽는다.**
--
-- 왜 이 재정의는 그 규율이 겨눈 위험이 아닌가: 20260802000000:4-15 가 프로덕션을 100%
--   깨뜨린 것은 **낡은 본문의 복제**였다(드롭된 컬럼을 참조하는 구본문 → ERROR 42703).
--   이 절은 현행 정의(20260803000000:197-373)를 **한 바이트도 바꾸지 않고 그대로 복사**한 뒤
--   상수 2개 선언과 case 한 갈래만 더했다. 손으로 옮겨 적지 않고 파일에서 잘라 붙였다.
--   봉인 트리거 2개(2·3절)를 같은 방식으로 개정하는 것과 정확히 같은 규율이다.
--
-- 드리프트 방어: `tests/dailyRewardContract.test.ts` 가 이 본문의 **캡 상수 전집합**과
--   `grant_currency` 클라 allowlist 를 단언한다. 상수가 하나라도 사라지거나 값이 갈리면
--   빨개진다. allowlist(pve_run·salvage·story)는 **손대지 않았다** — 클라는 여전히
--   'daily_reward' 로 이 경로에 못 들어온다(수령은 EF 전용이라 그럴 필요도 없다).
create or replace function public.grant_currency_for(
  p_profile_id uuid,
  p_credits    numeric,
  p_minerals   numeric,
  p_source     text,
  p_metrics    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 20260727000000 상단 배너가 의미 정본, 함께 갱신). 출시 전 밸런스 튜닝 대상.
  CAP_PVE_RUN_CREDITS    constant numeric := 5000;
  CAP_PVE_RUN_MINERALS   constant numeric := 5000;
  CAP_SALVAGE_CREDITS    constant numeric := 20000;
  CAP_SALVAGE_MINERALS   constant numeric := 20000;
  CAP_STORY_CREDITS      constant numeric := 2000;
  -- 의뢰 확정 보상. CAP_HOURLY_*(50,000) 아래로 두어 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 한다.
  -- 미러: src/run/commissionServerConstants.ts CAP_COMMISSION_CREDITS / _MINERALS.
  CAP_COMMISSION_CREDITS  constant numeric := 30000;
  CAP_COMMISSION_MINERALS constant numeric := 30000;
  -- ADR-0048: 일일 보상 per-call 상한. 곁들이 크레딧 + 주 보상(재화 축 낙찰 시)의 합이
  --   30일차 공통 가치 예산(DAILY_BUDGET_DAY_30 = 20000, data/dailyReward.ts) 을 담아야 한다.
  --   미등록 source 로 두면 CAP_DEFAULT(1000)에 **조용히 절삭**돼 램프가 그 자리에서 죽는다.
  CAP_DAILY_REWARD_CREDITS  constant numeric := 25000;
  CAP_DAILY_REWARD_MINERALS constant numeric := 25000;
  CAP_DEFAULT_CREDITS    constant numeric := 1000;
  CAP_DEFAULT_MINERALS   constant numeric := 1000;
  CAP_HOURLY_CREDITS     constant numeric := 50000;
  CAP_HOURLY_MINERALS    constant numeric := 50000;
  CAP_DAILY_CREDITS      constant numeric := 300000;
  CAP_DAILY_MINERALS     constant numeric := 300000;
  PLAUSIBILITY_CREDITS_PER_TICK  constant numeric := 2.0;
  PLAUSIBILITY_MINERALS_PER_TICK constant numeric := 2.0;
  FLAG_MULTIPLE          constant numeric := 10;
  SLOT_CAP               constant int     := 8;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  CAP_RESOURCE_MULT_MAX  constant numeric := 1 + SLOT_CAP * MAX_RESOURCE_PER_STACK;  -- =2.2 유계 상한.

  -- ⚠️ 원본과의 **유일한** 차이: 수령자를 auth.uid() 가 아니라 파라미터에서 받는다.
  v_me            uuid := p_profile_id;
  v_claim_credits   numeric;
  v_claim_minerals  numeric;
  v_final_tick    numeric := 0;
  v_stage         numeric := 0;
  v_res_mult        numeric := 1;
  v_plaus_credits   numeric := null;
  v_plaus_minerals  numeric := null;
  v_call_credits    numeric;
  v_call_minerals   numeric;
  v_1h_credits    numeric := 0;
  v_1h_minerals   numeric := 0;
  v_24h_credits   numeric := 0;
  v_24h_minerals  numeric := 0;
  v_rem_credits     numeric;
  v_rem_minerals    numeric;
  v_ref_credits     numeric;
  v_ref_minerals    numeric;
  v_grant_credits   numeric;
  v_grant_minerals  numeric;
  v_credits_left    numeric := 0;
  v_minerals_left   numeric := 0;
  v_clamped       boolean := false;
  v_flag          boolean := false;
begin
  if v_me is null then
    raise exception 'grant_currency_for: 수령자 profile_id 필요';
  end if;

  v_claim_credits  := greatest(0, coalesce(p_credits, 0));
  v_claim_minerals := greatest(0, coalesce(p_minerals, 0));

  -- ① 개연성 캡: pve_run 만.
  --
  -- ⚠️ **의뢰가 여기서 면제되는 근거를 정정한다.** 이전 판은 "서버 재실행 증거가 캡을 대체한다"
  --    고 적었는데 **그 전제는 거짓이었다** — 재실행이 제출자 config 로 돌면 해시는 제출자가 같은
  --    config 로 계산한 claim 과 일치해 원리적으로 발산하지 않는다. EF 게이트 6 을 allowlist
  --    재조립으로 고쳐 무대·코어 스탯·배율 축을 닫았고, **런 파생 자원분은 `settle_commission`
  --    이 틱 비례로 클램프한 뒤 넘긴다**(§7 참조). 즉 의뢰의 개연성 방어는 면제가 아니라
  --    **호출부로 옮겨져 있다.**
  --
  --    여기서 의뢰를 캡하지 않는 이유: 이 함수가 받는 값은 *런 파생분 + 서버가 발급한 확정 보상*
  --    의 합이고, 그 합에 런 길이 비례 캡을 걸면 **짧은 고계급 의뢰의 확정 지급이 조용히 잘린다.**
  --    확정 보상은 서버가 payload 에 구운 값이라 개연성을 물을 대상이 아니다.
  if p_source = 'pve_run' then
    v_final_tick := greatest(0, case
      when (p_metrics->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'finalTick')::numeric else 0 end);
    v_stage := greatest(0, case
      when (p_metrics->>'stage') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'stage')::numeric else 0 end);
    if current_setting('app.in_settle', true) = '1'
       and (p_metrics->>'resourceMult') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_res_mult := (p_metrics->>'resourceMult')::numeric;
    end if;
    v_res_mult := least(greatest(1, v_res_mult), CAP_RESOURCE_MULT_MAX);
    v_plaus_credits  := PLAUSIBILITY_CREDITS_PER_TICK  * v_final_tick * (1 + v_stage) * v_res_mult;
    v_plaus_minerals := PLAUSIBILITY_MINERALS_PER_TICK * v_final_tick * (1 + v_stage) * v_res_mult;
  end if;

  -- ② per-call 캡. ⚠️ commission 분기가 없으면 최종 지시의 확정 보상이 else 로 떨어져
  --   **조용히 1,000 으로 클램프된다.**
  case p_source
    when 'pve_run' then
      v_call_credits  := CAP_PVE_RUN_CREDITS  * v_res_mult;
      v_call_minerals := CAP_PVE_RUN_MINERALS * v_res_mult;
    when 'salvage' then v_call_credits := CAP_SALVAGE_CREDITS; v_call_minerals := CAP_SALVAGE_MINERALS;
    when 'story'   then v_call_credits := CAP_STORY_CREDITS;   v_call_minerals := 0;
    when 'commission' then
      v_call_credits  := CAP_COMMISSION_CREDITS;
      v_call_minerals := CAP_COMMISSION_MINERALS;
    when 'daily_reward' then
      v_call_credits  := CAP_DAILY_REWARD_CREDITS;
      v_call_minerals := CAP_DAILY_REWARD_MINERALS;
    else                v_call_credits := CAP_DEFAULT_CREDITS; v_call_minerals := CAP_DEFAULT_MINERALS;
  end case;

  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', (v_claim_credits > 0 or v_claim_minerals > 0),
      'note', 'no-profile'
    );
  end if;

  -- ③ 누적 캡: 폭주 방어이지 개연성 판정이 아니므로 **재실행 증거가 대체하지 않는다.**
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_1h_credits, v_1h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_24h_credits, v_24h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '24 hours';

  v_rem_credits := least(
    greatest(0, CAP_HOURLY_CREDITS - v_1h_credits),
    greatest(0, CAP_DAILY_CREDITS  - v_24h_credits)
  );
  v_rem_minerals := least(
    greatest(0, CAP_HOURLY_MINERALS - v_1h_minerals),
    greatest(0, CAP_DAILY_MINERALS  - v_24h_minerals)
  );

  v_grant_credits  := greatest(0, least(v_claim_credits,  v_plaus_credits,  v_call_credits,  v_rem_credits));
  v_grant_minerals := greatest(0, least(v_claim_minerals, v_plaus_minerals, v_call_minerals, v_rem_minerals));

  v_clamped := (v_grant_credits < v_claim_credits) or (v_grant_minerals < v_claim_minerals);

  v_ref_credits  := least(v_plaus_credits,  v_call_credits);
  v_ref_minerals := least(v_plaus_minerals, v_call_minerals);
  if (v_ref_credits  > 0 and v_claim_credits  > FLAG_MULTIPLE * v_ref_credits)
     or (v_ref_minerals > 0 and v_claim_minerals > FLAG_MULTIPLE * v_ref_minerals)
     or (p_source = 'pve_run' and v_final_tick <= 0
         and (v_claim_credits > 0 or v_claim_minerals > 0)) then
    v_flag := true;
  end if;

  update public.profiles
    set credits  = credits  + v_grant_credits,
        minerals = minerals + v_grant_minerals,
        flagged  = case when v_flag then true else flagged end
    where id = v_me
    returning credits, minerals into v_credits_left, v_minerals_left;

  -- 실지급이 있을 때만 원장 기록. 누적 캡의 근거다 — 우회하면 의뢰 축이 1h/24h 캡 밖으로 나간다
  -- (apply_invasion_result 선례가 정확히 그렇게 원장을 우회한다. 그것을 복제하지 않는다).
  if v_grant_credits > 0 or v_grant_minerals > 0 then
    insert into public.currency_grants (profile_id, source, credits, minerals)
      values (v_me, p_source, v_grant_credits, v_grant_minerals);
  end if;

  return jsonb_build_object(
    'granted_credits',  v_grant_credits,
    'granted_minerals', v_grant_minerals,
    'credits_left',     v_credits_left,
    'minerals_left',    v_minerals_left,
    'clamped',          v_clamped
  );
end;
$$;
-- create or replace 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
-- ⚠️ 이 revoke 가 빠지면 authenticated 가 PUBLIC 을 통해 도달해 위임 구조 전체가 무효가 된다.
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from anon;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from authenticated;
grant execute on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) to service_role;
