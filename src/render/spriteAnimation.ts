/**
 * 아군·이익 오브젝트 루프 애니메이션 (사용자 요청 2026-07-26).
 *
 * 아트는 가로 스트립 PNG 한 장(`assets/anim_<name>.png` — 9프레임 × 64px)으로 들어오고,
 * {@link src/render/textures.ts} 가 프레임 사각형으로 잘라 텍스처 배열을 만든다. 이 모듈은
 * "지금 몇 번째 프레임인가"만 정하는 **순수 함수**다.
 *
 * ── 결정론(ADR-0005) ── render-only. 프레임 선택은 렌더 벽시계 누적값의 함수이고 sim·
 * hashWorld 에 절대 닿지 않는다. 스프라이트 텍스처가 매 프레임 바뀌어도 sim 상태·리플레이는
 * 불변이다(표시 크기도 불변 — 스트립의 모든 프레임이 같은 치수다).
 */

import type { EntityKind } from '../sim/entities.js';

/** 애니메이션이 있는 kind 의 키(텍스처 슬롯 이름과 같다). */
export type AnimatedKind =
  | 'turretPickup'
  | 'magnetEmitter'
  | 'bombDevice'
  | 'supply'
  | 'loot'
  | 'gem';

/** kind → 애니메이션 슬롯. 애니메이션이 없는 kind 는 null(정지 스프라이트 유지). */
export function animatedKindOf(kind: EntityKind): AnimatedKind | null {
  switch (kind) {
    case 'turretPickup':
    case 'magnetEmitter':
    case 'bombDevice':
    case 'supply':
    case 'loot':
    case 'gem':
      return kind;
    default:
      return null;
  }
}

/** 루프 재생 속도(프레임/초). placeholder, defer-balance-tuning. */
export const ANIM_FPS = 8;

/**
 * 지금 표시할 프레임 인덱스.
 *
 * `phase` 는 **엔티티마다 다른 시작 위상**이다(호출측이 엔티티 id 로 준다). 없으면 화면의 젬
 * 수십 개가 한 프레임씩 동시에 깜빡여 기계적으로 보인다 — 위상을 흩뜨리면 같은 루프도 살아 있는
 * 것처럼 읽힌다.
 *
 * `elapsedS` 가 음수·비유한이거나 `frameCount` 가 1 이하면 0 을 돌려준다(방어적).
 */
export function animFrameIndex(elapsedS: number, frameCount: number, phase: number): number {
  if (frameCount <= 1 || !Number.isFinite(elapsedS) || elapsedS < 0) return 0;
  const advanced = Math.floor(elapsedS * ANIM_FPS) + phase;
  return ((advanced % frameCount) + frameCount) % frameCount;
}

/** 엔티티 id → 시작 위상(프레임). 결정론적이고 균등하게 흩어진다. */
export function phaseForEntity(id: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  return ((id % frameCount) + frameCount) % frameCount;
}
