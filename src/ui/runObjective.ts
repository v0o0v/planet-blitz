/**
 * 런 중 **목표·주의 2줄** 파생(사용자 요청 2026-08-04 — "전 행성 침략에서 현재 런의 목표나
 * 조심해야 할 사항을 짧게 안내하는 장치").
 *
 * ## 왜 별도 모듈인가
 * "이번 런에서 무엇을 해야 하는가"는 이미 세 곳에 흩어져 있었다 — 세그먼트 게이트 종류
 * (`bossProgress`), 침공 레이어(`invasionHudState`), 그리고 **모드 규칙 자체**(각 `modes/*.ts`
 * 헤더에만 글로 적혀 있고 화면에는 어디에도 안 나온다). HUD 가 이걸 직접 조립하면 규칙이 두
 * 벌로 갈리므로, `bossProgress`·`invasionProgress` 와 같은 규율로 파생을 여기 한곳에 모으고
 * HUD 는 **이미 번역된 문자열 두 줄**만 받는다.
 *
 * ## 두 줄이 각각 답하는 질문
 *   1줄(objective) — *지금 무엇을 하면 진행되는가.* 게이트 문구 + 진행 카운터.
 *   2줄(caution)   — *무엇 때문에 죽는가.* 평상시엔 **모드 고정 주의**, 위험 조건이 성립한
 *                    프레임에는 **상황 경고**로 갈아 끼운다(`alert=true` → HUD 가 붉게).
 * 보스전에서는 1줄을 숨긴다(`objective=null`) — 그 자리를 보스 체력바가 이미 말하고 있고,
 * 정작 필요한 건 2줄이다.
 *
 * ## 상황 경고의 우선순위
 * 동시에 성립할 수 있으므로 **즉사 위협 > 남은 시간 > 그 외** 순으로 하나만 고른다. 한 줄에
 * 둘을 욱여넣으면 둘 다 안 읽힌다.
 *
 * ## 결정론
 * **읽기 전용 파생**이다 — 상태를 쓰지 않고, RNG 를 소비하지 않으며, `hashWorld` 가 접는 필드를
 * 만들지 않는다. sim 스텝에서 호출되지 않고 렌더 루프가 프레임당 1회 호출한다. 따라서 PvE·침공
 * 해시에 한 바이트도 닿지 않는다(`bossProgress`·`invasionProgress` 와 같은 경계).
 */

import type { WorldState } from '../sim/world.js';
import type { BossProgress } from '../sim/bossProgress.js';
import type { InvasionHudState } from './invasionProgress.js';
import { PLANET_MODE } from '../sim/planetMode.js';
import { shrinkSafeRadius } from '../sim/modes/shrink.js';
import { enemyDefFor } from '../sim/waves.js';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';

/** HUD 목표/주의 2줄 1프레임 분량. 전부 **이미 번역된** 문자열이고 HUD 는 그리기만 한다. */
export interface RunObjectiveState {
  /** 1줄 — 목표 + 진행 카운터. 보스전이면 `null`(보스 체력바가 대신한다). */
  objective: string | null;
  /** 2줄 — 모드 고정 주의, 또는 상황 경고. */
  caution: string;
  /** 2줄이 **상황 경고**인가(HUD 가 붉게 강조). 평상시 고정 주의는 false. */
  alert: boolean;
}

/**
 * 무적 포식자가 이 거리 안으로 들어오면 경고한다(월드 유닛). 포식자의 자발적 접근 하한은
 * 900(`CHASE_PREDATOR_STANDOFF`)이라, 그보다 가깝다는 것은 **플레이어가 스스로 링 안으로
 * 들어갔다**는 뜻이다 — 이 무대의 즉사는 전부 그 상황에서 난다.
 */
export const PREDATOR_WARN_DISTANCE = 620;
/** 침공 총 제한시간이 이 초 이하로 남으면 경고한다. */
export const INVASION_TIME_WARN_SEC = 30;

/** 모드별 고정 주의 문구 키. 침공은 세그먼트 축이 없어 따로 다룬다({@link invasionCaution}). */
const MODE_CAUTION: Readonly<Record<number, MessageKey>> = {
  [PLANET_MODE.vampire]: 'hud.obj.caution.vampire',
  [PLANET_MODE.blockBreak]: 'hud.obj.caution.blockBreak',
  [PLANET_MODE.racing]: 'hud.obj.caution.racing',
  [PLANET_MODE.chase]: 'hud.obj.caution.chase',
  [PLANET_MODE.shrink]: 'hud.obj.caution.shrink',
  [PLANET_MODE.contamination]: 'hud.obj.caution.contamination',
};

/** 침공 레이어별 목표 문구 키(0=L1 대기권 · 1=L2 회랑 · 2=L3 코어방). */
const INVASION_OBJECTIVE: readonly MessageKey[] = [
  'hud.obj.inv0',
  'hud.obj.inv1',
  'hud.obj.inv2',
];

/**
 * 무적 포식자(추격 모드)와 플레이어의 거리. 포식자는 취약화 전(`aux0 === 0`) 접촉이 **회피
 * 불가 즉사**라, 그 한 마리만 본다. 포식자·플레이어 어느 쪽이든 없으면 `Infinity`.
 */
function predatorDistance(world: WorldState): number {
  const player = world.entities[0];
  if (player === undefined || player.dead) return Infinity;
  for (const e of world.entities) {
    if (e.dead || e.kind !== 'boss' || e.aux0 !== 0) continue;
    return Math.hypot(e.x - player.x, e.y - player.y);
  }
  return Infinity;
}

/** 플레이어가 수축 안전 반경 **밖**인가(밖 = 지속 피해, `src/sim/modes/shrink.ts`). */
function outsideSafeRing(world: WorldState): boolean {
  const player = world.entities[0];
  if (player === undefined || player.dead) return false;
  const r = shrinkSafeRadius(world);
  if (!(r > 0)) return false; // 수축 런이 아니면 0 이 온다.
  return Math.hypot(player.x, player.y) > r;
}

/**
 * 지금 아군을 **수복 중인** 적이 있는가. 판정은 sim 이 이미 세우는 상태 그대로다 —
 * `patterns/index.ts` 의 `heal` 분기가 사거리 안에서 실제로 회복시킨 틱에만 `phase = 1` 로
 * 올린다(힐 빔 렌더와 같은 신호). 역할이 아니라 **공격 종류**로 거르므로 행성마다 다른
 * typeIndex(니플헤임 냉기 정비선은 13)에도 그대로 걸린다.
 */
function healerActive(world: WorldState): boolean {
  for (const e of world.entities) {
    if (e.dead || e.kind !== 'enemy' || e.phase !== 1) continue;
    if (enemyDefFor(e)?.attack.kind === 'heal') return true;
  }
  return false;
}

/** 침공 런의 고정 주의(= 하드 제한시간). 레이어와 무관하게 이 한 줄이 이 무대의 실패 조건이다. */
function invasionCaution(inv: InvasionHudState): string {
  if (inv.totalRemainSec <= INVASION_TIME_WARN_SEC) {
    return t('hud.obj.warn.time', { n: Math.ceil(inv.totalRemainSec) });
  }
  return t('hud.obj.caution.invasion');
}

/**
 * 대피소 **도달 알림** 문구(없으면 null). 도달 자체는 sim 이 판정하고(`chaseShelterReached` →
 * 세그먼트 전진), 여기서는 그 결과의 **상승 에지**만 본다 — 렌더러의 방어막 링과 같은 신호를
 * 글로 한 번 말하는 자리다.
 *
 * 순수 함수로 뽑은 이유: 호출부(main 렌더 루프)에 두면 이 판정이 **실시간 플레이로만** 검증
 * 가능해진다(fast-forward 는 렌더 프레임을 건너뛰어 에지를 못 만든다). 조건이 넷이나 되므로
 * (모드·기준선 유무·상승·보스 구간 제외) 규칙 자체는 여기서 잠근다.
 *
 * @param prevSegment 직전 렌더 프레임의 세그먼트 인덱스. `-1` = 기준선 없음(런 시작 직후) →
 *                    알리지 않는다. 새 런의 첫 구간을 "도달"로 오인하지 않기 위한 계약이다.
 */
export function shelterArrivalMessage(
  mode: number,
  prevSegment: number,
  segment: number,
  bossSegment: boolean,
): string | null {
  if (mode !== PLANET_MODE.chase) return null;
  if (prevSegment < 0 || segment <= prevSegment) return null;
  if (bossSegment) return null; // 보스 구간 진입은 그 자체가 큰 연출이라 겹쳐 말하지 않는다.
  return t('hud.obj.shelterReached', { n: segment });
}

/**
 * 이번 프레임의 목표·주의 2줄을 파생한다. `eta`·`inv` 는 호출부가 이미 구한 것을 그대로 받는다
 * (같은 파생을 두 번 돌리지 않는다 — 둘 다 엔티티 순회를 포함한다).
 *
 * - 침공 런(`inv !== null`): 목표 = 레이어 문구, 주의 = 제한시간.
 * - PvE 런: 목표 = 세그먼트 게이트 문구 + 카운터, 주의 = 모드 고정 → 상황 경고.
 * - 보스전(`eta.bossActive`) 또는 세그먼트 축 부재: 목표 `null`.
 */
export function runObjective(
  world: WorldState,
  eta: BossProgress | undefined,
  inv: InvasionHudState | null,
): RunObjectiveState {
  if (inv !== null) {
    const key = INVASION_OBJECTIVE[inv.phase] ?? INVASION_OBJECTIVE[0];
    return {
      objective: t(key as MessageKey),
      caution: invasionCaution(inv),
      alert: inv.totalRemainSec <= INVASION_TIME_WARN_SEC,
    };
  }

  const mode = world.config.planetMode ?? PLANET_MODE.vampire;

  // --- 1줄: 목표 + 진행 카운터 ---------------------------------------------
  let objective: string | null = null;
  if (eta !== undefined && !eta.bossActive) {
    const gate =
      eta.gate === 'kills'
        ? t('hud.bossEta.kills', { n: eta.current, goal: eta.goal })
        : t(`hud.bossEta.${eta.gate}` as MessageKey);
    // 불리언 게이트(대피소·정화·격전…)는 문구만으로는 "몇 번째인지"를 못 말한다 — 구간 카운터를
    // 붙여야 *이걸 하면 진행된다* 가 눈에 보인다. 처치 할당은 이미 제 카운터를 갖고 있다.
    objective =
      eta.gate === 'kills'
        ? gate
        : `${gate} · ${t('hud.obj.count', { n: eta.segment, total: eta.totalSegments })}`;
  }

  // --- 2줄: 상황 경고(우선순위 순) → 없으면 모드 고정 주의 -------------------
  if (mode === PLANET_MODE.chase && predatorDistance(world) <= PREDATOR_WARN_DISTANCE) {
    return { objective, caution: t('hud.obj.warn.predator'), alert: true };
  }
  if (mode === PLANET_MODE.shrink && outsideSafeRing(world)) {
    return { objective, caution: t('hud.obj.warn.outside'), alert: true };
  }
  if (healerActive(world)) {
    return { objective, caution: t('hud.obj.warn.healer'), alert: true };
  }
  const key = MODE_CAUTION[mode] ?? MODE_CAUTION[PLANET_MODE.vampire];
  return { objective, caution: t(key as MessageKey), alert: false };
}
