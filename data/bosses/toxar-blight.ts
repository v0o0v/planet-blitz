/**
 * 톡사르 오염 보스 — "부패의 모체"(Lane9, ADR-0021 §6).
 *
 * 카르곤 용암 요새·베르단 여왕과 동일한 3페이즈 골격·과열(overheat) 창 리듬·페이즈 전환
 * 탄 소거(src/sim/boss.ts가 임계 통과 시 자동 처리)를 승계한다. 부패의 모체는 오염 테마답게
 * 산성 기둥(lavaLine 재사용)과 무리개체 소환으로 지역을 잠식하며 압박한다. 신규 프리미티브는
 * 도입하지 않고 기존 BossAttack 유니온(ring/spiral/lavaLine/summon/aimedBurst)만 재사용한다.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 소환 + 산성 기둥. 무리개체를 세우고 부식 라인으로 회피를 좁힌다.
 *  - P2(70→35%): 소환 강화 + 나선 + 링. 오염 물량이 절정.
 *  - P3(35→0%): 과열 창(조준 부채꼴) + 조밀한 산성 기둥 + 고밀도 링. 발악 페이즈.
 *
 * BossDef 구조 공유(src/sim/boss.ts updateBoss 실행). 밸런스 수치는 전부 플레이스홀더다
 * (// TODO(밸런스)) — 출시 직전 일괄 튜닝에서 확정한다.
 */

import type { BossDef } from '../boss.js';

export const TOXAR_BLIGHT: BossDef = {
  id: 'toxar-rot-matriarch',
  hp: 3400, // TODO(밸런스)
  radius: 128, // TODO(밸런스)
  contactDamage: 22, // TODO(밸런스)
  moveSpeed: 130, // TODO(밸런스)
  phases: [
    // P1 — 잠식: 시그니처(소환)로 무리개체를 세우고 산성 기둥으로 조인다.
    {
      patternCooldown: 100, // TODO(밸런스)
      overheatInterval: 600, // TODO(밸런스)
      attacks: [
        { kind: 'summon', role: 'charger', count: 4 }, // TODO(밸런스)
        { kind: 'lavaLine', pillars: 7, windup: 48, activeTicks: 100, radius: 100, damage: 9 }, // TODO(밸런스)
        { kind: 'ring', count: 16, speed: 620, damage: 8, bulletRadius: 7, bulletLife: 150 }, // TODO(밸런스)
      ],
    },
    // P2 — 절정: 소환 강화 + 나선 + 링.
    {
      patternCooldown: 88, // TODO(밸런스)
      overheatInterval: 570, // TODO(밸런스)
      attacks: [
        { kind: 'summon', role: 'gunner', count: 3 }, // TODO(밸런스)
        { kind: 'spiral', count: 12, speed: 740, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.5 }, // TODO(밸런스)
        { kind: 'ring', count: 22, speed: 760, damage: 9, bulletRadius: 7, bulletLife: 160 }, // TODO(밸런스)
      ],
    },
    // P3 — 발악: 과열 창 + 조밀한 산성 기둥 + 고밀도 링.
    {
      patternCooldown: 62, // TODO(밸런스)
      overheatInterval: 540, // TODO(밸런스)
      attacks: [
        { kind: 'aimedBurst', count: 7, arc: 0.7, speed: 900, damage: 11, bulletRadius: 6, bulletLife: 170 }, // TODO(밸런스)
        { kind: 'lavaLine', pillars: 9, windup: 44, activeTicks: 110, radius: 108, damage: 11 }, // TODO(밸런스)
        { kind: 'ring', count: 26, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 170 }, // TODO(밸런스)
      ],
    },
  ],
};
