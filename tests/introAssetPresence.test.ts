/**
 * 인트로 키아트 자산 결손 가드 — `INTRO_ASSET_NAMES` ↔ `assets/intro/` 실물 대조.
 *
 * ## 이 테스트가 막는 결함
 *
 * 인트로 화면은 자산이 없어도 **조용히 뜬다** — `loadIntroTextures` 는 실패한 컷의 키를 아예
 * 넣지 않고, `introSlides.render` 는 `undefined` 면 키아트를 건너뛰고 단색 바탕 위에 문구만
 * 그린다. 그 방어는 의도된 것이지만(자산은 덧붙임이지 전제가 아니다) 동시에 **결손이 화면에
 * 신호를 남기지 않는다**는 뜻이다. 파일명이 하나 어긋나면 첫 실행 사용자가 검은 화면 4컷을
 * 본 채로 배포된다.
 *
 * 이 리포는 같은 유형을 이미 여러 번 밟았다(`uiAssetPresence` · `titleAssetPresence` 헤더 ·
 * 침공 배경 3장). 그래서 같은 규율을 그대로 적용한다: **소스 기준**으로 잡는다. 빌드 산출물
 * 기준으로 짜면 Vite 의 인라인 임계값을 테스트하게 되고, "번들에 들어갔다"는 화면에 나온다는
 * 증명이 아니다.
 *
 * 양방향으로 건다 — 목록에 있는데 파일이 없으면 결손이고, 파일이 있는데 목록에 없으면 아무도
 * 안 쓰는 자산이 배포 용량만 먹고 있는 것이다.
 *
 * 덧붙여 **목록 자체가 `INTRO_SLIDES` 파생인지**도 검사한다. 슬라이드를 하나 추가하고 아트를
 * 안 만들면 이 테스트가 먼저 울어야 한다 — 그게 이 목록을 손으로 안 적은 이유다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { INTRO_ASSET_NAMES, introAssetName } from '../src/ui/pixi/introTextures.js';
import { INTRO_SLIDES } from '../data/lore/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTRO_DIR = join(ROOT, 'assets', 'intro');

/**
 * 인트로 키아트 합계 용량 상한(바이트). 실측 269KB 에 여유를 얹은 값이다.
 *
 * 왜 상한을 거는가: 인트로는 첫 실행 사용자가 **타이틀보다 먼저** 보는 화면이라 여기 용량이
 * 첫 페인트를 직접 민다. 컷을 하나 더 넣거나 PNG 를 실수로 커밋하면(원본은 장당 0.5~1.3MB)
 * 이 선이 먼저 운다.
 */
const TOTAL_BUDGET_BYTES = 500 * 1024;

describe('인트로 키아트 자산 ↔ 목록 대조', () => {
  it('목록이 INTRO_SLIDES 파생이다 — 컷을 늘리면 아트도 따라 늘어야 한다', () => {
    expect([...INTRO_ASSET_NAMES]).toEqual(INTRO_SLIDES.map((s) => introAssetName(s.id)));
  });

  it('목록의 모든 자산이 실제 파일로 존재한다', () => {
    for (const name of INTRO_ASSET_NAMES) {
      const path = join(INTRO_DIR, name);
      expect(statSync(path).isFile(), `${name} 없음 — 그 컷이 검은 화면으로 뜬다`).toBe(true);
    }
  });

  it('디렉터리의 모든 이미지가 목록에 등재돼 있다 — 아무도 안 쓰는 자산 금지', () => {
    const onDisk = readdirSync(INTRO_DIR).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
    const listed = new Set<string>(INTRO_ASSET_NAMES);
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });

  it('전부 WebP 다 — PNG 원본을 실수로 커밋하는 것을 막는다', () => {
    for (const name of INTRO_ASSET_NAMES) {
      expect(name.endsWith('.webp'), `${name}: WebP 가 아니다`).toBe(true);
    }
  });

  it('합계 용량이 첫 페인트 예산 안이다', () => {
    const total = INTRO_ASSET_NAMES.reduce((sum, n) => sum + statSync(join(INTRO_DIR, n)).size, 0);
    expect(total, `${(total / 1024).toFixed(0)}KB > ${TOTAL_BUDGET_BYTES / 1024}KB`).toBeLessThan(
      TOTAL_BUDGET_BYTES,
    );
  });
});
