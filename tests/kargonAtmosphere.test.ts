/**
 * 카르곤 전경 대기(잔불·재·연기·열기) 잠금 테스트.
 *
 * 이 레이어는 **틀려도 안 터진다** — 배경이라 예외가 나지 않고, 화면이 그럴싸하면 아무도
 * 눈치채지 못한다. 그래서 눈으로 보는 검증만으로는 부족하고, 아래를 구조로 잠근다:
 *
 *  ① 입자 상태가 `(seed, index, tick)` 의 **순수 함수**다(같은 입력 → 같은 출력).
 *  ② tick 이 변하면 위치가 **실제로** 변한다(움직이는 척만 하는 항진 방지).
 *  ③ 수명 주기를 넘어가면 **되감긴다**(무한 상승 금지 — 입자가 화면 밖으로 영영 날아가지 않는다).
 *  ④ 티어별 입자 수가 **단조**다(off ≤ min ≤ normal).
 *  ⑤ 알파·크기가 **상한을 넘지 않는다** — 이게 곧 "잔불을 적탄으로 착각하지 않는다"의 코드 강제다.
 *  ⑥ **화면 기여도가 하한 위에 있다** — 2차에서 추가. 아래 절 참조.
 *
 * ## 왜 ⑥ 이 필요한가 (1차 기각의 교훈)
 * 1차 구현은 ①~⑤ 를 전부 통과하고도 **화면 기여도 0.45**(RGB 합산 절대차 평균, 노이즈 바닥
 * 0.12)로 기각됐다. 상한만 감시하는 테스트 스위트는 "아무것도 안 그리는 레이어"를 만점으로
 * 통과시킨다 — 극단적으로 모든 알파를 0 으로 바꿔도 ①~⑤ 는 전부 초록이다. 실패의 실체는
 * 개별 결정이 아니라 **네 개의 보수적 결정이 곱해진 결과**였고, 사람은 곱셈을 눈으로 추적하지
 * 못한다. 그래서 곱셈의 결과 자체를 단언한다(상한도 함께 — 안개로 도망가는 것도 실패다).
 */

import { describe, it, expect } from 'vitest';
import {
  ATMOSPHERE_FIELDS,
  ATMOSPHERE_TUNING,
  KargonAtmosphereLayer,
  BULLET_DISPLAY_RADIUS,
  EMBER_ALPHA,
  EMBER_MAX_RADIUS,
  ON_SCREEN_AREA_FRACTION,
  REFERENCE_BACKDROP,
  dotProfile,
  estimateAtmosphereContribution,
  estimateFieldContribution,
  fieldCount,
  fieldDeltaRgbSum,
  maxFieldCount,
  profileAverageFill,
  puffProfile,
  sampleParticle,
  textureProfile,
  type FieldSpec,
  type ViewRect,
} from '../src/render/env/kargonAtmosphere.js';

/** 1920×1080 design 화면(레터박스 없음). */
const VIEW: ViewRect = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };
const SEED = 0x51ee;

/** 입자가 존재할 수 있는 패딩 포함 사각형(레이어 내부 규약: 가로 12%, 세로 15%). */
const PAD_X = 1920 * 0.12;
const PAD_Y = 1080 * 0.15;

/** 기여도를 재는 tick 표본(한 순간의 우연한 배치가 아니라 시간 평균을 본다). */
const TICKS = Array.from({ length: 24 }, (_, k) => k * 137);

function fieldByName(name: string): FieldSpec {
  const f = ATMOSPHERE_FIELDS.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no field: ${name}`);
  return f;
}

describe('카르곤 대기 입자 — 순수 함수 계약', () => {
  it('① 같은 (seed, index, tick) 이면 항상 같은 결과다', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      for (const i of [0, 3, 7]) {
        for (const tick of [0, 137.5, 90210]) {
          const a = sampleParticle(f, SEED, i, tick, VIEW, 400, -250);
          const b = sampleParticle(f, SEED, i, tick, VIEW, 400, -250);
          expect(b).toEqual(a);
        }
      }
    }
  });

  it('① 시드가 다르면 배치가 다르다(시드 무시 항진 방지)', () => {
    const f = fieldByName('ember');
    const a = sampleParticle(f, 1, 0, 500, VIEW);
    const b = sampleParticle(f, 999_331, 0, 500, VIEW);
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it('① 인덱스가 다르면 서로 다른 입자다(전부 같은 자리 방지)', () => {
    const f = fieldByName('ember');
    const seen = new Set<string>();
    for (let i = 0; i < maxFieldCount(f); i++) {
      const p = sampleParticle(f, SEED, i, 1234, VIEW);
      seen.add(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    }
    expect(seen.size).toBe(maxFieldCount(f));
  });

  it('② tick 이 변하면 위치가 변한다', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      const a = sampleParticle(f, SEED, 0, 0, VIEW);
      const b = sampleParticle(f, SEED, 0, 120, VIEW);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.5);
    }
  });

  it('② 카메라가 움직이면 시차만큼 위치가 변한다(화면 완전 고정 아님)', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      const a = sampleParticle(f, SEED, 0, 300, VIEW, 0, 0);
      const b = sampleParticle(f, SEED, 0, 300, VIEW, 600, 400);
      expect(f.parallax).toBeGreaterThan(0);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.5);
    }
  });

  it('③ 수명 주기를 넘어가면 되감긴다 — 5000틱 내내 패딩 사각형 안에 있고, 진행이 리셋된다', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      let resets = 0;
      let prevY = sampleParticle(f, SEED, 0, 0, VIEW).y;
      for (let tick = 1; tick <= 5000; tick += 1) {
        const p = sampleParticle(f, SEED, 0, tick, VIEW);
        // 무한 상승/낙하 금지: 패딩 포함 사각형을 절대 벗어나지 않는다.
        expect(p.x).toBeGreaterThanOrEqual(VIEW.minX - PAD_X - 1e-6);
        expect(p.x).toBeLessThanOrEqual(VIEW.maxX + PAD_X + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(VIEW.minY - PAD_Y - 1e-6);
        expect(p.y).toBeLessThanOrEqual(VIEW.maxY + PAD_Y + 1e-6);
        // 세로 진행이 한 프레임에 크게 되돌아가면 = 수명이 끝나 되감긴 순간.
        // 대역(band)이 좁은 필드는 되감김 폭도 그만큼 작으므로 대역 높이를 기준으로 본다.
        if (Math.abs(p.y - prevY) > (VIEW.maxY - VIEW.minY) * f.bandSpan * 0.5) resets++;
        prevY = p.y;
      }
      expect(resets).toBeGreaterThan(0); // 5000틱 안에 최소 한 번은 재활용된다.
    }
  });

  it('③ 되감김 지점에서도 알파가 0 으로 수렴한다(뚝 끊기는 팝 없음)', () => {
    // 수명 포락선이 sin(πu) 라 u→0,1 에서 0 이다. 여러 틱에서 최소 알파가 0 근처인지 본다.
    for (const f of ATMOSPHERE_FIELDS) {
      let minAlpha = Infinity;
      for (let tick = 0; tick < 4000; tick += 7) {
        minAlpha = Math.min(minAlpha, sampleParticle(f, SEED, 0, tick, VIEW).alpha);
      }
      expect(minAlpha).toBeLessThan(f.maxAlpha * 0.1);
    }
  });

  it('⑤ 알파·반경이 필드 상한을 절대 넘지 않는다', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      for (let i = 0; i < maxFieldCount(f); i++) {
        for (let tick = 0; tick < 2000; tick += 13) {
          const p = sampleParticle(f, SEED, i, tick, VIEW);
          expect(p.alpha).toBeGreaterThanOrEqual(0);
          expect(p.alpha).toBeLessThanOrEqual(f.maxAlpha + 1e-9);
          expect(p.radius).toBeGreaterThanOrEqual(f.minRadius - 1e-9);
          expect(p.radius).toBeLessThanOrEqual(f.maxRadius + 1e-9);
        }
      }
    }
  });

  it('비유한 입력(NaN tick·cam)에도 사각형 안의 유한값을 낸다', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      const p = sampleParticle(f, SEED, 0, Number.NaN, VIEW, Number.NaN, Infinity);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.alpha)).toBe(true);
      expect(Number.isFinite(p.radius)).toBe(true);
    }
  });

  it('세로 대역이 좁은 필드는 그 대역 밖으로 나가지 않는다(열기는 화면 아래쪽에서만 솟는다)', () => {
    const heat = fieldByName('heat');
    expect(heat.bandSpan).toBeLessThan(1);
    const fieldH = (VIEW.maxY - VIEW.minY) * (1 + 2 * 0.15);
    const bandTop = VIEW.minY - PAD_Y + fieldH * heat.bandStart;
    const bandBottom = bandTop + fieldH * heat.bandSpan;
    // 대역 상단이 화면 중앙보다 아래여야 "아래에서 온다"가 성립한다.
    expect(bandTop).toBeGreaterThan((VIEW.minY + VIEW.maxY) / 2 - 1);
    for (let i = 0; i < maxFieldCount(heat); i++) {
      for (let tick = 0; tick < 3000; tick += 11) {
        const p = sampleParticle(heat, SEED, i, tick, VIEW, 900, -1400);
        expect(p.y).toBeGreaterThanOrEqual(bandTop - 1e-6);
        expect(p.y).toBeLessThanOrEqual(bandBottom + 1e-6);
      }
    }
  });
});

describe('카르곤 대기 입자 — 티어·게이트', () => {
  it('④ 티어별 입자 수가 단조다(off ≤ min ≤ normal)', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      const off = fieldCount(f, 'off');
      const min = fieldCount(f, 'min');
      const normal = fieldCount(f, 'normal');
      expect(off).toBeLessThanOrEqual(min);
      expect(min).toBeLessThanOrEqual(normal);
      expect(off).toBe(0); // 'off' 는 문자 그대로 하나도 안 그린다.
      expect(normal).toBeGreaterThan(0);
    }
  });

  it('입자 총량이 전경을 덮지 않는 수준으로 묶여 있다(탄막 혼동·비용 상한)', () => {
    const total = ATMOSPHERE_FIELDS.reduce((s, f) => s + fieldCount(f, 'normal'), 0);
    expect(total).toBeLessThanOrEqual(80);
  });

  it('모든 필드가 파티클 3단 티어만으로 조절된다(셰이더 게이트에 묶인 필드 없음)', () => {
    // 열기는 1차에서 gates.eventShaders(고티어 전용)에 물려 있었다. 셰이더를 쓰지 않는데도
    // 셰이더 게이트에 묶여 med/low 에서 화면 기여의 절반이 통째로 사라졌다.
    for (const f of ATMOSPHERE_FIELDS) expect(fieldCount(f, 'min')).toBeGreaterThan(0);
  });
});

describe('게임플레이 가독성 — 잔불 ≠ 적탄 4대 분리축', () => {
  const ember = fieldByName('ember');

  it('① 크기: 잔불 최대 반경이 탄 표시 반경의 절반 미만(면적으로 1/4 미만)', () => {
    // 1차는 1/3 미만(2.6px)이었으나 그 크기로는 화면에서 보이지 않아 기각됐다. 2차는 상한을
    // 절반으로 완화하되, **면적비 1/4 미만**이라는 지각 기준을 함께 못박는다.
    expect(ember.maxRadius).toBe(EMBER_MAX_RADIUS);
    expect(ember.maxRadius).toBeLessThan(BULLET_DISPLAY_RADIUS / 2);
    const areaRatio = (ember.maxRadius / BULLET_DISPLAY_RADIUS) ** 2;
    expect(areaRatio).toBeLessThan(0.25);
  });

  it('② 알파: 잔불이 항상 반투명(≤0.5)이라 뒤가 비쳐 보인다 — 1차 상한을 그대로 지켰다', () => {
    expect(ember.maxAlpha).toBe(EMBER_ALPHA);
    expect(ember.maxAlpha).toBeLessThanOrEqual(0.5);
  });

  it('③ 색: 잔불은 흰 코어 없는 주황 단색 — 탄의 흰색 신호와 겹치지 않는다', () => {
    const r = (ember.tint >> 16) & 0xff;
    const g = (ember.tint >> 8) & 0xff;
    const b = ember.tint & 0xff;
    expect(r).toBeGreaterThan(200); // 따뜻한 대역
    expect(b).toBeLessThan(80); // 파랑이 거의 없다 → 흰색·청록과 확실히 분리
    expect(g).toBeLessThan(r); // 노랑이 아니라 주황
  });

  it('④ 속도: 잔불이 화면을 가로지르는 데 20초 이상 걸린다(탄은 1초 미만)', () => {
    // 2차에서 **더 벌린 축**이다(1차 10초 하한 → 20초). 크기·알파를 올린 대가를 여기서 갚는다.
    const seconds = ember.periodTicks / 60;
    expect(seconds).toBeGreaterThan(20);
  });

  it('개수도 분리축이다 — 잔불 개수를 1차에서 늘리지 않았다(탄막과 경쟁하는 유일한 축)', () => {
    expect(fieldCount(ember, 'normal')).toBeLessThanOrEqual(30);
  });

  it('밝은 알갱이 필드(잔불·재)는 탄보다 훨씬 작고 훨씬 느리다', () => {
    for (const f of [ember, fieldByName('ash')]) {
      expect(f.maxRadius).toBeLessThan(BULLET_DISPLAY_RADIUS / 1.7);
      expect(f.periodTicks / 60).toBeGreaterThan(20);
      expect(f.texture).toBe('dot');
    }
  });
});

describe('화면 기여도 — "보이는가"를 곱셈 결과로 감시한다', () => {
  it('텍스처 프로파일의 중심이 불투명하다(1차의 "중심 알파 0.61" 결함 재발 방지)', () => {
    for (const kind of ['dot', 'puff'] as const) {
      const p = textureProfile(kind);
      expect(p(0)).toBeCloseTo(1, 6); // 스프라이트 alpha 가 곧 화면 최대 불투명도여야 한다
      expect(p(1)).toBeCloseTo(0, 6); // 가장자리는 완전히 사라진다(하드 엣지 금지)
      // 중심 → 가장자리로 단조 감소(중간이 튀면 링이 보인다).
      let prev = Infinity;
      for (let i = 0; i <= 32; i++) {
        const v = p(i / 32);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    }
  });

  it('덩어리 프로파일이 알갱이 프로파일보다 원판을 훨씬 많이 채운다(면적 기여의 원천)', () => {
    const dot = profileAverageFill(dotProfile);
    const puff = profileAverageFill(puffProfile);
    expect(dot).toBeCloseTo(1 / 6, 2);
    expect(puff).toBeCloseTo(0.4, 2);
    expect(puff / dot).toBeGreaterThan(2);
  });

  it('어떤 필드도 배경과 구분되지 않는 색을 쓰지 않는다(1차 화산재 결함)', () => {
    // 1차 화산재 틴트는 0x2a2220 으로 배경(≈0x2a2422)과 채널차 합이 6 이었다 —
    // 알파를 아무리 올려도 보이지 않는 입자를 22개 그리고 있었다.
    for (const f of ATMOSPHERE_FIELDS) {
      expect(fieldDeltaRgbSum(f)).toBeGreaterThan(100);
    }
    // 모델의 기준 배경이 실제 지형 대역(어두운 암반)에 머물러 있는지도 함께 잠근다.
    expect(REFERENCE_BACKDROP.r + REFERENCE_BACKDROP.g + REFERENCE_BACKDROP.b).toBeLessThan(200);
  });

  it('⑥ 네 필드 합산 화면 기여도가 하한(3.0) 위에 있다 — 1차 실측 0.45 기각의 재발 방지', () => {
    const total = estimateAtmosphereContribution(SEED, VIEW, TICKS);
    expect(total).toBeGreaterThanOrEqual(3.0);
  });

  it('⑥ 주력 두 필드가 **각각** 하한을 넘는다(한쪽이 죽어도 합계가 가려주는 것을 막는다)', () => {
    // 합계 하한만 두면 연기를 1차 값으로 되돌려도 열기 혼자 3.0 을 넘겨 통과한다(실측 확인).
    // 공기감은 "가로로 흐르는 연무 + 아래에서 솟는 열기" 두 축이 같이 있어야 성립하므로,
    // 어느 한쪽이 사라지는 회귀는 합계와 무관하게 실패여야 한다.
    expect(estimateFieldContribution(fieldByName('smoke'), SEED, VIEW, TICKS)).toBeGreaterThan(1.2);
    expect(estimateFieldContribution(fieldByName('heat'), SEED, VIEW, TICKS)).toBeGreaterThan(1.0);
  });

  it('⑥ 그렇다고 화면을 덮지도 않는다(안개로 도망가는 것도 실패다)', () => {
    const total = estimateAtmosphereContribution(SEED, VIEW, TICKS);
    expect(total).toBeLessThan(12);
    // 비가산 베일(연기·재)의 화면 평균 알파가 5% 를 넘으면 국소 대비가 눈에 띄게 죽는다.
    let veil = 0;
    const w = VIEW.maxX - VIEW.minX;
    const h = VIEW.maxY - VIEW.minY;
    for (const f of ATMOSPHERE_FIELDS) {
      if (f.additive) continue;
      const fill = profileAverageFill(textureProfile(f.texture));
      let acc = 0;
      for (const tick of TICKS) {
        for (let i = 0; i < fieldCount(f, 'normal'); i++) {
          const p = sampleParticle(f, SEED, i, tick, VIEW);
          acc += Math.PI * p.radius * p.radius * f.aspect * p.alpha;
        }
      }
      veil += ((acc / TICKS.length) * fill * ON_SCREEN_AREA_FRACTION) / (w * h);
    }
    expect(veil).toBeLessThan(0.05);
  });

  it('⑥ 기여의 주력은 큰 부드러운 덩어리다(작고 밝은 알갱이로 밀어붙이지 않았다)', () => {
    // 가독성 논증의 핵심: 같은 기여도를 "작고 밝은 점"으로 얻으면 탄막과 경쟁하지만
    // "크고 옅은 덩어리"로 얻으면 경쟁하지 않는다. 그 배분을 코드로 고정한다.
    const puff = ATMOSPHERE_FIELDS.filter((f) => f.texture === 'puff').reduce(
      (s, f) => s + estimateFieldContribution(f, SEED, VIEW, TICKS),
      0,
    );
    const total = estimateAtmosphereContribution(SEED, VIEW, TICKS);
    expect(puff / total).toBeGreaterThan(0.9);
  });

  it('연기·열기를 옅게 되돌리면 하한이 깨진다(하한이 항진이 아님을 보인다)', () => {
    // 1차 값(연기 6개·α0.09 / 열기 4개·α0.055)으로 되돌린 가짜 필드로 재면 하한 미달이어야 한다.
    const rollback = ATMOSPHERE_FIELDS.map((f) =>
      f.name === 'smoke'
        ? { ...f, counts: { ...f.counts, normal: 6 }, maxAlpha: 0.09, maxRadius: 210, minRadius: 90 }
        : f.name === 'heat'
          ? { ...f, counts: { ...f.counts, normal: 4 }, maxAlpha: 0.055, maxRadius: 96, minRadius: 46 }
          : f,
    );
    const total = rollback.reduce((s, f) => s + estimateFieldContribution(f, SEED, VIEW, TICKS), 0);
    expect(total).toBeLessThan(3.0);
  });
});

describe('카르곤 대기 레이어 — 실제로 그린다', () => {
  /** 렌더러 없이(=테스트 환경) 굴린다. 레이어는 이 상황에서 던지면 안 된다(types.ts 계약). */
  function run(): KargonAtmosphereLayer {
    const layer = new KargonAtmosphereLayer();
    expect(layer.configure({ planet: 0, seed: SEED })).toBe(true);
    layer.resize(1920, 1080);
    layer.update({
      camX: 0,
      camY: 0,
      viewMinX: VIEW.minX,
      viewMinY: VIEW.minY,
      viewMaxX: VIEW.maxX,
      viewMaxY: VIEW.maxY,
      tick: 640,
      dt: 1 / 60,
    });
    return layer;
  }

  it('카르곤에서 켜지고, 다른 행성에서는 스스로 꺼진다', () => {
    const layer = new KargonAtmosphereLayer();
    expect(layer.configure({ planet: 1, seed: SEED })).toBe(false);
    expect(layer.configure({ planet: 0, seed: SEED })).toBe(true);
    layer.destroy();
  });

  it('update 후 보이는 스프라이트가 실제로 존재한다(빈 화면 방지)', () => {
    const layer = run();
    let visible = 0;
    for (const c of layer.view.children) {
      for (const s of (c as { children: { visible: boolean }[] }).children) {
        if (s.visible) visible++;
      }
    }
    // 기본 티어(high)에서 전 필드가 normal 밀도로 뜬다.
    const expected = ATMOSPHERE_FIELDS.reduce((s, f) => s + fieldCount(f, 'normal'), 0);
    expect(visible).toBe(expected);
    layer.destroy();
  });

  it('update 를 반복해도 자식 수가 늘지 않는다(고정 풀 — 매 프레임 할당 0)', () => {
    const layer = run();
    const count = layer.view.children.reduce(
      (s, c) => s + (c as { children: unknown[] }).children.length,
      0,
    );
    for (let t = 0; t < 200; t++) {
      layer.update({
        camX: t * 7,
        camY: -t * 3,
        viewMinX: VIEW.minX,
        viewMinY: VIEW.minY,
        viewMaxX: VIEW.maxX,
        viewMaxY: VIEW.maxY,
        tick: 640 + t,
        dt: 1 / 60,
      });
    }
    const after = layer.view.children.reduce(
      (s, c) => s + (c as { children: unknown[] }).children.length,
      0,
    );
    expect(after).toBe(count);
    layer.destroy();
  });
});

describe('카르곤 대기 — 필드 정의 위생', () => {
  it('해시 도메인 키가 서로 겹치지 않는다(겹치면 두 필드가 같은 배치를 그린다)', () => {
    const keys = ATMOSPHERE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('잔불·열기만 가산 합성이다(Pixi tint 는 곱연산이라 밝히려면 add 여야 한다)', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      expect(f.additive).toBe(f.name === 'ember' || f.name === 'heat');
      expect(f.glowSensitive).toBe(f.additive); // 발광 감소 대상 = 가산 필드
    }
  });

  it('재는 잔불과 반대 방향으로 떨어진다(대비축)', () => {
    expect(fieldByName('ember').riseUp).toBe(true);
    expect(fieldByName('ash').riseUp).toBe(false);
  });

  it('연기는 가로로 흐르고 시차가 잔불보다 작다(뒤 층)', () => {
    const smoke = fieldByName('smoke');
    expect(smoke.driftTurns).toBeGreaterThan(0);
    expect(smoke.parallax).toBeLessThan(fieldByName('ember').parallax);
  });

  it('연기가 안개가 아니라 "큰 스케일의 농도차"다 — 알파가 아니라 스케일로 잠근다', () => {
    const smoke = fieldByName('smoke');
    // 탄(반경 9px)이 걸치는 구간에서 농도가 사실상 상수여야 국소 대비가 보존된다.
    // 그러려면 연기의 **최소** 반경이 탄보다 한 자릿수 이상 커야 한다.
    expect(smoke.minRadius).toBeGreaterThan(BULLET_DISPLAY_RADIUS * 10);
    // 그 조건 아래에서 알파 상한은 중앙 한 점에만 닿는 값이다. 0.3 을 넘으면 베일이 된다.
    expect(smoke.maxAlpha).toBeLessThanOrEqual(0.3);
  });

  it('세기 수치가 튜닝 블록 한 곳에서만 온다(통합 후 재조정 시 고칠 자리가 하나)', () => {
    for (const f of ATMOSPHERE_FIELDS) {
      const t = ATMOSPHERE_TUNING[f.name as keyof typeof ATMOSPHERE_TUNING];
      expect(t).toBeDefined();
      expect(f.counts.normal).toBe(t.count);
      expect(f.counts.min).toBe(t.countMin);
      expect(f.minRadius).toBe(t.minRadius);
      expect(f.maxRadius).toBe(t.maxRadius);
      expect(f.maxAlpha).toBe(t.alpha);
    }
  });
});
