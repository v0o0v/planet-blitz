/**
 * 버블 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/bubble.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (인코딩 표 정본 = `src/sim/world.ts` 의 `stepShipSignature` 머리 주석)
 * `aux0` = 남은 막 내구(0..`FILM_ABSORB_FLAT`) · `aux1` = 마지막 파열 이후 경과 틱.
 * world 배선의 재생 규칙은 **`aux0 === 0` 일 때만 `aux1` 이 돌고, `FILM_PERIOD_TICKS` 에서
 * 막이 다시 선다** 이다. 그래서 이 6종의 조작은 정확히 두 축이다:
 *  · `aux0` — 막을 **터뜨리거나**(0) **세운다**(`FILM_ABSORB_FLAT`), 혹은 탄약으로 환산한다.
 *  · `aux1` — 7초 재생 주기를 **건너뛴다**(주입).
 *
 * 파열 밀어내기는 **여기서 재현하지 않는다**(E3). 예전에는 world 를 런타임 import 할 수 없어
 * 같은 산술을 이 파일에 베껴 뒀지만, 지금은 leaf 모듈 `src/sim/filmBurst.ts` 가 그 산술의 유일한
 * 정본이고 world 와 이 파일이 **같은 함수**를 쓴다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import { FILM_ABSORB_FLAT, FILM_BURST_RADIUS, FILM_PERIOD_TICKS } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { requestFilmBurst } from '../filmBurst.js';
import {
  blastDamage,
  blink,
  fanStrike,
  powerCentiOf,
  scaleCenti,
  setBuffTicks,
} from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/** 재생 타이머(`aux1`)를 주기 상한 안에서 앞당긴다. */
function advanceRecharge(player: Entity, by: number): void {
  const next = Math.trunc(player.aux1) + Math.trunc(by);
  player.aux1 = next > FILM_PERIOD_TICKS ? FILM_PERIOD_TICKS : next;
}

/**
 * ⚠️ **여기 있던 `pushBurst` 는 삭제됐다**(E3) — `world.ts` 의 `burstFilm` 과 같은 산술을 손으로
 * 베낀 두 번째 사본이었고, 둘은 이미 표기가 갈라지고 있었다. 지금은 핸들러가 파열을 직접
 * 수행하지 않고 `requestFilmBurst` 로 **요청만 세우며**, `stepWorld` 가 `stepActives` 직후
 * `consumeFilmBurstRequests` 로 한 번에 해소한다. 실제 밀어내기는 leaf 모듈
 * `src/sim/filmBurst.ts` 의 `resolveFilmBurst` 하나뿐이다(world 도 같은 함수를 부른다).
 *
 * 좌표를 요청에 실어 보내는 이유: 같은 틱의 다른 슬롯이 `blink` 로 플레이어를 옮겨도 파열
 * 중심이 끌려가지 않게 하려는 것이다(현행 "그 자리에서 즉시" 거동 보존).
 */

/** 발동 효과. */
export const BUBBLE_HANDLERS: ActiveHandlerTable = {
  as_bubble_pop_lo: (state, player, def, dir) => {
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      def.coeff.base ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
    );
    // 강제 파열 — 막을 터뜨리고 재생 타이머를 0 부터 다시 돌린다.
    requestFilmBurst(state, player.x, player.y);
    player.aux0 = 0;
    player.aux1 = 0;
  },
  as_bubble_pop_hi: (state, player, def, dir) => {
    // 남은 내구를 통째로 탄약으로 환산한다(내구가 클수록 탄이 많다).
    const film = Math.max(0, Math.trunc(player.aux0));
    const per = def.coeff.perFilm ?? 1;
    const count = (def.coeff.base ?? 0) + (per > 0 ? Math.floor(film / per) : 0);
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
    player.aux0 = 0;
  },
  as_bubble_drift_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    advanceRecharge(player, def.coeff.rechargeTicks ?? 0);
  },
  as_bubble_drift_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    // 주기 전량 — 착지 즉시 `filmReady` 가 참이 되어 다음 시그니처 틱에 막이 다시 선다.
    player.aux1 = FILM_PERIOD_TICKS;
  },
  as_bubble_film_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    player.aux0 = FILM_ABSORB_FLAT; // 즉시 만재.
  },
  as_bubble_film_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    player.aux0 = FILM_ABSORB_FLAT;
  },
};

/** 지속 중 매 틱 유지 훅. */
export const BUBBLE_SUSTAIN: ActiveSustainTable = {
  as_bubble_film_lo: (_state, player, def) => {
    // 막이 서 있는 동안에는 world 배선이 타이머를 돌리지 않으므로, 가속분을 여기서 얹는다.
    advanceRecharge(player, def.coeff.perTick ?? 0);
  },
  as_bubble_film_hi: (_state, player) => {
    player.aux0 = FILM_ABSORB_FLAT; // 매 틱 만재로 되돌린다(불멸 막).
  },
};

/** 만료 틱 훅 — 불멸 막이 끝나는 순간 크게 터진다. */
export const BUBBLE_EXPIRE: ActiveExpireTable = {
  as_bubble_film_hi: (state, player, def) => {
    const centi = powerCentiOf(state, def);
    blastDamage(state, player, FILM_BURST_RADIUS, scaleCenti(def.coeff.blastDamage ?? 0, centi));
    requestFilmBurst(state, player.x, player.y);
    player.aux0 = 0;
    player.aux1 = 0;
  },
};
