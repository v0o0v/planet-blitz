/**
 * 촉매 주입 게이트 — src/data/catalystInject.ts (ADR-0029 Lane 4 → **ADR-0052 개정**).
 *
 * 픽커(Pixi)는 node vitest 로 렌더를 못 돌리므로 게이트 규칙을 순수 함수로 뽑아 여기서 검증한다.
 * SLOT_CAP · 특산-행성 · **유니크** · **특산 상한** · 보유 — 서버 `consume_catalysts` 와 정합해야 한다.
 *
 * ⚠️ **거동이 바뀐 축이 하나 있다.** 구 모델은 같은 카드를 보유 수량만큼 쌓을 수 있었고 이 파일이
 * 그것을 잠그고 있었다("현재 스택 < 보유 수량"). ADR-0052 가 스택을 없애 같은 카드는 **한 장뿐**이고,
 * `normalizeCatalystArray` 가 중복을 접는다 — 게이트가 옛 규칙을 지키면 픽커에서는 넣히는데
 * 정규화가 지워 버리는 어긋남이 난다. 그래서 그 단언을 유니크 단언으로 갈아 끼웠다.
 */

import { describe, it, expect } from 'vitest';
import {
  canInjectCatalyst,
  catalystInjectBlock,
  catalystLocked,
  injectedCount,
  ownedCount,
} from '../src/data/catalystInject.js';
import { catalystById, SIGNATURE_CAP, SLOT_CAP, CATALYSTS } from '../src/data/catalysts.js';

/** 공용 촉매 하나(abundance = id 0). */
const COMMON = catalystById(0)!;
/** 공용 촉매 둘째(plunder = id 1) — 슬롯을 채우되 중복이 아닌 것이 필요할 때. */
const COMMON2 = catalystById(1)!;
/** 카르곤(planet 0) 특산 하나(kargon-swarmcall = id 30). */
const SIG_KARGON = CATALYSTS.find((c) => c.slug === 'kargon-swarmcall')!;
/** 같은 행성 특산 셋 — 특산 상한(2)을 재려면 세 장이 다 카르곤이어야 한다. */
const SIG_KARGON_ALL = CATALYSTS.filter((c) => c.kind === 'signature' && c.planet === 0);

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

describe('canInjectCatalyst — 슬롯·유니크·특산상한·보유·잠금 5규칙', () => {
  it('보유가 있고 슬롯 여유가 있으면 주입 가능', () => {
    expect(canInjectCatalyst(COMMON, [], inv([[0, 2]]), 0)).toBe(true);
  });

  it('보유 0 이면 주입 불가(서버 원장 없음/오프라인)', () => {
    expect(canInjectCatalyst(COMMON, [], inv([]), 0)).toBe(false);
  });

  it('⚠️ 같은 카드는 한 장뿐 — 보유가 아무리 많아도 두 번째가 안 들어간다', () => {
    // 구 모델은 여기서 "2보유면 2주입 가능" 이었다. 스택이 사라졌으므로 보유 수량과 무관하다 —
    // 넣히면 `normalizeCatalystArray` 가 조용히 지워 화면과 런이 갈린다.
    expect(canInjectCatalyst(COMMON, [0], inv([[0, 1]]), 0)).toBe(false);
    expect(canInjectCatalyst(COMMON, [0], inv([[0, 9]]), 0)).toBe(false);
    expect(catalystInjectBlock(COMMON, [0], inv([[0, 9]]), 0)).toBe('duplicate');
  });

  it('SLOT_CAP 에 도달하면 어떤 촉매도 못 넣는다', () => {
    // ⚠️ 유니크라 슬롯을 **서로 다른 카드**로 채워야 한다(같은 id 를 반복하면 중복에 먼저 걸린다).
    const full = CATALYSTS.filter((c) => c.kind === 'common')
      .slice(0, SLOT_CAP)
      .map((c) => c.id);
    expect(full.length).toBe(SLOT_CAP);
    const spare = CATALYSTS.find((c) => c.kind === 'common' && !full.includes(c.id))!;
    expect(canInjectCatalyst(spare, full, inv([[spare.id, 99]]), 0)).toBe(false);
    expect(catalystInjectBlock(spare, full, inv([[spare.id, 99]]), 0)).toBe('slotFull');
  });

  it('특산은 한 런에 SIGNATURE_CAP 장까지 — 세 장째가 막힌다', () => {
    const [a, b, c] = SIG_KARGON_ALL;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (a === undefined || b === undefined || c === undefined) return;
    expect(SIGNATURE_CAP).toBe(2);
    const stock = inv([
      [a.id, 1],
      [b.id, 1],
      [c.id, 1],
    ]);
    expect(canInjectCatalyst(b, [a.id], stock, 0)).toBe(true); // 둘째까지는 열린다
    // 슬롯(3)은 아직 남아 있는데도 막혀야 한다 — 슬롯 상한이 대신 잡아 주는 것이 아니다.
    expect(canInjectCatalyst(c, [a.id, b.id], stock, 0)).toBe(false);
    expect(catalystInjectBlock(c, [a.id, b.id], stock, 0)).toBe('signatureCap');
    // 공용은 특산 둘이 있어도 셋째 자리에 들어간다.
    expect(canInjectCatalyst(COMMON, [a.id, b.id], inv([[COMMON.id, 1]]), 0)).toBe(true);
  });

  it('특산은 출신 행성이 아니면 보유가 있어도 비활성', () => {
    expect(canInjectCatalyst(SIG_KARGON, [], inv([[SIG_KARGON.id, 5]]), 1)).toBe(false); // 잠금
    expect(canInjectCatalyst(SIG_KARGON, [], inv([[SIG_KARGON.id, 5]]), 0)).toBe(true); // 출신
    expect(catalystInjectBlock(SIG_KARGON, [], inv([[SIG_KARGON.id, 5]]), 1)).toBe('locked');
  });

  it('막힘 사유는 잠금 → 중복 → 보유 → 슬롯 → 특산상한 순으로 설명적인 것이 먼저다', () => {
    // 잠긴 특산에 "슬롯 가득참"이 뜨면 슬롯을 비워도 안 되는 이유를 못 배운다.
    const full = [COMMON.id, COMMON2.id, catalystById(2)!.id];
    expect(catalystInjectBlock(SIG_KARGON, full, inv([[SIG_KARGON.id, 1]]), 1)).toBe('locked');
    expect(catalystInjectBlock(COMMON, full, inv([[COMMON.id, 1]]), 0)).toBe('duplicate');
  });
});

describe('injectedCount / ownedCount — 장수·보유 카운트', () => {
  it('injectedCount 는 주입 배열의 장수(유니크라 0 또는 1, 날 배열은 그대로 센다)', () => {
    expect(injectedCount([0, 0, 1], 0)).toBe(2);
    expect(injectedCount([0, 0, 1], 1)).toBe(1);
    expect(injectedCount([], 0)).toBe(0);
  });

  it('ownedCount 는 보유 스냅샷 조회(없으면 0)', () => {
    expect(ownedCount(inv([[5, 3]]), 5)).toBe(3);
    expect(ownedCount(inv([[5, 3]]), 9)).toBe(0);
  });
});
