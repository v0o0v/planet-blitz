/**
 * 구글 로그인 — 세션 조회·로그인·로그아웃.
 *
 * ## 게이트는 "설정이 있을 때만" 걸린다
 * `readSupabaseConfig()` 가 null 이면(vitest·밸런스 러너·시크릿 없는 배포) 로그인이라는 개념
 * 자체가 없고 게임은 기존대로 100% 로컬로 돈다. 이 규율 덕에 테스트 19파일·하네스·밸런스
 * 하네스가 이 레인의 영향을 전혀 받지 않는다.
 *
 * ## 우회는 DEV 전체가 아니라 `?harness=1` 이다
 * 처음에는 DEV 전체에서 게이트를 껐다. 그런데 타이틀은 버튼이 하나뿐이라, 게이트가 꺼지면
 * 그 버튼이 "기지로 진입"이 되어 **로그인 버튼이 화면에서 사라진다**(사용자 신고). 로컬에서
 * 왕복을 시험할 수 없으니 우회의 목적 자체가 무너졌다.
 *
 * 그래서 우회를 `?harness=1` 로 좁혔다(`main.ts`). 프로필 I/O 를 격리 슬롯으로 돌리는 그
 * 스위치가 이미 "지금은 테스트 중"이라는 선언이므로 로그인 우회도 거기 얹는 것이 맞다.
 * 그냥 `npm run dev` 로 띄우면 **프로덕션과 똑같이** 로그인을 요구한다.
 *
 * ## SDK 는 지연 로딩한다
 * 이 모듈은 `main.ts`·타이틀 화면처럼 **초기 청크에 실리는 곳**에서 import 된다. 그래서
 * `supabaseClient.ts` 를 정적으로 끌면 SDK 213kB 가 초기 청크로 딸려 온다. 함수 안에서
 * `await import()` 하는 이유가 그것이다 — 다른 net 모듈들과 같은 규율.
 *
 * ## 왜 리다이렉트인가(팝업이 아니라)
 * `signInWithOAuth` 는 페이지를 통째로 떠났다 돌아온다. 게임 상태가 날아가지만 **로그인
 * 버튼은 타이틀에만 있으므로 잃을 상태가 없다**. 팝업 방식은 `skipBrowserRedirect` + 창 관리 +
 * 세션 전달 배선을 직접 짜야 하고 팝업 차단·COOP 를 떠안는다. 값을 못 한다.
 */

import { readSupabaseConfig } from './config.js';

/** 로그인한 사용자 최소 정보. `email` 은 provider 가 안 줄 수도 있어 nullable. */
export interface SignedInUser {
  id: string;
  email: string | null;
}

/** 로그인 실패 사유(화면에 그대로 띄우지 않고 i18n 키로 옮긴다). */
export type SignInFailure = 'not-configured' | 'no-browser' | 'provider-error';

/** Supabase 설정이 있는가 = 로그인이라는 개념이 존재하는가. */
export function isLoginConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/**
 * OAuth 왕복이 돌아올 주소.
 *
 * `BASE_URL` 을 붙이는 것이 핵심이다 — 로컬은 `/`, GitHub Pages 프로젝트 페이지는
 * `/planet-blitz/` 라 origin 만 쓰면 배포본에서 리포 루트로 떨어진다. 이 한 줄로 두 환경이
 * 같은 코드 경로를 쓴다. Supabase 의 Redirect URLs 에 두 값이 모두 등록돼 있어야 한다.
 */
export function loginRedirectTarget(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/** 설정이 있으면 Supabase 클라이언트를, 없으면 null(SDK 를 로드조차 하지 않는다). */
async function resolveClient(): Promise<import('@supabase/supabase-js').SupabaseClient | null> {
  const config = readSupabaseConfig();
  if (config === null) return null;
  const { getSupabaseClient } = await import('./supabaseClient.js');
  return getSupabaseClient(config);
}

/**
 * 현재 로그인한 사용자. 세션이 없거나 미설정이면 null.
 *
 * `getSession()` 은 저장소에서 읽고 필요하면 갱신까지 한다. OAuth 리다이렉트로 돌아온
 * 직후에는 `detectSessionInUrl` 이 URL 을 소비해 세션을 저장한 뒤이므로 여기서 바로 잡힌다.
 */
export async function getSignedInUser(): Promise<SignedInUser | null> {
  const client = await resolveClient();
  if (client === null) return null;
  try {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (user === undefined) return null;

    // **익명 세션은 로그인이 아니다.** `signInAnonymously()` 호출을 코드에서 걷어내도, 그 전에
    // 만들어진 익명 세션은 localStorage 에 남아 자동 갱신된다(만료되지 않는다). 그대로 두면
    // 이 레인 이전에 한 번이라도 플레이한 사람은 **전원이 게이트를 그냥 통과한다** — 로그인
    // 필수 정책이 신규 사용자에게만 적용되는 셈이다. 실제로 개발 중 이 상태가 재현됐다.
    //
    // 되돌리는 김에 세션 자체도 끊는다. 남겨 두면 UI 는 "로그인 안 됨"인데 게이트웨이는 그
    // 익명 uid 로 서버를 호출하는 두 얼굴이 된다.
    if (user.is_anonymous === true) {
      await client.auth.signOut();
      return null;
    }
    return { id: user.id, email: typeof user.email === 'string' ? user.email : null };
  } catch {
    // 네트워크·저장소 오류 — 미로그인으로 취급한다(게이트가 로그인을 다시 요구할 뿐).
    return null;
  }
}

/**
 * 구글 로그인 시작. 성공하면 **브라우저가 구글로 떠나므로 이 함수 뒤의 코드는 실행되지
 * 않는다**(반환은 리다이렉트가 시작되지 못한 경우를 위한 것).
 */
export async function signInWithGoogle(): Promise<SignInFailure | null> {
  if (typeof window === 'undefined') return 'no-browser';
  const client = await resolveClient();
  if (client === null) return 'not-configured';
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: loginRedirectTarget() },
  });
  return error === null ? null : 'provider-error';
}

/**
 * 로그아웃. 로컬 계정 데이터 삭제는 호출부가 {@link clearAccountScope} 로 따로 한다 —
 * 이 모듈은 세션만 책임진다(스토어 주입 경로를 여기까지 끌고 오지 않기 위함).
 */
export async function signOut(): Promise<void> {
  const client = await resolveClient();
  if (client === null) return;
  try {
    await client.auth.signOut();
  } catch {
    // 서버가 죽어 있어도 로컬 세션은 SDK 가 지운다. 실패를 사용자에게 되돌릴 이유가 없다.
  }
}
