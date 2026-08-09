-- 계보 수호 가지 상한 5000 → 37000 (2026-08-10)
--
-- ## 왜
-- 침공에서 공격측 조종사 레벨 봉인을 풀면서(`src/run/runConfig.ts`) 만렙 공격자가 피해·최대HP
-- ×4.69 를 받게 됐고, 그 대응 축으로 계보 **수호 가지** 상한을 5000(+50%) → 37000(+370% ≈ ×4.70)
-- 으로 올렸다(`data/lineage.ts` GUARDIAN_BONUS_CAP_BP).
--
-- 그런데 서버가 그 곱선을 **복제해 두고 있었다**: `inject_guardian_authority` 가
-- `floor(5000.0 * L / (L + 20))` 을 직접 계산하고 5000 으로 자른다. 그래서 TS 상수를 올려도
-- **실 PvP 수호기는 여전히 +50% 에서 멈춘다** — 값을 바꾼 쪽은 바뀌었다고 믿는데 실제 스탯은
-- 안 바뀌는, 이 저장소가 반복해 온 「조용한 미발현」이다.
--
-- ## 근본 원인은 상한이 아니라 복제였다 → 서버측 정본 함수를 만든다
-- 상한 숫자만 고치면 다음에 곱선 모양을 바꿀 때 같은 자리를 또 찾아야 한다. 곱선을
-- `public.lineage_guardian_bonus_bp(level)` 하나로 모으고 호출부가 그것만 쓰게 한다.
--
-- 클라이언트 정본은 `data/lineage.ts` 의 `branchBonusBp(L, GUARDIAN_BONUS_CAP_BP,
-- GUARDIAN_HALF_LEVEL)` = `floor(37000 * L / (L + 20))` 이다. 두 곱선이 갈리면
-- `tests/guardianLineageSqlDrift.test.ts` 가 큰 소리로 실패한다.
--
-- ## 범위
-- `inject_guardian_authority` 는 M5(20260718110000)가 만들고 M7a(20260721000000)가 **같은
-- 이름으로 덮어썼다** — 살아 있는 정의는 M7a 판(3레이어 `l3.guardians`) 하나뿐이라 여기서
-- 고칠 곳도 하나다. 아래 본문은 M7a 판을 그대로 옮기고 보너스 계산 두 줄만 교체한 것이다.
--
-- 마일스톤 임계(10/25/50)와 슬롯 상한 2, 그 밖의 어떤 값도 건드리지 않는다.

-- ---------------------------------------------------------------------------
-- ① 서버측 곱선 정본
-- ---------------------------------------------------------------------------

create or replace function public.lineage_guardian_bonus_bp(p_level integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- data/lineage.ts: floor(CAP * L / (L + K)), CAP=GUARDIAN_BONUS_CAP_BP, K=GUARDIAN_HALF_LEVEL.
  -- 점근 곡선이라 L→∞ 에서도 CAP 에 도달하지 않지만, 손상 입력(음수)을 0 으로 접기 위해
  -- greatest 를 둔다. floor 는 TS 의 Math.floor 와 같은 방향이다(양수 구간이라 절단과 동일).
  select floor(37000.0 * greatest(p_level, 0) / (greatest(p_level, 0) + 20))::integer;
$$;

comment on function public.lineage_guardian_bonus_bp(integer) is
  '계보 수호 가지 보너스(bp). data/lineage.ts branchBonusBp(L, GUARDIAN_BONUS_CAP_BP=37000, K=20) 미러.';

-- ---------------------------------------------------------------------------
-- ② 호출부를 정본 함수로 (M7a 본문 + 보너스 계산 두 줄만 교체)
-- ---------------------------------------------------------------------------

create or replace function public.inject_guardian_authority(p_layout jsonb, p_profile_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slots     jsonb;
  v_slot      jsonb;
  v_level     integer;
  v_bonus_bp  integer;
  v_milestone integer;
  v_new       jsonb := '[]'::jsonb;
  v_live      jsonb[] := array[]::jsonb[];
  v_row       record;
  v_i         integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    return p_layout;
  end if;
  v_slots := p_layout->'l3'->'guardians';
  -- 수호 슬롯이 없는(구 스키마·손상) layout 은 손대지 않는다 — 정규화가 별도로 처리한다.
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
    return p_layout;
  end if;

  select coalesce(lineage_guardian_level, 0) into v_level
    from public.profiles where id = p_profile_id;
  if v_level is null or v_level <= 0 then
    v_level := 0;
    v_bonus_bp := 0;
  else
    -- ⚠️ 곱선을 여기서 다시 적지 마라. 정본은 public.lineage_guardian_bonus_bp 하나다
    -- (이 함수가 곱선을 복제하고 있어서 TS 상한 상향이 실 PvP 에 영영 안 닿았다).
    v_bonus_bp := public.lineage_guardian_bonus_bp(v_level);
  end if;
  v_milestone := 0;
  if v_level >= 10 then v_milestone := v_milestone + 1; end if;
  if v_level >= 25 then v_milestone := v_milestone + 2; end if;
  if v_level >= 50 then v_milestone := v_milestone + 4; end if;

  -- 활성 수호 최대 2기(INVASION_GUARDIAN_SLOTS)를 정렬 순서대로 모은다.
  for v_row in
    select data, performance
    from public.guardians
    where profile_id = p_profile_id and retired = false
    order by created_at asc, id asc
    limit 2
  loop
    v_live := v_live || jsonb_build_object('data', v_row.data, 'perf', coalesce(v_row.performance, 100));
  end loop;

  -- 슬롯 0..1 제자리 치환(고정 길이 2 — 밀집화 금지).
  for v_i in 0..1 loop
    v_slot := v_slots->v_i;
    if v_slot is null or jsonb_typeof(v_slot) <> 'object' or array_length(v_live, 1) is null
       or v_i + 1 > array_length(v_live, 1) then
      v_new := v_new || jsonb_build_array('null'::jsonb);
    else
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'x', public.invasion_num(v_slot, 'x', 0),
        'y', public.invasion_num(v_slot, 'y', 0),
        'snapshot', v_live[v_i + 1]->'data',
        'performanceCP', round((v_live[v_i + 1]->>'perf')::numeric * 100)::integer,
        'lineageBonusBp', v_bonus_bp,
        'milestones', v_milestone
      ));
    end if;
  end loop;

  return jsonb_set(p_layout, '{l3,guardians}', v_new);
end;
$$;
