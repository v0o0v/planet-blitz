/**
 * 정련 공정 상태기계(ADR-0040) — 순수 모듈.
 *
 * Pixi·i18n·네트워크·`Math.random` 을 **모른다**. 난수는 전부 인자로 주입받는다(`riskRoll`)
 * — 그래야 용해 판정을 고정값으로 테스트할 수 있다. 모든 함수는 새 상태 객체를 돌려주고
 * 입력 상태·아이템을 변형하지 않는다.
 *
 * ## 루프
 * 1. `openChain(item)` — 공정을 연다. 굴리기 전에는 고착할 수 없다(`canFasten = false`)
 * 2. `rollChain(s, heat, seed, riskRoll)` — **용해 판정을 먼저** 한다.
 *    `riskRoll < meltRisk(고착수, 어픽스수, heat)` 이면 용해이고, 그 경우
 *    `reforgeAffixes` 를 **아예 호출하지 않는다**(시작 직전 상태로 복귀)
 * 3. `fasten(s, i)` — 굴림당 1개. 해제 불가. 잘못된 입력은 예외가 아니라 무시(상태 그대로)
 *
 * ## 하위 호환
 * 고착이 0개면 `meltRisk` 가 정확히 0 이라 어떤 `heat`·`riskRoll` 로도 용해하지 않는다
 * (`riskRoll = 0` 경계 포함 — `0 < 0` 은 false). 그것이 정확히 구 단발 리롤이다.
 */

import type { Item } from './types.js';
import { reforgeAffixes } from './roll.js';
import { HEAT, meltRisk, type Heat } from '../../data/economy.js';

/** 정련 공정의 진행 상태. 전 필드 불변 — 갱신은 항상 새 객체다. */
export interface ChainState {
  /** 공정 시작 시점 스냅샷(용해 복귀점). */
  readonly baseline: Item;
  /** 현재 굴림 결과 — 인벤토리에 항상 이 값이 반영돼 있다. */
  readonly current: Item;
  /** 고착된 어픽스 인덱스(오름차순, 중복 없음). */
  readonly fastened: readonly number[];
  /** 이번 굴림 이후 아직 고착을 쓰지 않았는가(굴림당 1개 규칙). */
  readonly canFasten: boolean;
}

/**
 * 공정을 연다. `baseline === current === item`, 고착 없음, **고착 불가**
 * (굴리지 않은 상태에서 고착하면 판돈 없이 위험만 얻는다).
 */
export function openChain(item: Item): ChainState {
  return { baseline: item, current: item, fastened: [], canFasten: false };
}

/** 모든 어픽스가 고착됐는가(= 더 굴릴 것이 없다). */
export function isComplete(s: ChainState): boolean {
  const count = s.baseline.affixes.length;
  return count > 0 && s.fastened.length >= count;
}

/**
 * 어픽스 하나를 고착한다. `canFasten === false`(아직 안 굴렸거나 이번 굴림에서 이미 썼다)·
 * 이미 고착된 인덱스·범위 밖·비정수면 **상태를 그대로** 돌려준다(예외 아님 — 호출부 UI 가
 * 비활성 버튼으로 이미 거르므로 여기서 던질 이유가 없다).
 */
export function fasten(s: ChainState, index: number): ChainState {
  if (!s.canFasten) return s;
  if (!Number.isInteger(index)) return s;
  if (index < 0 || index >= s.baseline.affixes.length) return s;
  if (s.fastened.indexOf(index) >= 0) return s;
  const next = s.fastened.slice();
  next.push(index);
  next.sort((a, b) => a - b);
  return { baseline: s.baseline, current: s.current, fastened: next, canFasten: false };
}

/** {@link rollChain} 의 결과. */
export interface RollOutcome {
  readonly next: ChainState;
  /** 용해했는가. true 면 next.current === baseline, next.fastened === []. */
  readonly melted: boolean;
  /** 모든 어픽스가 고착되어 공정이 끝났는가. */
  readonly complete: boolean;
}

/**
 * 굴림 1회. `riskRoll` 은 호출부가 넘기는 [0,1) 난수(UI 는 `Math.random`, 테스트는 고정값).
 *
 * 완주 상태면 **가장 먼저** 거부한다(입력 상태를 참조 그대로 반환, `riskRoll` 미소비).
 * 왜 UI 버튼이 아니라 여기서 막는가: 전부 고착된 뒤의 굴림은 재단조가 동일 복사본을 돌려줘
 * **얻을 것이 0인데** 고착이 최대라 `meltRisk` 는 최고점이다 — 한 번 잘못 누르면 거의 확실히
 * 전부 잃는다. 버튼 비활성화는 하네스·테스트가 메서드를 직접 찌르는 경로(실재한다)를 못 막으므로
 * 불변식은 그것을 소유한 이 순수 모듈이 지킨다. **쓸데없는 가드로 보고 지우지 마라.**
 *
 * 그다음이 용해 판정이다 — 용해면 `reforgeAffixes` 를 아예 호출하지 않고 시작 직전 상태로
 * 되돌린다(고착 전량 소실). 성공이면 `baseline` 이 아니라 **`current`** 를 재추첨한다
 * (고착된 값이 `current` 에 살아 있다). `affixCount` 는 공정 내내 불변인 `baseline` 기준.
 */
export function rollChain(
  s: ChainState,
  heat: Heat,
  reforgeSeed: number,
  riskRoll: number,
): RollOutcome {
  // 완주 후 굴림 거부 — 위 JSDoc 참조. 용해 판정보다 반드시 먼저 와야 한다.
  if (isComplete(s)) {
    return { next: s, melted: false, complete: true };
  }

  const affixCount = s.baseline.affixes.length;
  const risk = meltRisk(s.fastened.length, affixCount, heat);

  if (riskRoll < risk) {
    const next: ChainState = {
      baseline: s.baseline,
      current: s.baseline,
      fastened: [],
      canFasten: false,
    };
    return { next, melted: true, complete: false };
  }

  const rolled = reforgeAffixes(s.current, reforgeSeed, {
    fastened: s.fastened,
    band: HEAT[heat].band,
  });
  const next: ChainState = {
    baseline: s.baseline,
    current: rolled,
    fastened: s.fastened.slice(),
    canFasten: true,
  };
  return { next, melted: false, complete: isComplete(next) };
}
