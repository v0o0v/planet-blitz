/**
 * 사용자 신고 5건(2026-08-04) 회귀 잠금 — 행성별로 하나씩.
 *
 * 각 절이 잠그는 것은 "고쳤다"가 아니라 **결함이 살아 있었을 때 실제로 깨지는 단언**이다.
 * 다섯 결함 모두 기존 스위트가 전부 초록인 채로 통과하고 있었으므로, 그 구멍을 그대로 메운다.
 */

import { describe, it, expect } from 'vitest';

import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { midClashGateActive } from '../src/sim/waves.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { SEGMENTS } from '../data/waves.js';
import {
  CHASE_SHELTER_RADIUS,
  updateChaseShelters,
  chaseSheltersSecured,
  isShelter,
  isShelterSecured,
} from '../src/sim/modes/chase.js';
import { isContaminationNode } from '../src/sim/modes/contamination.js';
import { isBreakableWall, BLOCKBREAK_ROW_SPACING, blockBreakCourseLength } from '../src/sim/modes/blockBreak.js';
import { displaySize } from '../src/render/friendlyDisplay.js';
import { HP_BAR_KINDS } from '../src/render/entity/enemyHpBar.js';
import { adornerFactoryCount, createAdorners } from '../src/render/entity/adorner.js';
import '../src/render/entity/index.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';

/** 행성 런 설정(맨몸 기준선 — 기본 프로필). */
function planetConfig(planet: number): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet, stage: 1 }), playerHp: 100_000_000 };
}

/** 세그먼트 인덱스를 직접 세팅한다(sim 상태 조작 — 관측 전용). */
function atSegment(state: WorldState, index: number): void {
  state.wave.segmentIndex = index;
}

// ---------------------------------------------------------------------------
// ① 니플헤임 — "간혹 대피소에 가도 도착 체크가 안 된다"
// ---------------------------------------------------------------------------

describe('① 니플헤임(추격) — 격전 세그먼트에서는 대피소를 목표로 표시하지 않는다', () => {
  /** 격전 세그먼트가 실재해야 이 절이 공허하지 않다. */
  const clashIndex = SEGMENTS.findIndex((s) => s.clash === true);

  it('전제 — 추격 무대에 격전 세그먼트가 존재한다(공허 검증 방지)', () => {
    expect(clashIndex).toBeGreaterThanOrEqual(0);
    const w = createWorld(1, planetConfig(2));
    expect(w.config.planetMode).toBe(PLANET_MODE.chase);
    // 추격은 비-스크롤·무의뢰라 격전 게이트가 실제로 선다.
    atSegment(w, clashIndex);
    expect(midClashGateActive(w)).toBe(true);
  });

  it('가리키는 대피소는 **어느 세그먼트에서도** 밟으면 든다 — 표시와 규칙이 갈릴 수 없다', () => {
    // ## 원 신고(2026-08-04): "간혹 대피소에 가도 체크가 안 된다"
    // 당시 원인은 **같은 술어를 세 곳에 따로 적은 것**이었다. 목표 대피소는 `aux0 ===
    // segmentIndex` 하나뿐인데 격전 세그먼트에서는 전진 게이트가 리더 처치로 바뀌어, 화면은
    // 초록 강조·링·화살표·레이더로 대피소를 가리키는데 도착해도 아무 일이 없었다.
    //
    // ## 2026-08-05 재설계로 이 결함 부류가 **구조적으로** 사라졌다
    // 표시(`active`)와 확보(`updateChaseShelters`)가 이제 **같은 술어 하나**(미확보)를 본다.
    // 세그먼트는 어느 쪽에도 등장하지 않는다. 그래서 격전 구간이든 아니든 "가리키는 곳을
    // 밟으면 든다"가 전 구간에서 성립한다 — 그것을 전수로 확인한다.
    for (const idx of [0, 1, 2, clashIndex]) {
      const w = createWorld(1, planetConfig(2));
      atSegment(w, idx);
      const shown = snapshotWorld(w).entities.filter((e) => e.kind === 'shelter' && e.active);
      // 미확보 대피소는 전부 목표다(격전 구간에서도 0개가 되지 않는다).
      expect(shown.length, `세그먼트 ${idx} 에서 가리키는 대피소가 없다`).toBeGreaterThan(0);
      // 그중 하나를 실제로 밟으면 확보된다 — 화면이 가리킨 대로 규칙이 따라온다.
      const target = w.entities.find((e) => isShelter(e) && e.id === shown[0]!.id)!;
      const player = w.entities[0]!;
      player.x = target.x;
      player.y = target.y;
      updateChaseShelters(w);
      expect(isShelterSecured(target), `세그먼트 ${idx} 에서 밟았는데 안 들었다`).toBe(true);
      expect(chaseSheltersSecured(w)).toBe(1);
    }
  });

  it('대피소 그림이 도달 판정보다 크지 않다 — "밟았는데 안 든다"의 나머지 절반', () => {
    const w = createWorld(1, planetConfig(2));
    const player = w.entities[0]!;
    const shelter = w.entities.find((e) => isShelter(e));
    expect(shelter).toBeDefined();
    // 실제 도달 판정 반경 = 대피소 반경 + 플레이어 반경(원-원 겹침).
    const reach = CHASE_SHELTER_RADIUS + player.radius;
    // 표시 반경 = 지름/2. ART_SCALE(1.5)을 그대로 먹으면 210 > 172 라 그림 바깥 링에서
    // "완전히 패드 위인데 판정이 안 드는" 구간이 생겼다.
    const shown = displaySize('shelter', shelter!.radius, 1.5) / 2;
    expect(shown).toBeLessThanOrEqual(reach);
  });
});

// ---------------------------------------------------------------------------
// ④ 톡사르 — "오염도를 낮추려 부수는 기물에 HP를 표시해줘"
// ---------------------------------------------------------------------------

describe('④ 톡사르(오염) — 오염 노드에만 HP 바가 붙는다', () => {
  it('오염 노드가 스냅샷에서 objectiveNode 로 식별된다(ownerId 는 스냅샷에 없다)', () => {
    const w = createWorld(3, planetConfig(4));
    expect(w.config.planetMode).toBe(PLANET_MODE.contamination);
    const nodes = w.entities.filter((e) => isContaminationNode(e));
    expect(nodes.length).toBeGreaterThan(0);
    const snap = snapshotWorld(w);
    const flagged = snap.entities.filter((e) => e.objectiveNode === true);
    expect(flagged.length).toBe(nodes.length);
    // HP 바가 의미를 가지려면 hp/maxHp 가 실려 있어야 한다.
    for (const e of flagged) {
      expect(e.kind).toBe('destructible');
      expect(e.maxHp).toBeGreaterThan(0);
      expect(e.hp).toBeGreaterThan(0);
    }
  });

  it('오염 노드에는 장식자가 붙고, 일반 파괴물에는 안 붙는다', () => {
    expect(adornerFactoryCount('destructible')).toBeGreaterThan(0);
    const base: EntitySnapshot = {
      id: 1,
      kind: 'destructible',
      x: 0,
      y: 0,
      angle: 0,
      radius: 60,
      aabbH: 0,
      enemyType: -1,
      hp: 100,
      maxHp: 100,
      active: false,
      flash: false,
      elite: -1,
    };
    // ⚠️ kind 만으로 켜면 전 행성의 청크 돌덩이마다 바가 뜬다 — 사용자가 요청한 것은 톡사르뿐이다.
    expect(createAdorners(base).length).toBe(0);
    expect(createAdorners({ ...base, objectiveNode: true }).length).toBeGreaterThan(0);
  });

  it('무조건 바가 붙는 kind 목록에는 destructible 이 없다(조건부여야 한다)', () => {
    expect(HP_BAR_KINDS).not.toContain('destructible');
  });
});

// ---------------------------------------------------------------------------
// ③ 아르케 — "우측이 막혀서 무조건 벽에 부딪힐 때가 있음"
// ---------------------------------------------------------------------------

describe('③ 아르케(레이싱) — 설계된 코스 위에 절차 지형을 얹지 않는다', () => {
  /** 코스를 실제로 달리며 등장한 벽을 전부 모은다. */
  function wallsAlongCourse(seed: number, ticks: number): { x: number; halfW: number; y: number; halfH: number }[] {
    const state = createWorld(seed, planetConfig(3));
    const seen = new Map<number, { x: number; halfW: number; y: number; halfH: number }>();
    for (let t = 0; t < ticks; t++) {
      stepWorld(state, emptyInput());
      for (const e of state.entities) {
        if (e.dead || e.kind !== 'wall') continue;
        seen.set(e.id, { x: e.x, halfW: e.radius, y: e.y, halfH: e.targetX });
      }
    }
    return [...seen.values()];
  }

  it('레이싱 런에 등장하는 벽은 전부 설계 코스의 분기 분리벽이다(청크 프리팹 없음)', () => {
    const walls = wallsAlongCourse(0xa11e, 1800);
    expect(walls.length).toBeGreaterThan(0);
    // 설계 코스의 분리벽은 y=0 중앙선에 halfH 90 으로 놓인다(`placeRacingCourse`).
    // 청크 프리팹은 조각이 격자 위 임의 y 에 흩어지므로 이 단언이 그것을 잡는다.
    for (const w of walls) {
      expect(Math.abs(w.y), `벽 y=${w.y}`).toBeLessThanOrEqual(90);
    }
  });

  it('코스의 어느 지점에서도 위·아래 차선이 플레이어 전폭보다 넓게 열려 있다', () => {
    const state = createWorld(0xa11e, planetConfig(3));
    const player = state.entities[0]!;
    const width = player.radius * 2;
    // 플레이어 세로 가동 범위(창 반높이 − 반경).
    const halfSpan = 540 - player.radius;
    let checked = 0;
    for (let t = 0; t < 1800; t++) {
      stepWorld(state, emptyInput());
      if (t % 60 !== 0) continue;
      const px = state.entities[0]!.x;
      // 이 x 슬라이스를 막는 벽들의 y 구간을 모은다.
      const blocked: [number, number][] = [];
      for (const e of state.entities) {
        if (e.dead || e.kind !== 'wall') continue;
        if (px < e.x - e.radius || px > e.x + e.radius) continue;
        blocked.push([e.y - e.targetX, e.y + e.targetX]);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      // 자유 구간의 최대 폭을 잰다.
      let best = 0;
      let cursor = -halfSpan;
      for (const [lo, hi] of blocked) {
        if (lo > cursor) best = Math.max(best, lo - cursor);
        cursor = Math.max(cursor, hi);
      }
      best = Math.max(best, halfSpan - cursor);
      expect(best, `t=${t} x=${Math.round(px)} 최대 자유 폭`).toBeGreaterThan(width);
      checked++;
    }
    expect(checked).toBeGreaterThan(20); // 공허 검증 방지
  });

  it('뱀서류(카르곤)는 절차 지형을 그대로 쓴다 — 레이싱만 끈 것이다', () => {
    const state = createWorld(0xc0ffee, DEFAULT_CONFIG);
    for (let t = 0; t < 60 * 8; t++) stepWorld(state, { ...emptyInput(), moveX: 1 });
    const gimmicks = state.entities.filter(
      (e) => !e.dead && (e.kind === 'wall' || e.kind === 'destructible' || e.kind === 'bombDevice'),
    );
    expect(gimmicks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 크라스 — "블록 기물 등장을 30% 줄여줘"
// ---------------------------------------------------------------------------

describe('⑤ 크라스(블록격파) — 블록 행이 30% 줄었다', () => {
  it('행 수가 코스 길이 파생이고, 구값(800 간격) 대비 약 30% 적다', () => {
    const rows = Math.floor(blockBreakCourseLength() / BLOCKBREAK_ROW_SPACING);
    const oldRows = Math.floor(blockBreakCourseLength() / 800);
    const cut = 1 - rows / oldRows;
    expect(cut).toBeGreaterThan(0.25);
    expect(cut).toBeLessThan(0.35);
  });

  it('코스 길이·구간 게이트는 그대로다 — 페이싱은 이 변경에 끌려가지 않는다', () => {
    // 코스 길이는 구간 길이 × 구간 수 파생이고 행 간격과 무관하다.
    expect(blockBreakCourseLength()).toBe(14650 * (SEGMENTS.length - 1));
  });

  it('실제 런에도 파괴가능 벽이 남아 있다(줄였지 없애지 않았다)', () => {
    const state = createWorld(0xb10c, planetConfig(5));
    expect(state.config.planetMode).toBe(PLANET_MODE.blockBreak);
    expect(state.entities.filter((e) => isBreakableWall(e)).length).toBeGreaterThan(0);
  });
});
