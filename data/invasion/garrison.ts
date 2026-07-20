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
 * | L1 웨이브 슬롯 | 정찰 드론편대 lv1 노말 |
 * | L2 설치 소켓 | 속사포 lv1 노말 |
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
import { FORMATION_SCOUT_DRONES } from './formations.js';
import { GARRISON_FACILITY_CATALOG_ID } from './facilities.js';

// ---------------------------------------------------------------------------
// 충원값
// ---------------------------------------------------------------------------

/** 빈 웨이브 슬롯을 채우는 편대 catalogId — 정찰 드론편대. */
export const GARRISON_FORMATION_CATALOG_ID = FORMATION_SCOUT_DRONES;

/** 빈 설치 소켓을 채우는 설비 catalogId — 속사포. */
export { GARRISON_FACILITY_CATALOG_ID };

/**
 * 충원 방어체의 강화 3축 — lv1 · 승급 0 · 노말 · 어픽스 시드 0.
 * 카탈로그 배율 산식(formationPowerCp 등)에서 정확히 100cp(=×1.00)가 나오는 기준값이다.
 */
export const GARRISON_LEVEL = 1;
/** 충원 방어체 승급 단계. */
export const GARRISON_ASCENSION = 0;
/** 충원 방어체 등급 코드(0 = normal). */
export const GARRISON_RARITY = 0;
/** 충원 방어체 어픽스 시드(고정 0 — 어픽스 없음). */
export const GARRISON_AFFIX_SEED = 0;

/** 충원용 Ref 1건을 만든다. 전 필드 정수 · 입력 무관 상수라 결정론적이다. */
export function garrisonRef(catalogId: number): InvasionRef {
  return {
    catalogId,
    level: GARRISON_LEVEL,
    ascension: GARRISON_ASCENSION,
    affixSeed: GARRISON_AFFIX_SEED,
    rarity: GARRISON_RARITY,
  };
}

// ---------------------------------------------------------------------------
// 충원 적용
// ---------------------------------------------------------------------------

/** 파생 사본 캐시. 키 = 원본 layers 객체 신원. 순수 함수의 메모이즈라 재현성에 영향 없다. */
const cache = new WeakMap<InvasionLayers, InvasionLayers>();

/** 슬롯 배열의 null 을 충원 Ref 로 채운 새 배열. 채울 게 없으면 원본 배열을 그대로 돌려준다. */
function fillSlots(
  slots: readonly (InvasionRef | null)[],
  catalogId: number,
): (InvasionRef | null)[] {
  const out: (InvasionRef | null)[] = new Array<InvasionRef | null>(slots.length);
  for (let i = 0; i < slots.length; i++) {
    const ref = slots[i];
    out[i] = ref === null || ref === undefined ? garrisonRef(catalogId) : ref;
  }
  return out;
}

/**
 * 빈 슬롯이 기본 수비대로 채워진 **파생 사본**을 돌려준다. 원본은 절대 변형하지 않는다.
 *
 * L3(기물·수호·보스·코어 모듈)는 손대지 않으므로 `l3` 는 원본 객체를 그대로 공유한다 —
 * 사본을 만들 이유가 없고, 공유해야 코어 HP 같은 런타임 참조가 원본과 갈리지 않는다.
 */
export function garrisonLayers(layers: InvasionLayers): InvasionLayers {
  const hit = cache.get(layers);
  if (hit !== undefined) return hit;
  const filled: InvasionLayers = {
    l1: { waveSlots: fillSlots(layers.l1.waveSlots, GARRISON_FORMATION_CATALOG_ID) },
    l2: {
      templateId: layers.l2.templateId,
      sockets: fillSlots(layers.l2.sockets, GARRISON_FACILITY_CATALOG_ID),
    },
    // L3 는 충원 대상이 아니다(기물=비움 / 보스=coreRoom 폴백 / 수호·모듈=자산).
    l3: layers.l3,
  };
  cache.set(layers, filled);
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
  const filled = garrisonLayers(ctx.layers);
  if (filled === ctx.layers) return ctx;
  return { layers: filled, runtime: ctx.runtime, maintenance: ctx.maintenance };
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
