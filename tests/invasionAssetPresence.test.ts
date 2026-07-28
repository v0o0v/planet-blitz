/**
 * 로더가 부르는 침공 방어 자산 이름 ↔ `assets/` 실물 대조 (2026-07-28).
 *
 * ## 이 테스트가 막는 결함 — 실제로 밟았다
 *
 * `textures.ts` 의 `tryLoad` 는 파일이 없으면 **조용히 null** 을 돌려주고, 소비 측은 절차적
 * `Graphics` 플레이스홀더(`facilityTexture` 등)로 우아하게 폴백한다. 화면이 죽지 않는 것은
 * 의도된 설계지만, 그 대가로 **예외도 로그도 없이 그림만 도형으로 바뀐다**.
 *
 * M7a L11 이 구 포탑 6종(`turret_*.png`)을 로드 목록에서 지우면서 **대체 아트를 만들지 않았고**,
 * 침공 방어체 전체가 도형으로 보이는 상태가 사용자 신고(2026-07-28)까지 아무에게도 잡히지
 * 않았다. 단위 테스트는 전부 그린이었다 — 배열 **길이**만 검사했지(`invasionRender.test.ts`)
 * 그 이름의 파일이 디스크에 있는지는 아무도 안 봤기 때문이다.
 *
 * 게다가 자산 이름 배열은 카탈로그 파생이라 **항목이 늘면 이름도 자동으로 는다**. 즉 설비를
 * 1종 추가하면 PNG 없는 슬롯이 조용히 하나 더 생긴다. 그 구조적 재발을 여기서 막는다.
 *
 * 양방향으로 건다(`uiAssetPresence.test.ts` 와 같은 규율):
 *  - 목록에 없는 새 결손이 생기면 → 실패(아트 없이 이름만 등재하는 것을 막는다)
 *  - 부채가 해소돼 아트가 들어오면 → 실패(목록에서 지우라고 강제 — 목록이 썩지 않는다)
 *
 * ## 왜 소스 기준인가
 * 빌드 산출물로 세면 Vite 의 `assetsInlineLimit`(4096B 미만은 base64 인라인)을 재게 된다 —
 * `uiAssetPresence.test.ts` 머리말의 오진 기록 참고. 그래서 `assets/` 소스 기준으로 건다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  FACILITY_ASSET_FILES,
  PROP_ASSET_FILES,
  DEFENSE_BOSS_ASSET_FILES,
  INVASION_BACKDROP_ASSET_FILES,
  DEF3_UNIT_ASSET_FILES,
} from '../src/render/textures.js';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** 로더가 실제로 부르는 침공 방어 자산 이름 전체(등재 정본). */
const REGISTERED: readonly string[] = [
  ...FACILITY_ASSET_FILES,
  ...PROP_ASSET_FILES,
  ...DEFENSE_BOSS_ASSET_FILES,
  ...INVASION_BACKDROP_ASSET_FILES,
  ...DEF3_UNIT_ASSET_FILES,
];

/**
 * **아직 아트가 없는 등재 이름**(= 로더가 null 폴백하는 슬롯). 새 이름을 여기 넣기 전에
 * 정말 부채인지, 아니면 그냥 아트를 넣어야 하는지 먼저 따져라.
 *
 * ① `def3_fac_press.png` — **영구 예외다(부채가 아니다).** 압축 프레스는 설비 kind 를 쓰지 않고
 *    기존 `wall` kind 로 스폰되는 **이동 벽**이라(src/sim/invasion/movingWall.ts 머리말), 이
 *    슬롯의 텍스처는 어떤 경로로도 화면에 닿지 않는다. 프레스가 화면에서 쓰는 아트는
 *    `wall.png` 다. 이름이 여전히 등재되는 이유는 `FACILITY_ASSET_FILES` 가 카탈로그에서
 *    기계적으로 파생돼 index = catalogId 가 맞아야 하기 때문 — 배열에서 빼면 뒤 항목의
 *    인덱스가 통째로 밀린다. **여기에 아트를 채우지 마라. 낭비다.**
 *
 * ② 침공 배경 3장 — 2026-07-28 아트 레인의 명시적 범위 밖(사용자 결정). 대형 배경은
 *    오브젝트 생성기와 규격·비용 성격이 완전히 달라 별도 설계가 필요하다. 배경은 엔티티와
 *    달리 화면 전체를 덮으므로 64/128px 규약이 통하지 않는다.
 *
 * ③ 편대·사출 드론 3장 — **2026-07-28 해소**(방어체 25장 직후 이어서 생성).
 */
const KNOWN_MISSING: readonly string[] = [
  // ① 이동 벽이라 스프라이트 슬롯을 타지 않는다 — 영구 예외.
  'def3_fac_press.png',
  // ② 침공 배경 3장(범위 밖).
  'bg_invasion_l1.png',
  'bg_invasion_l2.png',
  'bg_invasion_l3.png',
];

describe('침공 방어 자산 등재 이름 ↔ assets/ 실물', () => {
  const files = new Set(readdirSync(ASSETS));
  const missing = REGISTERED.filter((n) => !files.has(n));

  it('등재했는데 아트가 없는 이름은 부채 목록과 정확히 일치한다', () => {
    // 정렬해 비교 — 목록 순서가 바뀌었다는 이유로 깨지면 안 된다.
    expect([...missing].sort()).toEqual([...KNOWN_MISSING].sort());
  });

  it('부채 목록에 사문화된 항목이 없다(아트가 들어왔으면 목록에서 지워라)', () => {
    const stale = KNOWN_MISSING.filter((n) => files.has(n));
    expect(stale).toEqual([]);
  });

  it('부채 목록은 실제로 등재된 이름만 담는다(오타·삭제된 슬롯 방지)', () => {
    const registered = new Set(REGISTERED);
    const unregistered = KNOWN_MISSING.filter((n) => !registered.has(n));
    expect(unregistered).toEqual([]);
  });

  it('등재 목록에 중복이 없다', () => {
    expect(new Set(REGISTERED).size).toBe(REGISTERED.length);
  });

  it('사자산이 된 구 포탑 6종은 assets/ 에 남아 있지 않다', () => {
    // M7a L11 이 로드 목록에서 지운 뒤로 아무 코드도 참조하지 않는다. 디스크에 남겨 두면
    // 빌드에 실리고, "포탑 아트가 있다"는 착시를 줘 이번 결손 진단을 늦춘다.
    const dead = [...files].filter((n) => /^turret_(vulcan|sniper|scatter|slow|missile|shock)\.png$/.test(n));
    expect(dead).toEqual([]);
  });
});
