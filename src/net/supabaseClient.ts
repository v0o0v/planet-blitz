/**
 * Supabase 클라이언트 **단일 인스턴스**.
 *
 * ## 왜 합쳤나 — 8개였다
 * 게이트웨이 7종(profiles·defense·invasion·guardian·modules·commission·defenseUnits)과
 * `grantBlueprintsViaRpc` 가 각자 `createClient` 를 불러 **인스턴스가 8개**였다. 세션은
 * localStorage 키를 공유하므로 익명 로그인만 있던 동안에는 "어쩌다" 맞아떨어졌지만, 이건
 * 기대면 안 되는 성질이다. 실제로 셋이 걸린다:
 *
 *  1. **URL 파싱 경쟁.** `detectSessionInUrl` 이 기본 true 라, OAuth 리다이렉트로 돌아온 순간
 *     8개 인스턴스가 같은 URL 을 동시에 파싱하려 든다. 먼저 잡은 쪽이 해시/쿼리를 소비하고
 *     `history.replaceState` 로 지우므로 나머지는 빈손이 된다 — 저장소 폴백으로 대개 살아나지만
 *     타이밍에 의존한다. 인스턴스가 하나면 이 경쟁 자체가 없다.
 *  2. **토큰 갱신 경쟁.** `autoRefreshToken` 타이머가 8벌 돌아 같은 refresh token 을 두고 겹친다.
 *  3. **로그아웃·세션 만료의 주체 부재.** 상태를 한 곳에서 관찰(`onAuthStateChange`)하려면
 *     클라이언트가 하나여야 한다.
 *
 * supabase-js 자신도 같은 storageKey 로 GoTrueClient 가 둘 이상이면 경고를 낸다.
 *
 * ## 번들 규약은 그대로다
 * 각 게이트웨이 파일의 doc 이 말하던 "미설정 번들에 SDK 가 실리지 않는다"는 성질은 유지된다 —
 * SDK 를 정적 import 하는 파일이 이제 **여기 하나**이고, 이 모듈을 import 하는 것은 게이트웨이
 * 파일들뿐이며, 그 게이트웨이들은 전부 `await import()` 로 지연 로딩되기 때문이다
 * (`net/index.ts`·`invasion.ts`·`modules.ts`·`defenseSync.ts`·`blueprints.ts`). 즉 SDK 는 여전히
 * 초기 청크가 아니라 지연 청크에 있다. 바뀐 것은 그 청크를 **공유**한다는 것뿐.
 *
 * ## 메모이제이션과 테스트
 * config 는 env 에서 오므로 실행 중 한 값이지만, 키를 (url, anonKey) 로 잡아 값이 바뀌면 새로
 * 만든다. 리셋 함수를 두지 않은 것은 **테스트가 이 경로를 타지 않기 때문**이다 — 테스트는
 * `deps.gateway` 주입이나 `vi.spyOn` 으로 게이트웨이를 대체하고, Supabase 게이트웨이를 직접
 * 생성하는 테스트는 하나도 없다. 그런 테스트가 생기면 그때 리셋을 추가하면 된다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';

/** 메모된 인스턴스. 키가 다르면(설정이 바뀌면) 새로 만든다. */
let cached: { key: string; client: SupabaseClient } | null = null;

/**
 * (url, anonKey) → 캐시 키.
 *
 * 구분자를 직접 고르지 않고 `JSON.stringify` 에 맡긴다 — 어떤 문자를 골라도 "그 문자가 값에
 * 들어오면 서로 다른 쌍이 같은 키가 된다"는 위험이 남는데, 배열 직렬화는 그 문제 자체가 없다.
 */
function cacheKey(config: SupabaseConfig): string {
  return JSON.stringify([config.url, config.anonKey]);
}

/**
 * 설정에 대응하는 Supabase 클라이언트를 반환한다(같은 설정이면 항상 같은 인스턴스).
 *
 * auth 옵션은 기존 8곳이 쓰던 것과 동일하다 — 이 통합은 동작을 바꾸지 않는다.
 */
export function getSupabaseClient(config: SupabaseConfig): SupabaseClient {
  const key = cacheKey(config);
  if (cached !== null && cached.key === key) return cached.client;
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  cached = { key, client };
  return client;
}
