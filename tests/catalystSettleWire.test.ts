/**
 * 촉매 정산 계층의 **끊겨 있던 절반 둘** (ADR-0052 배선 레인).
 *
 *  ① `catalystDropMult` — 드랍축 4종(id 21·33·38·45)의 배율이 **귀속 원장에서** 나와
 *     `catalystDropsFromRun` 에 도달한다.
 *  ② `id 18 mercantile` — 런 종료 시 부채 상환 · 미상환분만큼의 전리품 압류.
 *
 * ## 이 파일이 기계로 잠그는 것 (셋 다 이 레인의 실패 모드다)
 *  - **무조건 배율 금지**(헌장 §상한 근거 규율). 카드를 꽂았다는 사실만으로는 배율이 서면 안
 *    된다 — 구 모델이 `catalystRewardMult(ids,'catalystDrop')` 로 정확히 그 실수를 했다.
 *    아래 "주입만 하고 발동 0" 절이 그것을 잠근다.
 *  - **무촉매 런 불변**. 채널이 `undefined` 라 필드가 안 실리고, 드랍 결과가 종전과 같아야
 *    한다(음성 대조 — 이 절이 없으면 나머지 단언은 전부 "늘어나기만 하면 통과"가 된다).
 *  - **부채는 런 안에서 닫힌다**. 다음 런에 따라가면 ADR-0029 §적용 단위 위반이고,
 *    무촉매 런이 촉매 효과를 받게 되어 바이트 불변 규율까지 무너진다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container } from 'pixi.js';

import {
  catalystDropsFromRun,
  catalystDropMultFromContributions,
  CATALYST_DROP_AXIS_IDS,
  type CatalystContributionLike,
} from '../src/data/catalystDrops.js';
import { CATALYSTS } from '../src/data/catalysts.js';
import { settleRun } from '../src/save/settlement.js';
import { defaultProfile } from '../src/save/profile.js';
import { RARITY_CODE, SEALED_RARITY_CODE } from '../src/items/types.js';
import { ResultOverlayScreen } from '../src/ui/pixi/resultOverlay.js';
import type { ResultState } from '../src/ui/resultOverlay.js';

/** `resultOverlay.show/hide` 의 `setDomHidden` 한 줄만 여는 최소 스텁(metaCeremonyWiring 선례). */
const g = globalThis as unknown as { document?: { getElementById(id: string): null } };
if (typeof g.document === 'undefined') {
  g.document = { getElementById: () => null };
}

/** 원장 한 행 만들기. `fired` 는 환산에 안 쓰이지만 계약상 실린 칸이라 그대로 채운다. */
function led(id: number, earned: number, missed = 0): CatalystContributionLike {
  return { id, fired: earned, earned, missed };
}

/** 슬롯 한 벌(24칸) — 정산 채널 형상 그대로. */
function slots(debt: number): number[] {
  const out = new Array<number>(24).fill(0);
  out[SLOT_MERCANTILE_DEBT] = debt;
  return out;
}

/** `MercantileSlot.Debt`. `const enum` 은 런타임 값이 없어 숫자로 적는다(아래 절이 잠근다). */
const SLOT_MERCANTILE_DEBT = 6;

/** 실효 천장 = `MAX_DROP_CHANCE_CP / BASE_DROP_CHANCE_CP`(catalystDrops.ts 의 두 상수). */
const EFFECTIVE_MAX = 9500 / 6000;

// ===========================================================================
// ① catalystDropMult — 귀속 원장 → 배율
// ===========================================================================

describe('① 무촉매 런 — 배율이 정확히 1 이고 드랍이 종전과 동일하다 (음성 대조)', () => {
  const LOOT = [{ seed: 0x1111 }, { seed: 0x2222 }, { seed: 0x3333 }, { seed: 0x4444 }];

  it('채널이 `undefined` 면 배율이 정확히 1 이다', () => {
    expect(catalystDropMultFromContributions(undefined)).toBe(1);
    // 빈 원장(적립이 한 번도 없던 런)도 같다.
    expect(catalystDropMultFromContributions([])).toBe(1);
  });

  it('⭐ 필드 미탑재 · 배율 1 · 명시 1 — 셋의 드랍 결과가 완전히 같다', () => {
    const base = { loot: LOOT, planet: 0, catalysts: [] as number[] };
    const without = catalystDropsFromRun(base);
    const withOne = catalystDropsFromRun({ ...base, catalystDropMult: 1 });
    const withUndef = catalystDropsFromRun({
      ...base,
      catalystDropMult: catalystDropMultFromContributions(undefined),
    });
    // 나쁜 상태: 배선이 배율을 1 이 아닌 값으로 세우면 무촉매 런의 촉매 유입이 바뀐다.
    expect(withOne).toEqual(without);
    expect(withUndef).toEqual(without);
  });
});

describe('① 주입만 하고 발동 0 이면 배율이 1 이다 (무조건 배율 금지 — 헌장 §상한 근거 규율)', () => {
  it.each([21, 33, 38, 45])('id %i — 원장은 있는데 센 것이 0', (id) => {
    // 카드를 꽂았고 원장 행까지 섰지만 조건을 한 번도 못 채운 런.
    expect(catalystDropMultFromContributions([led(id, 0)])).toBe(1);
  });

  it('id 21 은 결정을 전부 잃어도(earned === missed) 1 이다', () => {
    // 정착 수 = earned − missed. 박았다가 다 부서졌으면 밭이 비어 있는 것이므로 배율이 없다.
    expect(catalystDropMultFromContributions([{ id: 21, fired: 7, earned: 7, missed: 7 }])).toBe(1);
    // 더 잃어서 음수가 되어도 1 아래로 내려가지 않는다.
    expect(catalystDropMultFromContributions([{ id: 21, fired: 3, earned: 3, missed: 9 }])).toBe(1);
  });

  it('드랍축이 아닌 카드는 배율에 손대지 못한다', () => {
    // id 17 greed 는 resource 축이다 — 원장에 아무리 쌓여도 촉매 드랍은 안 는다.
    expect(catalystDropMultFromContributions([led(17, 9999)])).toBe(1);
  });
});

describe('① 발동 수가 실제로 배율에 도달한다', () => {
  // 합성식 = 1 + Σ(cap−1)×progress×0.5. 네 카드 전부 cap 1.5 라 포화 1장 = 1 + 0.5×0.5 = 1.25.
  const SATURATED: readonly (readonly [number, CatalystContributionLike])[] = [
    [21, led(21, 12)], // 정착 결정 12 = SHARD_LIVE_CAP
    // ⚠️ 33·45 는 **실측으로 채운 포화점**이다(2026-08-08, 60런 분포의 p90 근방). 종전
    // placeholder 20·15 는 실측 최솟값(37)·p17 보다 작아 **모든 런이 즉시 포화**했다 —
    // 조건축이 존재하지 않는 상태였고 그것이 곧 헌장이 금지한 무조건 배율이다.
    // 값 정본은 `src/data/catalystDrops.ts` 의 `saturation` 이고 여기는 그것을 되적는다.
    [33, led(33, 90)], // 점프 즉사 90
    [38, led(38, 1)], // 기함 격추 1(런당 한 척 — 이진 사건)
    [45, led(45, 55)], // 엄폐 뒤 부순 블록 55
  ];

  it.each(SATURATED)('id %i — 포화하면 개별 상한(×1.5)의 합성분에 닿는다', (_id, row) => {
    expect(catalystDropMultFromContributions([row])).toBeCloseTo(1.25, 10);
  });

  it('절반만 채우면 배율도 절반이다 (선형 진행)', () => {
    expect(catalystDropMultFromContributions([led(21, 6)])).toBeCloseTo(1.125, 10);
    expect(catalystDropMultFromContributions([led(33, 45)])).toBeCloseTo(1.125, 10);
  });

  it('포화 이상은 더 안 오른다 (개별 상한 초과 금지)', () => {
    expect(catalystDropMultFromContributions([led(33, 10_000)])).toBeCloseTo(1.25, 10);
  });

  it('⭐ 배율이 실제로 드랍 수를 늘린다 (환산이 게이트까지 도달하는지)', () => {
    // 시드 20개 — base 60% 게이트에서 배율이 오르면 통과 수가 늘어야 한다.
    const loot = Array.from({ length: 20 }, (_, i) => ({ seed: 0x9000 + i * 0x137 }));
    const base = { loot, planet: 1, catalysts: [33] };
    const plain = catalystDropsFromRun(base).reduce((n, d) => n + d.qty, 0);
    const boosted = catalystDropsFromRun({
      ...base,
      catalystDropMult: catalystDropMultFromContributions([led(33, 20)]),
    }).reduce((n, d) => n + d.qty, 0);
    expect(boosted).toBeGreaterThan(plain);
  });
});

describe('① 실효 천장 ×1.58 을 넘지 않는다 (헌장 §경제 결합 규율)', () => {
  it('네 장이 전부 포화해도 `MAX_DROP_CHANCE_CP / BASE_DROP_CHANCE_CP` 에서 잘린다', () => {
    const all = SATURATED_ALL();
    const m = catalystDropMultFromContributions(all);
    // 합성 원값은 1 + (0.5×4)×0.5 = 2.0 이다 — 클램프가 없으면 여기서 2.0 이 나온다.
    expect(m).toBeCloseTo(EFFECTIVE_MAX, 10);
    expect(m).toBeLessThanOrEqual(EFFECTIVE_MAX);
    expect(m).toBeLessThan(1.5834);
  });

  it('천장을 넘겨도 `catalystDropsFromRun` 의 게이트가 9500cp 를 안 넘는다 (이중 방어)', () => {
    // 배율을 손으로 100 배로 넣어도 드랍 수는 상한 게이트 이상으로 안 는다.
    const loot = Array.from({ length: 40 }, (_, i) => ({ seed: 0xa000 + i * 0x91 }));
    const capped = catalystDropsFromRun({ loot, planet: 0, catalysts: [], catalystDropMult: 100 });
    expect(capped.reduce((n, d) => n + d.qty, 0)).toBeLessThanOrEqual(loot.length);
  });

  function SATURATED_ALL(): CatalystContributionLike[] {
    return [led(21, 12), led(33, 20), led(38, 1), led(45, 15)];
  }
});

describe('① 환산표와 카탈로그가 갈리지 않는다', () => {
  it('`cap.axis === "catalystDrop"` 인 카드 집합이 환산표와 정확히 같다', () => {
    const fromCatalog = CATALYSTS.filter((c) => c.cap.axis === 'catalystDrop')
      .map((c) => c.id)
      .sort((a, b) => a - b);
    expect([...CATALYST_DROP_AXIS_IDS].sort((a, b) => a - b)).toEqual(fromCatalog);
    // 정본이 넷이라는 것 자체도 잠근다(카탈로그가 늘면 환산식을 함께 정해야 한다).
    expect(fromCatalog).toEqual([21, 33, 38, 45]);
  });
});

// ===========================================================================
// ② id 18 mercantile — 상환 · 압류
// ===========================================================================

const LOOT5 = [
  { seed: 0x1001, rarity: RARITY_CODE.normal, planet: 1, stage: 3, elite: 1 },
  { seed: 0x1002, rarity: RARITY_CODE.magic, planet: 1, stage: 3, elite: 1 },
  { seed: 0x1003, rarity: RARITY_CODE.rare, planet: 1, stage: 3, elite: 1 },
  { seed: 0x1004, rarity: RARITY_CODE.normal, planet: 1, stage: 3, elite: 1 },
  { seed: 0x1005, rarity: RARITY_CODE.magic, planet: 1, stage: 3, elite: 1 },
] as const;

const RUN = { victory: true, xpTotal: 300, planet: 1, stage: 3 } as const;

describe('② 자원이 충분하면 상환만 하고 전리품은 안 건드린다', () => {
  it('상환분이 크레딧에서 빠지고 압류는 0 이다', () => {
    const p = defaultProfile();
    const out = settleRun(p, {
      ...RUN,
      loot: [...LOOT5],
      resources: 200,
      catalystSettlement: slots(80),
    });
    expect(out.catalystDebt).toEqual({ total: 80, repaid: 80, unpaid: 0, seized: 0 });
    expect(out.creditsGained).toBe(120);
    // 나쁜 상태: 갚을 수 있는데 전리품까지 가져가면 카드 문장과 갈린다.
    expect(out.itemsGained.length).toBe(5);
  });
});

describe('② 자원이 모자라면 **미상환분만큼만** 압류한다', () => {
  it('압류 점수 = 올림(미상환분 / 40) 이고 그 이상은 안 가져간다', () => {
    const p = defaultProfile();
    const out = settleRun(p, {
      ...RUN,
      loot: [...LOOT5],
      resources: 40,
      catalystSettlement: slots(200),
    });
    // 부채 200 − 자원 40 = 미상환 160 → 160/40 = 4점.
    expect(out.catalystDebt).toEqual({ total: 200, repaid: 40, unpaid: 160, seized: 4 });
    expect(out.creditsGained).toBe(0);
    // 나쁜 상태: 5점 전부를 가져가면 "미상환분만큼" 이 아니라 전액 몰수가 된다.
    expect(out.itemsGained.length).toBe(1);
    expect(p.inventory.length).toBe(1);
  });

  it('전리품이 모자라면 거기서 멈추고 잔액은 소멸한다 (런 안에서 닫힌다)', () => {
    const p = defaultProfile();
    const out = settleRun(p, {
      ...RUN,
      loot: [...LOOT5],
      resources: 0,
      catalystSettlement: slots(10_000),
    });
    expect(out.catalystDebt?.seized).toBe(5);
    expect(out.itemsGained).toEqual([]);
    // 프로필 어디에도 잔액이 남지 않는다.
    expect(JSON.stringify(p)).not.toContain('debt');
  });

  it('압류는 **그 런의 전리품**에서만 일어난다 — 보유 인벤토리는 안 건드린다', () => {
    const p = defaultProfile();
    // 먼저 무부채 런으로 인벤을 채운다.
    settleRun(p, { ...RUN, loot: [...LOOT5], resources: 0 });
    const owned = p.inventory.length;
    expect(owned).toBe(5);
    // 그다음 런에서 전액 압류가 나도 보유분은 그대로여야 한다.
    const out = settleRun(p, {
      ...RUN,
      loot: [...LOOT5],
      resources: 0,
      catalystSettlement: slots(10_000),
    });
    expect(out.itemsGained).toEqual([]);
    expect(p.inventory.length).toBe(owned);
  });
});

describe('② 부채는 다음 런에 따라가지 않는다 (ADR-0029 §적용 단위)', () => {
  it('부채 런 뒤의 무촉매 런은 상환도 압류도 없다', () => {
    const p = defaultProfile();
    settleRun(p, { ...RUN, loot: [...LOOT5], resources: 0, catalystSettlement: slots(10_000) });
    // 다음 런 — 채널 자체가 없다(무촉매).
    const next = settleRun(p, { ...RUN, loot: [...LOOT5], resources: 150 });
    expect(next.catalystDebt).toBeUndefined();
    expect(next.creditsGained).toBe(150);
    expect(next.itemsGained.length).toBe(5);
  });
});

describe('② 무촉매 런 · 무부채 런은 종전과 비트 동일하다', () => {
  it('채널이 없으면 `catalystDebt` 칸 자체가 안 실린다', () => {
    const p = defaultProfile();
    const out = settleRun(p, { ...RUN, loot: [...LOOT5], resources: 90 });
    expect(out.catalystDebt).toBeUndefined();
    expect(out.creditsGained).toBe(90);
    expect('catalystDebt' in out).toBe(false);
  });

  it('부채 0 인 촉매 런도 마찬가지다 (빚 카드를 안 받은 런)', () => {
    const p = defaultProfile();
    const withChannel = settleRun(p, {
      ...RUN,
      loot: [...LOOT5],
      resources: 90,
      catalystSettlement: slots(0),
    });
    const q = defaultProfile();
    const without = settleRun(q, { ...RUN, loot: [...LOOT5], resources: 90 });
    expect(withChannel.catalystDebt).toBeUndefined();
    expect(withChannel.creditsGained).toBe(without.creditsGained);
    expect(withChannel.itemsGained).toEqual(without.itemsGained);
  });
});

describe('② 슬롯 index 정본이 배정표와 같다', () => {
  it('`catalystSlots.ts` 의 `MercantileSlot.Debt` 가 6 이다', () => {
    // 정산이 숫자로 되적은 값이 배정표와 갈리면 **엉뚱한 칸을 부채로 읽는다**(예: FoundrySlot).
    // `const enum` 은 런타임 값이 없어 import 로 못 잠그므로 소스를 읽어 잠근다.
    const src = readFileSync(
      fileURLToPath(new URL('../src/sim/catalystSlots.ts', import.meta.url)),
      'utf8',
    );
    expect(/enum MercantileSlot\s*\{[^}]*\bDebt\s*=\s*6\b/.test(src)).toBe(true);
  });
});

// ===========================================================================
// ③ 정산 화면 — 상환분과 압류분이 갈려 보인다 (명세의 `신호:` 칸)
// ===========================================================================

describe('③ 정산 화면이 상환분과 압류분을 두 줄로 가른다', () => {
  function resultWith(debtRepaid?: number, debtSeized?: number): ResultState {
    return {
      victory: true,
      seed: 1,
      xpTotal: 100,
      kills: 10,
      maxCombo: 5,
      resources: 50,
      level: 3,
      timeSec: 90,
      settlement: {
        itemsGained: 1,
        levelsGained: 0,
        skillPointsGained: 0,
        creditsGained: 0,
        overflow: 0,
        combatPower: 10,
        drops: [],
        ...(debtRepaid !== undefined ? { debtRepaid } : {}),
        ...(debtSeized !== undefined ? { debtSeized } : {}),
      },
    };
  }

  /** 화면 트리의 모든 텍스트를 긁는다. */
  function texts(node: unknown): string[] {
    const n = node as { text?: unknown; children?: readonly unknown[] };
    const out: string[] = [];
    if (typeof n.text === 'string') out.push(n.text);
    for (const c of n.children ?? []) out.push(...texts(c));
    return out;
  }

  it('두 값이 서로 다른 줄로 뜬다 (한 숫자로 합치지 않는다)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(resultWith(120, 3), () => {});
    const all = texts((overlay as unknown as { root: unknown }).root).join('\n');
    // 나쁜 상태: 둘을 합치면 "자원이 왜 줄었나"와 "장비가 왜 사라졌나"를 구분할 수 없다.
    expect(all).toContain('부채 상환');
    expect(all).toContain('-120');
    expect(all).toContain('전리품 압류');
    expect(all).toContain('3점');
    overlay.hide();
  });

  it('부채가 없는 런에는 두 줄 다 안 뜬다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(resultWith(), () => {});
    const all = texts((overlay as unknown as { root: unknown }).root).join('\n');
    expect(all).not.toContain('부채 상환');
    expect(all).not.toContain('전리품 압류');
    overlay.hide();
  });
});

// ===========================================================================
// ③ 도박 강 공명 '청산' — 패배 시 **봉인 전리품이 사라진다** (2026-08-08)
// ===========================================================================
//
// 규칙문: *"첫 전리품이 봉인된다. 보스를 처치하면 최고 등급으로 열리고, **지면 그것만
// 사라진다**."* sim 이 봉인·개봉까지 하고, 마지막 조항(소멸)은 정산 몫이다 — sim 은 "졌다"를
// 런 안에서 관측하지 않는다. 이 절이 없던 동안 봉인 레코드는 최저 등급으로 접힐 뿐 사라지지
// 않았다.

describe("③ 도박 강 '청산' — 패배 소멸", () => {
  /** 첫 칸이 봉인된 전리품 5점. */
  const SEALED5 = [
    { seed: 0x2001, rarity: SEALED_RARITY_CODE, planet: 1, stage: 3, elite: 1 } as const,
    ...LOOT5.slice(1),
  ];

  it('패배: 봉인 레코드가 **드랍 목록에서 사라진다**(최저 등급으로 접히는 게 아니다)', () => {
    const p = defaultProfile();
    const out = settleRun(p, { ...RUN, victory: false, loot: SEALED5, resources: 0 });
    expect(out.sealedVoided).toBe(1);
    expect(out.itemsGained.length).toBe(4); // 5 − 봉인 1
    expect(p.inventory.length).toBe(4);
    // ⚠️ 개수만 보면 옛 상태(`RARITY_BY_CODE[9] ?? 'normal'` 로 **접혀서** normal 한 점이 남는)와
    //    5 vs 4 로 갈리긴 하지만, 더 강하게 못 박는다: **봉인분을 애초에 뺀 목록**으로 돈 런과
    //    확정된 아이템이 한 점씩 같아야 한다(= 봉인분이 흔적 없이 빠졌다).
    const control = defaultProfile();
    const same = settleRun(control, { ...RUN, victory: false, loot: [...LOOT5.slice(1)], resources: 0 });
    expect(out.itemsGained).toEqual(same.itemsGained);
  });

  it('승리: 사라지지 않는다 — 개봉은 sim 이 이미 했고 정산은 그대로 확정한다', () => {
    const p = defaultProfile();
    // 승리 런은 sim 이 봉인을 최고 등급(3)으로 열어 둔 상태로 넘어온다.
    const opened = [{ ...SEALED5[0]!, rarity: RARITY_CODE.unique }, ...LOOT5.slice(1)];
    const out = settleRun(p, { ...RUN, victory: true, loot: opened, resources: 0 });
    expect(out.sealedVoided).toBeUndefined();
    expect(out.itemsGained.length).toBe(5);
    expect(out.itemsGained[0]?.rarity).toBe('unique');
  });

  it('⚠️ 봉인이 안 걸린 런은 형상이 **한 칸도 안 바뀐다**(패배여도)', () => {
    const p = defaultProfile();
    const out = settleRun(p, { ...RUN, victory: false, loot: [...LOOT5], resources: 0 });
    expect(out.sealedVoided).toBeUndefined();
    expect(out.itemsGained.length).toBe(5);
  });

  it('⚠️ 소멸이 압류(`id 18`)보다 **앞**이다 — 없는 전리품으로 빚을 갚지 않는다', () => {
    const p = defaultProfile();
    const out = settleRun(p, {
      ...RUN,
      victory: false,
      loot: SEALED5,
      resources: 0,
      catalystSettlement: slots(80), // 미상환 80 → 압류 2점
    });
    expect(out.sealedVoided).toBe(1);
    expect(out.catalystDebt?.seized).toBe(2);
    // 5 − 봉인 1 − 압류 2 = 2. 순서가 뒤였다면 압류가 이미 사라질 레코드를 먹어 3점이 남는다.
    expect(out.itemsGained.length).toBe(2);
  });

  it('⚠️ 소멸은 **촉매 드랍 축을 안 깎는다** — 규칙문의 「그것만」', () => {
    // 정산은 지역 사본만 거른다. 촉매 드랍은 호출부가 `w.loot` 원본을 넘기므로 영향이 없다.
    const src = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../src/save/settlement.ts', import.meta.url))),
    );
    // 설계도 파생도 원본을 계속 읽는다(`id 18` 압류와 같은 계층).
    // ⚠️ 2026-08-08 클리어 게이트로 호출이 여러 줄이 됐다 — 인자 첫 줄만 본다.
    expect(src).toMatch(/blueprintDropsFromLoot\(\s*result\.loot,/);
    expect(src).not.toContain('blueprintDropsFromLoot(settledLoot');
    // 클리어 게이트 배선. 지우면 기본값 false 라 설계도 축 전체가 조용히 죽는다.
    expect(src).toContain('result.victory === true');
  });
});

// ===========================================================================
// ④ 서버 권위 드랍 모드의 클라측 감산 (2026-08-08 검토 결론을 회귀로 못 박는다)
// ===========================================================================
//
// 이 모드에서 `settleRun` 은 전리품을 굴리지 않으므로(`itemsGained` 가 빈 배열) 압류·소멸이
// 일어나는 유일한 자리가 **클라가 주장하는 개수**다. 서버는 `least(주장, 개연성, 캡)` 으로
// 줄이기만 하므로 낮춰 보내는 것은 항상 안전하다 — 근거 전문은 `main.ts` 의 호출부 주석.

describe('④ 서버 권위 드랍 — 압류·소멸이 주장 개수에서 빠진다', () => {
  const MAIN = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
  );

  it('배송 개수에서 압류와 소멸을 **둘 다** 뺀다', () => {
    expect(MAIN).toContain('Math.max(0, w.loot.length - seized - voided)');
  });

  it('두 값이 정산 결과에서 나온다(호출부가 다시 계산하지 않는다)', () => {
    // 다시 계산하면 화면에 적힌 수와 실지급이 갈린다 — 이 리포의 지배적 실패 모드.
    expect(MAIN).toContain('lastOutcome?.catalystDebt?.seized ?? 0');
    expect(MAIN).toContain('lastOutcome?.sealedVoided ?? 0');
  });

  it('서버 권위 모드에서도 정산이 두 값을 **정확히** 낸다(빈 itemsGained 와 무관하게)', () => {
    const p = defaultProfile();
    const out = settleRun(
      p,
      {
        ...RUN,
        victory: false,
        loot: [{ seed: 0x2001, rarity: SEALED_RARITY_CODE, planet: 1, stage: 3, elite: 1 } as const, ...LOOT5.slice(1)],
        resources: 0,
        catalystSettlement: slots(80),
      },
      { serverDrops: true },
    );
    expect(out.itemsGained).toEqual([]); // 서버가 굴린다
    expect(out.sealedVoided).toBe(1);
    expect(out.catalystDebt?.seized).toBe(2);
    // 주장 개수 = 5 − 1 − 2 = 2.
    expect(5 - (out.catalystDebt?.seized ?? 0) - (out.sealedVoided ?? 0)).toBe(2);
  });
});
