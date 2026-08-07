/**
 * **촉매 48종 배선의 디스패치 면**(ADR-0052 재구축 공유 기반).
 *
 * S0 은 **자리만** 만들었다(전 분기 공백). 배선 레인이 카드를 하나씩 켜므로 아래 분기는
 * 점점 찬다 — 지금 켜진 것은 `id 9 epiphany` · `id 14 mastery` · `id 24 chainreaction` 셋이고
 * 나머지는 여전히 공백이며 **그 사유가 함수마다 주석에 적혀 있다**(누락과 미배선을 구별해라).
 *
 * ⚠️ 켜진 분기도 **전부 카드 소지 게이트 안쪽**이라 무촉매 런은 첫 줄
 * (`if (!state.catalystOn) return;`)에서 빠져나가고, 그래서 골든·침공 해시가 **바이트 불변**이다
 * (`scripts/catalystByteInvariance.ts` 의 sha256 이 그 물증이다).
 *
 * ## 왜 `skillHooks.ts` 와 파일을 가르는가
 * 스킬 앵커 9개의 본체는 전부 이 두 줄로 시작한다:
 * ```ts
 * if (!state.skillsOn) return;   // = 스킬 투자가 하나라도 있는가
 * switch (state.sigBit) { … }    // = 기체 시그니처 디스패치
 * ```
 * 촉매는 ①스킬 투자와 무관하고 ②기체와 무관하다. **무투자 런에 촉매만 켠 경우 앵커가 첫
 * 줄에서 즉시 반환**하고, 켜지더라도 `sigBit` switch 에 촉매가 들어갈 `case` 가 없다.
 * → 앵커를 **그대로** 재사용할 수 있는 촉매는 0종이다(지점은 8/9 가 재사용 가능하다).
 *
 * 그래서 앵커 본체를 **스킬 디스패치 / 촉매 디스패치 두 호출로 쪼개고** 파일을 갈랐다.
 * 안 그러면 7 스킬 레인 + 촉매 레인이 **같은 파일의 같은 9개 함수를 동시에** 만져, S0 가
 * 격리를 `world.ts` 에서 이 모듈로 옮겨 온 이득이 그대로 사라진다.
 *
 * ## 전 디스패치 공통 계약
 *  - 첫 줄은 **항상** `if (!state.catalystOn) return;` 이다. 무촉매 런은 여기서 즉시
 *    빠져나가므로 바이트 단위로 종전과 같다.
 *  - 슬롯 접근은 `readCatalystSlot`/`writeCatalystSlot` 만 쓴다(배열 직접 대입 금지).
 *  - **RNG 를 소비하지 마라.** 한 칸이라도 소비하면 같은 시드의 웨이브·드랍·엘리트 시퀀스가
 *    통째로 밀린다. 등급 롤에 곱하는 카드는 **재롤이 아니라 결과에 곱한다**(굴리고-버리기 금지).
 *  - `player.aux0`/`aux1` 은 **촉매가 절대 못 쓴다.** 스킬 쪽 "런당 기체 1대라 공존 불가"
 *    논증이 촉매에는 적용되지 않는다 — 촉매는 어느 기체와도 같이 뜬다.
 *  - `player.targetX` 도 쓰지 마라. S0 가 스킬의 「런당 1회」 억제 표식으로 예약했다
 *    (`skillHooks.ts` 의 {@link survivedLethalBlow} 주석). "sim 쓰기 0건이라 비었다"는
 *    근거가 아니다.
 *
 * ## ⚠️ 모드 진행 게이트를 만지는 특산 7종은 **여기서** 모드를 읽는다
 * 사용자 판정(2026-08-06): `modes/AGENTS.md` 의 *"모드가 바꿔도 되는 것은 환경뿐 —
 * 아이템·스킬·드랍은 모드가 안 건드린다"* 규율은 **유지하되 간선 방향을 뒤집는다.**
 * 즉 `src/sim/modes/*` 가 드랍·촉매를 import 하는 것이 아니라, **이 파일이 모드 상태를 읽어**
 * 드랍·게이트 보정을 얹는다. 그래야 `modes/AGENTS.md:54` 의 내부 의존성 목록이 그대로 서고,
 * 6개 모드 파일이 드랍을 한 번도 import 하지 않는 **순수 환경 함수**로 남는다.
 *
 * 완주 조건 자체의 재정의(특산 7종: 30·33·36·38·42·45·47)는 **ADR-0021 개정**으로 명시
 * 허용한다 — 같은 판정에서 함께 결정됐다. 개정문 없이 이 파일에 게이트 보정을 넣지 마라.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
// 대시 통과 판정의 기하. `collision.ts` 는 **순수 leaf**(런타임 import 0)라 값으로 들여와도
// 순환이 구조적으로 생기지 않는다 — 판정을 여기 베껴 적으면 탄 쪽 선분 판정과 조용히 갈린다.
import { sweptCircleOverlap } from './collision.js';
import {
  ChainReactionSlot,
  readCatalystSlot,
  writeCatalystSlot,
  CATALYST_SLOT_COUNT,
} from './catalystSlots.js';
// 카드 소지 판정의 유일 정본. `data/` 리프라 순환이 생기지 않는다.
import { hasCatalyst } from '../data/catalysts.js';
// 앵커 ⑭(성장 축)가 **중첩 적용**에 쓴다. `powerups.ts` 는 `world.js`/`entities.js` 를
// **type-only** 로만 끌고 나머지는 leaf 라 순환이 생기지 않는다.
// ⚠️ `applyPowerup` 은 RNG 를 한 칸도 안 쓴다 — `powerupRng` 소비는 `drawPowerupChoices`
// 한 곳뿐이고, 그 함수는 이 앵커보다 **앞에서** 이미 끝나 있다.
import { applyPowerup } from './powerups.js';
// 앵커 ⑥ 의 소멸 사유. **type-only 라 순환이 되지 않는다**(`skillHooks.ts` 가 이 파일을
// 값으로 import 하므로 값 import 는 순환이다) — 컴파일에서 지워진다.
import type { BulletExpiryReason } from './skillHooks.js';
import type { DamageSourceMask } from './skillSlots.js';

// ---------------------------------------------------------------------------
// 카드 소지 판정
// ---------------------------------------------------------------------------

/** `id 9 epiphany`(깨달음). 정본은 `src/data/catalysts.ts` 의 `slug: 'epiphany'`. */
const CARD_EPIPHANY = 9;
/** `id 14 mastery`(숙련). */
const CARD_MASTERY = 14;
/** `id 24 chainreaction`(연쇄반응). */
const CARD_CHAINREACTION = 24;

/**
 * 이 런에 촉매 `id` 가 실려 있는가.
 *
 * `state.catalystOn` 은 "촉매가 하나라도 있는가" 까지만 말한다. 카드별 분기는 반드시 이 술어를
 * 한 번 더 통과해야 한다 — 안 그러면 아무 촉매 한 장만 껴도 48종 전부의 효과가 켜진다.
 *
 * 순회 비용은 **최대 3**이다(헌장 §구조 계약: 슬롯 3장). 매 틱 도는 앵커 ⑨ 에서도 무시할 수
 * 있고, 그래서 파생 비트마스크를 `WorldState` 에 새로 만들지 않았다(새 칸을 만들면 §B 다).
 *
 * ⚠️ 정규화 전 배열을 그대로 본다 — 존재 여부만 쓰므로 중복 제거가 결과를 바꾸지 않는다.
 */
function carries(state: WorldState, id: number): boolean {
  const cats = state.config.catalysts;
  return cats !== undefined && hasCatalyst(cats, id);
}

// ---------------------------------------------------------------------------
// 기존 앵커 9지점에 대응하는 촉매 디스패치 (S0: 전 분기 비어 있음)
// ---------------------------------------------------------------------------
//
// ⚠️ 아래 함수들은 `skillHooks.ts` 의 앵커가 **두 번째 호출**로 부른다. 호출 순서는 앵커마다
// 주석에 명시돼 있다 — 감쇠 사슬만 촉매가 **먼저**이고 나머지는 스킬이 먼저다.

/**
 * 주무기 볼리 발사 확정. 스킬 디스패치 **뒤**에 불린다.
 *
 * ⚠️ **여기 분기가 없다 — 누락이 아니라 미배선이다**(배선 레인 실측, 48종 전수 대조).
 * 이 앵커에 걸리는 카드는 `id 25 overdrive`(열 누적 → 피해 상승 → 임계 침묵) 하나인데,
 * 세 조각 중 **이 지점에서 닿는 것은 열 누적뿐**이다:
 *  - 피해 상승 — 이 앵커는 `onVolleyFired` 헤더가 명시하듯 **무기 아키타입 분기보다 앞**이라
 *    탄이 아직 없고 `fireCooldownQ` 도 안 읽혔다. 브루저 BL2·말로우 SQ1·버블 PO2 가 같은
 *    벽에 걸려 미배선인 그 지점이다.
 *  - 자원 2배(백열 처치) — 처치 앵커(⑪ · `onEnemyDeathCatalyst`)의 자리라 **이 앵커 그룹 밖**.
 * 열 카운터만 돌리면 슬롯이 소비처 없이 해시에만 접힌다(아크캐스터 BA7·팬텀 AS8 이 통째로
 * 미배선인 그 판단). **`id 25` 는 발사부 소유 지점과 처치 앵커를 같이 쥔 레인이 배선해야 한다.**
 */
export function onVolleyFiredCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  void player;
  // 미배선(위 주석의 근거). 카드별 분기는 발사부 지점을 함께 쥔 레인이 넣는다.
}

/**
 * 대시 발동. 스킬 디스패치 **뒤**.
 *
 * ⚠️ **여기 분기가 없다 — 누락이 아니라 미배선이고, 막고 있는 것은 앵커가 아니라 엔진이다.**
 * 이 앵커에 걸리는 카드는 셋(`id 12 ascension` · `id 27 afterburner` · `id 29 ascendant`)이고
 * **셋 다 되돌림 조항이 "대시로 적을 관통해 죽인다"/"대시 무적 중 통과한 적"** 에 걸려 있다.
 * 그런데 **이 sim 에는 대시가 적에게 주는 피해도, 대시 통과 판정도 없다** — 대시 블록
 * (`world.ts:2222-2251`)은 `vx`/`vy` 가산 · `dashCooldown` · `iframes` · 잔상 추진기 적탄 소거가
 * 전부이고, `iframes` 중 접촉은 **플레이어가 안 맞을 뿐 적도 안 맞는다**(`world.ts:4308`).
 * 즉 세 카드의 **대가는 이 앵커에서 걸 수 있지만 되돌림은 원리적으로 못 건다** — 그대로 얹으면
 * 되돌릴 수 없는 단조 감소가 되어 헌장 §페널티 규율 3 위반이다.
 * → **설계 문서 ↔ 코드 어긋남으로 보고했다. 문서를 고치지 말고 선결(대시 관통 판정)을 세워라.**
 *
 * 참고로 **이 지점의 산술은 개입을 삼키지 않는다**: 앵커가 `dashCooldown` 대입(2231/2234행)
 * **뒤**라 여기서 쓴 값이 그대로 남고, 다음 틱의 `if (player.dashCooldown > 0)` ·
 * `dashCooldown === 0` 게이트가 그것을 그대로 읽는다(`min`/`clamp` 없음). 막고 있는 것은
 * 산술이 아니라 **짝이 되는 소비처의 부재**다.
 */
export function onDashFiredCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  void player;
}

/**
 * 젬 수거. 스킬 디스패치 **뒤**.
 *
 * ⚠️ **여기 분기가 없다 — 쓸 카드가 0종이기 때문이다**(48종 전수 대조).
 * 젬을 언급하는 카드는 셋인데(`id 2`·`id 13` 의 "관통한 적이 젬을 더 뱉는다", `id 10` 의
 * "예고선 위에서 경험치 세 배") 전부 **젬이 생기는 시점**(드랍·XP 산정)이고 **수거 시점이
 * 아니다**. 게다가 이 앵커는 `onGemCollected` 헤더가 명시하듯 **콤보·XP 가 이미 반영된 뒤**라
 * 그 젬의 XP 배율을 여기서 되돌릴 수 없다 — XP 축 촉매 배율은 이미 `state.catalystMods.xp` 가
 * 적립 지점(`world.ts:4643`)에서 곱하고 있고 **그것이 그 축의 단일 정본**이다. 같은 배율을
 * 여기 다시 세우면 두 곳이 조용히 갈린다.
 */
export function onGemCollectedCatalyst(state: WorldState, gem: Entity): void {
  if (!state.catalystOn) return;
  void gem;
}

/**
 * 선체 hp 가 실제로 깎인 피격의 후속. 스킬 디스패치 **뒤**.
 *
 * ⚠️ `sources` 는 {@link DamageSource} **비트합**이지 단일 값이 아니다(W2 — `world.ts` 의
 * 수집 루프가 `max` 라 한 틱에 여러 피해원이 함께 기여할 수 있다). 여기에 촉매를 얹는 레인은
 * `hasDamageSource(sources, DamageSource.contact)` 처럼 **비트로 게이트**해라 —
 * `sources === DamageSource.contact` 로 쓰면 적탄이 겹친 틱에 조용히 빠진다.
 */
export function onPlayerDamagedCatalyst(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  if (!state.catalystOn) return;
  // `id 24` 는 **피해원을 가리지 않는다** — 규칙이 "네가 받은 피해"라 접촉·적탄·해저드를
  // 구분하지 않는다. 사유를 보는 카드가 이 앵커에 배선되면 그때 `sources` 를
  // `hasDamageSource` 로 게이트해라(이 함수 doc 참조).
  void lethalSurvived;
  void sources;
  if (carries(state, CARD_CHAINREACTION)) chainReactionOnDamaged(state, player, dmg);
}

/**
 * `id 24 chainreaction` — **받은 피해를 가장 가까운 잡몹에게 전이하고, 전이한 만큼 최대 HP
 * 상한을 깎는다.** 복구는 {@link onTickCatalyst} 의 세그먼트 전환 감지가 한다.
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
function chainReactionOnDamaged(state: WorldState, player: Entity, dmg: number): void {
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

/** 이번 틱의 처치 증분. 스킬 디스패치 **뒤**. */
export function onKillsDeltaCatalyst(state: WorldState, delta: number): void {
  if (!state.catalystOn) return;
  void delta;
}

/**
 * 아군탄 소멸. 스킬 디스패치 **뒤**.
 *
 * ⚠️ `reason` 이 `'pierce'`(관통 예산 소진)와 `'life'`(수명 만료)로 갈린다(S3-2). 여기에
 * 촉매를 얹는 레인은 **반드시 사유를 게이트**해라 — 안 하면 한 촉매가 두 사유에서 다 터진다.
 *
 * ⚠️ **여기 분기가 없다 — 쓸 카드가 0종이기 때문이다**(48종 + 공명 12 전수 대조).
 * 관통을 언급하는 것은 `id 2`(수확 지대 위 관통) · 정밀 약공명(다음 한 발 관통) · 밀도 강공명
 * (관통 소실 = `bullet.pierce = 0`) 셋인데, 셋 다 **탄이 태어나는 시점에 `pierce` 를 정하는**
 * 규칙이지 **예산이 바닥난 소멸 시점**의 규칙이 아니다. 수명 만료(`'life'`)에 반응하는 카드는
 * 아예 없다. 브루저·팬텀이 이 앵커에 case 가 없는 것과 같은 사유다.
 */
export function onBulletExpiredCatalyst(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  if (!state.catalystOn) return;
  void bullet;
  void reason;
}

/**
 * 벽 접촉 틱. 스킬 디스패치 **뒤**.
 *
 * ⚠️ **여기 분기가 없다 — 누락이 아니라 미배선이다.** 이 앵커에 걸리는 카드는
 * `id 39 arke-overclock` 하나인데 네 조각 중 **이 지점이 소유하는 것은 "부딪힐 때마다 최대
 * 속도 한 단계 하락" 하나뿐**이다:
 *  - 스크롤 2배 — `createWorld`/모드 노브.
 *  - 벽이 부서지며 자원 — 벽 파괴 지점(`blockBreak`)이고 이 앵커는 **접촉 틱**일 뿐이다.
 *  - 무충돌 구간 통과 시 한 단계 복구 — 세그먼트 전진(`state.wave.segmentIndex`) 축.
 * 되돌림(복구)이 이 앵커 밖이라 하락만 얹으면 §페널티 규율 3(되돌릴 수단 동봉)을 어긴다.
 * **`id 39` 는 벽 파괴 + 세그먼트 축을 같이 쥔 레인이 배선해야 한다.**
 */
export function onWallContactCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  void player;
}

/**
 * 감쇠 사슬의 **촉매 피해원 배율** 칸.
 *
 * ⚠️ **이 하나만 `skillHooks.ts` 를 거치지 않는다** — `world.ts` 가 직접 부른다. 다른 여덟은
 * 스킬 앵커가 두 번째 호출로 부르지만, 이 칸은 **`preMitigationDmg` 캡처보다 앞**에 있어야
 * 하므로 `onDamageChain`(캡처 뒤) 안으로 넣을 수 없다.
 *
 * 사슬 순서(사용자 승인 계약 + 코드 실측):
 * ```
 * modeScale → PLAYER_DAMAGE_TAKEN_MULT → [촉매 피해원 배율] → ★preMitigationDmg 캡처★
 *   → [스킬 감소] → [스킬 흡수] → 브루저 장갑 → 버블 막 → 말로우 완충 → hp
 * ```
 * 촉매가 스킬보다 앞인 이유: 손대는 카드가 **id 22 하나뿐**이고(자기 폭발 피해 절반) 그것은
 * *경감 수단*이 아니라 **들어오는 피해의 성질**이라 `PLAYER_DAMAGE_TAKEN_MULT` 와 같은
 * 부류다. 경감(스킬 감소·장갑·막)보다 뒤에 두면 같은 자원이 더 적은 피해를 막게 된다.
 *
 * ## `preMitigationDmg` 가 촉매를 **포함한다** — 미결로 두지 않았다
 * `survivedLethalBlow`(브루저 FO5 · 아크캐스터 BR10)의 "경감 전 피해"가 촉매 배율을 포함
 * 하는지로 두 스킬의 의미가 갈린다. **포함하는 쪽으로 못 박았다** — 촉매 배율은 경감이 아니라
 * 피해원의 크기 자체이므로, 제외하면 "이 일격이 치명이었나"를 **실제로 날아오지 않은 피해**로
 * 판정하게 된다. 이 배율을 캡처보다 뒤(= `onDamageChain` 안)로 옮기면 그 의미가 조용히
 * 뒤집히므로 옮기지 마라.
 *
 * ## ⚠️ 사슬을 **우회**하는 피해원이 8곳 있다 (실측)
 * `shrink.ts:217` 장외 · `racing.ts:191` 압박 · `blockBreak.ts:186` 압사 ·
 * `invasion/movingWall.ts:474` 이동벽 압사 · `encounterDetour.ts:353` 조우 접촉 ·
 * `world.ts:3916` 코어 반사 · `world.ts:3951` 코어 볼리 · `world.ts:2490` 말로우 지연 정산.
 * 이 여덟은 `onDamageChain` 도 장갑·막·완충도 **하나도 거치지 않는다.** "받는 피해" 축을
 * 사슬에만 끼우는 카드는 이 경로들에 영향을 못 준다 — 카드 설명이 "모든 피해"를 약속하면
 * 화면과 규칙이 갈린다.
 *
 * (해저드 피해는 우회하지 않는다 — 용암·박격·오염 지형은 `kind === 'hazard'` 로 같은 입구를
 * 타고 사슬을 전부 통과한다. 감속장판만 피해가 아니라 `playerSlowTicks` 를 세운다.)
 *
 * @param dmg `PLAYER_DAMAGE_TAKEN_MULT` 까지 반영된 사슬 진입 피해
 * @returns 촉매 피해원 배율을 거친 피해. S0 는 인자를 그대로 돌려준다(비트 동일).
 */
export function onDamageChainCatalyst(state: WorldState, player: Entity, dmg: number): number {
  if (!state.catalystOn) return dmg;
  // **미배선 — 사유를 남긴다.** 이 칸의 유일한 후보인 `id 22 cascade`(자기 폭발 피해 절반)는
  // ①폭발 자체가 앵커 ⑪(적 격추) 소유라 이 레인 밖이고 ②이 시그니처가 **피해원을 안 받아**
  // "자기 폭발이 때린 피해"를 다른 피해와 구별할 수 없다. 반값을 무조건 곱하면 카드가
  // "받는 모든 피해 절반"이 되어 규칙 문장과 화면이 갈린다.
  // 배선하려면 인자에 피해원(또는 촉매 해저드 표식)이 추가돼야 한다.
  //
  // ✅ **반환값은 뒤에서 삼켜지지 않는다**: 사슬 꼬리가 `player.hp -= dmg` 로 그대로 쓰고
  //    클램프는 `hp` 쪽(`if (player.hp < 0) player.hp = 0`)에만 있다.
  //    `tests/catalystAnchors.test.ts` 의 «반환 배율이 hp 차감에 그대로 도달한다» 가 뮤테이션으로
  //    잠근다 — 앵커 ⑰ 이 `min(d,s)` 에 먹혀 무효였던 전례가 있어 이 칸은 실증해 두었다.
  void player;
  return dmg;
}

/**
 * 매 틱 1회(시그니처 틱 진행 지점). 스킬 디스패치 **뒤**.
 *
 * ⚠️ **매 틱 도는 자리다.** 여기 얹는 카드는 ①카드 소지 게이트를 먼저 통과시키고 ②단조
 * 증가하는 누적을 두지 마라. 지금 배선된 `id 24` 복구는 **세그먼트 인덱스가 바뀐 틱에만**
 * 한 번 돌고, 되돌리는 양이 슬롯에 실제로 쌓인 값이라 폭주할 수 없다(복구 뒤 슬롯이 0 이 되므로
 * 같은 세그먼트에서 두 번 복구되지도 않는다).
 */
export function onTickCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  if (carries(state, CARD_CHAINREACTION)) chainReactionOnTick(state, player);
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
function chainReactionOnTick(state: WorldState, player: Entity): void {
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
// 신규 앵커 ⑩⑪ (S1) — 적 단위 사건. **전 분기 비어 있음**
// ---------------------------------------------------------------------------

/**
 * 앵커 ⑩ — **적성 표적이 아군탄에 맞아 피해가 확정된 직후**. 스킬 디스패치 **뒤**.
 *
 * 계약·주의사항은 전부 `skillHooks.ts` 의 {@link import('./skillHooks.js').onEnemyDamaged}
 * 주석이 정본이다(어느 지점이고 무엇이 보장되며 무엇을 하면 안 되는가). 여기 다시 적지 않는다.
 *
 * ⚠️ 이 앵커는 **아군탄 명중 경로만** 덮는다. 화염 DoT·전격 연쇄·폭탄 기물·액티브 폭발·조우
 * 격실 탄은 `world.ts` 밖(leaf 모듈)에서 적 hp 를 깎으므로 여기 오지 않는다 — 그 목록과 사유는
 * `skillHooks.ts` 쪽 주석에 실측으로 적혀 있다.
 */
export function onEnemyDamagedCatalyst(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  if (!state.catalystOn) return;
  void target;
  void dmg;
  void source;
}

/**
 * 앵커 ⑪ — **잡몹 하나가 실제로 격추된 사건**(좌표 포함). 스킬 디스패치 **뒤**.
 *
 * 기존 앵커 ⑤ `onKillsDeltaCatalyst` 는 **개수만** 주고 좌표를 안 준다. 촉매 조사가 지적한
 * "id 43 은 좌표를 못 받아 시그니처가 부족하다"가 이 앵커로 풀린다.
 *
 * 계약은 `skillHooks.ts` 의 {@link import('./skillHooks.js').onEnemyDeath} 주석이 정본이다.
 */
export function onEnemyDeathCatalyst(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): void {
  if (!state.catalystOn) return;
  void x;
  void y;
  void elite;
}

// ---------------------------------------------------------------------------
// 신규 앵커 ⑫⑬⑭ (S1) — 성장 축. ⑬⑭ 배선 완료(`id 9`·`id 14`), ⑫ 는 미배선
// ---------------------------------------------------------------------------

/**
 * 레벨이 오른 직후. 스킬 디스패치 **뒤**. 계약은 `skillHooks.ts` 쪽 주석이 정본이다.
 *
 * ⚠️ **미배선이다.** 이 지점을 요구하는 카드는 `id 4 cornucopia`(레벨업 시 바닥 전리품이
 * 전부 폭발 → 적 피해 + 등급 강등 + 회수) 하나인데, 그 본체가 **드랍·전리품·적 사망 마킹**에
 * 걸려 성장 축 앵커 그룹 밖이다. 여기서 카운터만 돌리면 슬롯이 해시에만 접히는 반쪽 배선이
 * 되므로 켜지 않았다.
 */
export function onLevelUpCatalyst(state: WorldState, level: number): void {
  if (!state.catalystOn) return;
  void level;
}

/**
 * 파워업 3택이 제시된 직후. 스킬 디스패치 **뒤**.
 *
 * ⚠️ `choices` 는 **읽기 전용**이다. 선택지를 바꾸는 카드는 `state.powerupChoices` 를 직접
 * 갈아 끼워야 하고, 그때 **`drawPowerupChoices` 가 이미 `powerupRng` 를 소비한 뒤**라는 것을
 * 기억해라 — 재추첨은 스트림을 밀어 같은 시드의 전개를 통째로 바꾼다(공통 계약 "굴리고-버리기 금지").
 */
export function onPowerupOfferCatalyst(state: WorldState, choices: readonly number[]): void {
  if (!state.catalystOn) return;
  if (choices.length === 0) return;
  // `choices` 는 `state.powerupChoices` 그 자체다(world.ts 의 호출부). 쓰기는 규약대로
  // `state.powerupChoices` 쪽으로만 한다.
  const offers = state.powerupChoices;
  const first = offers[0];
  if (first === undefined) return;

  // ⚠️⚠️ **RNG 미소비.** 아래 둘 다 `drawPowerupChoices` 가 이미 뽑아 놓은 결과를 **자리째
  // 덮을 뿐** 재추첨·추가 뽑기를 하지 않는다. 그래서 같은 시드의 `powerupRng` 스트림 위치가
  // 촉매 유무와 무관하게 동일하고, 이후 레벨의 3택도 통째로 같다.
  // ⚠️ 적용 순서는 **mastery → epiphany 고정**이다(둘 다 실린 런에서 결과가 갈리지 않게).
  //    mastery 가 전 칸을 첫 칸으로 채운 뒤 epiphany 가 1칸으로 접으므로, 남는 것은 첫 칸이다.

  // id 14 mastery — 세 자리가 전부 같은 파워업이 된다(폭을 잃고 깊이를 얻는다).
  // ⚠️ `GAMBLER_EXTRA_CHOICES` 로 4택이 된 런에서도 자리 수와 무관하게 전부 덮는다.
  if (carries(state, CARD_MASTERY)) {
    for (let i = 1; i < offers.length; i++) offers[i] = first;
  }
  // id 9 epiphany — 3택이 1택으로 접힌다(거부할 수 없다). 프리즈는 그대로라 픽 입력이
  // 와야 런이 재개되고, `world.ts` 의 `idxOffered < length` 가드가 1칸만 허용한다.
  if (carries(state, CARD_EPIPHANY)) {
    offers.length = 1;
  }
}

/**
 * 파워업이 실제로 적용된 직후. 스킬 디스패치 **뒤**.
 *
 * 성장 축 두 카드의 **중첩분**이 여기서 들어간다. `world.ts` 가 이미 기본 1중첩을 적용한
 * 뒤이므로 이 함수는 **추가분만** 얹는다.
 *
 * ⭐ `min`/`clamp` 삼킴 점검: `applyPowerup` 은 `POWERUPS[i].apply(state)` 순수 디스패치라
 * 상한이 **카드마다 따로**다. 실제로 `dashCooldownTicks` 는 `Math.max(12, ·)` 바닥이 있어
 * 이미 12 면 추가분이 삼켜지고, `reinforced-hull`(`playerHp`/`maxHp` 가산)·`gem-magnet`
 * (`magnetRadius` ×1.15) 처럼 바닥이 없는 축은 그대로 쌓인다. 즉 **개입이 원리적으로
 * 무효가 되지는 않는다**(앵커 ⑰ 이 밟은 형태와 다르다) — 다만 어떤 파워업이 뽑히느냐에
 * 따라 체감이 갈리고, 그것이 두 카드의 `약해지는 상황:` 칸에 이미 적힌 대가다.
 *
 * ⚠️ **RNG 미소비** — `applyPowerup` 은 난수를 쓰지 않는다.
 */
export function onPowerupPickedCatalyst(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  if (!state.catalystOn) return;
  void offeredIndex;
  let extra = 0;
  if (carries(state, CARD_MASTERY)) extra += 2; // 3중첩 = 기본 1 + 2
  if (carries(state, CARD_EPIPHANY)) extra += 1; // 2중첩 = 기본 1 + 1
  for (let i = 0; i < extra; i++) applyPowerup(state, poolIndex);
}

// ---------------------------------------------------------------------------
// 신규 앵커 — **촉매 배선 레인이 `world.ts` 에 지점을 뚫고 여기에 본체를 둔다**
// ---------------------------------------------------------------------------
//
// 겹침 판정 결과, 기존 9지점으로 커버되는 촉매는 완전 3종 / 부분 9종뿐이고 나머지 36종은
// 새 지점을 요구한다. 필요한 신규 앵커(조사 실측). **취소선 = S1 이 뚫었다**:
//
//   ~~onEnemyDeath(좌표 포함 — 9종이 쓴다)~~ · ~~onEnemyDamaged~~ · ~~onPowerupOffer~~ ·
//   ~~onPowerupPicked~~ · ~~onLevelUp~~ ·
//   onLootRoll · onLootCollected · onWaveAdvanced · onEnemyContact · ~~onResourceGranted~~ ·
//   onEnemyStep · ~~onDashPierce~~ · 촉매 해저드→적 피해 루프 ·
//   isPlayerTargetable 등재/제외 · ~~정산 채널~~ · (신설) ~~onBossDeath~~
//
// ⚠️ **`onWaveAdvanced` 는 S1 이 손대지 않았다** — 웨이브 전진은 `waves.ts`(leaf) 안에서
// 일어나고, 거기서 이 파일을 부르면 `skillHooks → skills/*` 사슬과 엮여 순환 위험이 생긴다.
// `world.ts` 쪽에서 `updateWaves` 전후의 웨이브 인덱스를 비교해 뚫는 형태가 안전하다.
//
// ⚠️ **해저드→적 피해 루프**는 지금 존재하지 않는다 — 현행 해저드 피해는 *플레이어 충돌 질의
// 콜백 안*에만 있어 적을 못 때린다. 이것은 `stepWorld` 에 **새 per-tick 단계**를 만드는
// 변경이라 훅 예산 등급 판정 대상이다(§A 가 아닐 수 있다).
//
// ⚠️ **정산 채널을 뚫으면** S0 의 증명 하나가 무효가 된다 — *"`RunResult` 는 `WorldState` 를
// import 조차 안 하는 닫힌 인터페이스"*. id 5·18·21 이 그 채널을 요구한다. 뚫을 때 그 증명을
// 대체할 새 불변식을 함께 세워라.
//   → **뚫었다(선결 앵커 레인).** 대체 불변식은 아래 {@link catalystSettlementOf} 주석과
//     `tests/catalystFoundation.test.ts` §정산 채널 절이다.

// ---------------------------------------------------------------------------
// 신규 앵커 넷 (선결 앵커 레인) — **전 분기 비어 있음**
// ---------------------------------------------------------------------------
//
// 배선(카드별 효과)은 다음 레인이 한다. 여기 있는 것은 **자리**뿐이다.

/**
 * 앵커 — **대시로 실제로 통과한 적 하나마다 1회**(`id 12`·`id 27`·`id 29`의 선결).
 *
 * ## ⚠️ 대시는 피해를 주지 않는다 — 이것은 **통과 판정 전용**이다
 * 사용자 판정(2026-08-08): *"통과 판정만 신설. 대시는 피해를 주지 않는다."* 근거는 ADR-0052 의
 * ADR-0021 개정문이 *"조작 코어(기체 이동·자동공격·판정점)는 여전히 불변"* 이라고 못 박은 것이다.
 * 이 앵커에서 `target.hp` 를 깎지 마라 — 그것은 조작 코어 변경이라 210 스킬·전 기체 밸런스로
 * 파급된다. 되돌림 조항("대시로 관통해 죽인다")은 **이 통지를 조건으로 다른 축에서** 갚아라.
 *
 * ## ⚠️ `iframes` 와 **독립**이다
 * 대시 무적 중 접촉은 플레이어가 안 맞을 뿐 **적도 안 맞는다**(`world.ts` 의 접촉 피해 게이트).
 * 이 판정은 그 게이트를 한 번도 읽지 않는다 — 읽으면 `id 29`(*"대시 무적 중 통과한 적"*)가
 * 구조적으로 0 회가 되어 카드가 죽는다.
 *
 * @param target 통과한 적성 표적(`enemy`·`boss`). **살아 있고 `dead` 가 아닌** 개체만 온다.
 */
export function onDashPierceCatalyst(state: WorldState, player: Entity, target: Entity): void {
  if (!state.catalystOn) return;
  void player;
  void target;
}

/**
 * 앵커 — 대시가 발동한 틱의 **이동 선분**. 통과한 적 목록을 돌려주고, 호출부가 그 목록을
 * 돌며 {@link onDashPierceCatalyst} 를 적 하나마다 부른다.
 *
 * ## 왜 판정이 이 파일 안에 있는가 (거동 불변 규율)
 * 계산 자체가 `state.catalystOn` **안쪽**이어야 한다. 호출부(`world.ts`)에서 미리 훑으면
 * 무촉매 런에도 순회가 돌아 — RNG 를 안 쓰더라도 — 실행 순서·부동소수 누적이 갈릴 여지가 생긴다.
 * 그래서 호출부는 좌표 넷만 넘기고 게이트·판정이 전부 여기에 있다.
 *
 * ## ⚠️ 왜 `onDashPierceCatalyst` 를 **여기서 직접 부르지 않는가** (실측)
 * 모듈 **안**에서 부르면 지역 바인딩을 타므로 `vi.mock` 으로 감싼 export 를 **지나친다** —
 * `tests/catalystAnchors.test.ts` 의 계측이 그 호출을 영영 못 본다(구현 첫 판에서 실제로
 * 0 이 나왔다). 이 저장소의 규율은 *"앵커를 세우면 호출부 계측을 같이 세워라"* 이므로, 통지는
 * 호출부로 올린다. 무촉매 런은 이 함수가 **빈 배열**을 돌려주어 호출부 순회가 0회다(바이트 불변).
 *
 * ## 왜 **선분(swept)** 판정인가
 * 대시는 한 틱에 수십 유닛을 건너뛴다(최대 대시 스텝 ≈59u, 잡몹 반경 32u). 이동 **후** 좌표
 * 한 점에서만 재면 얇은 적을 정확히 지나쳐도 후보에 안 든다 — 이 리포가 탄↔적에서 같은 결함을
 * 실측하고 선분 판정으로 고친 선례가 {@link sweptCircleOverlap} 주석에 있다.
 *
 * ## ⚠️ 벽 가림은 보지 않는다
 * 선분 판정에는 가림 개념이 없다. 대시 경로가 벽에 막히면 호출부가 넘기는 끝점이 **슬라이드로
 * 해소된 최종 좌표**라 경로 자체가 짧아지지만, 벽 **너머** 적을 배제하는 규칙은 아니다.
 * 가림이 필요한 카드는 배선 레인이 `los.ts` 를 추가로 태워라.
 *
 * @param ax 대시 틱의 이동 **전** x(`preMoveX` — 속도 적분 직전)
 * @param ay 동상 y
 * @param bx 이동·벽 슬라이드가 끝난 **최종** x. 창 클램프(`stepWorld` 쪽)는 아직 안 걸렸다.
 * @param by 동상 y
 */
export function onDashSweptCatalyst(
  state: WorldState,
  player: Entity,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): readonly Entity[] {
  DASH_PIERCE_SCRATCH.length = 0;
  if (!state.catalystOn) return DASH_PIERCE_SCRATCH;
  // 순회 순서는 엔티티 배열 순서라 결정론적이다(시드 무관). RNG 소비 0 · 상태 쓰기 0.
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    if (!sweptCircleOverlap(ax, ay, bx, by, player.radius, e.x, e.y, e.radius)) continue;
    DASH_PIERCE_SCRATCH.push(e);
  }
  return DASH_PIERCE_SCRATCH;
}

/**
 * {@link onDashSweptCatalyst} 의 **재사용 버퍼**. 대시는 틱당 최대 1회지만 런당 수백 회라
 * 발동마다 할당하지 않는다(`world.ts` 의 `BULLET_HIT_SCRATCH` 와 같은 규율).
 * 재진입 위험 없음 — 호출자는 반환 직후 순회하고 그 안에서 다시 스윕하지 않는다.
 */
const DASH_PIERCE_SCRATCH: Entity[] = [];

/**
 * 앵커 — **보급 습격 격추로 자원이 실제로 적립된 직후**(`id 15`·`id 17`·`id 19`의 선결).
 *
 * 셋 다 적립처가 보급 습격인데 그 앵커가 아예 없었다. 지점은 `compact` 안의 `resources` 가산
 * 바로 뒤이고, `amount` 는 **이번 격추로 승격된 정수 자원**이다(milli 캐리에서 올림 없이 떨어진
 * 몫 — 소수분은 다음 격추로 이월된다). 그래서 `amount` 가 0 인 호출은 원리적으로 없다.
 *
 * ⚠️ 이 호출은 `for (const e of state.entities)` **순회 안**이다 — 훅에서 스폰 금지
 * (엘리트 드랍 앵커와 같은 규율).
 */
export function onResourceGrantedCatalyst(
  state: WorldState,
  amount: number,
  x: number,
  y: number,
): void {
  if (!state.catalystOn) return;
  void amount;
  void x;
  void y;
}

/**
 * 앵커 — **보스가 격추된 사건**. 앵커 ⑪({@link onEnemyDeathCatalyst})은 `kind === 'enemy'`
 * 게이트라 보스를 덮지 않는다(`id 44` 가 그 구멍에 걸려 있었다).
 *
 * ## 반환값 = **승리 억제**
 * `world.ts` 는 `boss` kind 하나가 죽으면 **그 자리에서 런 승리**를 세운다. `id 44`(보스가
 * 두 번째 형태로 일어섬)는 그 판정을 가로챌 수 있어야 하므로, 이 앵커는 승리 판정보다 **앞**에
 * 서고 `true` 를 돌려주면 호출부가 승리·보스 드랍 블록을 통째로 건너뛴다. `onDeathRemnantSpawn`
 * 이 `true` 로 스폰을 억제하는 선례와 같은 형태다 — **억제이지 사후 취소가 아니다.**
 *
 * ⚠️ **`boss` kind 를 늘리지 마라.** 두 번째 형태는 페이즈 전환으로만 표현한다. 새 kind 를
 * 만들면 조준 술어·충돌 격자·아군탄 화이트리스트 세 목록이 동시에 갈라진다(`isPlayerTargetable`
 * 주석의 실측 사고가 정확히 그것이다).
 *
 * ⚠️ 이 시점의 보스 개체는 이미 `dead` 이고 곧 `state.entities` 밖으로 나간다. 되살리려면
 * 좌표를 받아 **새로 스폰**해야 하는데, 이 호출은 순회 안이라 여기서 스폰하면 안 된다 —
 * 슬롯에 표식을 남기고 순회 밖(다음 틱)에 스폰해라.
 *
 * @returns `true` 면 이 격추로 런이 끝나지 않는다(승리·보스 드랍 억제).
 */
export function onBossDeathCatalyst(state: WorldState, x: number, y: number): boolean {
  if (!state.catalystOn) return false;
  void x;
  void y;
  return false;
}

// ---------------------------------------------------------------------------
// 정산 채널 (선결 앵커 레인) — 순수 리더
// ---------------------------------------------------------------------------

/**
 * 앵커 — **런 결과에 촉매 값을 싣는 단 하나의 채널**(`id 5`·`id 18`·`id 21`의 선결).
 *
 * `echo.ts` 의 {@link import('./echo.js').echoStabilizedOf} 가 정본 선례다 — sim 상태를 읽어
 * **원시값만** 내놓는 순수 리더이고, `world.ts` 가 재수출해 W3(정산·`main.ts`)이 소비한다.
 *
 * ## 무엇을 싣는가 — 촉매 슬롯 한 벌의 최종값
 * 촉매의 런 내 상태는 전부 `state.catalystSlots`(고정 폭 {@link CATALYST_SLOT_COUNT}, 비음 정수)
 * 다. 그래서 채널은 그 벌의 **복사본**이면 충분하고, 새 `WorldState` 필드가 필요 없다 —
 * 필드를 늘리면 `hashWorld` 폴드·`snapshot` 직렬화 두 곳을 같이 건드려야 하고 그 순간
 * 무촉매 바이트 불변이 위험해진다. 값의 **의미**는 `catalystSlots.ts` 의 카드별 배정표가
 * 소유한다(여기서 이름을 붙이면 정본이 둘이 된다).
 *
 * ## ⭐ S0 증명을 대체하는 새 불변식 — 세 줄이다
 * 낡은 증명: *"`RunResult` 는 `WorldState` 를 import 조차 안 하는 닫힌 인터페이스"*.
 * 채널이 뚫린 지금 그것은 성립하지 않는다. 대신 이 셋이 같은 것을 지킨다
 * (`tests/catalystFoundation.test.ts` §정산 채널 절이 기계로 검사한다):
 *
 *  1. **원시값만.** 반환 타입은 `readonly number[] | undefined` 이고 `src/save/settlement.ts`
 *     소스에 식별자 `WorldState` 가 **한 번도 등장하지 않는다.** 정산은 sim 타입을 모른다.
 *  2. **복사본이다.** 반환 배열을 정산이 변형해도 `state.catalystSlots` 가 안 움직인다 —
 *     참조를 내주면 정산이 sim 상태의 두 번째 작성자가 된다.
 *  3. **무촉매는 채널 자체가 없다.** `catalystOn` 이 거짓이면 `undefined` 라 `RunResult` 에
 *     필드가 아예 안 실린다 → 무촉매 런의 정산 입력이 종전과 바이트 동일하다.
 */
export function catalystSettlementOf(state: WorldState): readonly number[] | undefined {
  if (!state.catalystOn) return undefined;
  const out = new Array<number>(CATALYST_SLOT_COUNT);
  for (let i = 0; i < CATALYST_SLOT_COUNT; i++) {
    out[i] = readCatalystSlot(state.catalystSlots, i);
  }
  return out;
}
