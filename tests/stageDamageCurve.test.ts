/**
 * **적 피해 단계 곡선**(§R57) 계약 — `stageDamageMult` · `enemyDamageScale`.
 *
 * 이 파일은 밸런스 **값**을 잠그지 않는다. 잠그는 것은 셋이다:
 *  ① 곡선의 **모양**(얕은 구간 평평 → 후퇴 → 정확히 1)
 *  ② `ENEMY_DAMAGE_STAGE_TAPER_END` 이상이 **정확히 1** — 깊은 단계 골든의 바이트 불변 근거
 *  ③ **침공 게이트** — 침공은 `stage` 가 1 이라 단계로는 못 막는다(가장 조용한 누출 경로)
 *
 * 그래서 단언은 전부 상수 **정본에서 파생**한다(§R52 ⑤). 값을 튜닝해도 이 파일은 안 빨개진다.
 */

import { describe, it, expect } from 'vitest';
import {
  ENEMY_DAMAGE_STAGE_PEAK,
  ENEMY_DAMAGE_STAGE_PEAK_UNTIL,
  ENEMY_DAMAGE_STAGE_TAPER_END,
  stageDamageMult,
} from '../data/waves.js';
import { ENEMY_DAMAGE_MULT, enemyDamageScale } from '../src/sim/enemyScale.js';
import { createWorld } from '../src/sim/world.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { summonEnemy } from '../src/sim/waves.js';
import { CHARGER } from '../data/enemies.js';

describe('적 피해 단계 곡선 (§R57)', () => {
  it('① 얕은 구간은 평평하다 — 단계 1..PEAK_UNTIL 이 전부 PEAK', () => {
    for (let s = 1; s <= ENEMY_DAMAGE_STAGE_PEAK_UNTIL; s++) {
      expect(stageDamageMult(s)).toBe(ENEMY_DAMAGE_STAGE_PEAK);
    }
    // 범위 밖(0 이하)도 단계 1 로 클램프된다.
    expect(stageDamageMult(0)).toBe(ENEMY_DAMAGE_STAGE_PEAK);
  });

  it('② TAPER_END 이상은 **정확히 1** — 깊은 단계는 바이트 불변이다', () => {
    for (const s of [ENEMY_DAMAGE_STAGE_TAPER_END, 15, 20, 40, 200]) {
      expect(stageDamageMult(s)).toBe(1);
    }
  });

  it('③ 후퇴 구간은 단조 감소이고 양 끝을 넘지 않는다', () => {
    let prev = ENEMY_DAMAGE_STAGE_PEAK;
    for (let s = ENEMY_DAMAGE_STAGE_PEAK_UNTIL + 1; s < ENEMY_DAMAGE_STAGE_TAPER_END; s++) {
      const m = stageDamageMult(s);
      expect(m).toBeLessThan(prev);
      expect(m).toBeGreaterThan(1);
      prev = m;
    }
  });

  it('④ 침공 게이트 — `invasion3` 가 있으면 단계와 무관하게 ENEMY_DAMAGE_MULT 그대로', () => {
    for (const stage of [1, 8, 20]) {
      expect(enemyDamageScale({ stage, invasion3: {} })).toBe(ENEMY_DAMAGE_MULT);
    }
    // PvE 는 곡선을 탄다(같은 단계 1 인데 값이 갈린다 = 게이트가 실제로 분기한다).
    expect(enemyDamageScale({ stage: 1 })).toBe(ENEMY_DAMAGE_MULT * ENEMY_DAMAGE_STAGE_PEAK);
  });

  it('⑤ 배선 증명 — 소환 적의 접촉 피해가 곡선을 실제로 탄다(PvE 경로)', () => {
    const def = CHARGER;
    const cfg = (stage: number) => buildRunConfig(defaultProfile(), { planet: 0, stage });
    const shallow = createWorld(7, cfg(ENEMY_DAMAGE_STAGE_PEAK_UNTIL));
    const deep = createWorld(7, cfg(ENEMY_DAMAGE_STAGE_TAPER_END));
    const a = summonEnemy(shallow, def, 0, 0);
    const b = summonEnemy(deep, def, 0, 0);
    expect(a.damage).toBe(def.contactDamage * ENEMY_DAMAGE_MULT * ENEMY_DAMAGE_STAGE_PEAK);
    expect(b.damage).toBe(def.contactDamage * ENEMY_DAMAGE_MULT);
    expect(a.damage).not.toBe(b.damage); // 공허 방어
  });
});
