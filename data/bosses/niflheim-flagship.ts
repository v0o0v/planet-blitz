/**
 * 니플헤임 유령 기함 보스 — "유령 함대 기함"(plan B1, AC4).
 *
 * 카르곤 용암 요새·베르단 여왕과 동일한 3페이즈 골격·과열(overheat) 창 리듬·페이즈
 * 전환 탄 소거(src/sim/boss.ts가 임계 통과 시 자동 처리)를 승계한다. 기함만의 특성은
 * 두 신규 공격 컴포넌트(laserNet = 레이저 그물, slowField = 감속 지대)로 표현하며,
 * 나머지는 기존 ring/spiral/summon/aimedBurst 프리미티브 재사용.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 레이저 그물 + 넓은 링. 그물망으로 이동을 제약하고 압박.
 *  - P2(70→35%): 감속 지대 + 유령 소환 + 나선. 발을 묶고 물량으로 조인다.
 *  - P3(35→0%): 조밀한 레이저 그물 + 조준 부채꼴 + 고밀도 링. 발악 페이즈.
 *
 * BossDef 구조는 카르곤·베르단과 공유(src/sim/boss.ts updateBoss가 실행). 밸런스
 * 수치는 M3 1차 튜닝값 — 재미 게이트 루프에서 이동 예정.
 */

import type { BossDef } from '../boss.js';

export const NIFLHEIM_FLAGSHIP: BossDef = {
  id: 'niflheim-ghost-flagship',
  // 카르곤(3600)·베르단(3300) 사이 체급. 그물·감속으로 시간을 끌므로 중간값.
  hp: 3450,
  radius: 128,
  contactDamage: 22,
  moveSpeed: 135,
  phases: [
    // P1 — 그물+포위: 시그니처(레이저 그물)로 이동을 제약하고 넓은 링으로 조인다.
    {
      patternCooldown: 100,
      overheatInterval: 600,
      attacks: [
        { kind: 'laserNet', lines: 5, speed: 620, damage: 9, bulletRadius: 6, bulletLife: 170 },
        { kind: 'ring', count: 18, speed: 640, damage: 8, bulletRadius: 7, bulletLife: 150 },
        { kind: 'aimedBurst', count: 5, arc: 0.5, speed: 820, damage: 9, bulletRadius: 6, bulletLife: 150 },
      ],
    },
    // P2 — 속박: 감속 지대 + 유령 소환 + 나선 압박.
    {
      patternCooldown: 90,
      overheatInterval: 570,
      attacks: [
        { kind: 'slowField', zones: 5, windup: 44, activeTicks: 150, radius: 120, damage: 6 },
        { kind: 'summon', role: 'charger', count: 3 },
        { kind: 'spiral', count: 12, speed: 740, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.5 },
      ],
    },
    // P3 — 발악: 조밀한 그물 + 조준 부채꼴 + 고밀도 링/역나선.
    {
      patternCooldown: 62,
      overheatInterval: 540,
      attacks: [
        { kind: 'laserNet', lines: 7, speed: 700, damage: 10, bulletRadius: 6, bulletLife: 180 },
        { kind: 'aimedBurst', count: 7, arc: 0.7, speed: 900, damage: 11, bulletRadius: 6, bulletLife: 170 },
        { kind: 'ring', count: 26, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 170 },
      ],
    },
  ],
};
