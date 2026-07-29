/**
 * scripts/env-verify/assetColor.mjs 의 테스트 지원용 타입 선언 (companion declaration file).
 *
 * assetColor.mjs 는 "의존성 0" 규약을 지키는 plain JS(.mjs)라 tsconfig 에서 allowJs 를 켜지
 * 않는다. `tests/*.test.ts` 가 이 모듈을 import 할 때 `tsc --noEmit` 이 통과하도록 실제로
 * export 하는 공개 표면만 여기서 선언한다(scripts/asset-prep.d.mts 와 같은 최소-표면 원칙).
 */

export type Rgb = { r: number; g: number; b: number };

export const ROOT: string;

export function luma(r: number, g: number, b: number): number;
export function sat(r: number, g: number, b: number): number;
export function hue(r: number, g: number, b: number): number;
export function rgbDeltaSum(a: Rgb, b: Rgb): number;
export function relLuma(c: Rgb): number;
export function scaleToMean(c: Rgb, mean: number): Rgb;
export function unpackRgb(n: number): Rgb;

export type RgbaImage = { w: number; h: number; rgba: Uint8Array };
export function loadRgba(path: string): RgbaImage;

export const ENEMY_SPRITE_FILES: Readonly<Record<string, readonly string[]>>;
export const BODY_MIN_LUMA: number;
export const BODY_MIN_SAT: number;

export type EnemyBody = Rgb & { file: string; n: number };
export function enemyBodyColor(file: string): EnemyBody | null;
export function enemyBodyColors(planet: string): EnemyBody[];

/** Wang key(0~15) → 그 타일의 평균색. 자산이 없으면 `null`, 개별 key 가 비면 그 칸이 `null`. */
export function wangTileMeans(tileset: string): (Rgb | null)[] | null;
