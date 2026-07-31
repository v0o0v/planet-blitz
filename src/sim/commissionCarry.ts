/**
 * 의뢰 구간 전환의 **승계 계약** (계획 §A-5 · PA 레인 계약 §7).
 *
 * 다구간 의뢰는 구간마다 **새 월드를 만든다**. 그래서 "무엇이 구간을 넘어가고 무엇이 무대와
 * 함께 사라지는가"가 이 시스템의 가장 큰 결함 표면이다. 이 모듈은 그 분류를 **배열 하나로**
 * 못 박고, 전환 함수를 그 배열로부터 구동한다.
 *
 * ## 분류 원칙
 * - **안전망·부활류는 런 단위**(승계). 구간마다 되살아나면 N구간 = N회 부활이라 난이도가 붕괴한다.
 * - **페이싱·주기류는 무대 단위**(미승계). 새 무대는 새 리듬으로 시작한다.
 *
 * ## ⚠️ `tick` 은 승계하지 않는다
 * 절대-틱 임계 로직 전 계열이 잠재 결함이 되기 때문이다. 실증: `SUPPLY_SPAWN_TICKS = [1800, 6000]`
 * 과 `maybeSpawnSupply` 는 `state.tick < nextTick` 으로만 판정하는데 새 월드는 `supplyNextIndex: 0`
 * 이라, `tick` 이 9,000대면 **2구간 첫 두 틱에 보급선 2기가 몰리고 그 뒤 영원히 0기**다.
 * 결정론적이라 해시가 안 갈리고 밸런스 이상으로만 보인다. 누적 틱은 별도 런타임이 센다.
 * 이 선택이 낳는 "구간 곱셈"(보급 2기/구간 등)은 인지·수용했고 밸런스 큐에 등재돼 있다.
 *
 * ## 전수 대조 게이트 — 그리고 그 한계
 * 아래 세 배열의 합집합이 `keyof WorldState`(그리고 플레이어 `keyof Entity`)와 **정확히 일치**함을
 * 컴파일 타임에 양방향으로 단언한다. `WorldState` 에 필드를 하나 더하면 **컴파일이 깨진다** —
 * 그것이 이 파일의 존재 이유다.
 *
 * ⚠️ **한계를 못 박는다: `keyof` 는 선언된 키만 본다.** 중첩 런타임 객체(`wave`·`invasion3`·
 * `scrollRuntime` …) **내부**의 필드는 이 게이트가 보지 못한다. 현재는 그 객체들이 **전부 미승계**
 * 라 성립한다 — 어느 하나라도 승계 대상이 되는 순간 이 게이트는 그 내부에 대해 **항진**이 되고,
 * 그때는 해당 객체 전용 대조를 추가해야 한다. 런타임 키 누락은 `tests/commissionCarry.test.ts` 가
 * `Object.keys` 로 한 겹 더 받는다.
 *
 * ⚠️ **뮤테이션과 전수 대조는 병용해야 한다.** 뮤테이션은 목록에 *있는* 필드의 진단력만 증명한다.
 * 목록에 **없는** 필드는 제거할 것이 없어 원리적으로 못 잡는다 — 검토가 잡아낸 결함 2건
 * (플레이어 `Entity` 누락 · `tick`/`supplyNextIndex`)이 정확히 그 사각지대에서 나왔다.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';

// ---------------------------------------------------------------------------
// WorldState 분류 (61필드)
// ---------------------------------------------------------------------------

/**
 * 구간을 넘어 **값이 이월**되는 `WorldState` 필드.
 *
 * ⚠️ `tainted` 만 예외적으로 OR 누적이다({@link carryAcrossSegment} 참조) — 리셋하면 1구간의
 * 치트·하네스 개입이 전환 한 번으로 세탁되고, 정산 제외의 유일한 게이트(ADR-0008)가 무력화된다.
 *
 * ⚠️ `sigBit` 는 여기 없다 — `createWorld` 가 승계된 `config` 로부터 재계산하는 순수 파생값이다.
 * 파생값을 승계 목록에 넣으면 정본이 둘이 된다.
 *
 * ⚠️ `weapon`·`loot` 는 **참조**를 그대로 넘긴다. 이전 월드는 전환 직후 버려지므로 공유가
 * 안전하고, 복사하면 파워업이 누적한 무기 상태가 얕은/깊은 복사 경계에서 갈릴 수 있다.
 */
export const WORLD_CARRY = [
  // --- 성장(런 단위 진행도) ---
  'xp',
  'xpTotal',
  'level',
  'weapon',
  'magnetRadius',
  'magnetBuffTicks',
  // --- 런 산출물 ---
  'loot',
  'resources',
  'catalystResourceMilli',
  'kills',
  'gems',
  'maxCombo',
  // --- 무결성 ---
  'tainted',
  // --- 액티브 스킬 런타임 4정수(ADR-0041): 쿨다운·버프는 런 단위 자원이다 ---
  'activeCd0',
  'activeCd1',
  'activeBuff0',
  'activeBuff1',
  // --- 사연 관측 카운터 6개(비-해시 메타. 런 전체 누적이라야 정산 델타가 맞는다) ---
  'hitsTaken',
  'overchargeKills',
  'cloakBreaks',
  'broodLaunches',
  'cushionHealed',
  'filmPops',
] as const satisfies readonly (keyof WorldState)[];

/**
 * 명시적으로 **0 으로 되돌리는** `WorldState` 필드 — 현재 **없다**.
 *
 * 비어 있는 것이 정상이다: 구간 전환은 `createWorld` 로 **새 월드**를 만들므로, 승계하지 않는
 * 모든 필드는 이미 새 월드의 초기값(대개 0)을 갖는다. 명시 0 리셋이 필요한 것은 **객체가
 * 재사용되는** 플레이어 `Entity` 쪽뿐이다({@link ENTITY_RESET_ZERO}).
 *
 * 그래도 자리를 남기는 이유: 훗날 "승계는 하되 0 으로"인 필드가 생기면 여기가 그 자리이고,
 * 세 갈래 분류를 유지해야 전수 대조 식이 그대로 성립하기 때문이다.
 */
export const WORLD_RESET_ZERO = [] as const satisfies readonly (keyof WorldState)[];

/**
 * 새 무대에서 **새로 시작**하는 `WorldState` 필드(= 새 월드 초기값을 그대로 쓴다).
 *
 * 분류 근거 요약:
 * - `tick`·`supplyNextIndex`·`wave`·`combo`/`comboTimer`·`playerSlowTicks` — 페이싱·주기류(위 §참조).
 * - 모드 런타임 전부(`moduleRuntime`·`invasion3`·`scrollRuntime`·`shrinkRuntime`·`echoRuntime`·
 *   `encounterRuntime`) — 무대에 묶인 상태다. 구간마다 행성이 바뀌므로 이월 자체가 무의미하다.
 * - 지형·공간 스크래치(`grid`·`generatedChunks`·`activeWalls`·`wallIndex`) — 매 틱 재구축.
 * - RNG 7스트림 — 새 월드의 시드에서 다시 fork 된다. 승계하면 구간 시드의 재현성이 깨진다.
 * - `config`·`catalystMods`·`planetMult`·`sigBit` — 전환 층이 config 를 계승·갱신해 넘기고
 *   `createWorld` 가 거기서 재도출한다(파생 정본은 하나).
 * - `entities`·`nextEntityId`·`playerId` — 플레이어만 별도로 승계된다(아래 Entity 표).
 * - `bossSpawned`·`victory`·`gameOver`·`pendingLevelUp`·`powerupChoices` — 구간 종료 판정과
 *   레벨업 프리즈는 무대 단위 상태다.
 */
export const WORLD_FRESH = [
  'tick',
  'config',
  'rng',
  'waveRng',
  'powerupRng',
  'supplyRng',
  'worldRng',
  'dropRng',
  'eliteRng',
  'catalystMods',
  'planetMult',
  'wave',
  'entities',
  'nextEntityId',
  'playerId',
  'bulletCap',
  'enemyBulletCount',
  'sigBit',
  'combo',
  'comboTimer',
  'playerSlowTicks',
  'pendingLevelUp',
  'powerupChoices',
  'supplyNextIndex',
  'bossSpawned',
  'gameOver',
  'victory',
  'grid',
  'generatedChunks',
  'activeWalls',
  'wallIndex',
  'moduleRuntime',
  'invasion3',
  'invasion3Bombs',
  'scrollRuntime',
  'shrinkRuntime',
  'echoRuntime',
  'encounterRuntime',
] as const satisfies readonly (keyof WorldState)[];

// ---------------------------------------------------------------------------
// 플레이어 Entity 분류 (25필드)
// ---------------------------------------------------------------------------

/**
 * 구간을 넘어 **값이 이월**되는 플레이어 `Entity` 필드.
 *
 * ⚠️ `targetX` 는 좌표가 아니다 — 플레이어 엔티티에서는 `CAP_SURVIVAL_CRIT`(런당 1회 치명
 * 무효)의 **소진 표식**이다. 리셋하면 **N구간 = N회 부활**이 되어 안전망이 곱해진다.
 * ⚠️ `targetY` 는 위상 전환막 내부 쿨다운, `ownerId` 는 `UQ_DRONE_BAY` 소환 간격이다.
 * 이름이 용도를 배신하는 필드들이라 **여기 주석이 유일한 방어**다.
 * `aux0`/`aux1` 은 기체 시그니처 런타임이며, 해츨링은 `aux0`(kills 스냅샷)이 `state.kills` 와
 * 결합돼 있어 둘 다 승계해야 정합이다.
 */
export const ENTITY_CARRY = [
  'hp',
  'maxHp',
  'targetX',
  'targetY',
  'ownerId',
  'cooldown',
  'dashCooldown',
  'aux0',
  'aux1',
] as const satisfies readonly (keyof Entity)[];

/**
 * 플레이어 `Entity` 에서 **명시적으로 0 으로 되돌리는** 필드.
 *
 * 새 월드의 플레이어는 새 객체지만 {@link ENTITY_CARRY} 가 값을 덮으므로, "승계하지 않는다"를
 * **행동으로** 표현할 자리가 필요하다. 여기 있는 셋은 문맥이 무대와 함께 사라지는 것들이다:
 * `iframes` 는 피격 무적, `phase` 는 `UQ_OVERHEAT_DRUM` 연속 명중 스택(`combo` 와 같은 결),
 * `timer` 는 일반 타이머.
 */
export const ENTITY_RESET_ZERO = ['iframes', 'phase', 'timer'] as const satisfies readonly (keyof Entity)[];

/**
 * 새 무대에서 `createWorld` 가 세팅하는 그대로 두는 플레이어 `Entity` 필드.
 * 좌표·기하·정체성(무대 진입 위치, 엔티티 id, kind)과 플레이어에서 미사용인 탄환 필드들이다.
 */
export const ENTITY_FRESH = [
  'id',
  'kind',
  'x',
  'y',
  'vx',
  'vy',
  'angle',
  'radius',
  'enemyType',
  'life',
  'damage',
  'pierce',
  'dead',
] as const satisfies readonly (keyof Entity)[];

// ---------------------------------------------------------------------------
// 전수 대조 게이트 (컴파일 타임)
// ---------------------------------------------------------------------------

/**
 * `T` 가 `never` 가 아니면 **컴파일 에러**를 낸다. 아래 두 단언이 이것으로 "빠진 필드 0" 을 증명한다.
 *
 * 역방향(배열 원소가 전부 실제 키인가)은 각 배열의 `satisfies readonly (keyof …)[]` 가 이미 진다.
 */
type AssertNever<T extends never> = T;

/**
 * `WorldState` 전수 대조 — 세 배열 어디에도 없는 키가 있으면 여기서 컴파일이 깨진다.
 * ⚠️ `noUnusedLocals: true` 라 **export 해야** tsc 를 통과한다(소비처가 없어도 된다).
 */
export type _WorldExhaustive = AssertNever<
  Exclude<
    keyof WorldState,
    (typeof WORLD_CARRY)[number] | (typeof WORLD_RESET_ZERO)[number] | (typeof WORLD_FRESH)[number]
  >
>;

/** 플레이어 `Entity` 전수 대조. 규율은 위와 동일. */
export type _EntityExhaustive = AssertNever<
  Exclude<
    keyof Entity,
    (typeof ENTITY_CARRY)[number] | (typeof ENTITY_RESET_ZERO)[number] | (typeof ENTITY_FRESH)[number]
  >
>;

// ---------------------------------------------------------------------------
// 전환 실행
// ---------------------------------------------------------------------------

/**
 * `keys` 에 나열된 필드만 `from` → `to` 로 옮긴다. 제네릭이라 **캐스트가 없다** — 잘못된 키는
 * 배열 선언의 `satisfies` 에서 이미 걸린다.
 */
function copyKeys<T extends object, K extends keyof T>(from: T, to: T, keys: readonly K[]): void {
  for (const k of keys) to[k] = from[k];
}

/**
 * 이전 구간의 월드에서 다음 구간의 **새 월드**로 승계분을 옮긴다.
 *
 * ⚠️ **필드를 손으로 옮기지 마라.** 위 배열들로부터 구동하는 것이 계약이다 — 배열과 별개로
 * 대입문을 쓰면 배열에서 한 항목을 빼도 동작이 안 바뀌어 **뮤테이션 게이트가 무의미**해진다.
 *
 * @param prev 직전 구간의 월드(이 호출 이후 버려진다)
 * @param next `createWorld` 가 방금 만든 다음 구간의 월드 — **이 객체가 변형된다**
 */
export function carryAcrossSegment(prev: WorldState, next: WorldState): void {
  // `tainted` 는 OR 누적이다. 아래 일괄 복사가 prev 값으로 덮으므로 새 월드가 이미 오염
  // 표시돼 있던 경우(전환 직후 하네스 개입 등)를 잃지 않게 먼저 붙잡아 둔다.
  const nextTaintedBefore = next.tainted;
  copyKeys(prev, next, WORLD_CARRY);
  next.tainted = next.tainted || nextTaintedBefore;

  // 플레이어는 항상 엔티티 배열의 0번이다(WorldState.playerId 주석의 계약).
  const prevPlayer = prev.entities[0];
  const nextPlayer = next.entities[0];
  if (prevPlayer === undefined || nextPlayer === undefined) return;
  copyKeys(prevPlayer, nextPlayer, ENTITY_CARRY);
  for (const k of ENTITY_RESET_ZERO) nextPlayer[k] = 0;
}
