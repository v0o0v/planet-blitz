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

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.** 카드 레인이 여기에 `carries` 게이트로
 * 분기를 넣는다. 앵커가 매 틱이 아닌 카드(드랍 롤·격추·접촉·해저드 …)는 이 함수가 아니라
 * `catalystHooks.ts` 의 **해당 디스패치**에 진입 함수를 새로 추가해 걸어라 — 매 틱 자리에
 * 억지로 넣으면 단조 누적이 되어 헌장 §틱 규율을 어긴다.
 */
export function chainOnTick(state: WorldState, player: Entity): void {
  void state;
  void player;
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
