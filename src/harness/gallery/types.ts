/**
 * 프로토타입 갤러리 변형 계약 (Phase 1 — plan §AC-1.2/1.3/1.4; ADR-0031).
 *
 * 취향이 갈리는 6종 이펙트(폭발·글로우·디졸브·충격파·전환·세리머니)를 한 갤러리에서 라이브로
 * 비교해 사용자가 고르게 하는 "비주얼 스파이크" 단계의 공유 인터페이스다. 각 변형은 **프로덕션에
 * 승격될 실제 이펙트 구현**(목업 아님, AC-1.3)이며, 전부 render-only(sim·해시 무접촉, ADR-0005).
 *
 * ── 하나의 spawn 을 갤러리 셀과 헤드리스 스모크가 공유한다 ── 변형은 마운트 방식(갤러리 씬)과
 * 무관하게 `spawn(target, ctx)` 로 자기 표시 객체를 주어진 컨테이너에 그린다. 갤러리 씬은 이 핸들을
 * 매 프레임 update 하고, 배선 스모크 테스트(AC-1.4)는 같은 spawn 을 헤드리스로 호출해 target 의
 * child 증가로 "정규경로 배선"을 증명한다("갤러리에선 완벽한데 실 경로 미배선" 반복 결함 방어).
 */

import type { Container } from 'pixi.js';

/** 취향 결정 대상 6개 변형군의 id. */
export type GalleryGroupId =
  | 'explosion'
  | 'glow'
  | 'dissolve'
  | 'shockwave'
  | 'transition'
  | 'ceremony';

/** 변형 프리뷰 컨텍스트. 변형이 그려질 셀의 크기만 준다 — 변형은 이 사각형 안에 자기 이펙트를 그린다. */
export interface GalleryVariantContext {
  /** 이 변형이 그려질 셀의 폭(디자인 스페이스 px). 셀 로컬 좌표 (0,0)=좌상단, (width,height)=우하단. */
  width: number;
  /** 셀 높이(디자인 스페이스 px). */
  height: number;
}

/** 살아있는 변형 프리뷰 핸들. */
export interface GalleryVariantHandle {
  /**
   * 매 프레임 호출(초 단위 델타). **원샷 이펙트**(폭발·충격파·디졸브·세리머니)는 내부적으로 일정
   * 주기마다 스스로 재발화해 갤러리에서 계속 보이게 한다. **지속 이펙트**(글로우)는 맥동/유지한다.
   */
  update(elapsedSeconds: number): void;
  /** 표시 객체·필터·타이머를 전부 정리한다(셀 파괴 시). 누수 없이 target 에서 자기 것을 제거. */
  destroy(): void;
}

/**
 * 갤러리 변형 하나 = 프로덕션 승격 대상 실제 이펙트(목업 아님, AC-1.3). render-only.
 */
export interface GalleryVariant {
  /** 그룹 내 고유 id(선택 기록 키, `.omc/state/fx-gallery-choices.json`). 예: 'explosion-shard'. */
  id: string;
  /** 갤러리에 표시할 짧은 라벨(한글). */
  label: string;
  /** 무선택/침묵 시 기본 승격 후보(AC-1.5). 그룹당 정확히 하나만 true. */
  recommended?: boolean;
  /**
   * 이펙트의 표시 객체를 `target` 에 **동기적으로** 추가하고 핸들을 반환한다. spawn 직후
   * `target.children.length` 가 증가해야 한다(정규경로 배선 스모크의 근거, AC-1.4). 셀 로컬
   * 좌표계(0,0=좌상단)에 그린다. GL 이 없는 headless(node) 에서도 표시 객체 추가 자체는 성립해야
   * 하고, 셰이더 필터는 Phase 0 `tryCreateFilter` 로 감싸 GL 부재 시 graceful 하게 생략한다.
   */
  spawn(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle;
}

/** 변형군 하나(2~3개 변형). */
export interface GalleryGroup {
  id: GalleryGroupId;
  /** 갤러리 섹션 제목(한글). */
  title: string;
  /**
   * 시각 레지스터(계약): 'combat'=전투 SF 픽셀아트, 'meta'=메타 카툰나무풍. **meta 는 전투 SF
   * 글로우를 차용하지 않는다**(시각 레지스터 3종 경계 보존, ADR-0031). 폭발·글로우·디졸브·충격파는
   * combat, 전환·세리머니는 meta.
   */
  register: 'combat' | 'meta';
  /** 이 그룹의 라이브 변형들(2~3개). 정확히 하나가 recommended:true. */
  variants: GalleryVariant[];
}
