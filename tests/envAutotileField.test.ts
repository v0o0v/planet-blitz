/**
 * 카르곤 Wang 바닥의 **지형 필드 계약** 잠금.
 *
 * 이 레인이 실제로 겪은 두 결함을 그대로 겨눈다:
 *  1. `kargonLavaLight.ts` 가 `DISPLAY_TILE`·`NOISE_SCALE`·`NOISE_SCALE_FINE`·
 *     `UPPER_THRESHOLD` 를 **복제**해 갖고 있었다. autotile 쪽에서 값을 바꾸면 발광과 지형의
 *     위상이 조용히 어긋난다. 그래서 네 상수를 export 로 승격했고, 여기서 **export 가 실제로
 *     존재하고 값이 문서와 일치하는지**를 잠근다(복제본이 다시 생기면 대조할 정본이 있다).
 *  2. upper 비율. upper 는 near-black 현무암이 아니라 **밝은 용암**이라, 50/50 으로 깔면 화면
 *     절반이 발광체가 되어 적·탄이 안 읽힌다. 임계 하나로 정해지는 값이므로 "대역 안"으로
 *     못 박는다. 상한만 재면 임계를 1.0 으로 올려도 통과하니 **하한도 함께** 잰다
 *     (용암이 아예 안 나오면 그것대로 화산 행성이 아니다).
 *
 * 3차에서 하나 더 붙었다:
 *  3. **채움 타일 변형**(`fill_variants`). 균일한 두 key(0·15)는 화면 대부분을 덮는데 그림이
 *     한 장뿐이라 타일보다 큰 무늬를 실을 수 없었다(실으면 64px 누비이불). 변형을 더해 그
 *     한계를 풀었는데, **경계 key 에 변형이 붙으면 실루엣이 두 종류가 되어 이음매에 노치가
 *     생긴다.** 자산 JSON 은 사람이 고칠 수 있으므로 "균일 key 만 허용"을 로더에서 강제하고
 *     여기서 잠근다.
 *
 * 그림 자체(무늬가 평평한지 등)는 여기서 검사할 수 없다 — PNG 판정이라 하네스 스크린샷 대조가
 * 정본이다. 여기서 잠그는 것은 그 그림을 **어디에 까느냐**와 **무엇을 깔아도 되느냐**다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DISPLAY_TILE,
  NOISE_SCALE,
  NOISE_SCALE_FINE,
  UPPER_THRESHOLD,
  terrainFieldAt,
  upperAt,
} from '../src/render/autotile.js';

/** 대표 시드 3종 × 120×80 격자에서 upper 로 분류된 꼭짓점 비율. */
function upperCoverage(threshold = UPPER_THRESHOLD): number {
  let total = 0;
  let upper = 0;
  for (const seed of [12345, 777, 20260729]) {
    for (let y = -40; y < 40; y++) {
      for (let x = -60; x < 60; x++) {
        total++;
        if (terrainFieldAt(seed, x, y) > threshold) upper++;
      }
    }
  }
  return upper / total;
}

describe('카르곤 Wang 지형 필드', () => {
  it('lavaLight 가 복제하던 네 상수를 export 한다', () => {
    // 값 자체를 적어 두는 이유: lavaLight 가 import 로 갈아타기 전까지 복제본과 대조할 정본이
    // 필요하고, 갈아탄 뒤에는 무단 변경을 이 줄이 잡는다.
    expect(DISPLAY_TILE).toBe(64);
    expect(NOISE_SCALE).toBe(8);
    expect(NOISE_SCALE_FINE).toBe(3.2);
    expect(UPPER_THRESHOLD).toBe(0.57);
  });

  it('upperAt 은 terrainFieldAt 을 임계로 자른 것과 정확히 같다', () => {
    // 두 함수가 갈라지면 "경계까지의 거리"로 발광을 놓는 쪽과 타일을 놓는 쪽이 어긋난다.
    for (let y = -12; y < 12; y++) {
      for (let x = -12; x < 12; x++) {
        expect(upperAt(4242, x, y)).toBe(terrainFieldAt(4242, x, y) > UPPER_THRESHOLD);
      }
    }
  });

  it('용암(upper) 면적이 25%~40% 대역 안이다', () => {
    const cov = upperCoverage();
    expect(cov).toBeGreaterThan(0.25);
    expect(cov).toBeLessThan(0.4);
  });

  it('임계가 실제로 면적을 움직인다(항진 방지)', () => {
    // 위 대역 테스트만 있으면 upperAt 이 임계를 무시해도 통과할 수 있다.
    expect(upperCoverage(0.5)).toBeGreaterThan(upperCoverage(0.57));
    expect(upperCoverage(0.57)).toBeGreaterThan(upperCoverage(0.68));
  });

  it('필드는 (seed, x, y) 의 순수 함수다', () => {
    expect(terrainFieldAt(9, 3, 4)).toBe(terrainFieldAt(9, 3, 4));
    expect(terrainFieldAt(9, 3, 4)).not.toBe(terrainFieldAt(10, 3, 4));
  });
});

describe('카르곤 타일셋 자산 계약', () => {
  interface KargonMeta {
    tileset_data: {
      tiles: { corners: Record<'NW' | 'NE' | 'SE' | 'SW', string> }[];
    };
    base_band?: number;
    fill_variants?: { key: number; band?: number }[];
  }
  // vitest 는 리포 루트에서 돈다(`vite.config` 의 envDir 규율과 같은 전제).
  const meta = JSON.parse(readFileSync('assets/tilesets/kargon.json', 'utf8')) as KargonMeta;

  it('16 개 코너 조합이 하나도 빠짐없이 정의돼 있다', () => {
    // 하나라도 비면 `loadWangTiles` 가 통째로 null 을 돌려 절차 TilingSprite 로 되돌아간다
    // — 즉 "타일셋이 조용히 사라진" 상태가 된다.
    const seen = new Set<number>();
    for (const t of meta.tileset_data.tiles) {
      const e = (c: string): number => (c === 'upper' ? 1 : 0);
      seen.add(
        (e(t.corners.NW) << 3) | (e(t.corners.NE) << 2) | (e(t.corners.SE) << 1) | e(t.corners.SW),
      );
    }
    expect(seen.size).toBe(16);
  });

  it('채움 변형은 균일 key(0·15) 에만 선언돼 있다', () => {
    // 경계 key 에 변형이 붙으면 같은 코너 조합에 실루엣이 둘이 되어 이음매가 어긋난다.
    // 로더가 이런 항목을 버리긴 하지만, 버려진 변형은 "왜 안 나오지"로만 드러나므로
    // 자산 쪽에서도 못 박는다.
    for (const v of meta.fill_variants ?? []) {
      expect([0, 15]).toContain(v.key);
    }
  });

  it('균일 key 는 변형을 실제로 갖는다(반복 완화가 사문화되지 않도록)', () => {
    // 변형이 0 이면 채움 셀은 rot180 두 가지뿐 — 3차에서 평평함을 풀어 준 여유가 사라진다.
    const perKey = new Map<number, number>();
    for (const v of meta.fill_variants ?? []) perKey.set(v.key, (perKey.get(v.key) ?? 0) + 1);
    expect(perKey.get(0) ?? 0).toBeGreaterThanOrEqual(3);
    expect(perKey.get(15) ?? 0).toBeGreaterThanOrEqual(3);
  });

  // 4차: 밀도 밴드. 변형이 밀도 등급별로 나뉘고, `autotile.ts` 의 `bandAt` 이 저주파 필드로
  // 등급을 골라 정적/파쇄 구역을 여러 타일에 걸친 덩어리로 만든다.
  it('밴드가 선언돼 있고 값이 0~2 범위다', () => {
    // 범위를 벗어난 값은 로더가 조용히 중간 밴드로 접는다 — 그러면 정적 구역이 사라지는데
    // 화면에서만 드러나므로 자산 쪽에서 못 박는다.
    expect(meta.base_band).toBeTypeOf('number');
    expect([0, 1, 2]).toContain(meta.base_band);
    for (const v of meta.fill_variants ?? []) expect([0, 1, 2]).toContain(v.band);
  });

  it('균일 key 는 **모든** 밴드에 그림이 둘 이상 있다', () => {
    // 한 밴드에 그림이 하나뿐이면 그 등급이 깔린 구역 전체가 같은 32px 이미지 ×회전 2가
    // 되어 64px 반복이 되돌아온다(정적 밴드에 슬래브가 둘뿐일 때 실제로 프리뷰에서 보였다).
    // 비어 있는 밴드는 더 나쁘다 — 로더가 기본 타일로 되돌려 변형이 통째로 사문화된다.
    for (const key of [0, 15]) {
      const perBand = [0, 0, 0];
      perBand[meta.base_band ?? 1]! += 1; // 기본 타일도 후보다
      for (const v of meta.fill_variants ?? []) {
        if (v.key === key && v.band !== undefined) perBand[v.band]! += 1;
      }
      for (let b = 0; b < 3; b++) {
        expect.soft(perBand[b], `key ${key} band ${b}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
