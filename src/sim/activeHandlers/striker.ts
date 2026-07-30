/**
 * striker 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/striker.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 — **없다**
 * 스트라이커는 `signatureBit: -1` 이라 `stepShipSignature` 가 한 줄도 실행되지 않는다. 그래서
 * 이 파일은 `aux0`/`aux1` 을 **읽지도 쓰지도 않는다** — 건드리면 시그니처 없는 런의 해시가
 * 갈려 기존 골든(W0·denoFixture·invasionHash)이 통째로 깨진다. 관측량은 전부 aux 밖의 축
 * (투사체 개수 · 좌표 · 버프 잔여 틱)에서 만든다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/**
 * 무적 유지 — 매 틱 무적 프레임을 다시 세운다.
 *
 * `stepPlayer` 가 `iframes` 를 매 틱 1 감소시키므로, 지속형 무적은 "한 번 크게 세우기"가 아니라
 * **매 틱 재설정**이어야 버프 종료와 동시에 정확히 풀린다(큰 값을 한 번 세우면 버프가 끝난
 * 뒤에도 무적이 남는다).
 */
function refreshIframes(player: Entity, ticks: number): void {
  if (player.iframes < ticks) player.iframes = ticks;
}

/** 발동 효과. */
export const STRIKER_HANDLERS: ActiveHandlerTable = {
  as_striker_firepower_lo: (state, player, def, dir) => {
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
  as_striker_firepower_hi: (state, player, def, dir) => {
    // 확산 360° — 발동 방향은 위상 기준점으로만 남고 사실상 전 방향 일제 사격이 된다.
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
  as_striker_survival_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    refreshIframes(player, def.coeff.iframes ?? 0);
  },
  as_striker_survival_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    refreshIframes(player, def.coeff.iframes ?? 0);
  },
  as_striker_mobility_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
  },
  as_striker_mobility_hi: (state, player, def, dir) => {
    // 2단 도약. 단마다 벽 슬라이드가 걸리므로 900 을 한 번에 미는 것보다 관통에 안전하다.
    const vaults = def.coeff.vaults ?? 1;
    for (let i = 0; i < vaults; i++) blink(state, player, def.coeff.distance ?? 0, dir);
  },
};

/** `kind='buff'` 지속 중 매 틱 유지 훅 — 무적 프레임을 계속 다시 세운다. */
export const STRIKER_SUSTAIN: ActiveSustainTable = {
  as_striker_survival_lo: (_state, player, def) => {
    refreshIframes(player, def.coeff.iframes ?? 0);
  },
  as_striker_survival_hi: (_state, player, def) => {
    refreshIframes(player, def.coeff.iframes ?? 0);
  },
};

/** 만료 틱 훅 — 긴 무적이 끝나는 순간 선체를 일부 회복한다. */
export const STRIKER_EXPIRE: ActiveExpireTable = {
  as_striker_survival_hi: (state, player, def) => {
    const centi = powerCentiOf(state, def);
    const heal = scaleCenti(def.coeff.heal ?? 0, centi);
    player.hp = Math.min(player.maxHp, player.hp + heal);
  },
};
