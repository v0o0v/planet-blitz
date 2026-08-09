/**
 * 침공 3레이어 — 기본 수비대 자동 충원 (M7a · L9-garrison-catalog, 결정 #22).
 *
 * ## 왜 필요한가
 * 방어자가 슬롯을 비워 두면 그 자리는 **아무것도 스폰되지 않는다**(formation.ts:154 /
 * facility.ts:225 가 null 슬롯을 조용히 건너뛴다). 그러면 전 슬롯을 비운 배치가 곧 "무저항
 * 기지"가 되어, 배치를 안 한 방어자가 오히려 침공당해도 손해를 덜 보는 역인센티브가 생기고
 * 신규 프로필의 첫 침공이 5분간 빈 회랑을 나는 무내용 런이 된다. 그래서 빈 슬롯에는 최소한의
 * 기본 수비대가 자동으로 선다.
 *
 * ## 충원 규칙 (결정 #22)
 * | 빈 자리 | 충원 |
 * |---|---|
 * | L1 웨이브 슬롯 | 요격 편대 ↔ 강습 돌격편대 순환(슬롯 인덱스), 기본 수비대 레벨 |
 * | L2 설치 소켓 | 앞쪽 `l2GarrisonSpawners` 칸은 **드론 스포너** lv1 노말, 나머지는 속사포 lv1 노말 |
 * | L3 기물 소켓 | **비움**(충원 안 함 — 코어방 과충전 방지) |
 * | L3 보스 슬롯 | 여기서 안 한다. `coreRoom.ts` 가 스폰 단계에서 이미 기본 보스로 폴백한다 |
 * | L3 수호 슬롯 | 충원 안 함(수호는 퇴역 기체 자산이라 합성이 성립하지 않는다) |
 * | L3 코어 모듈 | 충원 안 함(소모성 자산) |
 *
 * **보스를 여기서 채우면 이중 스폰이 된다.** coreRoom 의 폴백(`l3.boss ?? 기본 보스`)과 겹치기
 * 때문이 아니라 — 겹치면 폴백이 안 타서 조용히 같은 결과가 나온다 — 뒤에 보스 슬롯이 2 이상으로
 * 늘 때 충원 주체가 둘이 되어 갈리기 때문이다. 보스 충원의 유일한 주체는 coreRoom 이다.
 *
 * ## 충원은 '정규화'가 아니라 '스폰 단계 주입'이다
 * 충원된 방어체는 소유·강화·풍화 대상이 아니다. 그래서 `defenses.layout` jsonb 에도,
 * `hashWorld` 침공 블록에도 **절대 실리면 안 된다** — 실리면 "빈 슬롯"과 "기본 수비대를 손으로
 * 배치한 슬롯"이 같은 해시가 되어 두 상태를 구분할 수 없게 되고, 클라가 정규화 시점에 충원하고
 * 서버가 안 하면(또는 그 반대) 전 침공이 `defense-mismatch` 로 오거부된다.
 *
 * 그래서 {@link garrisonLayers} 는 **원본을 변형하지 않고 파생 사본을 돌려준다**. 직렬화·해시가
 * 보는 것은 언제나 원본(`config.invasion3.layers`)이고, 스텝 훅이 보는 것만 사본이다.
 *
 * 결정론: 순수 함수다(RNG·시각 미소비). 파생 사본은 입력 객체 신원 기준 메모이즈되므로 18000틱
 * 동안 매 틱 재할당하지 않는다 — 메모이즈는 순수 함수의 캐시일 뿐이라 재현성에 영향이 없다.
 */

import type {
  InvasionLayers,
  InvasionRef,
  InvasionStepContext,
} from '../../src/sim/invasion/types.js';
import { INVASION_LEVEL_MAX, INVASION_LEVEL_MIN } from '../../src/sim/invasion/constants.js';
import {
  FORMATION_ASSAULT,
  FORMATION_INTERCEPTORS,
  FORMATION_SCOUT_DRONES,
} from './formations.js';
import { GARRISON_FACILITY_CATALOG_ID, SPAWNER_FACILITY_CATALOG_ID } from './facilities.js';

// ---------------------------------------------------------------------------
// 충원값
// ---------------------------------------------------------------------------

/**
 * 빈 웨이브 슬롯을 채우는 편대 — **슬롯 인덱스로 순환**한다.
 *
 * ## 왜 정찰 드론편대를 뺐나 (2026-08-10, 사용자 제기 "기본 방어체가 총을 한발도 안 쏜다")
 * 구값은 `FORMATION_SCOUT_DRONES` 하나였다. "가장 가벼운 기본 편대"라는 이유였는데, 그
 * 편대의 구성원 5기가 전부 **수리드론**이고 그 정의가
 * `movement: 'seekWounded'` / `attack: { kind: 'heal' }` 다 — **플레이어를 향한 공격이 아예
 * 없다.** 실측: 기본 수비대만 있는 L1 에서 **5,399틱(90초) 동안 적탄 0발**(같은 런의 L2 는
 * 873발, L3 는 477발). 위협은 접촉 피해 6 뿐이었고, 5기가 서로를 치유해 더 질겼다.
 *
 * ⚠️ **이 저장소에서 같은 결함을 두 번째로 밟았다.** L3 코어 증원도 "가장 가벼운 잡몹"을
 * 고르다 같은 수리드론을 집어 코어방이 133,200틱 동안 안 끝났다(→ GUNNER 로 교체).
 * 교훈은 하나다: **`data/enemies.ts` 의 `movement`·`attack` 을 안 보고 "가벼운 것"으로
 * 고르지 마라.** `role: 'support'` 는 혼자 두면 위협이 0 이다.
 *
 * ## 왜 카탈로그 정의를 안 고치고 기본값만 바꿨나
 * 정찰 드론편대는 **방어자가 직접 배치할 수도 있는** 카탈로그 항목이다. 다른 편대와 함께
 * 깔면 치유 역할이 실제로 성립하므로(그게 role 7 '지원'의 설계다) 정의를 바꾸면 그 배치를
 * 망친다. 바꿔야 할 것은 "아무것도 배치 안 했을 때의 바닥"뿐이다.
 *
 * ## 왜 한 종류가 아니라 순환인가
 * 6칸을 같은 편대로 채우면 바닥이 단조롭다. 두 역할을 번갈아 두면 **압박의 종류가 둘**이 된다:
 *   · `FORMATION_INTERCEPTORS` (역할 1 '기본 화력') — 박격포 6기, 거리를 잡고 예고 장판.
 *   · `FORMATION_ASSAULT`      (역할 2 '정면 돌진') — 파쇄차 4기, 돌진하며 파편탄을 뿌린다.
 * 선택은 **슬롯 인덱스의 순수 함수**라 결정론이 유지된다(RNG 미소비).
 */
export const GARRISON_FORMATION_CATALOG_IDS: readonly number[] = [
  FORMATION_INTERCEPTORS,
  FORMATION_ASSAULT,
];

/**
 * 슬롯 i 를 채울 편대 catalogId. 순환이라 슬롯 수가 바뀌어도 정의가 안 깨진다.
 */
export function garrisonFormationIdFor(slotIndex: number): number {
  const n = GARRISON_FORMATION_CATALOG_IDS.length;
  const i = ((slotIndex % n) + n) % n;
  return GARRISON_FORMATION_CATALOG_IDS[i] as number;
}

/**
 * 구 기본 충원 편대(정찰 드론편대). **더 이상 충원에 쓰지 않는다** — 위 주석 참조.
 * 카탈로그 항목 자체는 그대로라 방어자가 배치할 수 있고, 테스트가 구 거동을 참조한다.
 */
export const GARRISON_FORMATION_CATALOG_ID = FORMATION_SCOUT_DRONES;

/** 빈 설치 소켓을 채우는 설비 catalogId — 속사포. */
export { GARRISON_FACILITY_CATALOG_ID };

/**
 * 충원 방어체 레벨의 **중립값** — 강화 산식에서 정확히 100cp(×1.00)가 나오는 기준점이다.
 * 이 모듈은 순수 파생이므로 기본값도 중립이어야 한다(밸런스 수치를 데이터 층에 두면
 * 이 함수를 쓰는 모든 테스트가 밸런스 기본값 위에 올라탄다 — 실제로 한 번 그렇게 만들었다가
 * 침공 배선 테스트 29파일이 후보로 걸렸다).
 *
 * **실 침공 런이 쓰는 밸런스 기본값은 {@link INVASION_GARRISON_LEVEL_DEFAULT} 다** — 적용은
 * 런 조립 층(`src/main.ts` 의 침공 진입 두 경로)에서 한다.
 */
export const GARRISON_LEVEL = 1;

/**
 * **실 침공 런의 기본 수비대 레벨** — 밸런스 값.
 *
 * ## 왜 1 이 아닌가 (2026-08-10)
 * 충원체는 오래 lv1 이었다(카탈로그 기본 스탯 그대로 — 정찰드론 HP 30 · 박격포 26).
 * 그 값은 **침공에서 조종사 레벨이 봉인돼 있던 시절**의 것이다. 봉인을 풀면서 공격측이
 * Lv100 에서 피해·최대HP ×4.69 를 받게 되자 기본 수비대가 종잇장이 됐다 — 사용자 제기
 * "적의 기체 HP가 너무 낮아".
 *
 * 그래서 **공격측 만렙 배율에 대칭**인 레벨로 잡는다. 편대 강화가 `100 + (lv-1)*5` cp 이므로:
 *
 *   lv75 → `100 + 74*5 = 470` cp = **×4.70** ≈ 공격측 Lv100 의 ×4.69
 *
 * 침공은 엔드게임이라 **Lv100 이 시작점**이라는 것이 사용자가 잡은 전제다(기준선도 "만렙
 * 기체가 기본 수비대를 어느 정도 클리어하는가"). 그 위에서는 만렙 대칭이 중립이고, 저레벨
 * 공격자가 불리한 것은 설계 의도다.
 *
 * ## 왜 데이터 층이 아니라 런 조립 층에서 거는가
 * `garrisonRef`/`garrisonLayers` 의 기본값으로 두면 **침공 config 를 직접 만드는 테스트
 * 전부**(29파일)가 이 밸런스 값 위에서 돌게 된다. 그 테스트들은 대부분 Lv1 관측자로 배선을
 * 보는 것이라, ×4.70 아래에서는 관찰 창 안에 진행을 못 해 "배선이 없다"와 "배선은 있는데
 * 느리다"가 구분되지 않는다. 실제로 그렇게 만들었다가 되돌렸다.
 *
 * ⚠️ **이 값은 출발점이다.** 확정은 사용자가 하네스 침공 탭의 「수비대Lv」 슬라이더로 직접
 * 플레이해 정한다. 배치된 슬롯에는 걸리지 않으므로(방어자가 정한 레벨이 우선) 이 축이
 * 움직이는 것은 「아무것도 배치 안 한 기지」의 바닥뿐이다.
 */
export const INVASION_GARRISON_LEVEL_DEFAULT = 75;

/**
 * **실 침공 런의 방어측 내구도 배율**(basis-point). 2,000,000 = ×201.
 *
 * ## 값의 출처 — 사용자가 만렙 장비로 직접 플레이해 확정했다 (2026-08-10)
 * 이 축은 코드가 유도할 수 없다. 기준선이 「**만렙 기체**가 기본 수비대를 어느 정도
 * 클리어하는가」이고, 그 "어느 정도"는 사람이 쳐 봐야 아는 값이다. 하네스 침공 탭의
 * 「방어HPbp」 슬라이더로 확정했다.
 *
 * ⚠️ **봇 계측으로 이 값을 다시 유도하려 하지 마라.** 참조봇(`autopilotInput`)과 기본 하네스
 * 프로필은 무장 Lv1 이라 실제 만렙 빌드와 화력이 자릿수로 다르다 — 코어 DPS 실측이 122 vs
 * 약 19,000(156배)이었다. 재계측이 필요하면 하네스 침공 탭 「장비 = maxed」로 사람이 친다.
 *
 * 수렴 이력(전부 사용자 체감): 0 → 70,000(×8) → **2,000,000(×201)**.
 */
export const INVASION_DEFENSE_HP_BP_DEFAULT = 2_000_000;

/**
 * **실 침공 런의 방어측 피해 배율**(basis-point). 10,000 = ×2.00.
 *
 * HP 축(×201)과 **자릿수가 다르다** — 이것이 두 축을 가른 이유 그대로다. 같은 배수를 피해에
 * 걸면 플레이어가 한 대에 죽는다(사용자 실측: "hp가 적당한데 대신 공격력이 너무 쎄다").
 * 피해는 이미 `수비대Lv`(×4.70)가 올려 놓았고 여기서는 그 위에 2배만 얹는다.
 *
 * 수렴 이력: 0 → 300(×1.03) → **10,000(×2.00)**.
 */
export const INVASION_DEFENSE_DAMAGE_BP_DEFAULT = 10_000;

/**
 * **실 침공 런의 코어 전용 추가 내구도 배율**(basis-point). 20,000 = ×3.00.
 *
 * HP 축(×201) 위에 한 번 더 곱하므로 코어 실효 내구도는 기본 배치값 8000 기준
 * `8000 × 201 × 3` ≈ **480만**이 된다.
 *
 * 코어를 따로 두는 이유는 잡몹과 필요 배수가 다르기 때문이다 — 잡몹이 적당한 배수에서 코어는
 * 만렙 장비(코어 DPS 약 19,000) 앞에서 3초에 부서졌다. 다만 HP 축 자체가 ×201 로 커지면서
 * 코어 전용분은 오히려 ×10 → ×3 으로 **줄었다**: 두 축이 곱해지므로 한쪽이 커지면 다른 쪽은
 * 작아도 된다.
 *
 * ⚠️ 기지 데이터의 `l3.core.hp` 를 올리는 방법도 있었지만 **시드 기지가 8000 을 하드코딩**한다
 * (`src/bench/invasionBands.ts` `seedBaseLayers` + 램프 SQL). 기본 상수만 올리면 NPC 기지만
 * 옛 값에 남아 갈린다. 배율은 스폰 시점에 걸리므로 모든 기지에 균일하다.
 */
export const INVASION_DEFENSE_CORE_HP_BP_DEFAULT = 20_000;

/** 충원 방어체 승급 단계. */
export const GARRISON_ASCENSION = 0;
/** 충원 방어체 등급 코드(0 = normal). */
export const GARRISON_RARITY = 0;
/** 충원 방어체 어픽스 시드(고정 0 — 어픽스 없음). */
export const GARRISON_AFFIX_SEED = 0;

/**
 * 충원용 Ref 1건을 만든다. 전 필드 정수 · 입력의 순수 함수라 결정론적이다.
 *
 * `level` 은 튜닝 축이다({@link Invasion3Config.garrisonLevel}) — 미지정이면
 * {@link GARRISON_LEVEL}(1)로 구 거동과 바이트 동일하다. 등급·승급·어픽스 시드는 고정으로
 * 둔다: 레벨은 매끄러운 축이라 슬라이더로 다루기 좋지만, 등급은 계단이라 같은 자리에 두면
 * "한 칸 올렸는데 체감이 확 뛴다"가 된다.
 */
export function garrisonRef(catalogId: number, level: number = GARRISON_LEVEL): InvasionRef {
  return {
    catalogId,
    level,
    ascension: GARRISON_ASCENSION,
    affixSeed: GARRISON_AFFIX_SEED,
    rarity: GARRISON_RARITY,
  };
}

/**
 * 기본 수비대 레벨을 정규형으로 접는다. 손상 입력·미지정은 {@link GARRISON_LEVEL}(1).
 * 상한은 배치 Ref 와 같은 도메인이다(`INVASION_LEVEL_MAX`) — 두 축이 같은 산식을 쓰므로
 * 범위도 같아야 한다.
 */
export function normalizeGarrisonLevel(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return GARRISON_LEVEL;
  const v = Math.trunc(raw);
  if (v < INVASION_LEVEL_MIN) return INVASION_LEVEL_MIN;
  if (v > INVASION_LEVEL_MAX) return INVASION_LEVEL_MAX;
  return v;
}

// ---------------------------------------------------------------------------
// 충원 적용
// ---------------------------------------------------------------------------

/**
 * 파생 사본 캐시. 키 = (원본 layers 객체 신원 → 스포너 기수). 순수 함수의 메모이즈라
 * 재현성에 영향이 없다.
 *
 * 2단인 이유: 충원 결과가 이제 `layers` 만의 함수가 아니라 **밀도 축의 `l2GarrisonSpawners`
 * 에도 의존**한다. 1단 WeakMap 으로 두면 하네스에서 슬라이더를 돌려도 첫 값으로 만든 사본이
 * 계속 반환돼 "노브가 안 먹는다"가 된다.
 */
const cache = new WeakMap<InvasionLayers, Map<number, InvasionLayers>>();

/**
 * L1 웨이브 슬롯 충원 — 빈 슬롯마다 {@link garrisonFormationIdFor} 로 편대를 번갈아 채운다.
 * 배치된 슬롯은 손대지 않는다.
 */
function fillWaveSlots(
  slots: readonly (InvasionRef | null)[],
  level: number,
): (InvasionRef | null)[] {
  const out: (InvasionRef | null)[] = new Array<InvasionRef | null>(slots.length);
  for (let i = 0; i < slots.length; i++) {
    const ref = slots[i];
    out[i] = ref === null || ref === undefined ? garrisonRef(garrisonFormationIdFor(i), level) : ref;
  }
  return out;
}

/**
 * L2 소켓 충원 — **앞쪽 빈 소켓 `spawners` 칸을 드론 스포너로**, 나머지 빈 소켓은 종전대로
 * 속사포로 채운다. 배치된 소켓은 손대지 않는다(유저가 꽂은 설비를 런타임이 바꾸면 배치
 * 계약이 깨진다).
 *
 * 순서가 「앞쪽부터」인 이유는 결정론이다 — 어느 빈 소켓이 스포너가 되는지가 배열 순서의
 * 순수 함수여야 리플레이가 재현된다. 스포너를 뒤쪽에 몰면 스크롤 진행상 늦게 활성화돼
 * (스포너는 `range` 2600 안에 플레이어가 있어야 사출한다) 밀도가 회랑 후반에 쏠린다.
 */
function fillFacilitySlots(
  slots: readonly (InvasionRef | null)[],
  spawners: number,
  level: number,
): (InvasionRef | null)[] {
  const out: (InvasionRef | null)[] = new Array<InvasionRef | null>(slots.length);
  let remaining = spawners;
  for (let i = 0; i < slots.length; i++) {
    const ref = slots[i];
    if (ref !== null && ref !== undefined) {
      out[i] = ref;
      continue;
    }
    if (remaining > 0) {
      out[i] = garrisonRef(SPAWNER_FACILITY_CATALOG_ID, level);
      remaining--;
    } else {
      out[i] = garrisonRef(GARRISON_FACILITY_CATALOG_ID, level);
    }
  }
  return out;
}

/**
 * 빈 슬롯이 기본 수비대로 채워진 **파생 사본**을 돌려준다. 원본은 절대 변형하지 않는다.
 *
 * L3(기물·수호·보스·코어 모듈)는 손대지 않으므로 `l3` 는 원본 객체를 그대로 공유한다 —
 * 사본을 만들 이유가 없고, 공유해야 코어 HP 같은 런타임 참조가 원본과 갈리지 않는다.
 */
export function garrisonLayers(
  layers: InvasionLayers,
  spawners = 0,
  level: number = GARRISON_LEVEL,
): InvasionLayers {
  const n = Number.isFinite(spawners) && spawners > 0 ? Math.trunc(spawners) : 0;
  const lv = normalizeGarrisonLevel(level);
  // 캐시 키는 (기수, 레벨) 두 축이다. 하나로 접으면 슬라이더 하나를 돌릴 때 다른 축의
  // 옛 사본이 반환돼 "노브가 안 먹는다"가 된다.
  const key = n * (INVASION_LEVEL_MAX + 1) + lv;
  let byKey = cache.get(layers);
  if (byKey === undefined) {
    byKey = new Map<number, InvasionLayers>();
    cache.set(layers, byKey);
  }
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const filled: InvasionLayers = {
    l1: { waveSlots: fillWaveSlots(layers.l1.waveSlots, lv) },
    l2: {
      templateId: layers.l2.templateId,
      sockets: fillFacilitySlots(layers.l2.sockets, n, lv),
    },
    // L3 는 충원 대상이 아니다(기물=비움 / 보스=coreRoom 폴백 / 수호·모듈=자산).
    l3: layers.l3,
  };
  byKey.set(key, filled);
  return filled;
}

/**
 * 스텝 컨텍스트의 `layers` 를 충원본으로 바꾼 파생 컨텍스트.
 *
 * 정본 배선은 `src/sim/invasion/step.ts` 의 `makeInvasionContext` 가 `garrisonLayers()` 를
 * 통과시키는 것이고, 이 헬퍼는 훅 단위로 감싸서 관찰할 때(테스트·하네스) 쓴다.
 * `runtime` 은 **참조로** 넘겨 페이즈 머신이 갱신하는 같은 객체를 계속 보게 한다.
 */
export function withGarrison(ctx: InvasionStepContext): InvasionStepContext {
  const filled = garrisonLayers(ctx.layers, ctx.density.l2GarrisonSpawners, ctx.garrisonLevel);
  if (filled === ctx.layers) return ctx;
  return { ...ctx, layers: filled };
}

/**
 * 배치가 실제로 몇 자리를 충원받는지(진단·UI 표시용). 순수 계산이라 sim 을 태우지 않는다.
 */
export function garrisonFillCount(layers: InvasionLayers): { waves: number; sockets: number } {
  let waves = 0;
  let sockets = 0;
  for (const s of layers.l1.waveSlots) if (s === null || s === undefined) waves++;
  for (const s of layers.l2.sockets) if (s === null || s === undefined) sockets++;
  return { waves, sockets };
}
