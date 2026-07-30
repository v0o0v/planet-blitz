/**
 * arccaster 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/arccaster.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1811-1816` 인코딩 표)
 * `aux0` = 연속 정지 틱 · `aux1` = **미사용(0)**. 이 파일은 `aux1` 을 건드리지 않는다 —
 * 인코딩 표에서 이 기체의 `aux1` 은 영구 0 이고, 0 이 아닌 값을 넣으면 조건부 해시 꼬리가
 * 의미 없이 켜진다.
 *
 * ## 축의 의미 (`src/sim/shipSignature.ts`)
 * `OVERCHARGE_STILL_TICKS`=90 에서 과충전 진입 · `overchargeBp` 는 190틱(=90+100)에서
 * `OVERCHARGE_MAX_BP`=4000 에 도달해 평평해진다. 그래서 "상한 도달치"는 190 이다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import {
  OVERCHARGE_MAX_BP,
  OVERCHARGE_BASE_BP,
  OVERCHARGE_RAMP_BP,
  OVERCHARGE_STILL_TICKS,
} from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/**
 * 과충전 정지 카운터 상한. `world.ts` 의 `OVERCHARGE_TICK_CAP`(=600, 파일 지역 상수라
 * export 되지 않는다)과 **같은 값**이어야 한다 — 넘겨 쓰면 시그니처 카운터가 상한 밖으로
 * 새고, `aux` 는 u32 로 해시된다(`replay.ts` hashEntity).
 */
const OVERCHARGE_TICK_CAP = 600;

/**
 * 증폭 상한에 정확히 닿는 정지 틱(= 90 + 100 = 190). 리터럴 190 을 박지 않고 상수에서
 * 유도해, 밸런스 패스가 `OVERCHARGE_*` 를 만지면 이 값이 자동으로 따라오게 한다.
 */
const OVERCHARGE_APEX_TICKS =
  OVERCHARGE_STILL_TICKS + Math.ceil((OVERCHARGE_MAX_BP - OVERCHARGE_BASE_BP) / OVERCHARGE_RAMP_BP);

/** 연속 정지 틱 = `aux0`. 인코딩 표를 지켜 [0, CAP] 정수로 clamp 후 쓴다. */
function setStillTicks(player: Entity, ticks: number): void {
  const t = Math.trunc(ticks);
  player.aux0 = t <= 0 ? 0 : t >= OVERCHARGE_TICK_CAP ? OVERCHARGE_TICK_CAP : t;
}

/** 발동 효과. */
export const ARCCASTER_HANDLERS: ActiveHandlerTable = {
  as_arccaster_chain_lo: (state, player, def, dir) => {
    // 정지하지 않고도 과충전에 **진입**시킨다 — 이 기체 액티브의 핵심 판타지("이동 중 과충전").
    setStillTicks(player, OVERCHARGE_STILL_TICKS);
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
  as_arccaster_chain_hi: (state, player, def, dir) => {
    // 쌓인 정지 틱을 **통째로 방전**한다 — 탄수가 충전량에 비례하고 발동 후 0 이 된다.
    const per = def.coeff.perTicks ?? 1;
    const stored = Math.trunc(player.aux0);
    const count = (def.coeff.base ?? 0) + (per > 0 ? Math.floor(stored / per) : 0);
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      count,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
      { pierce: 1 },
    );
    setStillTicks(player, 0);
  },
  as_arccaster_barrage_lo: (state, player, def, dir) => {
    // 점멸해도 과충전을 잃지 않는다 = 이동 후 `aux0` 의 **하한을 진입 임계로 고정**한다.
    // (이미 그 이상 쌓였으면 그대로 둔다 — 보존이지 리셋이 아니다.)
    blink(state, player, def.coeff.distance ?? 0, dir);
    if (player.aux0 < OVERCHARGE_STILL_TICKS) setStillTicks(player, OVERCHARGE_STILL_TICKS);
  },
  as_arccaster_barrage_hi: (state, player, def, dir) => {
    // 착지 틱에 증폭 상한 도달치로 세운다.
    blink(state, player, def.coeff.distance ?? 0, dir);
    setStillTicks(player, OVERCHARGE_APEX_TICKS);
  },
  as_arccaster_barrier_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setStillTicks(player, player.aux0 + (def.coeff.perTick ?? 0));
  },
  as_arccaster_barrier_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setStillTicks(player, OVERCHARGE_APEX_TICKS);
  },
};

/** 지속 중 매 틱 유지 훅. */
export const ARCCASTER_SUSTAIN: ActiveSustainTable = {
  // 유동 충전 — 움직이는 틱에 `stepShipSignature` 가 `aux0` 를 0 으로 되돌려도, 다음 틱에
  // 다시 perTick 만큼 쌓인다. "움직이면서도 충전이 계속된다".
  as_arccaster_barrier_lo: (_state, player, def) => {
    setStillTicks(player, player.aux0 + (def.coeff.perTick ?? 0));
  },
  // 고정 과충전 — 매 틱 상한 도달치로 되돌려 무엇을 해도 풀리지 않게 한다.
  as_arccaster_barrier_hi: (_state, player) => {
    setStillTicks(player, OVERCHARGE_APEX_TICKS);
  },
};

/** 만료 틱 훅 — 이 기체는 종료 시 별도 전환이 없다(고정이 풀리면 그대로 자연 감쇠). */
export const ARCCASTER_EXPIRE: ActiveExpireTable = {};
