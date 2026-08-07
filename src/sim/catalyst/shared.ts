/**
 * 촉매 그룹 모듈의 **공용 리프**(ADR-0052 배선 기반 레인).
 *
 * ## 왜 `src/sim/catalyst/` 를 그룹별로 가르는가
 * 카드 45종을 **병렬 레인이 동시에** 채운다. 한 파일이면 레인마다 같은 파일의 같은 함수를
 * 만져 **매 머지가 충돌**하고, 충돌 해소가 사람 손이라 조용한 유실이 생긴다(이 저장소는
 * 병렬 머지에서 `tsc` 만 잡히고 거동이 갈린 전례가 있다). 그룹 = 카드 id 5장 묶음이라
 * 레인 하나가 파일 하나를 통째로 소유한다.
 *
 * 이 파일에는 **그룹을 가로지르는 것만** 둔다 — 그룹 모듈 전체가 쓰는 술어와, 촉매 해저드의
 * 스폰 규약이다. 카드 효과는 여기 넣지 마라(그 순간 이 파일이 다시 충돌 지점이 된다).
 *
 * ## ⚠️ 순환 금지
 * 이 디렉터리의 모듈은 `world.js` 를 **type-only** 로만 import 한다. 값이 필요하면
 * `catalystHooks.ts` 가 인자로 넘긴다. 아래 값 import 는 전부 리프다:
 * `entities.js`(→`grudgeGate.js` 하나) · `catalystMarks.js` · `data/catalysts.js`.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { spawnHazard, hazardActive } from '../entities.js';
import { readMark } from '../catalystMarks.js';
import { hasCatalyst } from '../../data/catalysts.js';

// ---------------------------------------------------------------------------
// 카드 소지 판정 — 전 그룹 공용
// ---------------------------------------------------------------------------

/**
 * 이 런에 촉매 `id` 가 실려 있는가. **정본은 여기 하나다**(`catalystHooks.ts` 는 재수출한다).
 *
 * `state.catalystOn` 은 "촉매가 하나라도 있는가" 까지만 말한다. 카드별 분기는 반드시 이 술어를
 * 한 번 더 통과해야 한다 — 안 그러면 아무 촉매 한 장만 껴도 48종 전부의 효과가 켜진다.
 *
 * 순회 비용은 **최대 3**이다(헌장 §구조 계약: 슬롯 3장). 매 틱 도는 앵커에서도 무시할 수
 * 있고, 그래서 파생 비트마스크를 `WorldState` 에 새로 만들지 않았다(새 칸을 만들면 §B 다).
 *
 * ⚠️ 정규화 전 배열을 그대로 본다 — 존재 여부만 쓰므로 중복 제거가 결과를 바꾸지 않는다.
 */
export function carries(state: WorldState, id: number): boolean {
  const cats = state.config.catalysts;
  return cats !== undefined && hasCatalyst(cats, id);
}

// ---------------------------------------------------------------------------
// 팬아웃 합성 규약 — **중립값은 여기 하나가 소유한다**
// ---------------------------------------------------------------------------

/**
 * 전리품 앵커의 반환 — **등급 배율**과 **개수 배율** 한 쌍.
 *
 * 선언이 `catalystHooks.ts` 가 아니라 여기인 이유: 그룹 모듈 13개가 전부 이 타입을 반환하는데,
 * 그룹이 `catalystHooks.js` 를 값으로 import 하면 **순환**이다(디스패처가 그룹을 끈다).
 * `catalystHooks.ts` 는 이것을 그대로 재수출한다(기존 소비자 시그니처 불변).
 */
export interface CatalystLootRoll {
  /** 등급 롤에 곱하는 배율(`rollEliteDrop`/`rollBossDrop` 의 `rarityMult`). */
  rarity: number;
  /** 추가 루팅 파생 배율(`bonusLootSeeds` 의 배율). */
  count: number;
}

/**
 * 배율형 앵커의 **중립 한 쌍**. 자기 몫이 없는 그룹은 새 객체를 만들지 말고 **이것을 그대로**
 * 돌려준다 — 적 격추마다 도는 자리라 13개 그룹이 각자 리터럴을 만들면 그만큼 할당이 생긴다.
 *
 * ⚠️ **얼려 둔다.** 소비자가 실수로 `r.rarity = 2` 를 쓰면 그 순간 전 그룹의 중립값이 오염돼
 * 다른 카드의 배율이 조용히 바뀐다. 얼려 두면 그 실수가 개발 중에 즉시 터진다.
 */
export const CATALYST_LOOT_NEUTRAL: CatalystLootRoll = Object.freeze({ rarity: 1, count: 1 });

// ---------------------------------------------------------------------------
// 촉매 해저드 — 판별자 · 동시 상한 · 스폰 헬퍼
// ---------------------------------------------------------------------------

/**
 * 촉매가 낳은 해저드의 **서브타입 코드**(`hazard.enemyType`).
 *
 * ## 왜 `ownerId` 센티넬이 아니라 서브타입인가 (코드 실측)
 * `spawnHazard` 의 두 번째 인자 이름 자체가 `subtype` 이고, 그 칸은 이미 종류 판별에 쓰이는
 * **지정된 자리**다. 반면 `ownerId` 는 촉매가 아닌 소비자가 이미 **의미를 싣고 있다** —
 * 오염 지형은 `hazard.ownerId` 에 뿌린 노드의 `id` 를 새기고(`modes/contamination.ts`
 * `purifyContamination`), 침공 설비 해저드도 소유 설비를 싣는다. 센티넬을 끼우면 "노드 id 와
 * 절대 안 겹치는 값"을 영구히 지켜야 하는 전역 제약이 생긴다.
 *
 * ## 값이 4 인 근거 — 기존 소비자 전수 대조
 * 서브타입 코드는 **선언처가 흩어진 공용 번호 공간**이다:
 * `HAZARD_MORTAR = 0` · `HAZARD_LAVA = 1` · `HAZARD_SLOW = 2`(`patterns/types.ts`) ·
 * `HAZARD_TERRAIN = 2`(`chunks.ts` — **2 가 이미 겹쳐 있다**. 그 겹침은 종전 거동이고 이
 * 레인의 소관이 아니지만, 번호가 공용이라는 물증이다) · `HAZARD_CONTAMINATION = 3`
 * (`modes/contamination.ts`).
 *
 * 실제로 이 칸을 **읽는 곳은 넷뿐**이고(`world.ts` 의 감속 지대 `=== HAZARD_SLOW` ·
 * `modes/contamination.ts:168` 의 `=== HAZARD_CONTAMINATION` · `render/entityRenderer.ts:529`
 * 와 `render/entity/hazardHost.ts:213` 의 `=== HAZARD_LAVA`) 넷 다 **등가 비교**라,
 * 어느 것과도 같지 않은 `4` 는 기존 소비자를 한 곳도 건드리지 않는다.
 */
export const HAZARD_CATALYST = 4;

/** 이 엔티티가 촉매가 낳은 해저드인가. */
export function isCatalystHazard(e: Entity): boolean {
  return e.kind === 'hazard' && e.enemyType === HAZARD_CATALYST;
}

/**
 * 촉매 해저드의 **동시 생존 상한**.
 *
 * ## 왜 상한이 필요한가 — 기존 예산이 촉매 해저드를 **한 개도 안 센다**
 * `MAX_ACTIVE_GIMMICKS`(160, `chunks.ts`)는 청크 생성 예산이고, 그 `isGimmick` 이 세는
 * 해저드 조건은 **`life < 0`(영구 지형)뿐**이다. 촉매 해저드는 시한부(`life > 0`)라 그 카운트에
 * 안 들어가고, 그래서 지금은 **아무 상한도 없다.**
 *
 * ## 값 12 의 근거
 * 선례를 그대로 따랐다 — `PO8_LIVE_CAP = 12`(`skills/bubble.ts`). 그쪽도 "여러 소스가 어긋나게
 * 맞물려 수명 창 안에 수십 개가 설 수 있는" 같은 형태의 문제였고 12 로 묶었다. 촉매 쪽 소비
 * 카드는 여섯이다(`id 2`·`id 8`·`id 31`·`id 34`·`id 37`·`id 43`) — 런당 촉매는 **3장**이라
 * 동시에 뜰 수 있는 것은 최대 3종이고, 종당 4장이면 12 다. 상한을 더 키우면 매 틱 도는
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 격자 질의 횟수가 그대로 커진다.
 *
 * ⚠️ **촉매 해저드를 영구(`life < 0`)로 만들지 마라.** 그 순간 `isGimmick` 에 걸려
 * `MAX_ACTIVE_GIMMICKS` 를 잠식하고, 청크 생성이 원자적이라 **뒤쪽 청크가 통째로 보류**된다.
 * 어느 청크가 보류되는지는 플레이어 경로에 의존하므로 **경로 독립성이 깨진다.**
 * {@link spawnCatalystHazard} 이 음수 수명을 던져서 막는다.
 */
export const CATALYST_HAZARD_LIVE_CAP = 12;

/**
 * 촉매 해저드를 하나 낳는다. **상한을 넘으면 스폰만 생략하고 `undefined` 를 돌려준다.**
 *
 * ⚠️ **RNG 를 한 칸도 소비하지 않는다** — 상한 도달 여부와 무관하게 난수를 안 쓰므로, 생략돼도
 * 이후 시드 소비가 밀리지 않는다(`PO8_LIVE_CAP` 선례의 핵심이 그것이다).
 *
 * ⚠️ 호출부가 `for (const e of state.entities)` 순회 **안**이면 부르지 마라(훅에서 스폰 금지
 * 규율). 좌표만 모아 순회 밖에서 불러라.
 *
 * @param activeTicks 활성 지속 틱. **음수 금지**(영구 해저드는 청크 예산을 잠식한다 — 위 참조).
 */
export function spawnCatalystHazard(
  state: WorldState,
  x: number,
  y: number,
  radius: number,
  windup: number,
  activeTicks: number,
  damage: number,
  continuous: boolean,
): Entity | undefined {
  if (activeTicks < 0) {
    throw new Error(`catalyst hazard must be timed (activeTicks=${activeTicks}); 영구 금지`);
  }
  let live = 0;
  for (const e of state.entities) {
    if (!e.dead && isCatalystHazard(e)) live++;
  }
  if (live >= CATALYST_HAZARD_LIVE_CAP) return undefined;
  return spawnHazard(state, HAZARD_CATALYST, x, y, radius, windup, activeTicks, damage, continuous, 0);
}

/** 지금 피해를 주는 촉매 해저드인가(예열이 끝났고 만료되지 않았다). */
export function catalystHazardDamaging(e: Entity): boolean {
  return isCatalystHazard(e) && hazardActive(e) && e.damage > 0;
}

// ---------------------------------------------------------------------------
// 조준 술어 — **등재와 제외는 한 쌍이다**(헌장)
// ---------------------------------------------------------------------------

/**
 * 이 엔티티가 **촉매가 세운 목표물**인가 — `modes/objective.ts` 의 등재 자리.
 *
 * ⚠️ **지금은 빈 술어다(항상 거짓). 누락이 아니라 미배선이다.**
 * 여기 들어올 카드는 다섯이다 — `id 19`(광석) · `id 21`(결정) · `id 23`(씨앗/나무) ·
 * `id 41`(관문) · `id 47`(블록). 다섯 다 **아직 스폰하는 코드가 없어** 판별할 마커 자체가
 * 존재하지 않는다. 마커 없이 `destructible` 을 넓게 잡으면 절차 청크 지형이 조준을 훔쳐
 * **모든 무대의 거동이 바뀐다**(`modes/objective.ts` 헤더 §"왜 destructible 전체를 넣지
 * 않는가"). 카드 레인이 스폰과 마커를 같이 세울 때 여기를 채워라.
 *
 * ⭐ 채울 때 **{@link isCatalystShadow} 쪽 제외와 같이** 봐라. 이 저장소는 "맞기는 하지만
 * 조준되지는 않는" 결함을 네 번 냈고, 반대로 "조준은 되는데 아군탄 화이트리스트에 없는"
 * 무적 차폐물도 냈다. 쌍 유지 3목록 = ①조준 술어(`world.ts` `isPlayerTargetable`)
 * ②충돌 격자 등록 ③아군탄 표적 화이트리스트.
 */
export function isCatalystObjective(e: Entity): boolean {
  void e;
  return false;
}

/**
 * `id 36 niflheim-pursuit` 의 **그림자**인가 — 죽일 수 없고, 조준 대상이 아니고, 적 수에도
 * 안 들어간다.
 *
 * 표식은 `aux0` 의 `shadow` 비트다({@link import('../catalystMarks.js').CATALYST_MARK}).
 * **무촉매 런은 그 비트가 전부 0** 이라 이 술어가 항상 거짓이고, 그래서 호출부에 얹어도
 * 바이트 불변이다(읽기에는 게이트가 필요 없다 — `catalystMarks.ts` §결정론).
 */
export function isCatalystShadow(e: Entity): boolean {
  return e.kind === 'enemy' && readMark(e, 'shadow') !== 0;
}
