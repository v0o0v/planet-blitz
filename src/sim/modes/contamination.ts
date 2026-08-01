/**
 * 오염 확산(contamination) 모드 — Lane8 (ADR-0021 §2.6). 비-스크롤 **자유추적** 모드.
 * 파괴가능 오염 노드가 실시간으로 오염 지형 셀을 결정론 확산(정수 상태), 지형은 밟으면
 * 지속 피해를 주고, 노드를 파괴하면 확산이 억제(정화)된다. 정화율이 임계에 닿으면 오염원
 * 코어 보스가 소환되고(공통 보스 처치 = 승리), 맵이 임계까지 오염되면 실패한다. 서바이벌
 * 코어(웨이브 디렉터·파워업·드랍)는 불변, 진행 게이트만 정화율로 바꾼다. 전 계수는
 * 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 WorldState 필드 0 (Lane4/5 철학 계승)
 * 오염 상태는 전부 **엔티티 + 노드 aux**에 싣는다:
 *   - 오염 노드 = `destructible` + `ownerId === CONTAMINATION_NODE_MARK`(센티넬, RACING_WALL_MARK
 *     선례). `aux0` = 지금까지 뿌린 오염 지형 셀 수(확산 진척, 정수, 상한 MAX_CELLS).
 *   - 오염 지형 = `hazard`(life=-1 영구·phase=1 continuous) + `enemyType === HAZARD_CONTAMINATION`.
 *     `ownerId` = 이 셀을 뿌린 **노드 id**(정화 되돌림의 연결 고리 — {@link purifyContamination}).
 *   - 정화율(게이트) = (NODE_COUNT − 살아있는 마킹 노드)/NODE_COUNT. 분모는 상수(createWorld 가
 *     정확히 그만큼 배치) → 필드 불요.
 *   - 임계 오염(실패) = 마킹된 오염 지형 수 ≥ CRITICAL_CELLS.
 * → 신규 WorldState 필드 없음 → hashWorld 변경 없음. 노드 aux0(정수)·엔티티가 이미 해시에 접힌다.
 *   오염은 `planetMode === contamination` 게이트라 뱀서류·침공·블록격파·레이싱 바이트 불변.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 배치는 고정 좌표(플레이어 시작 0,0 주변 링), 확산은 tick·
 * 좌표·aux 순수 함수(결정론 트리그 `cos`/`sin`). aux0 은 **정수 필수**(hashU32 로 접힘 — 소수부
 * 유실). 확산 스폰은 노드 순회 뒤 일괄 append(배열 순회 중 push 회피).
 *
 * ## 순환 의존 주의
 * world.ts / waves.ts / entityRenderer.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서
 * **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈(entities·math)로만(blockBreak/racing 선례).
 */
import type { Entity, EntitySink } from '../entities.js';
import { spawnDestructible, spawnHazard } from '../entities.js';
import type { WorldState } from '../world.js';
import { cos, sin, TWO_PI } from '../math.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 오염 노드 수(= 정화율 분모, createWorld 가 정확히 이만큼 배치). TODO(밸런스). */
export const CONTAMINATION_NODE_COUNT = 10;
/** 오염 노드 HP(아군탄이 깎아 파괴 = 정화). TODO(밸런스). */
export const CONTAMINATION_NODE_HP = 120;
/** 오염 노드 반경(조준·피격 판정). TODO(밸런스). */
export const CONTAMINATION_NODE_RADIUS = 60;
/** 노드 파괴 시 드랍 젬 XP(destructible 기존 드랍 경로). TODO(밸런스). */
export const CONTAMINATION_NODE_GEM_XP = 5;
/** 노드 배치 링 반경(플레이어 시작 0,0 주변). TODO(밸런스). */
export const CONTAMINATION_NODE_RING_RADIUS = 900;
/** 노드당 확산 상한(뿌릴 수 있는 오염 지형 셀 수). TODO(밸런스). */
export const CONTAMINATION_NODE_MAX_CELLS = 6;
/**
 * 확산 틱 간격(이 배수 틱마다 살아있는 노드가 1셀씩 확장).
 *
 * ⚠️ 30(0.5초)이면 노드 10개가 매 0.5초에 10셀을 뿌려 **틱 120(2.0초)에 임계 50셀**을 넘겼다 —
 * 톡사르는 무엇을 하든 시작 2초에 지는 모드였다(사용자 신고 2026-07-27, 실측 3시드 전부 tick 121
 * gameOver·플레이어 HP 만피). 노드 하나를 깨는 데 실측 약 1.2초가 걸리므로 0.5초 케이던스로는
 * 개입 자체가 성립하지 않는다. 150(2.5초)이면 방치 시 임계까지 12.5초가 걸려 그 사이에 노드를
 * 깨 확산원을 줄이는 것이 실제 선택지가 된다. TODO(밸런스): 출시 전 튜닝.
 */
export const CONTAMINATION_SPREAD_INTERVAL = 150;
/**
 * 정화(dead 노드가 뿌린 셀 걷기) 판정 간격(틱). 6틱 = 0.1초마다 **소유 노드가 죽은 셀을
 * 노드당 1개씩** 지운다 → 노드 하나가 뿌린 최대 6셀이 0.6초에 걷힌다(눈에 보이는 되돌림).
 * {@link purifyContamination} 참조.
 */
export const CONTAMINATION_PURGE_INTERVAL = 6;
/** 오염 지형 셀 반경(지속 피해 판정). TODO(밸런스). */
export const CONTAMINATION_CELL_RADIUS = 100;
/** 오염 지형 셀 지속 피해(iframes 간격 적용, 즉사 아님). TODO(밸런스). */
export const CONTAMINATION_CELL_DAMAGE = 6;
/** 노드 중심에서 셀을 뿌리는 거리(셀 간격). TODO(밸런스). */
export const CONTAMINATION_CELL_SPACING = 160;
/**
 * 임계 오염 실패 셀 수(마킹 오염 지형 수 ≥ 이 값이면 gameOver).
 *
 * 확산 총량의 상한은 `NODE_COUNT × NODE_MAX_CELLS`(= 10 × 6 = 60)이라, 임계는 **그 상한에서
 * 얼마를 남기는가**로 읽어야 한다. 42 = 상한의 70% → 노드를 4개 이상 일찍 깨면 남은 예산이
 * 42 아래로 떨어져 실패가 구조적으로 닫힌다(= "정화가 확산을 앞질렀다"). 하나도 못 깨면
 * 12.5초(= 5 × SPREAD_INTERVAL)에 진다. TODO(밸런스): 출시 전 튜닝.
 */
export const CONTAMINATION_CRITICAL_CELLS = 42;
/**
 * 보스 소환 정화율(0..1). 마지막 일반 세그먼트 통과 = 정화율이 이 값 이상 도달 → 보스 세그먼트.
 * 구간별 마일스톤은 이 임계를 세그먼트 수로 나눈 곡선이다(waves.ts). TODO(밸런스).
 */
export const CONTAMINATION_PURIFY_THRESHOLD = 1;

/**
 * 오염 노드 마커(ownerId 센티넬). 절차 청크 destructible(ownerId=0)과 구분해 정화율 카운트에서
 * 마킹 노드만 센다. 기존 6개 마커(DRONE_MARK 0xd4090e·BROOD_MARK 0xb400d5·MISSILE_MARK
 * 0x3155110·HIVE_MICRO_MARK 0x81ce77·SPLIT_FRAGMENT_MARK 0xf12a6·RACING_WALL_MARK 0x4ac1a6)와
 * 전부 다르다. 이 값은 오염 런에만 등장한다(그 외 destructible 은 ownerId=0 이라 거동·해시 불변).
 */
export const CONTAMINATION_NODE_MARK = 0xc0f7a1;

/**
 * 오염 지형 서브타입 태그(hazard.enemyType). 절차 지형 해저드·설비 해저드와 구분해 렌더 분화·
 * 임계 카운트에 쓴다. 기존 HAZARD_MORTAR 0·HAZARD_LAVA 1·HAZARD_SLOW 2·HAZARD_TERRAIN 2 와
 * 다르다(append-only, 재번호 금지).
 */
export const HAZARD_CONTAMINATION = 3;

/** 오염 노드인가(파괴가능 오브젝트 + 오염 마커). 절차 청크 destructible(ownerId=0)은 항상 false. */
export function isContaminationNode(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === CONTAMINATION_NODE_MARK;
}

/** 오염 지형 셀인가(해저드 + 오염 서브타입). 절차 지형·설비 해저드는 항상 false. */
export function isContaminationCell(e: Entity): boolean {
  return e.kind === 'hazard' && e.enemyType === HAZARD_CONTAMINATION;
}

/**
 * 오염 노드를 고정(RNG 없는) 결정론 좌표에 배치한다(createWorld 1회). 플레이어 시작 좌표(0,0)
 * 주변 링에 `CONTAMINATION_NODE_COUNT` 개를 균등 배치한다. 각 노드는 destructible + 오염 마커 +
 * aux0=0(확산 진척)로 시작한다. 초기 오염 지형 셀은 두지 않는다(정화율·임계가 0 에서 시작 —
 * 확산이 stepContamination 으로만 진행). 배치는 인덱스만의 함수(결정론 트리그)라 같은 필드가
 * 항상 동일 배치다 — 시드·해시 스트림에 영향이 없다.
 */
export function placeContaminationField(sink: EntitySink): void {
  for (let i = 0; i < CONTAMINATION_NODE_COUNT; i++) {
    const angle = (i * TWO_PI) / CONTAMINATION_NODE_COUNT;
    const x = cos(angle) * CONTAMINATION_NODE_RING_RADIUS;
    const y = sin(angle) * CONTAMINATION_NODE_RING_RADIUS;
    const node = spawnDestructible(
      sink,
      x,
      y,
      CONTAMINATION_NODE_RADIUS,
      CONTAMINATION_NODE_HP,
      CONTAMINATION_NODE_GEM_XP,
    );
    node.ownerId = CONTAMINATION_NODE_MARK;
    node.aux0 = 0; // 확산 진척(뿌린 셀 수, 정수)
  }
}

/**
 * 오염 확산 한 틱(stepWorld 배선). `CONTAMINATION_SPREAD_INTERVAL` 배수 틱마다, 살아있는 각
 * 오염 노드가 확산 상한(aux0 < MAX_CELLS) 안이면 노드 주변 결정론 오프셋(aux0 기반 링, RNG
 * 없음)에 오염 지형 셀 1개를 뿌리고 aux0 를 1 늘린다. **dead 노드는 확산하지 않는다**(파괴 =
 * 정화 억제, 자동). 스폰은 노드 순회 뒤 일괄 append 라 배열 순회 중 변형이 없다. 결정론·정수.
 */
export function stepContamination(state: WorldState): void {
  // 확산 케이던스: 이 틱이 확산 틱이 아니면 무연산(노드 순회조차 하지 않는다).
  if (state.tick % CONTAMINATION_SPREAD_INTERVAL !== 0) return;
  // 노드 순회 중에는 좌표만 모으고(배열 push 회피), aux0 증가만 in-place 로 한다.
  const cells: { x: number; y: number; owner: number }[] = [];
  for (const e of state.entities) {
    if (e.dead || !isContaminationNode(e)) continue;
    if (e.aux0 >= CONTAMINATION_NODE_MAX_CELLS) continue;
    const idx = e.aux0;
    const angle = (idx * TWO_PI) / CONTAMINATION_NODE_MAX_CELLS;
    cells.push({
      x: e.x + cos(angle) * CONTAMINATION_CELL_SPACING,
      y: e.y + sin(angle) * CONTAMINATION_CELL_SPACING,
      owner: e.id, // 정화 되돌림의 연결 고리({@link purifyContamination})
    });
    e.aux0 = idx + 1; // 정수 유지(hashU32 로 접힘 — 소수 금지)
  }
  // 순회 종료 후 일괄 append. 오염 지형 = 영구 해저드(windup 0 즉시 활성 · life -1 불멸 ·
  // continuous). resolveCollisions 가 활성 해저드로 지속 피해를 준다(별도 코드 불요).
  for (const c of cells) {
    spawnHazard(
      state,
      HAZARD_CONTAMINATION,
      c.x,
      c.y,
      CONTAMINATION_CELL_RADIUS,
      0, // windup: 즉시 활성(예열 없음)
      -1, // life: 영구 지형 해저드(청크 컬링만 소멸)
      CONTAMINATION_CELL_DAMAGE,
      true, // continuous
      c.owner, // ownerId = 이 셀을 뿌린 오염 노드({@link purifyContamination})
    );
  }
}

/**
 * 정화 되돌림 한 틱(stepWorld 배선, {@link stepContamination} 과 한 쌍).
 *
 * ## 왜 필요한가 — "일정 시간 넘으면 갑자기 실패"의 근본 원인
 * 원래 오염 셀은 **한 번 깔리면 영원히 남았다**. 노드를 부수면 *앞으로의* 확산만 멎을 뿐
 * 이미 깔린 셀은 그대로였으므로, 실패 게이지(`contaminationCritical`)는 **단조 증가**였다 —
 * 즉 톡사르의 실패는 플레이로 되돌릴 수 없는 **숨은 카운트다운**이었고, 임계를 넘는 순간
 * 예고 없이 gameOver 가 떴다(사용자 신고 2026-07-27 "일정 시간 넘으면 갑자기 실패").
 * 확산 간격을 늘리는 것(PR#155, 30→150틱)은 시계를 늦출 뿐 성질을 바꾸지 못한다.
 *
 * 그래서 셀에 **뿌린 노드**를 새긴다(`hazard.ownerId` = 노드 `id`, {@link purifyContamination}).
 * 노드가 죽으면 그 노드의 셀이 차례로 걷힌다 → 정화가 오염을 **되돌린다**. 실패 게이지가 양방향이
 * 되어 "밀리는 중"과 "만회하는 중"이 플레이 중에 읽히고, 실패는 되돌릴 수 없는 시계가 아니라
 * 플레이어가 진 싸움의 결과가 된다. HUD 오염도 게이지(render 전용)가 그 값을 보여준다.
 *
 * 한 판정 틱에 **노드당 최대 1셀**만 지운다(전멸 즉시 걷힘이 아니라 눈에 보이는 후퇴). 순수·결정론
 * (엔티티 배열 순서만 읽고 RNG·wall-clock 없음, dead 마킹만).
 */
export function purifyContamination(state: WorldState): void {
  if (state.tick % CONTAMINATION_PURGE_INTERVAL !== 0) return;
  const aliveNodes = new Set<number>();
  for (const e of state.entities) {
    if (!e.dead && isContaminationNode(e)) aliveNodes.add(e.id);
  }
  // 이번 판정에서 이미 1셀을 지운 소유자(노드당 1셀 상한).
  const purgedOwners = new Set<number>();
  for (const e of state.entities) {
    if (e.dead || !isContaminationCell(e)) continue;
    // ownerId 0 = 소유 노드 기록 이전 경로(방어적) → 걷지 않는다.
    if (e.ownerId === 0 || aliveNodes.has(e.ownerId) || purgedOwners.has(e.ownerId)) continue;
    e.dead = true;
    purgedOwners.add(e.ownerId);
  }
}

/**
 * 살아있는 오염 지형 셀 수(실패 게이지의 분자). HUD 오염도 게이지(render 전용)와
 * {@link contaminationCritical} 가 같은 정의를 쓰도록 여기 한 곳에 둔다. 순수 판정.
 */
export function contaminationCellCount(state: WorldState): number {
  let cells = 0;
  for (const e of state.entities) {
    if (!e.dead && isContaminationCell(e)) cells++;
  }
  return cells;
}

/**
 * 정화율(0..1) = (NODE_COUNT − 살아있는 마킹 노드)/NODE_COUNT. 분모는 상수(createWorld 배치 수)라
 * 필드 불요. 노드를 파괴(정화)할수록 오른다. 순수 판정 — 상태를 바꾸지 않는다.
 */
export function contaminationPurifyRate(state: WorldState): number {
  let alive = 0;
  for (const e of state.entities) {
    if (!e.dead && isContaminationNode(e)) alive++;
  }
  return (CONTAMINATION_NODE_COUNT - alive) / CONTAMINATION_NODE_COUNT;
}

/**
 * 임계 오염 여부(실패 게이트). 살아있는 마킹 오염 지형 셀 수가 `CONTAMINATION_CRITICAL_CELLS`
 * 이상이면 true. 순수 판정 — 상태를 바꾸지 않는다.
 */
export function contaminationCritical(state: WorldState): boolean {
  return contaminationCellCount(state) >= CONTAMINATION_CRITICAL_CELLS;
}
