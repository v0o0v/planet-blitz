/**
 * 정예 군주 — **정예 소집령**(`order: 'elite'`) 전용 의뢰 보스 (계획 §Phase F).
 *
 * ## 이 보스가 자기 주문에 던지는 질문
 * 정예 소집령은 잡몹 0 · 젬 0 이라 **런 내 성장이 없다**(ADR-0043). 플레이어는 출격 시점의
 * 화력 그대로 이 보스 앞에 선다. 그래서 이 보스는 "런 중에 얼마나 컸는가"를 물을 수 없다 —
 * 물을 수 있는 것은 **출격 전에 무엇을 준비했는가**, 그리고 **패턴을 읽었는가** 둘뿐이다.
 *
 * 그래서 두 가지를 지킨다.
 *  1. **패턴이 읽힌다.** 페이즈마다 공격 수를 늘리기보다 같은 리듬을 유지한다. 성장 없는
 *     플레이어가 화력으로 뚫을 수 없는 구간을 만들면, 남는 것은 운뿐이다.
 *  2. **과열 창이 좁다**(overheatInterval 이 다른 의뢰 보스보다 짧고 patternCooldown 도 짧다).
 *     성장이 없으니 총 피해량은 창을 놓치지 않는 정확도에서 나온다.
 *
 * 정예 소환(`summon`)으로 주문 자체를 되받는다 — 플레이어를 여기까지 데려온 것이 정예 겹침
 * 이었으므로, 군주도 같은 방식으로 싸운다.
 *
 * 페이즈 설계:
 *  - P1(100→70%): 조준 부채꼴 + 호위 소환. 리듬을 익히는 구간.
 *  - P2(70→35%): 레이저 격자 + 링. 위치 선정을 묻는다(화력이 아니라 자리).
 *  - P3(35→0%): 다각 회전 + 부채꼴 + 소환. 같은 리듬, 더 촘촘한 그물.
 *
 * 체급: 성장 없는 플레이어가 상대하므로 HP 는 행성 보스보다 **낮다**(3600 → 3200).
 */

import type { BossDef } from '../boss.js';

export const COMMISSION_WARLORD_CROWN: BossDef = {
  id: 'commission-warlord-crown',
  hp: 3200,
  radius: 124,
  contactDamage: 22,
  moveSpeed: 128,
  phases: [
    // P1 — 리듬 제시: 시그니처(aimedBurst) + 호위 소환.
    {
      patternCooldown: 92,
      overheatInterval: 540,
      attacks: [
        { kind: 'aimedBurst', count: 5, arc: 0.58, speed: 800, damage: 9, bulletRadius: 6, bulletLife: 160 },
        { kind: 'summon', role: 'gunner', count: 3 },
      ],
    },
    // P2 — 자리 싸움: 격자가 접근선을 나누고 링이 여백을 메운다.
    {
      patternCooldown: 88,
      overheatInterval: 520,
      attacks: [
        { kind: 'aimedBurst', count: 5, arc: 0.58, speed: 840, damage: 10, bulletRadius: 6, bulletLife: 160 },
        { kind: 'laserNet', lines: 3, speed: 700, damage: 9, bulletRadius: 6, bulletLife: 170 },
        { kind: 'ring', count: 18, speed: 720, damage: 9, bulletRadius: 7, bulletLife: 155 },
      ],
    },
    // P3 — 같은 리듬, 더 촘촘한 그물. 공격 수는 늘어도 캐스트 간격은 유지한다.
    {
      patternCooldown: 72,
      overheatInterval: 500,
      attacks: [
        { kind: 'aimedBurst', count: 6, arc: 0.62, speed: 880, damage: 11, bulletRadius: 6, bulletLife: 170 },
        { kind: 'polygonSpin', sides: 4, perSide: 3, spread: 0.42, speed: 780, damage: 10, bulletRadius: 6, bulletLife: 165, turn: 0.46 },
        { kind: 'summon', role: 'charger', count: 3 },
      ],
    },
  ],
};
