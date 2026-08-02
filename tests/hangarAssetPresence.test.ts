/**
 * 격납고 화면 시네마틱 자산 결손 가드 — `HANGAR_ASSET_NAMES` ↔ `assets/hangar/` 실물 대조.
 *
 * ## 이 테스트가 막는 결함
 *
 * 격납고는 자산이 없어도 **조용히 뜬다** — `loadHangarTextures` 는 실패한 자산의 키를 아예
 * 넣지 않고, 배경은 절차적 폴백으로 물러난다. 그 방어는 의도된 것이지만(자산은 덧붙임이지
 * 전제가 아니다) 동시에 **결손이 화면에 신호를 남기지 않는다**는 뜻이다.
 *
 * 이 화면은 특히 위험하다: 쇼케이스 패널이 **배경이 비치는 창**이라, 배경이 없으면 창 안이
 * 통째로 비어 "패널을 그리다 만 화면"이 된다. 배경 1장이 이 화면 시각 설계의 전제다.
 *
 * `baseAssetPresence` · `titleAssetPresence` · `introAssetPresence` 와 같은 규율을 쓴다:
 * **소스 기준**으로 잡는다(빌드 산출물 기준으로 짜면 Vite 인라인 임계값을 테스트하게 되고,
 * "번들에 들어갔다"는 화면에 나온다는 증명이 아니다). 양방향으로 건다 — 목록에 있는데 파일이
 * 없으면 결손이고, 파일이 있는데 목록에 없으면 아무도 안 쓰는 자산이 용량만 먹는 것이다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { HANGAR_ASSET_NAMES, HANGAR_BACKDROP_NAME } from '../src/ui/pixi/hangarTextures.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANGAR_DIR = join(ROOT, 'assets', 'hangar');

/**
 * 격납고 자산 합계 용량 상한(바이트). 실측 ≈49KB(배경 1장)에 여유를 얹은 값이다.
 *
 * 장수가 하나뿐이라 상한이 낮다 — PNG 원본(1.2MB)을 실수로 커밋하면 즉시 운다.
 */
const TOTAL_BUDGET_BYTES = 160 * 1024;

describe('격납고 키아트 자산 ↔ 목록 대조', () => {
  it('목록에 배경이 들어 있다', () => {
    expect(HANGAR_ASSET_NAMES).toContain(HANGAR_BACKDROP_NAME);
  });

  it('목록의 모든 자산이 실제 파일로 존재한다', () => {
    for (const name of HANGAR_ASSET_NAMES) {
      const path = join(HANGAR_DIR, name);
      expect(
        statSync(path).isFile(),
        `${name} 없음 — 쇼케이스 창이 통째로 비어 뜬다`,
      ).toBe(true);
    }
  });

  it('디렉터리의 모든 이미지가 목록에 등재돼 있다 — 아무도 안 쓰는 자산 금지', () => {
    const onDisk = readdirSync(HANGAR_DIR).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
    const listed = new Set<string>(HANGAR_ASSET_NAMES);
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });

  it('전부 WebP 다 — PNG 원본을 실수로 커밋하는 것을 막는다', () => {
    for (const name of HANGAR_ASSET_NAMES) {
      expect(name.endsWith('.webp'), `${name}: WebP 가 아니다`).toBe(true);
    }
  });

  it('합계 용량이 예산 안이다', () => {
    const total = HANGAR_ASSET_NAMES.reduce(
      (sum, n) => sum + statSync(join(HANGAR_DIR, n)).size,
      0,
    );
    expect(total, `${(total / 1024).toFixed(0)}KB > ${TOTAL_BUDGET_BYTES / 1024}KB`).toBeLessThan(
      TOTAL_BUDGET_BYTES,
    );
  });
});
