/**
 * 세계관 인트로 키아트 로더 (`assets/intro/*.webp`).
 *
 * ## 왜 `titleTextures.ts` 와 따로인가
 * 규약(WebP · `linear` 필터 · basename 글롭)은 같지만 **목록의 성격이 다르다.** 타이틀은
 * 레이어 4장이 한 화면을 이루는 고정 구성이고, 인트로는 `data/lore` 의 `INTRO_SLIDES` 배열이
 * 정본이라 **슬라이드가 늘면 자산도 따라 는다.** 그래서 목록을 손으로 적지 않고 슬라이드
 * id 에서 파생한다 — 정본이 하나면 둘이 어긋날 자리가 없다.
 *
 * ## 왜 `uiTextures.ts` 가 아닌가
 * `uiTextures.tryLoad` 는 `scaleMode = 'nearest'` 를 건다. 픽셀아트 UI 에는 그게 맞지만 인트로
 * 키아트는 **페인터리 원화(1376×768)를 1.4배 확대**해 쓰므로 nearest 로 늘리면 붓자국이
 * 계단으로 부서진다. 여기서는 `linear` 를 명시한다.
 *
 * 로드 실패·미존재는 `undefined` 를 돌려준다 — 호출부(`introSlides.ts`)가 자산 없이도 문구만
 * 으로 화면을 세울 수 있어야 하기 때문이다(자산은 덧붙임이지 전제가 아니다). 그 방어가
 * 결손을 조용하게 만들므로 `tests/introAssetPresence.test.ts` 가 별도로 잠근다.
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Assets, type Texture } from 'pixi.js';
import { INTRO_SLIDES } from '../../../data/lore/index.js';

/** 슬라이드 id → 키아트 basename. 자산 이름 규약은 이 한 줄이 정본이다. */
export function introAssetName(slideId: string): string {
  return `intro_${slideId}.webp`;
}

/**
 * 인트로가 요구하는 자산 목록 — `INTRO_SLIDES` 파생이다. `tests/introAssetPresence.test.ts` 가
 * 이 목록과 `assets/intro/` 실물을 **양방향**으로 대조한다.
 */
export const INTRO_ASSET_NAMES: readonly string[] = INTRO_SLIDES.map((s) => introAssetName(s.id));

/** basename → Texture(로드 성공) | undefined(미존재/실패). */
export type IntroTextures = Partial<Record<string, Texture>>;

// 이 파일은 src/ui/pixi/ 라 assets 까지 3단계 상위다(titleTextures.ts 와 같은 규약).
const INTRO_ASSET_URLS = import.meta.glob('../../../assets/intro/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 번들 URL(미등재면 undefined). */
export function introAssetUrl(basename: string): string | undefined {
  for (const key in INTRO_ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return INTRO_ASSET_URLS[key];
  }
  return undefined;
}

/** 모든 인트로 키아트를 병렬 로드한다. 누락은 키 자체가 없다(호출부가 옵셔널로 다룬다). */
export async function loadIntroTextures(): Promise<IntroTextures> {
  const out: IntroTextures = {};
  await Promise.all(
    INTRO_ASSET_NAMES.map(async (name) => {
      const url = introAssetUrl(name);
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
