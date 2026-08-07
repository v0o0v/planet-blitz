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
  void state;
  void player;
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
