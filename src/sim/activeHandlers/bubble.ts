/**
 * 버블 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/bubble.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1816` 인코딩 표)
 * `aux0` = 남은 막 내구(0..`FILM_ABSORB_FLAT`) · `aux1` = 마지막 파열 이후 경과 틱.
 * world 배선의 재생 규칙은 **`aux0 === 0` 일 때만 `aux1` 이 돌고, `FILM_PERIOD_TICKS` 에서
 * 막이 다시 선다** 이다. 그래서 이 6종의 조작은 정확히 두 축이다:
 *  · `aux0` — 막을 **터뜨리거나**(0) **세운다**(`FILM_ABSORB_FLAT`), 혹은 탄약으로 환산한다.
 *  · `aux1` — 7초 재생 주기를 **건너뛴다**(주입).
 *
 * 파열 밀어내기는 `world.ts` 의 `burstFilm` 과 같은 규칙을 쓴다 — 적 속도(`vx`/`vy`)는 이동
 * 컴포넌트가 매 틱 덮어쓰므로 **좌표를 직접 옮기는 1회 변위**여야 관측 가능하다
 * (`FILM_BURST_PUSH_TICKS` 주석). world 는 런타임 import 가 금지(순환)라 leaf 인
 * `shipSignature.js` · `los.js` 만 쓰고 같은 산술을 여기서 재현한다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import {
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
  FILM_PERIOD_TICKS,
  filmBurstPush,
} from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { slideCircleWalls } from '../los.js';
import {
  blastDamage,
  blink,
  fanStrike,
  powerCentiOf,
  scaleCenti,
  setBuffTicks,
} from '../activeTypes.js';
import type { WorldState } from '../world.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/** 재생 타이머(`aux1`)를 주기 상한 안에서 앞당긴다. */
function advanceRecharge(player: Entity, by: number): void {
  const next = Math.trunc(player.aux1) + Math.trunc(by);
  player.aux1 = next > FILM_PERIOD_TICKS ? FILM_PERIOD_TICKS : next;
}

/**
 * 막 파열의 밀어내기 — 반경 안의 적을 **좌표 변위**로 밖으로 민다(`burstFilm` 과 동일 산술).
 * 민 직후 벽 충돌을 즉시 재해결한다: 변위(260)가 벽 두께보다 커서 그냥 두면 적이 벽 안쪽에
 * 박히고, 다음 틱 슬라이드가 반대편으로 튕겨 내는 조용한 배치 계약 위반이 된다.
 */
function pushBurst(state: WorldState, player: Entity, radius: number): void {
  const push = filmBurstPush();
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    // 플레이어와 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다.
    if (d <= 1) continue;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
    if (state.activeWalls.length > 0) {
      const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
      e.x = slid.x;
      e.y = slid.y;
    }
  }
}

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
    pushBurst(state, player, FILM_BURST_RADIUS);
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
    pushBurst(state, player, FILM_BURST_RADIUS);
    player.aux0 = 0;
    player.aux1 = 0;
  },
};
