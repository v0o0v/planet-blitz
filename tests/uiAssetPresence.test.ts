/**
 * UI 텍스처 로더 목록(`UI_ASSET_NAMES`) ↔ `assets/` 실물 PNG 대조.
 *
 * 왜 필요한가: 로더는 이름으로만 찾고 **없으면 조용히 null 을 돌려준다**. 렌더는 그 null 을
 * 예외 없이 삼키므로 결함은 오직 "화면의 빈 칸"으로만 드러난다 — 테스트도 타입체커도 못 잡고,
 * 그 화면을 눈으로 열어 본 사람만 안다. 실제로 스킬 아이콘 28장이 이 상태로 오래 남아 있었고
 * (`uiTextures.ts` 가 '아트 부채'로 주석까지 달아 뒀는데도) 사용자 신고로 드러났다(2026-07-28).
 *
 * 그래서 **등재 = 실물 존재**를 여기서 강제한다. 아트를 아직 못 만들었으면 목록에 넣지 말거나,
 * 넣었으면 파일을 만들어라 — 둘 중 하나다. "등재는 했는데 파일은 없다"는 상태를 허용하지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UI_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';

/** `assets/` 실물 파일 이름 집합. 디렉터리를 한 번만 읽고 차집합으로 판정한다. */
const onDisk = new Set<string>(
  readdirSync(fileURLToPath(new URL('../assets', import.meta.url))),
);

describe('UI 자산 실재성', () => {
  it('로더에 등재된 이름은 전부 assets/ 에 실물 PNG 가 있다(빈 칸 = 조용한 null 폴백 차단)', () => {
    expect(UI_ASSET_NAMES.filter((name) => !onDisk.has(name))).toEqual([]);
  });

  it('같은 이름을 두 번 등재하지 않는다(중복 로드 = 낭비이자 오타 신호)', () => {
    expect([...new Set(UI_ASSET_NAMES)]).toHaveLength(UI_ASSET_NAMES.length);
  });
});
