/**
 * 촉매 주입 게이트 — src/data/catalystInject.ts (ADR-0029, Lane 4 픽커 규칙).
 *
 * 픽커(Pixi)는 node vitest 로 렌더를 못 돌리므로 게이트 규칙을 순수 함수로 뽑아 여기서 검증한다.
 * SLOT_CAP 강제 · 특산-행성 비활성 · 보유량 상한 — 서버 `consume_catalysts` 검증과 정합해야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  canInjectCatalyst,
  catalystLocked,
  injectedCount,
  ownedCount,
} from '../src/data/catalystInject.js';
import { catalystById, SLOT_CAP, CATALYSTS } from '../src/data/catalysts.js';

/** 공용 촉매 하나(abundance = id 0). */
const COMMON = catalystById(0)!;
/** 카르곤(planet 0) 특산 하나(kargon-swarmcall = id 30). */
const SIG_KARGON = CATALYSTS.find((c) => c.slug === 'kargon-swarmcall')!;

function inv(pairs: [number, number][]): Map<number, number> {
  return new Map(pairs);
}

describe('catalystLocked — 특산-행성 정합', () => {
  it('공용은 어느 행성에서도 잠기지 않는다', () => {
    for (let p = 0; p < 6; p++) expect(catalystLocked(COMMON, p)).toBe(false);
  });

  it('특산은 출신 행성에서만 열린다', () => {
    expect(catalystLocked(SIG_KARGON, 0)).toBe(false); // 출신(카르곤)
    expect(catalystLocked(SIG_KARGON, 1)).toBe(true); // 다른 행성 → 잠금
    expect(catalystLocked(SIG_KARGON, 3)).toBe(true);
  });
});

describe('canInjectCatalyst — 슬롯·보유·잠금 3규칙', () => {
  it('보유가 있고 슬롯 여유가 있으면 주입 가능', () => {
    expect(canInjectCatalyst(COMMON, [], inv([[0, 2]]), 0)).toBe(true);
  });

  it('보유 0 이면 주입 불가(서버 원장 없음/오프라인)', () => {
    expect(canInjectCatalyst(COMMON, [], inv([]), 0)).toBe(false);
  });

  it('현재 주입 스택이 보유 수량에 도달하면 더 못 넣는다', () => {
    expect(canInjectCatalyst(COMMON, [0], inv([[0, 1]]), 0)).toBe(false); // 1보유·1주입 → 불가
    expect(canInjectCatalyst(COMMON, [0], inv([[0, 2]]), 0)).toBe(true); // 2보유·1주입 → 가능
  });

  it('SLOT_CAP 에 도달하면 어떤 촉매도 못 넣는다', () => {
    const full = Array.from({ length: SLOT_CAP }, () => 0); // 8스택
    expect(full.length).toBe(SLOT_CAP);
    expect(canInjectCatalyst(COMMON, full, inv([[0, 99]]), 0)).toBe(false); // 보유 충분해도 슬롯 상한
  });

  it('특산은 출신 행성이 아니면 보유가 있어도 비활성', () => {
    expect(canInjectCatalyst(SIG_KARGON, [], inv([[SIG_KARGON.id, 5]]), 1)).toBe(false); // 잠금
    expect(canInjectCatalyst(SIG_KARGON, [], inv([[SIG_KARGON.id, 5]]), 0)).toBe(true); // 출신
  });
});

describe('injectedCount / ownedCount — 스택·보유 카운트', () => {
  it('injectedCount 는 주입 배열의 스택 수', () => {
    expect(injectedCount([0, 0, 1], 0)).toBe(2);
    expect(injectedCount([0, 0, 1], 1)).toBe(1);
    expect(injectedCount([], 0)).toBe(0);
  });

  it('ownedCount 는 보유 스냅샷 조회(없으면 0)', () => {
    expect(ownedCount(inv([[5, 3]]), 5)).toBe(3);
    expect(ownedCount(inv([[5, 3]]), 9)).toBe(0);
  });
});
