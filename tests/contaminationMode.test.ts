/**
 * 오염 확산(contamination) 콘텐츠 — Lane8 (ADR-0021 §2.6).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 함수 계약(§1)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를 만들고
 * `createWorld`/`stepWorld` 를 진짜로 굴려 콘텐츠 배선이 sim 까지 도달함을 증명한다(§2 가 핵심
 * 증거). 톡사르(오염 행성)는 아직 미배정이라(Lane9 소관) mode 치환 브릿지를 쓴다 —
 * `{ ...buildRunConfig(defaultProfile(), {planet:0, stage:1}), planetMode: contamination }` 로
 * createWorld→stepWorld 실도달:
 *   (a) 오염 런은 scrollRuntime·invasion3 을 세우지 않는다(비-스크롤 자유추적) · planetMode===contamination
 *   (b) createWorld 가 오염 노드 필드를 배치하고(뱀서류엔 없음), 시간이 지나며 오염 지형 셀이 실제로 늘어난다(확산 배선)
 *   (c) 아군탄으로 노드 파괴 → 정화율 상승 + 젬 드랍(destructible 기존 경로)
 *   (d) 정화율이 세그먼트를 전진시킨다(killGoal 아님 — kills=0 에서 전진)
 *   (e) 정화 임계에서 보스가 소환되고 처치 시 공통 승리(compact 재사용)
 *   (f) 오염 지형 위 플레이어는 지속 피해로 hp 가 준다
 *   (g) 임계 오염 셀 초과 시 gameOver(hp 사망 아님)
 *
 * 회귀(§3): 뱀서류(planetMode 0)·블록격파(planetMode 1)는 오염 콘텐츠 미개입 + 해시 재현.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { blankEntity, spawnBullet } from '../src/sim/entities.js';
import type { Entity, EntitySink } from '../src/sim/entities.js';
import { isBreakableWall } from '../src/sim/modes/blockBreak.js';
import { MID_CLASH_LEADER_MARK } from '../src/sim/modes/midClash.js';
import {
  placeContaminationField,
  stepContamination,
  contaminationPurifyRate,
  contaminationCritical,
  isContaminationNode,
  isContaminationCell,
  CONTAMINATION_NODE_COUNT,
  CONTAMINATION_NODE_MARK,
  CONTAMINATION_NODE_MAX_CELLS,
  CONTAMINATION_SPREAD_INTERVAL,
  CONTAMINATION_CRITICAL_CELLS,
  HAZARD_CONTAMINATION,
} from '../src/sim/modes/contamination.js';

const idle: InputFrame = emptyInput();
/** 런이 접촉·지형 피해로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 정규경로 브릿지(스펙 §8): 톡사르 미배정이라 planetMode 를 치환해 contamination 을 실도달시킨다. */
function contaminationConfig(): WorldConfig {
  return {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: PLANET_MODE.contamination,
  };
}

function durableContamination(): WorldConfig {
  return { ...contaminationConfig(), playerHp: DURABLE_HP };
}

function emptySink(): EntitySink {
  return { entities: [], nextEntityId: 1 };
}

/** placeContaminationField 로 노드를 깐 최소 상태(순수 stepContamination 계약 검증용). */
function fieldState(tick = 0): WorldState {
  const sink = emptySink();
  placeContaminationField(sink);
  return { tick, entities: sink.entities, nextEntityId: sink.nextEntityId } as unknown as WorldState;
}

function nodes(state: WorldState): Entity[] {
  return state.entities.filter(isContaminationNode);
}

function cells(state: WorldState): Entity[] {
  return state.entities.filter(isContaminationCell);
}

/**
 * 한 틱 진행하되 레벨업 프리즈를 자동 해소한다(racingMode 선례). 노드 파괴 젬을 주워 레벨업하면
 * 월드가 얼어(pendingLevelUp) 진행이 멎으므로, 픽(0)을 넣어 즉시 해소한다.
 */
function stepContam(state: WorldState, base: InputFrame = idle): void {
  const input = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : base;
  stepWorld(state, input);
}

/** 살아있는 오염 노드들에 거대 아군탄을 얹어 이번 스텝에 파괴한다(실제 피해 경로). */
function blastNodes(state: WorldState, count: number): void {
  let hit = 0;
  for (const e of state.entities) {
    if (hit >= count) break;
    if (e.dead || !isContaminationNode(e)) continue;
    spawnBullet(state, e.x, e.y, 0, 0, 1_000_000, 0, e.radius + 50, 60, 1, 0);
    hit++;
  }
}

// ---------------------------------------------------------------------------
// §1 — 순수 함수 계약
// ---------------------------------------------------------------------------

describe('오염 — 순수 함수', () => {
  it('placeContaminationField 는 RNG 없이 결정론 배치다(같은 입력=바이트 동일) · 노드 수=상수 · MARK', () => {
    const a = emptySink();
    const b = emptySink();
    placeContaminationField(a);
    placeContaminationField(b);
    expect(a.entities.length).toBe(CONTAMINATION_NODE_COUNT);
    expect(b.entities.length).toBe(CONTAMINATION_NODE_COUNT);
    for (let i = 0; i < a.entities.length; i++) {
      const x = a.entities[i] as Entity;
      const y = b.entities[i] as Entity;
      expect([x.kind, x.x, x.y, x.radius, x.hp, x.ownerId, x.aux0]).toEqual([
        y.kind,
        y.x,
        y.y,
        y.radius,
        y.hp,
        y.ownerId,
        y.aux0,
      ]);
      expect(isContaminationNode(x)).toBe(true);
      expect(x.ownerId).toBe(CONTAMINATION_NODE_MARK);
      expect(x.aux0).toBe(0);
    }
  });

  it('isContaminationNode/Cell 는 마커·서브타입으로만 참이다(절차 destructible·타 해저드 제외)', () => {
    const node = blankEntity('destructible');
    node.ownerId = CONTAMINATION_NODE_MARK;
    expect(isContaminationNode(node)).toBe(true);
    const chunkDestr = blankEntity('destructible'); // ownerId=0(절차 청크)
    expect(isContaminationNode(chunkDestr)).toBe(false);
    const cell = blankEntity('hazard');
    cell.enemyType = HAZARD_CONTAMINATION;
    expect(isContaminationCell(cell)).toBe(true);
    const otherHazard = blankEntity('hazard'); // enemyType=-1
    expect(isContaminationCell(otherHazard)).toBe(false);
    expect(isContaminationNode(cell)).toBe(false);
    expect(isContaminationCell(node)).toBe(false);
  });

  it('stepContamination 은 확산 틱에만 노드마다 셀 1개를 뿌리고 aux0 을 정수로 증가시킨다', () => {
    const state = fieldState(0); // tick 0 = 확산 틱(0 % INTERVAL === 0)
    stepContamination(state);
    expect(cells(state).length).toBe(CONTAMINATION_NODE_COUNT);
    for (const n of nodes(state)) {
      expect(n.aux0).toBe(1);
      expect(Number.isInteger(n.aux0)).toBe(true);
    }
    // 확산 틱이 아니면 무연산(셀·aux0 불변).
    state.tick = 1;
    stepContamination(state);
    expect(cells(state).length).toBe(CONTAMINATION_NODE_COUNT);
    for (const n of nodes(state)) expect(n.aux0).toBe(1);
  });

  it('stepContamination 은 노드당 MAX_CELLS 에서 확산을 멈춘다(상한)', () => {
    const state = fieldState(0);
    // 확산 틱을 MAX_CELLS + 2 회 태운다(항상 tick % INTERVAL === 0 로 유지).
    for (let r = 0; r < CONTAMINATION_NODE_MAX_CELLS + 2; r++) {
      state.tick = r * CONTAMINATION_SPREAD_INTERVAL;
      stepContamination(state);
    }
    for (const n of nodes(state)) expect(n.aux0).toBe(CONTAMINATION_NODE_MAX_CELLS);
    expect(cells(state).length).toBe(CONTAMINATION_NODE_COUNT * CONTAMINATION_NODE_MAX_CELLS);
  });

  it('dead 노드는 확산하지 않는다(파괴 = 정화 억제)', () => {
    const state = fieldState(0);
    const first = nodes(state)[0] as Entity;
    first.dead = true;
    stepContamination(state);
    // 죽은 노드는 셀을 뿌리지 않고 aux0 도 그대로다.
    expect(cells(state).length).toBe(CONTAMINATION_NODE_COUNT - 1);
    expect(first.aux0).toBe(0);
  });

  it('contaminationPurifyRate = (NODE_COUNT − 살아있는 마킹 노드)/NODE_COUNT', () => {
    const state = fieldState(0);
    expect(contaminationPurifyRate(state)).toBe(0); // 전부 살아있음
    (nodes(state)[0] as Entity).dead = true;
    expect(contaminationPurifyRate(state)).toBeCloseTo(1 / CONTAMINATION_NODE_COUNT, 10);
    for (const n of nodes(state)) n.dead = true;
    expect(contaminationPurifyRate(state)).toBe(1);
  });

  it('contaminationCritical 은 마킹 오염 셀 수 ≥ CRITICAL_CELLS 에서만 참이다', () => {
    const mk = (): Entity => {
      const c = blankEntity('hazard');
      c.enemyType = HAZARD_CONTAMINATION;
      return c;
    };
    const under = { entities: Array.from({ length: CONTAMINATION_CRITICAL_CELLS - 1 }, mk) } as unknown as WorldState;
    expect(contaminationCritical(under)).toBe(false);
    const at = { entities: Array.from({ length: CONTAMINATION_CRITICAL_CELLS }, mk) } as unknown as WorldState;
    expect(contaminationCritical(at)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — 정규경로 통합(배선 실도달 증명, 브릿지 config)
// ---------------------------------------------------------------------------

describe('오염 — 정규경로 통합(배선 실도달)', () => {
  it('(a) 오염 런은 비-스크롤 자유추적이다(scrollRuntime·invasion3 미존재) · planetMode===contamination', () => {
    const w = createWorld(11, durableContamination());
    expect(w.scrollRuntime).toBeUndefined();
    expect(w.invasion3).toBeUndefined();
    expect(w.config.planetMode).toBe(PLANET_MODE.contamination);
    // 짧게 굴려도 비-스크롤이 유지된다(카메라·스크롤 코드 미개입).
    for (let i = 0; i < 20; i++) stepContam(w);
    expect(w.scrollRuntime).toBeUndefined();
  });

  it('(b) createWorld 가 오염 노드 필드를 배치하고(뱀서류엔 없음) 확산으로 오염 지형 셀이 늘어난다', () => {
    const w = createWorld(1, durableContamination());
    expect(nodes(w).length).toBe(CONTAMINATION_NODE_COUNT);
    // 뱀서류엔 오염 노드가 없다.
    const vamp = createWorld(1, {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      playerHp: DURABLE_HP,
    });
    expect(nodes(vamp).length).toBe(0);
    expect(cells(vamp).length).toBe(0);
    // 확산 배선: 노드를 살려 둔 채(무기 무력화) 셀이 시간이 지나며 는다.
    w.weapon.damage = 0;
    for (let i = 0; i < 5; i++) stepContam(w);
    const early = cells(w).length;
    expect(early).toBeGreaterThan(0); // tick 0 확산분
    for (let i = 0; i < CONTAMINATION_SPREAD_INTERVAL + 5; i++) stepContam(w);
    expect(cells(w).length).toBeGreaterThan(early); // 확산이 실제로 진행(배선 증거)
    // 노드는 살아 있어 정화율 0 유지(확산이 정화로 오인되지 않음).
    expect(contaminationPurifyRate(w)).toBe(0);
  });

  it('(c) 아군탄으로 노드 파괴 → 정화율 상승 + 젬 드랍(destructible 기존 경로)', () => {
    const w = createWorld(7, durableContamination());
    w.weapon.damage = 0; // 오토어택 젬을 배제해 노드 드랍만 남긴다.
    expect(contaminationPurifyRate(w)).toBe(0);
    const gems0 = w.entities.filter((e) => e.kind === 'gem').length;
    blastNodes(w, 1); // 노드 1개에 거대 아군탄
    for (let i = 0; i < 4; i++) stepContam(w);
    expect(contaminationPurifyRate(w)).toBeGreaterThan(0); // 노드 파괴 = 정화
    expect(w.entities.filter((e) => e.kind === 'gem').length).toBeGreaterThan(gems0); // 젬 드랍
  });

  it('(d) 정화율이 세그먼트를 전진시킨다(killGoal 아님 — kills=0 에서 전진)', () => {
    const w = createWorld(3, durableContamination());
    w.weapon.damage = 0; // kills 를 0 으로 고정 → killGoal 게이트 배제(전진하면 정화율뿐)
    expect(w.wave.segmentIndex).toBe(0);
    blastNodes(w, 6); // 6/10 파괴 → 정화율 0.6
    for (let i = 0; i < 12; i++) stepContam(w);
    expect(w.kills).toBe(0); // 처치 0 — killGoal 로는 절대 전진 못 함
    expect(contaminationPurifyRate(w)).toBeCloseTo(0.6, 10);
    // 정화율 0.6 → 마일스톤 1/6·2/6·3/6 통과 → 세그먼트 3 에 정착. index 3 은 중반 격전
    // (ADR-0032)이라 그 다음 전진은 정화율이 아니라 리더 처치인데, 무기가 무력화돼 있어
    // 리더가 살아남는다 → 여기서 멈춘다(정화율 게이트가 실제로 3칸을 밀었다는 증거).
    expect(w.wave.segmentIndex).toBe(3);
  });

  it('(e) 정화 임계에서 보스가 소환되고 처치 시 공통 승리(compact 재사용)로 victory 가 선다', () => {
    const w = createWorld(9, durableContamination());
    w.weapon.damage = 0;
    blastNodes(w, CONTAMINATION_NODE_COUNT); // 전량 파괴 → 정화율 1.0
    let boss: Entity | undefined;
    for (let i = 0; i < 240; i++) {
      stepContam(w);
      // 중반 격전(ADR-0032) 리더는 정화율과 무관한 별도 전진 게이트다 — 무기를 무력화한
      // 이 테스트에서는 저절로 죽지 않으므로, 보스(아래)와 같은 방식으로 거대 아군탄을 쏴
      // **실제 피해 경로로** 처치해 격전 세그먼트를 통과시킨다(수동 dead 세팅 금지).
      const leader = w.entities.find(
        (e) => e.kind === 'enemy' && !e.dead && e.aux1 === MID_CLASH_LEADER_MARK,
      );
      if (leader !== undefined) {
        spawnBullet(w, leader.x, leader.y, 0, 0, 1_000_000, 0, leader.radius + 100, 120, 1, 0);
      }
      boss = w.entities.find((e) => e.kind === 'boss');
      if (boss !== undefined) break;
    }
    expect(contaminationPurifyRate(w)).toBe(1); // 정화 임계 도달
    expect(boss).toBeDefined();
    expect(w.bossSpawned).toBe(true);
    // 보스 처치 → 공통 승리(compact)를 **실제 피해 경로로** 못박는다(수동 dead 세팅 금지).
    (boss as Entity).hp = 10;
    for (let i = 0; i < 40 && !w.victory; i++) {
      const b = w.entities.find((e) => e.kind === 'boss');
      if (b !== undefined) spawnBullet(w, b.x, b.y, 0, 0, 1_000_000, 0, b.radius + 100, 120, 1, 0);
      stepContam(w);
    }
    expect(w.victory).toBe(true);
  });

  it('(f) 오염 지형 위 플레이어는 지속 피해로 hp 가 준다', () => {
    const w = createWorld(5, durableContamination());
    w.weapon.damage = 0;
    stepContam(w); // tick 0 확산 → 셀 생성
    const cell = cells(w)[0] as Entity;
    expect(cell).toBeDefined();
    // 접촉 피해 격리(적·보스 제거 — compact 가 수거).
    for (const e of w.entities) if (e.kind === 'enemy' || e.kind === 'boss') e.dead = true;
    const player = w.entities[0] as Entity;
    player.x = cell.x;
    player.y = cell.y;
    player.iframes = 0;
    const hp0 = player.hp;
    stepContam(w);
    expect(player.hp).toBeLessThan(hp0);
  });

  it('(g) 임계 오염 셀 초과 시 gameOver 가 선다(hp 사망 아님)', () => {
    const w = createWorld(13, durableContamination());
    w.weapon.damage = 0; // 노드를 살려 확산이 임계까지 쌓이게 한다.
    // 임계 도달까지 필요한 확산 틱 수를 **상수에서 파생**한다(하드코딩 금지 — 케이던스를
    // 바꾸면 이 루프도 함께 따라와야 한다).
    const spreadsToCritical = Math.ceil(CONTAMINATION_CRITICAL_CELLS / CONTAMINATION_NODE_COUNT);
    const budget = (spreadsToCritical + 1) * CONTAMINATION_SPREAD_INTERVAL;
    for (let i = 0; i < budget && !w.gameOver; i++) stepContam(w);
    expect(w.gameOver).toBe(true);
    expect(contaminationCritical(w)).toBe(true);
    // hp 사망이 아니라 임계 오염 실패임을 못박는다(durableHP 라 hp 는 아직 크다).
    expect((w.entities[0] as Entity).hp).toBeGreaterThan(0);
  });

  it('(g2) 시작 직후에는 절대 실패하지 않는다 — "톡사르는 5초 안에 무조건 진다" 회귀 가드', () => {
    // 사용자 신고 2026-07-27. 확산 케이던스가 30틱(0.5초)이라 노드 10개가 **틱 120(2.0초)에**
    // 임계 50셀을 넘겼다 — 노드 하나 깨는 데 실측 약 1.2초가 걸리므로 개입 자체가 불가능했다.
    // 게이트가 열리기 전에 최소한 이만큼은 손댈 시간이 있어야 한다.
    const MIN_GRACE_TICKS = 5 * 60;
    const w = createWorld(13, durableContamination());
    w.weapon.damage = 0; // 최악의 경우(노드 10개 전부 생존)로 확산 최대 속도를 준다.
    for (let i = 0; i < MIN_GRACE_TICKS; i++) {
      stepContam(w);
      expect(w.gameOver, `틱 ${w.tick} 에 이미 실패했다(개입 여지 없음)`).toBe(false);
    }
  });

  it('(g3) 노드를 충분히 정화하면 임계가 구조적으로 닫힌다(남은 확산 예산 < 임계)', () => {
    // 확산 총량의 상한 = 살아있는 노드 수 × 노드당 예산. 이 값이 임계 아래로 떨어지면 이후
    // 무엇을 하든 실패할 수 없다 — "정화가 확산을 앞질렀다" 가 수치로 성립하는지 본다.
    const killed = Math.ceil(
      (CONTAMINATION_NODE_COUNT * CONTAMINATION_NODE_MAX_CELLS - CONTAMINATION_CRITICAL_CELLS + 1) /
        CONTAMINATION_NODE_MAX_CELLS,
    );
    expect(killed, '노드를 절반 넘게 깨야 겨우 닫히면 게이트가 너무 가혹하다').toBeLessThanOrEqual(
      CONTAMINATION_NODE_COUNT / 2,
    );
    const w = createWorld(13, durableContamination());
    // 정화(파괴)를 직접 표현한다 — 이 테스트가 보는 것은 확산 예산 산술이지 사격 경로가 아니다.
    let done = 0;
    for (const e of w.entities) {
      if (done >= killed) break;
      if (isContaminationNode(e) && !e.dead) {
        e.dead = true;
        done++;
      }
    }
    w.weapon.damage = 0;
    for (let i = 0; i < CONTAMINATION_SPREAD_INTERVAL * (CONTAMINATION_NODE_MAX_CELLS + 2); i++) {
      stepContam(w);
    }
    expect(contaminationCritical(w), '남은 예산이 임계 아래인데도 실패가 섰다').toBe(false);
    expect(w.gameOver).toBe(false);
  });

  it('(h) 필드에서 컬 반경 밖으로 도망가도 노드가 컬링되지 않아 정화율이 0을 유지한다 — 도망 exploit 회귀 가드(리뷰 CRITICAL)', () => {
    // isGimmick 이 오염 노드/셀을 청크 컬링 대상으로 잘못 분류하면, 자유추적 플레이어가 필드에서
    // 멀어질 때 노드가 dead 로 컬링되고 contaminationPurifyRate 가 그걸 "정화됨"으로 세어
    // **도망만으로 정화율이 올라 무노력 승리**가 났다(CONTAMINATION_NODE_MARK/HAZARD_CONTAMINATION
    // 를 isGimmick 에서 제외해 해결). 이 가드가 그 회귀를 막는다.
    const w = createWorld(21, durableContamination());
    w.weapon.damage = 0; // 노드를 실제로 파괴하지 않았음을 확실히(원거리라 안 맞지만 이중 보증).
    const player = w.entities[0] as Entity;
    expect(nodes(w).length).toBe(CONTAMINATION_NODE_COUNT); // 원점 링에 배치됨
    expect(contaminationPurifyRate(w)).toBe(0);
    // 컬 반경(CHUNK_CULL_RADIUS=3000) 훨씬 밖으로 이동 → activateChunks 가 매 틱 gimmick 을 컬링한다.
    player.x = 8000;
    player.y = 8000;
    for (let i = 0; i < 10; i++) stepContam(w);
    // 수정 전이면 노드가 컬링돼 배열에서 사라지고(compact 제거) 정화율이 상승했다.
    expect(nodes(w).length).toBe(CONTAMINATION_NODE_COUNT); // ★ 노드가 하나도 안 지워졌다
    expect(contaminationPurifyRate(w)).toBe(0); // ★ 도망으로 정화율이 오르지 않는다(파괴 없음)
    expect(w.bossSpawned).toBe(false); // 무노력 보스 소환도 없다
  });
});

// ---------------------------------------------------------------------------
// §3 — 회귀(뱀서류·블록격파 무개입 + 해시 재현)
// ---------------------------------------------------------------------------

describe('오염 — 회귀(뱀서류·블록격파 무개입)', () => {
  it('뱀서류 런에는 오염 콘텐츠·scrollRuntime 이 없고 해시가 재현된다', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const run = (): number[] => {
      const w = createWorld(31337, { ...cfg, playerHp: DURABLE_HP });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, { ...idle, moveX: 1 });
        out.push(hashWorld(w));
      }
      expect(nodes(w).length).toBe(0);
      expect(cells(w).length).toBe(0);
      expect(w.scrollRuntime).toBeUndefined();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('블록격파 런은 여전히 −Y 스크롤·벽 파괴 동작이고 오염 콘텐츠가 없다(해시 재현)', () => {
    const blockBreakCfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.blockBreak,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(4242, blockBreakCfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      expect(w.scrollRuntime).toBeDefined();
      expect(w.scrollRuntime!.scrollY).toBeLessThan(0);
      expect(w.entities.some(isBreakableWall)).toBe(true);
      // 오염 콘텐츠(노드·오염 지형)는 하나도 없다.
      expect(nodes(w).length).toBe(0);
      expect(cells(w).length).toBe(0);
      return out;
    };
    expect(run()).toEqual(run());
  });
});
