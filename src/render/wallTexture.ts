/**
 * 엄폐 벽 타일링 텍스처 (render-only).
 *
 * ## 고치는 결함
 * 벽은 절차 청크가 **크기를 굴려서** 만든다(반폭·반높이 각각 60~150 → 120~300px). 그런데
 * 렌더는 64×64 벽 텍스처 **한 장을 AABB 크기로 늘려** 그렸다. 그래서 벽마다 돌 무늬의 배율이
 * 제각각이고, 긴 벽일수록 무늬가 흐물흐물 늘어나 매우 어색했다(사용자 신고 2026-07-27:
 * "벽이 한 이미지를 늘려서 쓰기 때문에 매우 어색함. 이미지를 붙여서 쓰도록").
 *
 * ## 해법
 * 원본 텍스처 소스를 **반복(repeat) 주소 모드**로 두고, 프레임을 `타일 수 × 타일 크기` 로 키운
 * 파생 Texture 를 만든다. 스프라이트는 그 텍스처를 AABB 크기로 표시하므로 **무늬가 원본 배율에
 * 가깝게 반복**된다(늘림 없음). 타일 수는 반올림이라 잔여 배율은 최대 ±25% 안이고, 벽마다
 * 무늬 크기가 들쭉날쭉하던 문제가 사라진다.
 *
 * ## 왜 TilingSprite 가 아닌가
 * Pixi v8 의 `TilingSprite` 는 `Sprite` 를 상속하지 않는다(ViewContainer 계열). 엔티티 렌더러는
 * 추적 구조체가 `Sprite` 타입이고 회전·텍스처 교체·틴트·히트 플래시가 전부 그 타입에 걸려 있어,
 * 벽 하나 때문에 그 계약을 넓히면 표면이 크게 는다. 반복 프레임 텍스처는 같은 결과를 **Sprite
 * 그대로** 얻는다.
 *
 * ⚠️ 반복 주소 모드는 **텍스처 소스 전체**에 걸린다. 벽 텍스처는 자기 소스를 단독으로 쓰므로
 * (`assets/wall.png` 로드본 또는 `generateTexture` 폴백) 안전하지만, 아틀라스 한 칸을 쓰는
 * 텍스처에 이 함수를 쓰면 옆 칸이 새어 나온다 — 벽 전용으로만 쓸 것.
 */

import { Rectangle, Texture } from 'pixi.js';

/**
 * 파생 텍스처 캐시(키 = `소스 uid:타일수X×타일수Y`).
 *
 * ⚠️ **소스 uid 가 키에 반드시 들어가야 한다.** 예전에는 타일 수만으로 키를 잡았고, 그건 벽
 * 텍스처가 세상에 한 장뿐이라는 전제 위에서만 맞다. 벽 질감을 둘 이상 쓰는 순간 같은 타일 수를
 * 쓰는 다른 질감이 **서로의 캐시 항목을 집어 가** 엉뚱한 무늬가 그려진다 — 실제로 행성별 벽
 * 질감을 시험하다 이 결함을 만났다(2026-08-04). 질감은 다시 한 장으로 돌아갔지만, 전제에
 * 기대는 키는 그때 조용히 깨지므로 키를 고쳐 둔다.
 */
const cache = new Map<string, Texture>();

/** 한 축의 타일 수(최소 1). 반올림이라 잔여 스케일은 [0.67, 1.33] 안에 든다. */
export function tileCount(sizePx: number, tilePx: number): number {
  if (!Number.isFinite(sizePx) || !Number.isFinite(tilePx) || tilePx <= 0) return 1;
  return Math.max(1, Math.round(sizePx / tilePx));
}

/**
 * 벽 AABB(전폭·전높이)에 맞춰 **반복된** 벽 텍스처를 돌려준다. 원본이 1×1 타일이면 원본을
 * 그대로 돌려준다(파생 없음 = 기존 거동).
 *
 * 반환 텍스처는 캐시된 공유 객체다 — 호출부는 파괴하지 않는다.
 */
export function tiledWallTexture(base: Texture, widthPx: number, heightPx: number): Texture {
  const tw = base.frame.width;
  const th = base.frame.height;
  if (tw <= 0 || th <= 0) return base;
  const nx = tileCount(widthPx, tw);
  const ny = tileCount(heightPx, th);
  if (nx === 1 && ny === 1) return base;
  const key = `${base.source.uid}:${nx}x${ny}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // 소스에 반복 주소 모드를 걸어야 프레임을 키운 만큼 무늬가 이어진다(늘림이 아니라 반복).
  base.source.style.addressMode = 'repeat';
  const tex = new Texture({
    source: base.source,
    frame: new Rectangle(0, 0, tw * nx, th * ny),
  });
  cache.set(key, tex);
  return tex;
}

/** 테스트 격리용 — 캐시를 비운다(프로덕션 경로에서는 부르지 않는다). */
export function clearWallTextureCache(): void {
  cache.clear();
}
