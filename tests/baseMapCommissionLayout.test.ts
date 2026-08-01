/**
 * 기지 맵 타일 배치 넘침 회귀 테스트(지시 수신소 추가 — 7번째 건물).
 *
 * 캔버스 스텁으로는 이 결함을 못 잡는다 — 넘침은 실제 화면 픽셀 검증(하네스)에서만 눈에
 * 보이고, 좌표 산술 자체는 순수 함수라 Pixi 없이 부등식으로 잠글 수 있다(계획 규율 —
 * "겹침·넘침은 순수 레이아웃 함수 + 부등식으로 잠근다", `refineryDetailLayout` 선례).
 *
 * ⚠️ **이 테스트가 통과하면서도 참일 수 있는 나쁜 상태**: `tilePosition` 이 화면 폭 안에는
 * 들어오지만 행 안에서 타일끼리 겹치는 경우(예: `rowSplit` 이 옳아도 `col*(TILE_W+GAP)` 산술이
 * 틀리면 두 타일이 같은 x 를 가질 수 있다) — 그래서 아래 겹침 테스트를 화면 폭 테스트와
 * **병용**한다(부등식 하나만으로는 못 잡는 사각지대).
 */

import { describe, it, expect } from 'vitest';
import { tilePosition, rowSplit, TILE_W } from '../src/ui/pixi/baseMap.js';
import { DESIGN_WIDTH } from '../src/render/app.js';

// 실측 함정 — 옛 "1행 최대 3칸 고정" 분배는 7건물에서 2행에 4칸을 몰아
// `4×470+3×36=1988px > 1920` 로 화면 밖으로 넘쳤다(§recon). 현재 BUILDINGS 는 7개
// (hangar·research·refinery·defense·control·archive·commission).
const BUILDING_COUNT = 7;

describe('rowSplit — 균등 반반 분배', () => {
  it('7건물은 4+3 으로 갈린다(옛 "3+나머지" 분배였다면 3+4 로 둘째 행이 더 컸다)', () => {
    expect(rowSplit(BUILDING_COUNT)).toEqual([4, 3]);
  });

  it('6건물(변경 전 상태)은 3+3 그대로다 — 회귀 없음', () => {
    expect(rowSplit(6)).toEqual([3, 3]);
  });
});

describe('tilePosition — 화면 폭 넘침 금지', () => {
  it('모든 타일이 [0, DESIGN_WIDTH] 안에 완전히 들어간다', () => {
    for (let i = 0; i < BUILDING_COUNT; i++) {
      const { x } = tilePosition(i);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + TILE_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });

  it('같은 행의 타일끼리 겹치지 않는다(화면 폭 안에 들어와도 열 산술이 겹칠 수 있다)', () => {
    const positions = Array.from({ length: BUILDING_COUNT }, (_, i) => tilePosition(i));
    for (let a = 0; a < positions.length; a++) {
      for (let b = a + 1; b < positions.length; b++) {
        const pa = positions[a]!;
        const pb = positions[b]!;
        if (pa.y !== pb.y) continue; // 다른 행은 겹침 대상이 아니다.
        const overlapX = pa.x < pb.x + TILE_W && pb.x < pa.x + TILE_W;
        expect(overlapX).toBe(false);
      }
    }
  });
});
