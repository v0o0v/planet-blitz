/**
 * 하네스를 온라인으로 세우는 두 규칙의 계약.
 *
 * 배경: `?harness=1` 은 오프라인을 강제하지 않는다 — 하네스가 하는 일은 프로필 I/O 격리와
 * 로그인 게이트 우회뿐이다. 그런데 그 우회 때문에 **세션이 영영 안 생겨** 서버 화면(의뢰서·
 * 코어 모듈·침공·방어)이 전부 잠긴 채로 보였다. 로그인을 하려면 OAuth 왕복이 하네스로
 * 되돌아와야 하고, 되돌아온 하네스가 실유저 기지를 치면 안 된다. 그 둘을 여기서 잠근다.
 *
 * 이 리포의 관용구를 따른다 — **순수 계층을 직접 부르고, 배선은 소스 텍스트로 잠근다**
 * (`authGate.test.ts` 와 같은 방식). 캔버스도 OAuth 왕복도 단위 테스트로는 못 밟는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHarnessFlag, isHarnessSession } from '../src/net/config.js';
import { withHarnessFlag, loginRedirectTarget } from '../src/net/auth.js';
import { isNpcProfileId, restrictToNpcTargets } from '../src/net/invasionGateway.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, 'src', rel), 'utf8');
}

describe('① 하네스 플래그 판정', () => {
  it('harness=1 일 때만 참이다', () => {
    expect(readHarnessFlag('?harness=1')).toBe(true);
    expect(readHarnessFlag('harness=1')).toBe(true); // 앞의 ? 는 선택
    expect(readHarnessFlag('?seed=42&harness=1&screen=base')).toBe(true);
  });

  it('없거나 다른 값이면 거짓이다', () => {
    expect(readHarnessFlag('')).toBe(false);
    expect(readHarnessFlag('?seed=42')).toBe(false);
    // `harness=0`·`harness` 단독을 참으로 보면 오타 한 글자가 격리를 푼다.
    expect(readHarnessFlag('?harness=0')).toBe(false);
    expect(readHarnessFlag('?harness')).toBe(false);
    expect(readHarnessFlag('?harness=true')).toBe(false);
  });

  it('window 가 없는 환경(테스트·밸런스 러너)에서는 하네스가 아니다', () => {
    // vitest 는 environment:'node' 라 window 가 없다. 이게 깨지면 테스트가 하네스 분기로
    // 흘러 들어가 침공 목록이 조용히 NPC 로 좁혀진다.
    expect(isHarnessSession()).toBe(false);
  });
});

describe('② 로그인 왕복이 하네스를 잃지 않는다', () => {
  it('하네스 세션이면 복귀 주소에 harness=1 이 되붙는다', () => {
    expect(withHarnessFlag('http://localhost:5185/', '?harness=1')).toBe(
      'http://localhost:5185/?harness=1',
    );
    // 배포본(BASE_URL 이 하위 경로)에서도 같은 규칙이다.
    expect(withHarnessFlag('https://v0o0v.github.io/planet-blitz/', '?harness=1&seed=7')).toBe(
      'https://v0o0v.github.io/planet-blitz/?harness=1',
    );
  });

  it('하네스가 아니면 주소를 건드리지 않는다', () => {
    // 프로덕션 왕복에 쿼리가 붙으면 Supabase 화이트리스트에서 거부될 수 있다.
    expect(withHarnessFlag('https://v0o0v.github.io/planet-blitz/', '')).toBe(
      'https://v0o0v.github.io/planet-blitz/',
    );
    expect(withHarnessFlag('http://localhost:5185/', '?seed=42')).toBe('http://localhost:5185/');
  });

  it('loginRedirectTarget 이 그 규칙을 경유한다', () => {
    // 배선 잠금: 누군가 origin+BASE_URL 로 되돌리면 하네스는 다시 로그인할 수 없게 된다.
    // 그런데 **아무 단위 테스트도 빨개지지 않는다**(브라우저에서만 도는 경로다).
    expect(readSrc('net/auth.ts')).toMatch(/return withHarnessFlag\(base, window\.location\.search\)/);
  });

  it('window 가 없으면 빈 문자열이다(기존 계약 유지)', () => {
    expect(loginRedirectTarget()).toBe('');
  });
});

describe('③ 하네스 침공은 NPC 시드 기지만 친다', () => {
  it('NPC 대역은 시드 마이그레이션이 박은 UUID 와 일치한다', () => {
    // 접두사를 코드에만 두면 시드가 바뀌었을 때 조용히 "대상 0건"이 된다. 마이그레이션
    // 파일에서 실제 UUID 를 읽어 대조한다 — 자산 존재 검사와 같은 규율.
    const sql = readFileSync(
      join(ROOT, 'supabase', 'migrations', '20260717080000_m4_phase_e_npc_seed.sql'),
      'utf8',
    );
    const seeded = [...sql.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g)]
      .map((m) => m[1] as string)
      .filter((id) => id.startsWith('000000e5'));
    expect(seeded.length).toBeGreaterThan(0);
    for (const id of seeded) expect(isNpcProfileId(id)).toBe(true);
  });

  it('실유저 UUID 는 NPC 가 아니다', () => {
    expect(isNpcProfileId('7f3a1c2e-9b44-4d21-8e05-1a2b3c4d5e6f')).toBe(false);
    expect(isNpcProfileId('')).toBe(false);
    // 대역이 한 글자만 달라도 NPC 가 아니다(접두사 오타로 실유저가 통과하면 안 된다).
    expect(isNpcProfileId('000000e5-ed00-4000-8001-000000000001')).toBe(false);
  });

  it('하네스면 실유저를 걸러내고, 아니면 그대로 둔다', () => {
    const targets = [
      { profileId: '000000e5-ed00-4000-8000-000000000003' },
      { profileId: '7f3a1c2e-9b44-4d21-8e05-1a2b3c4d5e6f' },
      { profileId: '000000e5-ed00-4000-8000-000000000011' },
    ];
    expect(restrictToNpcTargets(targets, true).map((t) => t.profileId)).toEqual([
      '000000e5-ed00-4000-8000-000000000003',
      '000000e5-ed00-4000-8000-000000000011',
    ]);
    expect(restrictToNpcTargets(targets, false)).toHaveLength(3);
  });

  it('매치메이킹과 복수 목록이 둘 다 그 필터를 경유한다', () => {
    // 서버 RPC 는 is_npc 를 거르지 않는다. 이 두 호출부 중 하나라도 필터를 잃으면
    // 하네스 침공이 실유저의 정비도·래더를 진짜로 깎는다 — 되돌릴 수단이 없다.
    const src = readSrc('net/invasionGateway.ts');
    const calls = [...src.matchAll(/restrictToNpcTargets\(/g)];
    expect(calls.length).toBe(2);
    expect(src).toMatch(/get_invasion_targets[\s\S]{0,400}?restrictToNpcTargets\(/);
    expect(src).toMatch(/get_revenge_targets[\s\S]{0,600}?restrictToNpcTargets\(/);
  });

  it('필터는 서버 강제가 아니라 목록 필터임이 문서에 남아 있다', () => {
    // 한계를 안 적어 두면 다음 레인이 이걸 보안 경계로 오해한다.
    expect(readSrc('net/invasionGateway.ts')).toMatch(/서버 강제가 아니라 목록 필터/);
  });
});
