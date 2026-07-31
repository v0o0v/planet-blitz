/**
 * 도주자 — **현상금 표적**(`order: 'bounty'`) 전용 의뢰 보스 (계획 §Phase F).
 *
 * ## 이 보스가 자기 주문에 던지는 질문
 * 현상금 표적은 유일하게 **실패 경로**를 갖는다: 표적이 도주하면 구간이 끝나고, 마지막
 * 구간이면 의뢰가 실패한다(계약 §5 분기 ③ = `gameOver`). 도주 카운트다운은 HP 가
 * {@link COMMISSION_BOUNTY_ESCAPE_HP_CENTI} 아래로 떨어질 때 켜지고
 * {@link COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS} 뒤에 성립한다.
 *
 * 그래서 이 보스가 묻는 것은 총 화력이 아니라 **마무리 화력**이다. HP 를 임계까지 깎는 것은
 * 누구나 한다 — 어려운 것은 임계 아래에서 시계가 도는 동안 남은 20% 를 끝내는 것이다.
 * 그 시간창을 정면으로 방해하도록 저작한다.
 *
 *  - **HP 는 낮고 이동은 빠르다.** 임계에 일찍 도달시켜 "쫓아가 끝내는 국면"을 길게 준다.
 *  - **P3(35%↓, 임계 20% 를 포함하는 구간)이 회피·방해 전담이다.** `slowField` 로 추격을
 *    늦추고 `laserNet` 으로 접근선을 끊는다. 여기서 딜을 넣으려면 감속장을 감수해야 한다.
 *  - P3 의 시그니처를 굳이 아픈 공격으로 두지 않는다. 이 페이즈의 위협은 피해량이 아니라
 *    **흘러가는 시간**이며, 두 위협을 겹치면 무엇에 졌는지 플레이어가 읽을 수 없다.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 나선 + 링. 평범한 교전 — 임계까지는 빠르게 온다.
 *  - P2(70→35%): 조준 부채꼴 + 격자. 접근을 시험한다.
 *  - P3(35→0%): 감속장 + 격자 + 링. **도주 시계가 도는 구간.** 추격을 방해한다.
 *
 * 체급: 도주 국면을 만들기 위해 HP 는 의뢰 보스 중 가장 낮고 이동은 가장 빠르다.
 */

import type { BossDef } from '../boss.js';

export const COMMISSION_RUNNER_WRAITH: BossDef = {
  id: 'commission-runner-wraith',
  hp: 2800,
  radius: 112,
  contactDamage: 20,
  moveSpeed: 156,
  phases: [
    // P1 — 평범한 교전. 임계까지 빠르게 도달시킨다.
    {
      patternCooldown: 96,
      overheatInterval: 600,
      attacks: [
        { kind: 'spiral', count: 10, speed: 680, damage: 9, bulletRadius: 6, bulletLife: 155, turn: 0.4 },
        { kind: 'ring', count: 16, speed: 640, damage: 8, bulletRadius: 7, bulletLife: 150 },
      ],
    },
    // P2 — 접근 시험: 조준 부채꼴이 직선 추격을 벌하고 격자가 우회를 강요한다.
    {
      patternCooldown: 84,
      overheatInterval: 570,
      attacks: [
        { kind: 'aimedBurst', count: 6, arc: 0.6, speed: 860, damage: 10, bulletRadius: 6, bulletLife: 165 },
        { kind: 'laserNet', lines: 3, speed: 720, damage: 9, bulletRadius: 6, bulletLife: 170 },
      ],
    },
    // P3 — 도주 시계 구간: 위협을 "시간"으로 단일화한다. 감속장 + 접근선 차단.
    {
      patternCooldown: 78,
      overheatInterval: 540,
      attacks: [
        { kind: 'slowField', zones: 3, windup: 36, activeTicks: 240, radius: 136, damage: 5 },
        { kind: 'laserNet', lines: 4, speed: 760, damage: 10, bulletRadius: 6, bulletLife: 175 },
        { kind: 'ring', count: 20, speed: 780, damage: 9, bulletRadius: 7, bulletLife: 160 },
      ],
    },
  ],
};
