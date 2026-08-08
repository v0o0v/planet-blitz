/**
 * **승격한 앵커 둘의 계약**(ADR-0052 과제 2) —
 * `onEnemyDamageTakenMultCatalyst` · `onWallDestroyedCatalyst`.
 *
 * ## 이 파일이 지키는 것
 * 종전에 `world.ts` 가 촉매 그룹 모듈을 **직접 import** 하던 자리를 앵커로 올렸다. 승격의
 * 이득은 셋인데, 그중 둘은 기계로만 지킬 수 있다:
 *  1. **무촉매 게이트가 앵커 첫 줄에 있다.** 종전 `emberDamageTakenMult` 는 게이트가 **아예
 *     없었고** 마크가 0 이라 우연히 맞았다. 그런 자리는 새 소비자가 붙는 순간 조용히 샌다.
 *  2. **합성 순서가 계약이다.** 보스 갑주(`id 32`)와 점화 약공명 '불씨'가 **같은 산식 자리**를
 *     다툰다. 순서를 팬아웃이 정하므로 그것을 여기서 못 박는다.
 *  3. (팬아웃 계약 — 새 카드가 `world.ts` 를 안 고쳐도 된다. 이것은 구조라 테스트 대상이 아니다.)
 *
 * ⚠️ 값(용암 갑주 곡선·불씨 계수)은 각 그룹의 테스트가 잰다. 여기서 그 상수를 다시 적으면
 * 정본이 둘이 된다 — 이 파일은 **게이트와 순서**만 본다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import {
  onEnemyDamageTakenMultCatalyst,
  onWallDestroyedCatalyst,
} from '../src/sim/catalystHooks.js';
import { kargonOnEnemyDamageTakenMult } from '../src/sim/catalyst/kargon.js';
import { resonanceOnEnemyDamageTakenMult } from '../src/sim/catalyst/resonance.js';
import { writeMark } from '../src/sim/catalystMarks.js';
import { summonEnemy } from '../src/sim/waves.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { catalystContributionsOf } from '../src/sim/catalyst/fx.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';

/** `id 32 kargon-lava-warden`. */
const CARD_LAVA_WARDEN = 32;
/** `id 45 kras-breach`(벽 파괴로 적립하는 카드). */
const CARD_KRAS_BREACH = 45;
/** 점화 약공명을 세우는 조합 — 값이 아니라 **표식**으로 재므로 카드 조합은 필요 없다. */

function w(catalysts?: number[]): WorldState {
  return catalysts === undefined
    ? createWorld(0xa9c0, { ...DEFAULT_CONFIG })
    : createWorld(0xa9c0, { ...DEFAULT_CONFIG, catalysts });
}

function player(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function mob(s: WorldState, x: number, y: number): Entity {
  const def = ENEMY_BY_TYPE[0];
  if (def === undefined) throw new Error('enemy def missing');
  return summonEnemy(s, def, x, y);
}

function wall(s: WorldState, x: number, y: number): Entity {
  const e = blankEntity('wall');
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 0;
  addEntity(s, e);
  return e;
}

// ---------------------------------------------------------------------------
// ① onEnemyDamageTakenMultCatalyst — 게이트
// ---------------------------------------------------------------------------

describe('onEnemyDamageTakenMultCatalyst — 무촉매 게이트가 앵커 첫 줄이다', () => {
  it('무촉매 런은 **정확히 1** 이다 (곱셈이 무연산이라 비트 동일)', () => {
    const s = w();
    const p = player(s);
    const t = mob(s, p.x + 200, p.y);
    // `1` 과 「1에 가깝다」는 다르다 — 부동소수 곱셈이 무연산이려면 정확히 1 이어야 한다.
    expect(onEnemyDamageTakenMultCatalyst(s, t, p.x, p.y)).toBe(1);
  });

  it('표식이 선 적이어도 **무촉매 런이면** 1 이다 (게이트가 마크보다 앞이다)', () => {
    // ⭐ 이것이 승격의 핵심 이득이다. 종전 `emberDamageTakenMult` 는 게이트 없이 마크만 봐서,
    //    무촉매 런의 안전이 "비트가 0 이다"라는 **우연**에 걸려 있었다. 앵커 게이트가 서면
    //    누가 실수로 마크를 세워도 무촉매 런은 절대 안 샌다.
    const s = w();
    const p = player(s);
    const t = mob(s, p.x + 200, p.y);
    writeMark(t, 'emberPushed', 1);
    expect(onEnemyDamageTakenMultCatalyst(s, t, p.x, p.y)).toBe(1);
  });

  it('촉매를 실어도 해당 카드가 없으면 1 이다 (카드 소지 게이트)', () => {
    const s = w([1]); // 다른 결의 카드 한 장
    const p = player(s);
    const t = mob(s, p.x + 200, p.y);
    expect(onEnemyDamageTakenMultCatalyst(s, t, p.x, p.y)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ② onEnemyDamageTakenMultCatalyst — 합성 순서가 계약이다
// ---------------------------------------------------------------------------

describe('onEnemyDamageTakenMultCatalyst — 같은 산식 자리를 다투는 둘의 합성', () => {
  it('⭐ 앵커 반환값 = kargon × resonance (팬아웃 순서대로 곱한 것과 같다)', () => {
    // 보스 갑주(`id 32`)와 점화 약공명 '불씨'가 **같은 층**을 다툰다. 종전에는 순서가
    // `world.ts` 의 소스 줄 순서에만 걸려 있었다 — 이제 팬아웃이 정하고, 이 단언이 잠근다.
    const s = w([CARD_LAVA_WARDEN]);
    const p = player(s);
    // 보스여야 용암 갑주가 걸린다(그 술어가 `kind === 'boss'` 게이트다).
    const boss = mob(s, p.x + 120, p.y);
    boss.kind = 'boss';

    const a = kargonOnEnemyDamageTakenMult(s, boss, p.x, p.y);
    const b = resonanceOnEnemyDamageTakenMult(s, boss, p.x, p.y);
    expect(onEnemyDamageTakenMultCatalyst(s, boss, p.x, p.y)).toBeCloseTo(a * b, 12);
  });

  it('⭐ 둘은 **kind 로 상호 배타**다 — 같은 표적에 동시에 걸리지 않는다 (실측)', () => {
    // 이 사실이 중요해서 못 박는다. 위치상으로는 같은 산식 자리를 다투지만 **대상 집합이
    // 안 겹친다**:
    //   · 용암 갑주(`id 32`)  — `target.kind !== 'boss'` 면 1
    //   · 점화 약공명 '불씨'  — `e.kind !== 'enemy'` 면 1
    // 즉 지금 이 둘 사이에서는 **합성 순서가 관측되지 않는다.** 그럼에도 순서를 계약으로
    // 못 박아 둔 이유는 같은 자리를 쓰는 **다음 카드**를 위해서다 — 그때 순서가 코드 리뷰가
    // 아니라 팬아웃 한 줄로 정해져 있어야 한다.
    //
    // ⚠️ 이 단언이 깨지면(둘이 같은 표적에 걸리면) 위 «앵커 = kargon × resonance» 가
    //    비로소 순서를 실제로 재게 된다. 그때 그 단언을 강화해라.
    const s = w([CARD_LAVA_WARDEN]);
    const p = player(s);

    const boss = mob(s, p.x + 120, p.y);
    boss.kind = 'boss';
    writeMark(boss, 'emberPushed', 1);
    // 보스라 불씨는 중립 1 — 갑주만 걸린다.
    expect(resonanceOnEnemyDamageTakenMult(s, boss, p.x, p.y)).toBe(1);

    const grunt = mob(s, p.x + 160, p.y);
    writeMark(grunt, 'emberPushed', 1);
    // 잡몹이라 갑주는 중립 1 — 불씨만 걸린다.
    expect(kargonOnEnemyDamageTakenMult(s, grunt, p.x, p.y)).toBe(1);
    expect(resonanceOnEnemyDamageTakenMult(s, grunt, p.x, p.y)).toBeLessThan(1);
  });

  it('불씨는 잡몹의 받는 피해를 실제로 줄인다 (앵커를 통해서도 도달한다)', () => {
    const s = w([CARD_LAVA_WARDEN]);
    const p = player(s);
    const grunt = mob(s, p.x + 160, p.y);
    const before = onEnemyDamageTakenMultCatalyst(s, grunt, p.x, p.y);
    writeMark(grunt, 'emberPushed', 1);
    expect(onEnemyDamageTakenMultCatalyst(s, grunt, p.x, p.y)).toBeLessThan(before);
  });
});

// ---------------------------------------------------------------------------
// ③ onWallDestroyedCatalyst
// ---------------------------------------------------------------------------

describe('onWallDestroyedCatalyst — 24앵커에 없던 지점', () => {
  it('무촉매 런은 아무 일도 안 일어난다', () => {
    const s = w();
    const before = catalystContributionsOf(s);
    onWallDestroyedCatalyst(s, wall(s, 300, 300));
    expect(catalystContributionsOf(s)).toEqual(before);
  });

  it('`id 45` 는 벽이 부서질 때 적립한다 (팬아웃이 실제로 그룹에 닿는다)', () => {
    const s = w([CARD_KRAS_BREACH]);
    onWallDestroyedCatalyst(s, wall(s, 300, 300));
    const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === CARD_KRAS_BREACH);
    expect(row?.earned, '앵커가 kras 그룹에 안 닿는다').toBeGreaterThan(0);
  });

  it('다른 카드만 실은 런은 적립하지 않는다 (카드 소지 게이트)', () => {
    const s = w([1]);
    onWallDestroyedCatalyst(s, wall(s, 300, 300));
    const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === CARD_KRAS_BREACH);
    expect(row?.earned ?? 0).toBe(0);
  });
});
