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
import { Container, Sprite, Texture } from 'pixi.js';

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
  shieldGate,
  ghostBudget,
  rimOffset,
  hitImpulseDir,
} from '../src/render/entity/playerVisual.js';
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

  it('셸은 언제나 선체 밖에 있다(반지름 > 1) — 실루엣을 덮지 않는다', () => {
    for (let t = 0; t < 0.66; t += 0.02) {
      expect(shieldShell(t)!.radius).toBeGreaterThan(1);
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
    expect(labeled(h.below, 'playerOutline')).toHaveLength(1);
    expect(h.above.children.length).toBe(0); // 무피격이면 실드 셸 없음
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
    expect(h.above.children.length).toBe(1);
    // 무적 창(40틱 ≈ 0.667s)을 넘길 만큼 더 태운다.
    let prev = ent({ hp: 80 });
    for (let i = 0; i < 60; i++) {
      const curr = ent({ hp: 80 });
      placeSprite(s, curr, 0);
      for (const ad of a) ad.onFrame(s, curr, prev, h.ctx);
      prev = curr;
      h.advance();
    }
    expect(h.above.children.length).toBe(0);
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
    expect(h.above.children.length).toBe(0);
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
    // low 는 halo 도 off → 불꽃·림도 없다. 외곽선만 남는다(자기 위치 확보는 티어 무관).
    expect(labeled(h.below, 'playerThrust')).toHaveLength(0);
    expect(labeled(h.below, 'playerOutline')).toHaveLength(1);
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

describe('실루엣 외곽선 — 밝기가 아니라 경계로 자기 위치를 확보한다(§2-2)', () => {
  it('항상 belowLayer 에 있다 — 테마 없음·low 티어·발광 감소 어디서도 사라지지 않는다', () => {
    for (const ctx of [
      {},
      { theme: null },
      { tier: 'low' as QualityTier, gates: gatesFor('low') },
      { gates: gatesFor('high', { reducedGlow: true }) },
      { gates: gatesFor('high', { reducedMotion: true }) },
    ]) {
      const h = harness(ctx);
      run(h, playerAdorners(), 3, { sprite: playerSprite() });
      expect(labeled(h.below, 'playerOutline')).toHaveLength(1);
    }
  });

  it('본체보다 어둡다 — 이펙트가 실루엣을 먹지 않는다', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 20, { sprite: s });
    for (const o of labeled(h.below, 'playerOutline')) expect(o.alpha).toBeLessThan(s.alpha);
  });

  it('선체보다 크다 = 삐져나온 테두리만 보인다(면적이 아니라 경계)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 3, { sprite: s });
    const o = labeled(h.below, 'playerOutline')[0]!;
    expect(o.scale.x).toBeGreaterThan(s.scale.x);
    expect(o.scale.x).toBeLessThan(s.scale.x * 1.5); // 헤일로가 아니라 테두리다
  });

  it('뱅킹 압축을 따라간다(테두리가 실루엣에서 떨어지지 않는다)', () => {
    const h = harness();
    const s = playerSprite();
    run(h, playerAdorners(), 30, { sprite: s, facing: 0, move: { dx: 0, dy: 12 } });
    const o = labeled(h.below, 'playerOutline')[0]!;
    expect(o.scale.y / s.scale.y).toBeCloseTo(o.scale.x / s.scale.x, 6);
    expect(o.rotation).toBeCloseTo(s.rotation, 6);
  });

  it('발광 감소에서 알파가 낮아지되 0 이 되지 않는다(조작 가능성 보장)', () => {
    const dim = harness({ gates: gatesFor('high', { reducedGlow: true }) });
    run(dim, playerAdorners(), 3, { sprite: playerSprite() });
    const a = labeled(dim.below, 'playerOutline')[0]!.alpha;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.5);
  });
});
