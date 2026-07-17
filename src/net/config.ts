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
