/**
 * 조우(Encounter) 프레임워크 코어 — ADR-0033. 런 중 **최대 1회** 출현하는 opt-in 희귀
 * 이벤트다. 에코 신호(ADR-0023)의 검증된 뼈대(시드 롤 → 조건부 해시 폴드 → 반경 판정 →
 * 보상)를 일반화한 것이고, 에코 자체는 그대로 남아 병행한다(흡수는 다운스트림).
 *
 * ## 왜 sim 안·해시 안인가
 * 조우 보상이 런 경제(크레딧·전리품)에 영향을 주므로 서버(EF)가 시드+입력로그 재실행으로
 * 재검증한다(ADR-0005). 출현 자체는 **런 시드에서만** 파생돼 클라가 위조할 입력이 없고,
 * 진입 여부만 플레이어 입력(리플레이 로그)이다. 그래서 조우 상태는 sim 안에 살고
 * hashWorld 에 접힌다.
 *
 * ## 결정론 규율 (절대 위반 금지 — 에코 규율의 계승)
 *  - 롤은 `worldRng.fork('encounter')` 로만 한다. `fork` 는 부모(worldRng)를 전진시키지
 *    않으므로 worldRng 의 해시 상태가 불변이다 → 조우 미발생 런은 물론 발생 런도 기존 RNG
 *    스트림 소비가 0 이다. 새 상시 RNG 스트림을 WorldState/createWorld 에 추가하지 않는다.
 *    스트림 라벨 `'encounter'` 는 리플레이/해시 계약이므로 **절대 변경 금지**.
 *  - {@link EncounterRuntime} 의 모든 필드는 **정수**다(hashU32/`>>> 0`). `inDetour` 가
 *    boolean 이 아니라 0/1 정수인 것도 이 규율 때문이다 — hashU32 에 boolean 을 넣으면
 *    ToUint32 가 조용히 0/1 로 강제하긴 하지만, 필드 타입 자체를 정수로 못박아 "해시 필드는
 *    전부 정수" 불변식을 코드로 읽히게 한다.
 *  - `WorldState.encounterRuntime` 은 **positive 런에서만** 존재한다(그 외 undefined) →
 *    hashWorld 는 존재 시에만 조건부로 append-only 꼬리에 접어, 조우 미발생 런의 per-tick
 *    해시가 바이트 불변이다(AC1 · echo/shrink/scroll 런타임 선례).
 *  - 스폰은 RNG 미소비·고정 오프셋이다(maybeSpawnEcho 선례) — 웨이브·드랍 시퀀스를 밀지
 *    않으므로 조우 발생 런에서도 다른 스트림이 그대로다.
 *
 * ## 순환 의존 주의
 * world.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서 **타입만** 가져온다
 * (`import type`). 런타임 의존은 leaf 모듈만: `entities.js` · `data/encounters.js` ·
 * `rng.js` · `./encounters/light.js` · `./encounterDetour.js`. 입력 비트(`SPECIAL_*`)
 * 정의가 world.ts 가 아니라 data 층에 있는 이유가 정확히 이것이다(world.ts 는 re-export 만).
 */
import type { WorldState, InputFrame } from './world.js';
import type { Entity } from './entities.js';
import { spawnEncounterPortal, spawnEncounterAltar } from './entities.js';
import type { SeededRng } from './rng.js';
import {
  ENCOUNTERS,
  ENCOUNTER_TYPE,
  ENCOUNTER_SPAWN_PROB,
  ENCOUNTER_MIN_SPAWN_TICK,
  ENCOUNTER_MAX_SPAWN_TICK,
  ENCOUNTER_SPAWN_OFFSET,
  ENCOUNTER_OBJECT_RADIUS,
  ENCOUNTER_INTERACT_RADIUS,
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
} from '../../data/encounters.js';
import { stepLightEncounter, encounterShardCollectedOf } from './encounters/light.js';
import { enterDetour } from './encounterDetour.js';

/**
 * 조우 런타임(정수 필드 전용). positive 런에만 존재한다(그 외 WorldState.encounterRuntime
 * = undefined). state 진행:
 *   0 대기(스폰 틱 전) → 1 출현(포탈/오브젝트 존재, opt-in 대기) → 2 진행중(detour 또는
 *   라이브 오버레이) → 3 완료 → 4 거부(플레이어가 DECLINE)
 * 3 과 4 는 둘 다 종결 상태지만 분리한다 — "했는데 끝났다"와 "안 했다"는 정산 개연성 캡·
 * 관측 지표에서 서로 다른 사건이고, 해시에도 다른 값으로 남아야 재검증이 구분한다.
 */
export interface EncounterRuntime {
  /** 0 대기 · 1 출현 · 2 진행중 · 3 완료 · 4 거부. 해시됨. */
  state: number;
  /** ENCOUNTER_TYPE 값(가중 롤로 확정). "어떤 조우였나"까지 봉인하려 해시한다. */
  type: number;
  /** 조우 오브젝트 스폰 예정 틱(롤로 확정). 해시됨. */
  spawnTick: number;
  /** 스폰된 조우 오브젝트 id(0 = 미스폰). 해시됨. */
  entityId: number;
  /**
   * detour(보물 격실 서브씬) 안인가. **0/1 정수**(boolean 금지 — 위 결정론 규율).
   * stepWorld 최상단의 단일 분기가 이 값 하나만 보고 메인 파이프라인을 통째로 건너뛴다.
   */
  inDetour: number;
  /** 워프 전 플레이어 X(정수 — Math.round). 복귀 시 그대로 복원한다. 해시됨. */
  savedX: number;
  /** 워프 전 플레이어 Y(정수 — Math.round). 해시됨. */
  savedY: number;
  /** detour 잔여 틱(0 도달 시 자동 이젝트). 해시됨. */
  detourTimer: number;
  /**
   * 유형별 보조 정수 슬롯(제단 선택 인덱스·수호자 처치 수 등). Entity.aux0 과 같은 규율 —
   * **반드시 정수**여야 한다(hashU32 가 소수부를 조용히 버린다). 용도는 유형마다 정한다.
   */
  aux: number;
}

/**
 * 이 런의 조우 출현 여부·유형·스폰 틱을 롤한다. **positive 일 때만** EncounterRuntime 을
 * 돌려주고(그 외 undefined) 호출부는 조건부 스프레드로 세운다.
 *
 * `allowWarp=false` 면 `warp:true` 유형(보물 격실)을 가중 후보에서 **제외**한다 — 워프
 * detour 는 강제 스크롤 창·수축 안전 반경·추격 포식자 같은 모드별 좌표계와 구조적으로
 * 충돌하기 때문이다(계획 R2 · Principle 5). v1 은 뱀서류만 워프를 허용한다.
 *
 * 롤 순서는 **해시 계약**이다: ①등장 chance ②유형 가중 ③spawnTick int. 순서를 바꾸면
 * 같은 시드가 다른 조우를 낳아 기록된 리플레이가 갈린다.
 *
 * ⚠️ 반드시 `worldRng.fork('encounter')` 로 롤한다 — fork 는 부모를 전진시키지 않으므로
 * 이 함수는 worldRng 을 **한 번도 소비하지 않는다**(rollEcho 선례). 라벨 변경 금지.
 */
export function rollEncounter(worldRng: SeededRng, allowWarp: boolean): EncounterRuntime | undefined {
  const r = worldRng.fork('encounter');
  if (!r.chance(ENCOUNTER_SPAWN_PROB)) return undefined;
  // 유형 가중 롤. allowWarp=false 면 warp 유형을 후보에서 뺀다. **후보를 걸러도 롤 횟수는
  // 정확히 1 회**라 RNG 소비량이 모드와 무관하게 같다(소비량이 갈리면 이후 spawnTick 롤이
  // 어긋나 같은 fork 에서 다른 시퀀스가 나온다).
  let total = 0;
  for (const d of ENCOUNTERS) {
    if (!allowWarp && d.warp) continue;
    total += d.weight;
  }
  // 후보가 전멸하는 구성은 현재 카탈로그상 불가능하지만(비-warp 유형이 4종), 데이터가
  // 바뀌어 0 이 되면 조우 없음으로 안전 착지한다 — 0 나눗셈·무한 루프를 만들지 않는다.
  if (total <= 0) return undefined;
  let pick = r.int(0, total - 1);
  let type = 0;
  for (const d of ENCOUNTERS) {
    if (!allowWarp && d.warp) continue;
    if (pick < d.weight) {
      type = d.id;
      break;
    }
    pick -= d.weight;
  }
  // 위 루프는 pick < total 이므로 반드시 하나를 고른다(방어적 폴백 — 도달 불가).
  if (type === 0) return undefined;
  const spawnTick = r.int(ENCOUNTER_MIN_SPAWN_TICK, ENCOUNTER_MAX_SPAWN_TICK);
  return {
    state: 0,
    type,
    spawnTick,
    entityId: 0,
    inDetour: 0,
    savedX: 0,
    savedY: 0,
    detourTimer: 0,
    aux: 0,
  };
}

/**
 * 스폰 틱 도달 시 조우 오브젝트 1개를 플레이어 곁 고정 오프셋에 스폰한다(런당 1회, state
 * 게이트). maybeSpawnEcho 선례 — **RNG 미소비·고정 좌표**라 웨이브·드랍 시퀀스를 밀지
 * 않는다.
 *
 * ## 오브젝트가 서는 유형 / 서지 않는 유형
 * 포탈(보물 격실) · 제단(오스카 제단) · **봉인(봉인 수호자)** 은 전부 월드 오브젝트를 세운다.
 * 근접 판정(`ENCOUNTER_INTERACT_RADIUS`)이 **실체**를 갖는 유형이 정확히 이 셋이기 때문이다.
 *
 * ⚠️ 봉인이 없던 시절의 결함(리뷰 MEDIUM-4): 수호자는 `entityId = 0` 이라 근접 판정 헬퍼가
 * "오브젝트 없음 → 무조건 근접"으로 폴백했고, 그 결과 "봉인 근접 + ENTER" 계약이 실제로는
 * **"ENTER 만"** 이었다. 화면에 아무것도 없는데 키 한 번으로 임의 위치에서 HP ×12 미니보스가
 * 튀어나오는, opt-in 계약(ADR-0033: 진입은 자발적이고 위치가 보여야 공정하다)의 정면 위반이다.
 * 봉인 실체를 세워 "보이는 것을 향해 다가가 누른다"를 코드로 강제한다.
 *
 * 봉인은 **신규 kind 를 만들지 않고 `encounterPortal` kind 를 재사용**한다 — `KIND_CODE` 는
 * append-only 해시 계약이라 신규 kind 는 골든(`tests/invasionHash.test.ts`) 재생성을 강제하는데,
 * 여기서 필요한 것은 "inert 한 근접 판정 실체" 하나뿐이고 포탈이 정확히 그것이다. 연출 구분이
 * 필요한 렌더 층은 kind 가 아니라 `state.encounterRuntime.type`(= sealedGuardian)으로 가른다.
 *
 * 나머지 인라인 2종(파편우·보급선단)만 오브젝트 없이 state 를 1 로 올린다 — 그 둘은 근접
 * 판정 자체가 없고(입력을 요구하지 않는다) 거부 대기 창으로만 게이트된다.
 */
function maybeSpawnEncounter(state: WorldState, player: Entity): void {
  const rt = state.encounterRuntime;
  if (rt === undefined || rt.state !== 0) return;
  if (state.tick < rt.spawnTick) return;
  const x = player.x + ENCOUNTER_SPAWN_OFFSET;
  const y = player.y;
  if (rt.type === ENCOUNTER_TYPE.treasureVault || rt.type === ENCOUNTER_TYPE.sealedGuardian) {
    rt.entityId = spawnEncounterPortal(state, x, y, ENCOUNTER_OBJECT_RADIUS).id;
  } else if (rt.type === ENCOUNTER_TYPE.oscarAltar) {
    rt.entityId = spawnEncounterAltar(state, x, y, ENCOUNTER_OBJECT_RADIUS).id;
  }
  // 인라인 2종(파편우·보급선단)은 오브젝트 없이 출현 상태만 세운다(entityId = 0 유지).
  rt.state = 1;
}

/** rt.entityId 가 가리키는 살아 있는 조우 오브젝트(없으면 undefined). 순수 조회. */
function findObject(state: WorldState, rt: EncounterRuntime): Entity | undefined {
  if (rt.entityId === 0) return undefined;
  for (const e of state.entities) {
    if (e.id === rt.entityId && !e.dead) return e;
  }
  return undefined;
}

/**
 * 보물 격실(warp detour 유형) 한 틱 — **이 파일이 직접 소유하는 유일한 유형**이다.
 * 포탈 근접 상태에서만 입력이 먹는다:
 *  - `SPECIAL_ENCOUNTER_ENTER`   → enterDetour(워프 + 세트피스 스폰). 이후 메인 스텝은
 *    stepWorld 최상단 단일 분기가 통째로 건너뛴다.
 *  - `SPECIAL_ENCOUNTER_DECLINE` → state=4(거부). 포탈을 치우고 런을 그대로 잇는다.
 *
 * 접촉 "즉발"이 아니라 **명시적 입력**을 요구하는 것이 opt-in 계약의 코드적 근거다
 * (ADR-0033: 무시하면 안전하게 런을 잇는다 · 실제 사망 가능하므로 진입은 자발적이어야
 * 공정하다). 그래서 resolveCollisions 격자가 아니라 여기서 거리로 직접 판정한다.
 */
function stepVault(state: WorldState, player: Entity, rt: EncounterRuntime, input: InputFrame): void {
  const portal = findObject(state, rt);
  if (portal === undefined) return; // 정상 경로에선 진입/거부 전까지 살아 있다(방어).
  const declined = (input.special & SPECIAL_ENCOUNTER_DECLINE) !== 0;
  if (declined) {
    rt.state = 4;
    portal.dead = true; // compact 가 다음에 수거한다.
    return;
  }
  if ((input.special & SPECIAL_ENCOUNTER_ENTER) === 0) return;
  const dx = player.x - portal.x;
  const dy = player.y - portal.y;
  const r = ENCOUNTER_INTERACT_RADIUS;
  if (dx * dx + dy * dy > r * r) return; // 멀리서 누른 ENTER 는 무효(입력 위조 방어 겸).
  portal.dead = true;
  enterDetour(state, player, rt);
}

/**
 * 조우 한 틱 — 스폰(도달 시) + 유형 디스패치. world.ts step 루프의 단일 호출 지점이며
 * `stepEcho` 바로 뒤에 놓인다(같은 성격의 시드 이벤트 · 이번 틱 최신 플레이어 좌표 사용).
 * encounterRuntime 미존재(조우 미발생 런·침공)면 즉시 no-op → 거동·해시 불변.
 *
 * ⚠️ detour **안에서는 이 함수가 호출되지 않는다** — stepWorld 최상단 단일 분기가 메인
 * 파이프라인 전체를 건너뛰기 때문이다. detour 진행은 stepDetour 가 소유한다.
 */
export function stepEncounter(state: WorldState, player: Entity, input: InputFrame): void {
  const rt = state.encounterRuntime;
  if (rt === undefined) return;
  maybeSpawnEncounter(state, player);
  if (rt.state !== 1 && rt.state !== 2) return; // 대기·완료·거부는 할 일이 없다.
  if (rt.type === ENCOUNTER_TYPE.treasureVault) {
    stepVault(state, player, rt, input);
    return;
  }
  // 그 외 4종(제단·수호자·파편우·보급선단)은 전부 인라인/오버레이라 detour 단일 분기가
  // 필요 없다 — 메인 런 위에서 그대로 돈다. 구현은 경량 조우 모듈이 소유한다.
  stepLightEncounter(state, player, rt, input);
}

// ---------------------------------------------------------------------------
// RunResult 리더 헬퍼 (정산·관측이 소비 — 이 파일은 순수 리더만 제공, echo.ts 선례).
// ---------------------------------------------------------------------------

/** 이번 런에 조우를 완료했는가(state===3 파생, 순수 판정). 정산 개연성 캡이 참조한다. */
export function encounterCompletedOf(state: WorldState): boolean {
  return state.encounterRuntime?.state === 3;
}

/** 이번 런에 출현한 조우 유형(ENCOUNTER_TYPE 값, 미발생이면 0). 순수 판정. */
export function encounterTypeOf(state: WorldState): number {
  return state.encounterRuntime?.type ?? 0;
}

/**
 * 이번 런에 **기록 파편우**로 파편을 수집했는가(정산 기록 파편 축).
 *
 * 에코 안정화(`echoStabilizedOf`)와 **같은 축**에 얹는다 — 명세의 "신규 보상 시스템 0" 제약이
 * 그것을 요구하고, 정산(`RunResult.echoStabilized` → `RECORD_SHARDS` 의 첫 미수집 파편)이 이미
 * 그 축을 소비하고 있기 때문이다. `main.ts` 가 두 리더를 OR 로 합류시킨다.
 *
 * ⚠️ 이 배선이 없으면 파편우를 완주해도 파편이 프로필에 담기지 않는다 — 이 저장소의 반복 결함
 * ("단위 테스트는 그린인데 배선이 통째로 없다")과 정확히 같은 형태라 리더만 만들고 끝내지 않는다.
 */
export function encounterShardOf(state: WorldState): boolean {
  return encounterShardCollectedOf(state.encounterRuntime);
}
