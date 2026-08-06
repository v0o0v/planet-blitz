/**
 * striker 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/striker.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 — **없다**
 * 이 파일은 `aux0`/`aux1` 을 **읽지도 쓰지도 않는다.** ADR-0049 가 스트라이커에 `signatureBit: 24`
 * (정조준 사이클)를 부여하면서 `aux0` 은 **사이클 진행 카운터**가 됐고, 그 갱신처는 `autoAttack`
 * 의 발사 지점 하나뿐이다 — 액티브가 그 값을 만지면 정조준 주기가 액티브 사용에 따라 흔들리고,
 * 그 축은 설계상 F1(처치)·S1(피격) 둘로 한정돼 있다. 관측량은 전부 aux 밖의 축(투사체 개수 ·
 * 좌표 · 버프 잔여 틱)에서 만든다.
 * (⚠️ 이 절의 종전 문구는 `signatureBit: -1` 을 전제로 쓰였다 — ADR-0049 전의 사실이다.)
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';
import { strikerFirepowerActive, strikerBlinkOrigin } from '../skills/striker.js';

/**
 * F3 과열 배출 — 화력 액티브 발동 틱에 주무기 쿨다운을 환급하고 fanStrike 탄을 증폭한다.
 * 미투자(또는 `skillsOn` 거짓)면 `bp === 0` 이라 **`damage` 가 비트 단위로 종전 값 그대로**다.
 */
function ventBurstDamage(
  state: Parameters<typeof strikerFirepowerActive>[0],
  player: Entity,
  damage: number,
): number {
  const bp = strikerFirepowerActive(state, player);
  return bp === 0 ? damage : damage + Math.round((damage * bp) / 10000);
}

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
      ventBurstDamage(state, player, scaleCenti(def.coeff.damage ?? 0, centi)),
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
      ventBurstDamage(state, player, scaleCenti(def.coeff.damage ?? 0, centi)),
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
    // M1 관성 방출 — **출발 지점**의 폭발·적탄 소거. 도약보다 앞이라 `player.x/y` 가 곧 출발점이다.
    strikerBlinkOrigin(state, player);
    blink(state, player, def.coeff.distance ?? 0, dir);
  },
  as_striker_mobility_hi: (state, player, def, dir) => {
    // 2단 도약. 단마다 벽 슬라이드가 걸리므로 900 을 한 번에 미는 것보다 관통에 안전하다.
    //
    // ⚠️ M8(도약 사격)은 여기 **없다** — "단 사이에 정조준 볼리 1회" 를 하려면 `autoAttack` 의
    // 발사 경로를 불러야 하는데 그것은 `world.ts` 비공개이고, 이 파일이 leaf 라 런타임 import 가
    // 계약 위반이다(`fanStrike` 로 흉내 내면 주무기 볼리와 다른 탄이 나가 설계가 갈린다).
    const vaults = def.coeff.vaults ?? 1;
    // M1 은 **출발 지점 하나**라 루프 밖에서 한 번만 부른다(단마다 부르면 폭발이 도약 수만큼 난다).
    strikerBlinkOrigin(state, player);
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
