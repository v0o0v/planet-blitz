/**
 * 파워업 **강화 폭 상한** 회귀 게이트 (2026-08-01 밸런스 지시).
 *
 * 지시는 "3택 수치가 전반적으로 너무 높다, **특히 공격력은 아무리 높아도 10% 이하**"였다.
 * 주석만으로는 다음에 파워업을 추가할 때 조용히 넘어간다 — 그래서 **실제로 `apply` 를 돌려**
 * 전후 스탯 비를 재고 상한을 못 박는다.
 *
 * ## 왜 값 목록을 하드코딩하지 않는가
 * "고폭탄은 1.08" 식으로 적으면 그건 **같은 사실을 두 곳에 적는 것**이라 튜닝할 때마다 같이
 * 고쳐야 하고, 정작 새로 추가된 파워업은 목록에 없어서 검사도 안 된다. 여기서는 `POWERUPS`
 * 를 **전수 순회**해 "피해를 올리는 것은 무엇이든 ≤ +10%"라는 **불변식**만 검사한다. 새
 * 파워업은 등록하는 순간 자동으로 이 게이트에 들어온다.
 */

import { describe, it, expect } from 'vitest';
import { POWERUPS } from '../src/sim/powerups.js';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';

/** 피해 배율 상한 — 사용자 지시("아무리 높아도 10% 이하"). */
const DAMAGE_MAX_MULT = 1.1;
/**
 * 그 외 배율성 강화의 상한. 피해만큼 엄격하지는 않되 "수치가 너무 높다"는 같은 지시 아래
 * 있으므로 함께 묶는다. 젬 흡수 반경이 현재 최대치(+15%)다.
 */
const OTHER_MAX_MULT = 1.15;
/** 최대 HP 가산 상한(기본 100 대비). */
const MAX_HP_ADD_MAX = 12;

/** 파워업 적용 전후를 비교할 깨끗한 월드. 시드·config 고정이라 결정론적이다. */
function freshWorld(): WorldState {
  return createWorld(1234, { ...DEFAULT_CONFIG });
}

describe('파워업 강화 폭 상한 (2026-08-01 지시)', () => {
  // ⚠️ **전수 순회가 핵심이다.** 목록을 손으로 적으면 새 파워업이 조용히 빠진다 — 이 리포가
  //    반복해서 겪은 "카탈로그는 늘었는데 목록이 안 늘어 조용히 빠짐" 부류다.
  it.each(POWERUPS.map((p, i) => [i, p.id] as const))(
    '#%i %s — 피해 배율이 +10% 를 넘지 않는다',
    (index) => {
      const w = freshWorld();
      const before = w.weapon.damage;
      expect(before, '기준 피해가 0 이면 배율 검사가 공허하다').toBeGreaterThan(0);
      POWERUPS[index]?.apply(w);
      const ratio = w.weapon.damage / before;
      expect(
        ratio,
        `${POWERUPS[index]?.id}: 피해 ${before} → ${w.weapon.damage} (×${ratio.toFixed(3)})`,
      ).toBeLessThanOrEqual(DAMAGE_MAX_MULT + 1e-9);
    },
  );

  it.each(POWERUPS.map((p, i) => [i, p.id] as const))(
    '#%i %s — 이동 속도 · 탄속 · 젬 반경 배율이 +15% 를 넘지 않는다',
    (index) => {
      const w = freshWorld();
      const before = {
        speed: w.config.playerSpeed,
        bullet: w.weapon.bulletSpeed,
        magnet: w.magnetRadius,
      };
      POWERUPS[index]?.apply(w);
      expect(w.config.playerSpeed / before.speed).toBeLessThanOrEqual(OTHER_MAX_MULT + 1e-9);
      expect(w.weapon.bulletSpeed / before.bullet).toBeLessThanOrEqual(OTHER_MAX_MULT + 1e-9);
      expect(w.magnetRadius / before.magnet).toBeLessThanOrEqual(OTHER_MAX_MULT + 1e-9);
    },
  );

  it.each(POWERUPS.map((p, i) => [i, p.id] as const))(
    '#%i %s — 최대 HP 가산이 %s 를 넘지 않는다',
    (index) => {
      const w = freshWorld();
      const p = w.entities[0];
      const before = p?.maxHp ?? 0;
      expect(before, '기준 최대 HP 가 0 이면 검사가 공허하다').toBeGreaterThan(0);
      POWERUPS[index]?.apply(w);
      expect((p?.maxHp ?? 0) - before).toBeLessThanOrEqual(MAX_HP_ADD_MAX);
    },
  );

  // ⚠️ **대조군.** 위 세 검사는 "아무 파워업도 아무것도 안 바꾼다"는 상태에서도 전부 통과한다
  //    (배율 1.0 ≤ 상한). 그러면 파워업이 통째로 죽어도 초록이다. 그래서 **적어도 하나는 실제로
  //    피해를 올린다**를 함께 못 박아 이 스위트가 공허해지는 것을 막는다.
  it('대조군 — 피해를 실제로 올리는 파워업이 존재한다(상한 검사가 공허하지 않다)', () => {
    const raised = POWERUPS.filter((def) => {
      const w = freshWorld();
      const before = w.weapon.damage;
      def.apply(w);
      return w.weapon.damage > before;
    });
    expect(raised.length, '피해를 올리는 파워업이 하나도 없다 — 상한 검사가 무의미하다').toBeGreaterThan(0);
  });
});
