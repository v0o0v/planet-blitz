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
 * ## 두 슬롯의 시점이 **갈라졌다** (선결 C-3, 사용자 승인 2026-08-06)
 * 종전에는 진입 틱에 두 값이 같이 섰다(`aux0 === CLOAK_UNHIT_TICKS` 인 틱에 `aux1 = 1`).
 * C-3 이 토큰을 **창 종료 에지**로 옮긴 뒤로는 "은신 진입"이 `aux0` 만 세우고, 토큰은
 * `world.ts` 의 되감기 지점(또는 여기 `breakCloak` 처럼 창을 **끊는** 액티브)에서만 선다.
 * 그래서 진입은 `enterCloak`, 이탈은 `breakCloak` 로 여전히 함수 하나씩에 묶어 둔다 —
 * 직접 대입하면 배율이 조용히 두 번 실리거나 영영 안 실린다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import { CLOAK_HOLD_TICKS, CLOAK_UNHIT_TICKS } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';
import { advanceCloak, fireCloakEntry, setBreakToken } from '../cloak.js';
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

/**
 * 은신 진입 — `aux0` 을 임계로 올리고 진입 에지 정본을 발화한다(세계 코드의 진입 틱과 동형).
 *
 * 진입 훅은 `fireCloakEntry`(= 진입 에지 정본)를 거친다(E1). 훗날 진입 훅 스킬(PH7·DI7·DI8)이
 * 그 함수 안에 얹히므로, 여기서 훅을 다시 적으면 **액티브로 진입했을 때만 도는** 반쪽 배선이
 * 된다. C-3 이후 진입은 배율 토큰을 세우지 않는다(토큰은 창 종료 에지에서만).
 */
function enterCloak(state: WorldState, player: Entity): void {
  setUnhitTicks(player, CLOAK_UNHIT_TICKS);
  fireCloakEntry(state, player);
}

/**
 * 은신 이탈 — 사이클만 되감고 배율 토큰은 **남긴다**(그 토큰을 쓰려고 끊는 것이므로).
 *
 * 토큰 쓰기는 `setBreakToken` 단일 경로를 거친다(E1) — 침공 차단 같은 규칙이 훗날 그 헬퍼에
 * 들어올 때 여기만 빠지는 일이 없게 한다.
 */
function breakCloak(state: WorldState, player: Entity): void {
  setBreakToken(state, player, 1);
  setUnhitTicks(player, 0);
}

/** 발동 효과. */
export const PHANTOM_HANDLERS: ActiveHandlerTable = {
  as_phantom_assassin_lo: (state, player, def, dir) => {
    // 기다리지 않고 은신을 **끊어** 해제 첫 타 배율을 지금 쓴다.
    breakCloak(state, player);
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
    enterCloak(state, player);
    breakCloak(state, player);
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
    //
    // **`advanceCloak` 이관 완료**(E1 · `phantom.md` ①-6). 종전 `setUnhitTicks(aux0 + k)` 는
    // 359 clamp · 진입 에지 미발화라 ①임계를 건너뛰면 진입 훅이 죽고 ②창 안 주입이 다음 틱에
    // 360 에 닿아 사이클을 파괴했다. 헬퍼는 240 clamp · 창 안 무효 · 통과 에지 발화다 —
    // 주입이 임계를 넘거나 창 안일 때 값이 갈리므로 **거동 변경**(골든 재생성 + EF 재배포).
    advanceCloak(state, player, def.coeff.advance ?? 0);
  },
  as_phantom_phase_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 착지와 동시에 은신 창으로 직행.
    enterCloak(state, player);
  },
  as_phantom_disrupt_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    if (player.aux0 < CLOAK_UNHIT_TICKS) enterCloak(state, player);
  },
  as_phantom_disrupt_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setBreakToken(state, player, 1);
  },
};

/** 지속 중 매 틱 유지 훅. */
export const PHANTOM_SUSTAIN: ActiveSustainTable = {
  // 은신 유지 — 피격이 `aux0` 를 0 으로 되돌려도 매 틱 진입 임계를 **하한으로** 되돌린다.
  as_phantom_disrupt_lo: (state, player) => {
    if (player.aux0 < CLOAK_UNHIT_TICKS) enterCloak(state, player);
  },
  // 무한 초격 — 발사로 소진된 배율 토큰을 매 틱 다시 세운다.
  as_phantom_disrupt_hi: (state, player) => {
    setBreakToken(state, player, 1);
  },
};

/** 만료 틱 훅 — 지속이 끝나면 남은 토큰을 회수해 버프 밖으로 새지 않게 한다. */
export const PHANTOM_EXPIRE: ActiveExpireTable = {
  as_phantom_disrupt_hi: (state, player) => {
    setBreakToken(state, player, 0);
  },
};
