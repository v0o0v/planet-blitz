/**
 * 게스트 계정 서버 시드 호출 (2026-08-09).
 *
 * 클라 세이브 쪽 프리셋은 `src/save/guestPreset.ts` 가 만든다. 이 모듈은 그 세이브가 서버에
 * 닿은 **뒤에** `seed_guest_account()` 를 불러 **서버가 정본인 축**을 채운다 — 촉매·설계도·
 * 방어체·방어 배치·순위·의뢰서.
 *
 * ## 순서가 계약이다
 * RPC 는 `profiles` 행이 없으면 예외를 던진다(그쪽에서 이유를 분명히 말한다). 위 테이블들이
 * 전부 `profiles(id)` 를 FK 로 물기 때문이다. 그래서 호출부는 **세이브 업로드 성공을 확인한
 * 뒤** 이 함수를 부른다. 순서를 뒤집으면 시드가 통째로 실패하는데, 실패를 삼키는 자리라
 * (아래) 아무 말 없이 빈 계정이 된다.
 *
 * ## 실패는 삼킨다
 * 시드는 편의지 게임의 전제가 아니다. 실패하면 게스트는 그냥 프리셋 세이브만 가진 계정이 되고
 * (레벨·장비·스킬은 그대로 있다), 촉매·의뢰서 화면이 비어 보일 뿐이다. 부팅을 막을 이유가 없다.
 *
 * ## 서버가 1회성을 지킨다
 * 재시도해도 지급이 늘지 않는다 — `guest_seeds` PK 가 앵커다. 그래서 이 함수는 멱등이고,
 * 다음 부팅에서 다시 불러도 안전하다(실제로 첫 시도가 오프라인이었으면 그래야 한다).
 */

import { readSupabaseConfig } from './config.js';

/** 시드 결과. `seeded=false, reason='already-seeded'` 는 정상이다(2회차 이상). */
export interface GuestSeedResult {
  seeded: boolean;
  reason?: string;
}

/**
 * `seed_guest_account()` 를 호출한다. 미설정·오프라인·오류면 `null`(절대 throw 하지 않는다).
 *
 * SDK 는 다른 net 모듈과 같은 규율로 **함수 안에서** 동적 import 한다 — 정적으로 끌면 213kB 가
 * 초기 청크에 실린다.
 */
export async function seedGuestAccount(): Promise<GuestSeedResult | null> {
  const config = readSupabaseConfig();
  if (config === null) return null;
  try {
    const { getSupabaseClient } = await import('./supabaseClient.js');
    const client = getSupabaseClient(config);
    const { data, error } = await client.rpc('seed_guest_account');
    if (error !== null) return null;
    const row = data as { seeded?: unknown; reason?: unknown } | null;
    if (row === null || typeof row !== 'object') return null;
    return {
      seeded: row.seeded === true,
      ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    };
  } catch {
    return null;
  }
}
