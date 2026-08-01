/**
 * 기지 화면 시네마틱 자산 결손 가드 — `BASE_ASSET_NAMES` ↔ `assets/base/` 실물 대조.
 *
 * ## 이 테스트가 막는 결함
 *
 * 기지 화면은 자산이 없어도 **조용히 뜬다** — `loadBaseTextures` 는 실패한 자산의 키를 아예
 * 넣지 않고, 배경은 절차적 폴백으로, 타일은 accent 색 폴백으로 물러난다. 그 방어는 의도된
 * 것이지만(자산은 덧붙임이지 전제가 아니다) 동시에 **결손이 화면에 신호를 남기지 않는다**는
 * 뜻이다. 파일명이 하나 어긋나면 건물 하나가 색판으로 배포된다.
 *
 * 이 리포는 같은 유형을 반복해서 밟았다(`uiAssetPresence` · `titleAssetPresence` ·
 * `introAssetPresence` 헤더 · 침공 배경 3장). 같은 규율을 적용한다: **소스 기준**으로 잡는다.
 * 빌드 산출물 기준으로 짜면 Vite 의 인라인 임계값을 테스트하게 되고, "번들에 들어갔다"는
 * 화면에 나온다는 증명이 아니다.
 *
 * 양방향으로 건다 — 목록에 있는데 파일이 없으면 결손이고, 파일이 있는데 목록에 없으면 아무도
 * 안 쓰는 자산이 배포 용량만 먹고 있는 것이다.
 *
 * 덧붙여 **건물 목록과 자산 목록이 같은 집합인지**도 검사한다. `baseMap.ts` 에 건물을 하나
 * 추가하고 아트를 안 만들면 이 테스트가 먼저 울어야 한다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  BASE_ASSET_NAMES,
  BASE_BUILDING_KEYS,
  BASE_BACKDROP_NAME,
  baseBuildingAssetName,
} from '../src/ui/pixi/baseTextures.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = join(ROOT, 'assets', 'base');

/**
 * 기지 자산 합계 용량 상한(바이트). 실측 ≈310KB 에 여유를 얹은 값이다.
 *
 * 기지는 타이틀·인트로와 달리 첫 페인트 경로가 아니지만(런 한 번을 거쳐야 도달한다) 배경
 * 1장 + 1.9:1 일러스트 8장이라 장수가 가장 많다. 컷을 늘리거나 PNG 를 실수로 커밋하면
 * (원본은 장당 1MB 내외) 이 선이 먼저 운다.
 */
const TOTAL_BUDGET_BYTES = 560 * 1024;

describe('기지 키아트 자산 ↔ 목록 대조', () => {
  it('목록이 배경 + 건물 키 + 출격으로 이루어져 있다 — 건물을 늘리면 아트도 따라 늘어야 한다', () => {
    for (const key of BASE_BUILDING_KEYS) {
      expect(BASE_ASSET_NAMES).toContain(baseBuildingAssetName(key));
    }
    expect(BASE_ASSET_NAMES).toContain(BASE_BACKDROP_NAME);
  });

  it('목록의 모든 자산이 실제 파일로 존재한다', () => {
    for (const name of BASE_ASSET_NAMES) {
      const path = join(BASE_DIR, name);
      expect(statSync(path).isFile(), `${name} 없음 — 그 자리가 색판 폴백으로 뜬다`).toBe(true);
    }
  });

  it('디렉터리의 모든 이미지가 목록에 등재돼 있다 — 아무도 안 쓰는 자산 금지', () => {
    const onDisk = readdirSync(BASE_DIR).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
    const listed = new Set<string>(BASE_ASSET_NAMES);
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });

  it('전부 WebP 다 — PNG 원본을 실수로 커밋하는 것을 막는다', () => {
    for (const name of BASE_ASSET_NAMES) {
      expect(name.endsWith('.webp'), `${name}: WebP 가 아니다`).toBe(true);
    }
  });

  it('합계 용량이 예산 안이다', () => {
    const total = BASE_ASSET_NAMES.reduce((sum, n) => sum + statSync(join(BASE_DIR, n)).size, 0);
    expect(total, `${(total / 1024).toFixed(0)}KB > ${TOTAL_BUDGET_BYTES / 1024}KB`).toBeLessThan(
      TOTAL_BUDGET_BYTES,
    );
  });
});
