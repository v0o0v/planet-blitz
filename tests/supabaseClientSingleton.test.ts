/**
 * `getSupabaseClient` 단일 인스턴스 계약.
 *
 * 이 PR 이 한 일 전부가 "8개였던 클라이언트를 1개로"이므로, 그 불변식이 깨지면 PR 이 무의미해진다.
 * 그런데 깨져도 **아무 테스트도 빨개지지 않는다** — 게이트웨이들은 설정이 있을 때만 동적 로딩되고
 * 테스트는 그 경로를 타지 않기 때문이다. 그래서 여기서 직접 잠근다.
 *
 * ⚠️ 이 파일은 게이트웨이 파일들과 달리 SDK 를 **테스트 프로세스로 끌어온다**. 다른 net 테스트가
 * 피하는 일을 일부러 하는 것이고(그쪽은 fake gateway 주입이라 SDK 가 필요 없다), 대가는 이 파일
 * 하나의 collect 시간이다. 그 대가를 치르는 이유는 위 문단 그대로 — 대체 관측 수단이 없다.
 * 브라우저 번들 쪽 규약(SDK 가 초기 청크에 없다)은 이 테스트와 무관하며 그쪽은 빌드 산출물로
 * 확인한다.
 */

import { describe, it, expect } from 'vitest';
import { getSupabaseClient } from '../src/net/supabaseClient.js';
import type { SupabaseConfig } from '../src/net/config.js';

const A: SupabaseConfig = { url: 'https://a.supabase.co', anonKey: 'anon-a' };
const B: SupabaseConfig = { url: 'https://b.supabase.co', anonKey: 'anon-b' };

describe('getSupabaseClient — 단일 인스턴스', () => {
  it('같은 설정이면 같은 인스턴스를 돌려준다(값이 같은 별개 객체여도)', () => {
    const first = getSupabaseClient(A);
    const second = getSupabaseClient({ url: A.url, anonKey: A.anonKey });
    expect(second).toBe(first);
  });

  it('설정이 다르면 새로 만든다', () => {
    const a = getSupabaseClient(A);
    const b = getSupabaseClient(B);
    expect(b).not.toBe(a);
  });

  it('설정이 A→B→A 로 돌아오면 다시 만든다(캐시는 1칸이므로)', () => {
    // 1칸 캐시라는 사실 자체를 기록해 둔다. 실행 중 설정은 한 값이라 이 경로는 안 타지만,
    // 나중에 누가 "왕복해도 같은 인스턴스겠지"라고 가정하면 틀린다.
    const a1 = getSupabaseClient(A);
    getSupabaseClient(B);
    const a2 = getSupabaseClient(A);
    expect(a2).not.toBe(a1);
  });

  it('auth 세션을 유지하도록 만들어진다(persistSession 계약)', () => {
    // 인스턴스가 하나가 된 이유의 절반이 "세션·토큰 갱신을 한 곳에서"이므로 auth 가 실재하는지만
    // 확인한다. 옵션 값 자체는 SDK 내부라 공개 API 로 못 읽는다.
    const client = getSupabaseClient(A);
    expect(client.auth).toBeDefined();
    expect(typeof client.auth.getSession).toBe('function');
  });
});
