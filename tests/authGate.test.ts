/**
 * 로그인 게이트 계약.
 *
 * 화면(캔버스)은 검증할 수 없으므로 이 리포의 관용구를 따른다 — **순수 계층을 직접 부르고,
 * 배선은 소스 텍스트로 잠근다**(defenseCommandPixi·i18n 테스트와 같은 방식).
 *
 * 여기서 잠그는 것 셋:
 *  ① vitest 환경은 게이트 **밖**이다(미설정). 이게 깨지면 테스트 19파일·밸런스 러너가 함께 죽는다.
 *  ② 익명 폴백이 부활하지 않는다. 부활하면 게이트가 UI 장식이 된다 — 그런데 **아무 테스트도
 *     빨개지지 않는다**(그 경로는 설정이 있을 때만 돈다). 그래서 소스로 잠근다.
 *  ③ 로그아웃 순서. 세션 해제 → 로컬 삭제 → 새로고침 중 하나라도 빠지거나 순서가 바뀌면
 *     이전 계정 데이터가 다음 계정으로 샌다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLoginConfigured,
  getSignedInUser,
  signInWithGoogle,
  loginRedirectTarget,
} from '../src/net/auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('① vitest 환경은 게이트 밖이다', () => {
  it('설정이 없으므로 로그인 개념 자체가 없다', () => {
    // `vite.config.ts` 가 test 모드에서 envDir 을 tests/ 로 돌려 VITE_SUPABASE_* 를 비운다.
    // 이 단언이 깨졌다면 누군가 그 장치를 건드린 것이고, 그 순간 네트워크를 안 타던 테스트들이
    // 온라인 경로로 흘러간다.
    expect(isLoginConfigured()).toBe(false);
  });


  it('세션 조회가 SDK 를 건드리지 않고 null 을 준다', async () => {
    await expect(getSignedInUser()).resolves.toBeNull();
  });

  it('브라우저가 없으면 로그인 시도가 no-browser 로 끝난다(throw 하지 않는다)', async () => {
    await expect(signInWithGoogle()).resolves.toBe('no-browser');
  });

  it('window 가 없으면 리다이렉트 목적지는 빈 문자열', () => {
    expect(loginRedirectTarget()).toBe('');
  });
});

describe('② 익명 폴백이 부활하지 않는다', () => {
  function scanTs(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scanTs(full, out);
        continue;
      }
      if (entry.endsWith('.ts')) out.push(full);
    }
  }

  /**
   * 게스트 로그인이 생겼어도(2026-08-09) **위험했던 것은 익명 로그인 자체가 아니라 자동
   * 폴백**이었다 — 게이트웨이 7곳이 각자 "세션 없으면 만들어 준다"를 복제하고 있었고, 그러면
   * 사용자가 아무것도 고르지 않았는데 계정이 생긴다. 그래서 호출을 **명시적 진입점 한 곳으로
   * 가둔다**: 타이틀에서 사용자가 [게스트로 시작]을 눌렀을 때만 도는 `net/auth.ts`.
   */
  it('signInAnonymously 는 net/auth.ts 한 곳에서만 호출된다', () => {
    const files: string[] = [];
    scanTs(SRC, files);
    const callers = files
      .filter((f) => /\.auth\.signInAnonymously\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(
      callers,
      '게이트웨이가 세션 없을 때 스스로 계정을 만들면, 사용자가 고르지 않은 계정이 생긴다',
    ).toEqual(['net/auth.ts']);
  });

  it('requireUserId 는 세션이 없으면 throw 한다(조용히 만들어 주지 않는다)', () => {
    const src = read('net/supabaseClient.ts');
    expect(src).toMatch(/if \(user === undefined\) throw/);
    expect(src).not.toMatch(/\.auth\.signInAnonymously\s*\(/);
  });

  /**
   * 게스트는 **완전한 계정**이다(사용자 결정, 2026-08-09 — 기능 제한 없음). 그래서 서버 경로가
   * 익명 uid 를 거부하면 안 된다. 거부가 남아 있으면 게스트는 로그인은 되는데 촉매·의뢰·침공이
   * 전부 조용히 실패하는, 가장 진단하기 어려운 형태가 된다.
   */
  it('익명 uid 를 서버 경로에서 거부하지 않는다', () => {
    expect(read('net/supabaseClient.ts')).not.toMatch(/is_anonymous === true\) throw/);
  });

  it('게스트 여부는 끊는 대신 플래그로 들고 다닌다(UI 표시용)', () => {
    const src = read('net/auth.ts');
    expect(src).toMatch(/isGuest: user\.is_anonymous === true/);
    // 부팅 검사가 익명 세션을 끊어 버리면 [게스트로 시작]을 눌러도 곧바로 미로그인으로 돌아온다.
    expect(src.slice(src.indexOf('export async function getSignedInUser'))).not.toMatch(
      /is_anonymous[\s\S]{0,200}signOut\(\)/,
    );
  });
});

describe('③ 게이트·리다이렉트 배선', () => {
  /**
   * 우회는 **DEV 전체가 아니라 `?harness=1`** 이다.
   *
   * DEV 전체를 뚫었더니 타이틀 버튼이 "기지로 진입"이 되어 로그인 버튼이 화면에서 사라졌다
   * (사용자 신고). 그냥 `npm run dev` 로 띄우면 프로덕션과 똑같이 로그인을 요구해야, 로컬에서
   * 본 것이 실제 배포본과 같다고 말할 수 있다.
   */
  it('게이트 우회가 DEV 전체가 아니라 harness 스위치에 걸려 있다', () => {
    const src = read('main.ts');
    const boot = src.slice(src.indexOf('async function bootWithAuth'));
    const branch = boot.slice(boot.indexOf('if (user === null)'), boot.indexOf('reconcileAccountScope'));
    expect(branch).toContain('!harnessActive');
    expect(branch).not.toContain('import.meta.env.DEV');
  });

  it('auth 모듈이 DEV 로 분기하지 않는다(로컬과 배포본이 같은 경로를 돈다)', () => {
    expect(read('net/auth.ts')).not.toContain('import.meta.env.DEV');
  });

  it('리다이렉트 목적지가 BASE_URL 을 포함한다(Pages 서브패스)', () => {
    // origin 만 쓰면 배포본에서 리포 루트(/)로 떨어져 게임이 안 뜬다.
    expect(read('net/auth.ts')).toContain('import.meta.env.BASE_URL');
  });

  it('SDK 를 정적 import 하지 않는다(초기 청크 보호)', () => {
    const src = read('net/auth.ts');
    expect(src).not.toMatch(/^import .*from '@supabase\/supabase-js'/m);
    expect(src).toContain("await import('./supabaseClient.js')");
  });
});

describe('④ 로그아웃 순서', () => {
  it('세션 해제 → 로컬 삭제 → 새로고침 순이다', () => {
    const src = read('main.ts');
    const body = src.slice(src.indexOf('function handleSignOut'));
    const iSignOut = body.indexOf('await signOut()');
    const iClear = body.indexOf('clearAccountScope(');
    const iReload = body.indexOf('location.reload()');

    expect(iSignOut, 'signOut 호출이 없다').toBeGreaterThanOrEqual(0);
    expect(iClear, 'clearAccountScope 호출이 없다').toBeGreaterThan(iSignOut);
    expect(iReload, 'reload 가 없다 — 메모리에 남은 이전 계정 상태가 다음 계정으로 샌다').toBeGreaterThan(
      iClear,
    );
  });

  it('부팅이 세션 확보 후에 이관·회수를 부른다', () => {
    const src = read('main.ts');
    const boot = src.slice(src.indexOf('async function bootWithAuth'));
    // 익명이 사라진 뒤 부팅 즉시 부르면 전부 throw → 조용한 no-op 이 되고 아무도 다시 안 부른다.
    expect(boot).toContain('migrateLocalProfileToServer(profile)');
    expect(boot).toContain('flushPendingCommissionSubmissions()');
  });
});

describe('⑥ Google 버튼은 공식 규격이다', () => {
  const src = () => read('ui/pixi/googleSignInButton.ts');

  it('공식 문구를 쓴다(임의 의역 금지)', async () => {
    const { CATALOG } = await import('../src/i18n/catalog.js');
    expect(CATALOG.en['title.signInGoogle']).toBe('Sign in with Google');
    expect(CATALOG.ko['title.signInGoogle']).toBe('Google 계정으로 로그인');
  });

  it('라이트 테마 공식 색을 쓴다', () => {
    expect(src()).toContain('0xffffff'); // 배경
    expect(src()).toContain('0x747775'); // 테두리
    expect(src()).toContain('0x1f1f1f'); // 글자
  });

  it('4색 로고를 단색화하지 않는다', () => {
    for (const c of ['#4285F4', '#34A853', '#FBBC05', '#EA4335']) {
      expect(src(), `공식 로고 색 ${c} 가 없다`).toContain(c);
    }
  });

  it('게임 폰트를 쓰지 않는다 — Roboto 계열이다', () => {
    // 주석에는 "UI_FONT 를 쓰지 않는다"는 설명이 남아야 하므로 **import 줄만** 본다.
    // (`[\s\S]*?` 로 이으면 import 줄에서 시작해 주석까지 건너뛰어 매치된다 — 실제로 밟았다.)
    const imports = src()
      .split('\n')
      .filter((l) => l.startsWith('import'))
      .join('\n');
    expect(imports).not.toContain('UI_FONT');
    expect(src()).toContain("'Roboto'");
  });

  it('치수를 눈대중으로 고르지 않고 높이 40 규격에서 스케일한다', () => {
    // 개별 값을 손으로 적으면 비율이 어긋나 "공식 버튼처럼 생긴 다른 것"이 된다.
    expect(src()).toMatch(/const k = h \/ SPEC\.height/);
    for (const key of ['logo', 'fontSize', 'padX', 'gap', 'radius', 'border']) {
      expect(src(), `SPEC.${key} 누락`).toContain(`${key}:`);
    }
  });

  it('캔버스를 CanvasSource 로 감싼다(베이스 TextureSource 는 조용히 빈 텍스처가 된다)', () => {
    expect(src()).toContain('new CanvasSource({ resource: canvas })');
    expect(src()).not.toMatch(/new TextureSource\(/);
  });

  it('캔버스가 없는 환경에서 null 로 물러난다(화면 전체를 죽이지 않는다)', async () => {
    const { googleLogoTexture } = await import('../src/ui/pixi/googleSignInButton.js');
    // vitest 는 node 환경이라 document 가 없다.
    expect(googleLogoTexture(18)).toBeNull();
  });
});

describe('⑤ 계정 행', () => {
  it('로그인 개념이 없는 빌드(미설정)면 행 자체가 없다', () => {
    const src = read('ui/pixi/settingsPanel.ts');
    // 누를 수도 없는 계정 UI 가 뜨는 것을 막는다.
    expect(src).toMatch(/if \(account !== null\) \{/);
  });

  it('이메일이 없어도 로그인 사실은 보여준다', () => {
    const src = read('ui/pixi/settingsPanel.ts');
    expect(src).toContain("account.email ?? t('settings.accountSignedIn')");
  });

  /**
   * 이 두 개가 실제로 놓쳤던 결함을 잠근다.
   *
   * 타이틀은 버튼이 **하나**고, 그 하나는 게이트가 강제일 때만 로그인이 된다. 그래서 게이트가
   * 꺼진 상황(DEV·세션 끊김 강등)에서는 로그인할 방법이 아예 없어졌다 — 실제로 DEV 에서
   * "구글 버튼이 안 보인다"로 드러났다. 설정 계정 행이 그 유일한 출구다.
   */
  it('미로그인 상태에도 로그인 버튼이 있다', () => {
    const src = read('ui/pixi/settingsPanel.ts');
    expect(src).toContain("t('title.signInGoogle')");
    expect(src).toContain('account.onSignIn()');
  });

  it('DEV·강등 상황에서 계정 행에 미로그인 상태를 넣는다', () => {
    const boot = (() => {
      const src = read('main.ts');
      return src.slice(src.indexOf('async function bootWithAuth'));
    })();
    // `user === null` 분기가 setAccount 를 부르지 않으면 로그인 버튼이 영영 안 나타난다.
    const branch = boot.slice(boot.indexOf('if (user === null)'), boot.indexOf('reconcileAccountScope'));
    expect(branch).toContain('setAccount({ signedIn: false');
  });

  it('설정에서 로그인 실패하면 화면을 옮기지 않고 안내만 띄운다', () => {
    const src = read('main.ts');
    const fn = src.slice(src.indexOf('function handleSignIn'), src.indexOf('function handleSignOut'));
    expect(fn).toContain('setAccountNotice');
    // 플레이 중이던 화면을 날리지 않는다.
    expect(fn).not.toContain('openTitle(');
  });
});
