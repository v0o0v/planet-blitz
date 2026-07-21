/**
 * 격납고 휠 스크롤 회귀 테스트 (레인 C · C-2).
 *
 * ## 왜 이 파일이 따로 있어야 하나
 * 격납고 3패널(스탯 · 창고 · 인벤토리)은 전부 **마스크로 쓰이는 Graphics 에 `wheel` 리스너를
 * 걸고 있었다.** Pixi 는 마스크로 지정된 표시 객체를 히트 테스트에서 통째로 제외하므로
 * (`isMask`), 리스너는 등록만 되고 영영 불리지 않는다 — 휠이 완전히 죽어 있었는데도 코드는
 * 정상으로 보이고, "리스너가 있는지" 만 확인하는 테스트는 그대로 통과한다.
 *
 * 그래서 여기서는 **누구에게 걸렸는지**를 본다:
 *   ① 리스너를 받은 객체가 `mask` 로 쓰이고 있지 않을 것,
 *   ② 그 객체가 `eventMode` + `hitArea` 를 갖출 것(= 히트 테스트 대상),
 *   ③ 휠 이벤트를 실제로 흘렸을 때 스크롤 오프셋과 내용 y 가 움직이고 [0, max] 로 클램프될 것.
 *
 * ①②③ 을 동시에 요구해야 "마스크에 걸기" 로 되돌아가는 회귀가 잡힌다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, Graphics, Rectangle } from 'pixi.js';

import { attachWheelScroll } from '../src/ui/pixi/hangar.js';

// ---------------------------------------------------------------------------

interface Wheelish {
  deltaY: number;
}

/** 실제 리스너를 부른다(Pixi 이벤트 시스템 없이 EventEmitter 만 쓴다). */
function wheel(target: Container, deltaY: number): void {
  (target as unknown as { emit(ev: string, e: Wheelish): void }).emit('wheel', { deltaY });
}

let clip: Container;
let content: Container;
let mask: Graphics;
let scrollY: number;

beforeEach(() => {
  clip = new Container();
  content = new Container();
  clip.addChild(content);
  mask = new Graphics();
  mask.rect(0, 0, 400, 200).fill({ color: 0xffffff });
  clip.mask = mask;
  scrollY = 0;
});

afterEach(() => {
  clip.destroy({ children: true });
  mask.destroy();
});

function attach(maxScroll: number): boolean {
  return attachWheelScroll(
    clip,
    400,
    200,
    maxScroll,
    () => scrollY,
    (v) => {
      scrollY = v;
      content.y = -v;
    },
  );
}

describe('격납고 휠 스크롤 — 마스크가 아니라 클립이 받는다 (C-2)', () => {
  it('리스너는 마스크가 아닌 대상에 걸린다', () => {
    attach(600);
    expect(clip.listenerCount('wheel')).toBe(1);
    // 마스크로 쓰이는 Graphics 에는 절대 걸리면 안 된다(걸어 봐야 안 불린다).
    expect(mask.listenerCount('wheel')).toBe(0);
    expect(clip.mask).not.toBe(clip);
  });

  it('리스너 대상은 히트 테스트가 가능하다(eventMode + hitArea)', () => {
    attach(600);
    expect(clip.eventMode).toBe('static');
    expect(clip.hitArea).toBeInstanceOf(Rectangle);
    const area = clip.hitArea as Rectangle;
    expect(area.width).toBe(400);
    expect(area.height).toBe(200);
    // hitArea 없이 자식(셀)만 있으면 셀 사이 빈 자리에서 휠이 죽는다 — 폭·높이가 창 전체여야 한다.
    expect(area.contains(399, 199)).toBe(true);
  });

  it('휠 이벤트가 실제로 오프셋과 내용 y 를 움직인다', () => {
    attach(600);
    wheel(clip, 300);
    expect(scrollY).toBe(300);
    expect(content.y).toBe(-300);
    wheel(clip, 300);
    expect(scrollY).toBe(600);
    expect(content.y).toBe(-600);
  });

  it('오프셋은 [0, maxScroll] 로 클램프된다', () => {
    attach(600);
    wheel(clip, 10_000);
    expect(scrollY).toBe(600);
    wheel(clip, -10_000);
    expect(scrollY).toBe(0);
    expect(content.y).toBe(-0);
  });

  it('내용이 창보다 작으면(maxScroll 0) 리스너도 hitArea 도 만들지 않는다', () => {
    expect(attach(0)).toBe(false);
    expect(clip.listenerCount('wheel')).toBe(0);
    expect(clip.hitArea ?? null).toBeNull();
  });
});

describe('격납고 3패널이 전부 클립에 휠을 건다 — 소스 계약 (C-2)', () => {
  // 위 단위 테스트는 헬퍼만 본다. 격납고가 그 헬퍼를 **실제로 쓰는지**(= 마스크에 직접 거는
  // 옛 코드가 남아 있지 않은지)는 소스에서 직접 확인한다 — M7a·M7b 에서 8건 나온
  // "단위 테스트는 그린인데 배선이 없다" 유형을 막는 유일한 방법이다.
  const SRC = 'src/ui/pixi/hangar.ts';

  it('mask 에 wheel 리스너를 거는 코드가 남아 있지 않다', () => {
    const text = new TextDecoder().decode(readFileSync(SRC));
    expect(text).not.toMatch(/mask\.on\(\s*['"]wheel['"]/);
    expect(text).not.toMatch(/mask\.eventMode/);
  });

  it('스크롤 패널 3곳이 모두 attachWheelScroll 을 탄다', () => {
    const text = new TextDecoder().decode(readFileSync(SRC));
    // 정의 1 + 호출 3 (스탯 · 창고 · 인벤토리).
    const uses = text.match(/attachWheelScroll\(/g) ?? [];
    expect(uses.length).toBe(4);
  });
});
