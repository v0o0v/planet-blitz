/**
 * 침략 단계 조절 컨트롤 검증 (성계 지도 Pixi 판, ADR-0022).
 *
 * ## 이 파일이 막는 것
 * 개방 상한(`stageOpenCap` = max(10, 최고클리어+5))이 커지면서 `−`/`+` 한 칸 스텝퍼만으로는
 * 목표 단계까지 여러 번 눌러야 했다. 큰 걸음(±N)·최소/최대 점프를 더하면서 새로 생기는
 * 위험은 둘이다.
 *
 * | # | 결함 | 여기서의 방어 |
 * |---|---|---|
 * | 1 | 새 컨트롤이 클램프를 우회해 0 이나 상한+N 으로 나간다 | 전 컨트롤의 `target` 을 상한·경계 전수 검사 |
 * | 2 | **버튼은 그려지는데 배선이 없다**(이 프로젝트 8회 재발 유형) | 실제 화면을 띄우고 그려진 버튼 컨테이너에 `pointertap` 을 쏴서 `selectedStage` 와 다시 그려진 값 라벨을 본다 |
 *
 * 여백·색·감촉은 브라우저 확인 몫이고, 여기서는 **캔버스 없이도 틀렸다고 말할 수 있는 것**만
 * 고정한다(레이아웃은 "콘텐츠 상자를 넘지 않는가"라는 불변만).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Container, Text, DOMAdapter } from 'pixi.js';

import {
  PlanetSelectScreen,
  clampStageTo,
  stageBigStep,
  stageControlSpecs,
  stageRowWidth,
  STAGE_W,
  LOW_H,
  STAGE_ROW_Y,
  STAGE_ROW_H,
  STAGE_DESC_Y,
} from '../src/ui/pixi/planetSelect.js';
import { panelContent } from '../src/ui/pixi/nineSlicePanel.js';
import { stageOpenCap } from '../data/waves.js';
import { PLANETS } from '../data/planets.js';

/**
 * node 환경 스텁(`tests/pixiScreenPersistence.test.ts` 선례). 화면은 `#pb-hud` 를 만지고,
 * 캡션 축소가 `Text.width` 를 읽어 캔버스 텍스트 측정을 요구한다 — 폭 값의 정확도는 여기 관심사가
 * 아니므로 **측정만 되는** 최소 어댑터를 끼운다.
 */
beforeAll(() => {
  if (typeof globalThis.document === 'undefined') {
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  }
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
  const makeCanvas = (width = 1, height = 1): unknown => ({
    width,
    height,
    style: {},
    getContext: () => makeContext(),
  });
  const base = DOMAdapter.get() as unknown as Record<string, unknown>;
  DOMAdapter.set({
    ...base,
    createCanvas: (w?: number, h?: number) => makeCanvas(w, h),
    getCanvasRenderingContext2D: () => class {},
    getWebGLRenderingContext: () => class {},
  } as never);
});

describe('clampStageTo — 단계 이동의 유일한 관문', () => {
  it('[1, cap] 밖으로 절대 나가지 않는다', () => {
    for (const cap of [10, 11, 25, 100]) {
      for (const raw of [-999, -1, 0, 1, 2, cap - 1, cap, cap + 1, cap + 999]) {
        const v = clampStageTo(raw, cap);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('범위 안 값은 그대로 통과한다', () => {
    expect(clampStageTo(7, 10)).toBe(7);
    expect(clampStageTo(1, 10)).toBe(1);
    expect(clampStageTo(10, 10)).toBe(10);
  });

  it('상한이 1 미만이거나 값이 비정상이어도 1 이상을 돌려준다', () => {
    expect(clampStageTo(5, 0)).toBe(1);
    expect(clampStageTo(Number.NaN, 10)).toBe(1);
  });
});

describe('stageBigStep — 큰 걸음 폭', () => {
  it('초반 상한(10~50)에서는 5 로 고정된다', () => {
    for (const cap of [10, 15, 30, 50]) expect(stageBigStep(cap)).toBe(5);
  });

  it('상한이 커지면 함께 커진다(클릭 수가 선형으로 늘지 않게)', () => {
    expect(stageBigStep(100)).toBe(10);
    expect(stageBigStep(200)).toBe(20);
  });

  it('상한이 커져도 걸음이 줄지 않는다(단조)', () => {
    let prev = 0;
    for (let cap = 1; cap <= 300; cap++) {
      const step = stageBigStep(cap);
      expect(step).toBeGreaterThanOrEqual(prev);
      prev = step;
    }
  });
});

describe('stageControlSpecs — 컨트롤 사양', () => {
  it('한 칸 조절(−/+)이 반드시 남아 있다(정밀 조정용)', () => {
    const keys = stageControlSpecs(5, 10).map((s) => s.key);
    expect(keys).toContain('dec');
    expect(keys).toContain('inc');
    // 좌→우 순서: 점프 → 큰 걸음 → 한 칸 → 값 → 한 칸 → 큰 걸음 → 점프.
    expect(keys).toEqual(['min', 'bigDec', 'dec', 'value', 'inc', 'bigInc', 'max']);
  });

  it('모든 컨트롤의 목표 단계가 [1, cap] 안이다', () => {
    for (const cap of [10, 17, 100]) {
      for (let stage = 1; stage <= cap; stage++) {
        for (const spec of stageControlSpecs(stage, cap)) {
          expect(spec.target).toBeGreaterThanOrEqual(1);
          expect(spec.target).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('점프는 정확히 끝으로 간다', () => {
    const specs = stageControlSpecs(4, 17);
    expect(specs.find((s) => s.key === 'min')?.target).toBe(1);
    expect(specs.find((s) => s.key === 'max')?.target).toBe(17);
  });

  it('큰 걸음은 걸음 폭만큼 움직이고 경계에서는 잘린다', () => {
    const mid = stageControlSpecs(8, 20);
    expect(mid.find((s) => s.key === 'bigDec')?.target).toBe(3);
    expect(mid.find((s) => s.key === 'bigInc')?.target).toBe(13);
    const low = stageControlSpecs(2, 20);
    expect(low.find((s) => s.key === 'bigDec')?.target).toBe(1); // 2-5 → 1 로 클램프
    const high = stageControlSpecs(19, 20);
    expect(high.find((s) => s.key === 'bigInc')?.target).toBe(20);
  });

  it('걸음 폭이 라벨에 드러난다(새 i18n 문자열 없이 자기설명)', () => {
    const specs = stageControlSpecs(10, 20);
    expect(specs.find((s) => s.key === 'bigDec')?.label).toBe('−5');
    expect(specs.find((s) => s.key === 'bigInc')?.label).toBe('+5');
    expect(stageControlSpecs(10, 100).find((s) => s.key === 'bigInc')?.label).toBe('+10');
  });

  it('양끝에서는 그쪽 컨트롤이 전부 비활성이다', () => {
    const atMin = stageControlSpecs(1, 10);
    for (const key of ['min', 'bigDec', 'dec'] as const) {
      expect(atMin.find((s) => s.key === key)?.enabled).toBe(false);
    }
    for (const key of ['inc', 'bigInc', 'max'] as const) {
      expect(atMin.find((s) => s.key === key)?.enabled).toBe(true);
    }
    const atMax = stageControlSpecs(10, 10);
    for (const key of ['inc', 'bigInc', 'max'] as const) {
      expect(atMax.find((s) => s.key === key)?.enabled).toBe(false);
    }
  });

  it('현재 단계 칸은 표시 전용이다(비활성·현재 표식)', () => {
    const value = stageControlSpecs(6, 10).find((s) => s.key === 'value');
    expect(value?.label).toBe('6');
    expect(value?.enabled).toBe(false);
    expect(value?.current).toBe(true);
  });

  it('상한 밖 단계로 들어와도 사양은 상한 안에서 만들어진다(행성 전환 직후 방어)', () => {
    const specs = stageControlSpecs(999, 10);
    expect(specs.find((s) => s.key === 'value')?.label).toBe('10');
  });
});

describe('레이아웃 불변 — 콘텐츠 상자를 넘지 않는다', () => {
  const box = panelContent(STAGE_W, LOW_H);

  it('조절 행 폭이 콘텐츠 상자 폭 안에 들어간다(상한과 무관)', () => {
    for (const cap of [10, 100, 999]) {
      expect(stageRowWidth(stageControlSpecs(1, cap))).toBeLessThanOrEqual(box.w);
    }
  });

  it('제목·조절 행·캡션이 상자 세로 안에서 겹치지 않는다', () => {
    // 제목은 box.y 에서 시작하고 fontSize 26(≈34px) 이다 — 행은 그 아래여야 한다.
    expect(STAGE_ROW_Y).toBeGreaterThan(box.y + 34);
    expect(STAGE_ROW_Y + STAGE_ROW_H).toBeLessThanOrEqual(STAGE_DESC_Y);
    // 캡션(fontSize 19 ≈ 25px)까지 상자 바닥 안.
    expect(STAGE_DESC_Y + 25).toBeLessThanOrEqual(box.bottom);
  });
});

// ── 배선 검증: 실제로 그려진 버튼을 눌러 상태가 바뀌는가 ──────────────────────
//
// 이 프로젝트의 반복 결함은 "단위 테스트 그린인데 배선이 통째로 없다"이다. 그래서 순수 층만이
// 아니라 화면을 실제로 띄워, 그려진 버튼 컨테이너에 pointertap 을 emit 하고 선택 단계와 **다시
// 그려진 값 라벨**을 함께 본다(렌더 갱신까지 확인해야 배선이 끝난 것이다).

/** `pointertap` 페이로드 자리(핸들러는 인자를 쓰지 않는다 — 타입만 채운다). */
const TAP_EVENT = {} as never;

/**
 * 표시 트리에서 라벨 텍스트가 정확히 `label` 인 **클릭 가능한** 대상을 찾는다.
 *
 * "클릭 가능"의 정의는 `eventMode === 'static'` **이면서** `cursor === 'pointer'` 다 — 화면 루트도
 * static 이라(뒤로 이벤트가 새지 않게) 그것만으로는 무엇을 찾든 루트가 잡히고, 비활성 버튼은
 * `PixiButton.setEnabled(false)` 가 eventMode 를 none·cursor 를 default 로 되돌린다. 후위 순회로
 * 가장 안쪽 대상을 먼저 본다.
 */
function findButton(root: Container, label: string): Container | null {
  const walk = (node: Container): Container | null => {
    for (const child of node.children) {
      if (child instanceof Container) {
        const hit = walk(child);
        if (hit !== null) return hit;
      }
    }
    if (node.eventMode === 'static' && node.cursor === 'pointer' && labelsOf(node).includes(label)) {
      return node;
    }
    return null;
  };
  return walk(root);
}

/** 컨테이너 하위의 모든 Text 내용. */
function labelsOf(node: Container): string[] {
  const out: string[] = [];
  const walk = (n: Container): void => {
    if (n instanceof Text) out.push(n.text);
    for (const c of n.children) if (c instanceof Container) walk(c);
  };
  walk(node);
  return out;
}

/** 화면 전체의 Text 내용(값 라벨·캡션이 다시 그려졌는지 확인용). */
function allLabels(root: Container): string[] {
  return labelsOf(root);
}

function openScreen(bestCleared = 0): { stage: Container; screen: PlanetSelectScreen } {
  const stage = new Container();
  const screen = new PlanetSelectScreen(stage);
  screen.show({
    meta: '',
    bestStageCleared: () => bestCleared,
    onLaunch: () => {},
    onInventory: () => {},
  });
  return { stage, screen };
}

describe('배선 — 그려진 버튼이 실제로 선택 단계를 바꾼다', () => {
  it('최대 점프(≫) 한 번으로 개방 상한까지 간다', () => {
    const { stage, screen } = openScreen(0);
    const cap = stageOpenCap(0); // 10
    expect(screen.getSelectedStage()).toBe(1);

    const max = findButton(stage, '≫');
    expect(max).not.toBeNull();
    max?.emit('pointertap', TAP_EVENT);

    expect(screen.getSelectedStage()).toBe(cap);
    // 다시 그려졌는가 — 값 라벨과 캡션이 새 단계를 보여준다.
    const labels = allLabels(stage);
    expect(labels).toContain(String(cap));
    expect(labels.some((s) => s.includes(`단계 ${cap}`) || s.includes(`Stage ${cap}`))).toBe(true);
    screen.hide();
  });

  it('큰 걸음(+5)·한 칸(−)·최소 점프(≪)가 모두 배선돼 있다', () => {
    const { stage, screen } = openScreen(0);

    findButton(stage, '+5')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(6);

    findButton(stage, '−')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(5);

    findButton(stage, '+')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(6);

    findButton(stage, '−5')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(1);

    findButton(stage, '≫')?.emit('pointertap', TAP_EVENT);
    findButton(stage, '≪')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(1);
    screen.hide();
  });

  it('양끝에서는 더 나가지 않는다(비활성 버튼은 클릭이 먹지 않는다)', () => {
    const { stage, screen } = openScreen(0);
    const cap = stageOpenCap(0);

    // 하한: 1 에서 ≪/−5/− 는 비활성(eventMode none → 찾히지 않는다)이고, 눌려도 1 을 유지한다.
    for (const label of ['≪', '−5', '−']) {
      expect(findButton(stage, label)).toBeNull();
      findButton(stage, label)?.emit('pointertap', TAP_EVENT);
      expect(screen.getSelectedStage()).toBe(1);
    }
    // 반대쪽은 살아 있어야 한다(전부 비활성이면 위 단언이 무의미해진다).
    expect(findButton(stage, '≫')).not.toBeNull();

    findButton(stage, '≫')?.emit('pointertap', TAP_EVENT);
    // 상한: cap 에서 ≫/+5/+ 를 눌러도 cap.
    for (const label of ['≫', '+5', '+']) {
      expect(findButton(stage, label)).toBeNull();
      findButton(stage, label)?.emit('pointertap', TAP_EVENT);
      expect(screen.getSelectedStage()).toBe(cap);
    }
    expect(findButton(stage, '≪')).not.toBeNull();
    screen.hide();
  });

  it('행성을 바꾸면 상한이 낮은 행성 기준으로 재클램프된다', () => {
    const stage = new Container();
    const screen = new PlanetSelectScreen(stage);
    const other = PLANETS.find((p) => p.id !== 0);
    expect(other).toBeDefined();
    // 0번 행성만 클리어가 쌓여 상한이 넓고, 나머지는 바닥 상한(10).
    screen.show({
      meta: '',
      bestStageCleared: (planet: number) => (planet === 0 ? 40 : 0),
      onLaunch: () => {},
      onInventory: () => {},
    });
    expect(stageOpenCap(40)).toBe(45);

    findButton(stage, '≫')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(45);

    // 다른 행성 카드를 눌러 전환 → 상한 10 으로 재클램프돼야 한다.
    const card = findButton(stage, other?.name ?? '');
    expect(card).not.toBeNull();
    card?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(10);
    screen.hide();
  });

  it('선택 단계가 launch 계약(stage:)으로 그대로 나간다', () => {
    const stage = new Container();
    const screen = new PlanetSelectScreen(stage);
    let got: { planet: number; stage: number } | null = null;
    screen.show({
      meta: '',
      bestStageCleared: () => 0,
      onLaunch: (sel) => {
        got = { planet: sel.planet, stage: sel.stage };
      },
      onInventory: () => {},
    });
    findButton(stage, '+5')?.emit('pointertap', TAP_EVENT);
    expect(screen.getSelectedStage()).toBe(6);

    // 출격 버튼(라벨은 i18n '▶ {name} 출격') — 행성 이름을 포함한 버튼을 찾는다.
    const launchLabel = allLabels(stage).find((s) => s.includes(PLANETS[0]!.name) && s.includes('▶'));
    expect(launchLabel).toBeDefined();
    findButton(stage, launchLabel ?? '')?.emit('pointertap', TAP_EVENT);

    expect(got).not.toBeNull();
    expect(got!.stage).toBe(6);
  });
});
