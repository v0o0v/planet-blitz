/**
 * **팬텀 은신 진입 에지 훅**(PH7·DI7·DI8) — `cloak.ts` 의 {@link fireCloakEntry} 가 부른다.
 *
 * ## ⚠️ 왜 `skills/phantom.ts` 가 아니라 별도 파일인가 — **순환을 끊기 위해서다**
 * 진입 에지 훅의 자리는 `cloak.ts` 의 `fireCloakEntry` 다(그 함수 주석이 정본: 훅을 진입 판정
 * 지점마다 흩어 심으면 셋 중 하나에서만 도는 반쪽 배선이 된다). 그런데 `skills/phantom.ts` 는
 * PH1·PH8·DI5·DI6 을 위해 `cloak.ts` 의 `advanceCloak` 을 **런타임 import** 한다 —
 * 그래서 `cloak.ts` 가 `skills/phantom.ts` 를 부르면 곧바로 런타임 순환이다:
 *
 * ```
 * cloak.ts → skills/phantom.ts → cloak.ts        ← 순환 (금지)
 * cloak.ts → skills/phantomEntry.ts → activeTypes/status/items   ← 이 파일 (순환 0)
 * ```
 *
 * `skillHooks.ts` 헤더 ① 이 경고한 그대로, 그 순환은 **클라에서는 재현되지 않고 검증 EF 에서만**
 * TDZ 로 터진다. 이 파일의 import 는 `activeTypes.js`·`status.js`·`items/skills.js` 뿐이고 셋 다
 * `cloak.js` 를 당기지 않으므로(실측: `cloak.js` 를 런타임 import 하는 파일은 `world.ts`·
 * `boss.ts`·`patterns/index.ts`·`activeHandlers/phantom.ts` 넷뿐) 순환이 구조적으로 없다.
 *
 * ## 규율은 `skills/striker.ts` 헤더가 정본이다
 * ①`world.ts` 런타임 import 0건 ②모든 쓰기는 투자 게이트 안쪽 ③반올림은 게이트 안 ④RNG 소비 0
 * ⑤슬롯 접근은 `readSlot`/`writeSlot` 만(이 파일은 슬롯을 한 칸도 안 쓴다).
 *
 * ## 침공에서는 도달 불가
 * 모든 진입 경로가 `advanceCloak`/`stepShipSignature` 팬텀 분기를 거치고 둘 다 침공에서 접히므로
 * (`phantom.md` ④ 표 "PH7·DI7·DI8 자동 no-op"), 이 파일은 침공 게이트를 따로 걸지 않는다 —
 * 같은 술어를 두 곳에 적으면 조용히 갈린다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { blastDamage, clearEnemyBullets } from '../activeTypes.js';
import { applySlow, COLD_DURATION } from '../status.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/phantom.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [assassin(offense), phase(utility), disrupt(defense)]` 이므로
// AS1..AS10 = 0..9 · PH1..PH10 = 10..19 · DI1..DI10 = 20..29 다.
// 설계서 서술 순서(암살→위상→교란)와 우연히 일치하지만, **정본은 언제나 `trees` 배열**이다
// (스트라이커는 [offense, defense, utility], 아크캐스터는 [offense, utility, defense] 로 셋이 다 달랐다).

const enum Sk {
  /** PH7 진입 섬광 */ entryFlash = 16,
  /** DI7 소실 냉파 */ vanishingChill = 26,
  /** DI8 위상 침전 */ phaseSediment = 27,
}

function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}

/**
 * 은신 진입 에지에서 정확히 한 번 — **순서 고정: 피해(PH7) → CC(DI7) → 성장(DI8)**.
 * 설계서 공통 구현 고지 ③ 이 지정한 순서다. 셋 다 서로의 입력을 읽지 않으므로 오늘은 순서가
 * 값을 바꾸지 않지만, 훗날 "진입 폭발로 죽은 적에게 냉기를 걸었는가" 같은 질문이 생겼을 때
 * 답이 코드에 이미 있어야 한다.
 *
 * ⚠️ 호출부(`fireCloakEntry`)가 `state.skillsOn` 게이트를 이미 걸었다 — 여기서 다시 보지 않는다.
 */
export function phantomCloakEntry(state: WorldState, player: Entity): void {
  // ① PH7 진입 섬광 — 반경 150 + 12×Lv, 피해 15 + 3×Lv. 폭발과 적탄 소거가 같은 반경이다.
  const ph7 = lv(state, Sk.entryFlash);
  if (ph7 >= 1) {
    const radius = 150 + 12 * ph7;
    blastDamage(state, player, radius, 15 + 3 * ph7);
    clearEnemyBullets(state, player, radius);
  }

  // ② DI7 소실 냉파 — 반경 200 + 15×Lv 안 적에게 냉기. 감속 강도는 `COLD_SLOW_MULT` 고정
  //    규율이라 반경만 성장한다(설계서 DI7).
  //
  //    ⚠️ 대상을 `kind === 'enemy'` 로 좁힌 것은 의도다. `applySlow` 는 `e.ownerId` 를 감속
  //    잔여 틱으로 쓰는데, 그 칸의 의미는 kind 마다 다르다(보스·기물·탄에서 `ownerId` 는
  //    소유자 id 다) — 넓게 걸면 다른 축의 상태를 조용히 덮어쓴다. `filmBurst.ts` 의 넉백이
  //    같은 사유로 같은 게이트를 쓴다.
  const di7 = lv(state, Sk.vanishingChill);
  if (di7 >= 1) {
    const r = 200 + 15 * di7;
    const r2 = r * r;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      // 반경 판정은 제곱 비교로(선례: `resolveFilmBurst`·`nearestTarget`) — 반경 밖 적에게는
      // 산술 자체를 실행하지 않는다.
      if (dx * dx + dy * dy > r2) continue;
      applySlow(e, COLD_DURATION);
    }
  }

  // ③ DI8 위상 침전 — 진입 성공마다 최대 HP 영구 증가. round(2 + 16×Lv/(Lv+24)).
  //
  //    ⚠️ **현재 hp 는 올리지 않는다.** 설계서는 "최대 HP 가 런 내 영구 증가"만 말한다 —
  //    hp 까지 같이 올리면 은신 진입이 회복 수단이 되어 DI2(은둔 재생)와 축이 겹친다.
  //    파워업 `maxHp` 가산과의 합산 순서는 무관하다(둘 다 순수 가산이라 교환법칙이 선다).
  //
  //    카운터가 없는 것도 의도다 — 진입 에지가 정본 한 곳(`fireCloakEntry`)이라 호출 횟수가
  //    곧 진입 횟수다(설계서 DI8 "신규 상태 0").
  const di8 = lv(state, Sk.phaseSediment);
  if (di8 >= 1) {
    player.maxHp += Math.round(2 + (16 * di8) / (di8 + 24));
  }
}
