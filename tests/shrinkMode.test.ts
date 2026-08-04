/**
 * 수축지대(shrink) 콘텐츠 — Lane7 (ADR-0021 §2.5).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 함수 계약(§1)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를 만들고
 * `createWorld`/`stepWorld` 를 진짜로 굴려 콘텐츠 배선이 sim 까지 도달함을 증명한다(§2 가 핵심
 * 증거). 베르단(planet 1)이 shrink 로 배정돼 있어 **브릿지 없이 full-path** 로 검증한다:
 *   (a) createWorld 부터 shrinkRuntime 존재·safeRadius=초기값·비-스크롤(scrollRuntime·invasion3 undefined)
 *   (b) 반경 수축: 유예 소진 후 매 틱 safeRadius 정수 감소, 최소 반경 하한에서 멈춤(stepWorld 실경로)
 *   (c) 밖 피해: 안전 반경 밖 플레이어는 지속 피해로 hp 감소, 안이면 무피해
 *   (d) 링 전멸 세그먼트 전진: 안전 반경 안 적 전멸 → segmentIndex 전진(killGoal 아님) + graceTicks 리셋
 *   (e) 보스 아레나 중심 소환: 보스 세그먼트 도달 시 boss 가 원점(0,0) 소환, 처치→victory(공통 경로)
 *   (f) 필드 밖 이동 가드: 플레이어를 아주 멀리 옮겨도 shrinkRuntime·밖 피해·반경 수축이 정상 유지
 *
 * 회귀(§3): 뱀서류(planet0)·블록격파(1)·레이싱(2)·추격(3)·오염(5)은 shrink 콘텐츠 미개입(shrinkRuntime
 * 미존재) + 해시 재현. planet0 골든 바이트 불변(hashWorld 재현).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { SEGMENTS } from '../data/waves.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { blankEntity, spawnBullet } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import {
  createShrinkRuntime,
  advanceShrinkRuntime,
  shrinkRingCleared,
  shrinkOutOfBounds,
  shrinkSafeRadius,
  shrinkSpawnRadius,
  type ShrinkRuntime,
  SHRINK_INITIAL_RADIUS,
  SHRINK_MIN_RADIUS,
  SHRINK_RATE_PER_TICK,
  SHRINK_GRACE_TICKS,
  SHRINK_OUT_OF_BOUNDS_DAMAGE,
  SHRINK_SPAWN_RING_RADIUS,
  SHRINK_SPAWN_INSET,
  SHRINK_SPAWN_MARGIN,
  SHRINK_SPAWN_MARGIN_PERCENT,
} from '../src/sim/modes/shrink.js';

const idle: InputFrame = emptyInput();
/** 런이 접촉·밖 피해로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 정규경로 full-path(스펙 §8): 베르단(planet 1)=shrink 라 브릿지 없이 실도달. */
function shrinkConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 1, stage: 1 }), playerHp: DURABLE_HP };
}

/** 순수 헬퍼 계약 검증용 최소 상태(hitIframes·entities·shrinkRuntime 만 채운다). */
function unitState(rt: ShrinkRuntime | undefined, entities: Entity[] = []): WorldState {
  const s = { config: { hitIframes: 40 }, entities } as unknown as WorldState;
  if (rt !== undefined) s.shrinkRuntime = rt;
  return s;
}

function enemyAt(x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = 100;
  e.maxHp = 100;
  return e;
}

function playerAt(x: number, y: number): Entity {
  const p = blankEntity('player');
  p.x = x;
  p.y = y;
  p.radius = 32;
  p.hp = 1000;
  p.maxHp = 1000;
  return p;
}

/** 한 틱 진행하되 레벨업 프리즈를 자동 해소한다(chase/contamination 선례). */
function stepShrink(state: WorldState, base: InputFrame = idle): void {
  const input = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : base;
  stepWorld(state, input);
}

/** 대상 좌표에 거대 정지 아군탄을 얹어 이번 스텝에 파괴/피해한다(실제 피해 경로). */
function blast(state: WorldState, x: number, y: number, radius: number): void {
  spawnBullet(state, x, y, 0, 0, 1_000_000, 0, radius, 120, 1, 0);
}

// ---------------------------------------------------------------------------
// §1 — 순수 함수 계약
// ---------------------------------------------------------------------------

describe('수축 — 순수 함수', () => {
  it('createShrinkRuntime: 초기 반경 + 시작 유예(정수 불변식)', () => {
    const rt = createShrinkRuntime();
    expect(rt.safeRadius).toBe(SHRINK_INITIAL_RADIUS);
    expect(rt.graceTicks).toBe(SHRINK_GRACE_TICKS);
    expect(Number.isInteger(rt.safeRadius)).toBe(true);
    expect(Number.isInteger(rt.graceTicks)).toBe(true);
  });

  it('advanceShrinkRuntime: 유예 중 반경 홀드, 유예 소진 후 정수 감소, 최소 반경 하한', () => {
    // 유예 중: 반경 홀드, 유예만 1 소진.
    const rt = createShrinkRuntime();
    const r0 = rt.safeRadius;
    advanceShrinkRuntime(rt);
    expect(rt.safeRadius).toBe(r0);
    expect(rt.graceTicks).toBe(SHRINK_GRACE_TICKS - 1);
    // 유예 0 → 매 틱 RATE 만큼 정수 감소.
    rt.graceTicks = 0;
    advanceShrinkRuntime(rt);
    expect(rt.safeRadius).toBe(r0 - SHRINK_RATE_PER_TICK);
    // 하한 직전에서 밟아도 최소 반경 밑으로 안 내려간다(underflow 방지 클램프).
    rt.safeRadius = SHRINK_MIN_RADIUS + SHRINK_RATE_PER_TICK;
    rt.graceTicks = 0;
    advanceShrinkRuntime(rt);
    expect(rt.safeRadius).toBe(SHRINK_MIN_RADIUS);
    // 하한에서 또 밟아도 그대로.
    rt.graceTicks = 0;
    advanceShrinkRuntime(rt);
    expect(rt.safeRadius).toBe(SHRINK_MIN_RADIUS);
    expect(Number.isInteger(rt.safeRadius)).toBe(true);
    expect(Number.isInteger(rt.graceTicks)).toBe(true);
  });

  it('shrinkRingCleared: 안전 반경 안 enemy 만 판정(boss 제외·dead 제외·rt undefined→false)', () => {
    const rt: ShrinkRuntime = { safeRadius: 1000, graceTicks: 0 };
    // rt undefined → false.
    expect(shrinkRingCleared(unitState(undefined, [enemyAt(0, 0)]))).toBe(false);
    // 안전 반경 안 살아있는 enemy → false(아직 안 치웠다).
    expect(shrinkRingCleared(unitState(rt, [enemyAt(0, 0)]))).toBe(false);
    // 안전 반경 밖 enemy 만 → true(안에 없다).
    expect(shrinkRingCleared(unitState(rt, [enemyAt(5000, 0)]))).toBe(true);
    // dead enemy 는 무시 → true.
    const dead = enemyAt(0, 0);
    dead.dead = true;
    expect(shrinkRingCleared(unitState(rt, [dead]))).toBe(true);
    // boss 는 안에 있어도 제외 → true(enemy 만 센다 — 중심 보스가 gate 를 영원히 막지 않게).
    const boss = blankEntity('boss');
    boss.x = 0;
    boss.y = 0;
    boss.radius = 60;
    expect(shrinkRingCleared(unitState(rt, [boss]))).toBe(true);
    // 경계(정확히 safeRadius)는 안으로 친다(<=).
    expect(shrinkRingCleared(unitState(rt, [enemyAt(1000, 0)]))).toBe(false);
  });

  it('shrinkOutOfBounds: 밖=피해+iframes, 안=무피해, iframes 존중, rt undefined→무피해', () => {
    const rt: ShrinkRuntime = { safeRadius: 1000, graceTicks: 0 };
    // 밖(원점 거리 2000 > 1000) → 피해 + iframes 부여.
    const pOut = playerAt(2000, 0);
    const hp0 = pOut.hp;
    shrinkOutOfBounds(unitState(rt, [pOut]), pOut);
    expect(pOut.hp).toBe(hp0 - SHRINK_OUT_OF_BOUNDS_DAMAGE);
    expect(pOut.iframes).toBe(40);
    // iframes>0 → 무피해(피격과 같은 규율).
    const pIf = playerAt(2000, 0);
    pIf.iframes = 5;
    const hpIf = pIf.hp;
    shrinkOutOfBounds(unitState(rt, [pIf]), pIf);
    expect(pIf.hp).toBe(hpIf);
    // 안(원점) → 무피해.
    const pIn = playerAt(0, 0);
    const hpIn = pIn.hp;
    shrinkOutOfBounds(unitState(rt, [pIn]), pIn);
    expect(pIn.hp).toBe(hpIn);
    // rt undefined → 무피해(수축 아님).
    const pNo = playerAt(9999, 0);
    const hpNo = pNo.hp;
    shrinkOutOfBounds(unitState(undefined, [pNo]), pNo);
    expect(pNo.hp).toBe(hpNo);
  });

  it('shrinkSafeRadius/shrinkSpawnRadius: rt 값 노출 · 스폰 반경은 항상 safeRadius 미만(마진)', () => {
    expect(shrinkSafeRadius(unitState(undefined))).toBe(0);
    expect(shrinkSpawnRadius(unitState(undefined))).toBe(0);
    const big: ShrinkRuntime = { safeRadius: SHRINK_INITIAL_RADIUS, graceTicks: 0 };
    expect(shrinkSafeRadius(unitState(big))).toBe(SHRINK_INITIAL_RADIUS);
    // safeRadius > SPAWN_RING → 스폰은 SPAWN_RING 상한에서 마진만큼 안쪽. 이 구간(=초반)은
    // 상한이 지배하므로 탈출 여유가 원래 크다(2500) — 거동이 사실상 그대로다.
    expect(shrinkSpawnRadius(unitState(big))).toBe(SHRINK_SPAWN_RING_RADIUS - SHRINK_SPAWN_MARGIN);
    // safeRadius ≤ SPAWN_RING → safeRadius 에서 **마진**만큼 조여진다. 구 인셋(16)이었을 때
    // 여기서 탈출 여유가 16 으로 고정돼 후반 게이트가 공짜가 됐다(사용자 신고 2026-08-04).
    const small: ShrinkRuntime = { safeRadius: SHRINK_SPAWN_RING_RADIUS - 100, graceTicks: 0 };
    expect(shrinkSpawnRadius(unitState(small))).toBe(
      SHRINK_SPAWN_RING_RADIUS - 100 - SHRINK_SPAWN_MARGIN,
    );
    // 경계값(safeRadius === SPAWN_RING)에서도 스폰이 엄격히 안쪽이다(r=1400 조기 전진 버그 방어).
    const edge: ShrinkRuntime = { safeRadius: SHRINK_SPAWN_RING_RADIUS, graceTicks: 0 };
    expect(shrinkSpawnRadius(unitState(edge))).toBeLessThan(SHRINK_SPAWN_RING_RADIUS);
  });

  /**
   * 게이트 난이도의 **런 전체 균일성** — 사용자 신고 2026-08-04("초반엔 안 늘다가 후반에 갑자기").
   * 재는 것은 게이지 산식이 아니라 **적이 링을 벗어나야 하는 거리**다. 구 산식은 이 값이
   * `safeRadius` 가 스폰 링 밑으로 내려가는 순간 16 으로 고정돼(= 오버슛 한 번이면 칸 통과)
   * 런 뒤 절반의 게이트를 통째로 무력화했다.
   */
  it('탈출 여유가 링이 조여져도 붕괴하지 않는다(구 결함: 3000 밑에서 16 고정)', () => {
    const margin = (safeRadius: number): number =>
      safeRadius - shrinkSpawnRadius(unitState({ safeRadius, graceTicks: 0 }));
    // 상한이 지배하는 초반 — 여유가 원래 크다(회귀 방지: 초반을 건드리지 않았다).
    expect(margin(SHRINK_INITIAL_RADIUS)).toBeGreaterThan(2000);
    // 링이 스폰 상한 밑으로 조여진 구간 — 여기가 무너져 있었다(구값 16 고정).
    // 마진은 `min(MARGIN, floor(r × PERCENT/100))` 이라, 반경이 충분하면 MARGIN 그대로다.
    for (const r of [2900, 2000]) {
      expect(margin(r), `safeRadius=${r} 탈출 여유`).toBe(SHRINK_SPAWN_MARGIN);
    }
    // 반경이 작아지면 마진도 **함께** 줄어든다 — 안 줄이면 적이 원점에 겹쳐 스폰돼 무대가
    // 막힌다(실측: 격전 세그먼트 36,000틱 정체). 비례식 그대로인지 확인한다.
    for (const r of [1500, 1000, SHRINK_MIN_RADIUS]) {
      const expected = Math.min(
        SHRINK_SPAWN_MARGIN,
        Math.floor((r * SHRINK_SPAWN_MARGIN_PERCENT) / 100),
      );
      expect(margin(r), `safeRadius=${r} 탈출 여유`).toBe(expected);
    }
    // 그래도 구값(16)보다는 어디서나 훨씬 크다 — 그것이 이 수정의 요점이다.
    for (const r of [SHRINK_MIN_RADIUS, 1000, 2000, 2900]) {
      expect(margin(r), `safeRadius=${r}`).toBeGreaterThan(SHRINK_SPAWN_INSET * 10);
    }
    // 어떤 반경에서도 스폰은 경계보다 엄격히 안쪽이다(Taylor 오분류 방어는 유지).
    for (const r of [SHRINK_MIN_RADIUS, 800, 1500, 3000, SHRINK_INITIAL_RADIUS]) {
      expect(shrinkSpawnRadius(unitState({ safeRadius: r, graceTicks: 0 })), `r=${r}`).toBeLessThan(
        r - SHRINK_SPAWN_INSET + 1,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — 정규경로 full-path 통합(배선 실도달 증명, buildRunConfig planet 1 = 베르단=shrink)
// ---------------------------------------------------------------------------

describe('수축 — 정규경로 full-path 통합(베르단=shrink)', () => {
  it('(a) createWorld 부터 shrinkRuntime 존재·safeRadius=초기값·비-스크롤', () => {
    const w = createWorld(11, shrinkConfig());
    expect(w.config.planetMode).toBe(PLANET_MODE.shrink);
    const shr = w.shrinkRuntime;
    expect(shr).toBeDefined();
    expect(shr?.safeRadius).toBe(SHRINK_INITIAL_RADIUS);
    expect(shr?.graceTicks).toBe(SHRINK_GRACE_TICKS);
    // 비-스크롤 자유추적(카메라·스크롤 코드 미개입) + 침공 아님.
    expect(w.scrollRuntime).toBeUndefined();
    expect(w.invasion3).toBeUndefined();
  });

  it('(b) 반경 수축: 유예 소진 후 매 틱 정수 감소, 최소 반경 하한(stepWorld 실경로)', () => {
    const w = createWorld(5, shrinkConfig());
    w.weapon.damage = 0; // 보스 조기 처치·victory 배제
    const shr = w.shrinkRuntime as ShrinkRuntime;
    // 보스 세그먼트로 보내 세그먼트 전진(유예 리셋)을 배제 → advanceShrinkRuntime 만 관찰한다.
    w.wave.segmentIndex = SEGMENTS.length - 1;
    shr.graceTicks = 0;
    const before = shr.safeRadius;
    stepShrink(w);
    expect(shr.safeRadius).toBe(before - SHRINK_RATE_PER_TICK); // 실경로 1틱 정수 감소
    // 최소 반경 하한: 하한 직전에서 밟아도 하한 밑으로 안 내려간다.
    shr.safeRadius = SHRINK_MIN_RADIUS + SHRINK_RATE_PER_TICK;
    shr.graceTicks = 0;
    stepShrink(w);
    expect(shr.safeRadius).toBe(SHRINK_MIN_RADIUS);
    shr.graceTicks = 0;
    stepShrink(w);
    expect(shr.safeRadius).toBe(SHRINK_MIN_RADIUS); // 더 안 내려간다
  });

  it('(c) 밖 피해: 안전 반경 밖 플레이어는 지속 피해로 hp 감소, 안이면 무피해', () => {
    const w = createWorld(7, shrinkConfig());
    const player = w.entities[0] as Entity;
    const hp0 = player.hp;
    // 안전 반경 밖(원점에서 아주 멀리)에 매 틱 고정 → stepWorld 실경로로 밖 피해가 누적된다.
    for (let i = 0; i < 200; i++) {
      const shr = w.shrinkRuntime as ShrinkRuntime;
      player.x = shr.safeRadius + 4000;
      player.y = 0;
      stepShrink(w);
    }
    expect(player.hp).toBeLessThan(hp0); // 밖 지속 피해로 hp 감소(durable 라 즉사 안 함)
    // 안전 반경 안이면 무피해(원점에 두고 직접 호출로 격리 검증 — 접촉·스폰 confound 배제).
    const w2 = createWorld(7, shrinkConfig());
    const p2 = w2.entities[0] as Entity;
    p2.x = 0;
    p2.y = 0;
    const hp2 = p2.hp;
    shrinkOutOfBounds(w2, p2);
    expect(p2.hp).toBe(hp2);
  });

  it('(d) 링 전멸로 세그먼트가 전진한다(killGoal 아님) + graceTicks 리셋', () => {
    const w = createWorld(3, shrinkConfig());
    w.weapon.damage = 0; // kills 를 0 으로 고정 → killGoal 게이트 배제(전진하면 링 전멸뿐)
    // 몇 틱 굴려 안전 반경 안(원점 스폰)에 적을 채운다 → cleared=false(아직 못 넘는다).
    for (let i = 0; i < 3; i++) stepShrink(w);
    expect(shrinkRingCleared(w)).toBe(false);
    expect(w.entities.some((e) => e.kind === 'enemy' && !e.dead)).toBe(true);
    const idxBefore = w.wave.segmentIndex;
    // 유예를 0 으로 두고(리셋 관찰), 살아있는 적을 전부 dead 표시한다.
    (w.shrinkRuntime as ShrinkRuntime).graceTicks = 0;
    for (const e of w.entities) if (e.kind === 'enemy') e.dead = true;
    // 다음 틱: updateWaves 가 안전 반경 안 적 전멸(shrinkRingCleared=true)을 보고 세그먼트 전진 +
    // graceTicks 리셋(카드 재스폰 전 — cardTimer>0). kills=0 이라 killGoal 로는 절대 전진 못 한다.
    stepShrink(w);
    expect(w.kills).toBe(0);
    expect(w.wave.segmentIndex).toBe(idxBefore + 1);
    expect((w.shrinkRuntime as ShrinkRuntime).graceTicks).toBe(SHRINK_GRACE_TICKS);
  });

  it('(e) 보스가 아레나 중심(0,0)에 소환되고 처치 시 victory(공통 경로)', () => {
    const w = createWorld(9, shrinkConfig());
    const player = w.entities[0] as Entity;
    // 플레이어를 원점에서 멀리 두어 "보스가 플레이어가 아니라 아레나 중심에 소환됨"을 강하게 증명.
    player.x = 5000;
    player.y = 5000;
    w.wave.segmentIndex = SEGMENTS.length - 1;
    stepShrink(w);
    const boss = w.entities.find((e) => e.kind === 'boss') as Entity;
    expect(boss).toBeDefined();
    // 아레나 중심(0,0) 근처 소환(한 틱 hover 이동분만 허용) — 플레이어(5000,5000)와는 멀다.
    expect(Math.hypot(boss.x, boss.y)).toBeLessThan(1000);
    expect(Math.hypot(boss.x - player.x, boss.y - player.y)).toBeGreaterThan(3000);
    // 보스를 실제 피해로 처치 → 공통 compact→victory. 보스는 hp 분율 페이즈(0.7·0.35)마다 전이
    // 프리즈(120틱)를 거치므로 매 틱 큰 아군탄으로 지속 타격한다. ⚠️ 투사체 컬 반경 때문에 아군탄이
    // 플레이어에서 너무 멀면(위처럼 원점≠플레이어) 컬링되어 안 맞는다 → 플레이어를 보스 좌표로
    // 되돌려 블라스트가 항상 유효 사거리 안에 들게 한다.
    for (let i = 0; i < 800 && !w.victory; i++) {
      const b = w.entities.find((e) => e.kind === 'boss');
      if (b !== undefined) {
        player.x = b.x;
        player.y = b.y;
        blast(w, b.x, b.y, b.radius + 100);
      }
      stepShrink(w);
    }
    expect(w.victory).toBe(true);
  });

  it('(f) 필드 밖(8000,8000)으로 도망가도 shrinkRuntime·밖 피해·반경이 정상 유지된다', () => {
    const w = createWorld(21, shrinkConfig());
    const player = w.entities[0] as Entity;
    const shr = w.shrinkRuntime as ShrinkRuntime;
    const before = shr.safeRadius;
    const hp0 = player.hp;
    for (let i = 0; i < 10; i++) {
      player.x = 8000;
      player.y = 8000;
      stepShrink(w);
    }
    // 모드 상태가 플레이어 위치와 무관하게 유지된다: shrinkRuntime 존재, 반경 증가 없음(유예 홀드),
    // 밖 피해 정상(hp 감소), durable 라 즉사 없음. shrink 는 사전 배치 gimmick 이 없어 컬링과 무관하지만
    // 위치 독립성을 못박는다(컬링 반복결함 동형).
    expect(w.shrinkRuntime).toBeDefined();
    expect(shr.safeRadius).toBeLessThanOrEqual(before);
    expect(player.hp).toBeLessThan(hp0); // 밖 피해가 멀리서도 적용된다
    expect(w.gameOver).toBe(false); // durable HP — 밖 피해로 즉사하지 않는다
  });

  it('(g) full-path config 는 실제로 shrink 를 스탬프한다(planetContent 정본, 브릿지 없음)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 1, stage: 1 });
    expect(cfg.planetMode).toBe(PLANET_MODE.shrink);
  });

  it('(h) safeRadius ≤ 스폰 링 반경 구간에서 실제 스폰(cos/sin)이 안전 반경 안에 들어 링 게이트가 헛돌지 않는다(리뷰 MED 회귀)', () => {
    // ⚠️ 결정론용 Taylor sin/cos 는 cos²+sin²>1 이라, 경계(=safeRadius) 스폰은 x²+y²>safeRadius²
    // 가 되어 shrinkRingCleared 가 "밖"으로 오분류 → 세그먼트 조기 전진(코어 진행 규칙 무력화).
    // 인셋 수정(SHRINK_SPAWN_INSET) 검증: safeRadius 를 스폰 링 반경(1400) 이하(1000)로 낮추고
    // **실제 웨이브 스폰 경로**(formationPositions cos/sin)를 태워도, 스폰된 적이 안전 반경 안이라
    // shrinkRingCleared 가 false(아직 안 비었다)이고 세그먼트가 스폰만으로 전진하지 않는다.
    // (수정 전이면 스폰 적이 전원 "밖" → shrinkRingCleared true → 조기 전진으로 이 테스트가 실패.)
    const w = createWorld(7, shrinkConfig());
    w.weapon.damage = 0; // 처치 배제(kills=0) → shrink 의 유일 전진 경로는 링 게이트뿐
    const rt = w.shrinkRuntime as ShrinkRuntime;
    rt.safeRadius = 1000; // 스폰 링 반경(1400) 이하 → 인셋 없으면 경계 스폰 버그 구간
    rt.graceTicks = 1_000_000; // 반경 홀드(수축이 이 테스트를 흔들지 않게)
    const seg0 = w.wave.segmentIndex;
    let spawned = false;
    for (let i = 0; i < 400 && !spawned; i++) {
      stepShrink(w);
      spawned = w.entities.some((e) => e.kind === 'enemy' && !e.dead);
    }
    expect(spawned).toBe(true); // 적이 실제로 스폰됐다(공허 런 가드)
    expect(rt.safeRadius).toBe(1000); // 유예 홀드로 반경 불변(판정 전제)
    // ★ 핵심: 스폰된 적이 안전 반경 안이라 링이 아직 안 비었다(수정 전이면 true 로 실패).
    expect(shrinkRingCleared(w)).toBe(false);
    // 실제 스폰 좌표(cos/sin 경로)가 안전 반경 안임을 직접 확증.
    const enemies = w.entities.filter((e) => e.kind === 'enemy' && !e.dead);
    for (const e of enemies) {
      expect(e.x * e.x + e.y * e.y).toBeLessThanOrEqual(rt.safeRadius * rt.safeRadius);
    }
    // 스폰만으로 조기 전진하지 않았다(링이 안 비었으므로 세그먼트 불변).
    expect(w.wave.segmentIndex).toBe(seg0);
    // 스폰 반경 자체도 safeRadius 미만(인셋 적용)임을 못박는다.
    expect(shrinkSpawnRadius(w)).toBeLessThan(rt.safeRadius);
  });
});

// ---------------------------------------------------------------------------
// §3 — 회귀(타 모드 무개입 + 해시 재현 + planet0 골든 불변)
// ---------------------------------------------------------------------------

describe('수축 — 회귀(타 모드 무개입 + 해시 재현)', () => {
  const noShrink = (w: WorldState): void => {
    expect(w.shrinkRuntime).toBeUndefined();
  };

  it('뱀서류(planet0) 런에는 수축 런타임이 없고 해시가 재현된다(골든 불변)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const run = (): number[] => {
      const w = createWorld(31337, { ...cfg, playerHp: DURABLE_HP });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, { ...idle, moveX: 1 });
        out.push(hashWorld(w));
      }
      noShrink(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('블록격파 런은 scrollRuntime 은 있고 shrinkRuntime 은 없다(해시 재현)', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.blockBreak,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(4242, cfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      expect(w.scrollRuntime).toBeDefined();
      noShrink(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('레이싱 런은 scrollRuntime 은 있고 shrinkRuntime 은 없다(해시 재현)', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.racing,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(909, cfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      expect(w.scrollRuntime).toBeDefined();
      noShrink(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('추격 런에는 shrinkRuntime 이 없다(비-스크롤 자유추적, 코스는 별도)', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.chase,
      playerHp: DURABLE_HP,
    };
    const w = createWorld(77, cfg);
    for (let i = 0; i < 30; i++) stepWorld(w, idle);
    expect(w.scrollRuntime).toBeUndefined();
    noShrink(w);
  });

  it('오염 런에는 shrinkRuntime 이 없다', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.contamination,
      playerHp: DURABLE_HP,
    };
    const w = createWorld(55, cfg);
    for (let i = 0; i < 30; i++) stepWorld(w, idle);
    noShrink(w);
  });
});
