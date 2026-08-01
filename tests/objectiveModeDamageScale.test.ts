/**
 * 목표 게이트형 무대(오염·추격)의 **생존 축** — 피격 피해 배율 계약.
 *
 * 이 축은 "무대에 따라 맞으면 덜 아프다" 라는, 거동에 직결되는 배선이다. 그래서 두 가지를
 * 각각 못 박는다:
 *
 * 1. **순수 판정** — 목표 게이트형이 아닌 모드는 배율이 **정확히 1**이다. 모드 목록을 하드코딩
 *    하지 않고 `PLANET_MODE` 전수를 순회하므로, 새 모드가 생기면 자동으로 이 단언에 들어온다
 *    (이 리포가 반복해서 겪은 "카탈로그는 늘었는데 목록이 안 늘어 조용히 빠짐" 부류 차단).
 * 2. **배선 실도달** — 실제 `stepWorld` 피격 경로에서 선체가 깎이는 양이 배율을 탄다. 순수
 *    함수만 검사하면 "함수는 맞는데 world 가 안 부른다"를 통과시킨다 — 이 저장소의 대표적
 *    반복 결함이 정확히 그것이다.
 *
 * ⚠️ 대조군(뱀서류)을 같은 방식으로 함께 재는 것이 이 파일의 핵심이다. 오염 쪽만 재면 "배율이
 * 곱해졌다"가 아니라 "피해가 원래 그만큼이었다"와 구분되지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { spawnHazard } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE, type PlanetMode } from '../src/sim/planetMode.js';
import {
  CHASE_DAMAGE_SCALE,
  CONTAMINATION_DAMAGE_SCALE,
  isObjectiveGatedMode,
  objectiveModeDamageScale,
} from '../src/sim/modes/objective.js';

/** 다른 피해원에 묻히지 않도록 충분히 큰 시험 피해(겹친 피해원 중 **최대**만 적용된다). */
const PROBE_DAMAGE = 900;

function configFor(mode: PlanetMode): WorldConfig {
  // 정규경로(`buildRunConfig`)로 만든 뒤 mode 만 치환한다 — 무대별 코스 배치 차이가 이 측정에
  // 끼어들지 않게 하려는 것이고, 배율 게이트는 `planetMode` 만 본다.
  return {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: mode,
    playerHp: 1_000_000,
  };
}

/** 플레이어 위에 시험 해저드를 놓고 한 틱 굴려 **실제로 깎인 선체량**을 잰다. */
function hullLostToProbeHazard(mode: PlanetMode): number {
  const state: WorldState = createWorld(1234, configFor(mode));
  const player = state.entities[0]!;
  player.iframes = 0;
  spawnHazard(
    state,
    0,
    player.x,
    player.y,
    player.radius + 40,
    0, // windup 0 = 즉시 활성
    -1, // life -1 = 영구 지형 해저드
    PROBE_DAMAGE,
    true,
    0,
  );
  const before = player.hp;
  stepWorld(state, emptyInput());
  return before - player.hp;
}

describe('목표 게이트형 무대 생존 축 — 피격 피해 배율', () => {
  it('목표 게이트형이 아닌 모드는 배율이 정확히 1 이다(전수 순회)', () => {
    const gated: PlanetMode[] = [];
    for (const mode of Object.values(PLANET_MODE)) {
      if (isObjectiveGatedMode(mode)) {
        gated.push(mode);
        continue;
      }
      expect(objectiveModeDamageScale(mode), `mode ${mode}`).toBe(1);
    }
    // 대조군 단언 — 게이트가 통째로 비어 "아무 모드도 배율을 안 받는" 공허 상태를 막는다.
    expect(gated).toEqual([PLANET_MODE.chase, PLANET_MODE.contamination].sort((a, b) => a - b));
    // 미지정(침공 등 planetMode 없는 런)도 1 이어야 한다.
    expect(objectiveModeDamageScale(undefined)).toBe(1);
  });

  it('오염·추격은 배율만큼 덜 깎이고, 뱀서류는 그대로 깎인다(배선 실도달)', () => {
    const vampire = hullLostToProbeHazard(PLANET_MODE.vampire);
    // 대조군이 먼저다 — 시험 해저드가 실제로 최대 피해원으로 적용됐는지 확인한다. 이게 없으면
    // 아래 비교가 "배율이 걸렸다" 가 아니라 "둘 다 다른 무언가에 맞았다" 일 수 있다.
    expect(vampire).toBe(PROBE_DAMAGE);

    expect(hullLostToProbeHazard(PLANET_MODE.contamination)).toBe(
      Math.round(PROBE_DAMAGE * CONTAMINATION_DAMAGE_SCALE),
    );
    expect(hullLostToProbeHazard(PLANET_MODE.chase)).toBe(
      Math.round(PROBE_DAMAGE * CHASE_DAMAGE_SCALE),
    );
  });

  it('두 무대의 배율은 서로 독립이다(하나로 합치면 12.7pp 벌어졌다)', () => {
    // 값이 같아지면 "무대마다 값이 다르다" 는 설계 근거가 사문화된다 — 상수 주석의 실측표가
    // 그 이유다. 같은 값으로 되돌리려면 그 표를 먼저 갱신해야 한다.
    expect(CONTAMINATION_DAMAGE_SCALE).not.toBe(CHASE_DAMAGE_SCALE);
    for (const s of [CONTAMINATION_DAMAGE_SCALE, CHASE_DAMAGE_SCALE]) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
