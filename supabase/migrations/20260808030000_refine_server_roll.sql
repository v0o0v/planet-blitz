-- =============================================================================
-- 정련 굴림을 서버가 준다 — ADR-0050 §3 단계 1 둘째 축 (사용자 결정: 이 레인에 포함)
-- =============================================================================
--
-- ## 무엇이 열려 있었나 (착수 전 실측)
--
-- 정련은 광물 차감만 서버를 타고(`spendCurrencyOnServer(0, cost, 'reroll')` —
-- `src/ui/pixi/refinery.ts:970`) **굴림 시드와 용해 주사위는 클라가 만든다**:
--
--     const seed = (Math.random() * 0xffffffff) >>> 0;   -- refinery.ts:997
--     const riskRoll = Math.random();                    -- refinery.ts:998
--     const outcome = rollChain(chain, heat, seed, riskRoll);
--
-- `rollChain`(`src/items/refiningChain.ts`)은 난수를 전부 **주입받는 순수 함수**라, 시드를
-- 고르는 쪽이 곧 결과를 고르는 쪽이다. 그래서 정확한 공격은 이것이다:
--
--   > **광물을 한 번만 내고, 원하는 어픽스가 나올 때까지 시드를 바꿔 가며 로컬에서 굴린다.**
--
-- 서버는 차감을 한 번 봤을 뿐이고, 이후의 굴림은 서버에 흔적조차 남지 않는다. 즉 정련은
-- "확률을 사는" 기능인데 **확률이 클라 손에 있었다.**
--
-- ## ⛔ 이 마이그레이션이 닫지 **않는** 것 — 정직하게 적는다
--
-- 이것은 **어픽스 위조 자체를 막지 않는다.** 정련 결과는 기존 아이템의 어픽스를 바꾸는 것이라
-- 아이템 id 가 그대로이고(`refinery.ts:1004` 가 같은 자리에 대입한다), 뒤따르는 `save`
-- **증가분** 봉인은 "원장에 없는 id 의 신규 등장"만 되돌리므로 **어픽스 변경은 통과한다.**
-- 손으로 세이브를 고쳐 어픽스를 심는 경로는 그대로 열려 있고, 그것을 닫으려면 어픽스 단위
-- 봉인이라는 **다른 축**이 필요하다(이 레인의 결정 범위 밖).
--
-- 닫는 것은 **"공짜 재굴림"** 하나다 — 대가를 치른 횟수만큼만 굴릴 수 있게 만든다.
-- ADR-0050 §4 의 *"차단이 아니라 유계"* 에 그대로 해당한다.
--
-- ## 설계
--
-- 차감과 굴림을 **한 트랜잭션**에 묶는다. 나뉘어 있으면 "차감은 실패했는데 시드는 받았다"나
-- 그 반대가 생기고, 후자는 곧 공짜 굴림이다.
--
-- ⚠️ `spend_currency` **본문을 복제하지 않는다** — 중첩 definer 호출로 부른다. 이 저장소는
-- 재화 함수 본문 복제로 프로덕션을 100% 깨뜨린 전례가 있고(20260802000000:4-15), 중첩 호출은
-- `settle_pve_run` 이 `grant_currency` 를 부르는 자리에서 이미 검증된 관용구다
-- (20260726000200:294 — 중첩 definer 에서도 `auth.uid()` 는 원 호출자를 가리킨다).
--
-- 시드는 **재현할 필요가 없다.** 드랍 원장과 달리 정련 결과는 세이브에 즉시 반영되고 서버가
-- 다시 확정할 일이 없으므로, `hash(secret, ...)` 대신 `gen_random_bytes` 로 족하다 —
-- 오히려 그쪽이 예측 불가라 더 강하다(드랍은 원장 재확정 때문에 결정론이 **필요**했을 뿐이다).
-- =============================================================================

-- ⚠️ **pgcrypto 함수는 `extensions.` 로 한정한다 — `public.` 이 아니다.**
--    Supabase 는 pgcrypto 를 `extensions` 스키마에 미리 심어 둔다. 그래서 아래 선언은 이미
--    설치돼 있어 **조용한 no-op** 이고, `public.gen_random_bytes` 로 부르면 원격 적용이
--    `ERROR: 42883: function public.gen_random_bytes(integer) does not exist` 로 터진다
--    (2026-08-08 배포에서 실제로 밟았다 — 이 파일이 그 상태로 머지돼 있었다. 이 리포의 SQL
--    계약 테스트는 마이그레이션을 **텍스트로만** 읽고 실행하지 않아 `pnpm verify` 가 전량
--    초록인 채로 적용 불가능한 마이그레이션이 쌓였다).
--    ⭐ `gen_random_uuid` 만은 반대다 — `pg_catalog` 에도 있어 **한정 없이** 써야 항상 풀린다.
--    이 부류는 `tests/migrationExtensionSchema.test.ts` 가 기계로 막는다.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- roll_refine — 광물 차감 + 서버 굴림 값을 한 번에
-- -----------------------------------------------------------------------------
-- 반환: { ok, credits_left, minerals_left, seed, risk_roll }
--   · ok=false  → 잔액 부족(미차감). seed·risk_roll 은 null 이고 클라는 굴리지 않는다.
--   · ok=true   → 차감 확정. seed(u32)·risk_roll([0,1))로 `rollChain` 을 **한 번만** 돌린다.
create or replace function public.roll_refine(p_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_spend jsonb;
  v_seed  bigint;
  v_risk  numeric;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'credits_left', 0, 'minerals_left', 0,
                              'seed', null, 'risk_roll', null, 'note', 'no-auth');
  end if;

  -- 차감 먼저. 실패하면 굴림 값을 **주지 않는다** — 주면 그것이 곧 공짜 굴림이다.
  -- ⚠️ 본문 복제 금지(위 §설계). 중첩 definer 호출이라 auth.uid() 는 원 호출자다.
  v_spend := public.spend_currency(0, p_cost, 'reroll');

  if coalesce((v_spend->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'credits_left',  coalesce((v_spend->>'credits_left')::numeric, 0),
      'minerals_left', coalesce((v_spend->>'minerals_left')::numeric, 0),
      'seed', null, 'risk_roll', null, 'note', 'insufficient');
  end if;

  -- 굴림 값. 앞 4바이트 → u32 시드, 뒤 4바이트 → [0,1) 용해 주사위.
  -- 두 값을 **다른 바이트**에서 뽑는다 — 같은 바이트를 접어 쓰면 시드를 보는 것만으로
  -- 용해 여부를 알 수 있고, 그러면 클라가 손해 보는 굴림을 골라 버릴 수 있다.
  v_seed := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
  v_risk := (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint)::numeric
            / 4294967296.0;

  return jsonb_build_object(
    'ok', true,
    'credits_left',  coalesce((v_spend->>'credits_left')::numeric, 0),
    'minerals_left', coalesce((v_spend->>'minerals_left')::numeric, 0),
    'seed', v_seed,
    'risk_roll', v_risk);
end;
$$;

revoke all on function public.roll_refine(numeric) from public;
grant execute on function public.roll_refine(numeric) to authenticated;
