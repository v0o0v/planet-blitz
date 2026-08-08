/**
 * 촉매 **연쇄 축**(id 20~24) — 카드 본체가 들어갈 자리.
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
import { ChainReactionSlot, readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import {
  CATALYST_LOOT_NEUTRAL,
  CATALYST_SEED_MARK,
  CATALYST_SHARD_MARK,
  CATALYST_TREE_MARK,
  carries,
  isCatalystHazardMarked,
  isCatalystShadow,
  spawnCatalystHazard,
} from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';
import { readMark, writeMark } from '../catalystMarks.js';
import { spawnDestructible, spawnLoot, hazardActive } from '../entities.js';

/** id 20 — slug `resonance`. 정본은 `src/data/catalysts.ts`. */
export const CARD_RESONANCE = 20;

/** id 21 — slug `catalysis`. 정본은 `src/data/catalysts.ts`. */
export const CARD_CATALYSIS = 21;

/** id 22 — slug `cascade`. 정본은 `src/data/catalysts.ts`. */
export const CARD_CASCADE = 22;

/** id 23 — slug `seeding`. 정본은 `src/data/catalysts.ts`. */
export const CARD_SEEDING = 23;

/** id 24 — slug `chainreaction`. 정본은 `src/data/catalysts.ts`. */
export const CARD_CHAINREACTION = 24;

// ---------------------------------------------------------------------------
// 눈금 — 카드 넷의 상수
// ---------------------------------------------------------------------------

/** `id 20` — 같은 종류 적이 **이 거리 안**에 모이면 동조한다. */
const RESONANCE_RADIUS = 220;

/** {@link RESONANCE_RADIUS} 의 제곱(적×적 O(n²) 를 도는 자리라 제곱근을 피한다). */
const RESONANCE_RADIUS_SQ = RESONANCE_RADIUS * RESONANCE_RADIUS;

/** `id 20` — 동조에 필요한 **같은 종류 적의 수**("셋이 모이면"). 자기 자신을 포함해 센다. */
const RESONANCE_GROUP = 3;

/**
 * `id 20` — 동조 중인 적의 **이동 속도 배율**(= *"강해진다"* 의 대가 쪽).
 *
 * 왜 hp 나 피해가 아니라 속도인가: 앵커 `onEnemyStepCatalyst` 는 **읽기 전용 배율 반환**이라
 * 적에 상태를 쓰지 않고도 매 틱 작동한다(그 앵커 주석이 쓰기를 명시적으로 금지한다). hp 를
 * 올리려면 "언제 되돌리는가"가 필요해 슬롯이나 추가 마크가 생기고, 그 순간 §A 가 흔들린다.
 */
const RESONANCE_SPEED_MULT = 1.25;

/**
 * `id 22` — 폭발이 **적에게** 주는 피해. 플레이어가 받는 값은 그 **절반**이고, 그 절반이
 * 해저드의 `damage` 칸에 실린다(아래 {@link cascadeOnDeath} §자기 피해 참조).
 */
const CASCADE_BLAST_DAMAGE = 60;

/** `id 22` — 폭발 반경. */
const CASCADE_BLAST_RADIUS = 150;

/**
 * `id 22` — 폭발의 활성 틱 수. **2 미만이면 폭발이 한 번도 안 때린다**(실측, 2026-08-08).
 *
 * `stepHazards` 는 `life` 를 **먼저** 깎고 0 이 되는 그 자리에서 `dead` 를 세운다
 * (`world.ts` `stepHazards`). 그런데 적↔해저드 피해 단계(`stepCatalystHazards`, 따라서
 * {@link chainOnCatalystHazards})는 **같은 틱의 뒤**(`resolveCollisions` 안)에서 돌며 `dead`
 * 를 거른다. 그래서 `activeTicks = 1` 로 스폰하면 피해 판정이 한 번도 안 일어난다.
 *
 * 2 로 두면 첫 활성 틱에 `life: 2 → 1`(살아 있음) 이라 그 틱에 정확히 **한 번** 때리고,
 * 다음 틱에 `1 → 0` 으로 죽는다. 플레이어 쪽 해저드 피해(`resolveCollisions` 의 충돌 질의)도
 * 같은 한 틱에만 걸린다 — 즉 이득도 대가도 정확히 1회다.
 */
const CASCADE_ACTIVE_TICKS = 2;

/** `id 21` — 미정착 결정의 충돌 반경(**조준 반경이 아니다** — 아래 HP 주석 참조). */
const SHARD_RADIUS = 30;

/**
 * `id 21` — 미정착 결정의 HP.
 *
 * ## ⚠️ 이 값은 이제 **깎이지 않는다** (판정 번복 기록 — 되돌리지 마라)
 * 종전 주석은 *"결정은 등재 대상이라 자동 조준의 표적이기도 하다 — 곁에 머무르면 플레이어의
 * 자동 사격이 자기 결정을 갉는다. 그것이 「바닥에 지켜야 할 것이 생긴다」의 실제 형태다"* 라고
 * 적고 있었고, 240 은 *"스쳐 지나가는 사격 한두 발로 즉시 잃지 않게"* 를 위한 값이었다.
 *
 * **그 설계는 뒤집혔다.** 이 게임에는 수동 조준이 없어 회피 수단이 위치뿐이라, 등재된 이상
 * 플레이어가 자기 보상을 안 부술 방법이 **원리적으로 없었다** — "지켜야 할 것"이 아니라 그냥
 * 갉히는 것이었다. 규칙 문장도 *"**적이 밟으면** 부서지고, 런을 이겨야 정착한다"* 뿐이라
 * 플레이어 파괴는 규칙에 없다. 그래서 결정은
 * {@link import('./shared.js').isCatalystEnemyOnlyObject} 로 갈라져 **조준 술어와 아군탄
 * 화이트리스트 양쪽에서 빠졌다**(격자 등록은 유지 — *"적이 밟으면"* 판정이 거기 걸려 있다).
 *
 * 지금 이 HP 를 깎는 경로는 없다 — {@link catalysisTick} 이 적 접촉 시 `hp = 0` 을 **직접**
 * 대입한다. 값은 남겨 둔다: `spawnDestructible` 이 인자로 요구하고, 0 을 주면 태어나는 순간
 * `hp <= 0` 이라 `compact` 가 같은 틱에 걷어 가 결정이 서지도 못한다.
 */
const SHARD_HP = 240;

/**
 * `id 21` — 결정의 **동시 생존 상한**. 상한에 닿으면 스폰만 생략한다(RNG 미소비라 이후 시드가
 * 안 밀린다 — `CATALYST_HAZARD_LIVE_CAP` 과 같은 형태).
 */
const SHARD_LIVE_CAP = 12;

/** `id 23` — 씨앗이 나무로 자라기까지의 틱(15초 × 60틱). */
const SEED_GROW_TICKS = 900;

/** `id 23` — 씨앗의 반경·HP. */
const SEED_RADIUS = 22;
const SEED_HP = 60;

/** `id 23` — 전리품 나무의 반경·HP. 씨앗보다 크다(화면에서 자란 것이 읽혀야 한다). */
const TREE_RADIUS = 44;
const TREE_HP = 200;

/** `id 23` — 나무가 열매를 떨구는 주기(틱)와 총 열매 수. */
const TREE_FRUIT_INTERVAL = 300;
const TREE_FRUIT_COUNT = 3;

/** `id 23` — 씨앗·나무의 동시 생존 상한(결정과 같은 사유). */
const SEED_LIVE_CAP = 12;

/** `id 23` — 씨앗을 먹은 적이 얻는 HP(= *"그 적이 강화된다"*). */
const SEED_EAT_HP = 40;

/** `id 23` — 열매 시드 파생 솔트. 런마다 고정이라 순수 파생이다. */
const SEED_FRUIT_SALT = 0x5eed_0017;

/** `id 23` — 열매의 등급 코드(0 = 일반). sim 은 아이템 값을 모른다(시드·등급코드만 싣는다). */
const FRUIT_RARITY_CODE = 0;

/**
 * `id 22` — 사망 지점 폭발 해저드의 판별자(`hazard.ownerId`). `DRONE_MARK` 선례의 큰 상수다.
 *
 * 왜 `enemyType` 이 아닌가: 그 칸은 이미 {@link import('./shared.js').HAZARD_CATALYST} 가 쓴다
 * (촉매 해저드 전체의 서브타입). 그 안에서 **어느 카드의 해저드인가**를 더 갈라야 하므로
 * `ownerId` 를 쓴다 — 촉매 해저드는 오염 노드·침공 설비와 달리 `ownerId` 에 아무 뜻도 안 싣는다
 * (`spawnCatalystHazard` 이 0 을 넘긴다).
 */
const CASCADE_BLAST_MARK = 0xca_5cad;

// ---------------------------------------------------------------------------
// 틱-국소 스크래치 — **같은 `stepWorld` 호출 안에서만 산다**
// ---------------------------------------------------------------------------
//
// 두 배열 다 ①{@link chainOnCatalystHazards} 첫 줄에서 비우고 ②같은 틱 안에서 채워 같은 틱
// 안에서 소비한다. 틱 경계를 넘지 않으므로, 두 월드를 교대로 `stepWorld` 하는 재현성 검증
// (`determinismGate`)에서 서로를 오염시킬 수 없다 — `catalyst/resource.ts` 의
// `EXTRACTION_CRYSTALS` 와 같은 규율이다.

/**
 * `id 22` — 이번 틱 **폭발로 죽인 적**의 좌표.
 *
 * 채우는 곳은 {@link chainOnCatalystHazards}(`resolveCollisions` 안), 읽는 곳은
 * {@link chainOnLootRoll}(같은 틱의 `compact()` 안)이다. 좌표로 맞추는 이유: 전리품 앵커는
 * `(x, y, elite)` 만 주고 **개체를 안 준다**. 두 지점 사이에 적이 움직이는 단계는 없으므로
 * (`stepEnemies` 는 이미 끝났다) 부동소수 등가 비교가 성립한다.
 */
const CASCADE_KILLS: { x: number; y: number }[] = [];

/**
 * `id 21` — 이번 틱 전리품 롤이 난 자리(= 결정이 박힐 자리).
 *
 * 채우는 곳은 {@link chainOnLootRoll}(`compact()` 의 엔티티 순회 **안** — 스폰 금지), 비우는
 * 곳은 {@link chainOnEnemyDeath}(같은 `compact()` 의 `state.entities = survivors` **뒤** —
 * 스폰 안전)이다. 전리품 롤은 `e.kind === 'enemy' && e.hp <= 0` 분기 **안**에서만 나므로
 * (`world.ts` `compact`), 여기 담긴 항목은 같은 틱의 사망 통지에 **반드시** 도달한다.
 */
const CATALYSIS_SPOTS: { x: number; y: number }[] = [];

// ---------------------------------------------------------------------------
// 공용 리프 — 순수 파생·술어
// ---------------------------------------------------------------------------

/**
 * SplitMix32 계열 정수 해시. **RNG 를 한 칸도 소비하지 않는 파생**(헌장 §공통-B(a)).
 * `drops.ts`/`catalyst/refine.ts` 의 동명 함수와 같은 산식이고, import 하지 않는 이유도 같다
 * (이 디렉터리는 리프를 유지한다).
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 살아 있는 잡몹인가 — 그림자(`id 36`)는 죽일 수도 표식을 찍을 수도 없다. */
function isLiveMob(e: Entity): boolean {
  return e.kind === 'enemy' && !e.dead && !isCatalystShadow(e);
}

/** 이 파괴물이 `id 21` 의 미정착 결정인가. */
function isShard(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === CATALYST_SHARD_MARK && !e.dead;
}

/** 이 파괴물이 `id 23` 의 씨앗인가(아직 안 자랐다). */
function isSeed(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === CATALYST_SEED_MARK && !e.dead;
}

/** 이 파괴물이 `id 23` 의 전리품 나무인가. */
function isTree(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === CATALYST_TREE_MARK && !e.dead;
}

/** 두 원이 겹치는가(격자 broad-phase 뒤의 정확 판정과 같은 산식). */
function overlaps(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** 플레이어(엔티티 0번). 없으면 `undefined`(월드 초기화 직후·테스트 하네스 방어). */
function playerOf(state: WorldState): Entity | undefined {
  return state.entities[0];
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * 여기 실린 것은 셋이고 전부 **틱마다 다시 재는 것**이지 단조 누적이 아니다(헌장 §틱 규율):
 *  - `id 20` 동조 표식 재계산(매 틱 세우고 매 틱 지운다 — 아래 §3상태 없음)
 *  - `id 21` 결정의 적 접촉 파괴 + 살아 있는 결정 수를 슬롯에 다시 적기
 *  - `id 23` 씨앗 성장·나무 결실·적 포식
 *
 * ⚠️ 스폰(열매)은 `state.entities` 순회 **밖**에서 한다 — 순회 중에 배열을 늘리면 같은 틱의
 * 뒤 단계가 반쯤 갱신된 목록을 본다.
 */
export function chainOnTick(state: WorldState, player: Entity): void {
  resonanceTick(state);
  catalysisTick(state);
  seedingTick(state, player);
}

// ---------------------------------------------------------------------------
// id 20 resonance (표시명 **동조**) — 같은 종류 셋이 모이면 동조하고, 하나가 죽으면 같이 죽는다
// ---------------------------------------------------------------------------
//
// ## `attuned` 는 **3상태가 필요 없다**
// `plunder` 비트가 표(`1 = 강탈 가능`)와 코드(`1 = 강탈 완료`)로 뒤집힌 것은 그 카드가
// "아직 안 뜯김 / 뜯을 수 있음 / 뜯김" 셋을 1비트에 담으려 했기 때문이다. 동조는 그 문제가
// 없다 — **매 틱 통째로 다시 계산**하므로 "해제됨"이라는 상태가 존재하지 않고, 값의 뜻은
// *"지금 이 틱에 동조 중인가"* 하나다(0 = 아니다, 1 = 맞다). 무촉매 런은 비트가 0 이라 읽기가
// 항상 거짓이고, 쓰기는 전부 `carries` 게이트 안쪽이다.

/**
 * 동조 표식을 이번 틱 값으로 다시 세운다. **적 `aux0` 의 `attuned` 비트 1개만** 쓴다
 * (`aux1` 은 손대지 않는다 — `MID_CLASH_LEADER_MARK` 가 매 런 확정 점유한다).
 *
 * 같은 종류 판정은 `enemyType` 등가다. 자기 자신을 포함해 {@link RESONANCE_GROUP} 마리 이상이
 * {@link RESONANCE_RADIUS} 안에 있으면 동조다.
 *
 * ⚠️ 공간 해시를 쓰지 않고 잡몹만 모아 O(n²) 를 돈다. `onTickCatalyst` 는 `resolveCollisions`
 * **앞**이라 `state.grid` 가 **지난 틱 좌표**로 차 있기 때문이다 — 낡은 격자로 질의하면 같은
 * 시드에서 표식이 한 틱씩 밀려 화면과 규칙이 갈린다. 비용은 `carries` 게이트 안쪽이고
 * 잡몹 수만큼이라(웨이브 설계가 상한을 준다) 감당된다.
 */
function resonanceTick(state: WorldState): void {
  if (!carries(state, CARD_RESONANCE)) return;
  const mobs: Entity[] = [];
  for (const e of state.entities) {
    if (isLiveMob(e)) mobs.push(e);
  }
  for (const a of mobs) {
    let same = 0;
    for (const b of mobs) {
      if (b.enemyType !== a.enemyType) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy <= RESONANCE_RADIUS_SQ) same++;
      if (same >= RESONANCE_GROUP) break;
    }
    writeMark(a, 'attuned', same >= RESONANCE_GROUP ? 1 : 0);
  }
}

/**
 * 동조 중인 적 하나가 죽은 그 자리에서 **나머지를 즉사**시킨다.
 *
 * ## 왜 전리품을 따로 곱하지 않는가
 * 규칙 문장이 *"나머지가 즉사하며 셋 몫의 전리품을 전부 뱉는다"* 다. 여기서 즉사시킨 적들은
 * 같은 틱의 `compact()` 가 **각자의 처치·젬·엘리트 드랍으로** 잡으므로, 셋 몫은 배율이 아니라
 * **실제 세 마리의 사망**으로 나온다. 배율을 따로 얹으면 같은 것을 두 번 주게 된다.
 *
 * ## RNG
 * 이 함수는 난수를 굴리지 않는다. 즉사한 적들이 `compact()` 에서 자기 드랍 게이트를 굴리는
 * 것은 **적이 죽었기 때문**이지 이 카드가 재롤한 것이 아니다(`id 24` 의 전이 처치와 같다).
 */
function resonanceChainDeath(state: WorldState, dead: Entity): void {
  if (readMark(dead, 'attuned') === 0) return;
  let felled = 0;
  for (const e of state.entities) {
    if (e === dead || !isLiveMob(e)) continue;
    if (e.enemyType !== dead.enemyType) continue;
    if (readMark(e, 'attuned') === 0) continue;
    const dx = e.x - dead.x;
    const dy = e.y - dead.y;
    if (dx * dx + dy * dy > RESONANCE_RADIUS_SQ) continue;
    e.hp = 0;
    // ⚠️ **명시적 사망 마킹** — `compact()` 의 첫 줄이 `if (!e.dead)` 라, hp 만 0 으로 만들면
    //    처치도 젬도 전리품도 안 나오는 좀비가 된다(`activeTypes.ts` 의 `blastDamage` 선례).
    e.dead = true;
    felled++;
  }
  if (felled > 0) notifyCatalystFx(state, CARD_RESONANCE, CATALYST_FX.trigger, dead.x, dead.y);
}

// ---------------------------------------------------------------------------
// id 21 catalysis — 촉매가 보유함으로 안 가고 바닥에 결정으로 박힌다
// ---------------------------------------------------------------------------

/**
 * 결정을 **적이 밟으면 부순다**.
 *
 * ## ⛔ 정착 수가 슬롯이 아니라 **귀속 원장**으로 나가는 사유 (설계 정본과 어긋난 자리)
 * 인계는 *"sim 이 정착한 결정 수를 실제로 세어 `CatalystDropInput.catalystDropMult` 로 넘긴다"*
 * 를 요구하고, 그 채널은 슬롯 한 벌(`catalystSettlementOf`)이다. 그런데 **`id 21` 에 줄 슬롯이
 * 남아 있지 않다** — 배정표의 예비 두 칸이 둘 다 이미 소비됐다(22 = `GreedSlot.Pending`,
 * 23 = `AfterburnerSlot`). `id 21` 은 공용이라 특산 구역(15..19)도 공명 구역(20..21)도 못 쓰고,
 * 폭을 25 로 늘리면 `tests/catalystFoundation.test.ts` 가 잠근 `CATALYST_SLOT_COUNT === 24` 가
 * 깨져 **다른 레인 전부를 빨갛게 만든다.**
 *
 * 그래서 같은 수를 **귀속 원장**(`catalystContributionsOf` → `RunResult`)으로 낸다:
 * ```
 * 정착 수 = contribution(id 21).earned − contribution(id 21).missed
 * ```
 *  - `earned` — 박힌 결정 수(스폰마다 +1, {@link chainOnEnemyDeath}).
 *  - `missed` — 잃은 결정 수(파괴마다 +1, {@link chainOnDestructibleDestroyed} **한 곳**).
 *
 * 잃는 경로가 셋(적 접촉·플레이어 오사·청크 밖 컬링)인데 감산을 파괴 앵커 **한 곳**으로 모은
 * 것이 핵심이다 — 경로마다 적으면 하나만 빠뜨려도 화면과 정산이 조용히 갈린다.
 *
 * ⚠️ 배율은 **카드를 꽂았다는 사실에서 파생하면 안 된다**(헌장 §상한 근거 · 인계 §5-3). 위
 * 차분이 그 유일 근거다. **승리 여부 게이트는 정산의 몫**이다(*"런을 이겨야 정착한다"*).
 */
function catalysisTick(state: WorldState): void {
  if (!carries(state, CARD_CATALYSIS)) return;
  for (const s of state.entities) {
    if (!isShard(s)) continue;
    for (const e of state.entities) {
      if (!isLiveMob(e)) continue;
      if (!overlaps(s.x, s.y, s.radius, e.x, e.y, e.radius)) continue;
      s.hp = 0;
      s.dead = true;
      // 감산은 여기가 아니라 파괴 앵커가 진다(위 §정착 수) — 여기서 또 빼면 이중 계상이다.
      notifyCatalystFx(state, CARD_CATALYSIS, CATALYST_FX.selfHarm, s.x, s.y);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// id 23 seeding — 씨앗이 나무가 되어 열매를 떨구지만, 그 전에 적이 먹으면 적이 강해진다
// ---------------------------------------------------------------------------

/**
 * 씨앗의 발아·포식과 나무의 결실을 한 번에 돈다.
 *
 * ⚠️ 열매 스폰은 순회 **밖**이다(좌표를 모아 뒤에서 낳는다). 순회 중에 `state.entities` 를
 * 늘리면 같은 틱의 뒤 단계가 반쯤 갱신된 배열을 본다.
 */
function seedingTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_SEEDING)) return;
  const fruits: { x: number; y: number; seed: number }[] = [];
  for (const s of state.entities) {
    if (isSeed(s)) {
      // 적이 먼저 밟으면 **그 적이 씨앗을 먹고 강화된다** — 이것이 이 카드의 대가다.
      let eaten: Entity | undefined;
      for (const e of state.entities) {
        if (!isLiveMob(e)) continue;
        if (!overlaps(s.x, s.y, s.radius, e.x, e.y, e.radius)) continue;
        eaten = e;
        break;
      }
      if (eaten !== undefined) {
        s.hp = 0;
        s.dead = true;
        eaten.maxHp += SEED_EAT_HP;
        eaten.hp += SEED_EAT_HP;
        missCatalyst(state, CARD_SEEDING, 1);
        notifyCatalystFx(state, CARD_SEEDING, CATALYST_FX.selfHarm, s.x, s.y);
        continue;
      }
      if (s.timer > 0) s.timer--;
      if (s.timer > 0) continue;
      // 발아 — 같은 개체를 나무로 바꾼다. 새로 낳지 않는 이유는 순회 중 배열 변형 금지이고,
      // 덤으로 "씨앗이 자란 그 자리"가 좌표로 자명해진다.
      s.ownerId = CATALYST_TREE_MARK;
      s.radius = TREE_RADIUS;
      s.hp = TREE_HP;
      s.maxHp = TREE_HP;
      s.timer = TREE_FRUIT_INTERVAL;
      s.pierce = TREE_FRUIT_COUNT; // 남은 열매 수(파괴물의 `pierce` 는 비어 있는 칸이다)
      notifyCatalystFx(state, CARD_SEEDING, CATALYST_FX.trigger, s.x, s.y);
      continue;
    }
    if (!isTree(s)) continue;
    if (s.timer > 0) s.timer--;
    if (s.timer > 0) continue;
    if (s.pierce <= 0) continue;
    // ⚠️ **RNG 미소비** — 열매 시드는 좌표·틱·남은 열매 수의 순수 파생이다(`bonusLootSeeds` 선례).
    fruits.push({ x: s.x, y: s.y, seed: mix32((s.id << 8) ^ s.pierce, SEED_FRUIT_SALT ^ state.tick) });
    s.pierce--;
    s.timer = TREE_FRUIT_INTERVAL;
    if (s.pierce <= 0) {
      // 다 떨군 나무는 스스로 사라진다 — 안 지우면 조준 대상이 단조 증가한다.
      s.hp = 0;
      s.dead = true;
    }
  }
  for (const f of fruits) {
    spawnLoot(state, f.x, f.y, f.seed, FRUIT_RARITY_CODE);
    notifyCatalystFx(state, CARD_SEEDING, CATALYST_FX.trigger, f.x, f.y);
  }
  void player;
}

/** 씨앗·나무를 합친 현재 생존 수(상한 판정용). */
function seedlingCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (isSeed(e) || isTree(e)) n++;
  }
  return n;
}

/** 결정의 현재 생존 수(상한 판정용). */
function shardCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (isShard(e)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// id 22 cascade — 적이 죽을 때 폭발하고, 그 폭발은 플레이어도 태운다(피해 절반)
// ---------------------------------------------------------------------------

/**
 * 사망 지점에 폭발을 **엔티티로** 세운다(대기 큐를 두면 신규 상태가 되어 §B 다).
 *
 * ## ⭐ 자기 폭발 피해**만** 절반으로 가르는 방법
 * 감쇠 사슬 칸(`onDamageChainCatalyst`)은 **피해원을 안 받는다** — 거기서 0.5 를 곱하면 카드가
 * *"받는 모든 피해 절반"* 이 되어 규칙 문장과 화면이 갈린다(그 함수 주석이 그 사유를 적었다).
 * 그래서 사슬을 **아예 건드리지 않고**(→ {@link chainOnDamageChain} 은 중립 1 을 그대로 돌려준다)
 * 값을 실을 자리를 바꿨다:
 *
 *  - 해저드의 `damage` 칸에는 **플레이어가 받을 값**(= 절반)을 싣는다. 플레이어 쪽 해저드 피해는
 *    `resolveCollisions` 의 충돌 질의가 `t.damage` 를 그대로 읽으므로, 이 한 줄로 자기 피해가
 *    절반이 되고 **다른 피해원은 한 톨도 안 건드린다.**
 *  - 적에게 주는 값은 {@link chainOnCatalystHazards} 가 `damage * 2` 로 되돌려 쓴다. 그 루프는
 *    이 카드가 소유하므로(아래 §단발) 두 값이 갈릴 여지가 없다.
 *
 * ## 단발이라 공용 루프가 안 때린다 — 그래서 적 피해는 이 카드가 직접 돈다
 * `stepCatalystHazards` 의 공용 루프는 **지속형(`phase === 1`)만** 때린다(`continuous` 인자).
 * 폭발은 단발이라 `phase === 0` 이고, 그 루프의 첫 줄에서 걸러진다 — 즉 공용 루프와 이 카드의
 * 전용 루프가 **같은 해저드를 두 번 때릴 수 없다.**
 */
function cascadeOnDeath(state: WorldState, x: number, y: number): void {
  const h = spawnCatalystHazard(
    state,
    x,
    y,
    CASCADE_BLAST_RADIUS,
    0, // windup 0 — 사망과 동시에 터진다(예열을 두면 "처치마다 폭발"이 화면에서 안 읽힌다)
    CASCADE_ACTIVE_TICKS,
    CASCADE_BLAST_DAMAGE / 2, // ⚠️ 플레이어가 받을 값. 적 피해는 이 값의 2배다(위 §자기 피해)
    false, // 단발 — 위 §단발
    CASCADE_BLAST_MARK,
  );
  if (h === undefined) return; // 동시 상한 도달. RNG 미소비라 이후 시드가 안 밀린다.
  notifyCatalystFx(state, CARD_CASCADE, CATALYST_FX.trigger, x, y);
}

// ---------------------------------------------------------------------------
// id 24 chainreaction — **배선 완료**. 거동 불변으로 `catalystHooks.ts` 에서 옮겨 왔다
// ---------------------------------------------------------------------------
//
// ⚠️ 카드 소지 게이트(`carries`)는 **호출부(`catalystHooks.ts`)에 그대로 남아 있다.** 옮기면서
// 게이트 위치를 바꾸지 않았다 — 게이트를 안쪽으로 밀면 호출 횟수가 달라져 계측이 갈린다.

/**
 * `id 24 chainreaction` — **받은 피해를 가장 가까운 잡몹에게 전이하고, 전이한 만큼 최대 HP
 * 상한을 깎는다.** 복구는 {@link chainReactionOnTick} 의 세그먼트 전환 감지가 한다.
 *
 * ## 왜 이 앵커에서 적을 직접 깎아도 격추가 정상 집계되는가
 * 이 앵커는 `stepPlayer` 안에서 불리고, 격추 집계·젬·엘리트 루팅의 **단일 수렴점**인
 * `compact()` 는 같은 틱의 **뒤**에서 돈다. 그래서 여기서 hp 를 0 이하로 만든 적은 이번 틱에
 * 그대로 처치로 잡힌다.
 *
 * ⚠️ 단 **`dead` 를 직접 세워야 한다.** `compact()` 의 첫 줄이 `if (!e.dead) { survivors.push;
 * continue; }` 라, hp 만 0 으로 만들고 마킹을 빠뜨리면 **처치도 젬도 전리품도 안 나오는
 * 좀비**가 된다(`activeTypes.ts` 의 `blastDamageAt` 이 정확히 그 형태다).
 *
 * ## 표적을 못 찾으면 대가도 없다
 * 화면에 잡몹이 하나도 없는 구간(보스 단독 등)에서는 전이도 상한 하락도 일어나지 않는다.
 * 헌장 §축소 작동 규율이 요구하는 것은 "무효 조합에서도 축소된 형태로 작동"이지 "표적이 없어도
 * 대가만 물린다"가 아니다 — 이득 없는 대가는 규칙 한 문장의 인과를 끊는다.
 *
 * ## RNG 미소비
 * 이 함수는 난수를 한 칸도 굴리지 않는다. 표적 선택은 `state.entities` **순회 순서 + 동률은
 * 먼저 만난 쪽**이라 결정론적이다.
 */
export function chainReactionOnDamaged(state: WorldState, player: Entity, dmg: number): void {
  // 상한 하락이 정수여야 하므로(슬롯 값 규약 2) 전이량도 같은 정수로 맞춘다. 접촉 피해는
  // 엘리트 배율 때문에 소수일 수 있다 — 여기서 한 번 접고 그 값 하나를 두 곳에 쓴다.
  const transfer = Math.round(dmg);
  if (transfer <= 0) return;
  let target: Entity | undefined;
  let bestD2 = 0;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (target === undefined || d2 < bestD2) {
      target = e;
      bestD2 = d2;
    }
  }
  if (target === undefined) return;
  target.hp -= transfer;
  if (target.hp <= 0) target.dead = true;
  // 대가 — 하한 1. 0 까지 허용하면 페널티 자체가 사망 원인이 되어 헌장 §페널티 3(되돌릴 수단이
  // 규칙 안에 있어야 한다)이 무의미해진다. 실제로 깎인 양만 슬롯에 쌓아 복구가 되감기게 한다.
  const cut = Math.min(transfer, player.maxHp - 1);
  if (cut <= 0) return;
  player.maxHp -= cut;
  // 상한이 현재 hp 아래로 내려오면 현재 hp 도 따라 내려온다 — 이것이 화면에서 읽히는 대가다.
  if (player.hp > player.maxHp) player.hp = player.maxHp;
  const slots = state.catalystSlots;
  writeCatalystSlot(
    slots,
    ChainReactionSlot.MaxHpCut,
    readCatalystSlot(slots, ChainReactionSlot.MaxHpCut) + cut,
  );
}

/**
 * `id 24 chainreaction` 의 **되돌릴 수단** — 세그먼트(카탈로그의 "웨이브")가 넘어가면 그 동안
 * 깎인 최대 HP 상한이 통째로 복구된다.
 *
 * 전환 감지를 `state.wave.segmentIndex` 의 **순수 파생**으로 한 이유: 이 값은 이미 해시에
 * 접히므로(`replay.ts`) 새 상태 없이 "언제 넘어갔는가"를 틱의 닫힌 함수로 쓸 수 있다. 헌장이
 * `침식` 강공명에서 이벤트 의존(리더 처치)을 같은 사유로 기각하고 이 필드로 바꿔 적었다.
 *
 * ⚠️ 현재 hp 는 **되돌리지 않는다.** 깎인 것은 상한이고, 복구는 상한을 되돌려 다시 회복할
 * 여지를 주는 것이지 공짜 회복이 아니다.
 */
export function chainReactionOnTick(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  const mark = state.wave.segmentIndex + 1; // +1 은 값 규약 1(0 = "없음") — 슬롯 doc 참조.
  const seen = readCatalystSlot(slots, ChainReactionSlot.SegmentMark);
  if (seen === mark) return;
  if (seen !== 0) {
    const cut = readCatalystSlot(slots, ChainReactionSlot.MaxHpCut);
    if (cut > 0) {
      player.maxHp += cut;
      writeCatalystSlot(slots, ChainReactionSlot.MaxHpCut, 0);
    }
  }
  writeCatalystSlot(slots, ChainReactionSlot.SegmentMark, mark);
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 chain 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function chainOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 chain 몫.
 *
 * ⚠️ **일부러 중립 1 이다 — 미배선이 아니라 배선하지 않기로 한 결과다.** 이 칸의 유일한 후보인
 * `id 22 cascade`(자기 폭발 피해 절반)를 여기 얹으면 시그니처가 피해원을 안 받아 **받는 모든
 * 피해가 절반**이 된다. 그 카드는 값을 실을 자리를 옮겨 해결했다 — 사유 전문은
 * {@link cascadeOnDeath} §자기 폭발 피해만 절반으로 가르는 방법.
 */
export function chainOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 chain 몫 —
 * **`id 20` 동조 연쇄사**의 방아쇠다.
 *
 * ⚠️ 이 앵커는 **아군탄 명중 경로만** 덮는다(화염 DoT·전격·폭탄 기물은 안 온다 — 디스패처
 * 주석). 그래서 동조 연쇄는 *쏴서 죽였을 때* 일어난다. 규칙 문장(*"하나를 죽이면"*)이 그리는
 * 그림과 같으므로 축소가 아니라 정의다.
 */
export function chainOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void dmg;
  void source;
  if (!carries(state, CARD_RESONANCE)) return;
  if (target.kind !== 'enemy' || target.hp > 0) return;
  resonanceChainDeath(state, target);
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 chain 몫 — **스폰이 안전한 유일
 * 지점**이다(`state.entities = survivors` 뒤). `id 21`·`id 22`·`id 23` 셋이 여기서 낳는다.
 */
export function chainOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void elite;

  // ── id 22 cascade — 사망 지점 폭발 ────────────────────────────────────────
  if (carries(state, CARD_CASCADE)) cascadeOnDeath(state, x, y);

  // ── id 21 catalysis — 이번 틱 전리품 롤이 난 자리에 결정을 박는다 ─────────
  if (CATALYSIS_SPOTS.length > 0) {
    if (carries(state, CARD_CATALYSIS)) {
      let live = shardCount(state);
      for (const spot of CATALYSIS_SPOTS) {
        // 상한 도달 시 **스폰만 생략**한다(RNG 미소비라 이후 시드가 안 밀린다).
        if (live >= SHARD_LIVE_CAP) break;
        const s = spawnDestructible(state, spot.x, spot.y, SHARD_RADIUS, SHARD_HP, 0);
        s.ownerId = CATALYST_SHARD_MARK;
        live++;
        // 정착 수의 **더하는 쪽**(빼는 쪽은 파괴 앵커 하나 — `catalysisTick` §정착 수).
        creditCatalyst(state, CARD_CATALYSIS, 1);
        notifyCatalystFx(state, CARD_CATALYSIS, CATALYST_FX.trigger, spot.x, spot.y);
      }
    }
    CATALYSIS_SPOTS.length = 0;
  }

  // ── id 23 seeding — 처치한 자리에 씨앗이 남는다 ───────────────────────────
  if (carries(state, CARD_SEEDING) && seedlingCount(state) < SEED_LIVE_CAP) {
    const seed = spawnDestructible(state, x, y, SEED_RADIUS, SEED_HP, 0);
    seed.ownerId = CATALYST_SEED_MARK;
    seed.timer = SEED_GROW_TICKS;
    notifyCatalystFx(state, CARD_SEEDING, CATALYST_FX.trigger, x, y);
  }
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 chain 몫 — `id 22` 의 **두 배**와
 * `id 21` 의 **결정 자리 기록**.
 *
 * ⚠️ **RNG 재롤 금지.** 이 자리는 이미 뽑힌 결과에 곱하는 자리이고, 여기서 난수를 굴리면 같은
 * 시드의 드랍 스트림이 통째로 밀린다. 아래 두 분기 다 난수를 한 칸도 안 쓴다.
 *
 * ⚠️ 이 호출은 `compact()` 의 엔티티 순회 **안**이라 스폰이 금지다. `id 21` 은 좌표만 적어 두고
 * 같은 틱의 {@link chainOnEnemyDeath}(순회 밖)에서 낳는다.
 */
export function chainOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  let count = 1;

  // ── id 22 cascade — 폭발로 죽인 적은 전리품을 두 배 뱉는다 ────────────────
  if (carries(state, CARD_CASCADE)) {
    for (const k of CASCADE_KILLS) {
      if (k.x === x && k.y === y) {
        count *= 2;
        break;
      }
    }
  }

  // ── id 21 catalysis — 그 자리를 적어 둔다(스폰은 순회 밖에서) ─────────────
  // 보스 확정 드랍(`elite === false`)은 제외한다: 보스 격추는 곧 런 종료라 그 자리에 박힌
  // 결정이 정착 판정까지 살아 있을 시간이 없고, 무엇보다 보스 분기에는 짝이 되는 사망 통지가
  // 없어 스크래치를 비울 지점이 없다(`world.ts` `compact` 의 보스 분기).
  if (elite && carries(state, CARD_CATALYSIS)) CATALYSIS_SPOTS.push({ x, y });

  return count === 1 ? CATALYST_LOOT_NEUTRAL : { rarity: 1, count };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 chain 몫. **미배선**(위 §주석). */
export function chainOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 chain 몫 — `id 20` 동조 중인
 * 적이 **빨라진다**(= *"강해진다"*).
 *
 * ⚠️ 여기서 `e` 에 **쓰지 않는다**(앵커 계약). 표식은 {@link resonanceTick} 이 세우고 이 자리는
 * 읽기만 한다. 무촉매 런은 비트가 0 이라 항상 1 을 돌려주므로 호출부가 def 복제조차 안 한다.
 */
export function chainOnEnemyStep(state: WorldState, e: Entity): number {
  if (!carries(state, CARD_RESONANCE)) return 1;
  return readMark(e, 'attuned') === 0 ? 1 : RESONANCE_SPEED_MULT;
}

/**
 * {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 chain 몫 —
 * `id 21` 결정 · `id 23` 씨앗·나무는 **기본 젬을 떨구지 않는다**.
 *
 * 억제하지 않으면 결정·씨앗 하나마다 젬이 하나씩 생겨, 카드에 없는 경험치 유입이 된다
 * (`spawnDestructible` 의 `xpValue` 를 0 으로 넘겼지만 그래도 `spawnGem(…, 0)` 이 한 개 선다).
 *
 * ⚠️ 여기서 `!e.dead` 술어를 쓰면 안 된다 — 이 앵커는 `compact()` 안이라 `e.dead` 가 **이미
 * 참**이다. 그래서 마커만 본다.
 *
 * ## 침식 강공명 '함몰' 진입점
 * 무너지는 자리의 씨앗·나무는 *"사라지기 전에 열매를 전부 떨군다"* 가 규칙이다. 그 배선은 공명
 * 레인의 몫이고, 이 쪽은 **진입점만 열어 둔다**: 공명이 `pierce`(남은 열매 수)를 읽어 좌표에
 * 열매를 낳고 `pierce = 0` 으로 만든 뒤 `dead` 를 세우면 된다. 좌표·잔량이 전부 개체 필드라
 * 이 모듈을 부르지 않고도 성립한다.
 */
export function chainOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  if (e.ownerId === CATALYST_SHARD_MARK) {
    // 정착 수의 **빼는 쪽 유일 지점**(적 접촉·플레이어 오사·컬링이 전부 여기로 수렴한다).
    missCatalyst(state, CARD_CATALYSIS, 1);
    return true;
  }
  return e.ownerId === CATALYST_SEED_MARK || e.ownerId === CATALYST_TREE_MARK;
}

/**
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 chain 몫 — `id 22` 폭발이
 * **적을 때리는 전용 루프**.
 *
 * 공용 루프는 지속형만 때리고 폭발은 단발이라, 이 카드가 자기 해저드의 적 피해를 직접 진다
 * (사유 전문은 {@link cascadeOnDeath}). 자리는 격자 삽입 **직후**라 좌표가 이번 틱 기준이고
 * 아직 아무 hp 도 안 깎였다.
 */
export function chainOnCatalystHazards(state: WorldState): void {
  // 틱-국소 스크래치는 **여기서 비운다**(§틱-국소 스크래치). 카드 소지와 무관하게 비워야
  // 카드가 없는 런에서 옛 값이 남지 않는다.
  CASCADE_KILLS.length = 0;
  CATALYSIS_SPOTS.length = 0;
  if (!carries(state, CARD_CASCADE)) return;
  const player = playerOf(state);
  for (const h of state.entities) {
    if (h.dead || !isCatalystHazardMarked(h, CASCADE_BLAST_MARK)) continue;
    if (!hazardActive(h)) continue;
    // 한 폭발은 **한 번만** 때린다. 활성 창이 1틱이라 지금도 그렇지만, 표식을 세워 두면 창이
    // 늘어나도 규칙(*"죽을 때 폭발한다"* — 지속 장판이 아니다)이 유지된다.
    if (h.pierce !== 0) continue;
    h.pierce = 1;
    const dmg = h.damage * 2; // `damage` 칸에는 **플레이어가 받을 절반**이 실려 있다.
    state.grid.query(h.x, h.y, h.radius, (t) => {
      if (t.dead) return;
      if (t.kind !== 'enemy' && t.kind !== 'boss') return;
      if (isCatalystShadow(t)) return; // `id 36` 그림자는 죽일 수 없다(공용 루프와 같은 규율).
      if (!overlaps(h.x, h.y, h.radius, t.x, t.y, t.radius)) return;
      t.hp -= dmg;
      if (t.hp <= 0) {
        // ⚠️ **명시적 사망 마킹** — `blastDamage` 가 이것을 빠뜨려 좀비를 만든 선례가 있다.
        t.dead = true;
        // 전리품 두 배 판정용 좌표. 같은 틱의 `compact()` 가 읽는다.
        if (t.kind === 'enemy') CASCADE_KILLS.push({ x: t.x, y: t.y });
      }
    });
    // **자기 피해는 촉매 전용 채널로** 낸다(헌장 §귀속 3: 적 피해와 다른 색·다른 사운드).
    // 실제 hp 차감은 이 틱 뒤 `resolveCollisions` 의 충돌 질의가 `h.damage`(= 절반)로 한다 —
    // 즉 여기서는 **통지만** 하고 피해를 두 번 주지 않는다.
    if (player !== undefined && overlaps(h.x, h.y, h.radius, player.x, player.y, player.radius)) {
      notifyCatalystFx(state, CARD_CASCADE, CATALYST_FX.selfHarm, player.x, player.y);
    }
  }
}
