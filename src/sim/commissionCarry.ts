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

/**
 * `T` 의 키 중 **값 타입이 `number` 인 것**만. 0 리셋 배열의 원소를 이것으로 제약하면
 * "0 을 대입할 수 없는 필드가 0 리셋 목록에 들어가는" 오분류가 컴파일에서 걸린다.
 */
type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

// ---------------------------------------------------------------------------
// WorldState 분류 (76필드)
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
  // --- 액티브 조율 포인트 2개(E7 · ADR-0049 선결): 파워업 24/25 누적도 런 단위 자원이다 ---
  // 옛 `skillInvest` 직접 변형 방식은 config 승계로 자연히 이월됐다(구간마다 `config` 를
  // 갱신·전달). 지금은 `skillInvest` 밖으로 분리했으므로 **명시적으로 승계하지 않으면 구간
  // 전환마다 조율이 0으로 리셋**된다 — 리셋하면 N구간 = N번 재수집이 필요해 사실상 삭제와
  // 같다. `activeCd0/1` 과 같은 그룹으로 둔다.
  'activeTune0',
  'activeTune1',
  // --- 사연 관측 카운터 6개(비-해시 메타. 런 전체 누적이라야 정산 델타가 맞는다) ---
  'hitsTaken',
  'overchargeKills',
  'cloakBreaks',
  'broodLaunches',
  'cushionHealed',
  'filmPops',
  // --- 의뢰 런타임: `totalTicks` 가 런 단위 누적이라 승계해야 한다 ---
  // ⚠️ **참조를 그대로 넘긴다**(`weapon`·`loot` 와 같은 규율 — 이전 월드는 전환 직후 버려진다).
  // 그래서 `segmentDone` 은 **명시적으로 0 으로 되돌려야 한다**: 이 객체는 직전 구간에서
  // `segmentDone = 1` 로 세워진 바로 그 객체라, 안 내리면 `stepRun` 이 다음 틱에 또 전환해
  // **구간이 한 틱에 하나씩 소진되고 의뢰가 즉시 끝난다**. {@link carryAcrossSegment} 참조.
  'commissionRuntime',
  // --- 스킬 이월 슬롯 8칸(S0 · ADR-0049) ---
  // 의뢰 런은 여러 **구간**으로 이뤄진 하나의 **런**이다(`commissionRuntime.totalTicks` 가 런
  // 전체 누적이고 `state.tick` 만 구간마다 0 이다). "런당 1회 소진"·"런 누적 저금"·"런 누적
  // 락온 스택" 스킬은 구간을 넘어야 성립하므로 CARRY 다. 구간마다 새로 시작해야 하는 상태는
  // 같은 폭의 **별도 배열** `skillStage` 가 갖고, 그쪽은 {@link WORLD_FRESH} 다.
  //
  // ⚠️ **참조를 그대로 넘긴다 — `weapon`·`loot` 와 같은 규율이다**(위 §참조: 이전 월드는 전환
  // 직후 버려지므로 공유가 안전하다). 원소별 값 복사로 바꾸지 마라: `copyKeys` 는 참조 대입이고
  // `tests/commissionCarry.test.ts` 의 CARRY 대조가 `toBe`(= `Object.is`)라, 값 복사로 만들면
  // 참조가 갈려 **오히려 빨개진다.**
  // ⚠️ 그 안전성은 **호출부 전수**에 의존한다(`commissionRuntime` 참조 공유와 같은 등급의
  // 경고다 — 다만 이쪽은 해시 대상이라 더 무겁다: 스킬 슬롯 16칸은 `hashWorld` 꼬리 폴드에
  // 접힌다). **전환 후 이전 월드를 계속 들고 있거나 다시 해싱하는 경로를 만들지 마라** —
  // 만들어야 한다면 여기를 값 복사(`prev.skillCarry.slice()`)로 먼저 바꾸고, 위 테스트의
  // `toBe` 를 그 필드에 한해 `toEqual` 로 함께 고쳐라.
  // ⚠️ `_WorldExhaustive` 는 이 별칭을 **못 잡는다** — `keyof` 는 최상위 키만 본다(위 §한계).
  'skillCarry',
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
 *
 * ⚠️ **비어 있어도 {@link carryAcrossSegment} 가 이 배열을 순회한다.** 배선 없이 자리만 남기면
 * 훗날 여기에 필드를 넣었을 때 **아무 일도 안 일어나고 어떤 테스트도 실패하지 않는다** — 이
 * 저장소의 지배적 실패 모드("배선이 통째로 없다")가 정확히 그 모양이다. 그래서 원소 타입을
 * **수치 필드로 제약**해 두어, 넣는 순간 0 대입이 타입 검사를 통과하며 즉시 동작하게 했다.
 */
export const WORLD_RESET_ZERO = [] as const satisfies readonly NumericKeys<WorldState>[];

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
  // `armorMaxStacks` 는 `sigBit`·`catalystMods` 와 같은 부류다 — 승계된 `config` 로부터
  // `createWorld` 가 재도출하는 순수 파생값이라 승계 목록에 넣으면 정본이 둘이 된다(E4).
  'armorMaxStacks',
  // `filmCapacity` 도 같은 부류다 — `config.playerHp` 에서 `createWorld` 가 재도출한다.
  'filmCapacity',
  // E3 버블 파열 요청 슬롯 6칸. **틱 내 스크래치**다 — 세운 틱 안에서 소비되고 0 으로
  // 되돌아가므로 구간 경계에서 값이 서 있을 수 없다. 승계·0리셋 어느 쪽도 관측 불가한
  // 무연산이라, 새 월드의 초기값을 그대로 쓰는 이 분류가 유일하게 정직하다.
  'filmBurstReq0',
  'filmBurstReqX0',
  'filmBurstReqY0',
  'filmBurstReq1',
  'filmBurstReqX1',
  'filmBurstReqY1',
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
  // E5 벽 접촉(ADR-0049). `activeWalls` 와 같은 부류다 — 벽 기하에서 매 틱 파생되는 스크래치라
  // 구간이 바뀌면 벽도 좌표도 통째로 새것이다. 이월하면 **새 무대 첫 틱부터 "이미 60틱 붙어
  // 있었다"** 가 되어 ME9(K=60 연속 접촉)가 접촉 없이 열린다.
  'wallContactTicks',
  'moduleRuntime',
  'invasion3',
  'invasion3Bombs',
  'scrollRuntime',
  'shrinkRuntime',
  'echoRuntime',
  'encounterRuntime',
  // --- 스킬 구간 슬롯 8칸(S0 · ADR-0049) ---
  // `wallContactTicks` 와 같은 부류다 — 창 잔여 틱·이번 구간 킬 스냅샷처럼 **무대와 함께
  // 사라져야 하는** 상태를 담는다. 이월하면 새 무대 첫 틱부터 "이미 창이 열려 있었다"가 된다.
  // 이월이 필요한 상태는 {@link WORLD_CARRY} 의 `skillCarry` 로 간다 — 둘을 섞지 마라.
  'skillStage',
  // --- 스킬 투자 게이트 · 파생 블록(S0 · ADR-0049) ---
  // 둘 다 `sigBit`·`armorMaxStacks` 와 **같은 부류**다: 승계된 `config` 로부터 `createWorld` 가
  // 재도출하는 순수 파생값이라 승계 목록에 넣으면 정본이 둘이 된다. 승계된 config 가 같으면
  // 재도출값도 같으므로 구간 경계에서 값이 흔들리지 않는다.
  'skillsOn',
  'skillDerived',
  // --- 촉매 슬롯 6칸 · 촉매 게이트(ADR-0052) ---
  // 둘 다 여기가 **유일하게 정직한 분류**다. ADR-0052 헌장이 "침공·의뢰 런에는 촉매가
  // 들어가지 않는다" 고 못 박았으므로, 촉매가 실린 런에는 구간 전환 자체가 없다 — 이월/0리셋
  // 어느 쪽도 관측 불가한 무연산이다. 그리고 `catalystOn` 은 `skillsOn` 과 같은 부류로
  // 승계된 `config` 에서 `createWorld` 가 재도출하는 순수 파생값이다.
  //
  // ⚠️ 훗날 의뢰에 촉매를 들이는 결정이 나면 `catalystSlots` 를 `WORLD_CARRY` 로 옮기기 전에
  // `skillCarry` 의 참조 대입 주석을 먼저 읽어라 — `copyKeys` 는 배열을 **참조로** 넘긴다.
  'catalystSlots',
  'catalystOn',
  // 연출 통지 버퍼(틱 단위 사건 스트림)와 귀속 장부(ADR-0052 §가시성/§귀속). 둘 다 바로 위와
  // **같은 근거**로 FRESH 다 — 촉매가 실린 런에는 구간 전환이 존재하지 않는다. 통지 쪽은 그와
  // 별개로 `stepWorld` 첫머리에서 매 틱 비워지므로 구간을 넘길 것 자체가 없다.
  'catalystFx',
  'catalystLedger',
  // 드랍 축 실측 계수기. 바로 위 장부와 **같은 근거**로 FRESH 다(촉매가 실린 런에는 구간
  // 전환이 없다). 이월해도 관측 불가한 무연산이지만, 훗날 의뢰에 촉매를 들이면 이월이
  // **정답이 된다** — 배율은 런 전체의 비율이지 구간의 비율이 아니기 때문이다. 그때는
  // `catalystSlots` 와 함께 `WORLD_CARRY` 로 옮겨라(`copyKeys` 가 객체를 참조로 넘기는 것에 주의).
  'catalystLootTally',
] as const satisfies readonly (keyof WorldState)[];

// ---------------------------------------------------------------------------
// 플레이어 Entity 분류 (25필드)
// ---------------------------------------------------------------------------

/**
 * 구간을 넘어 **값이 이월**되는 플레이어 `Entity` 필드.
 *
 * ⚠️ `targetX` 는 좌표가 아니다. 과거 플레이어 엔티티에서는 캡스톤(런당 1회 치명 무효)의
 * **소진 표식**이었으나, 캡스톤 시스템 자체가 ADR-0049 로 폐기돼 지금은 플레이어 쪽에서
 * 아무도 쓰지 않는다(항상 0). 그래도 이 목록에서 빼지 않는다 — 남겨 둬도 no-op 이고,
 * 구 리플레이/세이브가 이 필드에 값을 남긴 채 들어올 가능성을 배제할 수 없어서다.
 * ⚠️ `targetY` 는 위상 전환막 내부 쿨다운, `ownerId` 는 `UQ_DRONE_BAY` 소환 간격이다.
 * ⚠️ **`timer` 는 "일반 타이머"가 아니라 독립 보조무기 발사 쿨다운이다**(`world.ts:2611-2725` —
 * 주무기와 경쟁하지 않는 자기 사이클). 쿨다운 실값은 SIDEKICK 18 · SCATTER 33 · FLARE 45 ·
 * MINE 66 · **SENTRY 300**. 리셋하면 구간 진입마다 쿨다운을 건너뛰고 **무료 1발**이 나가,
 * 5구간 최종 지시에서 센트리는 런당 5회 공짜다. 결정론적이라 해시가 안 갈리고 밸런스 이상으로만
 * 보인다(`tick` 승계 결함과 같은 은폐 형태).
 * 이름이 용도를 배신하는 필드들이라 **여기 주석이 유일한 방어**다.
 * `aux0`/`aux1` 은 기체 시그니처 런타임이며, 해츨링은 `aux0`(kills 스냅샷)이 `state.kills` 와
 * 결합돼 있어 둘 다 승계해야 정합이다.
 *
 * 이 목록의 **분류 원칙은 "쿨다운은 승계"** 다 — `cooldown`(주무기)·`dashCooldown`(대시)·
 * `targetY`(위상 전환막)·`ownerId`(드론 베이)·`timer`(보조무기)가 전부 여기 있는 이유다.
 * 하나라도 0 으로 내리면 그 축만 구간 수만큼 무료 재발급된다.
 */
export const ENTITY_CARRY = [
  'hp',
  'maxHp',
  'targetX',
  'targetY',
  'ownerId',
  'cooldown',
  'dashCooldown',
  'timer',
  'aux0',
  'aux1',
] as const satisfies readonly (keyof Entity)[];

/**
 * 플레이어 `Entity` 에서 **명시적으로 0 으로 되돌리는** 필드.
 *
 * 새 월드의 플레이어는 새 객체지만 {@link ENTITY_CARRY} 가 값을 덮으므로, "승계하지 않는다"를
 * **행동으로** 표현할 자리가 필요하다. 여기 있는 둘은 문맥이 무대와 함께 사라지는 것들이다:
 * `iframes` 는 피격 무적, `phase` 는 `UQ_OVERHEAT_DRUM` 연속 명중 스택(`combo` 와 같은 결 —
 * 구간 사이에 전투가 끊기므로 스택이 이어지면 안 된다).
 *
 * ⚠️ **`timer` 는 여기 있었고, 오분류였다.** 보조무기 쿨다운이라 {@link ENTITY_CARRY} 로 옮겼다.
 * 계획 rev7 의 표가 "일반 타이머"라고 적었던 것이 원인이다 — 분류를 이름으로 하지 마라.
 */
export const ENTITY_RESET_ZERO = ['iframes', 'phase'] as const satisfies readonly (keyof Entity)[];

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
  // 현재 WORLD_RESET_ZERO 는 비어 있어 이 루프는 0회 돈다. **그래도 지우지 마라** — 배선 없이
  // 목록만 남기면 훗날 필드를 넣었을 때 조용히 아무 일도 안 일어난다(이 저장소의 지배적 실패 모드).
  //
  // 넓히기가 필요한 이유: 배열이 비어 있으면 `as const` 원소 타입이 `never` 라 `next[k] = 0` 이
  // 컴파일되지 않는다. 배열 선언의 `satisfies readonly NumericKeys<WorldState>[]` 가 **원소가
  // 항상 수치 필드임을 이미 보증**하므로 이 넓히기는 안전하고, 전수 대조 게이트는 `as const` 의
  // 리터럴 타입을 그대로 쓰므로 영향받지 않는다(여기서 넓히면 게이트가 전 수치 키를 덮은 것으로
  // 착각해 무력화된다 — 그래서 선언이 아니라 **사용처에서만** 넓힌다).
  for (const k of WORLD_RESET_ZERO as readonly NumericKeys<WorldState>[]) next[k] = 0;

  // 의뢰 런타임은 **객체 참조**를 승계했으므로(위 WORLD_CARRY 주석), 구간 신호만 여기서 내린다.
  // `totalTicks` 는 그대로 이어진다 — 그것이 이 객체를 승계하는 이유다.
  // 새 월드가 `createWorld` 에서 만든 자기 런타임은 여기서 버려진다(전환은 항상 승계본이 이긴다).
  //
  // ⚠️ **이 참조 공유는 `weapon`·`loot` 의 그것과 등급이 다르다 — `commissionRuntime` 은 해시
  // 대상이다**(`segmentDone` 이 꼬리 폴드에 접힌다). 아래 한 줄이 `prev` 의 값까지 함께 바꾸므로
  // **전환 후 `hashWorld(prev)` 는 전환 전과 다른 값을 낸다.**
  // 지금은 무해하다 — 전환 뒤 `prev` 를 재해싱하는 호출부가 0건이다(`runReplay` 는 `stepRun` 의
  // 반환값만 해싱하고, 정산 경로는 `world` 를 재조회한다). **그러나 그 안전성은 호출부 전수에
  // 의존한다.** 전환 후 이전 월드를 다시 해싱하는 경로를 만들지 마라 — 만들어야 한다면 여기를
  // 값 복사(`{ ...prev.commissionRuntime, segmentDone: 0 }`)로 먼저 바꿔라.
  if (next.commissionRuntime !== undefined) next.commissionRuntime.segmentDone = 0;

  // 플레이어는 항상 엔티티 배열의 0번이다(WorldState.playerId 주석의 계약).
  const prevPlayer = prev.entities[0];
  const nextPlayer = next.entities[0];
  // ⚠️ **조용히 return 하지 않는다.** 여기서 빠져나가면 hp·시그니처가
  // 통째로 사라지는데 화면엔 "2구간이 만피로 시작"으로만 보인다. `kind` 까지 확인하는 이유는
  // 훗날 0번 자리에 다른 엔티티가 들어가면 승계분을 **그 엔티티에** 써 넣기 때문이다.
  if (prevPlayer === undefined || prevPlayer.kind !== 'player') {
    throw new Error('carryAcrossSegment: prev.entities[0] 이 플레이어가 아니다');
  }
  if (nextPlayer === undefined || nextPlayer.kind !== 'player') {
    throw new Error('carryAcrossSegment: next.entities[0] 이 플레이어가 아니다');
  }
  copyKeys(prevPlayer, nextPlayer, ENTITY_CARRY);
  for (const k of ENTITY_RESET_ZERO) nextPlayer[k] = 0;
}
