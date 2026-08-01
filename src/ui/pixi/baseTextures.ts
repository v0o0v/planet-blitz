/**
 * 기지 화면 시네마틱 자산 로더 (`assets/base/*.webp`).
 *
 * ## 왜 로더가 하나인가
 * 기지 화면은 배경 1장(Lane A)과 건물 일러스트 7장(Lane B 타일)을 **같은 화면에서 동시에**
 * 쓴다. 레인마다 로더를 두면 같은 파일을 두 번 디코드하게 되고(1024² RGB ×7 은 첫 진입
 * 예산에서 무시할 수 없다), 두 목록이 갈라져 한쪽만 고쳐지는 결손도 생긴다. 그래서 목록과
 * 로드는 여기 한 곳이 정본이고, 타일은 텍스처를 **인자로 받는다**(레인 계약 §1).
 *
 * ## 왜 `uiTextures.ts` 가 아닌가
 * `uiTextures.tryLoad` 는 `scaleMode = 'nearest'` 를 건다. 픽셀아트 UI 에는 그게 맞지만 기지
 * 키아트는 **페인터리 원화를 확대**해 쓰므로(배경 1376×768 → 1920 폭 커버 + 오버스캔) nearest
 * 로 늘리면 붓자국이 계단으로 부서진다. 타이틀·인트로와 같은 이유로 `linear` 를 명시한다.
 *
 * 로드 실패·미존재는 **키 자체가 없다** — 호출부가 자산 없이도 화면을 세울 수 있어야 하기
 * 때문이다(자산은 덧붙임이지 전제가 아니다). 그 방어가 결손을 조용하게 만들므로 자산 결손
 * 가드 테스트를 리드가 따로 건다.
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Assets, type Texture } from 'pixi.js';

/**
 * 건물 키 → 일러스트 basename. **자산 이름 규약은 이 한 줄이 정본이다** — `baseMap.ts` 의
 * 건물 목록이 늘면 여기 키 배열만 따라 늘리면 되고, 이름을 손으로 적는 자리는 없다.
 */
export function baseBuildingAssetName(key: string): string {
  return `base_bld_${key}.webp`;
}

/** 풀블리드 배경(격납고 홀). 중앙은 타일 격자가 앉도록 의도적으로 비어 있다. */
export const BASE_BACKDROP_NAME = 'base_backdrop.webp';

/** 출격 카드(격자 8번째 칸)의 페인터리 아트. 건물이 아니므로 BASE_BUILDING_KEYS 밖이다. */
export const BASE_LAUNCH_NAME = 'base_launch.webp';

/**
 * 일러스트가 필요한 건물 키. `baseMap.ts` 의 `Building['key']` 와 같은 집합이어야 한다 —
 * 리드가 자산 결손 가드에서 **양방향**으로 대조한다(목록에만 있는 파일 / 파일만 있는 목록
 * 둘 다 결함이다).
 */
export const BASE_BUILDING_KEYS = [
  'hangar',
  'research',
  'refinery',
  'defense',
  'control',
  'archive',
  'commission',
] as const;

/**
 * 기지 화면이 요구하는 자산 목록(배경 1 + 건물 7 + 출격 1 = 9장). 건물 부분은 손으로 적지
 * 않고 키에서 파생한다. 리드의 자산 결손 가드가 이 목록과 `assets/base/` 실물을 **양방향**
 * 으로 대조하므로, 여기 빠진 파일은 "아무도 안 쓰는 자산"으로 잡힌다.
 */
export const BASE_ASSET_NAMES: readonly string[] = [
  BASE_BACKDROP_NAME,
  ...BASE_BUILDING_KEYS.map((k) => baseBuildingAssetName(k)),
  BASE_LAUNCH_NAME,
];

/** basename → Texture(로드 성공) | undefined(미존재/실패). */
export type BaseTextures = Partial<Record<string, Texture>>;

// 이 파일은 src/ui/pixi/ 라 assets 까지 3단계 상위다(titleTextures.ts 와 같은 규약).
const BASE_ASSET_URLS = import.meta.glob('../../../assets/base/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 번들 URL(미등재면 undefined). */
export function baseAssetUrl(basename: string): string | undefined {
  for (const key in BASE_ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return BASE_ASSET_URLS[key];
  }
  return undefined;
}

/** 기지 자산을 병렬 로드한다. 누락은 키 자체가 없다(호출부가 옵셔널로 다룬다). */
export async function loadBaseTextures(): Promise<BaseTextures> {
  const out: BaseTextures = {};
  await Promise.all(
    BASE_ASSET_NAMES.map(async (name) => {
      const url = baseAssetUrl(name);
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
