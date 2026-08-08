/**
 * 촉매 **성장 축**(id 10~14) — 카드 본체가 들어갈 자리.
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
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { carries } from './shared.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { isCatalystShadow, isCatalystHazard, spawnCatalystHazard } from './shared.js';
import { readCatalystSlot, writeCatalystSlot, InsightSlot } from '../catalystSlots.js';
import { circlesOverlap } from '../collision.js';
import { notifyCatalystFx, creditCatalyst, missCatalyst, CATALYST_FX } from './fx.js';

/** id 10 — slug `insight`. 정본은 `src/data/catalysts.ts`. */
export const CARD_INSIGHT = 10;

/** id 11 — slug `tutelage`. 정본은 `src/data/catalysts.ts`. */
export const CARD_TUTELAGE = 11;

/** id 12 — slug `ascension`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ASCENSION = 12;

/** id 13 — slug `enlightenment`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ENLIGHTENMENT = 13;

/** id 14 — slug `mastery`. 정본은 `src/data/catalysts.ts`. */
export const CARD_MASTERY = 14;

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.** 카드 레인이 여기에 `carries` 게이트로
 * 분기를 넣는다. 앵커가 매 틱이 아닌 카드(드랍 롤·격추·접촉·해저드 …)는 이 함수가 아니라
 * `catalystHooks.ts` 의 **해당 디스패치**에 진입 함수를 새로 추가해 걸어라 — 매 틱 자리에
 * 억지로 넣으면 단조 누적이 되어 헌장 §틱 규율을 어긴다.
 */
export function growthOnTick(state: WorldState, player: Entity): void {
  insightOnTick(state, player);
  tutelageOnTick(state);
  enlightenmentOnTick(state);
}

// ---------------------------------------------------------------------------
// id 10 insight — 적탄 예고선 · 그 위에 서 있는 동안만 XP 3배
// ---------------------------------------------------------------------------
//
// ## 훅 등급 §B 를 **정확히 한 칸만** 쓴다
// 신규 상태는 슬롯 두 칸({@link InsightSlot})뿐이다. 예고선의 **좌표는 촉매 해저드 틀**이
// 들고(피해 0 · `windup` 이 곧 예고 시간), `WorldState` 에 새 칸을 만들지 않는다.
//
// ## 왜 "발사 예약" 없이도 예고가 서는가 (엔진 실측)
// 패턴 엔진에 발사 예약은 없지만 **`e.cooldown` 이 매 틱 1씩 줄어 0 에서 발사**한다
// (`patterns/index.ts:35-47`). 즉 *"몇 틱 뒤에 쏘는가"* 는 이미 결정론적으로 읽을 수 있다.
// 예고선은 `cooldown === TELEGRAPH_LEAD` 인 **정확히 그 틱에만** 세운다 — 에지 트리거라
// 같은 적이 같은 발사에 두 번 예고되지 않고, 그래서 "이미 예고했다" 표식이 필요 없다.
//
// ## ⚠️ 조준·사격 타이밍을 전제하지 않는다
// 조건이 **위치**다(예고선 원 안에 서 있는가). 자동 조준이 무엇을 쏘든 배율이 갈리지 않는다 —
// 헌장 §플레이어가 실제로 쥔 손잡이.

/** 예고선이 서는 선행 틱. 적 발사 쿨다운이 이 값이 되는 틱에 예고선 하나가 선다. */
const TELEGRAPH_LEAD = 30;
/** 예고선(원)의 반경. 플레이어 반경 32 보다 넉넉해 "밟고 서 있기"가 조작으로 성립한다. */
const TELEGRAPH_RADIUS = 90;
/** 예고선을 적에서 플레이어 쪽으로 얼마나 떨어뜨려 놓는가 — **궤적 위의 한 점**이다. */
const TELEGRAPH_OFFSET = 220;
/** 발사 직후 예고선이 남아 있는 틱(피해 0 — 순수 표식이라 잔상만 남기고 사라진다). */
const TELEGRAPH_LINGER = 6;
/** 예고선 위에 서 있는 동안의 XP 배율. */
const INSIGHT_XP_MULT = 3;
/**
 * 예고선 밖일 때의 XP 배율 = **1**.
 *
 * ⚠️ 상수로 되돌리는 것이 맞다: ADR-0052 이후 `catalystMods` 는 **항상 중립으로 시작**하고
 * (`catalystMods.ts` 헤더) 런 중 `xp` 축을 만지는 기여자가 이 카드 말고는 없다. 조우 제단이
 * 만지는 축은 `drop` 이다. 그래서 "직전 값 복원"용 슬롯이 필요 없다.
 */
const INSIGHT_XP_BASE = 1;

/** 이 해저드가 `id 10` 이 세운 **예고선**인가(촉매 해저드 중 피해 0 인 것). */
function isTelegraph(e: Entity): boolean {
  return isCatalystHazard(e) && e.damage === 0;
}

/** 예고선의 **재사용 좌표 버퍼** — 순회 안에서 스폰이 금지라 좌표만 모았다가 밖에서 낳는다. */
const TELEGRAPH_SPAWN: number[] = [];

function insightOnTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_INSIGHT)) return;

  // ── ① 살아 있는 예고선을 세고, 플레이어가 그 위에 서 있는지 판정한다 ──────────────
  // "예고선 위" 는 **아직 안 터진 예고선**(`timer > 0`)이어야 한다 — 규칙문이 *"적탄이
  // 발사되기 전"* 이라 못 박았고, 그래야 이득이 "위험을 미리 감수한 대가"가 된다.
  let live = 0;
  let standing = false;
  let missed = 0;
  for (const e of state.entities) {
    if (e.dead || !isTelegraph(e)) continue;
    live++;
    if (e.timer <= 0) continue;
    const on = circlesOverlap(player.x, player.y, player.radius, e.x, e.y, e.radius);
    if (on) standing = true;
    // 이번 틱에 터지는 예고선(`timer === 1`)을 안 밟고 있었다면 **놓친 몫**이다.
    // 헌장 §귀속 규율: 놓친 액수가 보여야 다음 판에 조건을 추구한다.
    else if (e.timer === 1) missed++;
  }
  writeCatalystSlot(state.catalystSlots, InsightSlot.TelegraphCount, live);
  if (missed > 0) missCatalyst(state, CARD_INSIGHT, missed);

  // ── ② XP 배율 — 번들 통째 교체(`encounters/light.ts` 선례). 값이 같으면 안 만진다 ──
  const want = standing ? INSIGHT_XP_MULT : INSIGHT_XP_BASE;
  if (state.catalystMods.xp !== want) {
    state.catalystMods = { ...state.catalystMods, xp: want };
    // ⚠️ **에지에서만** 통지한다(매 틱 금지 — 틱당 64건 상한).
    if (standing) {
      notifyCatalystFx(state, CARD_INSIGHT, CATALYST_FX.trigger, player.x, player.y);
      creditCatalyst(state, CARD_INSIGHT, INSIGHT_XP_MULT - INSIGHT_XP_BASE);
    }
  }

  // ── ③ 이번 틱에 새로 서는 예고선 — 좌표만 모은다(순회 안 스폰 금지) ──────────────
  TELEGRAPH_SPAWN.length = 0;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy' || isCatalystShadow(e)) continue;
    if (e.cooldown !== TELEGRAPH_LEAD) continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0) continue;
    TELEGRAPH_SPAWN.push(e.x + (dx / d) * TELEGRAPH_OFFSET, e.y + (dy / d) * TELEGRAPH_OFFSET);
  }
  // 큐 진행 상태(다음에 소비할 자리)는 슬롯이 든다. 상한에 걸려 스폰이 생략돼도
  // `spawnCatalystHazard` 는 RNG 를 한 칸도 안 쓰므로 이후 시드 소비가 밀리지 않는다.
  let head = readCatalystSlot(state.catalystSlots, InsightSlot.TelegraphHead);
  for (let i = 0; i + 1 < TELEGRAPH_SPAWN.length; i += 2) {
    const x = TELEGRAPH_SPAWN[i] ?? 0;
    const y = TELEGRAPH_SPAWN[i + 1] ?? 0;
    const h = spawnCatalystHazard(
      state,
      x,
      y,
      TELEGRAPH_RADIUS,
      TELEGRAPH_LEAD,
      TELEGRAPH_LINGER,
      0,
      false,
    );
    if (h === undefined) break;
    head = (head + 1) % 1000;
  }
  writeCatalystSlot(state.catalystSlots, InsightSlot.TelegraphHead, head);
}

// ---------------------------------------------------------------------------
// id 11 tutelage — 레벨 5에서 시작 · 3택은 자동 확정
// ---------------------------------------------------------------------------
//
// ## 왜 `state.level = 5` 대입이 아닌가
// 명세의 `신호:` 칸이 *"출격 직후 레벨업 연출이 다섯 번 연달아 터진다"* 다. 대입하면 연출도
// 파워업 적용도 **한 번도 일어나지 않는다** — 카드가 약속한 성장이 통째로 증발한다. 그래서
// XP 를 채워 `checkLevelUp` 이 **다섯 번 실제로** 돌게 한다.
//
// ## ⚠️ 다단 레벨업이 아니다
// `checkLevelUp` 은 `pendingLevelUp` 이면 즉시 반환하므로 **틱당 최대 1레벨**이고, 픽이
// 소비돼야 다음 레벨이 열린다. 즉 레벨 수와 파워업 적용 수가 항상 같다(앵커 ⑫ 주석의
// 금지 사유가 여기서는 성립하지 않는다 — 그 사유는 "한 픽에 여러 레벨" 이다).
//
// ## ⚠️ RNG 미소비
// XP 대입은 난수를 안 쓴다. 3택은 `drawPowerupChoices` 가 **평소대로** 굴려 뽑고, 이 카드는
// 뽑힌 결과에서 **고르기만** 한다({@link tutelageAutoPickIndex}).

/** 이 카드가 보장하는 시작 레벨. */
const TUTELAGE_START_LEVEL = 5;
/**
 * 시작 레벨까지 밀어 올리는 데 쓰는 XP 대입값.
 *
 * 임계는 PvE `10+66L`·침공 `10+6L`(`xpToNext`/`xpToNextInvasion`)이라 레벨 4 에서도 300 미만이다.
 * 넉넉히 잡되, **레벨 5 에 닿은 뒤 남은 몫은 버린다**(아래 청소 분기) — 안 버리면 6레벨이
 * 공짜로 딸려 온다.
 *
 * ⚠️ 값이 **센티넬 크기**인 것은 의도다. 청소 분기가 "이 대입이 남긴 몫인가"를 문턱 하나로
 * 판정하므로, 정상 플레이의 런 풀 XP 가 그 문턱에 **원리적으로 닿을 수 없어야** 한다 —
 * 젬 하나가 한 자릿수 XP 이고 런이 만 틱 규모라 1e8 은 도달 불가다. 문턱을 잡게 잡으면
 * 후반 고레벨 런의 정상 XP 를 조용히 지운다.
 */
const TUTELAGE_XP_GRANT = 1_000_000_000;
/** 청소 판정 문턱. 정상 플레이의 런 풀 XP 는 이 값 근처에 원리적으로 못 온다(위 ⚠️). */
const TUTELAGE_XP_CLEAN = 100_000_000;

function tutelageOnTick(state: WorldState): void {
  if (!carries(state, CARD_TUTELAGE)) return;
  if (state.level < TUTELAGE_START_LEVEL) {
    state.xp = TUTELAGE_XP_GRANT;
    return;
  }
  // 다섯 번째 레벨업 직후 한 번만 참이다(그 뒤로는 XP 가 정상 범위라 이 분기가 안 돈다).
  if (state.xp > TUTELAGE_XP_CLEAN) state.xp = 0;
}

/**
 * `id 11 tutelage` — **3택을 자동으로 확정한다**. `world.ts` 의 레벨업 프리즈 블록이 부른다.
 *
 * @returns 자동으로 고를 **제시 순번**(0-based). 카드가 없으면 `-1`(프리즈 유지 = 종전 거동).
 *
 * ⚠️⚠️ **RNG 미소비.** `drawPowerupChoices` 가 이미 뽑아 놓은 `state.powerupChoices` 에서
 * **첫 칸을 고를 뿐** 재추첨하지 않는다 — `powerupRng` 스트림 위치가 촉매 유무와 무관하게 같다.
 *
 * ⚠️ 왜 첫 칸인가: 순번을 상태나 난수로 고르면 그 순간 §B 이거나 스트림이 밀린다. 고정 0 이면
 * `id 14 mastery`(전 칸을 첫 칸으로 덮는다)·`epiphany`(1칸으로 접는다)와도 **결과가 같아**,
 * 셋이 같이 실린 런에서 순서 미정이 생기지 않는다.
 */
export function tutelageAutoPickIndex(state: WorldState): number {
  if (!state.catalystOn || !carries(state, CARD_TUTELAGE)) return -1;
  return state.powerupChoices.length > 0 ? 0 : -1;
}

// ---------------------------------------------------------------------------
// id 12 ascension — 웨이브마다 최대 HP −10% · 공격력 +10% · 대시 관통이 HP 를 되돌린다
// ---------------------------------------------------------------------------
//
// ## ⚠️ 누적 카운터를 두지 않는다
// 넘긴 웨이브 수는 `state.wave.segmentIndex`(이미 해시에 있다)로 읽고, 누적 비율은
// **현재 최대 HP ÷ 기준 최대 HP** 로 파생한다. 슬롯을 한 칸도 안 쓴다(그래서 §A 다).
//
// ## ⚠️ `maxHp` 공유 필드 — 작성자 순서를 어떻게 못 박았는가
// `maxHp` 는 `id 24`·`27`·`29`·침식 약공명이 같이 쓰고 파워업 6·18·23 이 **반대 방향**으로
// 올린다. 이 카드의 쓰기 지점은 **딱 둘**이고 둘 다 앵커가 다르다:
//  - 감소 — {@link growthOnWaveAdvanced}(웨이브 전환 앵커, 틱당 최대 1회)
//  - 복구 — {@link growthOnDashPierce}(대시 관통 앵커)
// 파워업의 가산은 픽 적용 지점(프리즈 틱)이라 **세 지점이 서로 다른 틱·다른 앵커**다. 즉
// 같은 틱에 두 작성자가 겹치지 않아 순서가 미정이 될 수 없다.
//
// 그리고 **기준 최대 HP 는 `state.config.playerHp`** 다 — 파워업 6·18·23 이 `p.maxHp` 와
// `config.playerHp` 를 **같이** 올리므로(`powerups.ts:163-166`·`286-289`·`337-340`) 기준선이
// 파워업을 따라 살아 움직인다. 상수로 굳히면 하울 투자가 이 카드의 복구 상한을 못 넘는다.

/** 웨이브 전환마다 최대 HP 에 곱하는 값. */
const ASCENSION_HP_MULT = 0.9;
/** 웨이브 전환마다 공격력에 곱하는 값. */
const ASCENSION_DAMAGE_MULT = 1.1;
/** 대시 관통 1회가 되돌리는 최대 HP. */
const ASCENSION_DASH_RECOVER = 1;
/** 넘긴 웨이브 하나가 올리는 전리품 등급 확률. */
const ASCENSION_RARITY_STEP = 0.125;
/** 등급 배율 상한(명세 §상한: 희귀도 ×2.0). */
const ASCENSION_RARITY_CAP = 2;

/** `id 12` 의 전리품 배율 **재사용 버퍼** — 격추마다 도는 자리라 리터럴을 새로 만들지 않는다. */
const ASCENSION_LOOT: { rarity: number; count: number } = { rarity: 1, count: 1 };

// ---------------------------------------------------------------------------
// id 13 enlightenment — 화면의 적이 적을수록 탄이 커진다 · 급행 소환 두 배
// ---------------------------------------------------------------------------
//
// ## ⚠️ 슬롯을 한 칸도 안 쓴다 — **틱의 순수 파생**이다
// 배율은 오직 화면 적 수의 함수다. 저장하면 §B 로 되올라간다(`catalystSlots.ts` §"무엇이
// 슬롯을 안 먹는가" 2번 항목이 이 카드를 명시적으로 든다).
//
// ## 왜 `state.weapon.bulletRadius` 를 **매 틱 절대값으로** 다시 쓰는가
// 곱해서 누적하면 단조 증가가 되어 *"적이 다시 차면 도로 가늘어진다"* 가 성립하지 않는다.
// 절대 대입이면 되돌아옴이 구조적으로 보장된다. 이 필드는 런 중 **다른 작성자가 없다**
// (전수 대조: 로드아웃·파워업 어느 것도 안 만진다. 읽는 곳만 다섯) — 그래서 기준값이
// {@link ENLIGHTENMENT_BASE_RADIUS} 로 고정이고, 그 상수가 정본과 같은지는
// `tests/catalystGrowth.test.ts` 가 `DEFAULT_WEAPON` 과 대조해 잠근다.
//
// ## 왜 `countEnemies` 를 import 하지 않는가
// `waves.ts` 가 급행 램프에서 이 모듈을 값으로 끌므로(아래 {@link enlightenmentRushStepMult}),
// 반대로 끌면 **순환**이다. 그래서 셈은 여기서 직접 돌리고 **그림자 제외 규칙만** 공유 술어
// (`isCatalystShadow`)로 맞춘다 — 규칙이 갈릴 여지가 있는 부분이 그 한 줄뿐이다.

/**
 * `DEFAULT_WEAPON.bulletRadius` 의 사본. **정본은 `world.ts` 다** — 값 import 는 순환이라
 * 못 하고, 어긋나면 테스트가 즉시 빨개진다.
 */
const ENLIGHTENMENT_BASE_RADIUS = 5;
/** 이 수만큼 화면에 적이 차 있으면 배율이 1(= 이득 0)이다. */
const ENLIGHTENMENT_FULL_ENEMIES = 24;
/** 화면이 텅 빈 순간의 탄 크기 배율(명세: 최대 3배). */
const ENLIGHTENMENT_MAX_MULT = 3;

/** 지금 틱의 탄 크기 배율(1 … {@link ENLIGHTENMENT_MAX_MULT}). 순수 함수 · 상태 미기록. */
function enlightenmentBulletMult(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && e.kind === 'enemy' && !isCatalystShadow(e)) n++;
  }
  const filled = n >= ENLIGHTENMENT_FULL_ENEMIES ? 1 : n / ENLIGHTENMENT_FULL_ENEMIES;
  return 1 + (1 - filled) * (ENLIGHTENMENT_MAX_MULT - 1);
}

function enlightenmentOnTick(state: WorldState): void {
  if (!carries(state, CARD_ENLIGHTENMENT)) return;
  const mult = enlightenmentBulletMult(state);
  // 소수 2자리 반올림은 이 저장소의 결정론 관례다(`subDamage`·로드아웃 굽기와 같은 형태) —
  // 플랫폼 간 부동소수 잔차가 해시에 실리지 않게 한다.
  const next = Math.round(ENLIGHTENMENT_BASE_RADIUS * mult * 100) / 100;
  if (state.weapon.bulletRadius !== next) state.weapon.bulletRadius = next;
  // ⚠️ **매 틱 통지 금지.** 배율이 걸린 동안 1초에 한 번만 낸다(틱당 64건 상한).
  if (mult > 1 && state.tick % 60 === 0) {
    notifyCatalystFx(state, CARD_ENLIGHTENMENT, CATALYST_FX.trigger, 0, 0);
  }
}

/**
 * `id 13 enlightenment` 의 **대가** — 급행 소환 램프 계단 배율. `waves.ts` 가 곱한다.
 *
 * ⚠️ 이 방향(`waves.ts` → 이 모듈)만 성립한다. 반대로 끌면 순환이다(위 §주석).
 */
export function enlightenmentRushStepMult(state: WorldState): number {
  return carries(state, CARD_ENLIGHTENMENT) ? 2 : 1;
}

// ---------------------------------------------------------------------------
// id 14 mastery — **배선 완료**(파워업 3택 축). 거동 불변으로 `catalystHooks.ts` 에서 옮겨 왔다
// ---------------------------------------------------------------------------

/**
 * `id 14 mastery` — **세 자리가 전부 같은 파워업이 된다**(폭을 잃고 깊이를 얻는다).
 *
 * ⚠️ `GAMBLER_EXTRA_CHOICES` 로 4택이 된 런에서도 자리 수와 무관하게 전부 덮는다.
 *
 * ⚠️⚠️ **RNG 미소비.** 이미 뽑힌 결과를 **자리째 덮을 뿐** 재추첨하지 않는다 —
 * `powerupRng` 스트림 위치가 촉매 유무와 무관하게 동일하다.
 *
 * ⚠️ 호출 순서는 **mastery → epiphany 고정**이다(`refine.ts` 쪽 주석과 쌍).
 *
 * @param first `offers[0]` — 호출부가 `undefined` 가 아님을 이미 확인한 값이다.
 */
export function masteryOnPowerupOffer(state: WorldState, offers: number[], first: number): void {
  if (!carries(state, CARD_MASTERY)) return;
  for (let i = 1; i < offers.length; i++) offers[i] = first;
}

/**
 * `id 14 mastery` 의 **중첩 추가분**(기본 1중첩 + 2 = 3중첩). `world.ts` 가 이미 기본 1중첩을
 * 적용한 뒤이므로 여기는 추가분만 센다.
 */
export function masteryExtraStacks(state: WorldState): number {
  return carries(state, CARD_MASTERY) ? 2 : 0;
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// `catalystHooks.ts` 의 앵커 하나하나가 13개 그룹 모듈 전부에 **고정 순서로** 위임한다. 그래서
// 카드 레인은 자기 그룹 파일의 함수 본체만 채우면 되고, 디스패처는 손대지 않는다 — 이것이
// 병렬 레인의 마지막 충돌 지점을 없앤다.
//
// ## ⚠️ 지금은 전부 비어 있다 — **누락이 아니라 미배선이다**
// 자기 몫이 없는 앵커는 빈 함수(또는 중립값 반환)로 남긴다. 지우지 마라 — 지우면 디스패처가
// 깨지고 그 순간 이 파일이 다시 충돌 지점이 된다.
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}). 새 객체를 만들지 말고 그대로 돌려라.
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//    디스패처는 단락 없이 13개를 **전부** 부르고 OR 로 접는다(단락하면 뒤 그룹의 부수효과가 사라진다).
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹). 본체를 채울 때
// 첫 줄을 `if (!carries(state, CARD_*)) return …;` 로 두어라. 캐시하겠다고 `WorldState` 에
// 새 칸을 만들지 마라 — 헌장 §훅 예산이 그것을 §B 로 올린다.

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 growth 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function growthOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/**
 * {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 growth 몫 — `id 11 tutelage` 의 신호.
 *
 * 시작 다섯 레벨이 실제로 올라가는 것을 화면이 알아야 한다(명세 `신호:` 칸). 레벨업은 런당
 * 수십 회라 **매 틱이 아니고**, 상한(틱당 64)에 닿을 수 없다.
 */
export function growthOnLevelUp(state: WorldState, level: number): void {
  if (!carries(state, CARD_TUTELAGE)) return;
  void level;
  notifyCatalystFx(state, CARD_TUTELAGE, CATALYST_FX.trigger, 0, 0);
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/**
 * {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 growth 몫 — `id 12` 의 **되돌림**.
 *
 * ## ⚠️ `target.hp` 를 한 칸도 안 깎는다
 * 사용자 판정(2026-08-08): *"대시는 피해를 주지 않는다. 통과 판정 전용."* 규칙문의
 * *"대시로 관통해 죽인다"* 는 **"통과한 적이 그 대시 중 죽으면"** 으로 읽고, 이 앵커는
 * **통과 그 자체**를 되돌림의 조건으로 삼는다. 여기서 hp 를 깎으면 조작 코어 변경이라
 * 210 스킬·전 기체 밸런스로 파급된다.
 *
 * 되돌림은 **깎인 몫이 남아 있을 때만** 일어난다 — 기준선을 넘겨 회복시키면 페널티 없는
 * 순이득이 되고, 그 순간 카드의 대가가 사라진다.
 */
export function growthOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  if (!carries(state, CARD_ASCENSION)) return;
  void target;
  const base = state.config.playerHp;
  if (player.maxHp >= base) return;
  const next = player.maxHp + ASCENSION_DASH_RECOVER;
  player.maxHp = next > base ? base : next;
  notifyCatalystFx(state, CARD_ASCENSION, CATALYST_FX.trigger, player.x, player.y);
  creditCatalyst(state, CARD_ASCENSION, ASCENSION_DASH_RECOVER);
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 growth 몫 — `id 12` 의 **이득**.
 *
 * *"넘긴 웨이브 수만큼 전리품 등급 확률이 오른다."* 근거는 `state.wave.segmentIndex` 다 —
 * 최대 HP 비율로 재던 3판 초안은 파워업 3종이 반대 방향으로 `maxHp` 를 올려 되먹임이 났다.
 *
 * ⚠️ **RNG 미소비** — 이미 굴린 롤에 곱하는 배율만 돌려준다.
 */
export function growthOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  if (!carries(state, CARD_ASCENSION)) return CATALYST_LOOT_NEUTRAL;
  void x;
  void y;
  void elite;
  const raw = 1 + state.wave.segmentIndex * ASCENSION_RARITY_STEP;
  ASCENSION_LOOT.rarity = raw > ASCENSION_RARITY_CAP ? ASCENSION_RARITY_CAP : raw;
  ASCENSION_LOOT.count = 1;
  return ASCENSION_LOOT;
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 growth 몫 — `id 12` 의 **대가**.
 *
 * 최대 HP 가 10% 깎이고 공격력이 10% 오른다. 현재 HP 는 새 상한으로 클램프한다 —
 * 안 하면 `hp > maxHp` 인 상태가 남아 HP 바가 상한 밖으로 삐져나온다.
 *
 * ⚠️ **최대 HP 는 1 밑으로 안 내려간다.** 0 이 되면 다음 피격 없이도 즉사 판정에 걸려
 * *"이득 없이 대가만"* 이 되고, 그것은 헌장 §축소 작동 규율 위반이다.
 */
export function growthOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  if (!carries(state, CARD_ASCENSION)) return;
  void prevSegment;
  void nextSegment;
  const player = state.entities[0];
  if (player === undefined || player.kind !== 'player') return;
  const before = player.maxHp;
  const cut = Math.round(before * ASCENSION_HP_MULT);
  player.maxHp = cut < 1 ? 1 : cut;
  if (player.hp > player.maxHp) player.hp = player.maxHp;
  state.weapon.damage = Math.round(state.weapon.damage * ASCENSION_DAMAGE_MULT * 100) / 100;
  notifyCatalystFx(state, CARD_ASCENSION, CATALYST_FX.trigger, player.x, player.y);
  // 최대 HP 하락은 **촉매가 플레이어를 깎은 것**이라 적 피해와 다른 색으로 나가야 한다
  // (헌장 §귀속 규율 3).
  notifyCatalystFx(state, CARD_ASCENSION, CATALYST_FX.selfHarm, player.x, player.y);
  missCatalyst(state, CARD_ASCENSION, before - player.maxHp);
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnCatalystHazards(state: WorldState): void {
  void state;
}
