/**
 * 지형광 레이어 **테마 계약** — 이 파일은 지형광 레인이 소유한다.
 *
 * 여기 있어야 하는 것은 행성마다 달라지는 **데이터의 모양**과, 그 데이터가 지켜야 하는
 * **관계 불변식**이다. 메커니즘(기하·합성 순서·해시)은 레이어 구현에 남긴다.
 *
 * ## 이 레이어가 행성 무관인 이유
 * 마칭 스퀘어즈로 지형 필드의 등고선을 뽑아 **경계를 따라 흐르는 띠**를 그리는 것이 전부다.
 * "경계를 따라 흐르는 무엇"은 용암에만 있는 개념이 아니다 — 서릿발·산성 침출·포자 발광이
 * 같은 기하를 쓴다. 그래서 등고선 추출·법선 추정·합성 순서는 메커니즘이고, **무엇이 흐르는가**
 * (색·폭·알파·세기 필드·세 번째 겹의 기하)만 테마다.
 *
 * ## 이 파일을 채울 때의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 *   특히 **색상 안전창은 필드가 아니다** — {@link file://../color.ts} 의
 *   `computeSafeHueWindows` 로 계산하고 여기서는 **검증만** 한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateTerrainLightTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * 렌더 전용(ADR-0005).
 */

import type { EnvLightSpec, ThemeViolation } from '../theme.js';
import { violate } from '../theme.js';
import { computeSafeHueWindows, hueInAnyWindow, hueOf, paletteHueViolations } from '../color.js';
import { FOREGROUND_SIGNAL_COLORS } from '../../textures.js';

// ---------------------------------------------------------------------------
// 겹 등록 — 순서는 **물리**이고, 겹 집합은 **테마**다
// ---------------------------------------------------------------------------

/**
 * 합성 단계. **배열 {@link TERRAIN_LIGHT_STAGES} 의 순서가 곧 렌더 순서(뒤 → 앞)이며 이것은
 * 튜닝이 아니라 물리다.**
 *
 * 카르곤 3차의 결함이 정확히 이 축이었다: 곱연산 AO 를 가산 헤일로보다 **먼저** 칠했더니,
 * AO 의 자취가 헤일로의 부분집합이라 나중에 칠해진 가산 헤일로가 곱연산 어둠을 통째로
 * 되돌렸다. 알파를 아무리 올려도 화면에 안 나왔고 단위 테스트는 전부 그린이었다.
 *
 * 그래서 테마에게 "순서"를 주지 않는다 — 순서를 데이터로 노출하면 6개 레인 중 하나가
 * 반드시 그 함정을 다시 밟는다. 테마가 정하는 것은 **어느 겹을 켜는가**뿐이고, 각 겹이
 * 어느 단에 속하는지는 {@link TERRAIN_LIGHT_LAYERS} 가 고정한다.
 *
 * - `ambient`       — 화면 전체 곱연산 바닥 톤. 가장 뒤.
 * - `broadAdditive` — 넓은 가산 발광. 형태의 부피를 만든다.
 * - `contactShade`  — 좁고 진한 곱연산(접지 AO·캐스트 섀도). **넓은 가산보다 반드시 뒤에.**
 * - `focalAdditive` — 좁고 밝은 가산(심지·림). 곱연산 홈에 먹히면 안 되므로 그 위.
 * - `aerial`        — 경계에서 떨어져 뜨는 넓고 옅은 겹. 다른 겹과 자취가 겹치지 않는다.
 */
export type TerrainLightStage =
  | 'ambient'
  | 'broadAdditive'
  | 'contactShade'
  | 'focalAdditive'
  | 'aerial';

/** 렌더 순서(뒤 → 앞). {@link TerrainLightStage} 주석이 각 단의 근거다. */
export const TERRAIN_LIGHT_STAGES: readonly TerrainLightStage[] = [
  'ambient',
  'broadAdditive',
  'contactShade',
  'focalAdditive',
  'aerial',
];

/** 겹 식별자. 테마는 이 중 일부만 켤 수 있다(예: 서릿발 행성은 `plume` 을 뺀다). */
export type TerrainLightLayerId = 'dusk' | 'glow' | 'shadow' | 'ao' | 'core' | 'rim' | 'plume';

/**
 * 겹 → 단·합성모드 배정. **메커니즘 상수다(테마가 못 바꾼다).**
 *
 * 같은 단 안에서는 이 배열의 선언 순서가 렌더 순서다. `shadow` 가 `ao` 보다 앞인 이유:
 * 캐스트 섀도는 넓고 옅어 접지 AO 보다 항상 밝으므로, 겹치는 좁은 구간에서 진한 쪽이 이겨야 한다.
 */
export const TERRAIN_LIGHT_LAYERS: readonly {
  readonly id: TerrainLightLayerId;
  readonly stage: TerrainLightStage;
  readonly blend: 'add' | 'multiply';
}[] = [
  { id: 'dusk', stage: 'ambient', blend: 'multiply' },
  { id: 'glow', stage: 'broadAdditive', blend: 'add' },
  { id: 'shadow', stage: 'contactShade', blend: 'multiply' },
  { id: 'ao', stage: 'contactShade', blend: 'multiply' },
  { id: 'core', stage: 'focalAdditive', blend: 'add' },
  { id: 'rim', stage: 'focalAdditive', blend: 'add' },
  { id: 'plume', stage: 'aerial', blend: 'add' },
];

/**
 * 활성 겹들의 렌더 순서(뒤 → 앞) — **파생값이다. 테마 필드로 만들지 마라.**
 *
 * 단 순서로 먼저 가르고 같은 단 안에서는 {@link TERRAIN_LIGHT_LAYERS} 선언 순서를 지킨다.
 * 테마가 겹을 빼면 그 자리만 비고 나머지 상대 순서는 그대로다.
 */
export function terrainLightOrder(
  isActive: (id: TerrainLightLayerId) => boolean,
): readonly TerrainLightLayerId[] {
  const out: TerrainLightLayerId[] = [];
  for (const stage of TERRAIN_LIGHT_STAGES) {
    for (const l of TERRAIN_LIGHT_LAYERS) {
      if (l.stage === stage && isActive(l.id)) out.push(l.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 테마 데이터
// ---------------------------------------------------------------------------

/** 비어 있을 수 없는 읽기 전용 배열. 팔레트가 비면 폴백 색이 생기고, 폴백은 창을 샌다. */
export type NonEmpty<T> = readonly [T, ...T[]];

/**
 * 등고선 한 구간에 짝지어 쓰는 색 두 개(넓은 헤일로 · 좁은 심지).
 *
 * 짝으로 묶는 이유: 두 배열을 따로 두고 같은 인덱스로 접근하면 길이가 갈라지는 순간
 * 한쪽에 폴백이 필요해진다. **카르곤에서 그 폴백이 실제로 적탄 옆 색(30.6°)이었다** —
 * 팔레트 색상각 테스트가 훑지 못하는 구멍이었고, 짝 자료형이 그 구멍을 원천 봉쇄한다.
 */
export interface TerrainLightChannelColors {
  readonly glow: number;
  readonly core: number;
}

/** 넓은 가산 발광 띠. */
export interface TerrainLightGlowSpec {
  readonly alphaCap: number;
  readonly width: number;
  /** 단면 falloff 지수(클수록 중심에 몰린다). */
  readonly profileExp: number;
}

/** 좁고 밝은 심지. */
export interface TerrainLightCoreSpec {
  readonly alphaCap: number;
  readonly width: number;
  readonly profileExp: number;
}

/** 경계 **안쪽**(고지, +n)의 접지 어둠 띠. */
export interface TerrainLightAoSpec {
  readonly alphaCap: number;
  /** 곱연산 틴트. 완전 검정이 아니어야 그림자가 죽지 않는다. */
  readonly tint: number;
  readonly width: number;
  /** +n 쪽으로 미는 거리. 심지를 먹지 않을 만큼 크고, 띠로 읽힐 만큼 작아야 한다. */
  readonly offset: number;
  /**
   * 단면 **평정부 비율**. "띠"와 "블롭"을 가르는 유일한 인자다 — 0 이면 가장자리가 없는
   * 그라디언트라 폭·알파를 아무리 손봐도 "칠해진 영역"으로 읽힌다.
   */
  readonly plateau: number;
  /** 평정부 바깥 falloff 지수. */
  readonly falloffExp: number;
  /** 방향과 무관하게 모든 경계가 갖는 AO 세기 하한. */
  readonly floor: number;
}

/** 경계 **바깥**(저지, −n)으로 떨구는 넓고 부드러운 캐스트 섀도. */
export interface TerrainLightShadowSpec {
  readonly alphaCap: number;
  readonly tint: number;
  readonly width: number;
  /** −n + 빛 반대 편향 방향으로 떨구는 거리. 층 분리를 위해 AO 오프셋보다 훨씬 커야 한다. */
  readonly offset: number;
  /** 이보다 약하면 안 그린다(빛을 정면으로 받는 면은 그림자를 안 떨군다). */
  readonly minStrength: number;
}

/** 광원을 마주본 면에만 얹는 가는 가산 선. 코어 **바깥**에 앉아야 보인다. */
export interface TerrainLightRimSpec {
  readonly alphaCap: number;
  readonly color: number;
  readonly width: number;
  /** 폭 변조의 하한 비율. 1 이면 폭이 균일해져 "전방위 균일"로 되돌아간다. */
  readonly widthFloor: number;
  /** −n 쪽 오프셋(음수). */
  readonly offset: number;
  readonly minStrength: number;
}

/**
 * **세 번째 넓은 겹** — 이 레이어에서 행성 서사가 기하에 직접 박히는 유일한 자리.
 *
 * 카르곤에서는 "열기 기둥"이었다: 뜨거우니까 **위로** 올라가고 세로로 늘어난다. 그 두 성질
 * (`rise > 0` · `stretch > 1`)이 곧 "용암"이라는 전제이고, 다른 행성에서는 성립하지 않는다 —
 * 서릿발은 아래로 자라고(`rise < 0`), 포자는 방사·부유가 맞다(`rise ≈ 0` · `stretch ≈ 1`).
 * 그래서 값이 아니라 **기하 자체를 플러그로** 뺐고, 아예 없는 행성은 필드를 생략한다.
 */
export interface TerrainLightPlumeSpec {
  readonly alphaCap: number;
  readonly color: number;
  readonly width: number;
  /** 세로 늘임(가로 대비). 1 이면 등방. */
  readonly stretch: number;
  /** 경계에서 띄우는 거리. **양수면 위로, 음수면 아래로** 자란다. */
  readonly rise: number;
  readonly profileExp: number;
  /** 이 세기 미만의 경계에는 안 붙인다. 전 구간에 붙으면 화면이 균일한 안개가 된다. */
  readonly minStrength: number;
}

/** 화면 전체 곱연산 바닥 톤(지형만 누른다 — `floor` 슬롯이라 엔티티는 안 건드린다). */
export interface TerrainLightDuskSpec {
  readonly alpha: number;
  readonly tint: number;
}

/**
 * "어느 경계가 얼마나 살아 있는가"를 정하는 세기 필드.
 *
 * 두 개의 저주파 노이즈가 곱이 아니라 **바닥 + 상승**으로 합쳐진다: 잔열이 하한을 깔고,
 * 지역 필드가 그 위를 1 까지 끌어올린다. 곱으로 만들면 지역 필드가 0 인 곳에서 세기가
 * 0 이 되어 카르곤 3차 실패(경계 6할이 검음)가 재현된다.
 */
export interface TerrainLightIntensitySpec {
  /** "지금 살아 있는 구간" 저주파 필드의 스케일(타일). 크면 강이 길게 이어진다. */
  readonly regionTiles: number;
  /** 이 값을 넘는 지역만 최대 세기로 승격된다. */
  readonly regionThreshold: number;
  /** 임계를 넘은 뒤 최대에 닿기까지의 폭. */
  readonly regionSpan: number;
  /** 모든 경계가 갖는 세기 하한. **0 이면 3차 실패가 그대로 재현된다.** */
  readonly emberMin: number;
  /** 잔열 변조의 마루. */
  readonly emberMax: number;
  /**
   * 잔열 변조 필드의 스케일(타일). {@link regionTiles} 와 **크게 달라야** 한다 —
   * 비슷하면 두 필드의 마루가 겹쳐 변조가 지역 필드의 복사본이 되고, 결국 "살아 있는 곳은
   * 더 밝고 식은 곳은 더 어두운" 이분법으로 되돌아간다.
   */
  readonly emberModTiles: number;
  /** fbm 은 0.5 근처에 몰린다 — 이 창을 [0,1] 로 늘여야 변조 대비가 산다. */
  readonly emberRemapLo: number;
  readonly emberRemapHi: number;
  /**
   * 폭↔세기 서사. 실효 폭 배율 = `widthBase + widthGain × strength`.
   * 카르곤에서는 "식은 균열은 가는 선, 뜨거운 채널은 넓은 강"이었다. `widthGain` 이 0 이면
   * 폭이 균일해져 잔열이 화면을 도배한다(알파만 변조하는 구현은 이 축을 통과하지 못한다).
   */
  readonly widthBase: number;
  readonly widthGain: number;
}

/**
 * 지형광 레이어의 행성별 데이터.
 *
 * ⚠️ **광원 방향은 여기 없다.** `EnvTheme.light` 가 정본이고 데칼 레이어와 공유한다 —
 * 복제하면 화면에 태양이 둘이 된다.
 */
export interface TerrainLightTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
  /** 등고선 구간마다 해시로 하나를 고른다. 비어 있을 수 없다. */
  readonly channel: NonEmpty<TerrainLightChannelColors>;
  readonly dusk: TerrainLightDuskSpec;
  readonly glow: TerrainLightGlowSpec;
  readonly core: TerrainLightCoreSpec;
  readonly ao: TerrainLightAoSpec;
  readonly shadow: TerrainLightShadowSpec;
  readonly rim: TerrainLightRimSpec;
  /** 없으면 그 행성은 세 번째 넓은 겹을 안 그린다. */
  readonly plume?: TerrainLightPlumeSpec;
  readonly intensity: TerrainLightIntensitySpec;
}

// ---------------------------------------------------------------------------
// 파생값 — 필드가 아니라 함수다
// ---------------------------------------------------------------------------

/**
 * 이 레이어가 화면에 얹는 모든 색. **`LAVA_PALETTE` 를 손으로 적던 자리의 대체물이다** —
 * 색을 하나 추가하고 팔레트에 넣는 걸 잊으면 색상각 검사가 그 색을 영영 못 본다.
 */
export function terrainLightPalette(t: TerrainLightTheme): readonly number[] {
  const out: number[] = [];
  for (const c of t.channel) {
    out.push(c.glow, c.core);
  }
  out.push(t.rim.color);
  if (t.plume !== undefined) out.push(t.plume.color);
  return out;
}

/**
 * 배경이 살 수 있는 색상 골짜기 전부. **계산값이다.**
 *
 * 카르곤의 `[10°, 18.4°]` 는 입력이 아니라 hot-red(355.4°)와 앰버(28.5°) 적탄 사이 골짜기에서
 * 역산된 값이었다. 행성마다 이걸 손으로 다시 적으면 갈라진다 — 이 리포가 `UPPER_THRESHOLD`
 * 0.5 vs 0.57 로 이미 겪은 실패의 정확한 재현이다. 적탄 색이 바뀌면 전 행성 판정이 자동으로
 * 재평가되는 것이 이 함수의 목적이다.
 */
export function terrainLightSafeHueWindows(): ReturnType<typeof computeSafeHueWindows> {
  return computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, TERRAIN_LIGHT_HUE_GAP);
}

/** 전경 위험물(적탄·아군 표식)과 유지해야 하는 최소 색상각 거리(도). */
export const TERRAIN_LIGHT_HUE_GAP = 10;

/**
 * "실효 알파가 이 값 아래면 화면에 존재하지 않는 것"의 정본.
 *
 * 카르곤 1차의 기각 사유가 실효 0.05 붕괴였다. 세기 하한이 상한과 곱해져 이 값을 못 넘으면
 * 그 붕괴가 재현되므로 {@link validateTerrainLightTheme} 이 곱을 직접 검사한다.
 */
export const MIN_EFFECTIVE_ALPHA = 0.08;

/**
 * 광원을 **수직축에 투영해 재정규화**한 방향(−1 · 0 · +1).
 *
 * 이 레이어는 등고선을 따라 전방위로 도는 띠라, 광원에 좌우 성분이 있으면 시드마다 조명이
 * 기울어 지형이 "한쪽으로 쓰러진" 것처럼 보인다. 그래서 공유 광원({@link EnvLightSpec})에서
 * **방향만** 취하고 크기는 버린다 — 데칼 레이어는 같은 광원의 기울기를 그대로 쓰므로
 * 두 레이어의 기울기 차이는 남되 방향은 반드시 합의한다.
 *
 * 광원이 정확히 수평이면 0 을 돌려주고, 그 행성에서는 이 레이어의 방향 신호(림·캐스트 섀도)가
 * 사라진다. 조용히 반쯤 켜지는 것보다 명시적으로 없는 편이 낫다.
 */
export function verticalLightDir(light: EnvLightSpec): number {
  const y = Math.sin(light.angle);
  if (y > 1e-9) return 1;
  if (y < -1e-9) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

/**
 * 지형광 테마 검증. 빈 배열이면 통과.
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다. 아래는 전부 카르곤이 실제로
 * 밟은 함정이고, 문서로만 남기면 6개 레인이 각자 다시 밟는다.
 */
export function validateTerrainLightTheme(t: TerrainLightTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  violate(out, t.themeId.length > 0, 'themeId', '테마 슬러그가 비었다');
  violate(out, t.channel.length > 0, 'channel', '채널 색이 비면 폴백 색이 생기고 폴백은 안전창을 샌다');

  // ── 알파 상한: 개별 범위 + "넓은 겹은 낮게, 좁은 겹만 밝게"
  const caps: { where: string; v: number }[] = [
    { where: 'dusk.alpha', v: t.dusk.alpha },
    { where: 'glow.alphaCap', v: t.glow.alphaCap },
    { where: 'core.alphaCap', v: t.core.alphaCap },
    { where: 'ao.alphaCap', v: t.ao.alphaCap },
    { where: 'shadow.alphaCap', v: t.shadow.alphaCap },
    { where: 'rim.alphaCap', v: t.rim.alphaCap },
  ];
  if (t.plume !== undefined) caps.push({ where: 'plume.alphaCap', v: t.plume.alphaCap });
  for (const c of caps) {
    violate(out, c.v > 0 && c.v < 1, c.where, `상한은 (0,1) 안이어야 한다: ${c.v}`);
  }
  // 넓은 겹이 단독으로 화면을 덮으면 국소 대비가 사라진다.
  const wide: { where: string; v: number }[] = [
    { where: 'dusk.alpha', v: t.dusk.alpha },
    { where: 'glow.alphaCap', v: t.glow.alphaCap },
    { where: 'shadow.alphaCap', v: t.shadow.alphaCap },
  ];
  if (t.plume !== undefined) wide.push({ where: 'plume.alphaCap', v: t.plume.alphaCap });
  for (const c of wide) violate(out, c.v <= 0.55, c.where, `넓은 겹의 상한이 과하다: ${c.v}`);
  for (const c of [
    { where: 'core.alphaCap', v: t.core.alphaCap },
    { where: 'rim.alphaCap', v: t.rim.alphaCap },
    { where: 'ao.alphaCap', v: t.ao.alphaCap },
  ]) {
    violate(out, c.v <= 0.8, c.where, `좁은 겹이라도 상한이 과하다: ${c.v}`);
  }
  // 2단 구조: 심지가 헤일로와 비슷한 밝기면 "같은 밝기의 두 겹"으로 읽힌다(3차 비평).
  violate(
    out,
    t.core.alphaCap >= t.glow.alphaCap * 1.8,
    'core.alphaCap',
    `심지가 헤일로 대비 1.8배 미만이면 광원으로 안 읽힌다: ${t.core.alphaCap} vs ${t.glow.alphaCap}`,
  );
  // 화면 전체 어둡기는 그레이딩·시차의 자리다. 이 레이어의 본령은 국소 발광이다.
  violate(
    out,
    t.dusk.alpha < t.glow.alphaCap,
    'dusk.alpha',
    `황혼이 국소 발광보다 강하다: ${t.dusk.alpha} ≥ ${t.glow.alphaCap}`,
  );
  // 심지가 더 날카로워야 "총 밝은 면적은 그대로, 첨두 명도만" 이 성립한다.
  violate(
    out,
    t.core.profileExp > t.glow.profileExp,
    'core.profileExp',
    `심지 falloff 가 헤일로보다 완만하면 2단 구조가 무너진다: ${t.core.profileExp} ≤ ${t.glow.profileExp}`,
  );

  // ── 자취(오프셋·폭) 관계. 여기가 4차 실패의 무게중심이다 —
  //    "그렸는가"는 스프라이트 속성으로 잡히지만 "덮이는가"는 관계로만 잡힌다.
  const coreHalf = t.core.width / 2;
  violate(
    out,
    t.ao.offset > coreHalf,
    'ao.offset',
    `AO 띠가 심지를 먹는다: offset ${t.ao.offset} ≤ coreWidth/2 ${coreHalf}`,
  );
  violate(
    out,
    t.rim.offset < -coreHalf,
    'rim.offset',
    `림이 심지 안에 갇힌다: offset ${t.rim.offset} ≥ -coreWidth/2 ${-coreHalf}`,
  );
  // 오프셋만으로는 부족하다 — 림은 **폭을 가진 띠**라 반폭까지 빼야 실제로 코어 밖이다.
  violate(
    out,
    Math.abs(t.rim.offset) - t.rim.width / 2 > coreHalf,
    'rim.width',
    `림 띠의 안쪽 가장자리가 아직 심지 안이다: |${t.rim.offset}| - ${t.rim.width / 2} ≤ ${coreHalf}`,
  );
  violate(
    out,
    t.shadow.offset > t.ao.offset * 2,
    'shadow.offset',
    `캐스트 섀도와 접지 AO 가 같은 층으로 뭉친다: ${t.shadow.offset} ≤ ${t.ao.offset * 2}`,
  );
  // AO 가 넓은 겹의 진부분집합에 가까우면 "띠"가 아니라 "얼룩"이다(3차 폭 58 이 그랬다).
  violate(
    out,
    t.ao.width < t.glow.width * 0.5,
    'ao.width',
    `AO 가 헤일로에 대해 띠로 읽히기엔 넓다: ${t.ao.width} ≥ ${t.glow.width * 0.5}`,
  );
  violate(
    out,
    t.ao.width < t.shadow.width * 0.5,
    'ao.width',
    `접지 AO 와 캐스트 섀도의 폭이 안 갈린다: ${t.ao.width} ≥ ${t.shadow.width * 0.5}`,
  );
  // 가장자리가 있어야 띠다. 평정부 0 은 폭·알파와 무관하게 블롭으로 되돌린다.
  violate(
    out,
    t.ao.plateau >= 0.3 && t.ao.plateau < 1,
    'ao.plateau',
    `평정부가 없으면 또렷한 띠가 아니라 흐린 블롭이다: ${t.ao.plateau}`,
  );
  violate(out, t.ao.floor > 0 && t.ao.floor <= 1, 'ao.floor', `AO 하한이 (0,1] 밖: ${t.ao.floor}`);
  // 폭 변조가 죽으면 방향 정보가 알파 한 축으로 줄어 "전방위 균일"에 가까워진다.
  violate(
    out,
    t.rim.widthFloor > 0 && t.rim.widthFloor < 1,
    'rim.widthFloor',
    `림 폭 변조가 사문화됐다(1 이면 균일): ${t.rim.widthFloor}`,
  );

  // ── 세기 필드
  const it = t.intensity;
  violate(out, it.emberMin > 0, 'intensity.emberMin', '세기 하한 0 = 완전히 꺼진 경계가 생긴다');
  violate(
    out,
    it.emberMax > it.emberMin && it.emberMax <= 1,
    'intensity.emberMax',
    `잔열 상한이 하한 이하이거나 1 초과: ${it.emberMax}`,
  );
  // "꺼지지 않는다"는 0 이 아님으로 부족하다 — 상한과 곱해 실제로 보여야 한다(1차 붕괴 방지).
  for (const c of [
    { where: 'glow.alphaCap', v: t.glow.alphaCap },
    { where: 'core.alphaCap', v: t.core.alphaCap },
  ]) {
    violate(
      out,
      it.emberMin * c.v >= MIN_EFFECTIVE_ALPHA,
      'intensity.emberMin',
      `가장 약한 경계의 실효 알파가 붕괴 수준이다: ${it.emberMin} × ${c.v} < ${MIN_EFFECTIVE_ALPHA} (${c.where})`,
    );
  }
  violate(
    out,
    it.emberRemapHi > it.emberRemapLo,
    'intensity.emberRemapHi',
    `재사상 창이 뒤집혔다: ${it.emberRemapLo} ≥ ${it.emberRemapHi}`,
  );
  violate(out, it.regionTiles > 0, 'intensity.regionTiles', '지역 필드 스케일이 0 이하');
  violate(out, it.emberModTiles > 0, 'intensity.emberModTiles', '잔열 변조 스케일이 0 이하');
  // 두 필드가 비슷한 스케일이면 변조가 지역 필드의 복사본이 되어 강약이 사라진다.
  {
    const ratio =
      it.regionTiles > it.emberModTiles
        ? it.regionTiles / it.emberModTiles
        : it.emberModTiles / it.regionTiles;
    violate(
      out,
      ratio >= 1.5,
      'intensity.emberModTiles',
      `지역 필드와 스케일이 너무 가깝다(변조가 복사본이 된다): 비 ${ratio.toFixed(2)}`,
    );
  }
  violate(
    out,
    it.widthGain > 0,
    'intensity.widthGain',
    '폭 변조가 0 이면 약한 경계가 화면을 도배한다',
  );
  violate(
    out,
    it.widthBase > 0 && it.widthBase + it.widthGain <= 1,
    'intensity.widthBase',
    `폭 배율이 (0,1] 을 벗어난다: ${it.widthBase} + ${it.widthGain}`,
  );
  violate(
    out,
    it.regionThreshold > 0 && it.regionThreshold < 1,
    'intensity.regionThreshold',
    `지역 임계가 (0,1) 밖: ${it.regionThreshold}`,
  );
  violate(out, it.regionSpan > 0, 'intensity.regionSpan', '지역 전이 폭이 0 이하');

  // ── 세 번째 넓은 겹
  if (t.plume !== undefined) {
    violate(
      out,
      t.plume.minStrength > it.emberMax,
      'plume.minStrength',
      `가장 넓은 겹이 잔열 구간에도 붙어 화면이 균일한 안개가 된다: ${t.plume.minStrength} ≤ ${it.emberMax}`,
    );
    violate(out, t.plume.stretch > 0, 'plume.stretch', `세로 늘임이 0 이하: ${t.plume.stretch}`);
    violate(out, t.plume.width > 0, 'plume.width', `폭이 0 이하: ${t.plume.width}`);
  }

  // ── 색상 안전창. 창은 계산값이고 테마는 검증만 받는다.
  const windows = terrainLightSafeHueWindows();
  const palette = terrainLightPalette(t);
  violate(
    out,
    windows.length > 0,
    'channel',
    '전경 신호색이 색상환을 다 덮어 안전 골짜기가 없다(색상각으로는 분리 불가)',
  );
  for (const c of palette) {
    violate(
      out,
      hueInAnyWindow(hueOf(c), windows),
      'channel',
      `색 #${c.toString(16).padStart(6, '0')}(${hueOf(c).toFixed(1)}°)가 안전 골짜기 밖이다`,
    );
  }
  // 창 검사와 개별 거리 검사는 서로를 대체하지 않는다 — 무채색은 창 판정에서 빠지므로
  // 거리 검사가 별도로 돈다.
  for (const v of paletteHueViolations(palette, FOREGROUND_SIGNAL_COLORS, TERRAIN_LIGHT_HUE_GAP)) {
    out.push({
      where: 'channel',
      message: `색 #${v.color.toString(16).padStart(6, '0')} 이 전경 신호색 #${v.nearestHostile
        .toString(16)
        .padStart(6, '0')} 에서 ${v.distance.toFixed(1)}° 밖에 안 떨어졌다`,
    });
  }

  return out;
}
