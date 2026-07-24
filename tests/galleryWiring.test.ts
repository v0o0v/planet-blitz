/**
 * 프로토타입 갤러리 변형 정규경로 배선 스모크 (Phase 1 — plan §AC-1.4/1.5; ADR-0031).
 *
 * 이 프로젝트의 #1 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"이다(planet-blitz
 * 메모리, 통합 테스트로만 잡히는 8건). 갤러리 변형도 같은 함정에 빠질 수 있다 — 갤러리 씬에선
 * 완벽해 보이는데 spawn 이 실제 표시 객체를 안 붙이는 목업일 수 있다. 그래서 여기서는 각 변형의
 * **spawn 을 실제로 태워** target 컨테이너의 child 증가로 "동기 배선"을 증명한다(AC-1.4 핵심).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — 셰이더 필터는 변형 내부
 * `tryCreateFilter` 로 null 폴백되지만, **표시 객체(Graphics/Sprite/Text) 추가 자체는 성립**해야
 * 한다(types.ts 계약). 그래서 filter 유무가 아니라 **children 증가**를 검증한다. PixiJS 는 렌더러
 * 없이 import 만 하므로 node 에서 그대로 돈다(tests/invasionRender.test.ts 선례).
 *
 * 검증 3축:
 *  1. 배선 증명(AC-1.4): spawn 직후 `target.children.length > 0` — 실 표시 객체를 동기 추가.
 *  2. 수명 안전: update 반복 + 재발화 주기를 넘기는 큰 진행 + destroy 가 throw 없이 정리
 *     (Pixi v8 `Container.destroy()` 는 removeFromParent 하므로 destroy 후 target 이 빈다).
 *  3. 불변식(AC-1.5): 그룹당 recommended 정확히 하나 · 변형 id 유일 · 6그룹 전부 존재.
 */

import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { GALLERY_GROUPS } from '../src/harness/gallery/index.js';
import type { GalleryGroupId } from '../src/harness/gallery/index.js';

/** 갤러리 셀 프리뷰 컨텍스트(디자인 px). 실 갤러리 셀과 같은 스케일대. */
const CTX = { width: 240, height: 200 } as const;

/** plan §AC-1.2 가 규정한 취향 결정 대상 6종. 순서 무관 집합 비교용. */
const EXPECTED_GROUP_IDS: readonly GalleryGroupId[] = [
  'explosion',
  'glow',
  'dissolve',
  'shockwave',
  'transition',
  'ceremony',
];

// ---------------------------------------------------------------------------
// 불변식 (AC-1.5) — 그룹·변형 메타데이터. 표시 객체를 안 만들고 순수 검사.
// ---------------------------------------------------------------------------

describe('갤러리 레지스트리 불변식 (AC-1.5)', () => {
  it('6개 변형군(explosion/glow/dissolve/shockwave/transition/ceremony)을 전부 포함한다', () => {
    const ids = GALLERY_GROUPS.map((g) => g.id);
    expect(GALLERY_GROUPS).toHaveLength(6);
    // 순서 무관 — 6종이 정확히 한 번씩.
    expect([...ids].sort()).toEqual([...EXPECTED_GROUP_IDS].sort());
    expect(new Set(ids).size).toBe(6); // 그룹 id 중복 없음
  });

  it('변형 id 가 전역적으로 유일하다(선택 기록 키 충돌 방지)', () => {
    // 선택은 그룹당 기록되지만(fx-gallery-choices.json), id 가 group prefix 를 달아 전역 유일해야
    // 도구·로그가 변형을 모호함 없이 지목할 수 있다.
    const allIds = GALLERY_GROUPS.flatMap((g) => g.variants.map((v) => v.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  for (const group of GALLERY_GROUPS) {
    describe(`그룹 '${group.id}'`, () => {
      it('recommended:true 가 정확히 하나(무선택 시 기본 승격 후보)', () => {
        const recommended = group.variants.filter((v) => v.recommended === true);
        expect(recommended, `그룹 '${group.id}' 의 recommended 개수`).toHaveLength(1);
      });

      it('변형이 2~3개이고 id 가 그룹 내 유일하다', () => {
        const ids = group.variants.map((v) => v.id);
        expect(group.variants.length).toBeGreaterThanOrEqual(2);
        expect(group.variants.length).toBeLessThanOrEqual(3);
        expect(new Set(ids).size, `그룹 '${group.id}' 변형 id 중복`).toBe(ids.length);
      });

      it('register 가 combat|meta 계약값이다', () => {
        expect(['combat', 'meta']).toContain(group.register);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 배선 증명(AC-1.4) + 수명 안전 — 각 변형의 spawn 을 실제로 태운다.
// ---------------------------------------------------------------------------

describe('변형 정규경로 배선 · 수명 스모크 (AC-1.4)', () => {
  for (const group of GALLERY_GROUPS) {
    describe(`그룹 '${group.id}' (${group.variants.length}개 변형)`, () => {
      for (const variant of group.variants) {
        it(`'${variant.id}': spawn 이 표시 객체를 target 에 동기 추가한다 (배선 증명)`, () => {
          const target = new Container();
          expect(target.children.length).toBe(0); // 사전 조건 — 빈 컨테이너
          const handle = variant.spawn(target, { width: CTX.width, height: CTX.height });
          // ★ 핵심: spawn 직후 실 표시 객체가 붙어야 한다(목업이면 여기서 실패). GL 필터는 node 에서
          //   null 폴백이지만 Graphics/Text/Sprite 추가 자체는 성립한다(types.ts 계약).
          expect(
            target.children.length,
            `'${variant.id}' spawn 이 child 를 안 붙였다(미배선/목업 의심)`,
          ).toBeGreaterThan(0);
          handle.destroy(); // 케이스 정리
        });

        it(`'${variant.id}': update 반복·큰 진행·destroy 가 throw 없이 정리한다 (수명 안전)`, () => {
          const target = new Container();
          const handle = variant.spawn(target, { width: CTX.width, height: CTX.height });

          expect(() => {
            // 프레임 델타 다수 — 파티클 사망·재발화·맥동·카운트업 경로를 실제로 굴린다.
            for (let i = 0; i < 120; i++) handle.update(0.05); // ≈6초: 원샷 재발화 주기를 여러 번 통과
            handle.update(0.016); // 표준 60fps 프레임
            // 재발화 주기를 한 번에 넘기는 큰 진행 — dt 클램프/모듈러 정규화가 튀지 않아야 한다.
            handle.update(2);
            handle.update(2);
          }, `'${variant.id}' update 가 throw`).not.toThrow();

          expect(() => handle.destroy(), `'${variant.id}' destroy 가 throw`).not.toThrow();
          // Pixi v8 Container.destroy() 는 removeFromParent 한다 — 변형은 root 를 target 에서 떼어낸다.
          expect(
            target.children.length,
            `'${variant.id}' destroy 후 target 에 잔여 child(누수)`,
          ).toBe(0);
        });
      }
    });
  }

  it('전 변형이 배선 증명을 통과한다(한 곳에서 총량 확인)', () => {
    // 그룹·변형이 늘어도 이 합산이 자동으로 커진다 — 미배선 변형이 하나라도 있으면 아래 루프에서 실패.
    let spawned = 0;
    for (const group of GALLERY_GROUPS) {
      for (const variant of group.variants) {
        const target = new Container();
        const handle = variant.spawn(target, { width: CTX.width, height: CTX.height });
        expect(target.children.length, `'${variant.id}' 미배선`).toBeGreaterThan(0);
        handle.destroy();
        spawned += 1;
      }
    }
    // 현재 6그룹 × 3변형 = 18. 변형 추가 시 이 하한이 함께 올라야 한다(최소 그룹당 2 → 12).
    expect(spawned).toBeGreaterThanOrEqual(12);
  });
});
