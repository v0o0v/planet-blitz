/**
 * 액티브 스킬 아이콘 42장 실재 검증 (F 레인 · AC-21).
 *
 * `.omc/plans/active-skills-catalog.md` 부록 A 가 정한 42개 파일명
 * (`active_<shipSlug>_<n>.png`, n = 1..6, 기체 7종)이 `assets/` 에 실재하고
 * 64×64 PNG 인지 대조한다. `tests/uiAssetPresence.test.ts` 의 실물 파일 대조
 * 패턴을 따르되, 이 42장은 아직 `UI_ASSET_NAMES`(다른 레인 소유, `src/ui/pixi/uiTextures.ts`)에
 * 등재되지 않았을 수 있으므로 여기서는 **파일명 목록을 직접 리터럴로** 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const SHIP_SLUGS = ['striker', 'bruiser', 'arccaster', 'phantom', 'hatchling', 'mallow', 'bubble'] as const;

/** 42개 파일명 = 기체 7종 × n(1..6), 카탈로그 부록 A "아이콘 파일 검증 목록"과 동일. */
const ACTIVE_SKILL_ICON_NAMES: readonly string[] = SHIP_SLUGS.flatMap((slug) =>
  Array.from({ length: 6 }, (_, i) => `active_${slug}_${i + 1}.png`),
);

/**
 * PNG IHDR 청크에서 (width, height)만 읽는다 — 전체 디코드 없이 규격만 확인.
 * `Buffer` 타입이 tsconfig 에 없으므로(node types 미선언) `Uint8Array`+`DataView` 로만 다룬다.
 */
function readPngSize(path: string): { width: number; height: number } {
  const bytes = new Uint8Array(readFileSync(path));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) throw new Error(`not a PNG: ${path}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('액티브 스킬 아이콘 42장', () => {
  it('파일명 목록은 42개, 중복 없음', () => {
    expect(ACTIVE_SKILL_ICON_NAMES).toHaveLength(42);
    expect(new Set(ACTIVE_SKILL_ICON_NAMES).size).toBe(42);
  });

  it('42장 전부 assets/ 에 실재한다', () => {
    const files = new Set(readdirSync(ASSETS));
    const missing = ACTIVE_SKILL_ICON_NAMES.filter((n) => !files.has(n));
    expect(missing).toEqual([]);
  });

  it('42장 전부 64×64 PNG다', () => {
    const bad: string[] = [];
    for (const name of ACTIVE_SKILL_ICON_NAMES) {
      const { width, height } = readPngSize(resolve(ASSETS, name));
      if (width !== 64 || height !== 64) bad.push(`${name} (${width}x${height})`);
    }
    expect(bad).toEqual([]);
  });

  it('기체마다 정확히 6장(n=1..6)이 존재한다', () => {
    for (const slug of SHIP_SLUGS) {
      const forShip = ACTIVE_SKILL_ICON_NAMES.filter((n) => n.startsWith(`active_${slug}_`));
      expect(forShip.sort()).toEqual(
        Array.from({ length: 6 }, (_, i) => `active_${slug}_${i + 1}.png`).sort(),
      );
    }
  });
});
