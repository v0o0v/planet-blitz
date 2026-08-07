/**
 * 정련 3층 정합 — 스킬 어픽스가 낀 아이템에서 열리던 **무한 함정**의 회귀 테스트
 * (`.omc/plans` 어픽스 재편 레인 2 · 설계서 단계 6).
 *
 * ## 문제였던 것
 * 스킬 어픽스는 정련에서 암묵 고착이다(`roll.ts` 의 `reforgeAffixes` 가 `fastened` 와 무관하게
 * 항상 유지한다). 그런데 완주·위험도 분모가 그대로 `item.affixes.length` 였다면, 어픽스
 * `count` 중 1개가 스킬 어픽스인 아이템에서 나머지 `count−1` 을 전부 고착한 순간 —
 *  - `isComplete`: `fastened.length(count−1) >= count` → 영원히 거짓(완주 불가)
 *  - `meltRisk`: 분모 `count`, 분자 `count−1` → 최고 위험 근처
 * 광물을 내고 최고 위험을 지고 아무것도 못 얻고 출구도 없는 함정이 열린다. 스킬 어픽스 행은
 * 고착 버튼이 비활성이라 `count` 번째 고착에 도달할 방법이 없다.
 *
 * 처방: 분자(`fastened.length`, 사용자가 실제로 누른 고착 수)는 그대로 두고, 분모를
 * `rerollableCount(item) = affixes.length - skillAffixCount(affixes)` 로 바꾼다
 * (`src/items/refiningChain.ts`). `src/ui/pixi/refinery.ts` 의 표시용 위험도·고착 카운터도
 * **같은 헬퍼**를 써야 한다 — 분모가 갈리면 "숫자를 보고 눌렀는데 다르게 터진다."
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container, DOMAdapter } from 'pixi.js';

import {
  openChain,
  fasten,
  rollChain,
  isComplete,
  rerollableCount,
  type ChainState,
} from '../src/items/refiningChain.js';
import { meltRisk, HEATS, RISK_MAX, type Heat } from '../data/economy.js';
import { defaultProfile, type Profile } from '../src/save/profile.js';
import { RefineryScreen } from '../src/ui/pixi/refinery.js';
import type { Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 손으로 빚은 아이템 — `rollItem` 은 stage < 9 에서 스킬 어픽스를 절대 안 준다(affixPool.ts
// `SKILL_AFFIX_MIN_STAGE`). 분모 결함은 스킬 어픽스가 실제로 붙은 아이템에서만 재현되므로
// 시드 탐색 대신 손으로 구성한다 — id·slot·stat 은 `data/affixes.ts` 정본 그대로다.
// ---------------------------------------------------------------------------

const SRC = { planet: 0, stage: 10 };

/** 스킬 어픽스 1개(`of-honing`) + 일반 어픽스 3개(rerollable = 3). */
function itemWithSkillAffix(id = 'test-skill-1'): Item {
  return {
    id,
    slot: 'main',
    rarity: 'rare',
    affixes: [
      { id: 'of-honing', stat: 'skillLvOffense', value: 1 }, // 스킬 어픽스 — index 0
      { id: 'sharp', stat: 'damagePct', value: 7 },
      { id: 'brutal', stat: 'damagePct', value: 15 },
      { id: 'rapid', stat: 'fireRatePct', value: 8 },
    ],
    source: SRC,
  };
}

/** 위와 어픽스 수만 같고(3개) 스킬 어픽스가 없는 대조군(rerollable = 3). */
function itemNoSkillAffix(id = 'test-noskill-1'): Item {
  return {
    id,
    slot: 'main',
    rarity: 'rare',
    affixes: [
      { id: 'sharp', stat: 'damagePct', value: 7 },
      { id: 'brutal', stat: 'damagePct', value: 15 },
      { id: 'rapid', stat: 'fireRatePct', value: 8 },
    ],
    source: SRC,
  };
}

/** 전부 스킬 어픽스라 rerollable = 0. 현행 규칙(스킬 어픽스 ≤ 1개)에서는 도달 불가 —
 *  손으로 빚은 방어 코드 경로 전용 테스트 픽스처다. */
function itemOnlySkillAffix(id = 'test-onlyskill-1'): Item {
  return {
    id,
    slot: 'main',
    rarity: 'rare',
    affixes: [{ id: 'of-honing', stat: 'skillLvOffense', value: 1 }],
    source: SRC,
  };
}

describe('정련 무한 함정(스킬 어픽스 분모) — 상태기계', () => {
  it('스킬 어픽스 1개 + 일반 3개: 일반 3개를 전부 고착하면 isComplete 가 참이 된다', () => {
    const item = itemWithSkillAffix();
    let s: ChainState = openChain(item);
    // 일반 어픽스(index 1,2,3)만 고착한다 — 실제 UI 에서도 스킬 어픽스(index 0) 행은
    // 고착 버튼이 비활성이라 이 경로만 탄다.
    for (const idx of [1, 2, 3]) {
      s = rollChain(s, 'mid', 1000 + idx, 1).next; // riskRoll=1 → 절대 용해하지 않는다
      s = fasten(s, idx);
    }
    expect(s.fastened).toEqual([1, 2, 3]);
    expect(rerollableCount(item)).toBe(3);
    // 고친 코드: rerollable(3) > 0 && fastened.length(3) >= rerollable(3) → 참.
    // 고치기 전 코드(분모 = affixes.length = 4)였다면 3 >= 4 가 거짓이라 영원히 완주가 안 선다.
    expect(isComplete(s)).toBe(true);
    expect(rollChain(s, 'mid', 2000, 1).complete).toBe(true);
  });

  it('[사전 확인] 옛 분모(affixes.length)로 계산하면 같은 상태가 완주로 안 잡힌다', () => {
    // 고친 함수를 재구현하지 않고, 옛 분모로 같은 조건을 직접 계산해 대조한다 — 이 단언이
    // 회귀를 못 잡는 것이 아니라 "고치기 전에는 실제로 걸렸다"는 것을 보인다.
    const item = itemWithSkillAffix();
    let s: ChainState = openChain(item);
    for (const idx of [1, 2, 3]) {
      s = rollChain(s, 'mid', 1000 + idx, 1).next;
      s = fasten(s, idx);
    }
    const oldCount = item.affixes.length; // 4 — 옛 분모
    expect(oldCount > 0 && s.fastened.length >= oldCount, '옛 분모로는 완주가 성립하면 안 된다').toBe(
      false,
    );
  });
});

describe('정련 무한 함정 — 위험도 분모', () => {
  it('같은 사용자 고착 수라면 스킬 어픽스 유무와 무관하게 위험이 같다(분자에 스킬 어픽스가 안 센다)', () => {
    const withSkill = itemWithSkillAffix();
    const without = itemNoSkillAffix();
    expect(rerollableCount(withSkill)).toBe(3);
    expect(rerollableCount(without)).toBe(3);
    for (const heat of HEATS) {
      for (let n = 0; n <= 3; n++) {
        const riskWith = meltRisk(n, rerollableCount(withSkill), heat);
        const riskWithout = meltRisk(n, rerollableCount(without), heat);
        expect(riskWith, `heat=${heat} n=${n}`).toBe(riskWithout);
        // 옛 분모(item.affixes.length = 4 vs 3)였다면 갈렸을 값 — 고침이 실제로 효과가
        // 있다는 것을 대조로 보인다. n=3·high 처럼 위험 상한(RISK_MAX)에 함께 눌리는
        // 구간은 두 분모가 우연히 같아지므로 제외한다(상한 포화는 분모 결함의 신호가 아니다).
        if (n > 0 && riskWith < RISK_MAX) {
          const oldRisk = meltRisk(n, withSkill.affixes.length, heat);
          expect(oldRisk, `heat=${heat} n=${n}: 옛 분모와 새 분모가 우연히 같았다`).not.toBe(riskWith);
        }
      }
    }
  });

  it('rollChain 이 실제로 쓰는 위험도도 같은 분모를 따른다(성공/용해 경계로 간접 확인)', () => {
    // rollChain 은 위험 수치를 반환하지 않으므로, 분모가 rerollableCount 인지는 riskRoll 을
    // 경계값 바로 아래/위로 주어 melted 여부로 확인한다.
    const item = itemWithSkillAffix();
    let s = rollChain(openChain(item), 'mid', 1, 1).next;
    s = fasten(s, 1); // 고착 1개 → rerollable=3 기준 위험
    const risk = meltRisk(s.fastened.length, rerollableCount(item), 'mid');
    expect(risk).toBeGreaterThan(0);
    const meltedBelow = rollChain(s, 'mid', 2, Math.max(0, risk - 1e-9));
    const survivedAbove = rollChain(s, 'mid', 2, Math.min(1, risk + 1e-9));
    expect(meltedBelow.melted, `분모가 rerollableCount 가 아니면 이 경계가 어긋난다`).toBe(true);
    expect(survivedAbove.melted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UI 층(`src/ui/pixi/refinery.ts`) — 표시 위험도가 판정과 같은 분모를 쓰는지, 그리고
// rerollable === 0 아이템이 목록에서 빠지는지. `pixiScreenPersistence.test.ts` 와 같은
// 최소 DOM/캔버스 스텁을 쓴다(Pixi Text.width 측정에 필요, 저장 배선은 이 파일의 관심사가
// 아니다).
// ---------------------------------------------------------------------------

function installCanvasStub(): void {
  const makeContext = (): unknown => ({
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    measureText: (text: string) => ({
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    setTransform: () => {},
    drawImage: () => {},
  });
  const makeCanvas = (width = 1, height = 1): unknown => {
    const ctx = makeContext();
    return { width, height, style: {}, getContext: () => ctx };
  };
  const base = DOMAdapter.get() as unknown as Record<string, unknown>;
  DOMAdapter.set({
    ...base,
    createCanvas: (w?: number, h?: number) => makeCanvas(w, h),
    getCanvasRenderingContext2D: () => class {},
    getWebGLRenderingContext: () => class {},
  } as never);
}

interface GlobalStubs {
  localStorage?: unknown;
  document?: unknown;
}
const g = globalThis as unknown as GlobalStubs;
let hadLocalStorage = false;
let hadDocument = false;
let hud: { style: { visibility: string } };

beforeEach(() => {
  hadLocalStorage = 'localStorage' in g;
  hadDocument = 'document' in g;
  hud = { style: { visibility: '' } };
  if (!hadDocument) {
    g.document = { getElementById: (id: string) => (id === 'pb-hud' ? hud : null) };
  }
  installCanvasStub();
});

afterEach(() => {
  if (!hadLocalStorage) delete g.localStorage;
  if (!hadDocument) delete g.document;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 정제소 화면의 private 표면(회귀 테스트가 실제 클릭 경로를 직접 찌른다) — 회귀
 *  `pixiScreenPersistence.test.ts` 의 `RefineryProbe` 와 같은 패턴이되, 이 파일이 필요로
 *  하는 `currentRisk`·`rerollable` 을 더 얹었다. */
interface RefineryProbe {
  select(i: Item): void;
  fasten(index: number): void;
  chain: ChainState | null;
  heat: Heat;
  currentRisk(): number;
  rerollable(): Item[];
}

function makeRefinery(profile: Profile): RefineryProbe {
  const stage = new Container();
  const screen = new RefineryScreen(profile, stage);
  screen.show(profile, () => {});
  return screen as unknown as RefineryProbe;
}

describe('정련 무한 함정 — UI 표시 위험도(currentRisk)', () => {
  it('표시 위험도가 판정 위험도와 같은 분모(rerollableCount)를 쓴다', () => {
    const profile = defaultProfile();
    const item = itemWithSkillAffix('ui-skill-1');
    profile.inventory.push(item);
    const probe = makeRefinery(profile);

    probe.select(item);
    probe.chain = rollChain(openChain(item), 'mid', 1, 1).next;
    probe.fasten(1); // 일반 어픽스 1개 고착 — 스킬 어픽스(index 0)는 버튼이 비활성이라 안 건드린다.
    expect(probe.chain?.fastened).toEqual([1]);

    const expected = meltRisk(1, rerollableCount(item), probe.heat);
    expect(probe.currentRisk()).toBe(expected);

    // 옛 분모(item.affixes.length = 4)였다면 이 값과 달랐을 것 — 고침이 화면까지 닿았음을 보인다.
    const naive = meltRisk(1, item.affixes.length, probe.heat);
    expect(probe.currentRisk()).not.toBe(naive);
  });
});

describe('정련 무한 함정 — rerollable === 0 은 목록에서 빠진다', () => {
  it('전부 스킬 어픽스인 아이템은 정련 목록에 없고, 일부만인 아이템은 남는다', () => {
    // ⚠️ 현행 규칙(스킬 어픽스 최대 1개 + rare·unique 어픽스 3~6)에서는 rerollable === 0 에
    // 도달할 수 없다 — 손으로 빚은 Item·향후 규칙 완화에 대비한 방어 코드 경로다.
    const profile = defaultProfile();
    const onlySkill = itemOnlySkillAffix('ui-onlyskill-1');
    const mixed = itemWithSkillAffix('ui-mixed-1');
    profile.inventory.push(onlySkill, mixed);
    const probe = makeRefinery(profile);

    const list = probe.rerollable();
    expect(list.some((i) => i.id === onlySkill.id), 'rerollable=0 아이템이 목록에 남아 있다').toBe(
      false,
    );
    expect(list.some((i) => i.id === mixed.id), 'rerollable>0 아이템이 목록에서 빠졌다').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 상태기계가 자기 불변식을 스스로 지키는가 (리드 통합 추가)
//
// 레인 2 가 정직하게 남긴 미결: 스킬 어픽스 행의 고착을 **UI 버튼 비활성으로만** 막고
// `fasten()` 자체는 그 인덱스를 받아 줬다. UI 가 유일한 방어면 하네스·테스트·향후 호출부가
// 그 뒤로 걸어 들어간다 — 그리고 들어가면 분자만 늘고 분모는 그대로라 위험도가 1 을 넘고
// 완주 판정이 조기에 선다(고친 분모가 정확히 그 자리를 얇게 만들었다).
// ---------------------------------------------------------------------------

describe('fasten — 스킬 어픽스 인덱스는 상태기계가 거부한다', () => {
  it('스킬 어픽스를 고착하려 하면 상태가 그대로다', () => {
    const item = itemWithSkillAffix();
    let s: ChainState = openChain(item);
    s = rollChain(s, HEATS[0] as Heat, 1234, RISK_MAX).next; // canFasten 을 연다
    expect(s.canFasten).toBe(true);
    const after = fasten(s, 0); // index 0 = of-honing
    expect(after).toBe(s); // 동일 참조 — 새 객체조차 안 만든다
    expect(after.fastened).toEqual([]);
  });

  it('같은 상태에서 일반 어픽스는 정상 고착된다 (거부가 과녁을 벗어나지 않았다)', () => {
    const item = itemWithSkillAffix();
    let s: ChainState = openChain(item);
    s = rollChain(s, HEATS[0] as Heat, 1234, RISK_MAX).next;
    const after = fasten(s, 1); // index 1 = sharp
    expect(after.fastened).toEqual([1]);
  });

  // ⚠️ 이 케이스는 **가드를 증명하지 않는다** — 여기까지 오면 공정이 이미 완주라 `canFasten`
  // 이 닫혀 있어 가드가 없어도 통과한다(뮤테이션 실측: 가드를 꺼도 이 건은 초록이었다).
  // 가드의 물증은 위 두 건이고, 이 건은 "완주 이후 경로에서도 분자가 안 넘친다"는 별개
  // 불변식이다. 둘을 한 문장으로 뭉뚱그리면 다음 사람이 방어가 두 겹인 줄 안다.
  it('완주 이후에도 분자가 분모를 넘지 않는다 (가드와 별개 경로)', () => {
    const item = itemWithSkillAffix();
    let s: ChainState = openChain(item);
    for (const idx of [1, 2, 3]) {
      s = rollChain(s, HEATS[0] as Heat, 1234, RISK_MAX).next;
      s = fasten(s, idx);
    }
    expect(s.fastened.length).toBe(rerollableCount(item));
    expect(isComplete(s)).toBe(true);
    // 여기서 스킬 어픽스까지 고착되면 분자 4 > 분모 3 이 된다 — 막혀 있어야 한다.
    s = rollChain(s, HEATS[0] as Heat, 1234, RISK_MAX).next;
    const overflow = fasten(s, 0);
    expect(overflow.fastened.length).toBe(rerollableCount(item));
  });
});
