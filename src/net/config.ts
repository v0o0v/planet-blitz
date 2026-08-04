/**
 * Supabase 연결 설정 읽기(M4 Phase B3).
 *
 * env(`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)가 모두 있어야 설정으로 인정한다.
 * 하나라도 없으면 `null` → 네트워크 계층 전체가 no-op 으로 동작해 기존 로컬 플레이가
 * 100% 유지된다(테스트 환경 포함 — vitest 는 이 값들을 정의하지 않는다).
 *
 * 실제 anon key 는 절대 커밋하지 않는다(.env.example 만 커밋). 로컬은 `.env.local` 에
 * 채운다.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** import.meta.env 에서 안전하게 문자열을 읽는다(정의 안 됐으면 undefined). */
function envString(key: string): string | undefined {
  // Vite 는 import.meta.env 에 VITE_* 를 정적 주입한다. 테스트/Node 에서는 대개
  // 정의돼 있지 않으므로 방어적으로 접근한다.
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const v = env?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** URL·anon key 가 모두 있으면 설정, 아니면 null(no-op 모드). */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = envString('VITE_SUPABASE_URL');
  const anonKey = envString('VITE_SUPABASE_ANON_KEY');
  if (url === undefined || anonKey === undefined) return null;
  return { url, anonKey };
}

/**
 * 쿼리스트링이 하네스 세션을 선언하는가(`?harness=1`). **순수 함수** — `window` 를 안 읽는다.
 *
 * 하네스 판정을 net 계층에 두는 이유: 로그인 왕복 주소({@link loginRedirectTarget})와 침공
 * 매치메이킹 필터가 둘 다 이 플래그를 봐야 하는데, 둘 다 `main.ts` 를 거치지 않는 경로다.
 * `main.ts` 의 `harnessActive` 와 같은 조건을 보지만 그쪽은 부팅 시 1회 계산해 프로필 I/O
 * 격리에만 쓰므로 서로 참조하지 않는다 — **판정식이 둘로 갈리지 않게 이 함수를 정본으로
 * 삼는다**(main.ts 도 다음에 손댈 때 이리로 옮기는 것이 맞다).
 */
export function readHarnessFlag(search: string): boolean {
  return new URLSearchParams(search).get('harness') === '1';
}

/**
 * 지금이 하네스 세션인가. DEV 빌드가 아니면 **항상 false** — 프로덕션 번들에서는 상수로
 * 접히므로 하네스 전용 분기가 통째로 사라진다(하네스 코드가 프로덕션에 없다는 규율과 같다).
 */
export function isHarnessSession(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  if (env?.DEV !== true) return false;
  if (typeof window === 'undefined') return false;
  return readHarnessFlag(window.location.search);
}
