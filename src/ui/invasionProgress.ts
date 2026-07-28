/**
 * 침공 진행 HUD 파생(사용자 요청 2026-07-29 — "침공마다 진행사항을 HUD 에 표시").
 *
 * ## 왜 별도 모듈인가
 * 침공 런에서 "지금 어디까지 왔고 얼마나 남았는가"는 sim 안에 **연속량으로 존재하지 않는다** —
 * 페이즈 머신(`src/sim/invasion/phase.ts`)은 전이 여부라는 불리언만 내고, 진척은 스크롤 오프셋과
 * 예산 틱의 차로만 암시된다. HUD 가 그걸 직접 읽으면 축 규칙(L1=Y·L2=X·L3=코어 HP)이 뷰에
 * 복제되므로, `src/sim/bossProgress.ts` 와 같은 규율로 파생을 여기 한곳에 모으고 HUD 는
 * 숫자만 받는다({@link Hud.setInvasion}).
 *
 * ## 결정론
 * **읽기 전용 파생**이다 — 상태를 쓰지 않고, RNG 를 소비하지 않으며, `hashWorld` 가 접는 필드를
 * 만들지 않는다. sim 스텝에서 불리지 않고 렌더 루프가 프레임당 1회 호출한다. 따라서 침공 해시·
 * 거동은 한 바이트도 닿지 않는다.
 *
 * ## 방어 잔존 수의 엔티티 kind — 스폰 코드에서 확정한 것(추측 아님)
 *   - **설비**: `facilityGun` · `facilityHazard` · `facilitySpawner`
 *     (src/sim/invasion/facility.ts:93-97 상수 선언, :259 `isFacility`). 술어를 그대로 재사용한다.
 *     ⚠️ 압축 프레스(`fac.press`)만 예외다 — 설비 엔티티가 아니라 **이동 벽**으로 스폰돼
 *     (facility.ts:299 `spawnMovingWall`) 파괴 자체가 불가능하다. 그래서 잔존 수에 애초에 들어오지
 *     않는 것이 맞다(`facilityTriggerState` 가 배치 수를 셀 때 같은 이유로 제외한다, facility.ts:450).
 *   - **수호**: `guardian` (src/sim/invasion/guardian.ts:109 `blankEntity('guardian')`,
 *     src/sim/invasion/guardianBridge.ts:81 `spawnInvasionGuardians`).
 *   - **기물**: `prop` 과, 기만 홀로그램만 쓰는 `decoyCore`
 *     (src/sim/invasion/coreRoom.ts:98-115 kind 선언, :262 스폰 분기). kind 비교 하나로는 홀로그램이
 *     새므로 정본 술어 `isPlacedProp`(coreRoom.ts:123)을 쓴다 — 그 술어가 코어 모듈 유니크의
 *     신기루 코어(`enemyType === -1`)까지 걸러 준다.
 *   - **적**: `enemy` (src/sim/waves.ts:394-395 `summonEnemy` — 침공 편대가 쓰는 유일한 스폰 경로,
 *     src/sim/invasion/formation.ts:364. 스포너 설비의 사출 드론도 같은 kind 다).
 */

import type { WorldState } from '../sim/world.js';
import type { Entity } from '../sim/entities.js';
import { INVASION_LAYER_TICKS, PHASE_L1, PHASE_L2 } from '../sim/invasion/constants.js';
import { layerLength } from '../sim/invasion/scroll.js';
import { isFacility } from '../sim/invasion/facility.js';
import { isPlacedProp, DEFENSE_BOSS_KIND } from '../sim/invasion/coreRoom.js';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';

/** 1초 = 60틱. 예산은 전부 틱이고 표시는 초라 여기서만 환산한다. */
const TICKS_PER_SECOND = 60;

/** 게이지 1개 분량의 체력(현재/최대). */
export interface InvasionHudBar {
  hp: number;
  maxHp: number;
}

/**
 * 침공 진행 HUD 1프레임 분량. 전부 **이미 파생·번역된 값**이고 HUD 는 그리기만 한다
 * (`RunInfoState` 와 같은 규율 — HUD 는 순수 뷰).
 */
export interface InvasionHudState {
  /** 현재 레이어 코드(0=L1 대기권 · 1=L2 회랑 · 2=L3 코어방). */
  phase: 0 | 1 | 2;
  /** 이미 번역된 레이어 문구(예: `L2 · 회랑 돌파`). */
  layerLabel: string;
  /** 현재 레이어 주파율 0..1 (L3 = 코어 파괴 진행도). */
  layerFraction: number;
  /** 현재 레이어 soft 예산 잔여 초(0 하한). */
  layerRemainSec: number;
  /** 총 제한시간(hard) 잔여 초(0 하한). */
  totalRemainSec: number;
  /** L3 코어(없으면 undefined). */
  core?: InvasionHudBar | undefined;
  /** L3 방어 보스(없으면 undefined). */
  boss?: InvasionHudBar | undefined;
  /** 방어 측 잔존 요약(라이브 엔티티 수). */
  defense: { facilities: number; guardians: number; props: number; enemies: number };
}

/** 0..1 로 자른다(스크롤이 레이어 길이를 넘겨도 게이지가 넘치지 않게). */
function clamp01(v: number): number {
  if (!(v > 0)) return 0; // NaN 도 여기로 떨어진다(길이 0 나눗셈 방어)
  return v > 1 ? 1 : v;
}

/** 틱 → 초(0 하한). 예산이 이미 소진된 프레임에서 음수 시간이 뜨지 않게 자른다. */
function remainSec(budgetTicks: number, elapsedTicks: number): number {
  const left = budgetTicks - elapsedTicks;
  return left > 0 ? left / TICKS_PER_SECOND : 0;
}

/**
 * 현재 레이어 주파율.
 *
 * 축이 페이즈마다 갈린다 — L1 은 `-scrollY`(위로 올라간다), L2 는 `scrollX`(오른쪽으로 민다).
 * 분모는 `layerLength(phase)` 다(src/sim/invasion/scroll.ts). L3 은 고정 카메라라 스크롤 축이
 * 아예 없으므로(`SCROLL_AXIS_NONE`, 그래서 `layerLength` 가 0 이다) **코어 HP 소모율**을
 * 진행률로 삼는다 — L3 에서 플레이어가 실제로 미는 축이 그것뿐이다.
 */
function layerFractionOf(
  phase: number,
  scrollX: number,
  scrollY: number,
  core: Entity | undefined,
): number {
  if (phase === PHASE_L1 || phase === PHASE_L2) {
    const len = layerLength(phase);
    if (len <= 0) return 0;
    return clamp01((phase === PHASE_L1 ? -scrollY : scrollX) / len);
  }
  // L3: 코어가 아직 없거나 maxHp 가 0 이면 0(진행 없음)으로 둔다.
  if (core === undefined || core.maxHp <= 0) return 0;
  return clamp01(1 - core.hp / core.maxHp);
}

/**
 * 침공 진행 HUD 상태를 파생한다. **침공 런이 아니면 `null`** 이고 호출부(HUD)는 패널을 감춘다 —
 * 0% 로 굳은 가짜 게이지를 보여주지 않는다(`bossProgress` 의 침공 처리와 대칭).
 */
export function invasionHudState(world: WorldState): InvasionHudState | null {
  const config = world.config.invasion3;
  const runtime = world.invasion3;
  if (config === undefined || runtime === undefined) return null;

  // 엔티티 1회 순회로 게이지·요약을 함께 뽑는다(프레임당 1회 — HUD 갱신과 같은 주기).
  let core: Entity | undefined;
  let boss: Entity | undefined;
  let facilities = 0;
  let guardians = 0;
  let props = 0;
  let enemies = 0;
  for (const e of world.entities) {
    if (e.dead) continue;
    if (e.kind === 'core') {
      if (core === undefined) core = e;
    } else if (e.kind === DEFENSE_BOSS_KIND) {
      if (boss === undefined) boss = e;
    } else if (e.kind === 'enemy') enemies++;
    else if (e.kind === 'guardian') guardians++;
    else if (isFacility(e)) facilities++;
    else if (isPlacedProp(e)) props++;
  }

  const phase = (runtime.phase < 0 ? 0 : runtime.phase > 2 ? 2 : runtime.phase) as 0 | 1 | 2;
  const elapsedInLayer = world.tick - runtime.phaseEnterTick;
  return {
    phase,
    layerLabel: t(`hud.inv.layer${phase}` as MessageKey),
    layerFraction: layerFractionOf(phase, runtime.scrollX, runtime.scrollY, core),
    layerRemainSec: remainSec(
      INVASION_LAYER_TICKS[phase] ?? 0,
      elapsedInLayer > 0 ? elapsedInLayer : 0,
    ),
    totalRemainSec: remainSec(config.timeLimitTicks, world.tick),
    core: core === undefined ? undefined : { hp: core.hp, maxHp: core.maxHp },
    boss: boss === undefined ? undefined : { hp: boss.hp, maxHp: boss.maxHp },
    defense: { facilities, guardians, props, enemies },
  };
}
