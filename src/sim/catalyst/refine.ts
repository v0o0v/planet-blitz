/**
 * 촉매 **정련 축**(id 5~9) — 카드 본체가 들어갈 자리.
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

/** id 5 — slug `refinement`. 정본은 `src/data/catalysts.ts`. */
export const CARD_REFINEMENT = 5;

/** id 6 — slug `gilding`. 정본은 `src/data/catalysts.ts`. */
export const CARD_GILDING = 6;

/** id 7 — slug `prospect`. 정본은 `src/data/catalysts.ts`. */
export const CARD_PROSPECT = 7;

/** id 8 — slug `alchemy`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ALCHEMY = 8;

/** id 9 — slug `epiphany`. 정본은 `src/data/catalysts.ts`. */
export const CARD_EPIPHANY = 9;

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.** 카드 레인이 여기에 `carries` 게이트로
 * 분기를 넣는다. 앵커가 매 틱이 아닌 카드(드랍 롤·격추·접촉·해저드 …)는 이 함수가 아니라
 * `catalystHooks.ts` 의 **해당 디스패치**에 진입 함수를 새로 추가해 걸어라 — 매 틱 자리에
 * 억지로 넣으면 단조 누적이 되어 헌장 §틱 규율을 어긴다.
 */
export function refineOnTick(state: WorldState, player: Entity): void {
  void state;
  void player;
}

// ---------------------------------------------------------------------------
// id 9 epiphany — **배선 완료**(파워업 3택 축). 거동 불변으로 `catalystHooks.ts` 에서 옮겨 왔다
// ---------------------------------------------------------------------------

/**
 * `id 9 epiphany` — 3택이 **1택으로 접힌다**(거부할 수 없다).
 *
 * 프리즈는 그대로라 픽 입력이 와야 런이 재개되고, `world.ts` 의 `idxOffered < length` 가드가
 * 1칸만 허용한다.
 *
 * ⚠️⚠️ **RNG 미소비.** `drawPowerupChoices` 가 이미 뽑아 놓은 결과를 **자리째 줄일 뿐**
 * 재추첨·추가 뽑기를 하지 않는다. 그래서 같은 시드의 `powerupRng` 스트림 위치가 촉매 유무와
 * 무관하게 동일하고, 이후 레벨의 3택도 통째로 같다.
 *
 * ⚠️ 적용 순서는 **mastery → epiphany 고정**이다(호출부 계약). mastery 가 전 칸을 첫 칸으로
 * 채운 뒤 epiphany 가 1칸으로 접으므로 남는 것은 첫 칸이다.
 */
export function epiphanyOnPowerupOffer(state: WorldState, offers: number[]): void {
  if (!carries(state, CARD_EPIPHANY)) return;
  offers.length = 1;
}

/**
 * `id 9 epiphany` 의 **중첩 추가분**(기본 1중첩 + 1 = 2중첩). `world.ts` 가 이미 기본 1중첩을
 * 적용한 뒤이므로 여기는 추가분만 센다.
 */
export function epiphanyExtraStacks(state: WorldState): number {
  return carries(state, CARD_EPIPHANY) ? 1 : 0;
}
