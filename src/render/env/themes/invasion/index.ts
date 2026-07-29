/**
 * 침공 3레이어 환경 테마 — L1 대기권 → L2 회랑 → L3 코어방.
 *
 * ## 왜 합성 행성 인덱스인가
 * 침공 런의 `config.planet` 은 **항상 0**(카르곤)이다. 그대로 `env.configure({planet})` 하면
 * 침공에서 카르곤 화산 테마가 나온다 — 자산이 있고 배선이 있는데 화면만 틀린, 가장 잡기 어려운
 * 종류의 결함이다. 그래서 침공은 행성 축을 쓰지 않고 **행성 6종(0~5)이 점유하지 않는 합성
 * 인덱스**를 쓴다. `EnvThemeMeta.planets` 가 원래 "한 테마가 여러 행성을 담당할 수 있다"를
 * 허용하므로 계약 변경 없이 성립한다.
 *
 * 인덱스는 **페이즈 코드 + 오프셋**이라 페이즈에서 파생된다(손으로 적은 표가 아니다).
 *
 * ## 세 레이어의 정체성
 * 진행할수록 **점점 인공적이고 점점 위협적**이다 — 그래야 페이즈 전진이 화면으로 읽힌다.
 * 밝기로 그 축을 만들지 않는 것이 중요하다: 지형 면이 밝아지면 그 위의 적·탄이 위장된다.
 * 대신 색상각(차가운 하늘 → 인공 청록 → 코어 보라)과 발광의 **집중도**로 만든다.
 */

import type { EnvTheme } from '../../theme.js';
import { buildInvasionTheme } from './factory.js';

/**
 * 침공 테마가 점유하는 합성 행성 인덱스의 시작점. 행성 6종이 0~5 를 쓰므로 6 부터다.
 * 행성이 늘어나면 여기만 올린다 — 세 인덱스는 이 값에서 파생된다.
 */
export const INVASION_ENV_PLANET_BASE = 6;

/** 침공 레이어 수(= 페이즈 수). */
export const INVASION_LAYER_COUNT = 3;

/**
 * 침공 페이즈 코드 → 합성 행성 인덱스. `env.configure` 에 넘길 값의 정본.
 *
 * 페이즈 코드가 곧 인덱스라는 계약(`INVASION_BACKDROP_INDEX`·`INVASION_TILESET` 과 동일)에
 * 기대므로 `src/sim/` 을 import 하지 않는다 — 환경 테마는 렌더 전용이고 sim 을 읽지 않는다.
 * 범위 밖 페이즈는 L1 로 접는다(배경 텍스처 폴백과 같은 규율 — 화면이 비지 않는다).
 */
export function invasionEnvPlanet(phase: number): number {
  const idx = Number.isInteger(phase) && phase >= 0 && phase < INVASION_LAYER_COUNT ? phase : 0;
  return INVASION_ENV_PLANET_BASE + idx;
}

/**
 * L1 — **대기권**. 적 기지 상공. 광원이 위에 있고(성층권 위의 별빛/모항성) 지형은 구름 갑판이다.
 * 팔레트는 전부 204.2°~260.2° 골짜기(아군 시안 194.2° 와 퍼플 적탄 270.2° 사이)에 있다.
 * 자연스러운 하늘 시안(≈195°)은 아군 신호색과 사실상 같은 각도라 쓰지 않았다.
 */
export const INVASION_L1_THEME: EnvTheme = buildInvasionTheme({
  id: 'invasion_l1',
  name: '침공 L1 — 대기권',
  planet: INVASION_ENV_PLANET_BASE + 0,
  /** 광원이 **위**. 구름 갑판은 위에서 조명된다(카르곤과 정반대 부호). */
  light: { angle: -Math.PI / 2 + 0.3, shadowBias: 0.5 },
  // 타일셋 실측 근사(`node scripts/tileset-gen.mjs --planet invasion_l1 --dry-run`:
  // 하부 L 23.5 / 상부 L 45.6, 상부 면적 47%).
  luma: { base: 0.16, dark: 0.09, bright: 0.3 },
  bands: { shade: 0x08101e, bounce: 0x16227a, farGlow: 0x3f7ad8, nearPoint: 0x8fc4ff },
  decalBias: [0.92, 0.98, 1.12],
  decalGlow: { rim: 0x3c5a7e, face: 0x141e2c },
  channel: [
    { glow: 0x2f6ad0, core: 0x4f8ae8 },
    { glow: 0x2456c4, core: 0x3d78e0 },
    { glow: 0x3a7fe0, core: 0x5c96f0 },
    { glow: 0x1f4ab8, core: 0x3f74dc },
  ],
  rimColor: 0x6f9ce8,
  plumeColor: 0x1a44b0,
  duskTint: 0x363e4a,
  aoTint: 0x3e4652,
  shadowTint: 0x46505e,
  atmosphere: {
    backdrop: { r: 0x1c, g: 0x22, b: 0x31 },
    veil: 0x54627e,
    mote: 0x9aa8bc,
    plume: 0x7ea6e0,
    spark: 0x5aa8ff,
  },
  grade: {
    warm: 0xffc98a,
    cool: 0x5a6ab0,
    grain: 0xb0b4c0,
    gain: 0xffe6c8,
    shadow: 0x0020ff,
    warmthDirection: 1,
  },
});

/**
 * L2 — **회랑**. 기지 내부 통로. 광원은 천장 조명이고 지형은 금속 갑판이다.
 * 팔레트는 60.9°~184.2° 골짜기의 청록 끝(아군 시안 194.2° 에서 30° 이상 떨어진 자리).
 */
export const INVASION_L2_THEME: EnvTheme = buildInvasionTheme({
  id: 'invasion_l2',
  name: '침공 L2 — 회랑',
  planet: INVASION_ENV_PLANET_BASE + 1,
  /** 천장 조명 — 위지만 L1 보다 비스듬하다(실내라 광원이 가깝고 그림자가 길다). */
  light: { angle: -Math.PI / 2 + 0.55, shadowBias: 0.45 },
  luma: { base: 0.16, dark: 0.1, bright: 0.3 },
  bands: { shade: 0x08140f, bounce: 0x0a3028, farGlow: 0x158a6c, nearPoint: 0x4fbe9c },
  decalBias: [0.94, 1.02, 1.0],
  decalGlow: { rim: 0x2f6e5e, face: 0x12281f },
  channel: [
    { glow: 0x18c48e, core: 0x3ade9f },
    { glow: 0x11b07e, core: 0x2fd095 },
    { glow: 0x1fd0a4, core: 0x45e8b4 },
    { glow: 0x0f9c72, core: 0x28c290 },
  ],
  rimColor: 0x6fe0bc,
  plumeColor: 0x0c8c66,
  duskTint: 0x384440,
  aoTint: 0x3e4a46,
  shadowTint: 0x465250,
  atmosphere: {
    backdrop: { r: 0x1e, g: 0x25, b: 0x24 },
    veil: 0x566e66,
    mote: 0xa0b0a8,
    plume: 0x66d8b0,
    spark: 0x2effc0,
  },
  grade: {
    warm: 0xffbe74,
    cool: 0x3f8f88,
    grain: 0xb0bab4,
    gain: 0xffe2b8,
    shadow: 0x0030f0,
    warmthDirection: 1,
  },
});

/**
 * L3 — **코어방**. 적 코어의 심장부. 광원이 **아래**(바닥의 코어)로 내려와 L1 과 정확히 뒤집힌다.
 * 팔레트는 280.2°~305.0° 골짜기 안이다 — 폭이 24.8° 뿐이라 색을 손보면 각도를 반드시 다시 재라
 * (퍼플 적탄 270.2°, 마젠타 315.0°).
 */
export const INVASION_L3_THEME: EnvTheme = buildInvasionTheme({
  id: 'invasion_l3',
  name: '침공 L3 — 코어방',
  planet: INVASION_ENV_PLANET_BASE + 2,
  /** 광원이 **아래** — 코어가 바닥에서 뛴다. 데칼과 지형광이 이 한 값을 공유한다. */
  light: { angle: Math.PI / 2 - 0.25, shadowBias: 0.6 },
  luma: { base: 0.13, dark: 0.08, bright: 0.26 },
  bands: { shade: 0x0a0614, bounce: 0x3a1076, farGlow: 0xa040e0, nearPoint: 0xd68cff },
  decalBias: [1.02, 0.94, 1.1],
  decalGlow: { rim: 0x6a3c8a, face: 0x231430 },
  channel: [
    { glow: 0xcf30e8, core: 0xe14cf8 },
    { glow: 0xba28d0, core: 0xd940f0 },
    { glow: 0xca38e0, core: 0xe75cfc },
    { glow: 0xab20c0, core: 0xdd46f4 },
  ],
  rimColor: 0xd978e8,
  plumeColor: 0x9c18b0,
  duskTint: 0x40384a,
  aoTint: 0x463e50,
  shadowTint: 0x4e465a,
  atmosphere: {
    backdrop: { r: 0x1f, g: 0x19, b: 0x25 },
    veil: 0x6a5478,
    mote: 0xa89cb4,
    plume: 0xc060e0,
    spark: 0xc060ff,
  },
  grade: {
    warm: 0xff9a5c,
    cool: 0x7a5ab8,
    grain: 0xbcb0c0,
    gain: 0xffdcae,
    shadow: 0x0008ff,
    warmthDirection: 1,
  },
});

/** 페이즈 순서 그대로. 레지스트리와 테스트가 이 배열을 돈다. */
export const INVASION_THEMES: readonly EnvTheme[] = [
  INVASION_L1_THEME,
  INVASION_L2_THEME,
  INVASION_L3_THEME,
];
