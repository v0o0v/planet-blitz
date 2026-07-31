/**
 * 잔해 포식자 — **연쇄 원정**(`order: 'chain'`) 전용 의뢰 보스 (계획 §Phase F).
 *
 * ## 이 보스가 자기 주문에 던지는 질문
 * 연쇄 원정은 서로 다른 행성·모드를 **연달아** 통과한 뒤 마지막 구간에서 이 보스를 만난다.
 * 구간 승계(`carryAcrossSegment`)는 HP·자원을 그대로 넘기므로, 플레이어는 **이미 깎인 채로**
 * 여기 도착한다. 그래서 이 보스는 순간 화력이 아니라 **누적 손상을 견딜 수 있는가**를 묻는다.
 *
 * 그 질문을 수치가 아니라 **구조**로 만든다: 회피 공간을 서서히 잠식한다.
 * `lavaLine` → `slowField` 로 바닥을 좁히고, 좁아진 바닥 위로 링·나선을 얹는다.
 * 한 페이즈를 오래 끌수록 설 자리가 줄어드는 형태라, "아직 여유가 있을 때 밀어붙였는가"가
 * 그대로 결과가 된다. 단발 회피력이 높아도 누적 손상이 크면 후반 페이즈에서 무너진다.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 용암 기둥 + 넓은 링. 바닥 잠식이 시작된다.
 *  - P2(70→35%): + 잔해 소환 + 나선. 끌어모은 잔해가 회피선을 추가로 막는다.
 *  - P3(35→0%): + 감속장 + 조준 부채꼴. 도피처가 봉쇄된 채 발악.
 *
 * 체급: 장기전 전제라 HP 는 행성 보스(3600)보다 높고 이동은 느리다.
 */

import type { BossDef } from '../boss.js';

export const COMMISSION_SALVAGE_MAW: BossDef = {
  id: 'commission-salvage-maw',
  hp: 4200,
  radius: 132,
  contactDamage: 26,
  moveSpeed: 104,
  phases: [
    // P1 — 바닥 잠식 개시: 시그니처(lavaLine) + 넓은 링.
    {
      patternCooldown: 104,
      overheatInterval: 620,
      attacks: [
        { kind: 'lavaLine', pillars: 3, windup: 48, activeTicks: 180, radius: 96, damage: 10 },
        { kind: 'ring', count: 18, speed: 600, damage: 9, bulletRadius: 7, bulletLife: 155 },
      ],
    },
    // P2 — 잔해 회수: 용암 기둥이 늘고, 소환된 잔해가 회피선을 추가로 막는다.
    {
      patternCooldown: 92,
      overheatInterval: 590,
      attacks: [
        { kind: 'lavaLine', pillars: 4, windup: 42, activeTicks: 200, radius: 100, damage: 11 },
        { kind: 'summon', role: 'charger', count: 4 },
        { kind: 'spiral', count: 12, speed: 700, damage: 9, bulletRadius: 6, bulletLife: 160, turn: 0.44 },
      ],
    },
    // P3 — 도피처 봉쇄: 감속장이 남은 여백까지 덮는다.
    {
      patternCooldown: 66,
      overheatInterval: 560,
      attacks: [
        { kind: 'lavaLine', pillars: 5, windup: 36, activeTicks: 210, radius: 104, damage: 12 },
        { kind: 'slowField', zones: 3, windup: 40, activeTicks: 220, radius: 128, damage: 6 },
        { kind: 'aimedBurst', count: 7, arc: 0.66, speed: 860, damage: 11, bulletRadius: 6, bulletLife: 170 },
      ],
    },
  ],
};
