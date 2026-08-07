/**
 * 해츨링 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/hatchling.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1814` 인코딩 표)
 * `aux0` = 마지막 출격 시점의 `state.kills` 스냅샷 · `aux1` = **미사용(0)**.
 * 출격 판정이 `state.kills − aux0 >= hatchThreshold(state.kills)` 이므로,
 *  · `aux0` 을 **낮추면**(과거로 밀면) 다음 부화가 앞당겨지고,
 *  · `aux0 = state.kills` 로 **당기면** 쌓인 부화 진행도가 소각된다.
 * `aux1` 은 이 기체에서 의미가 없으므로 **건드리지 않는다**(인코딩 표 준수).
 *
 * ⚠️ **이 6종은 아무것도 소환하지 않는다**(Non-Goal ① 설치물·소환물 금지). 병아리 출격은
 * 시그니처 패시브가 원래 하던 일이고 여기서는 그 **타이밍만** 옮긴다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import { HATCH_BASE_KILLS, HATCH_MAX_KILLS, HATCH_STEP_KILLS } from '../shipSignature.js';
import type { Entity } from '../entities.js';
import { blink, fanStrike, powerCentiOf, scaleCenti, setBuffTicks } from '../activeTypes.js';
import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';
// 30스킬 본체는 `skills/hatchling.ts` 소유다 — 핸들러는 **부르기만** 한다(선례:
// `activeHandlers/striker.ts`). 투자 게이트도 그 안에 있어 미투자 런은 비트 동일이다.
import {
  hatchlingBroodActive,
  hatchlingNurtureActive,
  hatchlingShelterSustain,
} from '../skills/hatchling.js';

/**
 * 부화 스냅샷(`aux0`)을 `by` 만큼 **과거로** 민다 = 다음 부화를 그만큼 앞당긴다.
 * 스냅샷은 비음 정수여야 한다(음수면 `state.kills − aux0` 이 실제 처치 수보다 커진다).
 */
function advanceHatch(player: Entity, by: number): void {
  const next = Math.trunc(player.aux0) - Math.trunc(by);
  player.aux0 = next > 0 ? next : 0;
}

/** 발동 효과. */
export const HATCHLING_HANDLERS: ActiveHandlerTable = {
  as_hatchling_brood_lo: (state, player, def, dir) => {
    const centi = powerCentiOf(state, def);
    fanStrike(
      state,
      player,
      def.coeff.base ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
    );
    // 요구치 상한 한 벌 분량만큼 스냅샷을 과거로 — 다음 부화가 크게 앞당겨진다.
    advanceHatch(player, HATCH_MAX_KILLS);
    // BD8 브루드 강습 — 살아 있는 병아리 전원 즉시 격발(같은 틱의 `stepTurrets` 가 쏜다).
    hatchlingBroodActive(state);
  },
  as_hatchling_brood_hi: (state, player, def, dir) => {
    // 반대 방향 거래 — 스냅샷을 현재 누적으로 당겨 부화 진행도를 **소각**하고 지금 탄막을 산다.
    player.aux0 = Math.trunc(state.kills);
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
    hatchlingBroodActive(state);
  },
  as_hatchling_nurture_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    advanceHatch(player, HATCH_STEP_KILLS);
    // NU4 둥지 소집 — **반드시 `blink` 뒤**다(설계의 "도착 지점" = 이동 후 좌표).
    hatchlingNurtureActive(state, player);
  },
  as_hatchling_nurture_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    advanceHatch(player, HATCH_BASE_KILLS);
    hatchlingNurtureActive(state, player);
  },
  as_hatchling_shelter_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    // 발동 틱에도 한 칸 앞당긴다 — 지속 훅만으로는 첫 틱에 아무 일도 일어나지 않는다.
    advanceHatch(player, 1);
  },
  as_hatchling_shelter_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    player.aux0 = 0; // 임계 상시 충족(스냅샷이 0 이면 `state.kills` 전량이 카운터가 된다).
  },
};

/** 지속 중 매 틱 유지 훅. */
export const HATCHLING_SUSTAIN: ActiveSustainTable = {
  as_hatchling_shelter_lo: (state, player, def) => {
    // `period` 틱마다 한 칸씩 앞당긴다. 주기 판정을 `state.tick` 으로 하는 이유: 지속 훅에는
    // 슬롯이 넘어오지 않아 잔여 틱 필드를 특정할 수 없고, `state.tick` 은 결정론적 정수다.
    const period = def.coeff.period ?? 30;
    if (period > 0 && state.tick % period === 0) advanceHatch(player, 1);
    // SH4 품기 진형 — 두 shelter 액티브 **둘 다** 이 스킬의 "지속 중"이다(설계 SH4 본문:
    // "shelter 액티브 지속 중"). 사격 정지 절반은 `onTurretCadence` 가 `state.activeBuff0/1`
    // 을 직접 읽어 판정하므로 여기서 별도 표식을 세울 필요가 없다 — 밀착(좌표)만 담당한다.
    hatchlingShelterSustain(state, player);
  },
  as_hatchling_shelter_hi: (state, player) => {
    player.aux0 = 0;
    hatchlingShelterSustain(state, player);
  },
};

/** 만료 틱 훅 — 해츨링 6종은 종료 시 별도 전환이 없다(타이밍 조작만이 축이다). */
export const HATCHLING_EXPIRE: ActiveExpireTable = {};
