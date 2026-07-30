/**
 * phantom 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/phantom.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1811-1816` 인코딩 표)
 * `aux0` = 연속 무피격 틱 · `aux1` = 은신 해제 첫 타 **배율 토큰**(0/1).
 * `stepShipSignature` 의 팬텀 분기가 정한 구조적 상한은
 * `CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS - 1` = 359 다(360 에 닿는 틱에 사이클이 되감긴다).
 *
 * ## 두 슬롯을 항상 **짝으로** 다룬다
 * 세계 코드에서 두 값은 늘 같이 선다(`aux0 === CLOAK_UNHIT_TICKS` 인 틱에 `aux1 = 1`) —
 * 그래서 여기서도 "은신 진입"은 `aux0` 과 `aux1` 을 함께 세우고, "은신 이탈"은 `aux0` 을
 * 0 으로 되돌린다. 한쪽만 만지면 배율이 조용히 두 번 실리거나 영영 안 실린다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import { CLOAK_HOLD_TICKS, CLOAK_UNHIT_TICKS } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/**
 * 무피격 카운터의 구조적 상한 — `stepShipSignature` 가 이 값을 넘는 틱에 사이클을 0 으로
 * 되감으므로, 액티브가 그보다 큰 값을 심으면 다음 틱에 통째로 날아간다.
 */
const CLOAK_TICK_CAP = CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS - 1;

/** 연속 무피격 틱 = `aux0`. 인코딩 표를 지켜 [0, CAP] 정수로 clamp 후 쓴다. */
function setUnhitTicks(player: Entity, ticks: number): void {
  const t = Math.trunc(ticks);
  player.aux0 = t <= 0 ? 0 : t >= CLOAK_TICK_CAP ? CLOAK_TICK_CAP : t;
}

/** 은신 진입 — 두 슬롯을 **짝으로** 세운다(세계 코드의 `=== 임계` 틱과 같은 결과). */
function enterCloak(player: Entity): void {
  setUnhitTicks(player, CLOAK_UNHIT_TICKS);
  player.aux1 = 1;
}

/** 은신 이탈 — 사이클만 되감고 배율 토큰은 **남긴다**(그 토큰을 쓰려고 끊는 것이므로). */
function breakCloak(player: Entity): void {
  player.aux1 = 1;
  setUnhitTicks(player, 0);
}

/** 발동 효과. */
export const PHANTOM_HANDLERS: ActiveHandlerTable = {
  as_phantom_assassin_lo: (state, player, def, dir) => {
    // 기다리지 않고 은신을 **끊어** 해제 첫 타 배율을 지금 쓴다.
    breakCloak(player);
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      def.coeff.count ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
    );
  },
  as_phantom_assassin_hi: (state, player, def, dir) => {
    // 같은 틱에 진입 → 이탈. 진입을 거치므로 은신 없이 배율만 챙기는 것이 아니다.
    enterCloak(player);
    breakCloak(player);
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      def.coeff.count ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
      { pierce: 1 },
    );
  },
  as_phantom_phase_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 은신 진입 조건을 advance 만큼 **앞당긴다**(진입시키지는 않는다 — 저티어의 절제).
    setUnhitTicks(player, player.aux0 + (def.coeff.advance ?? 0));
  },
  as_phantom_phase_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 착지와 동시에 은신 창으로 직행.
    enterCloak(player);
  },
  as_phantom_disrupt_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    if (player.aux0 < CLOAK_UNHIT_TICKS) enterCloak(player);
  },
  as_phantom_disrupt_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    player.aux1 = 1;
  },
};

/** 지속 중 매 틱 유지 훅. */
export const PHANTOM_SUSTAIN: ActiveSustainTable = {
  // 은신 유지 — 피격이 `aux0` 를 0 으로 되돌려도 매 틱 진입 임계를 **하한으로** 되돌린다.
  as_phantom_disrupt_lo: (_state, player) => {
    if (player.aux0 < CLOAK_UNHIT_TICKS) enterCloak(player);
  },
  // 무한 초격 — 발사로 소진된 배율 토큰을 매 틱 다시 세운다.
  as_phantom_disrupt_hi: (_state, player) => {
    player.aux1 = 1;
  },
};

/** 만료 틱 훅 — 지속이 끝나면 남은 토큰을 회수해 버프 밖으로 새지 않게 한다. */
export const PHANTOM_EXPIRE: ActiveExpireTable = {
  as_phantom_disrupt_hi: (_state, player) => {
    player.aux1 = 0;
  },
};
