/**
 * 타이틀 키아트 자산 결손 가드 — `TITLE_ASSET_NAMES` ↔ `assets/title/` 실물 대조.
 *
 * ## 이 테스트가 막는 결함
 *
 * 타이틀 화면은 자산이 없어도 **조용히 뜬다** — `loadTitleTextures` 는 실패한 레이어의 키를
 * 아예 넣지 않고, `titleScreen.render` 는 `undefined` 면 그 레이어를 건너뛴다. 그 방어는
 * 의도된 것이지만(자산은 덧붙임이지 전제가 아니다) 동시에 **결손이 화면에 신호를 남기지
 * 않는다**는 뜻이다. 파일명이 하나 어긋나면 하늘 없는 아치, 행성 없는 창이 그대로 배포된다.
 *
 * 이 리포는 같은 유형을 이미 밟았다(`uiAssetPresence.test.ts` 헤더 · 침공 배경 3장). 그래서
 * 같은 규율을 그대로 적용한다: **소스 기준**으로 잡는다. 빌드 산출물 기준으로 짜면 Vite 의
 * 인라인 임계값을 테스트하게 되고, "번들에 들어갔다"는 화면에 나온다는 증명이 아니다.
 *
 * 양방향으로 건다 — 목록에 있는데 파일이 없으면 결손이고, 파일이 있는데 목록에 없으면
 * 아무도 안 쓰는 자산이 배포 용량만 먹고 있는 것이다(타이틀은 앱의 첫 화면이라 그 낭비가
 * 곧 첫 페인트 비용이다).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TITLE_ASSET_NAMES } from '../src/ui/pixi/titleTextures.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLE_DIR = join(ROOT, 'assets', 'title');

/**
 * 타이틀 레이어 합계 용량 상한(바이트). 실측 440KB 에 여유를 얹은 값이다.
 *
 * 왜 상한을 거는가: 타이틀은 앱이 **가장 먼저** 그리는 화면이라 여기 용량이 첫 페인트를 직접
 * 민다. 레이어를 하나 더 넣거나 PNG 를 실수로 커밋하면(원본은 장당 1~2MB) 이 선이 먼저 운다.
 */
const TOTAL_BUDGET_BYTES = 900 * 1024;

describe('타이틀 키아트 자산 ↔ 목록 대조', () => {
  it('목록의 모든 자산이 실제 파일로 존재한다', () => {
    for (const name of TITLE_ASSET_NAMES) {
      const path = join(TITLE_DIR, name);
      expect(statSync(path).isFile(), `${name} 없음 — 화면에서 그 레이어가 조용히 사라진다`).toBe(
        true,
      );
    }
  });

  it('디렉터리의 모든 이미지가 목록에 등재돼 있다 — 아무도 안 쓰는 자산 금지', () => {
    const onDisk = readdirSync(TITLE_DIR).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
    const listed = new Set<string>(TITLE_ASSET_NAMES);
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });

  it('전부 WebP 다 — PNG 원본을 실수로 커밋하는 것을 막는다', () => {
    for (const name of TITLE_ASSET_NAMES) {
      expect(name.endsWith('.webp'), `${name}: WebP 가 아니다`).toBe(true);
    }
  });

  it('합계 용량이 첫 페인트 예산 안이다', () => {
    const total = TITLE_ASSET_NAMES.reduce((sum, n) => sum + statSync(join(TITLE_DIR, n)).size, 0);
    expect(total, `${(total / 1024).toFixed(0)}KB > ${TOTAL_BUDGET_BYTES / 1024}KB`).toBeLessThan(
      TOTAL_BUDGET_BYTES,
    );
  });
});
