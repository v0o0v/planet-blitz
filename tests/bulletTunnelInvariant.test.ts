/**
 * 탄 터널링 불변식 — **한 틱 탄 이동량 < 최소 벽 두께**.
 *
 * ## 왜 이 불변식이 새로 중요해졌나
 * 이 리포는 원래 터널링을 **대시**에 대해서만 걱정했다. `chunks.ts` 의 `WALL_HALF_MIN = 60`
 * (전폭 120)이 최대 대시 스텝(~59유닛/틱)보다 크다는 것이 그 방어였다.
 *
 * 2026-07-26(PR#146)에 플레이어탄 **대 적** 판정이 지점 → 선분(`sweptCircleOverlap`)으로
 * 올라가면서 축이 하나 더 생겼다. 탄 **대 벽** 판정은 `stepProjectiles` 에서 여전히 이동 **후
 * 한 점**이다. 두 판정의 비대칭이 만드는 결과:
 *
 *   탄이 한 틱에 벽을 통째로 건너뛰어 **끝점이 벽 밖**이면 벽 판정에 걸리지 않는다.
 *   그 다음 선분 판정이 **경로 위 아무 곳**의 적을 때린다 → **벽 뒤 적에게 피해가 들어간다**
 *   (선분 판정에는 가림 개념이 없다).
 *
 * 즉 "한 틱 이동량 < 벽 두께" 는 이제 **탄에도** 걸리는 불변식인데, 그 사실이 코드 어디에도
 * 적혀 있지 않았고 테스트도 없었다. 이 파일이 그 구멍을 메운다.
 *
 * ## 왜 상한을 손으로 적지 않는가
 * 탄속 배율의 출처가 여러 갈래다(무기 아키타입 · 장비 어픽스). 상수를 베껴 적으면 카탈로그에
 * 어픽스가 하나 추가될 때 조용히 늙는다. 그래서 상한을 **실제 카탈로그와 실제 조립 함수에서
 * 파생**한다 — 데이터가 늘면 이 테스트가 먼저 깨진다.
 *
 * ⚠️ ADR-0049: 스킬 트리는 더 이상 `computeLoadoutStats` 에 `invest` 를 넘기지 않는다(스킬이
 * 스탯에서 메커닉으로 옮겨갔다 — `src/items/loadout.ts` 헤더 참조). 그래서 탄속 상한은 이제
 * 무기 아키타입 × 장비 어픽스에서만 파생된다. 기체 타입(`baseBp`)은 축에 `bulletSpeed` 가
 * 없어 무연산이지만, 미래에 축이 늘 수도 있으므로 전 타입을 계속 순회한다(방어적 루프).
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_WEAPON, DT } from '../src/sim/world.js';
import { WALL_HALF_MIN } from '../src/sim/chunks.js';
import { circleOverlapsWall, sweptCircleOverlapsWall } from '../src/sim/los.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { InvasionWallIndex, sweepWallsDirectSwept } from '../src/sim/invasion/wallIndex.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { AFFIXES } from '../data/affixes.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import type { Item, SlotKind } from '../src/items/types.js';

/** 아키타입 중 탄속 배율이 가장 큰 것 = 레일건(`applyWeaponTypeBase` 의 ×1.6). */
const WEAPON_RAILGUN_ID = 2;

/** 한 아이템이 가질 수 있는 어픽스 최대 수(`items/roll.ts` affixCountFor: rare/unique 3..6). */
const MAX_AFFIXES_PER_ITEM = 6;

/** `velocity`(탄속) 어픽스 정의 — 값 범위를 카탈로그에서 읽는다. */
function velocityAffix() {
  const def = AFFIXES.find((a) => a.stat === 'bulletSpeedPct');
  expect(def, 'bulletSpeedPct 어픽스가 카탈로그에 있어야 한다').toBeDefined();
  return def as NonNullable<typeof def>;
}

/**
 * 최대 탄속을 내는 장비 세트. 어픽스는 **아이템 안에서 서로 달라야** 하므로(`roll.ts`
 * rollAffixes 는 중복 없이 뽑는다) 탄속 어픽스는 **아이템당 1개**가 상한이다. 그래서 전 슬롯을
 * 채워 슬롯 수만큼만 겹친다.
 */
function maxSpeedGear(): Item[] {
  const v = velocityAffix();
  return EQUIP_SLOTS.map((slot, i) => {
    const item: Item = {
      id: `max-${slot}`,
      slot: slot as unknown as SlotKind,
      rarity: 'rare',
      level: 100,
      affixes: [{ id: v.id, stat: v.stat, value: v.max }],
      ...(slot === 'main' ? { weaponType: WEAPON_RAILGUN_ID } : {}),
    } as unknown as Item;
    void i;
    return item;
  });
}

describe('탄속 상한 — 카탈로그 파생', () => {
  it('한 아이템에 같은 어픽스가 두 번 붙지 않는다 (슬롯당 1회 상한의 근거)', () => {
    // `rollAffixes` 는 풀에서 **중복 없이** 뽑는다. 그래서 아이템 하나가 탄속 어픽스를 여러 개
    // 가질 수 없고, 장비 기여 상한이 `슬롯 수 × 어픽스 최댓값` 으로 닫힌다. 이 전제가 깨지면
    // (예: 중복 허용으로 바뀌면) 아래 상한 계산이 과소평가가 되므로 여기서 못 박는다.
    const ids = new Set(AFFIXES.map((a) => a.id));
    expect(ids.size).toBe(AFFIXES.length);
    expect(MAX_AFFIXES_PER_ITEM).toBeLessThanOrEqual(AFFIXES.length);
  });

  it('전 기체 × 최대 어픽스 × 레일건의 탄속을 실제 조립 경로로 계산한다', () => {
    const gear = maxSpeedGear();
    const rows: { id: string; speed: number; perTick: number }[] = [];
    for (const def of SHIP_TYPES) {
      const lo = computeLoadoutStats(gear, 5000, def.id);
      // `createWorld` 의 무기 조립과 **같은 식**(world.ts): base × mult, 소수 2자리 반올림.
      const speed = Math.round(DEFAULT_WEAPON.bulletSpeed * lo.loadout.bulletSpeedMult * 100) / 100;
      rows.push({ id: def.slug, speed, perTick: speed * DT });
    }
    rows.sort((a, b) => b.speed - a.speed);
    const worst = rows[0]!;
    // 진단용 — 실패 시 어느 기체가 상한을 만드는지 보이게 한다.
    console.log(
      '탄속 상한(내림차순): ' +
        rows.map((r) => `${r.id}=${r.speed}/s(${r.perTick.toFixed(1)}u/tick)`).join(' · '),
    );
    // 상한이 실제로 성장한다(조립 경로가 배율을 먹고 있다 — 공회전 방지).
    expect(worst.speed).toBeGreaterThan(DEFAULT_WEAPON.bulletSpeed);
  });
});

/** 최악 기체의 한 틱 탄 이동량(유닛) — 카탈로그 파생. */
function worstBulletStep(): number {
  const gear = maxSpeedGear();
  let worst = 0;
  for (const def of SHIP_TYPES) {
    const lo = computeLoadoutStats(gear, 5000, def.id);
    const speed = Math.round(DEFAULT_WEAPON.bulletSpeed * lo.loadout.bulletSpeedMult * 100) / 100;
    const perTick = speed * DT;
    if (perTick > worst) worst = perTick;
  }
  return worst;
}

describe('터널링 — 탄 스텝이 벽 두께를 넘는다는 사실 자체', () => {
  /**
   * ⚠️ (ADR-0049 재정의, 2026-08-06) 이 트립와이어가 **정확히 설계 의도대로** 뒤집혔다.
   *
   * 이 describe 의 원래 방향(부등식이 지켜진다가 아니라 실제로 넘는다를 단언)은 그 자체가
   * "만약 언젠가 탄속 상한이 벽 두께 아래로 내려오면 이 테스트가 깨져서 재검토하게 만든다"는
   * 트립와이어였다. 지금 그 트립와이어가 울렸다 — 원인은 skillInvest 가 더 이상
   * `computeLoadoutStats` 에 접히지 않아(스킬이 스탯에서 메커닉으로 옮겨갔다,
   * `src/items/loadout.ts` 헤더) 탄속 상한의 한 원천(스킬 트리 시너지)이 통째로 사라졌기
   * 때문이다 — 지금은 무기 아키타입(레일건) × 장비 어픽스만 남아 상한이 낮아졌다.
   *
   * **이것이 "지점 판정으로 되돌려도 된다"는 뜻은 아니다.** 스윕 판정(`sweptCircleOverlapsWall`)
   * 을 되돌리는 것은 이 레인 밖의 프로덕션 판단이고(건드리지 않는다), 스윕 판정 자체는 여유
   * 마진이 늘었을 뿐 여전히 정확하다 — 손해가 없다. 이 테스트는 방향을 뒤집어 **지금 실제
   * 상한이 얼마인지**를 계속 관측하는 역할로 남긴다 — 스킬 배선(후속 레인)이나 어픽스
   * 카탈로그 확장이 상한을 다시 벽 두께 위로 올리면, 이 테스트가 다시 깨져 그 사실을 알린다.
   */
  it('최대 탄 스텝이 청크 벽 최소 전폭 아래다 (ADR-0049: 스킬 기여 소멸 — 재교차 시 트립와이어)', () => {
    const perTick = worstBulletStep();
    const minWallFullWidth = WALL_HALF_MIN * 2;
    expect(
      perTick,
      `최대 탄 스텝 ${perTick.toFixed(1)}u/tick vs 최소 벽 전폭 ${minWallFullWidth}` +
        ' — 이 값이 다시 벽 두께를 넘으면 스윕 판정 필요성을 재확인하라(코드는 그대로 안전하다).',
    ).toBeLessThan(minWallFullWidth);
  });

  it('침공 회랑 벽 전폭(240) 아래다 (같은 트립와이어, 침공 최소 두께 기준)', () => {
    // 침공 템플릿 벽은 `data/invasion/mapTemplates.ts` 에서 halfH 120(전폭 240)이 최소다.
    expect(worstBulletStep()).toBeLessThan(240);
  });
});

describe('탄 대 벽 선분 판정 — 벽을 건너뛰지 못한다', () => {
  /** 테스트용 벽(AABB 매핑: radius = halfW, targetX = halfH — los.ts 정본). */
  function wallAt(x: number, y: number, halfW: number, halfH: number): Entity {
    const w = blankEntity('wall');
    w.x = x;
    w.y = y;
    w.radius = halfW;
    w.targetX = halfH;
    return w;
  }

  it('한 틱에 벽을 통째로 건너뛴 경로를 잡는다 (지점 판정은 놓친다)', () => {
    // 청크 벽 최소 기하: 전폭 120(halfW 60). 탄 반경 5.
    const w = wallAt(0, 0, 60, 60);
    // 탄이 x=-200 → x=+200 으로 한 틱에 400유닛 이동했다. **양 끝점 모두 벽 밖**이다.
    expect(circleOverlapsWall(-200, 0, 5, w)).toBe(false);
    expect(circleOverlapsWall(200, 0, 5, w)).toBe(false);
    // 선분 판정은 경로가 벽을 지났음을 잡는다.
    expect(sweptCircleOverlapsWall(-200, 0, 200, 0, 5, w)).toBe(true);
  });

  it('벽을 스치지 않는 경로는 잡지 않는다 (과검출 없음)', () => {
    const w = wallAt(0, 0, 60, 60);
    // 벽 위로 충분히 떨어져 지나간다(확장 반높이 65 밖).
    expect(sweptCircleOverlapsWall(-200, 100, 200, 100, 5, w)).toBe(false);
    // 경계 바로 안/밖.
    expect(sweptCircleOverlapsWall(-200, 65, 200, 65, 5, w)).toBe(true);
    expect(sweptCircleOverlapsWall(-200, 66, 200, 66, 5, w)).toBe(false);
  });

  it('길이 0 인 선분은 지점 판정과 같다 (빔 세그먼트·정지 탄)', () => {
    const w = wallAt(0, 0, 60, 60);
    for (const [px, py] of [
      [0, 0],
      [64, 0],
      [66, 0],
      [200, 200],
    ] as const) {
      expect(sweptCircleOverlapsWall(px, py, px, py, 5, w)).toBe(
        circleOverlapsWall(px, py, 5, w),
      );
    }
  });

  it('침공 broad-phase 격자가 직접 스윕과 같은 벽을 돌려준다 (동치 계약)', () => {
    // 격자는 성능 최적화이므로 참조 구현과 결과가 갈리면 안 된다. 특히 선분 질의는 **경로
    // 중간 셀**까지 훑어야 한다 — 끝점 주변만 보면 긴 회랑 벽을 놓친다.
    const walls = [
      wallAt(0, 0, 120, 120), // 침공 회랑 최소 두께(전폭 240)
      wallAt(3000, 0, 120, 120),
      wallAt(0, 3000, 120, 120),
    ];
    const index = new InvasionWallIndex();
    index.rebuild(walls);
    const cases: readonly (readonly [number, number, number, number])[] = [
      [-2000, 0, 2000, 0], // 첫 벽을 통과(셀 여러 칸을 건너뛴다)
      [2800, -400, 3200, 400], // 두 번째 벽을 통과
      [-500, 2900, 500, 3100], // 세 번째 벽을 통과
      [-500, 1500, 500, 1500], // 어떤 벽도 안 스침
      [5000, 5000, 6000, 6000], // 격자 범위 밖
    ];
    for (const [x1, y1, x2, y2] of cases) {
      expect(
        index.firstBlockingSwept(x1, y1, x2, y2, 5),
        `경로 (${x1},${y1})→(${x2},${y2})`,
      ).toBe(sweepWallsDirectSwept(walls, x1, y1, x2, y2, 5));
    }
  });
});
