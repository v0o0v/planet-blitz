/**
 * 아르케 수호자 오벨리스크 보스 — "고대 수호자 오벨리스크"(plan B2, AC4).
 *
 * 3페이즈 골격·과열 창 리듬·페이즈 전환 탄 소거(src/sim/boss.ts)를 승계한다. 오벨리스크
 * 만의 특성은 신규 공격 컴포넌트(polygonSpin = 기하학 회전 다각형 탄막)로 표현하며,
 * 나머지는 기존 ring/spiral/aimedBurst 프리미티브 재사용. 고대 기계 수호자답게 정밀한
 * 기하학 패턴으로 압박한다(유령 기함의 그물·감속과 대비).
 *
 * 페이즈 설계:
 *  - P1(100→70%): 삼각형 회전 탄막 + 넓은 링. 규칙적 기하 압박.
 *  - P2(70→35%): 사각형 회전 탄막 + 역나선. 회전 방향이 교차한다.
 *  - P3(35→0%): 오각형 회전 탄막 + 조준 부채꼴 + 고밀도 링. 발악 페이즈.
 *
 * BossDef 구조 공유(src/sim/boss.ts updateBoss 실행). 밸런스 수치는 M3 1차 튜닝값.
 */

import type { BossDef } from '../boss.js';

export const ARKE_OBELISK: BossDef = {
  id: 'arke-guardian-obelisk',
  // 단단한 수호자: 카르곤(3600)에 준하는 체급.
  hp: 3600,
  radius: 128,
  contactDamage: 24,
  moveSpeed: 120,
  phases: [
    // P1 — 삼각 회전: 시그니처(polygonSpin 3각) + 넓은 링.
    {
      patternCooldown: 98,
      overheatInterval: 600,
      attacks: [
        { kind: 'polygonSpin', sides: 3, perSide: 3, spread: 0.4, speed: 640, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.42 },
        { kind: 'ring', count: 16, speed: 620, damage: 8, bulletRadius: 7, bulletLife: 150 },
      ],
    },
    // P2 — 사각 회전 교차: polygonSpin 4각 + 역나선.
    {
      patternCooldown: 86,
      overheatInterval: 570,
      attacks: [
        { kind: 'polygonSpin', sides: 4, perSide: 3, spread: 0.4, speed: 720, damage: 9, bulletRadius: 6, bulletLife: 160, turn: -0.5 },
        { kind: 'spiral', count: 12, speed: 740, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.5 },
        { kind: 'ring', count: 22, speed: 760, damage: 9, bulletRadius: 7, bulletLife: 160 },
      ],
    },
    // P3 — 발악: 오각 회전 + 조준 부채꼴 + 고밀도 링.
    {
      patternCooldown: 60,
      overheatInterval: 540,
      attacks: [
        { kind: 'polygonSpin', sides: 5, perSide: 4, spread: 0.5, speed: 820, damage: 11, bulletRadius: 6, bulletLife: 170, turn: 0.6 },
        { kind: 'aimedBurst', count: 7, arc: 0.7, speed: 900, damage: 11, bulletRadius: 6, bulletLife: 170 },
        { kind: 'ring', count: 26, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 170 },
      ],
    },
  ],
};
