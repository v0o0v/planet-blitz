/**
 * 마시멜로 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/mallow.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1815` 인코딩 표)
 * `aux0` = 적립된 지연 피해(비음 정수) · `aux1` = 연속 무피격 틱.
 * 정산 규칙은 world 배선이 정본이다 — `aux0 > 0` 이고 `aux1 >= CUSHION_RECOVER_TICKS` 인 틱에
 * 풀을 통째로 정산한다(회복분은 사라지고 나머지가 선체로 들어간 뒤 두 칸 모두 0).
 * 그래서 이 6종의 조작은 정확히 두 축이다:
 *  · `aux0` — 부채를 **청산**(탄약으로 환산)하거나 **키운다**(지금 화력을 당겨쓴다).
 *  · `aux1` — 정산 임계를 **주입**해 앞당기거나, 0 으로 **눌러** 정산을 미룬다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import { CUSHION_RECOVER_TICKS } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/**
 * 완충 무피격 카운터 상한. `world.ts` 의 동명 상수(비공개)와 같은 값이며 같은 이유로 둔다 —
 * `aux` 는 u32 로 해시되므로(replay.ts hashEntity) 정수를 유계로 유지한다. 임계(180)는 이미
 * 넘긴 뒤라 거동에는 영향이 없다.
 */
const CUSHION_TICK_CAP = 600;

/** 무피격 카운터(`aux1`)를 상한 안에서 흘린다. */
function addUnhitTicks(player: Entity, by: number): void {
  const next = Math.trunc(player.aux1) + Math.trunc(by);
  player.aux1 = next > CUSHION_TICK_CAP ? CUSHION_TICK_CAP : next;
}

/** 발동 효과. */
export const MALLOW_HANDLERS: ActiveHandlerTable = {
  as_mallow_squish_lo: (state, player, def, dir) => {
    // 미룬 피해를 **되돌려 쏜다** — 적립분이 클수록 탄이 많아지고, 쏜 뒤 부채는 청산된다.
    const deferred = Math.max(0, Math.trunc(player.aux0));
    const per = def.coeff.perDeferred ?? 1;
    const count = (def.coeff.base ?? 0) + (per > 0 ? Math.floor(deferred / per) : 0);
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      count,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
    );
    player.aux0 = 0;
  },
  as_mallow_squish_hi: (state, player, def, dir) => {
    // 반대 거래 — 부채를 키우는 대가로 지금 대형 탄막을 산다(미룬 아픔은 나중에 온다).
    const deferred = Math.max(0, Math.trunc(player.aux0));
    player.aux0 = deferred * (def.coeff.carryMul ?? 1) + (def.coeff.carryAdd ?? 0);
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
  },
  as_mallow_mend_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 정산 임계를 주입한다 — 다음 시그니처 틱에서 풀이 통째로 정산·회복된다.
    player.aux1 = CUSHION_RECOVER_TICKS;
  },
  as_mallow_mend_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 정산 **전에** 부채를 깎는다 — 그만큼 선체로 들어올 몫 자체가 줄어든다.
    const div = def.coeff.debtDiv ?? 1;
    if (div > 0) player.aux0 = Math.floor(Math.max(0, Math.trunc(player.aux0)) / div);
    player.aux1 = CUSHION_RECOVER_TICKS;
  },
  as_mallow_cushion_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    addUnhitTicks(player, def.coeff.perTick ?? 0);
  },
  as_mallow_cushion_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    // 전량 유예 — 카운터를 0 으로 눌러 지속 동안 정산이 일어나지 못하게 한다.
    player.aux1 = 0;
  },
};

/** 지속 중 매 틱 유지 훅. */
export const MALLOW_SUSTAIN: ActiveSustainTable = {
  as_mallow_cushion_lo: (_state, player, def) => {
    // 시그니처가 매 틱 +1 하는 위에 이만큼을 더 얹는다 → 회복 임계가 그만큼 빨리 찬다.
    addUnhitTicks(player, def.coeff.perTick ?? 0);
  },
  as_mallow_cushion_hi: (_state, player) => {
    player.aux1 = 0;
  },
};

/** 만료 틱 훅 — 유예가 끝나는 순간 미뤄둔 분을 한 번에 정산한다. */
export const MALLOW_EXPIRE: ActiveExpireTable = {
  as_mallow_cushion_hi: (_state, player) => {
    player.aux1 = CUSHION_RECOVER_TICKS;
  },
};
