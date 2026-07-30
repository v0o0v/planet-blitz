/**
 * 플레이어 비주얼 **항목별 스위치** 검증.
 *
 * 사용자 판정(2026-07-30): 기체 AAA 비주얼 레인(PR#205)의 결과가 마음에 들지 않으니 "뒷부분
 * 불꽃만 남기고 나머지는 원래대로". 다만 항목을 하나씩 켜고 끄며 눈으로 비교한 뒤 살릴 것을
 * 고르기로 해서, 지우는 대신 스위치를 두고 기본값을 되돌린 상태로 잡았다.
 *
 * 여기서 잠그는 것은 둘이다.
 *  1. **기본값이 실제로 "불꽃만"인가** — 이 파일이 곧 "무엇이 살아 있는가"의 계약이다.
 *  2. **스위치가 표시 객체를 실제로 만들고 없애는가** — 체크박스만 있고 화면이 안 바뀌면
 *     비교 도구로서 아무 값어치가 없다. 이 리포가 반복해서 밟은 "코드엔 있는데 화면엔 없다"
 *     계열 결함이라 구조로 막는다.
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 돈다(playerVisual.test.ts 선례).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';

import {
  ALL_ON_PLAYER_VISUAL_FLAGS,
  DEFAULT_PLAYER_VISUAL_FLAGS,
  playerVisualFlags,
  resetPlayerVisualFlags,
  setPlayerVisualFlags,
  type PlayerVisualFlags,
} from '../src/render/entity/playerVisualFlags.js';
import { playerAdorners } from '../src/render/entity/playerVisual.js';
import { effectGates } from '../src/render/qualityTier.js';
import type { AdornerContext } from '../src/render/entity/adorner.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';
import type { GraphicsSettings } from '../src/render/graphicsSettings.js';
import type { EnvTheme } from '../src/render/env/theme.js';

afterEach(() => {
  resetPlayerVisualFlags();
});

describe('기본값 — 사용자가 항목별 비교로 확정한 조합', () => {
  beforeEach(() => {
    resetPlayerVisualFlags();
  });

  /**
   * 끈 항목은 **정확히 셋**이다. 목록을 통째로 단언하는 이유: 새 항목이 추가될 때 기본값을
   * 정하지 않고 지나가면 여기가 빨개진다(조용히 켜지거나 꺼지는 것을 막는다).
   */
  it('뱅킹/롤과 헤일로 2종만 꺼져 있다', () => {
    const off = Object.entries(DEFAULT_PLAYER_VISUAL_FLAGS)
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .sort();
    expect(off).toEqual(['banking', 'halo', 'haloAniso']);
  });

  it('불꽃은 켜져 있다 — 첫 판정부터 끝까지 남기기로 한 항목', () => {
    expect(DEFAULT_PLAYER_VISUAL_FLAGS.flame).toBe(true);
  });

  it('전부 켠 프리셋은 모든 항목이 true 이고 기본값과 키가 같다', () => {
    expect(Object.keys(ALL_ON_PLAYER_VISUAL_FLAGS).sort()).toEqual(
      Object.keys(DEFAULT_PLAYER_VISUAL_FLAGS).sort(),
    );
    expect(Object.values(ALL_ON_PLAYER_VISUAL_FLAGS).every((v) => v)).toBe(true);
  });
});

describe('스위치 조작', () => {
  it('일부만 갈아 끼우고 나머지는 보존한다', () => {
    resetPlayerVisualFlags();
    setPlayerVisualFlags({ banking: true });
    expect(playerVisualFlags().banking).toBe(true);
    // 손대지 않은 항목은 기본값 그대로 — 켠 것도 끈 것도 양쪽 다 확인한다.
    expect(playerVisualFlags().flame).toBe(true);
    expect(playerVisualFlags().halo).toBe(false);
  });

  it('reset 이 기본값으로 되돌린다', () => {
    setPlayerVisualFlags(ALL_ON_PLAYER_VISUAL_FLAGS);
    resetPlayerVisualFlags();
    expect({ ...playerVisualFlags() }).toEqual(DEFAULT_PLAYER_VISUAL_FLAGS);
  });
});

// ---------------------------------------------------------------------------
// 배선 — 스위치가 표시 객체를 실제로 만들고 없애는가
// ---------------------------------------------------------------------------

function settings(): GraphicsSettings {
  return {
    quality: 'auto',
    reducedMotion: false,
    reducedGlow: false,
    damageNumbers: true,
  } as unknown as GraphicsSettings;
}

/** 광원이 있는 최소 테마 — 림라이트는 테마가 없으면 스스로 꺼지므로 필요하다. */
const THEME = {
  id: 'test',
  name: 'test',
  planets: [0],
  light: { angle: 0, shadowBias: 0.5 },
} as unknown as EnvTheme;

interface Rig {
  below: Container;
  above: Container;
  /** `frames` 프레임 돌린다. 일부 항목은 첫 프레임에 만들어지지 않는다(상태 기계). */
  run(frames: number, hp?: number): void;
}

function rig(): Rig {
  const below = new Container();
  // 컨투어는 belowLayer 의 **부모**에 붙는다(블룸 필터 회피) — 부모를 만들어 준다.
  const root = new Container();
  root.addChild(below);
  const above = new Container();
  const ctx: AdornerContext = {
    belowLayer: below,
    aboveLayer: above,
    frameTick: 0,
    dt: 1 / 60,
    gates: effectGates('high', settings()),
    tier: 'high',
    theme: THEME,
    alpha: 1,
  };
  const sprite = new Sprite(Texture.WHITE);
  sprite.anchor.set(0.5);
  sprite.setSize(96, 96);
  const snap = (hp: number): EntitySnapshot =>
    ({ id: 1, kind: 'player', x: 0, y: 0, hp, maxHp: 100, radius: 24 }) as unknown as EntitySnapshot;

  const adorners = playerAdorners();
  for (const a of adorners) a.onAttach?.(sprite, snap(100), ctx);
  const mutable = ctx as { frameTick: number };
  return {
    below: root,
    above,
    run(frames: number, hp = 100): void {
      for (let f = 0; f < frames; f++) {
        mutable.frameTick++;
        for (const a of adorners) a.onFrame(sprite, snap(hp), snap(hp), ctx);
      }
    },
  };
}

/** 트리 전체(부모 포함)에서 라벨을 센다 — 항목마다 붙는 레이어가 다르다. */
function count(roots: readonly Container[], label: string): number {
  let n = 0;
  const walk = (c: Container): void => {
    if (c.label === label) n++;
    for (const ch of c.children) if (ch instanceof Container) walk(ch);
  };
  for (const r of roots) walk(r);
  return n;
}

/** 항목 → 그 항목이 켜졌을 때만 존재해야 하는 표시객체 라벨. */
const WIRED: readonly { key: keyof PlayerVisualFlags; label: string; hp: number }[] = [
  { key: 'flame', label: 'playerThrust', hp: 100 },
  { key: 'contour', label: 'playerContour', hp: 100 },
  { key: 'rim', label: 'playerRim', hp: 100 },
  { key: 'surface', label: 'playerSurface', hp: 100 },
  // 손상 그을림은 HP 가 임계 아래일 때만 만들어진다.
  { key: 'damageScorch', label: 'playerDamage', hp: 10 },
];

describe('스위치 ↔ 표시객체 배선', () => {
  for (const { key, label, hp } of WIRED) {
    it(`${key} 를 켜면 ${label} 이 생기고, 끄면 사라진다`, () => {
      resetPlayerVisualFlags();
      setPlayerVisualFlags({ [key]: false } as Partial<PlayerVisualFlags>);
      const r = rig();
      r.run(3, hp);
      expect(count([r.below, r.above], label)).toBe(0);

      setPlayerVisualFlags({ [key]: true } as Partial<PlayerVisualFlags>);
      r.run(3, hp);
      expect(count([r.below, r.above], label)).toBe(1);

      // 되돌리면 실제로 회수된다 — 껐는데 남아 있으면 비교가 오염된다.
      setPlayerVisualFlags({ [key]: false } as Partial<PlayerVisualFlags>);
      r.run(3, hp);
      expect(count([r.below, r.above], label)).toBe(0);
    });
  }

  it('기본값에서 확정 조합의 표시객체가 실제로 붙는다', () => {
    resetPlayerVisualFlags();
    const r = rig();
    r.run(5, 10); // HP 를 낮춰 손상 그을림까지 나오게 한다.
    for (const label of [
      'playerThrust',
      'playerContour',
      'playerRim',
      'playerSurface',
      'playerDamage',
    ]) {
      expect(count([r.below, r.above], label)).toBe(1);
    }
  });
});
