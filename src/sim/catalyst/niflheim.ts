/**
 * 촉매 **니플헤임 특산**(id 36~38) — 추격·탈출(`PLANET_MODE.chase`)을 비트는 셋.
 *
 * ## 왜 그룹마다 파일을 가르는가
 * 카드 45종을 **병렬 레인이 동시에** 채운다. 한 파일이면 레인마다 같은 함수를 만져 **매 머지가
 * 충돌**하고, 충돌 해소가 사람 손이라 조용한 유실이 생긴다. 그룹 = 카드 묶음 하나라 레인
 * 하나가 파일 하나를 통째로 소유한다. 공용 술어·해저드 규약은 {@link file://./shared.ts} 다.
 *
 * ⚠️ 이 모듈은 `world.js` 를 **type-only** 로만 import 한다(순환 금지). 값이 필요하면
 * `catalystHooks.ts` 가 인자로 넘겨라.
 *
 * ⚠️ 카드 분기는 반드시 {@link carries}`(state, CARD_*)` 게이트 **안쪽**이어야 한다 —
 * `state.catalystOn` 만으로 켜면 아무 촉매 한 장에 그룹 전체가 발동한다.
 *
 * ## ⭐ 이 그룹이 지고 있는 계약 넷 (전부 실측 사고에서 왔다)
 *  1. **`boss` kind 를 늘리지 않는다.** `world.ts` 는 boss kind 하나가 죽으면 그 자리에서 런
 *     승리로 잡는다 — 그림자(`id 36`)도 기함(`id 38`)도 **일반 적 kind + 센티넬 마커**다.
 *  2. **포식자를 남긴다.** 초판 `id 38` 은 포식자를 기함으로 **대체**해 추격 모드의 정체성을
 *     교체했다. 기함은 포식자 **위에** 얹힌다.
 *  3. **진행 게이트를 물리적으로 제거하지 않는다.** 마지막 일반 세그먼트는 대피소 **전량
 *     (10개)** 을 요구한다(`chase.ts` `chaseShelterMilestone` = `ceil(N(i+1)/n)`). 그래서
 *     기함이 부순 대피소는 **자원이 0 이어도 반드시 스스로 복구**된다({@link FLAGSHIP_REPAIR_TICKS}).
 *  4. **그림자 제외는 3목록이 한 쌍이다** — 피해 게이트 · `isPlayerTargetable` · `countEnemies`.
 *     셋 다 이미 `catalyst/shared.ts` 의 {@link isCatalystShadow} 한 술어를 보고 있으므로
 *     이 파일은 **마커를 세우기만** 한다(세 자리는 이미 배선돼 있다 — 아래 §그림자 참조).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL, carries, isCatalystHazard, spawnCatalystHazard } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { readMark, writeMark } from '../catalystMarks.js';
import { FlagshipSlot, PursuitSlot, readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';
import { summonEnemy } from '../waves.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import { PLANET_MODE } from '../planetMode.js';
import { CHASE_SHELTER_RADIUS, isShelter, isShelterSecured } from '../modes/chase.js';

/** id 36 — slug `niflheim-pursuit`. 정본은 `src/data/catalysts.ts`. */
export const CARD_NIFLHEIM_PURSUIT = 36;

/** id 37 — slug `niflheim-rime-crystal`. 정본은 `src/data/catalysts.ts`. */
export const CARD_NIFLHEIM_RIME_CRYSTAL = 37;

/** id 38 — slug `niflheim-flagship`. 정본은 `src/data/catalysts.ts`. */
export const CARD_NIFLHEIM_FLAGSHIP = 38;

// ---------------------------------------------------------------------------
// 공용 — 이 그룹이 서는 무대인가
// ---------------------------------------------------------------------------

/**
 * 지금이 추격 런인가. 셋 다 추격 모드 전용이라 **모드 게이트가 카드 게이트와 한 쌍**이다 —
 * 특산은 그 행성 런에만 꽂히지만(`consume_catalysts` 게이트), sim 은 그것을 신뢰하지 않는다.
 * 다른 무대에서 켜지면 대피소·포식자가 없어 조용한 무연산이 아니라 **엉뚱한 스폰**이 된다.
 */
function isChaseRun(state: WorldState): boolean {
  return state.config.planetMode === PLANET_MODE.chase;
}

/** 니플헤임 적 정의 하나(typeIndex 10~15 구간의 첫 칸). 없으면 소환을 통째로 건너뛴다. */
function niflheimEnemyDef(): (typeof ENEMY_BY_TYPE)[number] | undefined {
  return ENEMY_BY_TYPE[10] ?? ENEMY_BY_TYPE[0];
}

/** 원-원 겹침(브로드페이즈 없이 쓰는 정확 판정). */
function overlaps(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

// ---------------------------------------------------------------------------
// id 36 niflheim-pursuit — 포식자가 네 그림자를 남긴다
// ---------------------------------------------------------------------------
//
// ## ⭐ 그림자를 "죽일 수 없게" 만드는 칸이 없다 — 그래서 마커다
// 적 무적의 유일한 선례 `t.iframes > 0` 은 화염 DoT 가 점유했다. 그림자는 `aux0` 의
// `shadow` 비트로 표시하고, 그 비트를 **셋이 같이** 본다(등재와 제외는 한 쌍 — 헌장):
//
//  | 자리 | 파일 | 안 하면 |
//  |---|---|---|
//  | ① 피해 게이트 | `world.ts` 아군탄 명중 루프 · `catalystHooks.ts` `stepCatalystHazards` | 그림자가 죽는다(카드가 사라진다) |
//  | ② `isPlayerTargetable` | `world.ts` | **자동조준이 죽일 수 없는 그림자를 물어 런이 통째로 망가진다**(`objective.ts` 헤더 §결함 #3, 당시 클리어율 18.6%) |
//  | ③ `countEnemies` | `waves.ts` | 웨이브 적 예산을 잠식해 실제 적이 안 나온다 |
//
// **셋 다 이미 `isCatalystShadow` 를 부르고 있다.** 이 파일이 하는 일은 마커를 세우는 것뿐이다.
// ⚠️ **격자 등록은 그대로 둔다** — 빼면 접촉·픽업까지 사라져 "무적인 적"이 아니라 "없는 적"이
// 된다(같은 사유가 `isCatalystProspectShielded` 주석에 있다).
//
// ## 경로 큐는 **해저드 부스러기**가 든다 — 새 `WorldState` 칸이 0 인 이유
// *"지나온 경로를 그대로"* 를 성립시키려면 좌표 이력이 필요한데, 모듈 레벨 스크래치는 틱을
// 넘기는 순간 두 월드가 교대로 `stepWorld` 되는 재현성 검증에서 서로를 오염시킨다
// (`determinismGate` 가 정확히 그 형태로 돈다). 그래서 이력을 **엔티티가 든다**:
// {@link PURSUIT_CRUMB_TICKS} 마다 플레이어 자리에 **피해 0 짜리 촉매 해저드**를 하나 떨구고,
// 그림자는 그중 **가장 오래된 것**(= `state.entities` 배열 순서상 앞의 것)으로 걸어가 닿으면
// 그것을 지우고 다음으로 간다. 폴리라인을 그대로 밟는다.
//
// 부스러기가 **적이 아니라 해저드**인 것이 핵심이다 — 적이면 위 3목록을 부스러기에도 전부
// 걸어야 하고, 하나만 빠뜨려도 그 부류의 결함이 되돌아온다. 해저드는 조준·적 수 어디에도
// 원래 안 들어간다. 그리고 피해 0 이라 `catalystHazardDamaging` 이 거짓이므로
// `stepCatalystHazards` 의 공용 루프도 이것을 건너뛴다(밟아도 아무 일이 없다).
//
// 슬롯 두 칸(`PathHead`/`PathCount`)은 **큐의 진행 상태만** 든다(좌표는 안 든다).

/** 부스러기를 떨구는 간격(틱). 0.4초마다 한 점 — 12칸 상한과 곱해 약 5초짜리 궤적이 남는다. */
const PURSUIT_CRUMB_TICKS = 24;

/**
 * 이 카드가 쓰는 부스러기 동시 상한. 촉매 해저드 전체 상한이 12
 * ({@link import('./shared.js').CATALYST_HAZARD_LIVE_CAP})인데 니플헤임에서는 `id 37` 서리 궤적이
 * 같은 통을 쓰므로 **8 로 스스로 자른다** — 안 자르면 궤적이 통을 다 먹어 서리가 한 장도 못 깔린다.
 */
const PURSUIT_TRAIL_CAP = 8;

/** 부스러기 수명(틱). 상한에 걸려 못 생긴 자리를 오래 남은 옛 점이 막지 않도록 유한하게 둔다. */
const PURSUIT_CRUMB_LIFE = 600;

/** 부스러기 반경(그림자 도착 판정 · 렌더 궤적선). */
const PURSUIT_CRUMB_RADIUS = 40;

/** 그림자 이동 속도(u/s). 플레이어 기본 720 보다 **느리다** — 따돌릴 수 있어야 카드가 성립한다. */
const PURSUIT_SHADOW_SPEED = 600;

/** 그림자가 이 반경 안에 있으면 "따돌리지 못한" 것이라 대피소 적립이 없다. */
const PURSUIT_SHADOW_CLEAR_RADIUS = 520;

/** 그림자를 따돌린 채 확보한 대피소 하나가 주는 자원. */
const PURSUIT_SHELTER_RESOURCE = 24;

/**
 * 대피소 확보 반경 **배수** — *"대피소 확보 속도가 두 배"* 의 코드 축.
 *
 * ⚠️ **설계 정본과 코드가 어긋난 자리다(고치지 않고 보고).** 확보는 `updateChaseShelters` 에서
 * 겹치는 순간 `aux1 = 1` 로 **즉발**이라 "확보 속도"라는 축이 코드에 없다. 이 무대에서 확보에
 * 실제로 드는 것은 **거기까지 가는 이동 시간**이므로, 그것을 절반으로 만드는 유일한 기존 노브가
 * 도달 반경이다. 그래서 반경을 2배로 넓힌다 — 확보 자체는 여전히 `chase.ts` 가 소유하고
 * 이 파일은 **추가 경로**만 얹는다(원래 판정을 지우지 않는다).
 */
const PURSUIT_SHELTER_RADIUS_MULT = 2;

/** 이 해저드가 `id 36` 의 경로 부스러기인가. 단발(`phase === 0`) + 피해 0 이 판별자다. */
function isPursuitCrumb(e: Entity): boolean {
  return !e.dead && isCatalystHazard(e) && e.phase === 0 && e.damage === 0;
}

/** 이 적이 그림자인가. `shared.ts` 의 `isCatalystShadow` 와 같은 비트를 본다. */
function isShadow(e: Entity): boolean {
  return !e.dead && e.kind === 'enemy' && readMark(e, 'shadow') !== 0;
}

/**
 * `id 36` 한 틱 — 부스러기 적재 · 그림자 소환/이동 · 대피소 확보와 적립.
 *
 * ⚠️ **RNG 를 한 칸도 안 쓴다.** 소환은 {@link summonEnemy}(`waveRng` 미소비)이고
 * `spawnCatalystHazard` 도 난수를 안 쓴다 — `spawnEnemy` 를 쓰면 같은 시드의 웨이브·드랍·엘리트
 * 시퀀스가 통째로 밀린다.
 */
function pursuitTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_NIFLHEIM_PURSUIT) || !isChaseRun(state)) return;
  const slots = state.catalystSlots;

  // ── ① 궤적 적재 — 살아 있는 부스러기 수를 매 틱 다시 센다 ────────────────────
  // 증감 장부로 관리하면 부스러기가 사라지는 경로(수명 만료·그림자 소비·상한 거절)마다 감산을
  // 걸어야 하고 하나만 빠뜨려도 슬롯과 화면이 조용히 갈린다. 다시 세면 그 부류가 봉쇄된다.
  let crumbs = 0;
  let oldest: Entity | undefined;
  for (const e of state.entities) {
    if (!isPursuitCrumb(e)) continue;
    crumbs++;
    // 배열 순서 = 삽입 순서라 **처음 만난 것이 가장 오래된 것**이다(부동소수 비교가 없다).
    if (oldest === undefined) oldest = e;
  }
  if (state.tick % PURSUIT_CRUMB_TICKS === 0 && crumbs < PURSUIT_TRAIL_CAP) {
    // ⚠️ `activeTicks` 는 **최소 2** 여야 한다 — `stepHazards` 가 `life` 를 먼저 깎고 0 이면
    //    그 자리에서 `dead` 를 세우는데 `stepCatalystHazards` 는 같은 틱의 뒤에서 돈다.
    //    부스러기는 피해가 0 이라 그 루프와 무관하지만, 수명 1 이면 그림자가 한 번도 못 밟는다.
    const c = spawnCatalystHazard(
      state,
      player.x,
      player.y,
      PURSUIT_CRUMB_RADIUS,
      0,
      PURSUIT_CRUMB_LIFE,
      0,
      false,
    );
    if (c !== undefined) crumbs++;
  }
  writeCatalystSlot(slots, PursuitSlot.PathCount, crumbs);

  let shadow: Entity | undefined;
  for (const e of state.entities) {
    if (isShadow(e)) {
      shadow = e;
      break;
    }
  }

  // ── ② 대피소 — 확보 반경 2배 + 따돌린 채 확보하면 적립 ──────────────────────
  // ⚠️ **그림자 소환보다 앞이다.** 뒤에 두면 소환 조건(궤적이 쌓일 때까지)의 조기 반환에
  //    걸려 그림자가 뜨기 전 수백 틱 동안 확보 보너스가 통째로 죽는다(실측으로 잡힌 형태다).
  const reach = player.radius + CHASE_SHELTER_RADIUS * PURSUIT_SHELTER_RADIUS_MULT;
  for (const s of state.entities) {
    if (s.dead || !isShelter(s) || isShelterSecured(s)) continue;
    const dx = s.x - player.x;
    const dy = s.y - player.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    s.aux1 = 1; // 확보(`chase.ts` 와 같은 표현 — 정수).
    const shaken =
      shadow === undefined ||
      !overlaps(shadow.x, shadow.y, PURSUIT_SHADOW_CLEAR_RADIUS, s.x, s.y, 0);
    if (shaken) {
      state.resources += PURSUIT_SHELTER_RESOURCE;
      creditCatalyst(state, CARD_NIFLHEIM_PURSUIT, PURSUIT_SHELTER_RESOURCE);
      notifyCatalystFx(state, CARD_NIFLHEIM_PURSUIT, CATALYST_FX.credit, s.x, s.y);
    } else {
      // 헌장: *"놓친 액수가 보여야 다음 판에 조건을 추구한다."*
      missCatalyst(state, CARD_NIFLHEIM_PURSUIT, PURSUIT_SHELTER_RESOURCE);
      notifyCatalystFx(state, CARD_NIFLHEIM_PURSUIT, CATALYST_FX.miss, s.x, s.y);
    }
  }

  // ── ③ 그림자 소환 — 런당 한 기다(`boss` kind 를 늘리지 않는다) ───────────────
  if (shadow === undefined) {
    // 궤적이 어느 정도 쌓인 뒤에 나온다 — 첫 틱에 나오면 밟을 경로가 없어 플레이어에게
    // 직진하고, 그것은 "포식자가 둘"이라는 초판의 그림이지 그림자가 아니다.
    if (crumbs < PURSUIT_TRAIL_CAP) return;
    const def = niflheimEnemyDef();
    if (def === undefined || oldest === undefined) return;
    shadow = summonEnemy(state, def, oldest.x, oldest.y);
    writeMark(shadow, 'shadow', 1);
    // 접촉 피해는 0 이다 — 즉사는 `niflheimOnEnemyContact` 이 따로 준다. 둘 다 두면 같은
    // 접촉이 두 번 계산된다.
    shadow.damage = 0;
    notifyCatalystFx(state, CARD_NIFLHEIM_PURSUIT, CATALYST_FX.trigger, shadow.x, shadow.y);
    return;
  }

  // ── ④ 그림자 이동 — 가장 오래된 부스러기로 걸어가 닿으면 소비한다 ──────────────
  // 발사는 하지 않는다(그림자는 궤적을 밟는 위협이지 사수가 아니다). 쿨다운을 매 틱 되세워
  // 패턴 엔진이 이 개체로 탄을 내지 않게 한다.
  shadow.cooldown = PURSUIT_CRUMB_LIFE;
  const target = oldest;
  if (target !== undefined) {
    const dx = target.x - shadow.x;
    const dy = target.y - shadow.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = PURSUIT_SHADOW_SPEED / 60;
    if (dist <= step + PURSUIT_CRUMB_RADIUS) {
      shadow.x = target.x;
      shadow.y = target.y;
      target.dead = true; // 소비 — 큐가 한 칸 전진한다.
      writeCatalystSlot(slots, PursuitSlot.PathHead, readCatalystSlot(slots, PursuitSlot.PathHead) + 1);
    } else if (dist > 0) {
      shadow.x += (dx / dist) * step;
      shadow.y += (dy / dist) * step;
    }
  }
}

// ---------------------------------------------------------------------------
// id 37 niflheim-rime-crystal — 지나간 자리가 언다
// ---------------------------------------------------------------------------
//
// ## 왜 슬롯이 한 칸도 없는가 (§A 유지)
// *"궤적마다 스폰하면 폭증한다"* 는 `id 31` 이 슬롯(마지막 셀)으로 푼 문제지만, 니플헤임 구역
// 15·16·17 은 `id 36`·`id 38` 이 이미 먹었고 **같은 행성이라 재사용이 불가능**하다. 그래서
// 기억 대신 **질의**로 푼다 — "이 자리에 이미 서리가 있는가"는 살아 있는 촉매 해저드(≤12)를
// 훑으면 그 자리에서 답이 나오고, 그것이 슬롯보다 **정확하다**(슬롯은 마지막 한 셀만 기억하지만
// 질의는 전부 본다 — 되돌아온 자리에도 중복 스폰이 안 난다). 새 칸 0 이므로 §A 다.
//
// ## ⚠️ 공용 해저드 루프가 이것을 안 때린다 — 그리고 그것이 맞다
// `stepCatalystHazards` 는 `phase === 1`(지속) **그리고** `catalystHazardDamaging`(= `damage > 0`)
// 인 것만 때린다(실측: `catalystHooks.ts` `stepCatalystHazards` 본문). 서리는 **피해가 아니라
// 감속**이라 `damage = 0` 이고, 감속은 {@link niflheimOnEnemyStep} 이 위치 판정으로 준다.
// 그래서 "스폰됐다"가 아니라 "적이 실제로 느려진다"가 이 카드의 단언 축이다.

/** 서리 궤적 반경. */
const RIME_RADIUS = 150;

/** 서리 궤적 수명(틱). 10초 — 지형 저작이라 한동안 남아야 유인 플레이가 성립한다. */
const RIME_LIFE = 600;

/** 서리 위 잡몹 이동 배율(<1 = 감속). */
const RIME_ENEMY_SLOW = 0.5;

/**
 * 서리 위 **포식자** 가속 배율(>1). *"내 안전장치가 추격자를 돕는다"* 가 이 카드의 정체성이라
 * 방향이 잡몹과 **반대**여야 한다.
 */
const RIME_PREDATOR_SPEEDUP = 1.5;

/** 포식자 기본 추격 속도(u/s) — `chase.ts` `CHASE_PREDATOR_SPEED` 와 같은 값. 가속분만 얹는다. */
const RIME_PREDATOR_BASE_SPEED = 540;

/** 서리 위에서 죽은 적의 전리품 등급 배율. 카탈로그 §상한 = 희귀도 ×2.0. */
const RIME_LOOT_RARITY = 2.0;

/** 새 서리를 놓기 전에 확보해야 하는 기존 서리와의 최소 간격(중복 스폰 억제). */
const RIME_SPACING = 200;

/** 이 해저드가 서리 궤적인가. 지속(`phase === 1`) + 피해 0 이 판별자다(부스러기는 `phase === 0`). */
function isRime(e: Entity): boolean {
  return !e.dead && isCatalystHazard(e) && e.phase === 1 && e.damage === 0;
}

/** 이 좌표가 서리 위인가. */
function onRime(state: WorldState, x: number, y: number, r: number): boolean {
  for (const e of state.entities) {
    if (!isRime(e)) continue;
    if (overlaps(e.x, e.y, e.radius, x, y, r)) return true;
  }
  return false;
}

/** `id 37` 한 틱 — 궤적 저작 + 포식자 가속. */
function rimeTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_NIFLHEIM_RIME_CRYSTAL) || !isChaseRun(state)) return;

  // ── ① 저작 — 이미 서리가 깔린 자리에는 다시 안 깐다(질의로 판정, 슬롯 0칸) ────
  let near = false;
  for (const e of state.entities) {
    if (!isRime(e)) continue;
    if (overlaps(e.x, e.y, RIME_SPACING, player.x, player.y, 0)) {
      near = true;
      break;
    }
  }
  if (!near) {
    const h = spawnCatalystHazard(state, player.x, player.y, RIME_RADIUS, 0, RIME_LIFE, 0, true);
    if (h !== undefined) {
      notifyCatalystFx(state, CARD_NIFLHEIM_RIME_CRYSTAL, CATALYST_FX.trigger, h.x, h.y);
    }
  }

  // ── ② 포식자 가속 — 얼음에 올라타면 미끄러지듯 빨라진다 ──────────────────────
  // ⚠️ **설계 정본과 코드가 어긋난 자리다(고치지 않고 보고).** 잡몹 속도는
  // `onEnemyStepCatalyst` 라는 배율 앵커가 있지만 **포식자는 그 앵커를 안 탄다** —
  // `chasePredatorPursue`(`chase.ts`)가 `CHASE_PREDATOR_SPEED` 상수로 직접 좌표를 옮긴다.
  // 그래서 가속분을 여기서 **추가 전진**으로 얹는다(기존 추격은 그대로 두고 델타만 더한다).
  // `boss.aux0` 는 읽지도 쓰지도 않는다(추격 취약화 플래그 — 이 카드의 소관이 아니다).
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'boss') continue;
    if (!onRime(state, b.x, b.y, b.radius)) continue;
    const extra = ((RIME_PREDATOR_SPEEDUP - 1) * RIME_PREDATOR_BASE_SPEED) / 60;
    const dx = player.x - b.x;
    const dy = player.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      b.x += (dx / dist) * extra;
      b.y += (dy / dist) * extra;
    }
    notifyCatalystFx(state, CARD_NIFLHEIM_RIME_CRYSTAL, CATALYST_FX.selfHarm, b.x, b.y);
  }
}

// ---------------------------------------------------------------------------
// id 38 niflheim-flagship — 포식자 위로 기함이 뜬다
// ---------------------------------------------------------------------------
//
// ## ⭐ 교착이 **원리적으로** 불가능해야 한다 (이 레인 최대 함정)
// 마지막 일반 세그먼트의 마일스톤은 정확히 대피소 **전량**이다. 그래서 규칙 셋을 못 박는다:
//
//  1. **동시에 부서지는 대피소는 최대 하나**({@link flagshipTick} 의 `broken > 0` 조기 반환).
//  2. **복구는 자원과 무관하게 진행된다** — 자원은 {@link FLAGSHIP_REPAIR_SPEND} 를 내면 진행도를
//     한 틱에 {@link FLAGSHIP_REPAIR_BOOST} 만큼 **더** 얹을 뿐이고, 하한은 매 틱 `+1` 이다.
//     2판은 재건이 자원 소모라 **자원 0 인 순간 교착이 되살아났다** — 하한 0 이 계약이다.
//  3. **복구가 파괴보다 빠르다**({@link FLAGSHIP_REPAIR_TICKS} < {@link FLAGSHIP_BREAK_TICKS}).
//
// 셋을 곱하면 어떤 자원 상태에서도 "부서진 채로 영원히"가 표현 불가능하다.
//
// ## 부서짐의 표현 — `shelter.aux1 = 2`
// `chase.ts` 의 `isShelterSecured` 는 `aux1 === 1` 이다. **2 는 그 술어에서 자동으로 거짓**이라
// 확보 수가 즉시 내려가고, 대피소 엔티티는 화면에 그대로 서 있다(진행 게이트가 세는 대상을
// **물리적으로 제거하지 않는다** — 카탈로그 §코드 계약 3). 복구는 2 → 1 로 되돌린다.
// ⚠️ 플레이어가 그 위를 지나가도 `updateChaseShelters` 가 1 로 되돌린다 — 복구 경로가 하나 더
// 있는 것이고, 교착 방지에 유리한 방향이라 그대로 둔다.

/** 기함이 뜨는 틱. 대피소를 몇 곳 찾은 뒤에 나와야 "부술 것"이 있다. */
const FLAGSHIP_SPAWN_TICK = 1800;

/** 기함이 대피소를 하나 부수는 간격(틱). */
const FLAGSHIP_BREAK_TICKS = 900;

/** 부서진 대피소가 **자원 0 에서도** 스스로 복구되는 데 드는 틱. 파괴 간격보다 짧아야 한다. */
const FLAGSHIP_REPAIR_TICKS = 300;

/** 복구를 앞당기려고 한 틱에 태우는 자원. **없으면 그냥 안 태운다**(하한 0). */
const FLAGSHIP_REPAIR_SPEND = 1;

/** 자원을 태운 틱에 추가로 얹는 진행도. */
const FLAGSHIP_REPAIR_BOOST = 3;

/** 기함 HP 배수(행성 적 정의 대비). 격추가 "지름길"이 되려면 만만하면 안 된다. */
const FLAGSHIP_HP_MULT = 12;

/** 기함이 뜨는 높이(플레이어 기준 −Y). */
const FLAGSHIP_SPAWN_OFFSET_Y = -900;

/** 진행도와 격추 수를 한 칸에 접는 자리값. 진행도는 {@link FLAGSHIP_REPAIR_TICKS} 보다 훨씬 작다. */
const FLAGSHIP_PACK = 4096;

/** 슬롯 17 에서 복구 진행도만 꺼낸다. */
function flagshipProgress(state: WorldState): number {
  return readCatalystSlot(state.catalystSlots, FlagshipSlot.RepairProgress) % FLAGSHIP_PACK;
}

/**
 * 슬롯 17 에서 **격추 수**를 꺼낸다 — `catalystSettlementOf` 가 읽어 촉매 드랍 배율을 만드는 칸이다.
 *
 * ⚠️ **배율을 주입 목록에서 파생하지 마라**(헌장 §상한 근거 규율). 카드를 꽂았다는 사실이 아니라
 * sim 이 실제로 센 격추 수가 근거다. 실효 천장은 정산 쪽 `MAX_DROP_CHANCE_CP = 9500` 이다.
 */
export function flagshipShotdowns(state: WorldState): number {
  return Math.floor(readCatalystSlot(state.catalystSlots, FlagshipSlot.RepairProgress) / FLAGSHIP_PACK);
}

function writeFlagshipSlot(state: WorldState, shotdowns: number, progress: number): void {
  writeCatalystSlot(
    state.catalystSlots,
    FlagshipSlot.RepairProgress,
    shotdowns * FLAGSHIP_PACK + progress,
  );
}

/** 이 적이 기함인가. */
function isFlagship(e: Entity): boolean {
  return !e.dead && e.kind === 'enemy' && readMark(e, 'flagship') !== 0;
}

/** `id 38` 한 틱 — 소환 · 격추 감지 · 파괴 · 복구. */
function flagshipTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_NIFLHEIM_FLAGSHIP) || !isChaseRun(state)) return;
  const shotdowns = flagshipShotdowns(state);
  let progress = flagshipProgress(state);

  // ── ① 소환 — 런당 한 기. `boss` kind 가 아니라 일반 적 + 마커다 ────────────────
  if (state.tick === FLAGSHIP_SPAWN_TICK) {
    const def = niflheimEnemyDef();
    if (def !== undefined) {
      const f = summonEnemy(state, def, player.x, player.y + FLAGSHIP_SPAWN_OFFSET_Y);
      writeMark(f, 'flagship', 1);
      f.hp *= FLAGSHIP_HP_MULT;
      f.maxHp = f.hp;
      notifyCatalystFx(state, CARD_NIFLHEIM_FLAGSHIP, CATALYST_FX.trigger, f.x, f.y);
    }
  }

  let alive: Entity | undefined;
  for (const e of state.entities) {
    if (isFlagship(e)) {
      alive = e;
      break;
    }
  }

  // ── ② 격추 감지 — 소환 뒤에 사라졌으면 떨어진 것이다 ─────────────────────────
  // `onEnemyDeathCatalyst` 는 `state.entities = survivors` 뒤에 불려 시체를 못 되찾고 좌표만
  // 준다(같은 틱에 여러 마리가 죽으면 어느 것인지 구별할 수 없다). 그래서 **존재 판정**으로
  // 잡는다 — 소환은 정확히 한 번뿐이라 "떴는데 지금 없다"가 곧 격추다.
  if (alive === undefined && state.tick > FLAGSHIP_SPAWN_TICK && shotdowns === 0) {
    writeFlagshipSlot(state, 1, progress);
    // *"기함을 격추하면 포식자가 즉시 취약해진다"* — 취약 표현은 `chase.ts` 가 소유하는
    // `boss.aux0 = 1` 하나뿐이고(`isPredatorInvincible`), `updateChasePredator` 도 같은 값을
    // 같은 방향으로만 쓴다(단조 — 0 으로 되돌리는 경로가 없다). 그래서 여기서 앞당겨도
    // 모드 계약과 갈리지 않는다. ⚠️ 저장 칸으로 쓰는 것이 아니다(값은 1 하나뿐이다).
    for (const b of state.entities) {
      if (!b.dead && b.kind === 'boss') b.aux0 = 1;
    }
    notifyCatalystFx(state, CARD_NIFLHEIM_FLAGSHIP, CATALYST_FX.credit, player.x, player.y);
    creditCatalyst(state, CARD_NIFLHEIM_FLAGSHIP, 1);
    return;
  }

  // ── ③ 복구 — **자원이 0 이어도 반드시 끝난다** ───────────────────────────────
  let broken: Entity | undefined;
  for (const s of state.entities) {
    if (!s.dead && isShelter(s) && s.aux1 === 2) {
      broken = s;
      break;
    }
  }
  if (broken !== undefined) {
    progress += 1; // ⭐ 하한이다. 자원과 무관하게 매 틱 오른다.
    if (state.resources >= FLAGSHIP_REPAIR_SPEND) {
      state.resources -= FLAGSHIP_REPAIR_SPEND;
      progress += FLAGSHIP_REPAIR_BOOST; // 자원은 **앞당길 뿐**이다.
      missCatalyst(state, CARD_NIFLHEIM_FLAGSHIP, FLAGSHIP_REPAIR_SPEND);
    }
    if (progress >= FLAGSHIP_REPAIR_TICKS) {
      broken.aux1 = 1;
      progress = 0;
      notifyCatalystFx(state, CARD_NIFLHEIM_FLAGSHIP, CATALYST_FX.trigger, broken.x, broken.y);
    }
    writeFlagshipSlot(state, shotdowns, progress);
    return; // ⭐ 부서진 것이 있는 동안은 더 안 부순다(동시 최대 하나).
  }
  writeFlagshipSlot(state, shotdowns, 0);

  // ── ④ 파괴 — 기함이 살아 있을 때만 ──────────────────────────────────────────
  if (alive === undefined) return;
  if (state.tick % FLAGSHIP_BREAK_TICKS !== 0) return;
  for (const s of state.entities) {
    if (s.dead || !isShelter(s) || !isShelterSecured(s)) continue;
    s.aux1 = 2; // 부서짐 — 엔티티는 그대로 서 있다(게이트 대상을 제거하지 않는다).
    notifyCatalystFx(state, CARD_NIFLHEIM_FLAGSHIP, CATALYST_FX.selfHarm, s.x, s.y);
    return;
  }
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 */
export function niflheimOnTick(state: WorldState, player: Entity): void {
  pursuitTick(state, player);
  rimeTick(state, player);
  flagshipTick(state, player);
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// `catalystHooks.ts` 의 앵커 하나하나가 13개 그룹 모듈 전부에 **고정 순서로** 위임한다. 그래서
// 카드 레인은 자기 그룹 파일의 함수 본체만 채우면 되고, 디스패처는 손대지 않는다 — 이것이
// 병렬 레인의 마지막 충돌 지점을 없앤다.
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}). 새 객체를 만들지 말고 그대로 돌려라.
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹).

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 niflheim 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function niflheimOnEnemyDamageTakenMult(
  state: WorldState,
  target: Entity,
  px: number,
  py: number,
): number {
  void state;
  void target;
  void px;
  void py;
  return 1;
}

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 niflheim 몫 —
 * `id 37` 의 *"언 바닥 위에서 죽으면 결정을 떨군다"*.
 *
 * 판정이 **위치 기반**이라 적 상태 저장이 필요 없다(§A 를 유지하는 이유 자체다).
 */
export function niflheimOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void elite;
  if (!carries(state, CARD_NIFLHEIM_RIME_CRYSTAL)) return CATALYST_LOOT_NEUTRAL;
  if (!onRime(state, x, y, 0)) return CATALYST_LOOT_NEUTRAL;
  notifyCatalystFx(state, CARD_NIFLHEIM_RIME_CRYSTAL, CATALYST_FX.credit, x, y);
  return { rarity: RIME_LOOT_RARITY, count: 1 };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/**
 * {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 niflheim 몫 —
 * `id 36` 그림자에 **닿으면 즉사**.
 *
 * 사슬(`onDamageChain`)을 안 타는 것이 의도다 — 즉사는 "얼마를 맞았나"가 아니라 규칙이라
 * 경감·장갑·막이 끼면 카드가 "큰 피해"로 바뀐다. 대신 자해 통지로 색을 가른다(헌장 §귀속 3).
 */
export function niflheimOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  if (!carries(state, CARD_NIFLHEIM_PURSUIT)) return;
  if (!isShadow(target)) return;
  player.hp = 0;
  notifyCatalystFx(state, CARD_NIFLHEIM_PURSUIT, CATALYST_FX.selfHarm, player.x, player.y);
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 niflheim 몫 —
 * `id 36` 그림자 **정지**(경로 이동은 `niflheimOnTick` 이 직접 한다) + `id 37` 서리 위 감속.
 *
 * ⚠️ 여기서 `e` 에 **쓰지 마라**(앵커 계약). 둘 다 읽기만 한다.
 */
export function niflheimOnEnemyStep(state: WorldState, e: Entity): number {
  if (!state.catalystOn) return 1;
  // 그림자는 웨이브 AI 로 움직이면 궤적이 아니라 플레이어에게 직진한다 — 그러면 "포식자가 둘"이
  // 되어 초판이 깨졌던 그림 그대로다. 0 을 돌려 기본 이동을 멈추고 경로 추종만 남긴다.
  if (carries(state, CARD_NIFLHEIM_PURSUIT) && isShadow(e)) return 0;
  if (carries(state, CARD_NIFLHEIM_RIME_CRYSTAL) && onRime(state, e.x, e.y, e.radius)) {
    return RIME_ENEMY_SLOW;
  }
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 niflheim 몫. **미배선**(위 §주석). */
export function niflheimOnCatalystHazards(state: WorldState): void {
  void state;
}
