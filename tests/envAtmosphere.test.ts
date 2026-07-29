/**
 * 전경 대기(잔불·재·연기·열기 — 행성마다 다르다) 잠금 테스트.
 *
 * 이 레이어는 **틀려도 안 터진다** — 배경이라 예외가 나지 않고, 화면이 그럴싸하면 아무도
 * 눈치채지 못한다. 그래서 눈으로 보는 검증만으로는 부족하고, 아래를 구조로 잠근다:
 *
 *  ① 입자 상태가 `(seed, index, tick)` 의 **순수 함수**다(같은 입력 → 같은 출력).
 *  ② tick 이 변하면 위치가 **실제로** 변한다(움직이는 척만 하는 항진 방지).
 *  ③ 수명 주기를 넘어가면 **되감긴다**(무한 상승 금지 — 입자가 화면 밖으로 영영 날아가지 않는다).
 *  ④ 티어별 입자 수가 **단조**다(off ≤ min ≤ normal).
 *  ⑤ 알파·크기가 **상한을 넘지 않는다** — 이게 곧 "입자를 적탄으로 착각하지 않는다"의 코드 강제다.
 *  ⑥ **화면 기여도가 하한 위에 있다** — 아래 절 참조.
 *
 * ## 왜 ⑥ 이 필요한가 (카르곤 1차 기각의 교훈)
 * 1차 구현은 ①~⑤ 를 전부 통과하고도 **화면 기여도 0.45**(RGB 합산 절대차 평균, 노이즈 바닥
 * 0.12)로 기각됐다. 상한만 감시하는 테스트 스위트는 "아무것도 안 그리는 레이어"를 만점으로
 * 통과시킨다 — 극단적으로 모든 알파를 0 으로 바꿔도 ①~⑤ 는 전부 초록이다. 사람은 곱셈을
 * 눈으로 추적하지 못하므로 곱셈의 결과 자체를 단언한다(상한도 함께 — 안개로 도망가는 것도 실패다).
 *
 * ## 왜 대부분이 "전 테마 순회"인가
 * 위 여섯 가지는 카르곤의 사정이 아니라 **이 레이어가 성립하기 위한 조건**이다. 카르곤 파일에만
 * 걸어두면 다음 행성이 같은 함정을 처음부터 다시 밟는다. 그래서 계약은 {@link ENV_THEMES} 를
 * 돌고, 카르곤 고유 실측(주황 잔불·하강하는 재·하단 열기 대역)만 별도 절에 남긴다.
 *
 * 기여도 하한이 {@link validateAtmosphereTheme} 이 아니라 여기 있는 이유: 기여도는 표본
 * 시각·시드·화면 사각형이 있어야 계산되고, 계산 함수가 레이어 구현에 있어 계약 파일이
 * 그것을 import 하면 순환이 된다. **강제 지점이 이 순회 테스트다.**
 */

import { describe, it, expect } from 'vitest';
import {
  AtmosphereLayer,
  ON_SCREEN_AREA_FRACTION,
  estimateAtmosphereContribution,
  estimateFieldContribution,
  fieldCount,
  maxFieldCount,
  sampleParticle,
  type ViewRect,
} from '../src/render/env/atmosphere.js';
import {
  ATMOSPHERE_LIMITS,
  BULLET_DISPLAY_RADIUS,
  DOT_PROFILE,
  PUFF_PROFILE,
  fieldDeltaRgbSum,
  periodSeconds,
  periodTicksForScreenSpeed,
  profileAverageFill,
  validateAtmosphereTheme,
  whiteoutHeadroom,
  type AtmosphereField,
  type AtmosphereTheme,
} from '../src/render/env/contracts/atmosphere.js';
import { ENV_THEMES } from '../src/render/env/themes/index.js';
import {
  KARGON_ATMOSPHERE,
  KARGON_ATMOSPHERE_TUNING,
} from '../src/render/env/themes/kargon/atmosphere.js';

/** 1920×1080 design 화면(레터박스 없음). */
const VIEW: ViewRect = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };
const SEED = 0x51ee;

/** 입자가 존재할 수 있는 패딩 포함 사각형(레이어 내부 규약: 가로 12%, 세로 15%). */
const PAD_X = 1920 * 0.12;
const PAD_Y = 1080 * 0.15;

/** 기여도를 재는 tick 표본(한 순간의 우연한 배치가 아니라 시간 평균을 본다). */
const TICKS = Array.from({ length: 24 }, (_, k) => k * 137);

/** 등록된 모든 대기 테마. 새 행성이 들어오면 자동으로 아래 계약을 전부 받는다. */
const THEMES: readonly AtmosphereTheme[] = ENV_THEMES.map((t) => t.atmosphere);

function fieldByName(t: AtmosphereTheme, name: string): AtmosphereField {
  const f = t.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no field: ${name}`);
  return f;
}

/** 등록된 테마에 실제로 필드가 있는지부터 확인한다(빈 순회가 조용히 통과하는 것 방지). */
describe('대기 테마 레지스트리', () => {
  it('테마가 하나 이상 등록돼 있고 전부 필드를 갖는다', () => {
    expect(THEMES.length).toBeGreaterThan(0);
    for (const t of THEMES) expect(t.fields.length).toBeGreaterThan(0);
  });
});

describe('대기 입자 — 순수 함수 계약 (전 테마)', () => {
  it('① 같은 (seed, index, tick) 이면 항상 같은 결과다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        for (const i of [0, 3, 7]) {
          for (const tick of [0, 137.5, 90210]) {
            const a = sampleParticle(f, SEED, i, tick, VIEW, 400, -250);
            const b = sampleParticle(f, SEED, i, tick, VIEW, 400, -250);
            expect(b).toEqual(a);
          }
        }
      }
    }
  });

  it('① 시드가 다르면 배치가 다르다(시드 무시 항진 방지)', () => {
    for (const t of THEMES) {
      const f = t.fields[0];
      expect(f).toBeDefined();
      if (f === undefined) continue;
      const a = sampleParticle(f, 1, 0, 500, VIEW);
      const b = sampleParticle(f, 999_331, 0, 500, VIEW);
      expect(a.x === b.x && a.y === b.y).toBe(false);
    }
  });

  it('① 인덱스가 다르면 서로 다른 입자다(전부 같은 자리 방지)', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        const seen = new Set<string>();
        for (let i = 0; i < maxFieldCount(f); i++) {
          const p = sampleParticle(f, SEED, i, 1234, VIEW);
          seen.add(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
        }
        expect(seen.size).toBe(maxFieldCount(f));
      }
    }
  });

  it('② tick 이 변하면 위치가 변한다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        const a = sampleParticle(f, SEED, 0, 0, VIEW);
        const b = sampleParticle(f, SEED, 0, 120, VIEW);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.5);
      }
    }
  });

  it('② 카메라가 움직이면 시차만큼 위치가 변한다(화면 완전 고정 아님)', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        const a = sampleParticle(f, SEED, 0, 300, VIEW, 0, 0);
        const b = sampleParticle(f, SEED, 0, 300, VIEW, 600, 400);
        expect(f.parallax).toBeGreaterThan(0);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.5);
      }
    }
  });

  it('③ 수명 주기를 넘어가면 되감긴다 — 5000틱 내내 패딩 사각형 안에 있고, 진행이 리셋된다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
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
    }
  });

  it('③ 되감김 지점에서도 알파가 0 으로 수렴한다(뚝 끊기는 팝 없음)', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        let minAlpha = Infinity;
        for (let tick = 0; tick < 4000; tick += 7) {
          minAlpha = Math.min(minAlpha, sampleParticle(f, SEED, 0, tick, VIEW).alpha);
        }
        expect(minAlpha).toBeLessThan(f.maxAlpha * 0.1);
      }
    }
  });

  it('⑤ 알파·반경이 필드 상한을 절대 넘지 않는다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
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
    }
  });

  it('비유한 입력(NaN tick·cam)에도 사각형 안의 유한값을 낸다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        const p = sampleParticle(f, SEED, 0, Number.NaN, VIEW, Number.NaN, Infinity);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.alpha)).toBe(true);
        expect(Number.isFinite(p.radius)).toBe(true);
      }
    }
  });

  it('세로 대역이 좁은 필드는 그 대역 밖으로 나가지 않는다', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        if (f.bandSpan >= 1) continue;
        const fieldH = (VIEW.maxY - VIEW.minY) * (1 + 2 * 0.15);
        const bandTop = VIEW.minY - PAD_Y + fieldH * f.bandStart;
        const bandBottom = bandTop + fieldH * f.bandSpan;
        for (let i = 0; i < maxFieldCount(f); i++) {
          for (let tick = 0; tick < 3000; tick += 11) {
            const p = sampleParticle(f, SEED, i, tick, VIEW, 900, -1400);
            expect(p.y).toBeGreaterThanOrEqual(bandTop - 1e-6);
            expect(p.y).toBeLessThanOrEqual(bandBottom + 1e-6);
          }
        }
      }
    }
  });
});

describe('대기 입자 — 티어·게이트 (전 테마)', () => {
  it('④ 티어별 입자 수가 단조다(off ≤ min ≤ normal)', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        const off = fieldCount(f, 'off');
        const min = fieldCount(f, 'min');
        const normal = fieldCount(f, 'normal');
        expect(off).toBeLessThanOrEqual(min);
        expect(min).toBeLessThanOrEqual(normal);
        expect(off).toBe(0); // 'off' 는 문자 그대로 하나도 안 그린다.
        expect(normal).toBeGreaterThan(0);
      }
    }
  });

  it('모든 필드가 파티클 3단 티어만으로 조절된다(저티어에서 통째로 사라지는 필드 없음)', () => {
    // 카르곤 열기는 1차에서 gates.eventShaders(고티어 전용)에 물려 있었다. 셰이더를 쓰지 않는데도
    // 셰이더 게이트에 묶여 med/low 에서 화면 기여의 절반이 통째로 사라졌다.
    for (const t of THEMES) for (const f of t.fields) expect(fieldCount(f, 'min')).toBeGreaterThan(0);
  });
});

describe('테마 계약 — validateAtmosphereTheme 이 강제한다 (전 테마)', () => {
  it('등록된 모든 테마가 위반 0 이다', () => {
    for (const t of THEMES) {
      expect({ themeId: t.themeId, violations: validateAtmosphereTheme(t) }).toEqual({
        themeId: t.themeId,
        violations: [],
      });
    }
  });

  it('검증이 항진이 아니다 — 각 불변식을 깨면 실제로 위반이 잡힌다', () => {
    const base = KARGON_ATMOSPHERE;
    const smoke = fieldByName(base, 'smoke');
    const withFields = (fields: readonly AtmosphereField[]): AtmosphereTheme => ({
      ...base,
      fields,
    });
    const wheres = (t: AtmosphereTheme): string[] => validateAtmosphereTheme(t).map((v) => v.where);

    // 해시 도메인 키 충돌 — 조용히 두 필드가 정확히 겹쳐 그려진다.
    expect(
      wheres(withFields(base.fields.map((f) => (f.name === 'ember' ? { ...f, key: smoke.key } : f)))),
    ).toContain('fields.ember.key');

    // 배경 기준색이 틴트와 같아짐 — 보이지 않는 입자.
    expect(
      wheres({
        ...base,
        referenceBackdrop: { r: 0x6b, g: 0x53, b: 0x48 },
      }),
    ).toContain('fields.smoke.tint');

    // 가산 필드가 발광 감소를 무시.
    expect(
      wheres(
        withFields(base.fields.map((f) => (f.additive ? { ...f, glowSensitive: false } : f))),
      ),
    ).toContain('fields.ember.glowSensitive');

    // 밝은 배경 위의 밝은 가산 입자 = 화이트아웃.
    expect(
      wheres({ ...base, referenceBackdrop: { r: 0xe8, g: 0xee, b: 0xf4 } }),
    ).toContain('fields.ember.tint');

    // 알갱이가 탄 크기로 커짐.
    expect(
      wheres(
        withFields(
          base.fields.map((f) => (f.name === 'ember' ? { ...f, maxRadius: BULLET_DISPLAY_RADIUS } : f)),
        ),
      ),
    ).toContain('fields.ember.maxRadius');

    // 알갱이가 탄 속도로 빨라짐.
    expect(
      wheres(
        withFields(base.fields.map((f) => (f.name === 'ember' ? { ...f, periodTicks: 60 } : f))),
      ),
    ).toContain('fields.ember.periodTicks');

    // 비가산 베일이 균일한 안개가 됨.
    expect(
      wheres(withFields(base.fields.map((f) => (f.name === 'smoke' ? { ...f, maxAlpha: 0.6 } : f)))),
    ).toContain('fields.smoke.maxAlpha');

    // 중심이 불투명하지 않은 프로파일(카르곤 1차 "중심 알파 0.61").
    expect(
      wheres(
        withFields(
          base.fields.map((f) =>
            f.name === 'ember'
              ? { ...f, profile: { id: 'flat', alphaAt: (t: number) => 0.61 * (1 - t) } }
              : f,
          ),
        ),
      ),
    ).toContain('fields.ember.profile.alphaAt(0)');

    // 같은 프로파일 id 로 다른 모양 — 먼저 구운 텍스처가 조용히 재사용된다.
    // (충돌은 나중에 나오는 필드에서 보고되므로 자리 대신 종류로 확인한다.)
    expect(
      wheres(
        withFields(
          base.fields.map((f) =>
            f.name === 'ash'
              ? { ...f, profile: { id: DOT_PROFILE.id, alphaAt: (t: number) => 1 - t } }
              : f,
          ),
        ),
      ).some((w) => w.endsWith('.profile.id')),
    ).toBe(true);

    // 저티어에서 필드가 통째로 사라짐.
    expect(
      wheres(
        withFields(
          base.fields.map((f) => (f.name === 'heat' ? { ...f, counts: { ...f.counts, min: 0 } } : f)),
        ),
      ),
    ).toContain('fields.heat.counts');

    // 입자 총량 폭주.
    expect(
      wheres(
        withFields(
          base.fields.map((f) =>
            f.name === 'ember' ? { ...f, counts: { off: 0, min: 12, normal: 200 } } : f,
          ),
        ),
      ).length,
    ).toBeGreaterThan(0);

    // 원본은 여전히 위반 0(위 변형이 원본을 건드리지 않았다).
    expect(validateAtmosphereTheme(base)).toEqual([]);
  });
});

describe('텍스처 프로파일 — 모양은 테마가 들고 온다', () => {
  it('공용 프로파일의 중심이 불투명하다(1차의 "중심 알파 0.61" 결함 재발 방지)', () => {
    for (const p of [DOT_PROFILE, PUFF_PROFILE]) {
      expect(p.alphaAt(0)).toBeCloseTo(1, 6); // 스프라이트 alpha 가 곧 화면 최대 불투명도여야 한다
      expect(p.alphaAt(1)).toBeCloseTo(0, 6); // 가장자리는 완전히 사라진다(하드 엣지 금지)
      let prev = Infinity;
      for (let i = 0; i <= 32; i++) {
        const v = p.alphaAt(i / 32);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    }
  });

  it('덩어리 프로파일이 알갱이 프로파일보다 원판을 훨씬 많이 채운다(면적 기여의 원천)', () => {
    const dot = profileAverageFill(DOT_PROFILE);
    const puff = profileAverageFill(PUFF_PROFILE);
    expect(dot).toBeCloseTo(1 / 6, 2);
    expect(puff).toBeCloseTo(0.4, 2);
    expect(puff / dot).toBeGreaterThan(2);
  });

  it('행성 고유 프로파일(눈송이 등)을 테마 파일만으로 추가할 수 있다', () => {
    // 열거형이 닫혀 있던 시절에는 이 한 줄을 위해 공용 파일 세 자리를 동시에 고쳐야 했다.
    // 여기서 통과한다는 것은 눈·포자 행성이 공용 코드를 건드리지 않고 들어올 수 있다는 뜻이다.
    const snowflake = {
      id: 'snowflake',
      alphaAt: (t: number) => {
        const c = t < 0 ? 0 : t > 1 ? 1 : t;
        return (1 - c) ** 0.75;
      },
    };
    const snow: AtmosphereTheme = {
      themeId: 'test_snow',
      // 밝은 설원. 이 배경에서 가산 흰 입자는 계약이 거부한다.
      referenceBackdrop: { r: 0xd8, g: 0xdf, b: 0xe8 },
      fields: [
        {
          ...fieldByName(KARGON_ATMOSPHERE, 'ash'),
          name: 'snow',
          role: 'mote',
          tint: 0x3c4a63, // 밝은 배경에서 "보이는" 색은 어두운 쪽이다
          profile: snowflake,
        },
      ],
    };
    expect(validateAtmosphereTheme(snow)).toEqual([]);
    // 같은 눈을 가산으로 그리면 화이트아웃으로 거부된다.
    const glowing: AtmosphereTheme = {
      ...snow,
      fields: snow.fields.map((f) => ({
        ...f,
        role: 'spark' as const,
        tint: 0xffffff,
        additive: true,
        glowSensitive: true,
      })),
    };
    const wheres = validateAtmosphereTheme(glowing).map((v) => v.where);
    expect(wheres).toContain('fields.snow.tint');
  });
});

describe('화면 기여도 — "보이는가"를 곱셈 결과로 감시한다 (전 테마)', () => {
  it('어떤 필드도 배경과 구분되지 않는 색을 쓰지 않는다(1차 화산재 결함)', () => {
    for (const t of THEMES) {
      for (const f of t.fields) {
        expect(fieldDeltaRgbSum(f, t.referenceBackdrop)).toBeGreaterThan(
          ATMOSPHERE_LIMITS.minDeltaRgbSum,
        );
      }
    }
  });

  it('⑥ 합산 화면 기여도가 하한(3.0) 위에 있다 — 카르곤 1차 실측 0.45 기각의 재발 방지', () => {
    for (const t of THEMES) {
      expect(estimateAtmosphereContribution(t, SEED, VIEW, TICKS)).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('⑥ 그렇다고 화면을 덮지도 않는다(안개로 도망가는 것도 실패다)', () => {
    for (const t of THEMES) {
      expect(estimateAtmosphereContribution(t, SEED, VIEW, TICKS)).toBeLessThan(12);
      // 비가산 베일의 화면 평균 알파가 5% 를 넘으면 국소 대비가 눈에 띄게 죽는다.
      let veil = 0;
      const w = VIEW.maxX - VIEW.minX;
      const h = VIEW.maxY - VIEW.minY;
      for (const f of t.fields) {
        if (f.additive) continue;
        const fill = profileAverageFill(f.profile);
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
    }
  });

  it('⑥ 기여의 주력은 큰 부드러운 덩어리다(작고 밝은 알갱이로 밀어붙이지 않았다)', () => {
    // 가독성 논증의 핵심: 같은 기여도를 "작고 밝은 점"으로 얻으면 탄막과 경쟁하지만
    // "크고 옅은 덩어리"로 얻으면 경쟁하지 않는다. 그 배분을 코드로 고정한다.
    for (const t of THEMES) {
      const veil = t.fields
        .filter((f) => f.role === 'veil')
        .reduce((s, f) => s + estimateFieldContribution(t, f, SEED, VIEW, TICKS), 0);
      const total = estimateAtmosphereContribution(t, SEED, VIEW, TICKS);
      expect(veil / total).toBeGreaterThan(0.9);
    }
  });

  it('⑥ 덩어리 역할이 하나뿐인 테마는 없다 — 한 축이 죽어도 합계가 가려주는 것을 막는다', () => {
    // 카르곤은 합계 하한만 두었더니 연기를 1차 값으로 되돌려도 열기 혼자 3.0 을 넘겨 통과했다.
    // 공기감은 서로 다른 방향의 덩어리 축 둘이 같이 있어야 성립한다.
    for (const t of THEMES) {
      const veils = t.fields.filter((f) => f.role === 'veil');
      expect(veils.length).toBeGreaterThanOrEqual(2);
      for (const f of veils) {
        expect(estimateFieldContribution(t, f, SEED, VIEW, TICKS)).toBeGreaterThan(1.0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 여기부터는 카르곤 고유 실측. 위 계약과 달리 다른 행성에 요구되지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

describe('카르곤 실측 — 잔불 ≠ 적탄 4대 분리축', () => {
  const ember = fieldByName(KARGON_ATMOSPHERE, 'ember');

  it('① 크기: 잔불 최대 반경이 탄 표시 반경의 절반 미만(면적으로 1/4 미만)', () => {
    // 1차는 1/3 미만(2.6px)이었으나 그 크기로는 화면에서 보이지 않아 기각됐다. 2차는 상한을
    // 절반으로 완화하되, 면적비 1/4 미만이라는 지각 기준을 지켰다.
    expect(ember.maxRadius).toBe(4.0);
    expect((ember.maxRadius / BULLET_DISPLAY_RADIUS) ** 2).toBeLessThan(
      ATMOSPHERE_LIMITS.sparkMaxAreaRatio,
    );
  });

  it('② 알파: 잔불이 항상 반투명(≤0.5)이라 뒤가 비쳐 보인다 — 1차 상한을 그대로 지켰다', () => {
    expect(ember.maxAlpha).toBe(0.5);
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
    // 2차에서 더 벌린 축이다(1차 10초 하한 → 20초). 크기·알파를 올린 대가를 여기서 갚았다.
    expect(periodSeconds(ember)).toBeGreaterThan(20);
    // 주기는 속도의 파생값이다 — 62px/s 로 1350px 를 지나는 틱 수.
    expect(ember.periodTicks).toBe(periodTicksForScreenSpeed(62, 1350));
  });

  it('개수도 분리축이다 — 잔불 개수를 1차에서 늘리지 않았다(탄막과 경쟁하는 유일한 축)', () => {
    expect(fieldCount(ember, 'normal')).toBe(30);
  });

  it('가산 잔불이 카르곤 암반 위에서 화이트아웃 여유를 넉넉히 남긴다', () => {
    expect(whiteoutHeadroom(ember, KARGON_ATMOSPHERE.referenceBackdrop)).toBeGreaterThan(50);
  });
});

describe('카르곤 실측 — 필드 성격', () => {
  const t = KARGON_ATMOSPHERE;

  it('기준 배경색이 카르곤 암반(어두운 대역)에 머물러 있다', () => {
    const { r, g, b } = t.referenceBackdrop;
    expect(r + g + b).toBeLessThan(200);
  });

  it('잔불·열기만 가산 합성이다', () => {
    for (const f of t.fields) expect(f.additive).toBe(f.name === 'ember' || f.name === 'heat');
  });

  it('재는 잔불과 반대 방향으로 떨어진다(대비축)', () => {
    expect(fieldByName(t, 'ember').riseUp).toBe(true);
    expect(fieldByName(t, 'ash').riseUp).toBe(false);
  });

  it('연기는 가로로 흐르고 시차가 잔불보다 작다(뒤 층)', () => {
    const smoke = fieldByName(t, 'smoke');
    expect(smoke.driftTurns).toBeGreaterThan(0);
    expect(smoke.parallax).toBeLessThan(fieldByName(t, 'ember').parallax);
  });

  it('열기는 화면 아래쪽에서만 솟는다(카르곤은 화산이라 열이 아래에서 온다)', () => {
    const heat = fieldByName(t, 'heat');
    const fieldH = (VIEW.maxY - VIEW.minY) * (1 + 2 * 0.15);
    const bandTop = VIEW.minY - PAD_Y + fieldH * heat.bandStart;
    expect(heat.bandSpan).toBeLessThan(1);
    expect(bandTop).toBeGreaterThan((VIEW.minY + VIEW.maxY) / 2 - 1);
  });

  it('세기 수치가 튜닝 블록 한 곳에서만 온다(통합 후 재조정 시 고칠 자리가 하나)', () => {
    for (const f of t.fields) {
      const tune = KARGON_ATMOSPHERE_TUNING[f.name as keyof typeof KARGON_ATMOSPHERE_TUNING];
      expect(tune).toBeDefined();
      expect(f.counts.normal).toBe(tune.count);
      expect(f.counts.min).toBe(tune.countMin);
      expect(f.minRadius).toBe(tune.minRadius);
      expect(f.maxRadius).toBe(tune.maxRadius);
      expect(f.maxAlpha).toBe(tune.alpha);
    }
  });

  it('연기·열기를 1차 값으로 되돌리면 기여도 하한이 깨진다(하한이 항진이 아님)', () => {
    const rollback: AtmosphereTheme = {
      ...t,
      fields: t.fields.map((f) =>
        f.name === 'smoke'
          ? { ...f, counts: { ...f.counts, normal: 6 }, maxAlpha: 0.09, maxRadius: 210, minRadius: 90 }
          : f.name === 'heat'
            ? { ...f, counts: { ...f.counts, normal: 4 }, maxAlpha: 0.055, maxRadius: 96, minRadius: 46 }
            : f,
      ),
    };
    expect(estimateAtmosphereContribution(rollback, SEED, VIEW, TICKS)).toBeLessThan(3.0);
  });
});

describe('대기 레이어 — 실제로 그린다', () => {
  /** 렌더러 없이(=테스트 환경) 굴린다. 레이어는 이 상황에서 던지면 안 된다(types.ts 계약). */
  function run(): AtmosphereLayer {
    const layer = new AtmosphereLayer();
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

  it('테마가 등록된 행성에서 켜지고, 없는 행성에서는 스스로 꺼진다', () => {
    const layer = new AtmosphereLayer();
    expect(layer.configure({ planet: 999, seed: SEED })).toBe(false);
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
    const expected = KARGON_ATMOSPHERE.fields.reduce((s, f) => s + fieldCount(f, 'normal'), 0);
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

  it('행성이 바뀌면 이전 테마의 스프라이트가 남지 않는다', () => {
    // 풀을 "한 번 지었으면 끝"으로 두면 두 번째 configure 가 즉시 return 해서 이전 행성의
    // 공기가 그대로 떠 있게 된다. 필드 수·개수가 다르면 눈에 띄지도 않는다.
    const layer = run();
    const before = layer.view.children.length;
    expect(before).toBe(KARGON_ATMOSPHERE.fields.length);
    expect(layer.configure({ planet: 999, seed: SEED })).toBe(false);
    expect(layer.view.children.length).toBe(0);
    layer.destroy();
  });
});
