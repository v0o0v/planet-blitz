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
  isLoginRequired,
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

  it('로그인을 강제하지 않는다', () => {
    expect(isLoginRequired()).toBe(false);
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

  it('src 어디에서도 signInAnonymously 를 호출하지 않는다', () => {
    const files: string[] = [];
    scanTs(SRC, files);
    // `.auth.` 를 붙여 **실제 호출**만 잡는다. 이 레인이 왜 익명을 걷어냈는지 설명하는 주석에
    // 이름 자체는 남아 있어야 하고(같은 실수의 재발을 막는 기록이다), 그것까지 잡으면 과탐지다.
    const offenders = files.filter((f) =>
      /\.auth\.signInAnonymously\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map((f) => f.slice(SRC.length + 1)),
      '익명 로그인은 로그인 게이트를 우회시킨다 — 로그인 안 한 사용자에게 서버가 계정을 만들어 준다',
    ).toEqual([]);
  });

  it('requireUserId 는 세션이 없으면 throw 한다(조용히 만들어 주지 않는다)', () => {
    const src = read('net/supabaseClient.ts');
    expect(src).toMatch(/if \(user === undefined\) throw/);
    expect(src).not.toMatch(/\.auth\.signInAnonymously\s*\(/);
  });

  /**
   * 호출을 지우는 것만으로는 부족했다. **이미 발급된 익명 세션은 localStorage 에 남아 자동
   * 갱신되므로 만료되지 않는다** — 그대로 두면 이 레인 이전에 한 번이라도 플레이한 사람은
   * 전원이 게이트를 그냥 통과한다(로그인 필수가 신규 사용자에게만 적용된다). 개발 중 실제로
   * 재현됐고, 그때까지 어떤 테스트도 빨갛지 않았다.
   */
  it('익명 세션은 로그인으로 치지 않는다 — 부팅 검사와 requireUserId 양쪽에서', () => {
    expect(read('net/auth.ts')).toMatch(/user\.is_anonymous === true/);
    expect(read('net/supabaseClient.ts')).toMatch(/user\.is_anonymous === true/);
  });

  it('발견한 익명 세션은 끊는다(UI 는 미로그인인데 서버는 익명 uid 로 쓰는 두 얼굴 방지)', () => {
    const src = read('net/auth.ts');
    const block = src.slice(src.indexOf('if (user.is_anonymous === true)'));
    expect(block.slice(0, 200)).toContain('signOut()');
  });
});

describe('③ 게이트·리다이렉트 배선', () => {
  it('DEV 는 게이트만 끈다 — 로그인 기능 자체는 살아 있다', () => {
    const src = read('net/auth.ts');
    // isLoginRequired 만 DEV 를 본다. signInWithGoogle 이 DEV 를 보면 로컬에서 왕복을 못 시험한다.
    expect(src).toMatch(/isLoginRequired[\s\S]*?import\.meta\.env\.DEV/);
    const signIn = src.slice(src.indexOf('export async function signInWithGoogle'));
    expect(signIn).not.toContain('import.meta.env.DEV');
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
