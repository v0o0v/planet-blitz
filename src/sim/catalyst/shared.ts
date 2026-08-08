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
/**
 * 볼리 파라미터 레코드 — **주무기 피해 배율 앵커**(`onVolleyParamsCatalyst`)의 인자 타입.
 *
 * ⚠️ 선언은 `skillHooks.ts` 가 소유한다(스킬 앵커 ⑯ 이 원 소비자다). 여기서 **재수출만** 하는
 * 이유는 그룹 모듈 13개가 전부 이 타입을 받는데, 그룹이 `skillHooks.js` 를 직접 끌면 촉매
 * 그룹의 import 면이 `skillHooks → skills/*` 사슬로 넓어지기 때문이다. **type-only 라
 * 컴파일에서 지워지므로 런타임 간선은 0 이고 순환이 원리적으로 생기지 않는다.**
 */
export type { VolleyParams } from '../skillHooks.js';
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
 * @param mark 카드별 판별 마커(`hazard.ownerId`). 기본 `0` — **기존 호출부는 값이 안 바뀐다**.
 *
 * ⚠️ `mark` 가 필요한 이유(실측): 촉매 해저드는 여섯 카드가 공유하는 틀이라 서브타입 하나로는
 * *"어느 카드가 낳았는가"* 를 못 가른다. `id 10`(예고선)과 `id 34`(젤리 띠)는 **둘 다 피해 0**,
 * `id 31`(용암)과 `id 2`·`id 8`(공용 장판)은 **둘 다 피해 > 0** 이라 값으로 가르려 들면 조용히
 * 섞인다. 촉매 해저드의 `ownerId` 는 지금까지 전부 `0` 이라 비어 있고, 오염·침공 설비가 쓰는
 * `ownerId` 는 **다른 서브타입**이라 번호 공간이 겹치지 않는다.
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
  mark = 0,
): Entity | undefined {
  if (activeTicks < 0) {
    throw new Error(`catalyst hazard must be timed (activeTicks=${activeTicks}); 영구 금지`);
  }
  let live = 0;
  for (const e of state.entities) {
    if (!e.dead && isCatalystHazard(e)) live++;
  }
  if (live >= CATALYST_HAZARD_LIVE_CAP) return undefined;
  return spawnHazard(
    state,
    HAZARD_CATALYST,
    x,
    y,
    radius,
    windup,
    activeTicks,
    damage,
    continuous,
    mark,
  );
}

/** 이 해저드가 `mark` 로 낳은 그 카드의 것인가(`mark !== 0` 인 카드만 쓴다). */
export function isCatalystHazardMarked(e: Entity, mark: number): boolean {
  return isCatalystHazard(e) && e.ownerId === mark;
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
 * ## ⭐ 등재는 **둘**뿐이다 — `id 19` 광석 · `id 41` 관문 (부수는 것이 규칙인 것만)
 * `id 21` 결정 · `id 23` 씨앗/나무는 **{@link isCatalystEnemyOnlyObject} 로 갈라 나갔다.**
 * 판정 근거는 규칙 문장이다(`src/i18n/catalog.ts` 가 정본):
 *  - `id 19` — *"부숴야 자원이 되며 **그동안 자동 조준이 그쪽에 묶인다**"*. 조준 구속이
 *    **문장에 명시된 대가**다. 빼면 카드가 대가 없는 순수 이득이 된다.
 *  - `id 41` — 관문은 *"통과"* 가 규칙이지만 **유한 HP 의 격추 대상**이고, 파괴는 그 관문을
 *    미통과로 확정시키는 **플레이어의 선택지**다({@link CATALYST_GATE_MARK} 주석이 정본).
 *
 * ⚠️ `id 47` 블록은 마커가 없다 — 블록 브레이크 벽은 `kind === 'wall'` 이라 이 틀 밖이다.
 *
 * ⭐ **등재와 제외는 한 쌍이다**(헌장). 쌍 유지 3목록 = ①조준 술어(`world.ts`
 * `isPlayerTargetable`) ②충돌 격자 등록 ③아군탄 표적 화이트리스트. 여기에 마커를 더할 때
 * 셋을 **같이** 봐라 — 이 저장소는 "맞기는 하지만 조준되지는 않는" 결함을 네 번 냈고,
 * 반대로 "조준은 되는데 아군탄 화이트리스트에 없는" 무적 차폐물도 냈다.
 *
 * `id 19` 광석의 세 목록 실측: ①은 `modes/objective.ts` → `isObjectiveDestructible` 을 거쳐
 * 이 술어가 곧바로 참을 만든다. ②③은 **이미 서 있다** — 광석은 신규 kind 가 아니라
 * `destructible` 틀이고, 오염 노드가 같은 틀로 이미 격자·아군탄 경로를 타고 있다. 신규 kind 를
 * 만들지 않은 것이 세 목록이 갈라지지 않는 이유 자체다(`onBossDeathCatalyst` 주석의 같은 경고).
 */
export function isCatalystObjective(e: Entity): boolean {
  if (e.kind !== 'destructible') return false;
  return e.ownerId === CATALYST_ORE_MARK || e.ownerId === CATALYST_GATE_MARK;
}

/**
 * 이 엔티티가 **적만 부술 수 있는 촉매 오브젝트**인가 — `id 21` 결정 · `id 23` 씨앗/나무.
 *
 * ## 왜 갈랐는가 — 자동조준이 플레이어의 보상을 갉고 있었다
 * `id 21` 의 미정착 결정을 조준 대상으로 등재했더니 **자동조준이 그것을 물어 플레이어가 자기
 * 보상을 부쉈다.** 이 게임에는 수동 조준이 없어 회피 수단이 위치뿐이라, 등재된 이상 플레이어가
 * 그것을 안 부술 방법이 없다.
 *
 * 규칙 문장에 **플레이어가 부순다는 조항이 없다**(`src/i18n/catalog.ts` 정본):
 *  - `id 21` — *"**적이 밟으면** 부서지고, 런을 이겨야 정착한다"* → 파괴 주체는 적뿐이다.
 *  - `id 23` 씨앗 — *"그 전에 **적이 밟으면** 씨앗을 먹고 강화된다"* → 같다.
 *  - `id 23` 나무 — *"15초 뒤 전리품 나무로 자라"* 고 **열매를 스스로 떨군다.** 다 떨군 나무는
 *    스스로 사라진다({@link import('./chain.js')} 의 결실 루프). 플레이어가 부술 이유가
 *    규칙 어디에도 없고, 부수면 남은 열매가 통째로 증발해 **카드의 이득이 사라진다.**
 *
 * ## ⚠️ 격자 등록은 **그대로 둔다** — 빼면 규칙 자체가 성립하지 않는다
 * `id 7 prospect` 선례와 정확히 같다. 격자에서 빼면 **적 접촉 판정까지 사라져** *"적이 밟으면"*
 * 이 영영 거짓이 된다 — 무적 오브젝트가 아니라 **없는 오브젝트**가 된다. 그래서 빼는 곳은
 * 둘뿐이고 **반드시 같이 움직인다**:
 *  1. 조준 술어 — 이 마커들이 {@link isCatalystObjective} 에서 빠졌으므로 `destructible` 은
 *     `isPlayerTargetable` 의 kind 목록에 없어 **자동으로** 거짓이다(추가 분기 불필요).
 *  2. 아군탄 명중 루프 — `destructible` 을 **kind 로 통째 통과**시키므로(`world.ts` 의
 *     화이트리스트) 여기서 명시적으로 빼지 않으면 *"조준은 안 되는데 유탄에는 맞는"* 상태가
 *     된다. 그 자리에서 이 술어를 부른다.
 *
 * 무촉매 런은 이 마커를 가진 개체가 아예 안 생기므로 항상 거짓이다(바이트 불변).
 */
export function isCatalystEnemyOnlyObject(e: Entity): boolean {
  if (e.kind !== 'destructible') return false;
  return (
    e.ownerId === CATALYST_SHARD_MARK ||
    e.ownerId === CATALYST_SEED_MARK ||
    e.ownerId === CATALYST_TREE_MARK
  );
}

/**
 * `id 41 arke-obelisk` 의 **관문** 마커(`destructible.ownerId`).
 *
 * 값 선정 사유는 {@link CATALYST_ORE_MARK} 와 같다(0 금지 · 기존 마커와 비충돌).
 *
 * ⚠️ **관문은 유한 HP 다 — 무적으로 만들지 마라.** 이 술어가 참이면 자동 조준이 관문을 물고,
 * 죽지 않는 표적이면 `objective.ts` 헤더 §결함 #3(당시 클리어율 18.6%)이 그대로 재현된다.
 * 관문 파괴는 그 관문을 **미통과로 확정**시킬 뿐이고 런을 막지 않는다.
 */
export const CATALYST_GATE_MARK = 0xc0de41;

/**
 * `id 21 catalysis` 의 **미정착 결정** 마커(`destructible.ownerId`).
 *
 * 값 선정 사유는 {@link CATALYST_ORE_MARK} 와 같다(0 금지 · 기존 마커와 비충돌 · `isGimmick`
 * 제외와 한 줄로 맞물린다).
 */
export const CATALYST_SHARD_MARK = 0xc0de21;

/** `id 23 seeding` 의 **씨앗** 마커(`destructible.ownerId`). 발아하면 {@link CATALYST_TREE_MARK} 로 바뀐다. */
export const CATALYST_SEED_MARK = 0xc0de23;

/**
 * `id 23 seeding` 의 **전리품 나무** 마커(`destructible.ownerId`).
 *
 * 씨앗과 마커를 **가른** 이유: 둘은 반경·HP·거동이 다르고, 무엇보다 *"적이 밟으면 먹힌다"* 는
 * 씨앗에만 성립한다. 한 마커에 `timer` 로 국면을 담으면 그 술어가 두 곳에 흩어진다.
 */
export const CATALYST_TREE_MARK = 0xc0de24;

/**
 * `id 16 foundry` 의 **포탑** 마커(`turretPickup.ownerId`).
 *
 * ## 왜 새 kind 가 아니라 기존 `turretPickup` + 마커인가
 * 포탑 기계는 이미 완비돼 있다 — `spawnEventObject('turretPickup', …)` · `activateTurret` ·
 * `stepTurrets`(자동 조준·격발·수명). 새 kind 를 만들면 조준 술어·충돌 격자·아군탄 화이트리스트
 * **세 목록이 동시에 갈라진다**(`isPlayerTargetable` 주석의 실측 사고가 그 형태다). 아군 소환물
 * 선례 셋(`DRONE_MARK` 드론 베이 · `BROOD_MARK` 병아리 · 센트리)이 전부 같은 틀을 쓴다.
 *
 * ## ⚠️ `isGimmick` 제외와 **한 쌍**이다
 * `world.ts` 의 `isGimmick` 이 `turretPickup` 을 청크 기믹으로 세는데, 촉매 포탑은 청크가 놓은
 * 것이 아니라 **플레이어 소환물**이다. 제외하지 않으면 `MAX_ACTIVE_GIMMICKS`(160)를 잠식하고,
 * 청크 생성이 원자적이라 **뒤쪽 청크가 통째로 보류**된다 — 어느 청크가 보류되는지가 플레이어
 * 경로에 의존하므로 **경로 독립성이 깨진다**. `DRONE_MARK`·`BROOD_MARK` 가 같은 줄에서 같은
 * 사유로 빠져 있다. 무촉매 런은 이 `ownerId` 를 가진 개체가 안 생겨 조건이 불변이다.
 */
export const CATALYST_FOUNDRY_MARK = 0xc0de16;

/**
 * `id 19 motherlode` 의 **광석 덩어리** 마커(`destructible.ownerId`).
 *
 * ## 왜 `ownerId` 인가 — 해저드와 반대로 고른 사유
 * {@link HAZARD_CATALYST} 는 서브타입(`enemyType`)을 골랐지만 파괴물 쪽은 사정이 반대다.
 * 이 저장소의 파괴물 판별은 **전부 `ownerId` 마커**로 서 있고(`CONTAMINATION_NODE_MARK` ·
 * `COUNTER_DEVICE_MARK` · `RACING_WALL_MARK`), 그 마커들을 읽는 자리가
 * `world.ts` 의 `isGimmick` 한 곳으로 모여 있다. 같은 축에 붙여야 청크 컬링 제외가 한 줄로
 * 맞물린다.
 *
 * ## 값이 0 이면 안 되는 이유
 * 절차 청크 지형 파괴물은 `ownerId === 0` 이다. 0 을 고르면 **모든 배경 바위가 조준을 훔친다** —
 * `modes/objective.ts` 헤더가 경고하는 바로 그 형태다. 기존 마커 어느 것과도 겹치지 않는
 * 큰 상수를 쓴다(`DRONE_MARK` 선례).
 */
export const CATALYST_ORE_MARK = 0xc0de19;

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

/** `id 7 prospect` 의 `prospect` 마크 값 — **광맥 보유자이고 지금은 뚫린다**(호위가 흩어졌다). */
export const PROSPECT_OPEN = 1;

/** `id 7 prospect` 의 `prospect` 마크 값 — **광맥 보유자이고 호위에 둘러싸여 무적이다**. */
export const PROSPECT_SHIELDED = 2;

/**
 * `id 7 prospect` 의 광맥 보유자가 **지금 무적인가** — 조준 제외·아군탄 제외의 유일 술어.
 *
 * ⭐ **등재와 제외는 한 쌍이다**(헌장). 이 술어를 보는 자리는 `world.ts` 의 둘이고 **같이
 * 움직여야 한다**:
 *  1. `isPlayerTargetable` — 안 걸면 자동조준이 무적 표적을 물어 **DPS 가 통째로 버려진다**
 *     (`modes/objective.ts` 헤더 §결함 #2 가 정확히 그 형태다).
 *  2. 아군탄 명중 루프(`resolveCollisions` 안 `grid.query` 콜백) — 안 걸면 "조준은 빠졌는데
 *     맞기는 하는" 반대편 결함이 된다.
 *
 * 격자 등록은 **그대로 둔다** — 빼면 접촉·픽업 판정까지 사라져 "무적인 적"이 아니라 "없는
 * 적"이 된다(`isCatalystShadow` 가 같은 이유로 등록을 남긴 선례).
 *
 * 무촉매 런은 `aux0` 의 `prospect` 비트가 전부 0 이라 항상 거짓이다(바이트 불변).
 */
export function isCatalystProspectShielded(e: Entity): boolean {
  return e.kind === 'enemy' && readMark(e, 'prospect') === PROSPECT_SHIELDED;
}

// ---------------------------------------------------------------------------
// `id 33 berdan-collapse` — 안전 원의 **중심**과 **게이트 잠금**
// ---------------------------------------------------------------------------
//
// ## ⚠️ 왜 이 셋이 `catalyst/berdan.ts` 가 아니라 여기 있는가 — **순환 때문이다**
// 안전 원의 중심을 읽어야 하는 자리는 넷이고 그중 둘이 `waves.ts`(스폰 링 · 세그먼트 전진
// 게이트)다. 그런데 `id 35`(군체 여왕)가 `waves.ts` 의 `summonEnemy` 를 **값으로** 써야 해서
// `berdan.ts → waves.ts` 간선이 이미 있다. 중심을 `berdan.ts` 에 두면 `waves.ts → berdan.ts`
// 가 생겨 **정확히 순환**이다. `waves.ts → catalyst/shared.ts` 간선은 이미 서 있으므로
// (`isCatalystShadow`, `waves.ts:15`) 여기에 두면 간선이 하나도 안 늘어난다.
//
// ## ⭐ 중심은 **틱의 순수 파생**이다 — 저장하면 안 된다
// 슬롯에 적으면 `hashWorld` 의 촉매 슬롯 폴드가 켜지고, 그 순간 폭이 늘어 **무촉매 베르단
// 골든이 갈린다**(`catalystSlots.ts` §"틱의 순수 파생은 슬롯이 아니다"가 이 카드를 이름으로
// 지목한다). 그래서 `mix32(floor(tick / JUMP), SALT)` 하나로 끝낸다.
//
// ## ⭐⭐ 게이트 잠금이 이 카드의 **최대 함정**이다
// 즉사 창 동안 새 원 안의 적이 전부 죽는다 → `shrinkRingCleared` 가 참이 된다 →
// **15초마다 세그먼트가 자동 전진**한다(런이 즉사 창 횟수만큼만에 보스까지 간다).
// 중심을 넷 다 인자화해도 이 결함은 남는다 — 원이 어디에 있든 즉사가 그 원을 비우기 때문이다.
// 그래서 **즉사 창 동안은 전진 게이트를 잠근다**({@link berdanCollapseLocked}). 잠금은 게이트
// 하나만 막고 모드의 정체성(안전 원·수축·보스)은 그대로 둔다 — 헌장 §모드 계약.

/** `id 33` 안전 원이 다른 곳으로 점프하는 주기(틱). 15초 @60틱. */
export const BERDAN_JUMP_TICKS = 900;

/** `id 33` 점프 직후 **즉사 창**(틱). 5초 @60틱. 이 창 동안 전진 게이트가 잠긴다. */
export const BERDAN_COLLAPSE_TICKS = 300;

/**
 * `id 33` 중심이 원점에서 벗어나는 최대 거리(축별, 월드 유닛).
 *
 * `SHRINK_INITIAL_RADIUS`(5500)의 절반보다 작게 잡아, 점프 직후에도 **시작 안전 원과 새 원이
 * 항상 겹치도록** 했다 — 겹치지 않으면 점프 순간 플레이어가 확정적으로 원 밖이 되어 "따라갈
 * 수 있는 압박"이 아니라 "피할 수 없는 피해"가 된다(헌장 §페널티 규율).
 */
export const BERDAN_CENTER_SPAN = 2200;

/** `id 33` 중심 파생 전용 소금 — 다른 파생과 스트림을 섞지 않는다. */
const BERDAN_SALT_X = 0x9e3779b1;
const BERDAN_SALT_Y = 0x85ebca6b;

/**
 * `drops.ts:95` 의 `mix32` 와 같은 형태의 **RNG 미소비 순수 파생**(공통-B(a)의 기본값).
 * 그쪽이 `export` 가 아니라 사본을 둔다 — 값이 아니라 **형태**를 따르는 것이 계약이다.
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 해시 하나를 `[-SPAN, +SPAN]` 정수로 접는다(정수 산술뿐 — 부동소수 없음). */
function centerOffset(h: number): number {
  return (h % (BERDAN_CENTER_SPAN * 2 + 1)) - BERDAN_CENTER_SPAN;
}

/**
 * 지금 이 틱의 안전 원 **중심 x**. `id 33` 미소지면 **`0`** — 그래서 호출부가 무조건 이 값을
 * 넘겨도 무촉매 런이 비트 불변이다(종전 하드코딩 원점과 같은 값).
 */
export function berdanSafeCenterX(state: WorldState): number {
  if (!carries(state, 33)) return 0;
  return centerOffset(mix32(Math.floor(state.tick / BERDAN_JUMP_TICKS), BERDAN_SALT_X));
}

/** 지금 이 틱의 안전 원 **중심 y**. `id 33` 미소지면 `0`. */
export function berdanSafeCenterY(state: WorldState): number {
  if (!carries(state, 33)) return 0;
  return centerOffset(mix32(Math.floor(state.tick / BERDAN_JUMP_TICKS), BERDAN_SALT_Y));
}

/**
 * 지금이 **즉사 창**인가 = **세그먼트 전진 게이트를 잠글 것인가**. `id 33` 미소지면 `false`.
 *
 * ⚠️ 이 술어가 없으면 즉사가 원을 비우는 순간 `shrinkRingCleared` 가 참이 되어 **15초마다
 * 세그먼트가 자동 전진**한다(위 §최대 함정). `tests/catalystBerdan.test.ts` 가 그것을 잠근다.
 */
export function berdanCollapseLocked(state: WorldState): boolean {
  if (!carries(state, 33)) return false;
  return state.tick % BERDAN_JUMP_TICKS < BERDAN_COLLAPSE_TICKS;
}
