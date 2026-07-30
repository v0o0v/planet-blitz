/**
 * 플레이어 비행체 AAA 비주얼(`src/render/entity/playerVisual.ts`) — 레인 A 계약 검증.
 *
 * ## 이 테스트가 지키는 것
 * 계약(`.omc/plans/entity-aaa-contract.md`)이 **판정 가능하다고 못박은 것들**만 잡는다:
 *
 * 1. **가독성 계약(§2-2)** — 무적 표현이 스프라이트 알파를 건드리지 않는다(깜빡임 금지),
 *    모든 발광이 belowLayer 에 있고 실드 셸만 aboveLayer 이며 그것도 획뿐이다,
 *    잔상·불꽃이 본체보다 어둡다.
 * 2. **티어·접근성 게이트(§2-3)** — low 티어·`reducedMotion`·`reducedGlow` 에서 무엇이 꺼지는가.
 * 3. **형제 회수(§2-3)** — `dispose` 뒤 레이어에 남는 자식이 0 이고, 두 번 불려도 안전하다.
 * 4. **sim 불가침(§2-1)** — 속도·대시·피격이 전부 스냅샷 델타 파생이다.
 * 5. **2차 운동(§3 공통원칙)** — 롤이 1차 지연이 아니라 **오버슈트하는** 스프링이다.
 *
 * ## 왜 순수 함수와 장식자를 둘 다 태우는가
 * 순수 함수만 보면 "값은 맞는데 화면에 안 붙는" 결함(이 리포 8건)을 놓친다. 그래서 실제
 * `Sprite` 와 `Container` 를 만들어 `onAttach`/`onFrame`/`dispose` 를 태우고 **레이어의 자식
 * 수**를 센다.
 */

import { describe, it, expect } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';

import {
  playerAdorners,
  reducedMotion,
  reducedGlow,
  snapshotVelocity,
  lateralSpeed,
  bankTarget,
  springStep,
  thrustExtent,
  idleness,
  shieldShell,
  shieldInnermostRadius,
  shieldGate,
  ghostBudget,
  rimOffset,
  hitImpulseDir,
  partLight,
  sumLight,
  luminance,
  saturation255,
  fitsUnderBody,
  contourFactor,
  contourDelta,
  multiplyFactor,
  contourInsertIndex,
  dashHeatStep,
  dashRing,
  damageIntensity,
  isCriticalHp,
  damageAlpha,
  playerHaloAniso,
  spriteAddLight,
  addLayers,
  damageFactor,
  damageDelta,
  damageWarmShift,
  surfaceLight,
  surfaceStripCenter,
  surfaceStripAlpha,
  surfaceShadeDelta,
  surfaceLateralHalf,
  surfaceStripBand,
  surfaceStripInsidePx,
  surfaceRampOuterEdgePx,
  SURFACE_STRIP_COUNT,
  PLAYER_SPRITE_DISPLAY,
  PLAYER_OPAQUE_LATERAL_HALF,
  flameGate,
  PLAYER_TEX_MEAN,
  isDashSpeed,
  HEAVY_STACKS,
  BODY_LUMA_P99,
  BODY_LUMA_P99_CLEAN,
  BODY_LUMA_P99_DENSE,
  PLAYER_DASH_TRAUMA,
  type PlayerLightPart,
} from '../src/render/entity/playerVisual.js';
import { TRAUMA_PLAYER_HIT } from '../src/render/screenShake.js';
import { effectGates, type EffectGates, type QualityTier } from '../src/render/qualityTier.js';
import type { GraphicsSettings } from '../src/render/graphicsSettings.js';
import type { AdornerContext } from '../src/render/entity/adorner.js';
import type { EnvTheme } from '../src/render/env/theme.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

function settings(over: Partial<GraphicsSettings> = {}): GraphicsSettings {
  return {
    quality: 'auto',
    reducedMotion: false,
    reducedGlow: false,
    damageNumbers: true,
    ...over,
  } as GraphicsSettings;
}

function gatesFor(tier: QualityTier, over: Partial<GraphicsSettings> = {}): EffectGates {
  return effectGates(tier, settings(over));
}

/** 광원이 정확히 오른쪽(+x)인 최소 테마 — 림 오프셋 부호 검증용. */
const THEME_RIGHT = {
  id: 'test',
  name: 'test',
  planets: [0],
  light: { angle: 0, shadowBias: 0.5 },
} as unknown as EnvTheme;

interface Harness {
  ctx: AdornerContext;
  below: Container;
  above: Container;
  advance(over?: Partial<AdornerContext>): void;
}

function harness(over: Partial<AdornerContext> = {}): Harness {
  const below = new Container();
  const above = new Container();
  const ctx: AdornerContext = {
    belowLayer: below,
    aboveLayer: above,
    frameTick: 0,
    dt: 1 / 60,
    gates: gatesFor('high'),
    tier: 'high',
    theme: THEME_RIGHT,
    alpha: 1,
    ...over,
  };
  const mutable = ctx as { frameTick: number };
  return {
    ctx,
    below,
    above,
    advance(patch: Partial<AdornerContext> = {}): void {
      mutable.frameTick++;
      Object.assign(ctx, patch);
    },
  };
}

/**
 * 레이어에서 라벨로 장식물을 찾는다. **자식 수 절대값으로 재지 않는 이유**: 항목이 늘 때마다
 * 무관한 단언이 깨지고(공유 테스트 결합), 무엇보다 "무엇이 붙었는지"를 못 말해 준다. 라벨은
 * 프로덕션 코드에도 실제로 붙어 있어 하네스에서 비평가가 같은 이름으로 조회할 수 있다.
 */
function labeled(layer: Container, label: string): Container[] {
  return layer.children.filter((c): c is Container => c instanceof Container && c.label === label);
}

/**
 * 이 레인의 **가산** 기여 전량. 항목이 늘면 여기 한 줄만 더하면 밝기 단언이 자동으로 따라온다 —
 * 목록을 테스트마다 따로 쓰면 새 이펙트가 조용히 예산 밖에 남는다(실제로 그럴 뻔했다).
 *
 * 감산 부품(컨투어 ⓪ · 손상 그을림 ⑦ · 판면 그늘 ⑩)은 여기 **없다** — 가산 기여가 0 이고,
 * 각자 `contourDelta`·`damageDelta`·`surfaceShadeDelta` 로 감산 쪽 게이트를 따로 진다.
 */
const PARTS: readonly PlayerLightPart[] = [
  'flame',
  'rim',
  'ghost',
  'dashCore',
  'dashRing',
  'specular',
];

function ent(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 1,
    kind: 'player',
    x: 0,
    y: 0,
    angle: 0,
    radius: 16,
    aabbH: 0,
    enemyType: -1,
    hp: 100,
    maxHp: 100,
    active: false,
    flash: false,
    elite: -1,
    ...over,
  };
}

/** 렌더러가 하는 일(생성 + setSize)을 그대로 재현한 플레이어 스프라이트. */
function playerSprite(): Sprite {
  const s = new Sprite(new Texture({ source: Texture.EMPTY.source, label: 'player' }));
  s.anchor.set(0.5);
  s.setSize(48, 48);
  return s;
}

/**
 * 렌더러 엔티티 루프가 `onFrame` **앞에서** 하는 일: 보간 위치·기수 회전을 스프라이트에 확정.
 * 장식자가 이 위에 얹는다는 계약을 테스트에서도 똑같이 지킨다(안 지키면 누적 검증이 거짓이 된다).
 */
function placeSprite(s: Sprite, e: EntitySnapshot, facing: number): void {
  s.position.set(e.x, e.y);
  s.rotation = facing;
}

/** 장식자 한 묶음을 n 프레임 태운다. `move` 는 프레임마다의 위치 델타(u/tick). */
function run(
  h: Harness,
  adorners: ReturnType<typeof playerAdorners>,
  frames: number,
  opts: { sprite: Sprite; move?: { dx: number; dy: number }; facing?: number; hpAt?: Map<number, number> },
): { sprite: Sprite; last: EntitySnapshot } {
  const s = opts.sprite;
  const move = opts.move ?? { dx: 0, dy: 0 };
  const facing = opts.facing ?? 0;
  let prev = ent();
  let curr = ent();
  for (const a of adorners) a.onAttach?.(s, curr, h.ctx);
  for (let i = 0; i < frames; i++) {
    prev = curr;
    const hp = opts.hpAt?.get(i);
    curr = ent({
      x: prev.x + move.dx,
      y: prev.y + move.dy,
      hp: hp ?? prev.hp,
    });
    placeSprite(s, curr, facing);
    for (const a of adorners) a.onFrame(s, curr, prev, h.ctx);
    h.advance();
  }
  return { sprite: s, last: curr };
}

// ---------------------------------------------------------------------------
// 순수 함수 — sim 불가침 파생(§2-1)
// ---------------------------------------------------------------------------

describe('순수 파생 — sim 에 필드를 더하지 않고 스냅샷 델타로만 구한다(§2-1)', () => {
  it('스냅샷 위치 델타가 초당 속도로 환산된다(60Hz)', () => {
    const v = snapshotVelocity(ent({ x: 12, y: 0 }), ent({ x: 0, y: 0 }));
    expect(v.vx).toBeCloseTo(720, 6); // 12 u/tick = sim 기본 playerSpeed
    expect(v.vy).toBeCloseTo(0, 6);
  });

  it('리스폰·순간이동의 거대 점프는 상한으로 잘려 불꽃·잔상이 폭주하지 않는다', () => {
    const v = snapshotVelocity(ent({ x: 100000 }), ent({ x: 0 }));
    expect(Math.hypot(v.vx, v.vy)).toBeLessThanOrEqual(4000 + 1e-6);
  });

  it('sim-step 없는 프레임(prev===curr 반복)에서도 속도가 0 으로 떨어지지 않는다', () => {
    // 같은 prev/curr 쌍을 두 번 넣어도 같은 값 — 프레임마다 불꽃이 꺼졌다 켜지지 않는다는 근거.
    const a = snapshotVelocity(ent({ x: 12 }), ent({ x: 0 }));
    const b = snapshotVelocity(ent({ x: 12 }), ent({ x: 0 }));
    expect(b).toEqual(a);
    expect(a.vx).toBeGreaterThan(0);
  });

  it('횡 속도는 기수 기준이다 — 정면 이동은 0, 우현 이동은 양수', () => {
    expect(lateralSpeed(720, 0, 0)).toBeCloseTo(0, 6); // +x 로 가며 +x 를 봄 = 순전진
    expect(lateralSpeed(0, 720, 0)).toBeCloseTo(720, 6); // +y(아래=우현) 로 미끄러짐
    expect(lateralSpeed(0, 720, Math.PI)).toBeCloseTo(-720, 6); // 기수가 뒤집히면 부호도 뒤집힌다
  });

  it('롤 목표는 [-1,1] 로 포화한다', () => {
    expect(bankTarget(1e6)).toBe(1);
    expect(bankTarget(-1e6)).toBe(-1);
    expect(bankTarget(0)).toBe(0);
  });
});

describe('2차 운동 — 감쇠 스프링이 오버슈트한다(§3 공통원칙)', () => {
  it('저감쇠 스프링은 목표를 지나쳤다가 되돌아온다(1차 지연이 아니다)', () => {
    let v = 0;
    let vel = 0;
    let maxV = 0;
    for (let i = 0; i < 240; i++) {
      const s = springStep(v, vel, 1, 120, 16, 1 / 60);
      v = s.value;
      vel = s.vel;
      if (v > maxV) maxV = v;
    }
    expect(maxV).toBeGreaterThan(1); // 오버슈트 = 2차 운동의 물증
    expect(v).toBeCloseTo(1, 1); // 결국 수렴
  });

  it('큰 dt(탭 복귀)에서도 발산하지 않는다', () => {
    let v = 0;
    let vel = 0;
    for (let i = 0; i < 200; i++) {
      const s = springStep(v, vel, 1, 300, 22, 5); // 5초짜리 dt — 내부에서 잘려야 한다
      v = s.value;
      vel = s.vel;
    }
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThan(10);
  });
});

describe('엔진 추진 — 속도 반응(§3 레인 A ②)', () => {
  it('정지 아이들 코어 < 순항 < 대시 폭발 순으로 단조 증가한다', () => {
    const idle = thrustExtent(0, false);
    const cruise = thrustExtent(900, false);
    const dash = thrustExtent(2800, true);
    expect(idle).toBeGreaterThan(0); // 정지에도 코어가 남는다 = 시동 걸린 기체
    expect(cruise).toBeGreaterThan(idle);
    expect(dash).toBeGreaterThan(cruise * 1.5); // "폭발적" 확장
  });

  it('부유 강도는 정지에서 최대·이동에서 0 이다', () => {
    expect(idleness(0)).toBe(1);
    expect(idleness(1000)).toBe(0);
    expect(idleness(60)).toBeGreaterThan(0);
    expect(idleness(60)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// 가산 합성 결과 — 비평가 CRIT-1·CRIT-2 의 합격 기준을 그대로 옮긴 것
// ---------------------------------------------------------------------------

describe('가산 합성 결과 (CRIT-1·CRIT-2) — 상수가 아니라 **화면에 얹히는 값**을 잠근다', () => {
  // ⚠️ 이 describe 가 존재하는 이유가 이 레인의 가장 비싼 교훈이다. 1차 구현의 불꽃 심 상수는
  // `0xbfefff` 로 "순백이 아니다"라는 주석 그대로였는데, 3층 × 3노즐 가산이 겹치면서 **화면에서는
  // 순백(255,251,250)** 이 됐다. 같은 컷의 적탄 흰 코어가 (251,242,241) 이라 RGB 4~5 차이였다.
  // 색 상수를 단언하는 테스트는 이 결함을 영영 못 잡는다 — 합성 결과에 걸어야 잡힌다.

  it('불꽃 합성 채도가 60 이상이다 — 적탄 흰 코어(실측 채도 9)와 확실히 갈린다', () => {
    expect(saturation255(partLight('flame'))).toBeGreaterThanOrEqual(60);
  });

  it('불꽃 합성의 R 기여가 G·B 보다 현저히 낮다(가산에서 채도를 죽이는 것은 R 이다)', () => {
    const f = partLight('flame');
    expect(f.r).toBeLessThan(f.g * 0.35);
    expect(f.r).toBeLessThan(f.b * 0.35);
  });

  it('모든 개별 기여가 **관측된 가장 엄한** 본체 p99(clean 149.8)보다 어둡다', () => {
    // ⚠️ 여기서 BODY_LUMA_P95(148.7)가 아니라 통합 빌드 실측(149.8)을 쓰는 이유가 3차 경고다.
    // 148.7 은 "변경 전 컷"의 값이고 장면이 바뀌면 따라가지 못한다 — 자기가 박은 값으로 자기를
    // 증명하게 된다. 통합 빌드 clean 컷 실측이 관측된 것 중 가장 엄하므로 그쪽을 쓴다.
    for (const part of PARTS) {
      expect(fitsUnderBody(partLight(part), BODY_LUMA_P99_CLEAN)).toBe(true);
    }
  });

  it('실제로 겹칠 수 있는 조합을 다 더해도 본체 상위 1%를 넘지 않는다 (CRIT-2 합격 기준)', () => {
    // 임의 조합 전수가 아니라 **기하로 가능한 것만**(HEAVY_STACKS 주석이 정본). 1차는 235.1 이었다.
    for (const stack of HEAVY_STACKS) {
      const sum = sumLight(...stack.map((p) => partLight(p)));
      expect(luminance(sum)).toBeLessThan(BODY_LUMA_P99);
    }
  });

  it('상수 211.6 이 판정 장면(dense) 실측보다 보수적이다 — 느슨해지는 쪽으로 틀릴 수 없다', () => {
    // 자기증명 제거의 핵심: 단언 기준이 실제 장면보다 **엄한** 쪽임을 코드가 증명한다.
    expect(BODY_LUMA_P99).toBeLessThan(BODY_LUMA_P99_DENSE);
    expect(BODY_LUMA_P99_CLEAN).toBeLessThan(BODY_LUMA_P99);
  });

  it('fitsUnderBody 는 **넘겨받은 실측치**로 판정한다(고정 상수 미사용)', () => {
    // 같은 기여라도 기준 프레임이 어두우면 탈락해야 한다 — 그래야 장면 변화를 잡는다.
    const flame = partLight('flame');
    expect(fitsUnderBody(flame, 300)).toBe(true);
    expect(fitsUnderBody(flame, 10)).toBe(false);
  });

  it('**스프라이트** 기여는 텍스처 인자를 곱한 모델로 잰다 (4차 CRIT-1 의 근본 수정)', () => {
    // rim·ghost 는 텍스처 복제라 `texture × tint × alpha` 다. 모델이 그걸 반영해야 화면과 일치한다.
    for (const part of ['rim', 'ghost'] as const) {
      const naive = part === 'rim' ? addLayers([{ color: 0xcfe6ff, alpha: 0.2 }]) : null;
      if (naive !== null) expect(luminance(partLight(part))).toBeLessThan(luminance(naive));
      // 청록 텍스처라 어느 tint 를 써도 **G·B 가 R 보다 크게** 남는다 — "차가운 화이트 림"은
      // 이 기법으로 만들 수 없다(그래서 판면 하이라이트는 Graphics 다).
      const l = partLight(part);
      expect(l.g).toBeGreaterThan(l.r);
      expect(l.b).toBeGreaterThan(l.r);
    }
    // 반면 Graphics 기여(불꽃·심·링·판면)는 텍스처 인자가 없다 — 두 모델을 섞으면 CRIT-1 이다.
    expect(partLight('specular')).toEqual(addLayers([{ color: 0xdfeeff, alpha: 0.3 }]));
  });

  it('판면 하이라이트는 Graphics 라 **차가운 화이트**를 낼 수 있다(rim 이 못 하는 일)', () => {
    const spec = partLight('specular');
    expect(saturation255(spec)).toBeLessThan(60); // 무채에 가깝다 = 표면 반사
    // 그런데도 개별 기여 상한 안이다(스트립끼리는 겹치지 않으므로 이 값이 최댓값이다).
    expect(fitsUnderBody(spec, BODY_LUMA_P99_CLEAN)).toBe(true);
  });

  it('대시 심을 얹어도 불꽃 합성 채도가 60 이상이다 — 백열로 가지 않는다(§요구 ②)', () => {
    // 2차에 확립한 분리(불꽃 195.9 vs 적탄 흰 코어 10.0)를 대시 중에도 지킨다는 단언.
    const hot = sumLight(partLight('flame'), partLight('dashCore'));
    expect(saturation255(hot)).toBeGreaterThanOrEqual(60);
    // 그리고 R 이 여전히 가장 낮은 채널이다(가산에서 채도를 죽이는 것은 R 이다).
    expect(hot.r).toBeLessThan(hot.g);
    expect(hot.r).toBeLessThan(hot.b);
  });

  it('대시 심은 **채도를 버리지 않고 휘도만** 올린다', () => {
    const base = partLight('flame');
    const hot = sumLight(base, partLight('dashCore'));
    expect(luminance(hot)).toBeGreaterThan(luminance(base) * 1.3); // 눈에 띄게 뜨겁다
    expect(saturation255(hot)).toBeGreaterThan(150); // 그런데도 시안 정체가 남는다
  });
});

// ---------------------------------------------------------------------------
// 감산 컨투어 — 3차 반려 사유 ①(가산은 경계를 못 만들었다)
// ---------------------------------------------------------------------------

describe('감산 컨투어 — 빛을 더하지 않고 경계를 만든다(§2-2 · §2-4)', () => {
  it('가산 기여 목록에 컨투어가 **없다** — 밝기 총량 예산에 구조적으로 0 이다', () => {
    expect(PARTS).not.toContain('outline' as never);
    expect(PARTS).not.toContain('contour' as never);
  });

  it('모든 채널의 감쇠 계수가 1 미만이다 = 어둡게만 한다(밝힐 수 없다)', () => {
    const f = contourFactor();
    for (const ch of [f.r, f.g, f.b]) {
      expect(ch).toBeGreaterThan(0);
      expect(ch).toBeLessThan(1);
    }
  });

  it('대표 겹침에서 바닥을 **절반 이하**로 떨어뜨린다 — 2차의 "육안 구별 불가"를 닫는다', () => {
    const f = contourFactor();
    const lumaFactor = 0.299 * f.r + 0.587 * f.g + 0.114 * f.b;
    expect(lumaFactor).toBeLessThan(0.5);
  });

  it('R 을 G·B 보다 더 깎는다 = 검은 테두리가 아니라 **차가운 그림자**로 읽힌다', () => {
    const f = contourFactor();
    expect(f.r).toBeLessThan(f.g);
    expect(f.r).toBeLessThan(f.b);
  });

  it('국소 델타가 얼린 화면 노이즈 바닥(0.10)의 3배를 **크게** 넘는다 (비평가 ① 합격 기준)', () => {
    // §2-4 가 못 박은 얼린 상태 노이즈 바닥은 0.10 이다. 헤일로가 깔린 바닥(L≈90)에서 재면
    // 델타가 그 500배 이상이라 "기여는 있는데 안 보인다"가 재발할 수 없다.
    expect(contourDelta(90)).toBeGreaterThan(0.1 * 3);
    expect(contourDelta(90)).toBeGreaterThan(40);
    // 어두운 바닥에서는 작다 — 그게 맞다(거기서는 헤일로가 일한다). 다만 부호는 항상 감산이다.
    expect(contourDelta(8)).toBeGreaterThan(0);
    expect(contourDelta(0)).toBe(0);
  });

  it('한 장의 알파가 0 이면 정확히 항등원이다 — 투명 영역이 배경을 안 건드린다', () => {
    const id = multiplyFactor(0x000000, 0, 8);
    expect(id.r).toBeCloseTo(1, 12);
    expect(id.g).toBeCloseTo(1, 12);
    expect(id.b).toBeCloseTo(1, 12);
  });

  it('겹칠수록 단조 감소한다(겹침 수 파생이 실제로 곱으로 쌓인다)', () => {
    const one = multiplyFactor(0x081428, 0.2, 1).g;
    const four = multiplyFactor(0x081428, 0.2, 4).g;
    expect(four).toBeLessThan(one);
    expect(four).toBeCloseTo(Math.pow(one, 4), 12);
  });

  it('삽입 자리가 glowLayer **바로 다음**이다 — high 티어 블룸 필터가 곱연산을 삼키지 않는다', () => {
    // ⚠️ belowLayer(=glowLayer)에 넣으면 필터가 붙는 순간 투명 렌더 텍스처를 곱해 화면에서
    // 통째로 사라진다. 그 티어가 하필 비평가가 재는 티어다.
    const kids = ['shadow', 'glow', 'sprite', 'effect'];
    expect(contourInsertIndex(kids, 'glow')).toBe(2); // sprite 바로 앞 = 스프라이트 아래
    expect(contourInsertIndex(kids, 'nope')).toBe(-1); // 못 찾으면 폴백 신호
  });
});

describe('무적 표현 — 깜빡임이 아니라 닫혀 들어오는 셸(§3 레인 A ④)', () => {
  it('반지름이 시간의 단조 감소 함수다 = 남은 시간이 화면에서 읽힌다', () => {
    const a = shieldShell(0);
    const b = shieldShell(0.3);
    const c = shieldShell(0.6);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(b!.radius).toBeLessThan(a!.radius);
    expect(c!.radius).toBeLessThan(b!.radius);
  });

  it('셸의 **가장 안쪽 요소까지** 선체 밖에 있다 — 실루엣을 한 픽셀도 덮지 않는다', () => {
    // ⚠️ 바깥 반지름만 보면 안 된다. 셸은 링·육각 메시가 있는 **띠**라, 바깥이 1 을 넘어도
    // 안쪽 요소가 몸통을 가로지를 수 있다 — 육각 메시를 0.6 에 뒀을 때 실제로 그랬고
    // "획뿐이라 선체를 안 가린다"는 자기 계약을 어기고 있었다.
    for (let t = 0; t < 0.66; t += 0.01) {
      const shell = shieldShell(t)!;
      expect(shell.radius).toBeGreaterThan(1);
      expect(shieldInnermostRadius(shell)).toBeGreaterThan(1);
    }
  });

  it('창 밖이면 null(무적이 끝나면 아무것도 남지 않는다)', () => {
    expect(shieldShell(-1)).toBeNull();
    expect(shieldShell(0.7)).toBeNull();
    expect(shieldShell(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('알파가 창 안에서 단조 감소해 툭 끊기지 않는다', () => {
    expect(shieldShell(0)!.alpha).toBeGreaterThan(shieldShell(0.5)!.alpha);
    expect(shieldShell(0.66)!.alpha).toBeGreaterThanOrEqual(0);
  });
});

describe('광원 일관성 — 림은 광원 쪽, 그림자는 반대쪽(§3 공통원칙)', () => {
  it('림 오프셋 부호가 광원 방향과 같다', () => {
    const off = rimOffset({ angle: 0, shadowBias: 0.5 }, 24);
    expect(off.dx).toBeGreaterThan(0);
    expect(off.dy).toBeCloseTo(0, 6);
    const up = rimOffset({ angle: -Math.PI / 2, shadowBias: 0.5 }, 24);
    expect(up.dy).toBeLessThan(0);
  });

  it('오프셋 크기가 표시 반치수에 비례한다(픽셀 하드코딩 금지)', () => {
    const small = rimOffset({ angle: 0, shadowBias: 0.5 }, 10);
    const big = rimOffset({ angle: 0, shadowBias: 0.5 }, 40);
    expect(big.dx).toBeCloseTo(small.dx * 4, 6);
  });
});

describe('피격 임펄스 — 결정적이고 기수 반대다(§2-1 재현 가능)', () => {
  it('같은 시드면 언제나 같은 방향(Math.random 없음)', () => {
    expect(hitImpulseDir(0.4, 77)).toEqual(hitImpulseDir(0.4, 77));
  });

  it('기수 반대 성분이 지배적이다', () => {
    const d = hitImpulseDir(0, 5); // 기수 +x → 임펄스는 -x 지배
    expect(d.dx).toBeLessThan(0);
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 6);
  });

  it('시드가 다르면 횡 성분이 갈린다(매번 같은 방향으로 튀지 않는다)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) seen.add(Math.round(hitImpulseDir(0, i).dy * 1000));
    expect(seen.size).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// 게이트 도출 (§2-3)
// ---------------------------------------------------------------------------

describe('접근성 토글 도출 — 게이트에서 되짚는다', () => {
  it('reducedMotion 은 hitFlash 로 도출된다(전 티어 on 이고 오직 모션 감소만 끈다)', () => {
    expect(reducedMotion(gatesFor('high'))).toBe(false);
    expect(reducedMotion(gatesFor('low'))).toBe(false); // 티어로는 안 꺼진다
    expect(reducedMotion(gatesFor('high', { reducedMotion: true }))).toBe(true);
  });

  it('reducedGlow 는 halo 로 도출된다(발광 감소·low 티어 둘 다 발광을 내려야 한다)', () => {
    expect(reducedGlow(gatesFor('high'))).toBe(false);
    expect(reducedGlow(gatesFor('high', { reducedGlow: true }))).toBe(true);
    expect(reducedGlow(gatesFor('low'))).toBe(true);
  });
});

describe('티어 예산 (§2-3)', () => {
  it('대시 잔상은 low 티어에서 0 이고 티어가 오를수록 늘어난다', () => {
    expect(ghostBudget(gatesFor('low'), 'low')).toBe(0);
    expect(ghostBudget(gatesFor('med'), 'med')).toBeGreaterThan(0);
    expect(ghostBudget(gatesFor('high'), 'high')).toBeGreaterThan(
      ghostBudget(gatesFor('med'), 'med'),
    );
  });

  it('모션 감소에서 잔상이 0 이다(광과민·모션 대응)', () => {
    expect(ghostBudget(gatesFor('high', { reducedMotion: true }), 'high')).toBe(0);
  });

  it('실드 셸은 low·모션감소에서 "plain" 으로 내려가되 꺼지지는 않는다(전투 정보라서)', () => {
    expect(shieldGate(gatesFor('high'), 'high')).toBe('full');
    expect(shieldGate(gatesFor('low'), 'low')).toBe('plain');
    expect(shieldGate(gatesFor('high', { reducedMotion: true }), 'high')).toBe('plain');
  });
});

// ---------------------------------------------------------------------------
// 장식자 — 실제 Sprite/Container 로 태운다(배선·회수·가독성)
// ---------------------------------------------------------------------------

describe('장식자 배선 — 화면에 실제로 붙는다', () => {
  it('플레이어 팩토리가 본체·추진 두 장식자를 그 순서로 만든다', () => {
    const a = playerAdorners();
    expect(a.map((x) => x.name)).toEqual(['playerBody', 'playerThrust']);
  });

  it('정지 상태에서도 엔진 불꽃·림·외곽선이 belowLayer 에 붙는다(아이들 코어)', () => {
    const h = harness();
    const a = playerAdorners();
    run(h, a, 3, { sprite: playerSprite() });
    // 발광은 전부 스프라이트 **아래** 레이어다(계약 §2-2 — 실루엣을 덮지 않는다).
    expect(labeled(h.below, 'playerThrust')).toHaveLength(1);
    expect(labeled(h.below, 'playerRim')).toHaveLength(1);
    expect(labeled(h.below, 'playerContour')).toHaveLength(1);
    expect(labeled(h.above, 'playerShield')).toHaveLength(0); // 무피격이면 실드 셸 없음
    // ⚠️ 여기는 예전에 `above.children.length === 0` 이었다. 판면 음영(⑩)이 aboveLayer 에 살아서
    // 절대 개수로 재면 무관한 항목이 늘 때마다 깨진다 — 라벨로 재는 규율(§labeled 주석)로 바꿨다.
    expect(labeled(h.above, 'playerSurface')).toHaveLength(1);
  });

  it('불꽃은 기수 **반대편**에 놓여 본체 실루엣을 침범하지 않는다(§2-2)', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    run(h, a, 2, { sprite: s, facing: 0 }); // +x 를 봄
    const flame = labeled(h.below, 'playerThrust')[0];
    expect(flame).toBeDefined();
    expect(flame!.x).toBeLessThan(s.x); // 기수 반대(-x) 쪽
  });

  it('기수를 뒤집으면 불꽃도 반대편으로 간다(방향성 = 기수가 화면에서 읽힌다)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 2, { sprite: s, facing: Math.PI }); // -x 를 봄
    expect(labeled(h.below, 'playerThrust')[0]!.x).toBeGreaterThan(s.x);
  });

  it('대각 기수에서도 두 축 모두 기수 반대다(축 정렬 기수만 보면 한 축 부호 오류를 놓친다)', () => {
    // ⚠️ 이 케이스가 없으면 y 오프셋 부호를 뒤집는 뮤테이션이 **살아남는다**(실제로 살아남았다).
    // 위 두 테스트는 facing 0·π 라 sin(f)=0 이어서 y 항을 아예 안 밟는다.
    const h = harness();
    const s = playerSprite();
    const f = Math.PI / 4; // 우하단을 봄 → 불꽃은 좌상단
    run(h, playerAdorners(), 2, { sprite: s, facing: f });
    const flame = labeled(h.below, 'playerThrust')[0]!;
    expect(flame.x).toBeLessThan(s.x);
    expect(flame.y).toBeLessThan(s.y);
    // 오프셋 방향이 기수의 정확한 반대(각도 일치)여야 한다 — 부호만 맞고 축이 섞이면 잡힌다.
    expect(Math.atan2(flame.y - s.y, flame.x - s.x)).toBeCloseTo(f - Math.PI, 6);
  });

  it('테마가 null 이면 림이 스스로 꺼진다(광원 없음)', () => {
    const h = harness({ theme: null });
    const a = playerAdorners();
    run(h, a, 3, { sprite: playerSprite() });
    expect(labeled(h.below, 'playerRim')).toHaveLength(0);
    expect(labeled(h.below, 'playerThrust')).toHaveLength(1);
  });

  it('reducedGlow 에서 가산 발광(불꽃·림)이 사라진다(외곽선만 남는다)', () => {
    const h = harness({ gates: gatesFor('high', { reducedGlow: true }) });
    const a = playerAdorners();
    run(h, a, 3, { sprite: playerSprite() });
    expect(labeled(h.below, 'playerThrust')).toHaveLength(0);
    expect(labeled(h.below, 'playerRim')).toHaveLength(0);
  });
});

describe('뱅킹/롤 — 횡이동에 기운다(§3 레인 A ①)', () => {
  it('우현 미끄러짐이 회전과 세로 압축을 만든다', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    const baseScaleY = s.scale.y;
    run(h, a, 30, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } }); // +y = 우현
    expect(s.rotation).toBeGreaterThan(0); // 기수(0) 위에 롤이 얹혔다
    expect(s.scale.y).toBeLessThan(baseScaleY); // 횡폭 압축
    expect(s.scale.x).toBeCloseTo(baseScaleX(s), 6); // 길이 방향은 안 눌린다
  });

  it('**모듈의 실제 롤 튜닝이 오버슈트한다** — 계단 입력에서 정상상태를 지나쳤다 돌아온다', () => {
    // ⚠️ 이 단언이 `springStep` 순수 함수 테스트와 다른 이유: 저쪽은 테스트가 강성·감쇠를
    // 직접 넘기므로 **모듈이 실제로 쓰는 ROLL_STIFFNESS/ROLL_DAMPING 이 임계감쇠로 바뀌어도
    // 초록으로 남는다**(뮤테이션 검증에서 실제로 살아남았다). 2차 운동은 계약 §3 공통원칙이라
    // 실 튜닝 자체를 잠근다.
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    let prev = ent();
    let curr = ent();
    for (const ad of a) ad.onAttach?.(s, curr, h.ctx);
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      prev = curr;
      curr = ent({ y: prev.y + 12 }); // 일정한 우현 미끄러짐 = 계단 입력
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      if (s.rotation > peak) peak = s.rotation;
      h.advance();
    }
    const steady = s.rotation; // 4초 뒤 = 정상상태
    expect(steady).toBeGreaterThan(0);
    // 임계값 8% 는 실측 20% 대와 "화면에서 지연과 구분 안 되는" 2% 대 사이에 있다 — 감쇠를
    // 임계 근처로 올리는 뮤테이션을 잡되 수치 잡음에는 안 걸린다.
    expect(peak).toBeGreaterThan(steady * 1.08);
  });

  it('좌현 미끄러짐은 반대 부호로 기운다', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 30, { sprite: s, facing: 0, move: { dx: 0, dy: -12 } });
    expect(s.rotation).toBeLessThan(0);
  });

  it('reducedMotion 이면 기울지 않는다(스케일·회전 원본 유지)', () => {
    const h = harness({ gates: gatesFor('high', { reducedMotion: true }) });
    const s = playerSprite();
    const base = s.scale.y;
    run(h, playerAdorners(), 40, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } });
    expect(s.rotation).toBeCloseTo(0, 6);
    expect(s.scale.y).toBeCloseTo(base, 6);
  });

  it('변환이 프레임마다 누적되지 않는다(렌더러가 매 프레임 기준값을 다시 세운다)', () => {
    const h = harness();
    const s = playerSprite();
    const base = s.scale.y;
    run(h, playerAdorners(), 600, { sprite: s, facing: 0 }); // 10초 정지
    expect(s.scale.y).toBeCloseTo(base, 3);
    expect(Math.abs(s.y)).toBeLessThan(10); // 부유 진폭 안에 머문다(발산 없음)
  });
});

describe('피격 반응 — 깜빡이지 않는다(§2-2 가독성 최우선)', () => {
  it('피격 후 실드 셸이 aboveLayer 에 서고, 창이 끝나면 회수된다', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    // 프레임 2 에서 HP 가 떨어진다.
    run(h, a, 6, { sprite: s, hpAt: new Map([[2, 80]]) });
    expect(labeled(h.above, 'playerShield')).toHaveLength(1);
    // 무적 창(40틱 ≈ 0.667s)을 넘길 만큼 더 태운다.
    let prev = ent({ hp: 80 });
    for (let i = 0; i < 60; i++) {
      const curr = ent({ hp: 80 });
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      prev = curr;
      h.advance();
    }
    expect(labeled(h.above, 'playerShield')).toHaveLength(0);
  });

  it('**스프라이트 알파를 절대 건드리지 않는다** — 무적 중 실루엣이 한 프레임도 안 지워진다', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    let prev = ent();
    let curr = ent();
    for (const ad of a) ad.onAttach?.(s, curr, h.ctx);
    for (let i = 0; i < 60; i++) {
      prev = curr;
      curr = ent({ hp: i === 3 ? 70 : prev.hp });
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      expect(s.alpha).toBe(1); // 매 프레임 검사 — 깜빡임이 있으면 여기서 잡힌다
      expect(s.visible).toBe(true);
      h.advance();
    }
  });

  it('피격 임펄스가 기체를 기수 반대로 밀었다가 되돌린다', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    let prev = ent();
    let curr = ent();
    for (const ad of a) ad.onAttach?.(s, curr, h.ctx);
    let kicked = 0;
    for (let i = 0; i < 60; i++) {
      prev = curr;
      curr = ent({ hp: i === 2 ? 70 : prev.hp });
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      if (i === 2) kicked = s.x;
      h.advance();
    }
    expect(kicked).toBeLessThan(0); // 기수 +x 반대로 튀었다
    expect(s.x).toBeCloseTo(0, 1); // 되돌아왔다
  });

  it('sim-step 없는 프레임에서 피격이 재발화하지 않는다(자체 HP 추적)', () => {
    // 같은 prev/curr 쌍(둘 다 hp 70·80)을 계속 먹여도 창이 갱신되지 않아야 한다 → 셸이 만료된다.
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    for (const ad of a) ad.onAttach?.(s, ent(), h.ctx);
    const p = ent({ hp: 80 });
    const c = ent({ hp: 70 }); // prev.hp > curr.hp 가 **매 프레임 참**인 정지 스냅샷 쌍
    for (let i = 0; i < 90; i++) {
      placeSprite(s, c, 0);
      for (const ad of a) ad.onFrame(s, c, p, h.ctx);
      h.advance();
    }
    // prev.hp 로 판정했다면 창이 매 프레임 리셋돼 셸이 영원히 남는다.
    expect(labeled(h.above, 'playerShield')).toHaveLength(0);
  });
});

describe('대시 잔상 (§3 레인 A ⑤)', () => {
  it('대시 속도에서 고스트가 생기고 본체보다 어둡다(§2-2)', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    // 2800 u/s = 46.7 u/tick — sim dashSpeed 임펄스에 해당.
    run(h, a, 12, { sprite: s, facing: 0, move: { dx: 46.7, dy: 0 } });
    const ghosts = labeled(h.below, 'playerGhost').filter((g) => g.visible && g.alpha > 0);
    expect(ghosts.length).toBeGreaterThan(1);
    for (const g of ghosts) expect(g.alpha).toBeLessThan(s.alpha);
  });

  it('순항 속도에서는 고스트가 안 생긴다(대시 전용)', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    run(h, a, 20, { sprite: s, facing: 0, move: { dx: 12, dy: 0 } }); // playerSpeed 720 u/s
    expect(labeled(h.below, 'playerGhost')).toHaveLength(0);
  });

  it('low 티어에서는 대시해도 고스트가 하나도 안 생긴다(§2-3)', () => {
    const h = harness({ tier: 'low', gates: gatesFor('low') });
    const a = playerAdorners();
    run(h, a, 12, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    expect(labeled(h.below, 'playerGhost')).toHaveLength(0);
    // low 는 halo 도 off → 림이 없다. 컨투어·판면 그늘은 감산이라 티어 무관으로 남고,
    // 불꽃은 **아이들 코어로 강등**된다(4차 MINOR — low 에서 기체가 커서로 보이던 것).
    expect(labeled(h.below, 'playerRim')).toHaveLength(0);
    expect(labeled(h.below, 'playerContour')).toHaveLength(1);
    const flame = labeled(h.below, 'playerThrust')[0];
    expect(flame).toBeDefined();
    expect(flame!.alpha).toBeLessThan(1);
    expect(flame!.alpha).toBeGreaterThan(0);
  });
});

describe('형제 회수 — dispose 가 실제로 떼고 파괴한다(§2-3)', () => {
  it('dispose 뒤 두 레이어에 자식이 0 이다', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    run(h, a, 8, { sprite: s, facing: 0, move: { dx: 46.7, dy: 0 }, hpAt: new Map([[3, 60]]) });
    expect(h.below.children.length + h.above.children.length).toBeGreaterThan(0);
    for (const ad of a) ad.dispose(h.ctx);
    expect(h.below.children.length).toBe(0);
    expect(h.above.children.length).toBe(0);
  });

  it('dispose 가 두 번 불려도 안전하다(회수 경로가 겹친다)', () => {
    const h = harness();
    const a = playerAdorners();
    run(h, a, 5, { sprite: playerSprite() });
    for (const ad of a) ad.dispose(h.ctx);
    expect(() => {
      for (const ad of a) ad.dispose(h.ctx);
    }).not.toThrow();
  });

  it('dispose 가 기준 스케일을 되돌린다(눌린 채로 다음 런에 들어가지 않는다)', () => {
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    const base = s.scale.y;
    run(h, a, 30, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } });
    expect(s.scale.y).toBeLessThan(base);
    for (const ad of a) ad.dispose(h.ctx);
    expect(s.scale.y).toBeCloseTo(base, 6);
  });
});

/** 스프라이트의 기준 x 스케일(48px / 텍스처 폭). 롤이 x 를 건드리지 않는다는 단언에 쓴다. */
function baseScaleX(s: Sprite): number {
  return 48 / s.texture.width;
}

// ---------------------------------------------------------------------------
// 실루엣 외곽선 — 기준선 문서가 잡은 "보스 컷에서 플레이어를 못 찾는다"의 해법
// ---------------------------------------------------------------------------

describe('실루엣 컨투어 — 밝기가 아니라 경계로 자기 위치를 확보한다(§2-2)', () => {
  it('항상 붙는다 — 테마 없음·low 티어·발광 감소 어디서도 사라지지 않는다', () => {
    for (const ctx of [
      {},
      { theme: null },
      { tier: 'low' as QualityTier, gates: gatesFor('low') },
      { gates: gatesFor('high', { reducedGlow: true }) },
      { gates: gatesFor('high', { reducedMotion: true }) },
    ]) {
      const h = harness(ctx);
      run(h, playerAdorners(), 3, { sprite: playerSprite() });
      expect(labeled(h.below, 'playerContour')).toHaveLength(1);
    }
  });

  it('복제가 전부 **곱연산**이다 — 가산이면 밝은 헤일로 위에서 경계를 못 만든다(3차 반려 ①)', () => {
    // 이게 3차의 핵심 수정이다. 2차는 기하(8방향)는 옳았는데 합성이 가산이라 기여 픽셀이
    // 726~821px 실재하면서도 7× 확대에서 육안 구별 불가였다.
    const h = harness();
    run(h, playerAdorners(), 3, { sprite: playerSprite() });
    const copies = labeled(h.below, 'playerContour')[0]!.children;
    expect(copies.length).toBe(8);
    for (const c of copies) expect((c as unknown as { blendMode: string }).blendMode).toBe('multiply');
  });

  it('부모가 있으면 glowLayer **바로 위**에 꽂힌다(필터 밖) · 없으면 belowLayer 폴백', () => {
    // 실제 렌더러 레이어 스택을 재현한다. belowLayer 안에 넣으면 high 티어 블룸이 삼킨다.
    const root = new Container();
    const shadow = new Container();
    const below = new Container();
    const sprites = new Container();
    root.addChild(shadow, below, sprites);
    const h = harness({ belowLayer: below });
    run(h, playerAdorners(), 3, { sprite: playerSprite() });
    expect(labeled(below, 'playerContour')).toHaveLength(0); // belowLayer 안이 아니다
    const idx = root.children.findIndex((c) => c.label === 'playerContour');
    expect(idx).toBe(root.getChildIndex(below) + 1); // glowLayer 바로 다음
    expect(idx).toBeLessThan(root.getChildIndex(sprites)); // 그리고 스프라이트 아래
  });

  it('발광 감소·low 티어에서 세기가 **안 낮아진다** — 이건 빛이 아니라 그림자다', () => {
    // 2차까지는 reducedGlow 에서 알파를 0.55배로 내렸다. 곱연산 컨투어는 빛을 더하지 않으므로
    // 광과민 축이 아니고, 오히려 헤일로가 꺼진 상태에서 유일하게 남는 경계 신호다.
    const read = (over: Parameters<typeof harness>[0]): number => {
      const h = harness(over);
      run(h, playerAdorners(), 1, { sprite: playerSprite() });
      return labeled(h.below, 'playerContour')[0]!.children[0]!.alpha;
    };
    const full = read({});
    expect(read({ gates: gatesFor('high', { reducedGlow: true }) })).toBeCloseTo(full, 12);
    expect(read({ tier: 'low', gates: gatesFor('low') })).toBeCloseTo(full, 12);
  });

  it('**8방향 컨투어다** — 어느 방향에도 같은 폭의 띠가 생긴다 (MAJ-3)', () => {
    // 1차 구현은 앵커 기준 균일 스케일 복제 한 장이었다. 그건 dilate 가 아니라서 앵커를 향한
    // 가장자리에 띠가 원리적으로 안 생겼고, 둘레 36섹터 중 약 1/4 이 통째로 비어 있었다.
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 3, { sprite: s });
    const copies = labeled(h.below, 'playerContour')[0]!.children;
    expect(copies.length).toBe(8);

    const angles = copies.map((c) => Math.atan2(c.y - s.y, c.x - s.x));
    const dists = copies.map((c) => Math.hypot(c.x - s.x, c.y - s.y));
    // ① 오프셋 거리가 전부 같다 = 띠 폭이 방향에 무관하다(섹터 결손 불가능).
    for (const d of dists) expect(d).toBeCloseTo(dists[0]!, 6);
    expect(dists[0]!).toBeGreaterThan(0);
    // ② 방향이 8등분으로 고르게 퍼져 있다(한쪽으로 쏠리지 않는다).
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo((2 * Math.PI) / 8, 5);
    }
  });

  it('복제는 본체와 **같은 크기**다 — 띠는 전적으로 오프셋이 만든다', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 3, { sprite: s });
    for (const c of labeled(h.below, 'playerContour')[0]!.children) {
      expect(c.scale.x).toBeCloseTo(s.scale.x, 6);
      expect(c.scale.y).toBeCloseTo(s.scale.y, 6);
    }
  });

  it('뱅킹 압축·회전을 따라간다(테두리가 실루엣에서 떨어지지 않는다)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 30, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } });
    for (const c of labeled(h.below, 'playerContour')[0]!.children) {
      expect(c.scale.y).toBeCloseTo(s.scale.y, 6);
      expect(c.rotation).toBeCloseTo(s.rotation, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// 대시를 사건으로 (3차 요구 ②) · 손상 상태 (③) · 이방성 헤일로 (⑤) · 익단 증기 (⑥)
// ---------------------------------------------------------------------------

describe('대시가 **사건**이다 — 축이 길이 하나뿐이면 "불꽃이 길어졌다"로 읽힌다 (§요구 ②)', () => {
  it('열기가 켜질 때 훨씬 빠르게 붙고 느리게 빠진다(사건 ↔ 여운)', () => {
    const dt = 1 / 60;
    const up = dashHeatStep(0, true, dt);
    const down = dashHeatStep(1, false, dt);
    expect(up).toBeGreaterThan(0.5); // 한 프레임에 절반 넘게 붙는다 = 사건
    expect(1 - down).toBeLessThan(up * 0.4); // 하강은 훨씬 완만
  });

  it('열기가 [0,1] 안에서 단조 수렴한다(발산·오버슈트 없음)', () => {
    let h = 0;
    for (let i = 0; i < 200; i++) {
      const next = dashHeatStep(h, true, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(h);
      expect(next).toBeLessThanOrEqual(1);
      h = next;
    }
    expect(h).toBeGreaterThan(0.99);
  });

  it('개시 링 반지름이 **단조 증가**한다 = 고정 반지름 표식(§2-5 UI 어휘)이 아니다', () => {
    let prev = -1;
    for (let t = 0; t < 0.27; t += 0.01) {
      const r = dashRing(t)!;
      expect(r.radius).toBeGreaterThan(prev);
      prev = r.radius;
    }
    expect(dashRing(0.28)).toBeNull(); // 정지 화면에 남지 않는다
    expect(dashRing(-1)).toBeNull();
  });

  it('링 알파·두께가 단조 감소해 툭 끊기지 않는다', () => {
    expect(dashRing(0)!.alpha).toBeGreaterThan(dashRing(0.2)!.alpha);
    expect(dashRing(0)!.width).toBeGreaterThan(dashRing(0.2)!.width);
    expect(dashRing(0.27)!.alpha).toBeGreaterThanOrEqual(0);
  });

  it('대시 중 심·링·잔상이 **동시에** 화면에 붙는다(축이 셋 이상이어야 사건이다)', () => {
    const h = harness();
    const a = playerAdorners();
    run(h, a, 8, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    const flame = labeled(h.below, 'playerThrust')[0]!;
    const core = flame.children.find((c) => c.label === 'playerDashCore');
    expect(core).toBeDefined();
    expect(core!.alpha).toBeGreaterThan(0.5); // 색이 이동했다
    expect(labeled(h.below, 'playerDashRing')).toHaveLength(1); // 링이 터졌다
    expect(labeled(h.below, 'playerGhost').length).toBeGreaterThan(0); // 잔상이 남았다
  });

  it('순항에서는 심이 0 이고 링도 없다(대시 전용 축)', () => {
    const h = harness();
    run(h, playerAdorners(), 20, { sprite: playerSprite(), facing: 0, move: { dx: 12, dy: 0 } });
    const flame = labeled(h.below, 'playerThrust')[0]!;
    const core = flame.children.find((c) => c.label === 'playerDashCore')!;
    expect(core.alpha).toBeCloseTo(0, 6);
    expect(labeled(h.below, 'playerDashRing')).toHaveLength(0);
  });

  it('링은 **상승 에지 1회**다 — 대시가 이어져도 다시 안 터진다', () => {
    const h = harness();
    const a = playerAdorners();
    // 링 수명(0.28s ≈ 17프레임)을 넘겨 계속 대시하면 링이 회수돼 있어야 한다.
    run(h, a, 40, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    expect(labeled(h.below, 'playerDashRing')).toHaveLength(0);
  });

  it('대시 트라우마가 피격보다 **작다** — 내가 하는 일이 당하는 일보다 세면 안 된다(§요구 ④)', () => {
    expect(PLAYER_DASH_TRAUMA).toBeGreaterThan(0);
    expect(PLAYER_DASH_TRAUMA).toBeLessThan(TRAUMA_PLAYER_HIT);
  });

  it('대시 판정이 렌더러와 장식자에서 **같은 함수**다(흔들림과 불꽃이 같은 프레임에 붙는다)', () => {
    expect(isDashSpeed(2800)).toBe(true);
    expect(isDashSpeed(900)).toBe(false);
  });
});

describe('손상 상태 — HP 1 이든 만피든 똑같이 생기면 안 된다 (§요구 ③)', () => {
  it('강도가 **누진**이다 — 단계로 자르면 경계에서 깜빡임이 된다', () => {
    expect(damageIntensity(100, 100)).toBe(0);
    expect(damageIntensity(60, 100)).toBe(0);
    expect(damageIntensity(30, 100)).toBeGreaterThan(0);
    expect(damageIntensity(10, 100)).toBeGreaterThan(damageIntensity(30, 100));
    expect(damageIntensity(0, 100)).toBe(1);
    expect(damageIntensity(50, 0)).toBe(0); // maxHp 방어
  });

  it('위독 구간에서만 맥동이 붙는다', () => {
    expect(isCriticalHp(50, 100)).toBe(false);
    expect(isCriticalHp(20, 100)).toBe(true);
  });

  it('발광 감소에서 옅어지되 **0 이 되지 않는다** — 손상도는 전투 정보다', () => {
    const full = damageAlpha(1, 1, false);
    const dim = damageAlpha(1, 1, true);
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBeLessThan(full);
  });

  // ── 4차 CRIT-1 ── 3차는 `add` 였고 화면 델타가 **1.98**(7× 육안 구별 불가)이었다. 아래 세
  // 테스트가 그 재발을 막는다: ① 기법이 곱연산이다 ② 모델이 텍스처 인자를 안다 ③ 게이트가
  // 상수가 아니라 **실측 광도 하강**이다.

  it('3차의 실패를 모델이 재현한다 — 가산 스프라이트는 텍스처 인자로 5배 약해진다', () => {
    // 이 테스트의 값은 "고쳐야 할 것"의 크기다. `addLayers`(자유 공간 Graphics 모델)로 잰
    // 3차의 손상 오버레이는 광도 18.3 이었지만, 텍스처 인자를 넣으면 7.7 대다.
    const naive = addLayers([{ color: 0x9c3a14, alpha: 0.22 }]);
    const real = spriteAddLight(0x9c3a14, 0.22);
    expect(luminance(real)).toBeLessThan(luminance(naive) * 0.5);
    // 그리고 **채널 우열이 뒤집힌다** — 주석은 R 지배를 약속했는데 화면은 G 가 더 올랐다.
    expect(naive.r).toBeGreaterThan(naive.g);
    expect(real.g).toBeGreaterThan(real.r);
    // 원인은 텍스처 평균이 청록이라는 것뿐이다(R 낮음·G 높음).
    expect(PLAYER_TEX_MEAN.r).toBeLessThan(PLAYER_TEX_MEAN.g);
  });

  it('그을림이 선체 광도를 **25 이상** 떨어뜨린다 (4차 합격 게이트 — 상수가 아니라 실측 파생)', () => {
    // 기준은 관측된 가장 엄한 본체 실측(clean 149.8)이다. 3차의 국소 델타는 1.98 이었다.
    expect(damageDelta(BODY_LUMA_P99_CLEAN)).toBeGreaterThan(25);
    // 어두운 선체에서도 부호는 항상 감산이고, 밝을수록 세진다(곱연산의 성질).
    expect(damageDelta(20)).toBeGreaterThan(0);
    expect(damageDelta(BODY_LUMA_P99_DENSE)).toBeGreaterThan(damageDelta(BODY_LUMA_P99_CLEAN));
    // 알파 0 은 정확히 항등원 — 만피에서 화면이 한 픽셀도 안 바뀐다.
    expect(damageDelta(BODY_LUMA_P99_CLEAN, 0)).toBeCloseTo(0, 12);
  });

  it('그을림이 **난색으로** 기운다 — ΔR < ΔG < ΔB (3차는 이 우열이 뒤집혀 있었다)', () => {
    const d = damageWarmShift(BODY_LUMA_P99_CLEAN);
    expect(d.r).toBeLessThan(d.g);
    expect(d.g).toBeLessThan(d.b);
    // 감쇠 계수로 보면 R 이 가장 크다(가장 덜 깎인다) = 남는 색이 난색이다.
    const f = damageFactor(0.35);
    expect(f.r).toBeGreaterThan(f.g);
    expect(f.g).toBeGreaterThan(f.b);
  });

  it('오버레이가 **곱연산**이다 — 가산은 청록 텍스처에 곱해져 화면에서 사라졌다(4차 CRIT-1)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 3, { sprite: s, hpAt: new Map([[1, 20]]) });
    const ov = h.above.children.find((c) => c.label === 'playerDamage');
    expect(ov).toBeDefined();
    expect((ov as unknown as { blendMode: string }).blendMode).toBe('multiply');
    expect(ov!.alpha).toBeGreaterThan(0);
    // 실루엣을 한 픽셀도 안 바꾼다: 같은 변환·같은 스케일.
    expect(ov!.rotation).toBeCloseTo(s.rotation, 6);
    expect(ov!.scale.x).toBeCloseTo(s.scale.x, 6);
    // 그리고 본체 tint 는 손대지 않는다(어두워짐 금지).
    expect(s.tint).toBe(0xffffff);
  });

  it('만피에서는 오버레이가 아예 없다(정상 상태에 노이즈를 안 얹는다)', () => {
    const h = harness();
    run(h, playerAdorners(), 3, { sprite: playerSprite() });
    expect(h.above.children.find((c) => c.label === 'playerDamage')).toBeUndefined();
  });

  it('low 티어·모션 감소에서도 **꺼지지 않고** 맥동만 멎는다(정보 축 보존)', () => {
    for (const over of [
      { tier: 'low' as QualityTier, gates: gatesFor('low') },
      { gates: gatesFor('high', { reducedMotion: true }) },
    ]) {
      const h = harness(over);
      run(h, playerAdorners(), 6, { sprite: playerSprite(), hpAt: new Map([[1, 10]]) });
      const ov = h.above.children.find((c) => c.label === 'playerDamage');
      expect(ov).toBeDefined();
      expect(ov!.alpha).toBeGreaterThan(0);
    }
  });
});

describe('이방성 헤일로 — 등방 blob 은 면적을 다 쓰고 정보를 0 비트 준다 (§요구 ⑤)', () => {
  it('정지에서도 기수 축으로 늘어나 있다(정지야말로 기수를 확인하는 순간이다)', () => {
    const a = playerHaloAniso(0, 0, 0.7, 24);
    expect(a.scaleX).toBeGreaterThan(1.2);
    expect(a.rotation).toBeCloseTo(0.7, 12);
    expect(a.ox).toBeCloseTo(0, 12); // 정지에서는 편심 0
  });

  it('빠를수록 더 늘어나고 더 좁아지고 더 앞으로 밀린다', () => {
    const slow = playerHaloAniso(100, 0, 0, 24);
    const fast = playerHaloAniso(900, 0, 0, 24);
    expect(fast.scaleX).toBeGreaterThan(slow.scaleX);
    expect(fast.scaleY).toBeLessThan(slow.scaleY);
    expect(fast.ox).toBeGreaterThan(slow.ox);
  });

  it('편심이 **기수 방향**이다(대각에서도 두 축 부호가 맞다)', () => {
    const f = Math.PI / 4;
    const a = playerHaloAniso(900, 900, f, 24);
    expect(a.ox).toBeGreaterThan(0);
    expect(a.oy).toBeGreaterThan(0);
    const back = playerHaloAniso(900, 900, f + Math.PI, 24);
    expect(back.ox).toBeLessThan(0);
    expect(back.oy).toBeLessThan(0);
  });

  it('편심이 표시 반치수에 비례한다(픽셀 하드코딩 금지)', () => {
    expect(playerHaloAniso(900, 0, 0, 48).ox).toBeCloseTo(playerHaloAniso(900, 0, 0, 24).ox * 2, 6);
  });

  it('속도 상한에서 포화한다(순간이동이 헤일로를 폭주시키지 않는다)', () => {
    expect(playerHaloAniso(1e6, 0, 0, 24).scaleX).toBeCloseTo(playerHaloAniso(900, 0, 0, 24).scaleX, 6);
    expect(playerHaloAniso(1e6, 0, 0, 24).scaleY).toBeGreaterThan(0);
  });
});

describe('익단 증기는 **삭제됐다** — 화면에 없는 것을 코드에 두지 않는다 (4차 CRIT-2)', () => {
  it('어떤 조건에서도 익단 증기가 붙지 않는다(부활 방지 가드)', () => {
    // 자연 인스턴스 국소 델타 0.01, `alpha=1.0` 강제에도 임계 1 이상 달라지는 픽셀이 **9개**.
    // 원인은 알파가 아니라 기하였다(쐐기가 선체 불투명 픽셀 아래) — 고치지 않고 지웠고 그
    // 예산을 판면 음영(⑩)에 썼다. 자세한 근거는 playerVisual.ts 파일 헤더.
    for (const over of [{}, { tier: 'low' as QualityTier, gates: gatesFor('low') }]) {
      const h = harness(over);
      run(h, playerAdorners(), 30, { sprite: playerSprite(), facing: 0, move: { dx: 0, dy: 14 } });
      expect(labeled(h.below, 'playerVapor')).toHaveLength(0);
      expect(labeled(h.above, 'playerVapor')).toHaveLength(0);
    }
  });

  it('대시 개시 링은 여전히 low·발광 감소·모션 감소에서 꺼진다(연출 축 — 회귀 가드)', () => {
    for (const over of [
      { tier: 'low' as QualityTier, gates: gatesFor('low') },
      { gates: gatesFor('high', { reducedGlow: true }) },
      { gates: gatesFor('high', { reducedMotion: true }) },
    ]) {
      const h = harness(over);
      run(h, playerAdorners(), 30, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
      expect(labeled(h.below, 'playerDashRing')).toHaveLength(0);
    }
  });
});

describe('판면 방향광 + 스페큘러 스윕 — 선체 자체가 빛에 반응한다 (4차 CRIT-3)', () => {
  it('스트립 중심이 횡축을 균등 분할한다(기체 타입 무관 공통 규칙)', () => {
    const centers = strips().map(surfaceStripCenter);
    const want = [-0.75, -0.25, 0.25, 0.75];
    // ⚠️ `toEqual` 로 비교하면 안 된다 — 균등 분할이 부동소수다.
    expect(centers).toHaveLength(want.length);
    for (let i = 0; i < want.length; i++) expect(centers[i]).toBeCloseTo(want[i]!, 12);
    // 대칭이다 — 어느 쪽으로 롤해도 같은 세기의 음영이 나온다.
    expect(centers[0]).toBeCloseTo(-centers[centers.length - 1]!, 12);
  });

  it('**모든 스트립이 어떤 L 에서는 알파를 받는다** — 홀수 분할의 영구 알파 0 스트립 금지', () => {
    // ⚠️ 4차에는 `SURFACE_STRIPS = 5` 라 중앙 스트립 중심이 정확히 0 이었다. `s = center × L` 이
    // 항상 0 이라 표시객체 2개가 어떤 조명에서도 그려지지 않았다(구조적 낭비 + 게이트 사각지대).
    // 뮤테이션: 분할을 홀수로 되돌리면 중앙 스트립에서 이 단언이 빨개진다.
    for (const i of strips()) {
      const a = surfaceStripAlpha(i, 1, true);
      const b = surfaceStripAlpha(i, -1, true);
      const live = a.spec + a.shade + b.spec + b.shade;
      expect(live, `스트립 ${i} 가 어떤 L 에서도 알파 0 이다`).toBeGreaterThan(0);
    }
  });

  it('**모든 스트립이 실루엣 마스크 안에 픽셀을 남긴다** (5차 CRIT — 알파 게이트의 사각지대)', () => {
    // 알파 진폭이 아니라 **화면 기여**를 재는 유일한 축이다. 4차 실측에서는 10개 스트립 중 2개만
    // 그려졌고 설계 첨두를 지는 shade0·spec4 가 0픽셀이었다 — `surfaceShadeDelta` 는 그 스트립의
    // 알파를 재고 있었으므로 기하를 고쳐도 안 고쳐도 초록인 자기증명이었다.
    const { width, height } = PLAYER_SPRITE_DISPLAY;
    for (const i of strips()) {
      const px = surfaceStripInsidePx(i, width, height);
      expect(px, `스트립 ${i} 의 마스크 내 횡 폭`).toBeGreaterThan(0);
    }
  });

  it('램프 끝이 **실루엣 안**이다 — 기준 길이를 기수 축으로 되돌리면 밖으로 나간다', () => {
    const { width, height } = PLAYER_SPRITE_DISPLAY;
    // 램프 끝(0.78 × 48 = 37.44px)이 실측 불투명 반폭(38.3px) 안이다.
    expect(surfaceRampOuterEdgePx(width, height)).toBeLessThanOrEqual(PLAYER_OPAQUE_LATERAL_HALF);

    // ⚠️ **5차의 두 단언을 지웠다 — 프로덕션에서 관측 불가능한 것을 재고 있었다.**
    // 5차는 `surfaceLateralHalf` 가 짧은 축을 쓰는지 확인하려고 `toBeCloseTo(height/2)` 와
    // `toBeLessThan(width/2)` 를 걸었다. 그런데 프로덕션 스프라이트는 **96 × 96 정사각**이고
    // (라이브 실측 `baseScaleX === baseScaleY === 1.5`) 정사각에서는 `min === max` 다 —
    // 두 단언이 초록이었던 이유는 테스트가 **롤 스쿼시된 83.2** 를 base 로 넣었기 때문이다.
    // 즉 런타임에 없는 가상 기하에서만 참인 단언이었고, 그것이 5차 뮤테이션 M3 를 red 로
    // 보이게 만든 원인이다.
    //
    // `surfaceLateralHalf` 자체는 남긴다(비정사각 기체 방어). 다만 **정사각 자산에서는 항등**
    // 이므로 그 축을 프로덕션 치수로 검증할 수 없다 — 항등성을 아래에서 명시적으로 잠근다.
    expect(surfaceLateralHalf(width, height)).toBeCloseTo(width / 2, 9);
    // 비정사각을 넣었을 때 짧은 축을 고른다는 사실은 **합성 입력**으로만 관측된다.
    expect(surfaceLateralHalf(120, 80)).toBeCloseTo(40, 9);
    expect(surfaceLateralHalf(80, 120)).toBeCloseTo(40, 9);
  });

  it('스트립 구간이 틈·겹침 없이 이어진다(굽는 기하와 검증 기하가 한 함수에서 온다)', () => {
    const bands = strips().map(surfaceStripBand);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.lo).toBeCloseTo(bands[i - 1]!.hi, 12);
    }
    // 램프 전체가 정규 ±SURFACE_SPAN 을 정확히 채운다.
    expect(bands[0]!.lo).toBeCloseTo(-bands[bands.length - 1]!.hi, 12);
  });

  it('**롤이 조명 계수를 넘긴다** — 광원 횡 성분이 0 인 행성에서도 뱅킹만으로 음영이 생긴다', () => {
    expect(surfaceLight(0, 0)).toBe(0); // 정면광 + 수평 = 판면 대비 없음
    expect(surfaceLight(0, 0.5)).toBeLessThan(0); // 우선회 롤 → 밝은 쪽이 좌현(−y)
    expect(surfaceLight(0, -0.5)).toBeGreaterThan(0);
    // 이득이 1 초과라 롤 하나로 계수가 포화까지 간다(그래서 뱅킹이 실제로 음영을 만든다).
    expect(Math.abs(surfaceLight(0, 0.8))).toBe(1);
  });

  it('선회만 해도 음영이 흐른다 — 계수가 **기수 기준 광원 횡 성분**의 함수다', () => {
    // 같은 태양(+x), 기수만 다르다. 기수가 +x 면 광원이 정면(횡 0), +y 를 보면 광원이 좌현이다.
    const east = surfaceLight(lateralOfLight(0), 0);
    const north = surfaceLight(lateralOfLight(Math.PI / 2), 0);
    expect(east).toBeCloseTo(0, 9);
    expect(Math.abs(north)).toBeGreaterThan(0.9);
  });

  it('밝은 판면은 가산, 등지는 판면은 **곱연산**이다 — 한 스트립이 둘일 수는 없다', () => {
    const last = SURFACE_STRIP_COUNT - 1;
    const lit = surfaceStripAlpha(last, 1, true); // center +0.75, light +1 → 빛을 본다
    const dark = surfaceStripAlpha(0, 1, true); // center −0.75 → 등진다
    expect(lit.spec).toBeGreaterThan(0);
    expect(lit.shade).toBe(0);
    expect(dark.shade).toBeGreaterThan(0);
    expect(dark.spec).toBe(0);
    // 계수를 뒤집으면 밝은 쪽도 뒤집힌다(스윕의 실체).
    expect(surfaceStripAlpha(last, -1, true).shade).toBeGreaterThan(0);
  });

  it('하이라이트가 밝은 쪽에 **좁게 모인다**(지수 > 1 = 스페큘러, 램버트가 아니다)', () => {
    const last = SURFACE_STRIP_COUNT - 1;
    const outer = surfaceStripAlpha(last, 1, true).spec; // |s| = 0.75
    const inner = surfaceStripAlpha(last - 1, 1, true).spec; // |s| = 0.25
    expect(inner).toBeGreaterThan(0);
    // 선형이면 비율이 3 이다. 지수 1.6 이면 3^1.6 ≈ 5.8 로 그보다 크게 벌어진다.
    expect(outer / inner).toBeGreaterThan(3.3);
  });

  it('가산 하이라이트는 발광 감소에서 꺼지고 **감산 그늘은 남는다**(빛이 아니라 그림자다)', () => {
    const off = surfaceStripAlpha(SURFACE_STRIP_COUNT - 1, 1, false);
    expect(off.spec).toBe(0);
    expect(surfaceStripAlpha(0, 1, false).shade).toBeGreaterThan(0);
  });

  it('그늘이 선체 광도를 **25 이상** 떨어뜨린다(low 티어에서 기체가 커서로 안 보이는 근거)', () => {
    // ⚠️ 이 단언 **단독은 자기증명이다**(5차 MAJ) — 알파 진폭만 재므로 그 스트립이 화면에 0픽셀
    // 이어도 통과한다. 4차가 정확히 그 상태였다. 그래서 같은 스트립이 마스크 안에 픽셀을 남기는지를
    // 여기서 함께 잠근다: 두 단언이 붙어 있어야 "화면에서 25 이상 어두워진다"가 참이 된다.
    expect(surfaceShadeDelta(BODY_LUMA_P99_CLEAN)).toBeGreaterThan(25);
    expect(
      surfaceStripInsidePx(0, PLAYER_SPRITE_DISPLAY.width, PLAYER_SPRITE_DISPLAY.height),
    ).toBeGreaterThan(0);
    expect(surfaceShadeDelta(0)).toBeCloseTo(0, 12);
  });

  it('aboveLayer 에 붙고 **실루엣 마스크**를 쓴다 — 마스크가 없으면 선체 위 직사각형이다(§2-5)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 3, { sprite: s, facing: 0.4 });
    const surf = labeled(h.above, 'playerSurface')[0];
    expect(surf).toBeDefined();

    // ⚠️ **컨테이너 `Sprite` 마스크가 아니어야 한다.** Pixi v8 에서 `Sprite` 마스크는 알파마스크
    // 필터라 오프스크린 렌더 타깃이 생기고, 그 안에서 `multiply`/`add` 가 씬이 아니라 빈 타깃에
    // 블렌딩된다 — 실측으로 곱연산의 78% · 가산의 92% 가 죽었다(비평가 최종 3차). 그 상태에서는
    // 어떤 알파 값으로도 게이트를 못 넘었다(전 스트립 α=1 강제에서도 mean 20.9 / 게이트 15).
    expect(surf!.mask, '컨테이너 Sprite 마스크는 렌더 타깃을 만든다').toBeFalsy();

    const strips = surf!.children.filter(
      (c) => c.label === 'playerSurfaceShade' || c.label === 'playerSurfaceSpec',
    );
    expect(strips.length).toBe(SURFACE_STRIP_COUNT * 2);
    for (const strip of strips) {
      const kids = (strip as unknown as { children: unknown[] }).children;
      const tex = kids[0] as Sprite;
      const band = kids[1] as { mask?: unknown };
      // 실루엣은 **본체 텍스처**가 준다(컨테이너 마스크가 아니라).
      expect(tex.texture).toBe(s.texture);
      expect(tex.scale.x).toBeCloseTo(s.scale.x, 9);
      expect(tex.scale.y).toBeCloseTo(s.scale.y, 9);
      // 띠 클리핑은 `Graphics` 마스크 = 스텐실이라 렌더 타깃을 만들지 않는다.
      expect(tex.mask).toBe(band);
      expect(band).toBeInstanceOf(Graphics);
    }
    // 컨테이너가 기수를 물고 있어야 띠가 기체 길이 방향으로 눕는다.
    expect(surf!.rotation).toBeCloseTo(s.rotation, 9);
  });

  it('기울면 표면 음영이 **실제로 바뀐다** — 변환만 바뀌는 뱅킹과의 차이 (CRIT-3 본문)', () => {
    /** 판면 스트립 알파를 좌현→우현 순으로 읽는다. */
    const read = (h: Harness): number[] => {
      const surf = labeled(h.above, 'playerSurface')[0]!;
      return surf.children
        .filter((c) => c.label === 'playerSurfaceShade' || c.label === 'playerSurfaceSpec')
        .map((c) => Math.round(c.alpha * 1000) / 1000);
    };
    // 광원을 정면(+x, 기수도 +x)에 둬 **롤 말고는 음영을 만들 수 있는 것이 없게** 한다.
    const straight = harness();
    run(straight, playerAdorners(), 4, { sprite: playerSprite(), facing: 0 });
    const flat = read(straight);

    const banking = harness();
    run(banking, playerAdorners(), 30, {
      sprite: playerSprite(),
      facing: 0,
      move: { dx: 0, dy: 12 }, // 우현으로 미끄러짐 → 롤
    });
    const rolled = read(banking);

    expect(flat.every((v) => v === 0)).toBe(true); // 수평 정면광에서는 판면 대비 0
    expect(rolled.some((v) => v > 0)).toBe(true); // 기울면 음영이 생긴다
    // 그리고 밝은 쪽·어두운 쪽이 **양쪽 다** 있다(단순 전체 밝힘/어둡힘이 아니다).
    const surf = labeled(banking.above, 'playerSurface')[0]!;
    const spec = surf.children.filter((c) => c.label === 'playerSurfaceSpec' && c.alpha > 0);
    const shade = surf.children.filter((c) => c.label === 'playerSurfaceShade' && c.alpha > 0);
    expect(spec.length).toBeGreaterThan(0);
    expect(shade.length).toBeGreaterThan(0);
  });

  it('모션 감소에서 스윕이 멎되 **광원 성분은 남는다**(운동만 끄고 정보는 남긴다)', () => {
    const h = harness({ gates: gatesFor('high', { reducedMotion: true }) });
    // 광원이 좌현이 되는 기수(+y 를 봄)에서 재면 롤 없이도 음영이 있어야 한다.
    run(h, playerAdorners(), 30, { sprite: playerSprite(), facing: Math.PI / 2, move: { dx: 0, dy: 12 } });
    const surf = labeled(h.above, 'playerSurface')[0]!;
    const shade = surf.children.filter((c) => c.label === 'playerSurfaceShade' && c.alpha > 0);
    expect(shade.length).toBeGreaterThan(0);
  });

  it('테마가 null 이고 수평이면 판면 음영이 전부 0 이다(광원 없음 = 방향광 없음)', () => {
    const h = harness({ theme: null });
    run(h, playerAdorners(), 4, { sprite: playerSprite(), facing: 0 });
    const surf = labeled(h.above, 'playerSurface')[0]!;
    const strips = surf.children.filter(
      (c) => c.label === 'playerSurfaceShade' || c.label === 'playerSurfaceSpec',
    );
    expect(strips.length).toBe(SURFACE_STRIP_COUNT * 2); // 스트립 × (가산 + 곱연산)
    for (const c of strips) expect(c.alpha).toBe(0);
  });

  it('dispose 뒤 다시 태우면 **살아 있는** 스트립으로 재구성된다(파괴된 객체 재사용 금지)', () => {
    // ⚠️ 이 테스트가 예전에는 `expect(surf.mask).toBeFalsy()` 였다. 그건 **항진**이었다 —
    // 마스크를 끊는 한 줄을 지워도 Pixi 가 destroy 에서 효과를 걷어 통과했다(뮤테이션 M23 생존).
    // 실제로 관측 가능하고 실제로 위험한 것은 이쪽이다: 회수가 스트립 배열을 비우지 않으면
    // 재구성분이 파괴된 옛 스트립 **뒤에** 쌓여 알파가 죽은 객체로 가고 화면이 안 바뀐다.
    const h = harness();
    const a = playerAdorners();
    const s = playerSprite();
    run(h, a, 4, { sprite: s, facing: 0 });
    for (const ad of a) ad.dispose(h.ctx);
    expect(labeled(h.above, 'playerSurface')).toHaveLength(0);

    // 우현 미끄러짐으로 롤을 만들어 음영이 반드시 생기는 조건에서 재구성한다.
    run(h, a, 30, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } });
    const again = labeled(h.above, 'playerSurface')[0];
    expect(again).toBeDefined();
    const strips = again!.children.filter(
      (c) => c.label === 'playerSurfaceShade' || c.label === 'playerSurfaceSpec',
    );
    expect(strips).toHaveLength(SURFACE_STRIP_COUNT * 2);
    for (const c of strips) expect(c.destroyed).toBe(false);
    expect(strips.some((c) => c.alpha > 0)).toBe(true);
  });
});

/**
 * 판면 스트립 인덱스 전체. 개수를 테스트에 다시 박으면 분할을 바꿔도 일부만 검사하게 되므로
 * `SURFACE_STRIP_COUNT` 에서만 온다(5차 MAJ 가 잡은 자기증명과 같은 계열).
 */
function strips(): number[] {
  return Array.from({ length: SURFACE_STRIP_COUNT }, (_, i) => i);
}

/** 광원이 +x 인 테마에서 기수 `facing` 일 때의 **광원 횡 성분**. `lateralSpeed` 와 같은 기하다. */
function lateralOfLight(facing: number): number {
  return lateralSpeed(Math.cos(0), Math.sin(0), facing);
}

describe('추진 불꽃 등급 — low 티어에서 기체가 다시 커서가 되지 않는다 (4차 MINOR)', () => {
  it('flameGate 가 세 등급을 낸다 — full / idle(low) / off(발광 감소)', () => {
    expect(flameGate(gatesFor('high'), 'high')).toBe('full');
    expect(flameGate(gatesFor('med'), 'med')).toBe('full');
    expect(flameGate(gatesFor('low'), 'low')).toBe('idle');
    expect(flameGate(gatesFor('high', { reducedGlow: true }), 'high')).toBe('off');
  });

  it('low 아이들 코어는 대시에도 확장·심이 붙지 않는다(감광 등급의 일부)', () => {
    const low = harness({ tier: 'low', gates: gatesFor('low') });
    run(low, playerAdorners(), 12, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    const lowFlame = labeled(low.below, 'playerThrust')[0]!;

    const high = harness();
    run(high, playerAdorners(), 12, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    const highFlame = labeled(high.below, 'playerThrust')[0]!;

    // ⚠️ 두 컷의 scale 을 부등호로 비교하면 안 된다 — 요동(high 에만 있다)이 부호를 흔들어
    // "대시 확장을 그대로 둔" 뮤테이션이 **살아남았다**(M29). 절대값으로 잠근다: 표시 반치수 24 ×
    // 순항 extent 1.0 × 요동 없음 = 24. 대시 배율(2.2)이 살아 있으면 52.8 이 된다.
    expect(lowFlame.scale.x).toBeCloseTo(24, 6);
    expect(lowFlame.scale.y).toBeCloseTo(24, 6); // 요동이 0 이라 폭도 정확히 반치수다
    expect(highFlame.scale.x).toBeGreaterThan(40); // 같은 대시에서 high 는 확장한다
    expect(lowFlame.alpha).toBeLessThan(1);
    const core = lowFlame.children.find((c) => c.label === 'playerDashCore');
    expect(core).toBeDefined();
    expect(core!.alpha).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 접근성 토글 — 비평가 MAJ-1·MAJ-2 (광과민 대응)
// ---------------------------------------------------------------------------

describe('reducedMotion 이 **모든** 운동을 끈다 (MAJ-1)', () => {
  /** n 프레임 동안 값의 변동 폭(최댓값 − 최솟값). 0 이면 완전 정지다. */
  function swing(h: Harness, read: () => number, frames: number): number {
    const s = playerSprite();
    const a = playerAdorners();
    let prev = ent();
    let curr = ent();
    for (const ad of a) ad.onAttach?.(s, curr, h.ctx);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < frames; i++) {
      prev = curr;
      curr = ent();
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      const v = read();
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      h.advance();
    }
    return hi - lo;
  }

  it('엔진 열기 요동이 정확히 0 이 된다 — 1차에는 0.2% 밖에 안 줄었다', () => {
    // 비평가 실측: 통상 4.566 / reducedMotion 4.557. 외곽선 숨쉬기·부유는 정확히 0 이었는데
    // 불꽃 요동만 `motionOn` 게이트 밖에 있었다.
    const normal = harness();
    const normalSwing = swing(normal, () => labeled(normal.below, 'playerThrust')[0]?.scale.x ?? 0, 120);
    expect(normalSwing).toBeGreaterThan(0);

    const reduced = harness({ gates: gatesFor('high', { reducedMotion: true }) });
    const reducedSwing = swing(reduced, () => labeled(reduced.below, 'playerThrust')[0]?.scale.x ?? 0, 120);
    expect(reducedSwing).toBeCloseTo(0, 9);
  });

  it('외곽선 숨쉬기도 정확히 0 이 된다(1차부터 지켜지던 것 — 회귀 방지)', () => {
    const reduced = harness({ gates: gatesFor('high', { reducedMotion: true }) });
    const sw = swing(
      reduced,
      () => labeled(reduced.below, 'playerContour')[0]?.children[0]?.alpha ?? 0,
      120,
    );
    expect(sw).toBeCloseTo(0, 9);
  });
});

describe('reducedGlow 가 **모든** 가산 발광을 끈다 (MAJ-2)', () => {
  it('대시 잔상이 0 이다 — 1차에는 rim 0·thrust 0 인데 ghost 5 가 남았다', () => {
    const h = harness({ gates: gatesFor('high', { reducedGlow: true }) });
    run(h, playerAdorners(), 12, { sprite: playerSprite(), facing: 0, move: { dx: 46.7, dy: 0 } });
    expect(labeled(h.below, 'playerGhost')).toHaveLength(0);
    expect(labeled(h.below, 'playerRim')).toHaveLength(0);
    expect(labeled(h.below, 'playerThrust')).toHaveLength(0);
  });

  it('ghostBudget 이 발광 감소를 직접 존중한다(티어와 무관하게)', () => {
    for (const tier of ['high', 'med'] as const) {
      expect(ghostBudget(gatesFor(tier, { reducedGlow: true }), tier)).toBe(0);
    }
  });
});
