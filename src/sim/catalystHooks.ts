/**
 * **촉매 48종 배선의 디스패치 면**(ADR-0052 재구축 공유 기반).
 *
 * S0 시점에는 전 분기가 비어 있다. 이 커밋이 만드는 것은 **자리**이지 효과가 아니다 —
 * 전 슬롯 0 · 빈 디스패치라 산술이 비트 동일하고, 그래서 골든·침공 해시가 **바이트 불변**이다.
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
// 앵커 ⑥ 의 소멸 사유. **type-only 라 순환이 되지 않는다**(`skillHooks.ts` 가 이 파일을
// 값으로 import 하므로 값 import 는 순환이다) — 컴파일에서 지워진다.
import type { BulletExpiryReason } from './skillHooks.js';
import type { DamageSourceMask } from './skillSlots.js';
import { ChainReactionSlot, readCatalystSlot, writeCatalystSlot } from './catalystSlots.js';

// ---------------------------------------------------------------------------
// 카드 소지 판정
// ---------------------------------------------------------------------------

/** `id 24 chainreaction`. 정본은 `src/data/catalysts.ts` 의 `id: 24, slug: 'chainreaction'`. */
const CARD_CHAINREACTION = 24;

/**
 * 이 런에 촉매 `id` 가 실려 있는가.
 *
 * `state.catalystOn` 은 "촉매가 하나라도 있는가" 까지만 말한다. 카드별 분기는 반드시 이 술어를
 * 한 번 더 통과해야 한다 — 안 그러면 아무 촉매 한 장만 껴도 48종 전부의 효과가 켜진다.
 *
 * 순회 비용은 **최대 3**이다(헌장 §구조 계약: 슬롯 3장). 매 틱 도는 앵커 ⑨ 에서도 무시할 수
 * 있고, 그래서 파생 비트마스크를 `WorldState` 에 새로 만들지 않았다(새 칸을 만들면 §B 다).
 */
function hasCatalyst(state: WorldState, id: number): boolean {
  const cats = state.config.catalysts;
  return cats !== undefined && cats.includes(id);
}

// ---------------------------------------------------------------------------
// 기존 앵커 9지점에 대응하는 촉매 디스패치 (S0: 전 분기 비어 있음)
// ---------------------------------------------------------------------------
//
// ⚠️ 아래 함수들은 `skillHooks.ts` 의 앵커가 **두 번째 호출**로 부른다. 호출 순서는 앵커마다
// 주석에 명시돼 있다 — 감쇠 사슬만 촉매가 **먼저**이고 나머지는 스킬이 먼저다.

/** 주무기 볼리 발사 확정. 스킬 디스패치 **뒤**에 불린다. */
export function onVolleyFiredCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  void player;
  // S0: 미배선. 촉매 레인이 카드별 분기를 여기에 넣는다.
}

/** 대시 발동. 스킬 디스패치 **뒤**. */
export function onDashFiredCatalyst(state: WorldState, player: Entity): void {
  if (!state.catalystOn) return;
  void player;
}

/** 젬 수거. 스킬 디스패치 **뒤**. */
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
  if (hasCatalyst(state, CARD_CHAINREACTION)) chainReactionOnDamaged(state, player, dmg);
}

/**
 * `id 24 chainreaction` — **받은 피해를 가장 가까운 잡몹에게 전이하고, 전이한 만큼 최대 HP
 * 상한을 깎는다.** 복구는 {@link onTickCatalyst} 의 세그먼트 전환 감지가 한다.
 *
 * ## 왜 이 앵커에서 적을 직접 깎아도 격추가 정상 집계되는가
 * 이 앵커는 `stepPlayer`(`world.ts:2196`) 안에서 불리고, 격추 집계·젬·엘리트 루팅의 **단일
 * 수렴점**인 `compact()` 는 같은 틱의 **뒤**에서 돈다(`world.ts:1828` → `1926`). 그래서 여기서
 * hp 를 0 이하로 만든 적은 이번 틱에 그대로 처치로 잡힌다.
 *
 * ⚠️ 단 **`dead` 를 직접 세워야 한다.** `compact()` 의 첫 줄이 `if (!e.dead) { survivors.push;
 * continue; }` 라, hp 만 0 으로 만들고 마킹을 빠뜨리면 **처치도 젬도 전리품도 안 나오는
 * 좀비**가 된다(`activeTypes.ts` 의 `blastDamageAt` 이 정확히 그 형태이고, 헌장이 `id 22` 항목에
 * 같은 함정을 적어 두었다).
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

/** 벽 접촉 틱. 스킬 디스패치 **뒤**. */
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
  // 배선하려면 인자에 피해원(또는 촉매 해저드 표식)이 추가돼야 한다 — 그 결정은 리드 몫이다.
  //
  // ✅ **반환값은 뒤에서 삼켜지지 않는다**(질문 ③): 사슬 꼬리가 `player.hp -= dmg` 로 그대로
  //    쓰고 클램프는 `hp` 쪽(`if (player.hp < 0) player.hp = 0`)에만 있다(`world.ts:4550`).
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
  if (hasCatalyst(state, CARD_CHAINREACTION)) chainReactionOnTick(state, player);
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
// 신규 앵커 ⑫⑬⑭ (S1) — 성장 축. **전 분기 비어 있음**
// ---------------------------------------------------------------------------

/** 레벨이 오른 직후. 스킬 디스패치 **뒤**. 계약은 `skillHooks.ts` 쪽 주석이 정본이다. */
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
  void choices;
}

/** 파워업이 실제로 적용된 직후. 스킬 디스패치 **뒤**. */
export function onPowerupPickedCatalyst(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  if (!state.catalystOn) return;
  void poolIndex;
  void offeredIndex;
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
//   onLootRoll · onLootCollected · onWaveAdvanced · onEnemyContact · onResourceGranted ·
//   onEnemyStep · onDashPierce · 촉매 해저드→적 피해 루프 ·
//   isPlayerTargetable 등재/제외 · 정산 채널
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
