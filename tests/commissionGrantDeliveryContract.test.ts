/**
 * 의뢰 확정 지급물 **배송 레일** 계약 대조
 * (`supabase/migrations/20260805010000_commission_grant_delivery.sql`).
 *
 * 이 계약이 지키는 것들은 **전부 런타임에 조용하다** — 깨져도 게임은 정상으로 보인다:
 *   ① `applied_at` 컬럼 — 없으면 배송 여부를 담을 자리가 없어 매 부팅이 같은 물건을 다시 심거나
 *      (멱등이 `hasItemId` 하나에만 걸린다) 반대로 영영 안 온다.
 *   ② 부분 인덱스 — 없어도 동작은 한다. 원장이 TTL 대상이 아니라 단조 증가하므로 몇 달 뒤
 *      부팅마다 풀스캔이 되는데, 그때는 원인을 이 마이그레이션에서 찾지 않는다.
 *   ③ 트리거 서브트랜잭션 — 없으면 설계도 지급 예외 하나가 `settle_commission` 트랜잭션 전체를
 *      롤백해 **전 플레이어가 재화를 못 받고 화면은 조용하다**(PR#222 형상).
 *   ④ `security definer` + `search_path=''` — 빠지면 권한 승격·검색 경로 탈취 표면이 열린다.
 *   ⑤ `mark_commission_grant_applied` 의 `auth.uid()` 고정 — 수령자를 파라미터로 받는 순간
 *      남의 배송을 대신 표시해 **남의 물건을 증발시키는** 경로가 열린다.
 *   ⑥ `settle_commission` **미재정의** — 재정의하는 순간 낡은 본문 복제 위험이 되살아난다
 *      (20260802000000:4-15 가 프로덕션을 100% 깨뜨린 형상).
 *
 * ⚠️ **단언은 `code`(줄 주석 제거본)로 한다.** 이 리포의 SQL 은 규약을 길게 주석으로 적어 두고
 *    그 주석에 계약 문자열이 그대로 들어 있다(catalystShopContract 가 밟은 함정).
 *
 * ⚠️ **부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다** — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const FILE = '20260805010000_commission_grant_delivery.sql';

/** `--` 줄 주석 제거. 규약 주석이 계약 문자열을 그대로 담고 있어 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

function deliverySql(): string {
  const hit = migrationsInOrder().find((m) => m.file === FILE);
  if (hit === undefined) throw new Error(`${FILE} 가 없습니다`);
  return hit.sql;
}

function deliveryCode(): string {
  return stripLineComments(deliverySql());
}

/** 이 마이그레이션 안의 함수 본문(줄 주석 제거본). */
function fnBody(name: string): string {
  const sql = deliverySql();
  const at = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(at, `${name} 정의를 ${FILE} 에서 찾지 못함`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n$$;', at);
  expect(end, `${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
  return stripLineComments(sql.slice(at, end + 4));
}

describe('① applied_at — 배송 여부를 담는 자리', () => {
  it('commission_grants 에 nullable timestamptz 로 **추가**된다(additive)', () => {
    const code = deliveryCode();
    expect(code).toMatch(
      /alter\s+table\s+public\.commission_grants\s+add\s+column\s+if\s+not\s+exists\s+applied_at\s+timestamptz\s+null\s*;/i,
    );
  });

  it('not null·default 를 붙이지 않는다 — 기존 행이 "배송됨"으로 뭉개지면 물건이 영영 안 온다', () => {
    const code = deliveryCode();
    const m = /add\s+column\s+if\s+not\s+exists\s+applied_at[^;]*;/i.exec(code);
    expect(m).not.toBeNull();
    const decl = (m?.[0] ?? '').toLowerCase();
    expect(decl).not.toContain('not null');
    expect(decl).not.toContain('default');
  });

  it('commission_grants 테이블을 다시 만들지 않는다 (발급 정본은 20260803000000 이다)', () => {
    expect(deliveryCode()).not.toMatch(/create\s+table[\s\S]{0,40}commission_grants/i);
  });
});

describe('② 미배송 부분 인덱스', () => {
  it('applied_at is null 조건의 부분 인덱스가 있다', () => {
    const code = deliveryCode();
    expect(code).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+commission_grants_pending_idx[\s\S]*?on\s+public\.commission_grants[\s\S]*?where\s+applied_at\s+is\s+null/i,
    );
  });
});

describe('③④ 설계도 트리거 — 서브트랜잭션 · 정의자 권한 · 검색 경로', () => {
  const BODY = fnBody('trg_commission_grant_blueprint');

  it('security definer + set search_path = \'\' 다', () => {
    expect(BODY).toContain('security definer');
    expect(BODY).toMatch(/set\s+search_path\s*=\s*''/);
  });

  it('본문이 서브트랜잭션(begin … exception when others)으로 감싸여 있다', () => {
    // 없으면 이 경로의 예외가 settle_commission 트랜잭션 전체를 롤백해 **전 플레이어가
    // 재화를 못 받고 화면은 조용하다**. 리포에 같은 사고의 전례가 있다(PR#222).
    expect(BODY).toMatch(/exception\s+when\s+others\s+then/i);
    // 통과하면서도 참일 수 있는 나쁜 상태: exception 절만 있고 안에서 다시 raise 해
    // 바깥으로 전파하는 것 → warning 으로 접는지 본다.
    expect(BODY).toMatch(/raise\s+warning/i);
    expect(BODY).not.toMatch(/raise\s+exception/i);
  });

  it('defense_blueprints 에 (profile_id, kind, catalog_id) 충돌 시 count 를 더한다', () => {
    expect(BODY).toMatch(
      /insert\s+into\s+public\.defense_blueprints[\s\S]*?on\s+conflict\s*\(\s*profile_id\s*,\s*kind\s*,\s*catalog_id\s*\)[\s\S]*?do\s+update\s+set\s+count\s*=\s*public\.defense_blueprints\.count\s*\+\s*excluded\.count/i,
    );
  });

  it('kind 0..3 · count 1..4 로 검증한다 (grant_blueprints 와 같은 범위)', () => {
    // 다른 범위를 쓰면 같은 자산에 두 개의 유효성 정의가 생긴다.
    expect(BODY).toMatch(/v_kind\s*<\s*0\s+or\s+v_kind\s*>\s*3/);
    expect(BODY).toMatch(/v_count\s*<\s*1\s+or\s+v_count\s*>\s*4/);
  });

  it('blueprintId 가 object 가 아니면 지급하지 않는다 (스칼라는 warning 후 버린다)', () => {
    expect(BODY).toMatch(/jsonb_typeof\s*\(\s*v_bp\s*\)\s*<>\s*'object'/i);
  });

  it('grant_blueprints 를 재사용하지 않는다 (계획이 명시적으로 금지했다)', () => {
    expect(deliveryCode()).not.toContain('grant_blueprints(');
  });

  it('AFTER INSERT 트리거로 붙고 kind=blueprint 로 좁힌다', () => {
    const code = deliveryCode();
    expect(code).toMatch(
      /create\s+trigger\s+trg_commission_grants_blueprint[\s\S]*?after\s+insert\s+on\s+public\.commission_grants[\s\S]*?when\s*\(\s*new\.kind\s*=\s*'blueprint'\s*\)/i,
    );
  });
});

describe('⑤ mark_commission_grant_applied — auth.uid() 고정', () => {
  const BODY = fnBody('mark_commission_grant_applied');

  it('security definer + search_path = \'\' 다', () => {
    expect(BODY).toContain('security definer');
    expect(BODY).toMatch(/set\s+search_path\s*=\s*''/);
  });

  it('수령자를 auth.uid() 로 고정한다 (파라미터로 받지 않는다)', () => {
    // 파라미터로 받으면 남의 배송을 대신 표시해 **남의 물건을 증발시키는** 경로가 열린다.
    expect(BODY).toMatch(/v_me\s+uuid\s*:=\s*auth\.uid\(\)/);
    const sig = /create or replace function public\.mark_commission_grant_applied\(([^)]*)\)/.exec(
      BODY,
    );
    expect(sig).not.toBeNull();
    const params = (sig?.[1] ?? '').toLowerCase();
    expect(params).toContain('p_grant_id uuid');
    expect(params).not.toContain('uuid,'); // 파라미터가 uuid 하나뿐이다.
    expect(params).not.toContain('p_profile_id');
    expect(params).not.toContain('p_recipient');
  });

  it('본인의 **미배송** 기존 행만 갱신한다 (insert 하지 않는다)', () => {
    expect(BODY).toMatch(
      /update\s+public\.commission_grants[\s\S]*?where\s+grant_id\s*=\s*p_grant_id\s+and\s+profile_id\s*=\s*v_me\s+and\s+applied_at\s+is\s+null/i,
    );
    // 통과하면서도 참일 수 있는 나쁜 상태: update 옆에 insert 가 있어 없는 발급을 만들어내는 것.
    expect(BODY).not.toMatch(/insert\s+into\s+public\.commission_grants/i);
  });

  it('미로그인이면 아무것도 하지 않는다', () => {
    expect(BODY).toMatch(/if\s+v_me\s+is\s+null\s+then/i);
  });

  it('public·anon 회수 후 authenticated·service_role 에만 부여한다', () => {
    const code = deliveryCode();
    expect(code).toContain(
      'revoke all on function public.mark_commission_grant_applied(uuid) from public;',
    );
    expect(code).toContain(
      'revoke all on function public.mark_commission_grant_applied(uuid) from anon;',
    );
    expect(code).toContain(
      'grant execute on function public.mark_commission_grant_applied(uuid) to authenticated, service_role;',
    );
  });
});

describe('⑥ settle_commission 을 이 마이그레이션에서 재정의하지 않는다', () => {
  it('create or replace function … settle_commission 이 없다', () => {
    // 재정의하는 순간 낡은 본문 복제 위험이 되살아난다 — 20260802000000:4-15 가 정확히
    // 그 형상으로 PvE 정산을 100% 깨뜨렸다. 필요한 것은 전부 붙여서(additive) 이룬다.
    expect(deliveryCode()).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.settle_commission\s*\(/i,
    );
  });

  it('그럼에도 이 파일이 비어 있지 않다 (양성 단언 — 부재 단언만으로는 빈 파일도 통과한다)', () => {
    const code = deliveryCode();
    expect(code).toContain('create or replace function public.mark_commission_grant_applied(');
    expect(code).toContain('create or replace function public.trg_commission_grant_blueprint(');
  });
});

describe('재실행 안전 — 같은 마이그레이션을 두 번 적용해도 깨지지 않는다', () => {
  it('add column / create index 는 if not exists, trigger 는 drop → create 다', () => {
    const code = deliveryCode();
    expect(code).toMatch(/add\s+column\s+if\s+not\s+exists/i);
    expect(code).toMatch(/create\s+index\s+if\s+not\s+exists/i);
    expect(code).toMatch(
      /drop\s+trigger\s+if\s+exists\s+trg_commission_grants_blueprint\s+on\s+public\.commission_grants\s*;/i,
    );
  });
});
