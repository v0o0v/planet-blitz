/**
 * 브루저 액티브 스킬 6종의 **효과 함수**(ADR-0041) — 0b 수직 관통 파일럿.
 *
 * 레지스트리(`data/ships/actives/bruiser.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1721-1731` 인코딩 표)
 * `aux0` = 장갑 스택(0..`ARMOR_MAX_STACKS`=8) · `aux1` = 마지막 피격 이후 경과 틱
 * (`ARMOR_DECAY_TICKS` 마다 1스택 소멸). 6종 전부 스택을 **충전하거나 통째로 태워** 쓴다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 여기서 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다.
 */

import { ARMOR_MAX_STACKS, clampArmorStacks } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import {
  blastDamage,
  blink,
  fanStrike,
  powerCentiOf,
  scaleCenti,
  setBuffTicks,
} from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/** 장갑 스택 = `aux0`. 인코딩 표를 지켜 clamp 후 쓴다. */
function setArmorStacks(player: Entity, stacks: number): void {
  player.aux0 = clampArmorStacks(stacks);
}

/** 발동 효과. */
export const BRUISER_HANDLERS: ActiveHandlerTable = {
  as_bruiser_blade_lo: (state, player, def, dir) => {
    // 쌓인 스택을 **전부 태워** 파편으로 환산한다(방어 자원 → 화력).
    const stacks = clampArmorStacks(player.aux0);
    const count = (def.coeff.base ?? 0) + (def.coeff.perStack ?? 0) * stacks;
    const centi = powerCentiOf(state, def);
    fanStrike(state, player, count, scaleCenti(def.coeff.damage ?? 0, centi), def.coeff.spreadDeg ?? 0, dir);
    setArmorStacks(player, 0);
  },
  as_bruiser_blade_hi: (state, player, def, dir) => {
    // 먼저 만재로 충전하고 같은 틱에 전량 소모한다 — "충전 → 전환"이 고티어의 정체성이다.
    setArmorStacks(player, ARMOR_MAX_STACKS);
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      def.coeff.base ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
      { pierce: 1 },
    );
    setArmorStacks(player, 0);
  },
  as_bruiser_morph_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    setArmorStacks(player, player.aux0 + (def.coeff.stacks ?? 0));
    player.aux1 = 0; // 감쇠 타이머 리셋(부딪히며 장갑이 붙는다).
  },
  as_bruiser_morph_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    setArmorStacks(player, def.coeff.stacks ?? 0);
    player.aux1 = 0;
  },
  as_bruiser_fortify_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
  as_bruiser_fortify_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
};

/** 지속 중 매 틱 유지 훅 — 스택을 만재로 고정하고 감쇠 타이머를 눌러 둔다. */
export const BRUISER_SUSTAIN: ActiveSustainTable = {
  as_bruiser_fortify_lo: (_state, player) => {
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
  as_bruiser_fortify_hi: (_state, player) => {
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
};

/** 만료 틱 훅 — 고정이 끝나는 순간 장갑 전량을 폭발로 전환한다. */
export const BRUISER_EXPIRE: ActiveExpireTable = {
  as_bruiser_fortify_hi: (state, player, def) => {
    const centi = powerCentiOf(state, def);
    blastDamage(
      state,
      player,
      def.coeff.blastRadius ?? 0,
      scaleCenti(def.coeff.blastDamage ?? 0, centi),
    );
    setArmorStacks(player, 0);
  },
};
