/**
 * 침공 3레이어 테마 **조립기**.
 *
 * ## 왜 행성처럼 파일 5장이 아니라 조립기인가
 * 행성 테마는 하나가 한 행성을 담당하지만 침공은 **한 런 안에서 L1 → L2 → L3 로 이어지는
 * 한 계열**이다. 세 레이어가 서로 다른 시차 구조·데칼 격자·발광 기하를 갖는 것은 정체성이
 * 아니라 사고이며, 화면에서는 "같은 기지의 세 구역"으로 읽혀야 한다. 그래서 **기하·알파·
 * 밀도는 셋이 공유**하고 레이어마다 다른 것은 색과 몇 개의 성격 노브뿐이다.
 *
 * 공유하는 수치는 카르곤 4차가 4라운드의 실측으로 얻은 관계값이다(AO 오프셋 대 코어 폭,
 * 데칼 격자의 서로소 셀, 그레이딩 알파 6개의 공동 예산). 값을 그대로 쓰되 **근거 주석은
 * 옮기지 않는다** — 그건 카르곤 실측이지 침공 실측이 아니다. 관계가 왜 필요한지는 계약에 있고,
 * `validateTheme` 이 세 테마 전부에 대해 그것을 강제한다.
 *
 * ## 색은 계산으로 검증받는다
 * 팔레트 색상각은 `computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, 10)` 이 계산한 골짜기
 * 안에 있어야 하며, 그 판정은 `validateTerrainLightTheme` 이 한다. 각 레이어 파일의 주석에
 * 적힌 각도는 참고용이고 **정본은 검증기**다.
 */

import type { EnvTheme, EnvLightSpec } from '../../theme.js';
import type { ParallaxTheme } from '../../contracts/parallax.js';
import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
} from '../../contracts/parallax.js';
import {
  MIN_MULTIPLIER_CHANNEL,
  MAX_MULTIPLIER_CHANNEL,
  type DecalTheme,
} from '../../contracts/decals.js';
import type {
  NonEmpty,
  TerrainLightChannelColors,
  TerrainLightTheme,
} from '../../contracts/terrainLight.js';
import {
  DOT_PROFILE,
  PUFF_PROFILE,
  countsFromTuning,
  periodTicksForScreenSpeed,
  type AtmosphereField,
  type AtmosphereTheme,
} from '../../contracts/atmosphere.js';
import type { GradeTheme } from '../../contracts/grade.js';

/** 곱연산 팔레트의 채널 편향(회색 기준 명도에 곱한다). */
export type ChannelBias = readonly [number, number, number];

/** 한 레이어의 색·성격. 기하와 알파는 조립기가 공유한다. */
export interface InvasionLayerSpec {
  /** 테마 슬러그(소문자·숫자·밑줄). */
  readonly id: string;
  /** 진단 표시용 이름. */
  readonly name: string;
  /** 이 레이어가 담당하는 **합성 행성 인덱스**(행성 0~5 와 겹치지 않는다). */
  readonly planet: number;
  /** 데칼과 지형광이 **공유**하는 광원. 레이어마다 광원 위치가 다르다(고도 → 실내 → 코어). */
  readonly light: EnvLightSpec;

  /** 시차 레이어가 기준으로 삼는 지형 휘도 3종(이 레이어 타일셋 실측 근사). */
  readonly luma: { readonly base: number; readonly dark: number; readonly bright: number };
  /** 시차 대역 4종의 색(뒤 → 앞). 첫 장은 `normal` 합성이라 암부 바닥보다 어두워야 한다. */
  readonly bands: {
    readonly shade: number;
    readonly bounce: number;
    readonly farGlow: number;
    readonly nearPoint: number;
  };

  /** 데칼 곱연산 팔레트의 채널 편향. 크로마 상한이 있어 색 필터가 아니라 명도 변조로 남는다. */
  readonly decalBias: ChannelBias;
  /** 데칼 부조의 가산 하이라이트(림·면). */
  readonly decalGlow: { readonly rim: number; readonly face: number };

  /** 지형광 채널 4쌍(헤일로·심지) + 림 + 기둥. 전부 안전 골짜기 안이어야 한다. */
  readonly channel: NonEmpty<TerrainLightChannelColors>;
  readonly rimColor: number;
  readonly plumeColor: number;
  /** 황혼·AO·캐스트 섀도의 틴트(저채도 — 여기서 색을 밀면 전 화면이 물든다). */
  readonly duskTint: number;
  readonly aoTint: number;
  readonly shadowTint: number;

  /** 대기 레이어. `backdrop` 은 이 레이어 지형의 대표색이다(기여도 모델의 기준). */
  readonly atmosphere: {
    readonly backdrop: { readonly r: number; readonly g: number; readonly b: number };
    readonly veil: number;
    readonly mote: number;
    readonly plume: number;
    readonly spark: number;
  };

  /** 그레이딩 틴트 5종 + 스플릿 방향. */
  readonly grade: {
    readonly warm: number;
    readonly cool: number;
    readonly grain: number;
    readonly gain: number;
    readonly shadow: number;
    readonly warmthDirection: 1 | -1;
  };
}

/** 회색 기준 명도 × 채널 편향 → 곱연산 팔레트 색. 채널 상·하한으로 접는다. */
function mul(level: number, bias: ChannelBias): number {
  const ch = bias.map((b) => {
    const v = Math.round(level * b);
    return v < MIN_MULTIPLIER_CHANNEL
      ? MIN_MULTIPLIER_CHANNEL
      : v > MAX_MULTIPLIER_CHANNEL
        ? MAX_MULTIPLIER_CHANNEL
        : v;
  });
  return ((ch[0] ?? 0) << 16) | ((ch[1] ?? 0) << 8) | (ch[2] ?? 0);
}

/** 편향을 차갑게/따뜻하게 기울인 변형(대역 변색 2종이 서로 반대 방향이어야 한다). */
function tilt(bias: ChannelBias, dr: number, db: number): ChannelBias {
  return [bias[0] * dr, bias[1], bias[2] * db];
}

function buildParallax(s: InvasionLayerSpec): ParallaxTheme {
  return {
    themeId: s.id,
    baseLuma: s.luma.base,
    darkLuma: s.luma.dark,
    brightLuma: s.luma.bright,
    bands: [
      // 명도 골격. 화면보다 큰 저주파로 어두운 구역을 더 깊게 만든다 — 그 위의 적·탄 대비는
      // 오히려 살아난다.
      {
        key: 'deep-shade',
        domain: 'lit',
        parallax: 0.1,
        tile: 5200,
        alpha: 0.5,
        blend: 'normal',
        color: hex(s.bands.shade),
        blobs: 4,
        rMin: 0.22,
        rMax: 0.4,
        peak: 0.9,
        falloff: FALLOFF_WIDE,
        driftX: -0.02,
        driftY: 0.028,
        pulse: 0.08,
        period: 900,
        minTier: 'low',
        glow: false,
      },
      // 암부 바운스광. 저휘도 색이라 색조는 크게 움직이면서 명도는 거의 안 올린다.
      {
        key: 'shadow-bounce',
        domain: 'shadow',
        parallax: 0.16,
        tile: 3600,
        alpha: 0.55,
        blend: 'add',
        color: hex(s.bands.bounce),
        blobs: 7,
        rMin: 0.18,
        rMax: 0.34,
        peak: 0.66,
        falloff: FALLOFF_SOFT,
        driftX: 0.04,
        driftY: -0.02,
        pulse: 0.12,
        period: 820,
        minTier: 'low',
        // 한색 저휘도라 발광 감소로 억제하면 암부가 다시 평면이 된다.
        glow: false,
      },
      // 지역 광량. 국소 밝음은 지형광이 담당하므로 여기는 "이 구역이 활성이다" 라는 저주파만.
      {
        key: 'far-glow',
        domain: 'lit',
        parallax: 0.24,
        tile: 2800,
        alpha: 0.06,
        blend: 'add',
        color: hex(s.bands.farGlow),
        blobs: 4,
        rMin: 0.28,
        rMax: 0.46,
        peak: 0.45,
        falloff: FALLOFF_WIDE,
        driftX: 0.03,
        driftY: 0.015,
        pulse: 0.22,
        period: 640,
        minTier: 'med',
        glow: true,
      },
      // 좁은 광점. 밝은 면적이 아니라 밝은 점이 되게 개수를 늘리고 반경을 줄인다.
      {
        key: 'near-point',
        domain: 'lit',
        parallax: 0.33,
        tile: 2200,
        alpha: 0.065,
        blend: 'add',
        color: hex(s.bands.nearPoint),
        blobs: 10,
        rMin: 0.07,
        rMax: 0.15,
        peak: 0.52,
        falloff: FALLOFF_TIGHT,
        driftX: 0.05,
        driftY: -0.04,
        pulse: 0.3,
        period: 430,
        minTier: 'high',
        glow: true,
      },
    ],
  };
}

/** `#rrggbb` 문자열(시차 대역은 CSS 색 문자열을 받는다). */
function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function buildDecals(s: InvasionLayerSpec): DecalTheme {
  const b = s.decalBias;
  const cool = tilt(b, 0.94, 1.06);
  const warm = tilt(b, 1.08, 0.9);
  return {
    themeId: s.id,
    /** 침공 타일셋도 32px 원본(표시 64px). */
    sourceTilePx: 32,
    // 침공 지형은 셋 다 어두운 계열이라 기준을 카르곤(150/90)보다 낮게 잡는다.
    floorLumaSum: 120,
    darkFloorLumaSum: 74,
    /** 접지 음영 — 팔레트에서 가장 진하다. */
    ground: mul(56, b),
    tints: [0xffffff, 0xf0e8e0, 0xdcd6d0, 0xd4dae2, 0xe6ddd2, 0xcac6c2],
    glow: s.decalGlow,
    kinds: [
      // 흘러내린 자국 — 본체 / 심 / 코어.
      { id: 'streak', silhouette: 'flow', r: 42, elong: 2.4, coverage: 0.5, opacity: 0.95,
        slots: [mul(132, b), mul(88, b), mul(64, b)] },
      // 피탄공 — 림(가장 옅다) / 바닥 / 심연.
      { id: 'crater', silhouette: 'ring', r: 44, elong: 1.0, coverage: 0.62, opacity: 0.9,
        slots: [mul(157, b), mul(99, b), mul(57, b)] },
      // 먼지 퇴적 — 거의 변화 없는 옅은 안개.
      { id: 'dust', silhouette: 'haze', r: 46, elong: 1.45, coverage: 0.85, opacity: 0.45,
        slots: [mul(189, b)], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
      // 비산 자국 — 본체 / 방울.
      { id: 'splatter', silhouette: 'splatter', r: 44, elong: 1.3, coverage: 0.3, opacity: 0.92,
        slots: [mul(113, b), mul(80, b)] },
      // 이음매 — 겉선 / 코어(팔레트에서 가장 진하다: 홈 자체가 가장 깊다).
      { id: 'seam', silhouette: 'crack', r: 44, elong: 2.0, coverage: 0.12, opacity: 0.95,
        slots: [mul(99, b), mul(44, b)] },
      // 파편 — 밝은 조각 / 어두운 조각.
      { id: 'debris', silhouette: 'cluster', r: 26, elong: 1.0, coverage: 0.3, opacity: 0.88,
        slots: [mul(136, b), mul(80, b)] },
      // 그을음.
      { id: 'soot', silhouette: 'haze', r: 17, elong: 1.2, coverage: 0.7, opacity: 0.9,
        slots: [mul(68, b)], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
      // 대역 변색 2종 — 서로 반대 방향으로 기울여야 바닥이 한 색으로 물들지 않는다.
      { id: 'stainCool', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
        slots: [mul(145, cool)] },
      { id: 'stainWarm', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
        slots: [mul(155, warm)] },
      // 암부 랜드마크 3종. `r × elong` 대역은 `validateDecalTheme` 이 실제로 검사한다.
      { id: 'block', silhouette: 'boulder', r: 115, elong: 1.15, coverage: 0.52, opacity: 0.9,
        slots: [mul(118, b), mul(72, b)] },
      { id: 'rail', silhouette: 'ridge', r: 70, elong: 1.9, coverage: 0.34, opacity: 0.92,
        slots: [mul(126, b), mul(80, b)] },
      { id: 'mound', silhouette: 'mound', r: 98, elong: 1.35, coverage: 0.46, opacity: 0.86,
        slots: [mul(139, b), mul(86, b)] },
    ],
    /** 뒤 → 앞. 부조가 맨 앞이라 잔 데칼이 그 아래를 지난다(뒤집으면 바위가 판때기로 읽힌다). */
    grids: [
      { cell: 787, kinds: ['stainCool', 'stainWarm'], density: 0.9,
        minScale: 2, maxScale: 2, minAlpha: 0.13, maxAlpha: 0.28, salt: 0x3000 },
      { cell: 337, kinds: ['streak', 'crater', 'splatter', 'dust'], density: 0.45,
        minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x1000 },
      { cell: 149, kinds: ['seam', 'seam', 'debris', 'soot', 'splatter'], density: 0.36,
        minScale: 1, maxScale: 1, minAlpha: 0.32, maxAlpha: 0.58, salt: 0x2000 },
      { cell: 419, kinds: ['block', 'block', 'rail', 'mound'], density: 0.48,
        minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.55, salt: 0x4000,
        siteGate: 'darkTerrain', highlight: { minAlpha: 0.11, maxAlpha: 0.18 },
        noFlip: true, minDensityScale: 0.7 },
    ],
  };
}

function buildTerrainLight(s: InvasionLayerSpec): TerrainLightTheme {
  return {
    themeId: s.id,
    channel: s.channel,
    dusk: { alpha: 0.38, tint: s.duskTint },
    glow: { alphaCap: 0.4, width: 104, profileExp: 2.1 },
    core: { alphaCap: 0.78, width: 17, profileExp: 6.2 },
    ao: {
      alphaCap: 0.66,
      tint: s.aoTint,
      width: 16,
      offset: 15,
      plateau: 0.5,
      falloffExp: 2.6,
      floor: 0.62,
    },
    shadow: { alphaCap: 0.5, tint: s.shadowTint, width: 52, offset: 40, minStrength: 0.12 },
    rim: { alphaCap: 0.5, color: s.rimColor, width: 11, widthFloor: 0.5, offset: -17, minStrength: 0.18 },
    plume: {
      alphaCap: 0.18,
      color: s.plumeColor,
      width: 148,
      stretch: 1.55,
      rise: 92,
      profileExp: 2.4,
      minStrength: 0.62,
    },
    intensity: {
      regionTiles: 8,
      regionThreshold: 0.55,
      regionSpan: 0.15,
      emberMin: 0.28,
      emberMax: 0.52,
      emberModTiles: 3.4,
      emberRemapLo: 0.32,
      emberRemapHi: 0.68,
      widthBase: 0.55,
      widthGain: 0.45,
    },
  };
}

/** 알갱이가 화면을 지나는 속도(px/s)와 이동 거리 — 탄과의 속도차가 대기의 최강 분리축이다. */
const SPARK_SPEED_PX_PER_SEC = 62;
const SPARK_TRAVEL_PX = 1350;

function buildAtmosphere(s: InvasionLayerSpec): AtmosphereTheme {
  const a = s.atmosphere;
  const veil: AtmosphereField = {
    name: 'veil',
    key: 0x3c,
    role: 'veil',
    counts: countsFromTuning({ count: 11, countMin: 4, minRadius: 130, maxRadius: 300, alpha: 0.26 }),
    riseUp: true,
    periodTicks: 3000,
    periodJitter: 0.45,
    minRadius: 130,
    maxRadius: 300,
    aspect: 0.62,
    maxAlpha: 0.26,
    bandStart: 0,
    bandSpan: 1,
    swayPx: 40,
    swayCycles: 0.7,
    driftTurns: 1,
    parallax: 0.12,
    tint: a.veil,
    additive: false,
    flicker: 0,
    glowSensitive: false,
    profile: PUFF_PROFILE,
  };
  const mote: AtmosphereField = {
    name: 'mote',
    key: 0x2b,
    role: 'mote',
    counts: countsFromTuning({ count: 24, countMin: 9, minRadius: 2.4, maxRadius: 5.0, alpha: 0.4 }),
    riseUp: false,
    periodTicks: 1600,
    periodJitter: 0.4,
    minRadius: 2.4,
    maxRadius: 5.0,
    aspect: 1,
    maxAlpha: 0.4,
    bandStart: 0,
    bandSpan: 1,
    swayPx: 34,
    swayCycles: 1.5,
    driftTurns: 0,
    parallax: 0.22,
    tint: a.mote,
    additive: false,
    flicker: 0,
    glowSensitive: false,
    profile: DOT_PROFILE,
  };
  const plume: AtmosphereField = {
    name: 'plume',
    key: 0x4d,
    role: 'veil',
    counts: countsFromTuning({ count: 9, countMin: 3, minRadius: 55, maxRadius: 130, alpha: 0.14 }),
    riseUp: true,
    periodTicks: 1200,
    periodJitter: 0.3,
    minRadius: 55,
    maxRadius: 130,
    aspect: 2.6,
    maxAlpha: 0.14,
    bandStart: 0.5,
    bandSpan: 0.5,
    swayPx: 18,
    swayCycles: 3,
    driftTurns: 0,
    parallax: 0.18,
    tint: a.plume,
    additive: true,
    flicker: 0.35,
    glowSensitive: true,
    profile: PUFF_PROFILE,
  };
  const spark: AtmosphereField = {
    name: 'spark',
    key: 0x1a,
    role: 'spark',
    counts: countsFromTuning({ count: 30, countMin: 12, minRadius: 1.6, maxRadius: 4.0, alpha: 0.5 }),
    riseUp: true,
    periodTicks: periodTicksForScreenSpeed(SPARK_SPEED_PX_PER_SEC, SPARK_TRAVEL_PX),
    periodJitter: 0.35,
    minRadius: 1.6,
    maxRadius: 4.0,
    aspect: 1,
    maxAlpha: 0.5,
    bandStart: 0,
    bandSpan: 1,
    swayPx: 26,
    swayCycles: 2.5,
    driftTurns: 0,
    parallax: 0.34,
    tint: a.spark,
    additive: true,
    flicker: 0.55,
    glowSensitive: true,
    profile: DOT_PROFILE,
  };
  return {
    themeId: s.id,
    referenceBackdrop: a.backdrop,
    /** 뒤 → 앞: 베일 → 알갱이 → 기둥 → 불꽃. */
    fields: [veil, mote, plume, spark],
  };
}

function buildGrade(s: InvasionLayerSpec): GradeTheme {
  return {
    themeId: s.id,
    alpha: {
      vignette: 0.28,
      warm: 0.045,
      cool: 0.06,
      gain: 0.3,
      shadow: 0.055,
      grain: 0.035,
    },
    vignette: { centerY: 0.1, inner: 0.65, outer: 1.55 },
    warm: { startY: 0.45, sideFalloff: 0.45 },
    cool: { topStart: -0.2, topEnd: -1, sideStart: 0.65, sideEnd: 1.05 },
    tint: {
      warm: s.grade.warm,
      cool: s.grade.cool,
      grain: s.grade.grain,
      gain: s.grade.gain,
      shadow: s.grade.shadow,
    },
    warmthDirection: s.grade.warmthDirection,
  };
}

/** 레이어 스펙 → 완성된 테마. */
export function buildInvasionTheme(s: InvasionLayerSpec): EnvTheme {
  return {
    id: s.id,
    name: s.name,
    planets: [s.planet],
    light: s.light,
    parallax: buildParallax(s),
    decals: buildDecals(s),
    terrainLight: buildTerrainLight(s),
    atmosphere: buildAtmosphere(s),
    grade: buildGrade(s),
  };
}
