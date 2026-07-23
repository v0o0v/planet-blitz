/**
 * 크라스 파괴 보스 — "공성 거병 콜로서스"(Lane9, ADR-0021 §6).
 *
 * 3페이즈 골격·과열 창 리듬·페이즈 전환 탄 소거(src/sim/boss.ts)를 승계한다. 콜로서스는
 * 파괴·관통 테마답게 기하학 회전 탄막(polygonSpin 재사용)과 고관통 부채꼴로 벽을 부수듯
 * 압박한다. 신규 프리미티브는 도입하지 않고 기존 BossAttack 유니온(polygonSpin/ring/spiral/
 * aimedBurst/lavaLine)만 재사용한다.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 삼각 회전 탄막 + 넓은 링. 규칙적 기하 압박.
 *  - P2(70→35%): 사각 회전 교차 + 역나선. 회전 방향이 교차한다.
 *  - P3(35→0%): 오각 회전 + 조준 부채꼴 + 고밀도 링. 발악 페이즈.
 *
 * BossDef 구조 공유(src/sim/boss.ts updateBoss 실행). 밸런스 수치는 전부 플레이스홀더다
 * (// TODO(밸런스)) — 출시 직전 일괄 튜닝에서 확정한다.
 */

import type { BossDef } from '../boss.js';

export const KRAS_COLOSSUS: BossDef = {
  id: 'kras-siege-colossus',
  hp: 3600, // TODO(밸런스)
  radius: 128, // TODO(밸런스)
  contactDamage: 24, // TODO(밸런스)
  moveSpeed: 120, // TODO(밸런스)
  phases: [
    // P1 — 삼각 회전: 시그니처(polygonSpin 3각) + 넓은 링.
    {
      patternCooldown: 98, // TODO(밸런스)
      overheatInterval: 600, // TODO(밸런스)
      attacks: [
        { kind: 'polygonSpin', sides: 3, perSide: 3, spread: 0.4, speed: 640, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.42 }, // TODO(밸런스)
        { kind: 'ring', count: 16, speed: 620, damage: 8, bulletRadius: 7, bulletLife: 150 }, // TODO(밸런스)
      ],
    },
    // P2 — 사각 회전 교차: polygonSpin 4각 + 역나선.
    {
      patternCooldown: 86, // TODO(밸런스)
      overheatInterval: 570, // TODO(밸런스)
      attacks: [
        { kind: 'polygonSpin', sides: 4, perSide: 3, spread: 0.4, speed: 720, damage: 9, bulletRadius: 6, bulletLife: 160, turn: -0.5 }, // TODO(밸런스)
        { kind: 'spiral', count: 12, speed: 740, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.5 }, // TODO(밸런스)
        { kind: 'ring', count: 22, speed: 760, damage: 9, bulletRadius: 7, bulletLife: 160 }, // TODO(밸런스)
      ],
    },
    // P3 — 발악: 오각 회전 + 조준 부채꼴 + 고밀도 링.
    {
      patternCooldown: 60, // TODO(밸런스)
      overheatInterval: 540, // TODO(밸런스)
      attacks: [
        { kind: 'polygonSpin', sides: 5, perSide: 4, spread: 0.5, speed: 820, damage: 11, bulletRadius: 6, bulletLife: 170, turn: 0.6 }, // TODO(밸런스)
        { kind: 'aimedBurst', count: 7, arc: 0.7, speed: 900, damage: 11, bulletRadius: 6, bulletLife: 170 }, // TODO(밸런스)
        { kind: 'ring', count: 26, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 170 }, // TODO(밸런스)
      ],
    },
  ],
};
