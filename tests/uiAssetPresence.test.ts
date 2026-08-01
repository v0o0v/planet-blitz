/**
 * 로더가 부르는 UI 자산 이름 ↔ `assets/` 실물 대조 (2026-07-28).
 *
 * ## 이 테스트가 막는 결함
 *
 * `uiTextures.ts` 의 `tryLoad` 는 URL 이 없으면 **조용히 null** 을 돌려주고, 소비 측
 * (nineSlicePanel·PixiButton·SlotGrid·픽커 셀)은 Graphics/텍스트로 우아하게 폴백한다.
 * 자산 하나가 빠져도 화면이 죽지 않는 것은 의도된 설계지만, 그 대가로 **예외도 로그도 없이
 * 그림만 사라진다** — 설계서 §10-7 이 예측한 "조용한 null 폴백"이고, 이 프로젝트가 실제로
 * 여러 번 밟았다(스킬 아이콘 5밴드 확장 · 파워업 `skill_range_flat_lowmid` 오참조).
 *
 * 그래서 "목록에 있는데 디스크에 없는" 이름을 **명시적 부채 목록**과 정확히 일치시킨다.
 * 양방향으로 건다:
 *  - 목록에 없는 새 결손이 생기면 → 실패(아트 없이 이름만 등재하는 것을 막는다)
 *  - 부채가 해소돼 아트가 들어오면 → 실패(목록에서 지우라고 강제 — 목록이 썩지 않는다)
 *
 * ## 이 테스트가 막지 **않는** 것 (2026-07-28 오진 기록)
 *
 * "프로덕션 빌드에 PNG 가 33장뿐이니 자산이 누락된다"는 진단이 한 번 있었는데 **틀렸다**.
 * Vite 는 `build.assetsInlineLimit`(기본 4096B) 미만 자산을 **base64 data URI 로 번들에
 * 인라인**한다 — 픽셀아트 아이콘은 대부분 1~3KB라 별도 파일로 emit 되지 않을 뿐이다.
 * 전수 대조 결과 `assets/*.png` 252장 = 파일 emit 27 + 인라인 225 + **누락 0** 이었다.
 * 즉 `find dist -name '*.png' | wc -l` 은 자산 누락의 지표가 아니다. 빌드 산출물 기준
 * 테스트를 짜면 Vite 의 인라인 임계값을 테스트하게 되므로 여기서는 **소스 기준**으로 건다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { UI_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/**
 * **아직 아트가 없는 등재 이름**(= 로더가 null 폴백하는 슬롯). 새 이름을 여기 넣기 전에
 * 정말 부채인지, 아니면 그냥 아트를 넣어야 하는지 먼저 따져라.
 *
 * ① 스킬 노드 5밴드 확장 잔여 28장 — **2026-07-28 해소**(PixelLab 생성). 이 테스트가 잡아 준
 *    첫 부채였고, 사용자가 "스킬 중에 아이콘이 없는 것들이 있어"로 신고한 그 결손이다.
 * ② 촉매 **보상축 폴백** 10장 — 설계상 처음부터 비어 있다. 48종 개별 아트가 전부 있으므로
 *    (`catalystIconKey`) 이 폴백은 사다리 두 번째 칸으로만 존재한다. 그래도 등재해 두는
 *    이유는 `catalystIconFallbackKey` 가 실제 코드 경로(픽커·재고·정산 3곳)이기 때문 —
 *    나중에 축 아트가 들어오면 코드 변경 0으로 살아난다.
 * ③ 지시 수신소 건물 아이콘 1장(의뢰서 시스템 Phase E) — PixelLab 생성 전(비용 승인 대기,
 *    2026-08-01). `baseMap.ts` 의 accent 색 사각 폴백으로 화면은 죽지 않는다.
 */
const KNOWN_MISSING: readonly string[] = [
  // ② 촉매 보상축 폴백 10장(설계상 비어 있음 — 개별 아트 48종이 정본).
  'catalyst_axis_drop.png',
  'catalyst_axis_rarity.png',
  'catalyst_axis_xp.png',
  'catalyst_axis_resource.png',
  'catalyst_axis_catalystDrop.png',
  'catalyst_axis_power_damage.png',
  'catalyst_axis_power_fireRate.png',
  'catalyst_axis_power_moveSpeed.png',
  'catalyst_axis_power_maxHp.png',
  'catalyst_axis_power_skillAll.png',
  // ③ 지시 수신소 건물 아이콘(아트 미생성 — 승인 대기).
];

describe('UI 자산 등재 이름 ↔ assets/ 실물', () => {
  const files = new Set(readdirSync(ASSETS));
  const missing = UI_ASSET_NAMES.filter((n) => !files.has(n));

  it('등재했는데 아트가 없는 이름은 부채 목록과 정확히 일치한다', () => {
    // 정렬해 비교 — 목록 순서가 바뀌었다는 이유로 깨지면 안 된다.
    expect([...missing].sort()).toEqual([...KNOWN_MISSING].sort());
  });

  it('부채 목록에 사문화된 항목이 없다(아트가 들어왔으면 목록에서 지워라)', () => {
    const stale = KNOWN_MISSING.filter((n) => files.has(n));
    expect(stale).toEqual([]);
  });

  it('부채 목록은 실제로 등재된 이름만 담는다(오타·삭제된 슬롯 방지)', () => {
    const registered = new Set(UI_ASSET_NAMES);
    const unregistered = KNOWN_MISSING.filter((n) => !registered.has(n));
    expect(unregistered).toEqual([]);
  });

  it('등재 목록에 중복이 없다', () => {
    expect(new Set(UI_ASSET_NAMES).size).toBe(UI_ASSET_NAMES.length);
  });
});
