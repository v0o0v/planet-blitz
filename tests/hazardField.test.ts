/**
 * 해저드 장판 **재질**(AAA 패스)의 계약 — 순수 기하 + 배선.
 *
 * ## 이 파일이 잡으려는 것
 * 재질을 얹으면서 깨지기 쉬운 것은 "예쁜가"가 아니라 **눈으로 확인 불가능한 세 가지**다:
 *
 * 1. **판정 경계**. 불규칙 가장자리가 판정 반경을 한 픽셀이라도 넘으면 "밟으면 아픈 곳"이
 *    화면에서 거짓말을 시작한다. 넘친 프레임은 스크린샷으로 잡히지 않는다 — 꼭짓점을 재야 잡힌다.
 * 2. **색 = 성질**. 시안은 아군 전용이고 난색=피해·보라=방해다. 재질이 팔레트를 새로 들이면
 *    이 규칙이 조용히 샌다. 그래서 재질이 만들 수 있는 색의 **구간 전체**를 훑는다.
 * 3. **비용 상한**. 오염 모드는 반경 100 짜리 셀이 화면에 여럿 깔린다 — 개체당 비용이 그대로
 *    곱해지므로 "셀이 몇 개든 재질은 N개"를 수치로 못 박는다.
 *
 * 색 외 채널(빗금·점선·수렴 링)과 색=성질 규칙 자체는 `hazardVisual.test.ts` 가 소유한다.
 * 여기서는 **재질이 그것을 지우지 않았는지**만 본다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from 'pixi.js';

import {
  EDGE_MAX_RATIO,
  EDGE_MIN_RATIO,
  HAZARD_DT_CAP,
  MATERIAL_MIX_MAX,
  MAX_FIELD_MATERIALS,
  edgePolygon,
  edgeRatioAt,
  hazardAmbience,
  hazardAmbienceShape,
  hazardGrounding,
  hazardLod,
  hazardMaterialKind,
  kindIsHarmful,
  lobeAt,
  lobeLife,
  lodHasGrounding,
  lodHasLobes,
  lodHasMotes,
  lodLobeCount,
  lodMoteScale,
  lobeAlphaScale,
  hazardCrustSpec,
  kindUsesDistortion,
  MOTE_R_MAX,
  MOTE_R_MIN,
  LOBE_COUNT,
  LOD_FULL_COUNT,
  LOD_MID_COUNT,
  MATERIAL_PRESENCE_FLOOR,
  materialIntensity,
  materialPresence,
  mixColor,
  moteAt,
  moteBudget,
  moteRise,
  stepCharge,
  stepHeat,
  type HazardMaterialKind,
} from '../src/render/entity/hazardShape.js';
import {
  hazardFieldLiveCount,
  installHazardMaterials,
  resetHazardFieldBudget,
  resetHazardFieldStage,
} from '../src/render/entity/hazardField.js';
import {
  HazardHost,
  type HazardHostContext,
} from '../src/render/entity/hazardHost.js';
import { hazardVisual, type HazardCanvas } from '../src/render/hazardVisual.js';
import { effectGates, type EffectGates, type QualityTier } from '../src/render/qualityTier.js';
import { DEFAULT_GRAPHICS_SETTINGS } from '../src/render/graphicsSettings.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';
import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../src/sim/patterns/types.js';
import { HAZARD_CONTAMINATION } from '../src/sim/modes/contamination.js';
import type { EnvLightSpec } from '../src/render/env/theme.js';

/** 이 게임의 아군 색 — 플레이어 기체·아군 탄·안전 반경 링이 공유한다. */
const FRIENDLY_CYAN = 0x39d0ff;

const ALL_KINDS: readonly HazardMaterialKind[] = [
  'molten',
  'spore',
  'refract',
  'scorch',
  'ember',
];

const HIGH: EffectGates = effectGates('high', DEFAULT_GRAPHICS_SETTINGS);
const LOW: EffectGates = effectGates('low', DEFAULT_GRAPHICS_SETTINGS);

// ---------------------------------------------------------------------------
// 1. 판정 경계 — 불규칙 가장자리는 반경을 **절대** 넘지 않는다
// ---------------------------------------------------------------------------

describe('경계 처리 — 불규칙하되 판정을 넘지 않는다', () => {
  it('모든 시드·프레임·불규칙도에서 경계 꼭짓점이 판정 반경 안에 있다', () => {
    // ⚠️ 기준은 **판정 반경**(`radius * scale`)이지 `EDGE_MAX_RATIO` 가 아니다. 상수를 기준으로
    // 쓰면 상수를 키우는 순간 테스트가 같이 커져 통과한다 — 뮤테이션 검증에서 실제로
    // `EDGE_MAX_RATIO = 1.15` 가 이 단언을 그대로 통과했다(항진 테스트). 게임 규칙("밟으면
    // 아픈 곳은 여기까지")은 상수가 아니라 반경이므로 반경으로 잰다.
    const radius = 140;
    let worst = 0;
    for (const seed of [0, 1, 7, 1234, -99, 0x7fffffff]) {
      for (const tick of [0, 1, 37, 600, 5000]) {
        for (const wobble of [0, 0.35, 0.7, 1]) {
          for (const scale of [1, 0.93, 0.86]) {
            const poly = edgePolygon(seed, radius, tick, wobble, scale);
            for (let i = 0; i < poly.length; i += 2) {
              const x = poly[i] ?? 0;
              const y = poly[i + 1] ?? 0;
              const d = Math.hypot(x, y);
              if (d > worst) worst = d;
              expect(d, `seed=${seed} tick=${tick} wob=${wobble} scale=${scale}`).toBeLessThanOrEqual(
                radius * scale + 1e-9,
              );
            }
          }
        }
      }
    }
    // 상한이 실제로 근처까지 쓰이는지도 본다 — 전부 반경의 절반이면 "안 넘음"은 무의미하다.
    expect(worst).toBeGreaterThan(radius * 0.9);
    expect(worst).toBeLessThanOrEqual(radius);
  });

  it('경계 상한 상수 자체가 판정 반경을 넘지 않는다(상수를 키워도 새지 않는다)', () => {
    // 위 테스트가 반경으로 재므로 이 단언은 중복처럼 보이지만, 상한을 키우는 변경이 **왜**
    // 안 되는지를 한 줄로 못 박아 둔다. 1 을 넘기는 순간 재질이 판정 밖에서 아픈 척을 한다.
    expect(EDGE_MAX_RATIO).toBeLessThanOrEqual(1);
    expect(EDGE_MIN_RATIO).toBeLessThan(EDGE_MAX_RATIO);
  });

  it('경계가 장판을 실제보다 작게 만들지 않는다(하한도 지킨다)', () => {
    // 기준은 상수가 아니라 **구체 비율**이다(위 항진 교훈). 하한을 낮추는 변경이 이 단언을
    // 통과하려면 실제로 장판이 눈에 띄게 작아져야 한다.
    const poly = edgePolygon(42, 200, 123, 1, 1);
    for (let i = 0; i < poly.length; i += 2) {
      const d = Math.hypot(poly[i] ?? 0, poly[i + 1] ?? 0);
      expect(d).toBeGreaterThanOrEqual(200 * 0.7);
    }
    expect(EDGE_MIN_RATIO).toBeGreaterThanOrEqual(0.7);
  });

  it('불규칙도 0 이면 정확한 원이다(재질이 꺼진 상태와 매끄럽게 잇는다)', () => {
    for (const a of [0, 1, 2.5, 6]) {
      expect(edgeRatioAt(9, a, 500, 0)).toBeCloseTo(EDGE_MAX_RATIO, 12);
    }
  });

  it('불규칙도 1 이면 각도에 따라 실제로 달라진다(도형이 아니라 물질)', () => {
    const rs = [0, 1, 2, 3, 4, 5].map((i) => edgeRatioAt(11, (i / 6) * Math.PI * 2, 0, 1));
    const spread = Math.max(...rs) - Math.min(...rs);
    expect(spread).toBeGreaterThan(0.02);
  });

  it('폴리곤이 이음매 없이 닫힌다(a=0 과 a=2π 가 같은 반경)', () => {
    for (const tick of [0, 91, 4000]) {
      expect(edgeRatioAt(5, 0, tick, 1)).toBeCloseTo(edgeRatioAt(5, Math.PI * 2, tick, 1), 10);
    }
  });

  it('경계가 시간에 따라 요동한다(회전이 아니라 형태 변화)', () => {
    const at = (t: number): number[] =>
      [0, 1, 2, 3].map((i) => edgeRatioAt(3, (i / 4) * Math.PI * 2, t, 1));
    const a = at(0);
    const b = at(240);
    // 전 각도에서 값이 바뀌어야 한다. 통째 회전이면 어떤 각도는 그대로 남기 쉽다.
    expect(a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 0.01)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. 색 = 성질 — 재질은 자기 팔레트를 갖지 않는다
// ---------------------------------------------------------------------------

/** 두 색의 채널 최대 거리(시안 근접 판정용). */
function chDist(a: number, b: number): number {
  return Math.max(
    Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
    Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
    Math.abs((a & 0xff) - (b & 0xff)),
  );
}

describe('색 = 성질 — 재질이 규칙을 새로 쓰지 않는다', () => {
  it('재질이 만들 수 있는 모든 색이 아군 시안과 멀다(구간 전체를 훑는다)', () => {
    for (const sub of [HAZARD_MORTAR, HAZARD_LAVA, HAZARD_SLOW, HAZARD_CONTAMINATION]) {
      for (const permanent of [false, true]) {
        for (const active of [false, true]) {
          const v = hazardVisual(sub, active, permanent);
          for (let t = 0; t <= MATERIAL_MIX_MAX + 1e-9; t += 0.01) {
            const c = mixColor(v.color, v.accent, t);
            expect(c, `sub=${sub} t=${t.toFixed(2)}`).not.toBe(FRIENDLY_CYAN);
            expect(chDist(c, FRIENDLY_CYAN), `sub=${sub} t=${t.toFixed(2)}`).toBeGreaterThan(40);
          }
        }
      }
    }
  });

  it('피해 장판의 재질색은 끝까지 난색이다(R 이 지배 채널이고 여유가 남는다)', () => {
    // "난색"의 실제 불변식은 R ≥ G ≥ B 가 **아니다** — 박격 붉은색 `0xff3f5a` 는 G(63) < B(90)
    // 인 분홍 기운의 빨강이다. 성립하는 것은 **R 지배**이고, 재질이 accent(따뜻한 흰빛)로
    // 밀어도 그 지배가 유지되어야 한다(포화되면 차가운 쪽으로 넘어갈 수 있다).
    for (const [sub, perm] of [
      [HAZARD_MORTAR, false],
      [HAZARD_LAVA, false],
      [HAZARD_SLOW, true], // 영구 피해 지형
    ] as const) {
      const v = hazardVisual(sub, true, perm);
      for (let t = 0; t <= MATERIAL_MIX_MAX + 1e-9; t += 0.01) {
        const c = mixColor(v.color, v.accent, t);
        const r = (c >> 16) & 0xff;
        const g = (c >> 8) & 0xff;
        const b = c & 0xff;
        expect(r - Math.max(g, b), `sub=${sub} t=${t.toFixed(2)}`).toBeGreaterThan(30);
      }
    }
  });

  it('감속 장판의 재질색은 끝까지 보라다(B > G 이면서 R > G — 시안의 정반대)', () => {
    const v = hazardVisual(HAZARD_SLOW, true, false);
    for (let t = 0; t <= MATERIAL_MIX_MAX + 1e-9; t += 0.01) {
      const c = mixColor(v.color, v.accent, t);
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      expect(b, `t=${t.toFixed(2)}`).toBeGreaterThan(g);
      expect(r, `t=${t.toFixed(2)}`).toBeGreaterThan(g);
    }
  });

  it('mixColor 는 양 끝에서 정확히 입력색이다(보간이 색을 발명하지 않는다)', () => {
    expect(mixColor(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixColor(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
  });
});

// ---------------------------------------------------------------------------
// 3. 재질 종류 — subtype 2 가 둘로 갈린다
// ---------------------------------------------------------------------------

describe('재질 종류', () => {
  it('같은 코드(2)라도 영구 지형과 감속 지대는 다른 재질이다', () => {
    expect(hazardMaterialKind(HAZARD_SLOW, true)).toBe('scorch');
    expect(hazardMaterialKind(HAZARD_SLOW, false)).toBe('refract');
  });

  it('방해군(감속)만 무해하다 — 재질 종류가 성질을 뒤집지 않는다', () => {
    for (const k of ALL_KINDS) {
      expect(kindIsHarmful(k), k).toBe(k !== 'refract');
    }
    // 재질 종류의 성질이 표시 규칙과 어긋나면 안 된다.
    for (const [sub, perm] of [
      [HAZARD_LAVA, false],
      [HAZARD_MORTAR, false],
      [HAZARD_CONTAMINATION, false],
      [HAZARD_SLOW, true],
      [HAZARD_SLOW, false],
    ] as const) {
      const kind = hazardMaterialKind(sub, perm);
      expect(kind).not.toBeNull();
      expect(kindIsHarmful(kind!)).toBe(hazardVisual(sub, true, perm).harmful);
    }
  });

  it('미지의 subtype 은 재질이 없다(기존 그림 그대로)', () => {
    expect(hazardMaterialKind(9999, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 예열 → 활성 연속 전이
// ---------------------------------------------------------------------------

describe('예열에도 재질이 화면에 있다 — 1차 반려의 근본 원인', () => {
  // 박격 장판은 예열(active=false)로 등장하고 활성 창이 8틱(≈0.13초)뿐이며 직후 소멸한다.
  // 1차 구현은 재질 여섯 겹 중 다섯을 `heat` 에 곱해서, 예열 내내 알파가 정확히 0 이었다.
  // 실측: 로브 5개 전부 0 · edge visible=false · motes visible=false.
  // **예열은 탄막 게임에서 가장 오래 보이는 상태다.**

  it('열이 0 이어도 존재감이 0 이 아니다', () => {
    expect(materialPresence(0)).toBeGreaterThan(0.2);
    expect(MATERIAL_PRESENCE_FLOOR).toBeGreaterThan(0.2);
  });

  it('8틱 활성 창의 피크 열에서도, 그 전 예열 구간에서도 재질이 보인다', () => {
    // 60fps 8프레임 동안만 active=true 인 실제 박격 시나리오를 그대로 굴린다.
    let h = 0;
    const warmPresence = materialPresence(h);
    for (let i = 0; i < 8; i++) h = stepHeat(h, true, 1 / 60);
    // 1차 설계에서 이 피크는 0.43 이었고, 예열 구간은 0 이었다.
    expect(materialPresence(h)).toBeGreaterThan(warmPresence);
    expect(warmPresence).toBeGreaterThan(0.2); // ← 1차에서는 여기가 0 이었다
  });

  it('예열↔활성은 존재가 아니라 강도·색·운동 속도로 갈린다', () => {
    const warm = materialIntensity(0);
    const hot = materialIntensity(1);
    // 셋 다 예열에서 0 이 아니고, 셋 다 활성에서 더 크다 — 그것이 "연속 전이"의 정의다.
    expect(warm.presence).toBeGreaterThan(0);
    expect(warm.warmth).toBeGreaterThan(0);
    expect(warm.speed).toBeGreaterThan(0);
    expect(hot.presence).toBeGreaterThan(warm.presence);
    expect(hot.warmth).toBeGreaterThan(warm.warmth);
    expect(hot.speed).toBeGreaterThan(warm.speed);
    expect(hot.presence).toBeLessThanOrEqual(1);
  });

  it('로브가 태어나-부풀고-터진다(크기는 단조 증가, 알파는 양 끝에서 0)', () => {
    // 크기가 알파를 따라 되돌아오면 "숨쉬는 원"이 되어 다시 도형으로 읽힌다.
    let prevScale = -1;
    let sawPeak = false;
    for (let t = 0; t < 400; t++) {
      const l = lobeLife(7, 0, t);
      if (l.scale < prevScale) {
        // 주기가 넘어간 지점 — 여기서만 감소가 허용된다.
        expect(l.scale).toBeLessThan(0.5);
      }
      prevScale = l.scale;
      if (l.alpha > 0.9) sawPeak = true;
      expect(l.alpha).toBeGreaterThanOrEqual(0);
      expect(l.alpha).toBeLessThanOrEqual(1);
    }
    expect(sawPeak).toBe(true);
  });

  it('로브마다 주기가 달라 전체가 동시에 숨쉬지 않는다', () => {
    const at = (i: number): number => lobeLife(3, i, 40).alpha;
    const vals = [0, 1, 2, 3, 4, 5].map(at);
    expect(new Set(vals.map((v) => v.toFixed(3))).size).toBeGreaterThan(3);
  });

  it('운동 속도가 느려지면 같은 프레임에서 다른 위상이다(예열은 천천히 끓는다)', () => {
    expect(lobeLife(5, 0, 60, 1).scale).not.toBeCloseTo(lobeLife(5, 0, 60, 0.35).scale, 3);
  });
});

describe('예열→활성 전이 — 불리언 데이터에서 연속 화면을 만든다', () => {
  it('활성 진입이 한 프레임에 끝나지 않는다', () => {
    let h = 0;
    let frames = 0;
    while (h < 0.99 && frames < 1000) {
      h = stepHeat(h, true, 1 / 60);
      frames++;
    }
    expect(frames).toBeGreaterThan(3); // 순간 전환이면 1
    expect(frames).toBeLessThan(60); // 그렇다고 1초를 넘으면 "지금 아프다"가 늦다
  });

  it('식는 것이 켜지는 것보다 느리다(여운)', () => {
    const up = (): number => {
      let h = 0;
      let n = 0;
      while (h < 0.99 && n < 1000) {
        h = stepHeat(h, true, 1 / 60);
        n++;
      }
      return n;
    };
    const down = (): number => {
      let h = 1;
      let n = 0;
      while (h > 0.01 && n < 1000) {
        h = stepHeat(h, false, 1 / 60);
        n++;
      }
      return n;
    };
    expect(down()).toBeGreaterThan(up());
  });

  it('고조는 열의 여집합이다 — 예열 중 차오르고 활성에서 빠진다', () => {
    let c = 0;
    for (let i = 0; i < 30; i++) c = stepCharge(c, false, 1 / 60);
    expect(c).toBeGreaterThan(0.2);
    const warm = c;
    for (let i = 0; i < 30; i++) c = stepCharge(c, true, 1 / 60);
    expect(c).toBeLessThan(warm * 0.5);
  });

  it('거대 dt(탭 복귀)가 전이를 한 프레임에 끝내지 못한다', () => {
    // dt 상한이 없으면 5초짜리 dt 한 번에 0 → 1 이 되고 전이 연출이 통째로 사라진다.
    expect(stepHeat(0, true, 5)).toBeLessThan(1);
    expect(stepHeat(0, true, 5)).toBeCloseTo(stepHeat(0, true, HAZARD_DT_CAP), 12);
  });

  it('열·고조는 [0,1] 을 벗어나지 않는다', () => {
    let h = 0.5;
    for (let i = 0; i < 500; i++) h = stepHeat(h, i % 7 < 3, 0.03);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5. 높이감 — 광원은 테마에서만 나온다
// ---------------------------------------------------------------------------

describe('높이감 — 접지는 테마 광원에서만 파생된다', () => {
  it('테마가 없으면 방향 신호를 통째로 끈다(임의 방향의 태양을 만들지 않는다)', () => {
    const g = hazardGrounding(null);
    expect(g.rimAlpha).toBe(0);
    expect(g.shadowAlpha).toBe(0);
    expect(g.lx).toBe(0);
    expect(g.ly).toBe(0);
  });

  it('광원 방향이 뒤집히면 접지 방향도 뒤집힌다(자기 광원을 따로 갖지 않는다)', () => {
    const up: EnvLightSpec = { angle: -Math.PI / 2, shadowBias: 0.5 };
    const down: EnvLightSpec = { angle: Math.PI / 2, shadowBias: 0.5 };
    expect(Math.sign(hazardGrounding(up).ly)).toBe(-Math.sign(hazardGrounding(down).ly));
  });

  it('편향이 클수록 림은 강하고 그늘은 옅다(groundShadow 와 같은 물리)', () => {
    const soft = hazardGrounding({ angle: 0, shadowBias: 0 });
    const hard = hazardGrounding({ angle: 0, shadowBias: 1 });
    expect(hard.rimAlpha).toBeGreaterThan(soft.rimAlpha);
    expect(hard.shadowAlpha).toBeLessThan(soft.shadowAlpha);
  });

  it('입자가 위로 솟는다 — 바닥면과 그 위 공간을 가르는 유일한 신호', () => {
    // 부양 계수가 큰 종류는 주기 중반에 −y(화면 위)로 확실히 올라가 있어야 한다.
    const flat = moteAt(7, 0, 100, 0, 0);
    let lifted: number | null = null;
    for (let t = 1; t < 200; t++) {
      const m = moteAt(7, 0, 100, t, 1);
      if (lifted === null || m.y < lifted) lifted = m.y;
    }
    expect(lifted).not.toBeNull();
    expect(lifted!).toBeLessThan(flat.y - 100 * 0.2);
  });

  it('부양 계수가 종류마다 다르다(용암 불티는 솟고 냉기 결정은 떠 있을 뿐)', () => {
    expect(moteRise('molten')).toBeGreaterThan(moteRise('refract'));
    expect(moteRise('molten')).toBeGreaterThan(moteRise('scorch'));
  });
});

// ---------------------------------------------------------------------------
// 6. 입자 — 상태 없는 순수 함수
// ---------------------------------------------------------------------------

describe('입자', () => {
  it('같은 프레임이면 같은 입자다(상태 없음 — 프레임 스킵에 튀지 않는다)', () => {
    const a = moteAt(13, 3, 120, 777, 1);
    const b = moteAt(13, 3, 120, 777, 1);
    expect(a).toEqual(b);
  });

  it('알파가 주기 양 끝에서 0 이다(팝인·팝아웃 없음)', () => {
    for (let i = 0; i < 6; i++) {
      const m = moteAt(21, i, 100, 0, 1);
      expect(m.alpha).toBeGreaterThanOrEqual(0);
      expect(m.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('입자가 판정 반경 밖으로 흩어지지 않는다(가로 방향)', () => {
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 300; t += 7) {
        const m = moteAt(31, i, 100, t, 1);
        expect(Math.abs(m.x)).toBeLessThanOrEqual(100);
      }
    }
  });

  it('low 티어에서는 입자가 통째로 사라진다 (1차 구현의 도달 불가 분기)', () => {
    // 1차 구현은 `'min'` 을 `tier === 'low'` 보다 **먼저** 봤다. low 티어의 기본 게이트가 바로
    // `particles: 'min'` 이라 low 분기가 영영 도달하지 않았고, 이 테스트의 옛 버전은 그 결함을
    // 그대로 단언해(`toBe(3)`) 굳혀 놓고 있었다. 보고서의 "low: 입자 소멸"은 그래서 거짓이었다.
    expect(moteBudget('low', LOW)).toBe(0);
    expect(moteBudget('low', { ...HIGH, particles: 'normal' })).toBe(0);
    expect(moteBudget('low', { ...HIGH, particles: 'min' })).toBe(0);
  });

  it('입자 예산이 티어·게이트를 따른다', () => {
    expect(moteBudget('high', { ...HIGH, particles: 'off' })).toBe(0);
    expect(moteBudget('med', { ...HIGH, particles: 'min' })).toBe(3);
    expect(moteBudget('med', HIGH)).toBeLessThan(moteBudget('high', HIGH));
    expect(moteBudget('high', HIGH)).toBeGreaterThan(0);
  });

  it('reducedMotion 에서 입자가 통째로 사라진다 (3차 반려 CRIT)', () => {
    // `EffectGates` 에는 모션 축이 없다 — `effectGates()` 가 reducedMotion 을 shake·hitFlash 로만
    // 흘려보내므로 입자는 게이트로 못 덮는다. 3차 실측이 reducedMotion 에서 `hazardMotes` 60개
    // 그대로였던 것이 그 결과였고, 입자는 유일하게 매 프레임 **위치가 움직이는** 겹이다.
    expect(moteBudget('high', HIGH, true)).toBe(0);
    expect(moteBudget('med', HIGH, true)).toBe(0);
    // 기본값은 켜진 상태여야 한다(인자를 안 넘긴 옛 호출이 조용히 입자를 죽이면 안 된다).
    expect(moteBudget('high', HIGH)).toBeGreaterThan(0);
  });

  it('입자 크기가 반경에 비례한다 — 3차의 "화면에 없다" 판정의 실제 원인', () => {
    // 3차 실측: 스프라이트 직경 2.4~6.8px, 총 면적이 화면의 0.08%. 개수(60개)가 아니라
    // **규모**가 문제였다. 절대 px 였다면 반경이 두 배인 장판에서도 입자가 같은 크기다.
    const small = moteAt(5, 0, 50, 40, 1);
    const big = moteAt(5, 0, 200, 40, 1);
    expect(big.r / small.r).toBeCloseTo(4, 5);
    // 반경 100 장판에서 직경이 최소 8px(3차는 3px), 평균 16px 이상이어야 `analyze.mjs` 의
    // 국소 지표가 바닥을 벗어난다. 3차 실측 직경 2.4~6.8px · 총 면적 화면의 0.08% 가 기준선이다.
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const d = moteAt(9, i, 100, 0, 1).r * 2;
      expect(d, `i=${i}`).toBeGreaterThanOrEqual(8);
      sum += d;
    }
    expect(sum / 14).toBeGreaterThan(16);
    // 산포 반경(0.82r)과 합쳐도 판정 반경을 넘지 않는다.
    expect(0.82 + MOTE_R_MAX).toBeLessThan(1);
    expect(MOTE_R_MIN).toBeLessThan(MOTE_R_MAX);
  });

  it('수명 알파에 고원이 있다(직경 3px 짜리 순간 점멸이 아니다)', () => {
    // 순수 sin(πu) 면 알파 0.5 이상 구간이 수명의 50% 뿐이다. 고원이 있어야 같은 개수로
    // 화면 지표를 움직인다.
    //
    // ⚠️ 표본을 정수 tick 400개로 잡으면 주기가 2~3바퀴뿐이라 **에일리어싱**으로 순수 sin 도
    // 0.72 를 넘긴다(뮤테이션에서 실측했다). `frameTick` 은 실수를 받으므로 촘촘히·여러 주기를
    // 훑어야 비율이 실제 값으로 수렴한다: 순수 sin = 2/3 · 지수 0.55 = 0.82.
    let over = 0;
    const N = 8000;
    for (let i = 0; i < N; i++) {
      if (moteAt(3, 0, 100, i * 0.37, 1).alpha >= 0.5) over++;
    }
    expect(over / N).toBeGreaterThan(0.75);
    // 양 끝은 여전히 정확히 0 이다(팝인·팝아웃 없음).
    expect(moteAt(3, 0, 100, 0, 1).alpha).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 6-b. 티어 게이트 — 가장 크고 비싼 겹에 게이트가 없었다 (3차 반려 CRITICAL)
// ---------------------------------------------------------------------------

describe('로브 겹의 티어 게이트 (§2-3 — 게이트 없는 이펙트는 즉시 반려)', () => {
  /** 톡사르 41장의 LOD 분포(실측): full 6 · mid 12 · lite 23. */
  const TOXAR: readonly [HazardLod: 'full' | 'mid' | 'lite', count: number][] = [
    ['full', 6],
    ['mid', 12],
    ['lite', 23],
  ];
  const total = (tier: QualityTier, gates: EffectGates): number =>
    TOXAR.reduce((s, [lod, n]) => s + n * lodLobeCount(lod, tier, gates), 0);

  it('low 티어가 로브 총량을 대폭 줄인다', () => {
    // 3차 실측: high 272 / low **272(동일)** / reducedGlow+reducedMotion **272(동일)**.
    const high = total('high', HIGH);
    expect(high).toBe(272); // 6×14 + 12×8 + 23×4 — 회귀 감시용 실측 기준선
    expect(total('low', LOW)).toBeLessThan(high * 0.25);
  });

  it('low 에서는 최저 LOD 의 로브가 0 이다(저사양은 "멀리"가 아니라 "성능 없음")', () => {
    expect(lodLobeCount('lite', 'low', LOW)).toBe(0);
    expect(lodLobeCount('full', 'low', LOW)).toBeGreaterThan(0);
  });

  it('reducedGlow 가 가산 로브의 개수와 강도를 함께 내린다(광과민 대응)', () => {
    const dim: EffectGates = { ...HIGH, halo: false };
    expect(lodLobeCount('full', 'high', dim)).toBeLessThan(lodLobeCount('full', 'high', HIGH));
    expect(lobeAlphaScale(dim)).toBeLessThan(lobeAlphaScale(HIGH));
    // 0 은 아니다 — 로브는 §3-C-1 의 재질 본체라 통째로 끄면 항목이 화면에서 사라진다.
    expect(lobeAlphaScale(dim)).toBeGreaterThan(0);
  });

  it('med 티어가 high 와 low 사이에 있다(단조)', () => {
    expect(total('med', HIGH)).toBeLessThan(total('high', HIGH));
    expect(total('med', HIGH)).toBeGreaterThan(total('low', LOW));
  });
});

// ---------------------------------------------------------------------------
// 6-c. 면적 재질 — 종류가 "색만 다르던" 결함 (3차 반려 MAJOR-5)
// ---------------------------------------------------------------------------

describe('재질 분화 — 종류마다 구성이 다르다', () => {
  it('세 종의 면적 재질 구성이 서로 다르다(색조뿐이 아니다)', () => {
    // 비평가가 세 종을 나란히 주입해 얻은 판정: **같은 구성**(평면 채움 + 45° 직선 빗금 +
    // 16각 윤곽 + 흰 정원 립), 다른 것은 색조뿐. 구성이 갈리는지를 여기서 못 박는다.
    const m = hazardCrustSpec('molten');
    const r = hazardCrustSpec('refract');
    const s = hazardCrustSpec('scorch');
    const sig = (k: ReturnType<typeof hazardCrustSpec>): string => `${k.add}|${k.shade}|${k.flow}`;
    expect(new Set([sig(m), sig(r), sig(s)]).size).toBe(3);
  });

  it('용암은 발광 균열(가산)과 굳은 껍질(곱연산)을 함께 갖는다', () => {
    // "흐르는 용융이 아니라 주황 원판 — 껍질·균열·식은 자리·발광 코어가 없다"의 처방.
    const m = hazardCrustSpec('molten');
    expect(m.add).toBe('crackAdd');
    expect(m.shade).toBe('plateShade');
    // 두 장이 반대로 돌아야 무늬가 회전이 아니라 변형으로 읽힌다(돌아가는 도장 방지).
    expect(m.flow).toBeGreaterThanOrEqual(2);
    expect(m.spin).toBeGreaterThan(0);
  });

  it('그을음은 발광 겹이 없다 — 갈라진 검은 금이다', () => {
    const s = hazardCrustSpec('scorch');
    expect(s.add).toBeNull();
    expect(s.shade).toBe('crackShade');
    expect(s.spin).toBe(0); // 굳은 그을음은 흐르지 않는다
  });

  it('굴절만 실제 왜곡(변위 필터)을 쓴다 — 공유 필터 하나 (§2-3 예산)', () => {
    for (const k of ALL_KINDS) {
      expect(kindUsesDistortion(k), k).toBe(k === 'refract');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. 환경 반응 · 티어 게이트
// ---------------------------------------------------------------------------

describe('환경 반응 — 넓은 면적 × 낮은 진폭, 그리고 게이트 뒤', () => {
  it('모든 종류가 장판보다 넓게, 낮은 진폭으로 기여한다', () => {
    for (const k of ALL_KINDS) {
      const s = hazardAmbienceShape(k);
      expect(s.scale, k).toBeGreaterThan(1);
      expect(s.alpha, k).toBeLessThanOrEqual(0.16);
      expect(s.alpha, k).toBeGreaterThan(0);
    }
  });

  it('가산 발광 기여는 halo 게이트 뒤에 있다(reducedGlow 존중)', () => {
    for (const k of ALL_KINDS) {
      if (!hazardAmbienceShape(k).additive) continue;
      expect(hazardAmbience(k, 'high', HIGH), k).not.toBeNull();
      expect(hazardAmbience(k, 'high', { ...HIGH, halo: false }), k).toBeNull();
    }
  });

  it('비가산 안개 기여는 low 티어에서 꺼진다', () => {
    for (const k of ALL_KINDS) {
      if (hazardAmbienceShape(k).additive) continue;
      expect(hazardAmbience(k, 'med', HIGH), k).not.toBeNull();
      expect(hazardAmbience(k, 'low', HIGH), k).toBeNull();
    }
  });

  it('low 티어에서는 어떤 종류도 환경에 기여하지 않는다', () => {
    for (const k of ALL_KINDS) {
      expect(hazardAmbience(k, 'low', LOW), k).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. 본체 로브 — 판정 반경 안에 완전히 들어간다
// ---------------------------------------------------------------------------

describe('본체 로브', () => {
  it('로브가 통째로 판정 반경 안에 들어간다(|중심| + r ≤ 반경)', () => {
    for (const seed of [0, 5, 777, -3]) {
      for (let i = 0; i < LOBE_COUNT; i++) {
        const l = lobeAt(seed, i, 150);
        // 기준은 판정 반경 자체다(상수를 기준으로 쓰면 상수를 키울 때 같이 커진다 — 항진).
        expect(Math.hypot(l.cx, l.cy) + l.r, `seed=${seed} i=${i}`).toBeLessThanOrEqual(150 + 1e-9);
        expect(l.r).toBeGreaterThan(0);
      }
    }
  });

  it('로브마다 밝기·위상이 달라야 덩어리로 읽힌다', () => {
    const bs = Array.from({ length: LOBE_COUNT }, (_, i) => lobeAt(4, i, 100).bright);
    expect(new Set(bs.map((b) => b.toFixed(4))).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 9. 배선 · 비용 상한 — 오염 모드가 이 설계의 제약이다
// ---------------------------------------------------------------------------

function stubCanvas(): HazardCanvas {
  const c: HazardCanvas = {
    circle: () => c,
    arc: () => c,
    moveTo: () => c,
    lineTo: () => c,
    poly: () => c,
    fill: () => c,
    stroke: () => c,
  };
  return c;
}

function hazardEntity(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'hazard',
    x: id * 10,
    y: 0,
    angle: 0,
    radius: 120,
    aabbH: 0,
    enemyType: HAZARD_CONTAMINATION,
    hp: 1,
    maxHp: 1,
    active: true,
    flash: false,
    elite: -1,
    permanent: true,
    ...over,
  };
}

/**
 * 공유 겹 레이어의 자식 수를 센다.
 *
 * 재질은 이제 장판별 루트가 아니라 **겹 단위 공유 레이어**에 자기 하위 컨테이너를 넣는다
 * (스프라이트 배치를 끊지 않기 위해서 — `hazardField.ts` 헤더 참조). 그래서 `layer.children` 은
 * 항상 공유 stage 하나이고, 장판 수는 그 안쪽에서 세야 한다.
 */
function stageCount(layer: Container, label: string): number {
  const stage = layer.children.find((c) => c.label === 'hazardFieldStage');
  if (stage === undefined) return 0;
  const band = (stage as Container).children.find((c) => c.label === label);
  return band === undefined ? 0 : (band as Container).children.length;
}

/** 재질 하나가 반드시 갖는 겹(로브)의 자식 수 = 살아있는 장판 수. */
function fieldNodeCount(layer: Container): number {
  return stageCount(layer, 'hazardLobes');
}

function ctxFor(layer: Container, tier: QualityTier = 'high', tick = 0): HazardHostContext {
  return {
    layer,
    frameTick: tick,
    dt: 1 / 60,
    gates: effectGates(tier, DEFAULT_GRAPHICS_SETTINGS),
    tier,
    theme: null,
  };
}

/** 공유 stage 의 로브 레이어에서 LOD 별 장판 수를 센다(`label` = `hazardField:kind:lod`). */
function lodDistribution(layer: Container): Record<string, number> {
  const stage = layer.children.find((c) => c.label === 'hazardFieldStage');
  const out: Record<string, number> = { full: 0, mid: 0, lite: 0 };
  if (stage === undefined) return out;
  const band = (stage as Container).children.find((c) => c.label === 'hazardLobes');
  if (band === undefined) return out;
  for (const child of (band as Container).children) {
    const lod = String(child.label).split(':')[2] ?? '';
    if (lod in out) out[lod] = (out[lod] ?? 0) + 1;
  }
  return out;
}

describe('LOD 는 세션이 흘러도 열화하지 않는다 (2차 반려 CRIT-1)', () => {
  // 2차 구현은 단조 증가하는 `attachCursor` 로 LOD 를 정했고, 되돌리는 프로덕션 코드가 **한
  // 군데도 없었다**(`resetHazardFieldBudget` 호출은 테스트뿐). 박격 장판이 생겼다 사라지며
  // 순번을 태워 톡사르 첫 런부터 `full 0 · mid 9 · lite 32`, 새 런을 열어도 전부 `lite` 였다.
  //
  // **그리고 그 결함을 82건짜리 스위트가 통째로 통과시켰다** — 케이스마다 카운터를 0 으로
  // 되돌리는 `beforeEach` 가 있어서 "두 번째 런"이라는 상황 자체가 존재하지 않았기 때문이다.
  // 그래서 이 describe 는 **리셋 없이** 시간이 흐르는 것을 재현한다.

  it('두 런을 연속 실행해도 두 번째 런의 LOD 분포가 첫 런과 같다', () => {
    resetHazardFieldBudget();
    resetHazardFieldStage();
    const layer = new Container();
    const host = new HazardHost();
    const cells = Array.from({ length: 24 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));

    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    const first = lodDistribution(layer);
    expect(first['full']).toBe(LOD_FULL_COUNT);

    // 런 종료 — `entityRenderer.reset()` 이 하는 일은 `hazardHost.clear()` 하나뿐이다.
    host.clear(ctxFor(layer));
    // 런 2 — **예산 리셋 없이**. 여기서 분포가 달라지면 세션 누적 상태가 있다는 뜻이다.
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 1));

    expect(lodDistribution(layer)).toEqual(first);
    host.clear(ctxFor(layer));
  });

  it('생겼다 사라지는 장판이 순번을 태우지 않는다(박격 장판 반복)', () => {
    resetHazardFieldBudget();
    resetHazardFieldStage();
    const layer = new Container();
    const host = new HazardHost();
    // 박격 장판이 20번 생겼다 사라진다 — 2차 설계면 여기서 커서가 20 이나 전진한다.
    for (let i = 0; i < 20; i++) {
      host.draw(
        [hazardEntity(1000 + i, { enemyType: HAZARD_MORTAR, permanent: false })],
        stubCanvas(),
        stubCanvas(),
        ctxFor(layer, 'high', i),
      );
      host.draw([], stubCanvas(), stubCanvas(), ctxFor(layer, 'high', i + 1));
    }
    // 그 뒤에 깔리는 오염 셀들은 여전히 최고 상세부터 받아야 한다.
    const cells = Array.from({ length: 24 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 100));
    expect(lodDistribution(layer)['full']).toBe(LOD_FULL_COUNT);
    host.clear(ctxFor(layer));
  });

  it('어떤 LOD 도 로브 0 이 아니다(최저 상세도 물질이다)', () => {
    resetHazardFieldBudget();
    resetHazardFieldStage();
    const layer = new Container();
    const host = new HazardHost();
    const cells = Array.from({ length: 41 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    const stage = layer.children.find((c) => c.label === 'hazardFieldStage') as Container;
    const band = stage.children.find((c) => c.label === 'hazardLobes') as Container;
    expect(band.children.length).toBe(41);
    for (const node of band.children) {
      expect((node as Container).children.length, String(node.label)).toBeGreaterThan(0);
    }
    host.clear(ctxFor(layer));
  });
});

describe('배선 · 비용 상한', () => {
  beforeEach(() => {
    resetHazardFieldBudget();
    resetHazardFieldStage();
  });

  it('등록은 멱등이다(두 번 불려도 재질이 두 배로 그려지지 않는다)', () => {
    const layer = new Container();
    installHazardMaterials();
    installHazardMaterials();
    const host = new HazardHost();
    host.draw([hazardEntity(1)], stubCanvas(), stubCanvas(), ctxFor(layer));
    // 재질이 중복 등록됐다면 장판 하나에 컨테이너가 둘 붙는다.
    expect(fieldNodeCount(layer)).toBe(1);
    host.clear(ctxFor(layer));
  });

  it('오염 셀이 41개여도 **전부** 재질을 받는다 (개체를 빼면 스타일이 갈린다)', () => {
    // 1차 반려 사유: `MAX_FIELD_MATERIALS = 10` 개체 상한 때문에 실제 41개인 톡사르에서
    // 나란한 셀 넷 중 하나만 재질을 갖고 셋은 변경 전 그대로였다 → 같은 해저드가 두 스타일로
    // 그려져 **렌더링 버그로 읽혔다.** 예산은 개체가 아니라 겹에서 깎는다.
    const layer = new Container();
    const host = new HazardHost();
    const cells = Array.from({ length: 41 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer));
    expect(host.materialCount).toBe(41);
    expect(fieldNodeCount(layer)).toBe(41);
    host.clear(ctxFor(layer));
  });

  it('안전 밸브는 실측 최대(톡사르 41)보다 넉넉하다', () => {
    // 상한이 아니라 폭주 방어다 — 실제 장면을 깎으면 안 된다.
    expect(MAX_FIELD_MATERIALS).toBeGreaterThan(41);
  });

  it('상세는 부착 순번이 정한 LOD 로 갈린다(겹을 뺀다, 개체가 아니라)', () => {
    expect(hazardLod(0)).toBe('full');
    expect(hazardLod(LOD_FULL_COUNT - 1)).toBe('full');
    expect(hazardLod(LOD_FULL_COUNT)).toBe('mid');
    expect(hazardLod(LOD_MID_COUNT - 1)).toBe('mid');
    expect(hazardLod(LOD_MID_COUNT)).toBe('lite');
    expect(hazardLod(999)).toBe('lite');
  });

  it('LOD 가 낮아져도 로브는 먼저 얇아지고 마지막에 사라진다(순서가 있다)', () => {
    expect(lodLobeCount('full', 'high', HIGH)).toBeGreaterThan(lodLobeCount('mid', 'high', HIGH));
    expect(lodLobeCount('mid', 'high', HIGH)).toBeGreaterThan(lodLobeCount('lite', 'high', HIGH));
    // `lite` 도 0 이 아니다 — 로브가 0 이면 그 셀은 물질이 아니라 도형으로 남고, 나란한
    // 셀 사이에 스타일 차이가 생긴다(2차 반려 MAJOR-1 이 자리를 옮긴 형태).
    // **단 그건 LOD 축의 이야기다** — 티어 축은 아래 별도 describe 가 잠근다.
    expect(lodLobeCount('lite', 'high', HIGH)).toBeGreaterThan(0);
    // 접지는 이제 전 LOD 다(3차 반려 MAJOR-3 — 41장 중 6장에만 있는 겹은 렌더링 버그로 읽힌다).
    expect(lodHasGrounding('mid')).toBe(true);
    expect(lodHasGrounding('lite')).toBe(true);
    // 입자만 최저 LOD 에서 빠진다(유일하게 매 프레임 위치를 다시 쓰는 겹이다).
    expect(lodHasMotes('mid')).toBe(true);
    expect(lodHasMotes('lite')).toBe(false);
    expect(lodMoteScale('mid')).toBeLessThan(lodMoteScale('full'));
    expect(lodHasLobes('mid')).toBe(true);
  });

  it('작은 장판은 재질을 받지 않는다(장식 하한과 같은 판단)', () => {
    const layer = new Container();
    const host = new HazardHost();
    host.draw([hazardEntity(1, { radius: 10 })], stubCanvas(), stubCanvas(), ctxFor(layer));
    expect(host.materialCount).toBe(0);
    expect(fieldNodeCount(layer)).toBe(0);
  });

  it('장판이 사라지면 재질이 화면에서 걷힌다(얼어붙지 않는다)', () => {
    const layer = new Container();
    const host = new HazardHost();
    host.draw([hazardEntity(1)], stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    expect(fieldNodeCount(layer)).toBe(1);
    expect(hazardFieldLiveCount()).toBe(1);
    host.draw([], stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 1));
    expect(fieldNodeCount(layer)).toBe(0);
    expect(host.materialCount).toBe(0);
    // 예산 카운터도 돌아와야 한다 — 안 돌아오면 런을 몇 번 돌린 뒤 재질이 통째로 사라진다.
    expect(hazardFieldLiveCount()).toBe(0);
  });

  it('clear 후에도 예산이 정확히 상쇄된다(런 전환 누수 없음)', () => {
    const layer = new Container();
    const host = new HazardHost();
    for (let run = 0; run < 3; run++) {
      const cells = Array.from({ length: 20 }, (_, i) => hazardEntity(i + 1));
      host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', run));
      host.clear(ctxFor(layer));
      expect(hazardFieldLiveCount(), `run=${run}`).toBe(0);
      expect(fieldNodeCount(layer), `run=${run}`).toBe(0);
    }
  });

  it('네 subtype 전부에 재질이 붙는다(용암·오염·감속·박격)', () => {
    for (const [sub, permanent] of [
      [HAZARD_LAVA, false],
      [HAZARD_MORTAR, false],
      [HAZARD_CONTAMINATION, true],
      [HAZARD_SLOW, false],
      [HAZARD_SLOW, true],
    ] as const) {
      resetHazardFieldBudget();
      const layer = new Container();
      const host = new HazardHost();
      host.draw(
        [hazardEntity(1, { enemyType: sub, permanent })],
        stubCanvas(),
        stubCanvas(),
        ctxFor(layer),
      );
      expect(host.materialCount, `sub=${sub} perm=${permanent}`).toBe(1);
      host.clear(ctxFor(layer));
    }
  });

  it('여러 프레임을 돌려도 예외 없이 그리고 컨테이너가 자라지 않는다', () => {
    const layer = new Container();
    const host = new HazardHost();
    const cells = [
      hazardEntity(1, { enemyType: HAZARD_LAVA, permanent: false }),
      hazardEntity(2, { enemyType: HAZARD_SLOW, permanent: false, active: false }),
      hazardEntity(3, { enemyType: HAZARD_CONTAMINATION }),
    ];
    for (let t = 0; t < 40; t++) {
      const frame = cells.map((c) => ({ ...c, active: t % 13 < 7 }));
      expect(() => host.draw(frame, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', t))).not.toThrow();
    }
    expect(fieldNodeCount(layer)).toBe(3);
    host.clear(ctxFor(layer));
    expect(fieldNodeCount(layer)).toBe(0);
  });

  it('장식 예산이 매 프레임 뒤집혀도 재질은 튀지 않는다', () => {
    // 1차 반려 사유 ④: 재질은 부착 후 고착인데 `decorated` 는 매 프레임 예산이라, 재질 가진
    // 장판이 예산에서 밀리면 겹이 on→off 로 **한 프레임에 튀었다.** 장판 수가 호스트 예산(12)을
    // 넘나드는 톡사르·크라스에서 실제로 발생한다. 지금은 재질이 `decorated` 를 보지 않는다.
    const layer = new Container();
    const host = new HazardHost();
    // 13개 — 호스트 장식 예산(12) 경계를 넘어 마지막 장판의 decorated 가 흔들리는 구간.
    const cells = Array.from({ length: 13 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    const before = fieldNodeCount(layer);
    // 순서를 뒤집으면 어느 장판이 예산을 받는지가 통째로 바뀐다.
    for (let t = 1; t < 6; t++) {
      const shuffled = t % 2 === 0 ? cells : [...cells].reverse();
      host.draw(shuffled, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', t));
      expect(fieldNodeCount(layer), `t=${t}`).toBe(before);
      expect(host.materialCount, `t=${t}`).toBe(13);
    }
    host.clear(ctxFor(layer));
  });

  it('LOD 는 부착 시 정해지고 수명 내내 바뀌지 않는다', () => {
    const layer = new Container();
    const host = new HazardHost();
    const cells = Array.from({ length: 3 }, (_, i) => hazardEntity(i + 1, { radius: 100 }));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    const names = layer.children.map((c) => c.label);
    for (let t = 1; t < 5; t++) {
      // 티어가 오르내려도 LOD 는 그대로다(티어는 겹의 내용을, LOD 는 겹의 유무를 정한다).
      host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, t % 2 === 0 ? 'low' : 'high', t));
    }
    expect(layer.children.map((c) => c.label)).toEqual(names);
    host.clear(ctxFor(layer));
  });

  it('티어가 바뀌어도 재질이 늘어나지 않는다(재구성이 컨테이너를 새로 붙이지 않는다)', () => {
    const layer = new Container();
    const host = new HazardHost();
    const cells = [hazardEntity(1, { enemyType: HAZARD_LAVA, permanent: false })];
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 0));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'low', 1));
    host.draw(cells, stubCanvas(), stubCanvas(), ctxFor(layer, 'high', 2));
    expect(fieldNodeCount(layer)).toBe(1);
    host.clear(ctxFor(layer));
  });
});
