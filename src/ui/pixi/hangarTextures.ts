/**
 * 격납고 화면 시네마틱 자산 로더 (`assets/hangar/*.webp`).
 *
 * ## 왜 `baseTextures.ts` 를 재사용하지 않는가
 * 그 파일은 **기지 화면이 쓰고 있고**(레인 계약 §2 "읽어서 배우되 수정하지 마라"), 목록 상수가
 * 기지 자산의 정본이다. 격납고 자산을 거기 얹으면 ①기지에 진입할 때 격납고 배경까지 디코드하고
 * ②리드의 자산 결손 가드가 "어느 화면의 결손인지"를 구분하지 못한다. 화면마다 목록이 하나씩인
 * 것이 결손 가드를 **양방향**(목록에만 있는 이름 / 파일만 있는 파일)으로 세울 수 있게 한다.
 *
 * ## 왜 `linear` 인가 (`baseTextures.ts` 헤더에서 승계)
 * `uiTextures.tryLoad` 는 `scaleMode = 'nearest'` 를 건다. 픽셀아트 UI 에는 맞지만 여기 원화는
 * **페인터리 회화를 확대**해 쓰므로(1024² → 1920 폭 커버 + 오버스캔) nearest 로 늘리면 붓자국이
 * 계단으로 부서진다.
 *
 * 로드 실패·미존재는 **키 자체가 없다** — 호출부가 자산 없이도 화면을 세워야 하기 때문이다
 * (레인 계약 §0-6 "자산은 덧붙임이지 전제가 아니다"). 그 방어가 결손을 조용하게 만드므로
 * 자산 결손 가드 테스트는 리드가 따로 건다.
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Assets, type Texture } from 'pixi.js';

/**
 * 격납고 풀블리드 배경. 원화 구성이 "우측 절반에 정비 도크, 좌측·하단은 어두운 석재"인 것은
 * **쇼케이스 창(디자인 x 952..1888)과 맞물리게** 생성했기 때문이다 — 창이 뚫리는 자리에 볼거리가
 * 오도록 구도를 미리 맞춘 것이고, 톤매핑은 그 구조를 뭉개지 않고 살리는 방향으로만 손댄다.
 */
export const HANGAR_BACKDROP_NAME = 'hangar_backdrop.webp';

/**
 * 격납고 화면이 요구하는 자산 목록. 지금은 배경 한 장뿐이다 — Lane B(석재 패널)·Lane C(크롬)는
 * 전부 **절차적**이라 새 자산을 요구하지 않는다는 것이 레인 계약이다(§3 Lane C 말미).
 */
export const HANGAR_ASSET_NAMES: readonly string[] = [HANGAR_BACKDROP_NAME];

/** basename → Texture(로드 성공) | undefined(미존재/실패). */
export type HangarTextures = Partial<Record<string, Texture>>;

// 이 파일은 src/ui/pixi/ 라 assets 까지 3단계 상위다(baseTextures.ts 와 같은 규약).
const HANGAR_ASSET_URLS = import.meta.glob('../../../assets/hangar/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 번들 URL(미등재면 undefined). */
export function hangarAssetUrl(basename: string): string | undefined {
  for (const key in HANGAR_ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return HANGAR_ASSET_URLS[key];
  }
  return undefined;
}

/** 격납고 자산을 병렬 로드한다. 누락은 키 자체가 없다(호출부가 옵셔널로 다룬다). */
export async function loadHangarTextures(): Promise<HangarTextures> {
  const out: HangarTextures = {};
  await Promise.all(
    HANGAR_ASSET_NAMES.map(async (name) => {
      const url = hangarAssetUrl(name);
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
