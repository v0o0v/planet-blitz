/**
 * 서버 드랍 원장(`item_grants`) 1행 → 아이템 인스턴스 (ADR-0050 §3 단계 1).
 *
 * ## 왜 이 모듈이 얇은가
 * 서버가 적는 3필드 `(drop_seed, rarity, source)` 는 **`rollItem` 의 세 인자 그대로**다.
 * 원장이 payload 를 통째로 저장하지 않고 이 셋만 적는 이유가 그것이다 — `rollItem` 이 순수
 * 함수라(`src/items/roll.ts:123`, `Math.random`·`Date` 참조 0건) 셋만 있으면 **바이트 동일한**
 * 아이템이 언제든 재확정된다. payload 통째면 1만 회원 × 250점 = 750MB 로 무료 티어를 넘는다.
 *
 * 그래서 이 파일이 하는 일은 둘뿐이다: **id 를 원장 키로 갈아 끼우는 것**과 **등급 문자열 검증**.
 *
 * ## id 를 갈아 끼우는 이유 — 멱등의 유일한 근거
 * `rollItem` 이 낸 id 는 `it-${seed}` 라 **시드가 같으면 같다**. 서버 시드는 런마다 다르므로
 * 실질 충돌은 없지만, 그 id 로는 "이 원장 행을 이미 받았는가"를 물을 수 없다. 배송 멱등의
 * 유일한 판정자는 `hasItemId`(src/save/itemPresence.ts)이고 그것이 보는 것은 id 하나다.
 * 그래서 id 를 원장 행 키(`grant_id`)에서 **결정론적으로** 파생시킨다 — 재시도가 같은 id 를
 * 만들어야 중복 배송이 구조적으로 막힌다.
 *
 * ⚠️ 네임스페이스 접두사 `drop:` 가 충돌 방지의 전부다. 기존 id 형식과 대조:
 *   · 드랍/정련  = `it-${seed}`      (roll.ts) — 접두사가 다르다
 *   · 약탈품     = `...-loot-...`             — 콜론이 없다
 *   · 의뢰 지급물 = `commission:${id}`         — 접두사가 다르다
 *   · 일일 보상  = `daily:${seed}`            — 접두사가 다르다
 * 콜론은 앞 두 형식에 안 쓰이고 뒤 둘과는 접두사가 갈리므로 `drop:` 는 이 경로만 만든다.
 */

import { rollItem } from './roll.js';
import type { Item, ItemSource, Rarity } from './types.js';

/** 등급 문자열의 정본 집합. 서버가 보낸 값이라 **신뢰 경계 밖**이므로 반드시 검증한다. */
const RARITIES: readonly string[] = ['normal', 'magic', 'rare', 'unique'];

/**
 * 원장 행 → 아이템 인스턴스 id. **결정론 파생**이라 재시도가 같은 id 를 만들고,
 * 그래서 `hasItemId` 가 중복 배송을 구조적으로 막는다.
 */
export function dropGrantItemId(grantId: string): string {
  return `drop:${grantId}`;
}

/**
 * 서버가 굴린 드랍 1건을 아이템으로 재확정한다.
 *
 * **해석 불가면 `null` 을 돌려준다.** 호출부는 그 행을 `applied_at` 으로 표시하지 **않고
 * 남겨야** 한다 — 조용히 버리면 서버는 "줬다"고 적혀 있는데 플레이어에게는 영영 안 온다
 * (의뢰 배송이 세운 규율과 같다).
 *
 * @param grantId  `item_grants.grant_id`(uuid). **아이템 id 의 유일한 입력**.
 * @param dropSeed 서버가 `hash(server_run_secret, run_id, drop_index)` 로 만든 u32 시드.
 * @param rarity   서버가 등급 분포 미러로 굴린 등급. 신뢰 경계 밖이라 검증한다.
 * @param source   출처 스탬프(행성·단계·레벨 상한).
 */
export function itemFromDropGrant(
  grantId: string,
  dropSeed: number,
  rarity: string,
  source: ItemSource,
): Item | null {
  if (grantId === '') return null;
  if (!Number.isFinite(dropSeed) || dropSeed < 0) return null;
  if (!RARITIES.includes(rarity)) return null;

  // 시드는 u32 다. 서버가 bigint 로 주므로 범위를 넘는 값이 오면 `>>> 0` 이 조용히 접는데,
  // 그러면 서버가 적은 시드와 클라가 쓴 시드가 갈려 **원장이 재확정을 보장하지 못한다.**
  // 그래서 접지 않고 거부한다.
  if (dropSeed > 0xffffffff) return null;

  const rolled = rollItem(dropSeed >>> 0, rarity as Rarity, source);
  // id 만 원장 키로 갈아 끼운다 — 나머지(슬롯·어픽스·무기타입)는 `rollItem` 이 정본이다.
  return { ...rolled, id: dropGrantItemId(grantId) };
}
