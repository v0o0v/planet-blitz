/**
 * 강제 스크롤 정책 축 ANCHOR / WORLD — 순수 단위 (ADR-0034).
 *
 * ## 고치는 결함(이 파일이 증명하는 것)
 * 플레이어 기본 속도 720 u/s = 12 u/tick 이 `INVASION_SCROLL_SPEED`(12)와 정확히 같아서
 * 강제 스크롤 모드의 전방 상대속도 최댓값이 **0** 이었다. `clampToWindow` 가 창 뒤 경계에
 * 한 번 붙이면 전력 전진해도 영원히 붙어 있었다. 창 이동량의 70%를 플레이어 좌표에
 * 가산(ANCHOR)해 순전진(틱당 8유닛)이 성립하게 한다.
 *
 * 커버리지:
 *   1. `scrollAnchored` 정책 표 — **`KIND_CODE` 전건 순회**(하드코딩 목록이 아니다).
 *   2. `turretPickup` 이중 정책(phase 0=지형=WORLD / 1=활성 포탑=ANCHOR).
 *   3. `anchorPercentFor` — 플레이어만 70%, 나머지 앵커 대상은 100%.
 *   4. `insideScrollWindow` 경계 — 중심 오프셋 반영 + 경계 포함(`<=`).
 *   5. `applyScrollAnchor` 정수 규율(trunc)·창 밖 미앵커·WORLD 불변·dead skip·델타 0 no-op.
 *
 * ## 왜 ①을 전건 순회로 짜는가
 * 앵커 분류를 하드코딩 목록으로 단언하면 **새 kind 가 추가될 때 테스트가 조용히 통과**한다
 * (기존 목록만 맞으면 되니까). `KIND_CODE` 키를 순회해 "목록에 없는 전부는 false" 를 단언하면
 * 새 kind 는 이 테스트를 반드시 깨뜨려 작성자에게 ANCHOR/WORLD 분류를 강제한다.
 */

import { describe, it, expect } from 'vitest';
import { blankEntity, KIND_CODE, type Entity, type EntityKind } from '../src/sim/entities.js';
import {
  scrollAnchored,
  anchorPercentFor,
  insideScrollWindow,
  applyScrollAnchor,
  PLAYER_ANCHOR_PERCENT,
  FULL_ANCHOR_PERCENT,
} from '../src/sim/scrollMode.js';
import {
  INVASION_SCROLL_SPEED,
  INVASION_WINDOW_HALF_W,
  INVASION_WINDOW_HALF_H,
  type ScrollWindow,
} from '../src/sim/invasion/scroll.js';

/** 창 중심이 원점이 아닌 창 — 중심 오프셋을 실제로 반영하는지 보려고 일부러 비대칭 값. */
const OFFSET_WIN: ScrollWindow = { scrollX: 5000, scrollY: -3000 };
const ORIGIN_WIN: ScrollWindow = { scrollX: 0, scrollY: 0 };

/**
 * WORLD 축 정본 — **월드에 깔린 지형·구조물**(2026-07-27 정책 개정). 창이 지나가며 흘려보내는
 * 것은 이것들뿐이고, 살아 움직이는 실체(플레이어·적·보스·탄·편대·드론·회수물)는 전부 ANCHOR 다.
 * `turretPickup` 만 이중 정책(미활성=지형, 활성=아군 실체)이라 아래 별도 테스트로 다룬다.
 */
const WORLD_KINDS: readonly EntityKind[] = [
  'wall',
  'destructible',
  'hazard',
  'magnetEmitter',
  'bombDevice',
  'boostPad',
  'shelter',
  'core',
  'decoyCore',
  'facilityGun',
  'facilityHazard',
  'facilitySpawner',
  'prop',
  'turretPickup', // phase 0(미활성 픽업) 기준. 활성(phase 1)은 ANCHOR — 아래 테스트.
];

/** 창 중심에 놓인 kind 엔티티(앵커가 실제로 도는 위치). */
function at(kind: EntityKind, win: ScrollWindow, dx = 0, dy = 0): Entity {
  const e = blankEntity(kind);
  e.x = win.scrollX + dx;
  e.y = win.scrollY + dy;
  return e;
}

describe('scrollAnchored — 정책 표(KIND_CODE 전건 순회)', () => {
  it('WORLD 는 지형·구조물뿐이고 나머지 kind 는 전부 ANCHOR 다', () => {
    const world = new Set<EntityKind>(WORLD_KINDS);
    const kinds = Object.keys(KIND_CODE) as EntityKind[];
    // 정책 표가 실제 kind 카탈로그를 덮고 있다는 최소 확인(오타로 순회가 비어도 통과하지 않게).
    expect(kinds.length).toBeGreaterThan(WORLD_KINDS.length);
    for (const kind of kinds) {
      const e = blankEntity(kind);
      if (world.has(kind)) {
        expect(scrollAnchored(e), `${kind} 는 WORLD 여야 한다`).toBe(false);
      } else {
        // 여기가 깨지면 새 kind 가 WORLD 로 분류된 것이다. 지형(창이 흘려보내는 것)이 아니라면
        // ANCHOR 여야 한다 — 적·탄·해저드가 창 뒤로 쓸려 나가면 교전이 끊긴다.
        expect(scrollAnchored(e), `${kind} 는 ANCHOR 여야 한다`).toBe(true);
      }
    }
  });

  it('turretPickup 은 이중 정책이다 — phase 0=WORLD(지형), phase 1=ANCHOR(아군 포탑)', () => {
    const inactive = blankEntity('turretPickup');
    inactive.phase = 0;
    expect(scrollAnchored(inactive)).toBe(false);
    const active = blankEntity('turretPickup');
    active.phase = 1;
    expect(scrollAnchored(active)).toBe(true);
  });
});

describe('anchorPercentFor — 플레이어만 부분 앵커', () => {
  it('player 는 70%, 그 외 앵커 대상은 100% 다', () => {
    expect(PLAYER_ANCHOR_PERCENT).toBe(70);
    expect(FULL_ANCHOR_PERCENT).toBe(100);
    expect(anchorPercentFor(blankEntity('player'))).toBe(PLAYER_ANCHOR_PERCENT);
    for (const kind of ['gem', 'loot', 'supply', 'enemy', 'boss', 'bullet'] as EntityKind[]) {
      expect(anchorPercentFor(blankEntity(kind)), kind).toBe(FULL_ANCHOR_PERCENT);
    }
    const turret = blankEntity('turretPickup');
    turret.phase = 1;
    expect(anchorPercentFor(turret)).toBe(FULL_ANCHOR_PERCENT);
  });
});

describe('insideScrollWindow — 중심 오프셋 + 경계 포함', () => {
  it('창 중심이 원점이 아니어도 오프셋이 반영된다', () => {
    // 원점은 오프셋 창(5000, -3000) 기준으로 한참 밖이다 — 오프셋을 무시하는 구현은 여기서 죽는다.
    expect(insideScrollWindow(0, 0, OFFSET_WIN)).toBe(false);
    expect(insideScrollWindow(OFFSET_WIN.scrollX, OFFSET_WIN.scrollY, OFFSET_WIN)).toBe(true);
    // 반대로 원점 창에서는 원점이 안, 오프셋 중심이 밖이다.
    expect(insideScrollWindow(0, 0, ORIGIN_WIN)).toBe(true);
    expect(insideScrollWindow(OFFSET_WIN.scrollX, OFFSET_WIN.scrollY, ORIGIN_WIN)).toBe(false);
  });

  it('정확히 경계 위는 포함(<=), 1유닛 밖은 제외 — 4면 전부', () => {
    const { scrollX: cx, scrollY: cy } = OFFSET_WIN;
    const hw = INVASION_WINDOW_HALF_W;
    const hh = INVASION_WINDOW_HALF_H;
    // 경계 위(모서리 4곳 포함).
    expect(insideScrollWindow(cx + hw, cy, OFFSET_WIN)).toBe(true);
    expect(insideScrollWindow(cx - hw, cy, OFFSET_WIN)).toBe(true);
    expect(insideScrollWindow(cx, cy + hh, OFFSET_WIN)).toBe(true);
    expect(insideScrollWindow(cx, cy - hh, OFFSET_WIN)).toBe(true);
    expect(insideScrollWindow(cx + hw, cy + hh, OFFSET_WIN)).toBe(true);
    expect(insideScrollWindow(cx - hw, cy - hh, OFFSET_WIN)).toBe(true);
    // 1유닛 밖.
    expect(insideScrollWindow(cx + hw + 1, cy, OFFSET_WIN)).toBe(false);
    expect(insideScrollWindow(cx - hw - 1, cy, OFFSET_WIN)).toBe(false);
    expect(insideScrollWindow(cx, cy + hh + 1, OFFSET_WIN)).toBe(false);
    expect(insideScrollWindow(cx, cy - hh - 1, OFFSET_WIN)).toBe(false);
    // 한 축만 밖이어도 밖이다(AND 계약).
    expect(insideScrollWindow(cx + hw + 1, cy + hh, OFFSET_WIN)).toBe(false);
  });
});

describe('applyScrollAnchor — 정수 규율(trunc)', () => {
  it('델타 12·70% 는 정확히 8, 델타 24·70% 는 정확히 16 이다(8.4→8, 16.8→16)', () => {
    // 기준 속도(accelCp 100) = 12, 최대 가속(200) = 24.
    expect(INVASION_SCROLL_SPEED).toBe(12);
    for (const [delta, expected] of [
      [12, 8],
      [24, 16],
    ] as const) {
      const p = at('player', OFFSET_WIN);
      applyScrollAnchor([p], OFFSET_WIN, 0, -delta);
      expect(p.y).toBe(OFFSET_WIN.scrollY - expected);
      const q = at('player', OFFSET_WIN);
      applyScrollAnchor([q], OFFSET_WIN, delta, 0);
      expect(q.x).toBe(OFFSET_WIN.scrollX + expected);
    }
  });

  it('입력이 정수면 결과도 정수다(정수 델타 가산만 한다)', () => {
    const p = at('player', OFFSET_WIN, 7, -13);
    const g = at('gem', OFFSET_WIN, -21, 40);
    applyScrollAnchor([p, g], OFFSET_WIN, 12, -12);
    for (const e of [p, g]) {
      expect(Number.isInteger(e.x), `${e.kind}.x`).toBe(true);
      expect(Number.isInteger(e.y), `${e.kind}.y`).toBe(true);
    }
    // 100% 앵커(gem)는 델타 전량, 70% 앵커(player)는 trunc 된 8 이다.
    expect(g.x).toBe(OFFSET_WIN.scrollX - 21 + 12);
    expect(g.y).toBe(OFFSET_WIN.scrollY + 40 - 12);
    expect(p.x).toBe(OFFSET_WIN.scrollX + 7 + 8);
    expect(p.y).toBe(OFFSET_WIN.scrollY - 13 - 8);
  });
});

describe('applyScrollAnchor — 적용 게이트', () => {
  it('창 밖 드랍은 앵커하지 않는다(얼어붙어 영영 도달 불가가 되는 것을 막는 계약)', () => {
    // 전방 2400유닛 = cluster 포메이션 최대 스폰 거리. 창 세로 절반(540)보다 한참 밖이다.
    const far = at('gem', ORIGIN_WIN, 0, -2400);
    expect(insideScrollWindow(far.x, far.y, ORIGIN_WIN)).toBe(false);
    applyScrollAnchor([far], ORIGIN_WIN, 0, -12);
    expect(far.x).toBe(0);
    expect(far.y).toBe(-2400); // 월드 고정 — 창이 따라잡아야 회수 가능해진다.
  });

  it('WORLD(지형)는 창 안에 있어도 불변이고, 살아 움직이는 실체는 창을 따라간다', () => {
    const wall = at('wall', OFFSET_WIN, 100, -50);
    const movers = (['enemy', 'boss', 'bullet', 'enemyBullet', 'formation', 'guardian'] as EntityKind[]).map(
      (k) => at(k, OFFSET_WIN, 100, -50),
    );
    applyScrollAnchor([wall, ...movers], OFFSET_WIN, 24, -24);
    // 벽만 월드 고정 — 창이 지나가며 뒤로 흘려보내는 유일한 축이다.
    expect(wall.x).toBe(OFFSET_WIN.scrollX + 100);
    expect(wall.y).toBe(OFFSET_WIN.scrollY - 50);
    for (const e of movers) {
      expect(e.x, `${e.kind}.x`).toBe(OFFSET_WIN.scrollX + 100 + 24);
      expect(e.y, `${e.kind}.y`).toBe(OFFSET_WIN.scrollY - 50 - 24);
    }
  });

  it('dead 엔티티는 건너뛴다(compact 전 좌표를 만지지 않는다)', () => {
    const p = at('player', ORIGIN_WIN);
    p.dead = true;
    const g = at('gem', ORIGIN_WIN, 30, 30);
    g.dead = true;
    applyScrollAnchor([p, g], ORIGIN_WIN, 0, -12);
    expect(p.y).toBe(0);
    expect(g.y).toBe(30);
  });

  it('델타 0 은 no-op 이다(침공 L3 = 축 NONE → 오프셋 불변)', () => {
    const list = [
      at('player', OFFSET_WIN, 5, 5),
      at('gem', OFFSET_WIN, -5, 5),
      at('loot', OFFSET_WIN, 5, -5),
      at('wall', OFFSET_WIN),
    ];
    const before = list.map((e) => [e.x, e.y] as const);
    applyScrollAnchor(list, OFFSET_WIN, 0, 0);
    list.forEach((e, i) => {
      expect([e.x, e.y]).toEqual([before[i]![0], before[i]![1]]);
    });
  });
});
