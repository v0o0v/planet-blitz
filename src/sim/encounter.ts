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
import {
  windowCenterX,
  windowCenterY,
  INVASION_WINDOW_HALF_W,
  INVASION_WINDOW_HALF_H,
  type ScrollWindow,
} from './invasion/scroll.js';
import { sqrt } from './math.js';
import { scrollModeAxisDir } from './scrollMode.js';
import { SCROLL_AXIS_VERTICAL, SCROLL_AXIS_HORIZONTAL } from './invasion/constants.js';

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
 * ## `allowWarp` 게이트를 없앤 이유 (전 모드 개방)
 * 예전에는 `warp:true` 유형(보물 격실)을 뱀서류 외 모드에서 후보에서 뺐다 — 워프 detour 가
 * 강제 스크롤 창·수축 안전 반경 같은 모드별 좌표계와 충돌한다고 봤기 때문이다. 그 전제는
 * detour 격리가 완성되면서 사라졌다: **모드 규칙(창 클램프·수축 밖 피해·블록격파 압사·
 * 레이싱 후방 압박)은 전부 `stepWorld` 의 경계 블록에 모여 있고, detour 분기는 그 블록에
 * 닿기 전에 return 한다.** 즉 detour 중에는 모드 규칙이 아예 실행되지 않으므로 포켓 방
 * (창 밖 12만 유닛) 좌표가 어떤 모드에서도 안전하다 → 워프를 항상 후보에 넣는다.
 *
 * 롤 순서는 **해시 계약**이다: ①등장 chance ②유형 가중 ③spawnTick int. 순서를 바꾸면
 * 같은 시드가 다른 조우를 낳아 기록된 리플레이가 갈린다. 게이트 제거는 **후보 필터만**
 * 없앤 것이라 롤 횟수(chance 1 · 가중 1 · spawnTick 1)와 RNG 소비량은 그대로다.
 *
 * ⚠️ 반드시 `worldRng.fork('encounter')` 로 롤한다 — fork 는 부모를 전진시키지 않으므로
 * 이 함수는 worldRng 을 **한 번도 소비하지 않는다**(rollEcho 선례). 라벨 변경 금지.
 */
export function rollEncounter(worldRng: SeededRng): EncounterRuntime | undefined {
  const r = worldRng.fork('encounter');
  if (!r.chance(ENCOUNTER_SPAWN_PROB)) return undefined;
  // 유형 가중 롤 — 카탈로그 전체가 후보다(warp 포함). 롤 횟수는 **정확히 1 회**라 모드와
  // 무관하게 RNG 소비량이 같다(소비량이 갈리면 이후 spawnTick 롤이 어긋나 같은 fork 에서
  // 다른 시퀀스가 나온다).
  let total = 0;
  for (const d of ENCOUNTERS) {
    total += d.weight;
  }
  // 카탈로그가 비거나 가중치가 전부 0 인 구성은 현재 불가능하지만, 데이터가 바뀌어 0 이
  // 되면 조우 없음으로 안전 착지한다 — 0 나눗셈·무한 루프를 만들지 않는다.
  if (total <= 0) return undefined;
  let pick = r.int(0, total - 1);
  let type = 0;
  for (const d of ENCOUNTERS) {
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

// ---------------------------------------------------------------------------
// 근접 오브젝트 도달성 보장 (모드 좌표계 대응 — 스크롤 창 고정 · 수축 반경 클램프)
// ---------------------------------------------------------------------------

/**
 * 경계(스크롤 창 테두리·수축 안전 반경)에서 조우 오브젝트를 안쪽으로 떼어 놓는 여유.
 *
 * 오브젝트 풋프린트({@link ENCOUNTER_OBJECT_RADIUS})가 경계를 삐져나오지 않게 하는 동시에,
 * 경계 안쪽에 갇힌 플레이어가 **상호작용 반경({@link ENCOUNTER_INTERACT_RADIUS}) 안으로 들어올
 * 여지**를 남긴다 — 오브젝트가 테두리에 딱 붙으면 근접 자체는 가능해도 그 지점이 곧 벽이라
 * 접근 여유가 0 이 된다. 두 반경의 합을 쓰는 것은 그 두 요구를 한 값으로 만족시키는 가장
 * 보수적인 선택이다. TODO(밸런스).
 */
const ENCOUNTER_BOUND_MARGIN = ENCOUNTER_OBJECT_RADIUS + ENCOUNTER_INTERACT_RADIUS;

/**
 * 창 **뒤 경계**에서 오브젝트를 안쪽으로 당기는 인셋. 오브젝트 풋프린트만큼만 당긴다 —
 * 여기서 {@link ENCOUNTER_BOUND_MARGIN}(= 풋프린트 + 상호작용 반경)을 쓰면 앵커가 뒤 경계에서
 * 너무 멀어져, 창이 가속해 플레이어가 뒤 경계에 눌려 있는 동안 상호작용 반경 밖으로 벗어난다
 * (아래 {@link windowAnchorOf} 의 실측 근거). TODO(밸런스).
 */
const ENCOUNTER_WINDOW_REAR_INSET = ENCOUNTER_OBJECT_RADIUS;

/**
 * 창 중심 기준 고정 앵커(창 상대 좌표) — **스크롤 축의 뒤쪽 경계 부근, 수직 축 성분 0**.
 *
 * ## 왜 앞쪽에 두면 안 되는가 (실측으로 잡은 결함)
 * 창 전진 속도(`scrollStep(100)` = 12 유닛/틱)는 **플레이어 최대 이동 속도(720 u/s = 12 유닛/틱)와
 * 정확히 같다**. 즉 플레이어가 스크롤 방향으로 전력 질주해도 창 대비 **상대 속도가 0**이라, 창
 * 상대 좌표로 앞쪽에 고정된 오브젝트와의 간격은 영원히 좁혀지지 않는다. 구간 전멸·부스트 패드
 * 가속(최대 200cp = 24 유닛/틱)이 붙으면 창이 플레이어를 **앞질러** 간격이 오히려 벌어지고,
 * 플레이어는 뒤 경계에 눌린 채 아무것도 할 수 없다. 실측(레이싱 정규 런, 900틱):
 *   앵커 +520(앞) → 최소 거리 **1276** · 앵커 0(중심) → 최소 거리 **868** (둘 다 반경 320 밖)
 *
 * ## 왜 "뒤 경계"인가
 * 뒤로 처지는 것은 **항상 가능하다** — 가만히 있어도 창이 플레이어를 뒤 경계로 밀어 주고, 경계에
 * 닿으면 창 클램프가 스크롤 축 이동을 대신 해 준다. 즉 창 안에서 **속도 예산 없이 도달할 수 있는
 * 유일한 지점이 뒤 경계**다. 그래서 앵커를 뒤 경계에서 풋프린트만큼만 안으로 당긴 자리에 둔다:
 *  - 레이싱(+X 스크롤) → 앵커 x = −(960 − 120) = −840
 *  - 블록격파(−Y 스크롤) → 앵커 y = +(540 − 120) = +420
 * 뒤 경계에 눌린 플레이어(경계에서 자기 반경만큼 안쪽)와의 간격이 ~88 이라 상호작용 반경 320
 * 안에 확실히 든다. 반대로 플레이어는 오브젝트를 만지려고 **압박 구역(뒤 경계 120 이내)에 들어갈
 * 필요가 없다** — 반경 320 이 압박 구역 밖까지 닿는다.
 *
 * 블록격파에서 뒤쪽은 **이미 지나온 공간**이라 파괴가능 벽 줄에 막힐 확률도 낮다(앞쪽 앵커는
 * 실측에서 벽에 막혀 425 에서 더 못 붙었다).
 *
 * 축·방향을 모르는 경우(침공 3레이어 — 애초에 조우가 서지 않는다)는 창 중심(0,0)으로 안전
 * 착지한다. 전부 상수 산술이라 난수·삼각함수가 없다.
 */
function windowAnchorOf(state: WorldState): { x: number; y: number } {
  const axisDir = scrollModeAxisDir(state.config.planetMode);
  if (axisDir === undefined) return { x: 0, y: 0 };
  // 뒤쪽 = 스크롤 방향의 반대(−dir).
  if (axisDir.axis === SCROLL_AXIS_VERTICAL) {
    const span = INVASION_WINDOW_HALF_H - ENCOUNTER_WINDOW_REAR_INSET;
    return { x: 0, y: span <= 0 ? 0 : -span * axisDir.dir };
  }
  if (axisDir.axis === SCROLL_AXIS_HORIZONTAL) {
    const span = INVASION_WINDOW_HALF_W - ENCOUNTER_WINDOW_REAR_INSET;
    return { x: span <= 0 ? 0 : -span * axisDir.dir, y: 0 };
  }
  return { x: 0, y: 0 };
}

/**
 * 이 런의 강제 스크롤 창(있으면). 침공 3레이어와 PvE 강제 스크롤(블록격파·레이싱)이 같은
 * `scrollX/scrollY` 구조를 공유하므로 world.ts 의 `scrollWin` 선택과 **같은 우선순위**로
 * 고른다. 뱀서류·추격·오염·수축은 둘 다 미존재 → undefined.
 *
 * (침공 런에는 애초에 `encounterRuntime` 이 서지 않지만, 창 선택 규칙을 world.ts 와 다르게
 * 적어 두면 훗날 한쪽만 바뀌었을 때 조용히 어긋난다 — 같은 식을 쓴다.)
 */
function encounterScrollWindow(state: WorldState): ScrollWindow | undefined {
  return state.invasion3 ?? state.scrollRuntime;
}

/**
 * 좌표를 수축 안전 반경 안쪽(여유 포함)으로 끌어당긴다. 반경 밖이 아니면 좌표를 그대로 돌려
 * 준다(불필요한 이동 없음). 아레나 중심은 원점 0,0 이다(modes/shrink.ts 규율).
 *
 * 방향을 보존한 축소라 `sqrt` 한 번만 쓴다(`math.js` 의 IEEE-754 correctly-rounded 래퍼 —
 * 결정론). 삼각함수·난수는 쓰지 않는다.
 */
function clampToSafeRadius(x: number, y: number, safeRadius: number): { x: number; y: number } {
  const limit = safeRadius - ENCOUNTER_BOUND_MARGIN;
  // 반경이 여유보다도 좁으면 중심이 유일한 안전 지점이다(수축 말기 방어).
  if (limit <= 0) return { x: 0, y: 0 };
  const d2 = x * x + y * y;
  if (d2 <= limit * limit) return { x, y };
  const d = sqrt(d2);
  return { x: (x * limit) / d, y: (y * limit) / d };
}

/**
 * 근접이 필요한 조우 오브젝트(보물 격실 포탈 · 오스카 제단 · **봉인 수호자의 봉인**)를 이번 틱의
 * 모드 좌표계 안에 붙들어 둔다. `stepEncounter` 가 유형 디스패치 **직전에** 부르므로, 이번 틱의
 * 근접 판정은 항상 갱신된 좌표를 본다.
 *
 * ## 왜 필요한가 (실측 결함)
 * 조우 오브젝트는 정적 엔티티인데 강제 스크롤 모드의 창은 매 틱 12 유닛(가속 시 더) 전진한다.
 * 창 반폭 960 · 반높이 540 이므로 스폰 직후부터 창 기준으로 뒤로 흘러가, 블록격파(−Y)는 최대
 * **90틱(≈1.5초)**, 레이싱(+X)은 최대 **160틱(≈2.7초)** 만에 창 밖으로 빠진다. 플레이어는 창
 * 안에 클램프되므로 그 순간부터 상호작용 반경 320 에 **영원히 닿을 수 없다** — 즉 오스카 제단·
 * 봉인이 크라스·아르케에서 사실상 도달 불가였다. 수축 모드도 같은 형태다: 안전 반경이 매 틱
 * 조여 오므로 스폰 위치가 결국 반경 밖으로 남겨진다(다가가면 지속 피해).
 *
 * ## 모드별 분기 (골든 불변의 근거)
 *  - 강제 스크롤 창 존재 → 창 중심 + 고정 앵커로 **매 틱 재고정**(화면상 정지).
 *  - 수축 런타임 존재 → 현재 안전 반경 안으로 클램프(이미 안이면 좌표 무변).
 *  - **둘 다 없으면 좌표를 한 줄도 건드리지 않는다** — 뱀서류·추격·오염은 창도 안전 반경도
 *    없으므로 이 함수가 사실상 조기 반환이고, 기존 런의 거동·해시가 바이트 불변이다.
 *
 * 오브젝트가 없는 유형(파편우·보급선단, `entityId === 0`)도 조기 반환이다.
 */
function keepEncounterObjectReachable(state: WorldState, rt: EncounterRuntime): void {
  const obj = findObject(state, rt);
  if (obj === undefined) return;
  const win = encounterScrollWindow(state);
  if (win !== undefined) {
    const anchor = windowAnchorOf(state);
    obj.x = windowCenterX(win) + anchor.x;
    obj.y = windowCenterY(win) + anchor.y;
    return;
  }
  const shrink = state.shrinkRuntime;
  if (shrink === undefined) return; // 뱀서류·추격·오염 — 좌표 무변(위 문단).
  const p = clampToSafeRadius(obj.x, obj.y, shrink.safeRadius);
  obj.x = p.x;
  obj.y = p.y;
}

/**
 * 스폰 틱 도달 시 조우 오브젝트 1개를 플레이어 곁 고정 오프셋에 스폰한다(런당 1회, state
 * 게이트). maybeSpawnEcho 선례 — **RNG 미소비·고정 좌표**라 웨이브·드랍 시퀀스를 밀지
 * 않는다.
 *
 * ## 스폰 좌표도 모드 좌표계를 따른다
 * 기본은 플레이어 곁 고정 오프셋이지만, 강제 스크롤 창이 있으면 **창 상대 고정 앵커**로,
 * 수축 런타임이 있으면 **안전 반경 안쪽**으로 놓는다({@link keepEncounterObjectReachable} 의
 * 같은 규칙 — 스폰과 매 틱 고정이 같은 식이라 상대 좌표가 저장 없이 보존된다). 창·반경이
 * 둘 다 없는 모드(뱀서류·추격·오염)는 기존 좌표 그대로다.
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
  let x = player.x + ENCOUNTER_SPAWN_OFFSET;
  let y = player.y;
  const win = encounterScrollWindow(state);
  if (win !== undefined) {
    const anchor = windowAnchorOf(state);
    x = windowCenterX(win) + anchor.x;
    y = windowCenterY(win) + anchor.y;
  } else if (state.shrinkRuntime !== undefined) {
    const p = clampToSafeRadius(x, y, state.shrinkRuntime.safeRadius);
    x = p.x;
    y = p.y;
  }
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
  // 근접 오브젝트를 이번 틱의 모드 좌표계(스크롤 창·수축 반경) 안에 붙든다. **유형 디스패치
  // 이전**이라 이번 틱의 근접 판정이 갱신된 좌표를 본다. 창·반경이 없는 모드(뱀서류·추격·
  // 오염)와 오브젝트 없는 유형(파편우·보급선단)에서는 좌표를 건드리지 않는다.
  keepEncounterObjectReachable(state, rt);
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
