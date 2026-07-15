/**
 * 베르단 여왕 보스 — "군체 여왕"(plan E2, AC8).
 *
 * 카르곤 용암 요새(data/boss.ts LAVA_FORTRESS)와 동일한 3페이즈 골격·과열(overheat)
 * 창 리듬·페이즈 전환 탄 소거(src/sim/boss.ts가 임계 통과 시 자동 처리)를 승계한다.
 * 여왕만의 특성은 두 신규 공격 컴포넌트(summon = 무리개체 소환, aimedBurst = 과열
 * 창/포위 탄막)로 표현하며, 나머지는 기존 ring/spiral 프리미티브 재사용.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 소환+포위. 무리개체를 불러 방벽을 세우고 넓은 링으로 압박.
 *  - P2(70→35%): 무리개체 소환 강화 + 나선 탄막. 군체 물량이 절정.
 *  - P3(35→0%): 과열 창(조준 부채꼴 고속탄) + 고밀도 링. 발악 페이즈.
 *
 * BossDef 구조는 카르곤과 공유(src/sim/boss.ts updateBoss가 실행). 밸런스 수치는
 * M2 1차 튜닝값 — 재미 게이트 루프에서 이동 예정.
 */

import type { BossDef } from '../boss.js';

export const BERDAN_QUEEN: BossDef = {
  id: 'berdan-swarm-queen',
  // 카르곤 용암 요새(3600)와 비슷한 체급이되 소환으로 시간을 끌므로 약간 낮춤.
  hp: 3300,
  radius: 128,
  contactDamage: 22,
  moveSpeed: 130,
  phases: [
    // P1 — 소환+포위: 시그니처(소환)로 무리개체를 세우고 넓은 링으로 조인다.
    // 과열 창은 시그니처(index 0) 캐스트 뒤에만 ~10s 주기로 열린다.
    {
      patternCooldown: 100,
      overheatInterval: 600,
      attacks: [
        { kind: 'summon', role: 'charger', count: 4 },
        { kind: 'ring', count: 16, speed: 620, damage: 8, bulletRadius: 7, bulletLife: 150 },
        { kind: 'aimedBurst', count: 5, arc: 0.5, speed: 820, damage: 9, bulletRadius: 6, bulletLife: 150 },
      ],
    },
    // P2 — 군체 절정: 소환 강화 + 나선 압박.
    {
      patternCooldown: 88,
      overheatInterval: 570,
      attacks: [
        { kind: 'summon', role: 'gunner', count: 3 },
        { kind: 'spiral', count: 12, speed: 740, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.5 },
        { kind: 'ring', count: 22, speed: 760, damage: 9, bulletRadius: 7, bulletLife: 160 },
      ],
    },
    // P3 — 발악: 과열 창(조준 부채꼴) + 고밀도 링/역나선.
    {
      patternCooldown: 62,
      overheatInterval: 540,
      attacks: [
        { kind: 'aimedBurst', count: 7, arc: 0.7, speed: 900, damage: 11, bulletRadius: 6, bulletLife: 170 },
        { kind: 'ring', count: 26, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 170 },
        { kind: 'spiral', count: 14, speed: 820, damage: 10, bulletRadius: 6, bulletLife: 170, turn: -0.6 },
      ],
    },
  ],
};
