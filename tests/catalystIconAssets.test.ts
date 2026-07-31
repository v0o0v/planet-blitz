/**
 * 촉매 개별 아이콘 아트가 **실제로 리포에 있는지** 대조한다 (아트 패스 2026-07-28).
 *
 * 로더(`uiTextures.ts`)는 파일이 없으면 조용히 null 로 폴백한다 — 화면은 안 죽지만 그림도 안
 * 뜬다. 이 프로젝트가 반복해 밟은 "조용한 null 폴백"(설계서 §10-7)을 코드가 아니라 **디스크**
 * 기준으로 잡기 위해, 48종 slug ↔ `assets/catalyst_*.png` 를 양방향으로 맞춘다.
 *
 * 축 폴백 10종(`catalyst_axis_*`)은 **의도적으로 없다** — 개별 아트가 48종 전부 있으니 폴백은
 * 사다리의 두 번째 칸으로만 존재한다. 그래서 여기서는 존재를 요구하지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CATALYSTS, catalystIconKey } from '../src/data/catalysts.js';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

describe('촉매 아이콘 아트(assets/catalyst_*.png)', () => {
  const files = new Set(readdirSync(ASSETS).filter((f) => f.startsWith('catalyst_')));

  it('48종 전부 개별 PNG 가 있다', () => {
    const missing = CATALYSTS.filter((c) => !files.has(`${catalystIconKey(c)}.png`)).map(
      (c) => c.slug,
    );
    expect(missing).toEqual([]);
  });

  it('촉매 잔재 아이콘이 있다(ADR-0042 상점 재화)', () => {
    expect(files.has('catalyst_residue.png')).toBe(true);
  });

  it('쓰이지 않는 촉매 아트가 남아 있지 않다(사문서 아트 금지)', () => {
    const used = new Set(CATALYSTS.map((c) => `${catalystIconKey(c)}.png`));
    // 축 폴백 이름은 아직 아트가 없지만, 생긴다면 그것도 정당한 소비처다.
    // `catalyst_residue.png` 는 촉매 한 장이 아니라 상점 재화(촉매 잔재) 아이콘이라
    // 레지스트리 파생이 아니고, `UI_ASSET_NAMES` 에 손으로 등재된 정당한 소비처가 있다.
    const orphans = [...files].filter(
      (f) => !used.has(f) && !f.startsWith('catalyst_axis_') && f !== 'catalyst_residue.png',
    );
    expect(orphans).toEqual([]);
  });
});
