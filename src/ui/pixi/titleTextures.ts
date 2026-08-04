/**
 * 타이틀 키아트 레이어 로더 (`assets/title/*.webp`).
 *
 * ## 왜 `uiTextures.ts` 와 따로인가
 * 두 가지가 정반대다.
 *
 *  1. **포맷** — UI 자산은 `assets/*.png` 고 타이틀은 `assets/title/*.webp` 다. 타이틀 레이어는
 *     1376×768 풀블리드라 PNG 로 두면 4장에 6.3MB 인데, 이건 **앱의 첫 화면**이라 그대로
 *     첫 페인트 예산을 먹는다(WebP 로 440KB, 14배).
 *  2. **필터링** — `uiTextures.tryLoad` 는 `scaleMode = 'nearest'` 를 건다. 픽셀아트 UI 에는
 *     그게 맞지만 타이틀 키아트는 **페인터리 원화를 1.4배 확대**해 쓰므로 nearest 로 늘리면
 *     붓자국이 계단으로 부서진다. 여기서는 `linear` 를 명시한다.
 *
 * 로드 실패·미존재는 `undefined` 를 돌려준다 — 호출부(`titleScreen.ts`)가 자산 없이도
 * 텍스트만으로 화면을 세울 수 있어야 하기 때문이다(자산은 덧붙임이지 전제가 아니다).
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Assets, type Texture } from 'pixi.js';

/**
 * 타이틀이 요구하는 자산 목록. `tests/titleAssetPresence.test.ts` 가 이 목록과 `assets/title/`
 * 실물을 대조한다 — "번들에 들어갔다"가 아니라 **소스에 파일이 있다**를 잠근다.
 */
export const TITLE_ASSET_NAMES = [
  'title_sky.webp',
  'title_planet.webp',
  'title_frame.webp',
  'title_logo.webp',
] as const;

export type TitleAssetName = (typeof TITLE_ASSET_NAMES)[number];

/** basename → Texture(로드 성공) | undefined(미존재/실패). */
export type TitleTextures = Partial<Record<TitleAssetName, Texture>>;

// 이 파일은 src/ui/pixi/ 라 assets 까지 3단계 상위다(uiTextures.ts 와 같은 규약).
const TITLE_ASSET_URLS = import.meta.glob('../../../assets/title/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 번들 URL(미등재면 undefined). */
export function titleAssetUrl(basename: string): string | undefined {
  for (const key in TITLE_ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return TITLE_ASSET_URLS[key];
  }
  return undefined;
}

/** 모든 타이틀 레이어를 병렬 로드한다. 누락은 키 자체가 없다(호출부가 옵셔널로 다룬다). */
export async function loadTitleTextures(): Promise<TitleTextures> {
  const out: TitleTextures = {};
  await Promise.all(
    TITLE_ASSET_NAMES.map(async (name) => {
      const url = titleAssetUrl(name);
      if (url === undefined) return;
      try {
        const tex = await Assets.load<Texture>(url);
        // 페인터리 원화를 확대해 쓴다 — nearest 면 붓자국이 계단으로 부서진다(위 헤더 참조).
        tex.source.scaleMode = 'linear';
        out[name] = tex;
      } catch {
        // 무시: 자산은 덧붙임이라 없어도 화면은 서야 한다.
      }
    }),
  );
  return out;
}
