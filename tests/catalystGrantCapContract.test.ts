/**
 * 촉매 적립 캡·원장 계약 대조 (ADR-0042 §Follow-ups ⓐ ·
 * `supabase/migrations/20260801000000_catalyst_grant_cap.sql`).
 *
 * 이 계약이 지키는 것은 넷이고, 넷 다 깨져도 **런타임에는 조용하다**:
 *   ① 누적 캡의 존재 — 없어도 게임은 정상 동작한다(무제한 적립이 "잘 되는" 것으로 보인다)
 *   ② 원장 기록 — 없으면 캡이 근거를 잃어 조용히 무한대가 된다(sum over 빈 테이블 = 0)
 *   ③ GC TTL > 누적 창 — 뒤집히면 GC 가 캡의 근거를 지워 캡이 스스로 열린다
 *   ④ 잠금 순서 inventory → profiles — 역순이면 buy/salvage 와 ABBA 교착. 단위 테스트·1바퀴
 *      플레이·육안 중 무엇으로도 안 잡힌다(20260731000000 §잠금 순서 규약).
 *
 * ⚠️ 단언은 `body` 가 아니라 **`code`(줄 주석 제거본)** 로 한다. 이 리포의 SQL 은 본문 안에
 * 규약을 길게 주석으로 적어 두고, 그 주석에 `for update`·`catalyst_grants` 같은 계약 문자열이
 * 그대로 들어 있다(catalystShopContract.test.ts 가 같은 함정을 밟았다).
 *
 * ⚠️ 부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다 — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거. 규약을 적어 둔 주석이 계약 문자열을 그대로 담고 있어 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** 적용 순(파일명 오름차순) 기준 **마지막** 정의 본문 = 실제로 사는 정의. */
function effectiveFunctionBody(name: string): { file: string; code: string } {
  let found: { file: string; code: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const marker = `create or replace function public.${name}(`;
    const at = sql.lastIndexOf(marker);
    if (at < 0) continue;
    const end = sql.indexOf('\n$$;', at);
    expect(end, `${file}: ${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    found = { file, code: stripLineComments(sql.slice(at, end + 4)) };
  }
  if (found === null) throw new Error(`마이그레이션에서 ${name} 정의를 찾지 못했습니다`);
  return found;
}

function rawMigrationText(): string {
  return migrationsInOrder()
    .map((m) => m.sql)
    .join('\n');
}

/** 본문에서 `for update` 가 걸린 테이블을 등장 순서대로 나열(catalystShopContract 와 같은 관용구). */
function forUpdateLockOrder(code: string): string[] {
  const order: string[] = [];
  let lastTable: string | null = null;
  for (const m of code.matchAll(/public\.(\w+)|for update/g)) {
    if (m[0] === 'for update') order.push(lastTable ?? '<unknown>');
    else lastTable = m[1] ?? null;
  }
  return order;
}

/** grant_catalyst DECLARE 의 `NAME constant int := <식>;` 우변을 돌려준다. */
function declaredConstant(code: string, name: string): string {
  const m = new RegExp(`${name}\\s+constant\\s+int\\s*:=\\s*([^;]+);`).exec(code);
  expect(m, `DECLARE 에 ${name} constant int 선언이 없다`).not.toBeNull();
  return (m![1] ?? '').replace(/\s+/g, ' ').trim();
}

/** 클라가 부르는 진입점. 캡 본문을 직접 갖거나, 갖지 않으면 `_for` 에 위임한다. */
const ENTRY = effectiveFunctionBody('grant_catalyst');

/**
 * **캡 본문이 실제로 사는 함수**를 위임을 따라가 찾는다.
 *
 * 2026-08-05(ADR-0048 슬라이스 2)부터 `grant_catalyst` 는 얇은 래퍼다 — 본문이
 * `grant_catalyst_for(uuid, int, int)` 로 옮겨졌고 수신자만 인자가 됐다(EF 가 service_role 로
 * 부르는데 `auth.uid()` 가 null 이라 옮길 수밖에 없었다. `grant_currency`/`grant_currency_for`
 * 와 같은 2단 구조다).
 *
 * ⚠️ 이름을 하드코딩하면 이 계약이 **래퍼를 읽고 "캡이 사라졌다"** 고 말한다. 그렇다고 새
 * 이름을 하드코딩하면 다음에 또 옮길 때 같은 일이 반복된다. 그래서 위임을 따라간다 —
 * 계약이 재려는 것은 *"어느 이름에 있는가"* 가 아니라 *"클라 진입점에서 출발하면 캡을 반드시
 * 지나는가"* 이기 때문이다.
 */
function resolveCapBody(): { file: string; code: string; via: string } {
  const delegate = /public\.(grant_catalyst_[a-z_]+)\s*\(/.exec(ENTRY.code);
  if (delegate === null) return { ...ENTRY, via: 'grant_catalyst' };
  const name = delegate[1] ?? '';
  const body = effectiveFunctionBody(name);
  // 2단까지만 허용한다. 래퍼의 래퍼가 생기면 "진입점에서 캡까지"를 사람이 못 따라간다.
  expect(
    /public\.(grant_catalyst_[a-z_]+)\s*\(/.exec(body.code),
    `${name} 이 또 위임한다 — 위임은 1단까지만 허용한다`,
  ).toBeNull();
  return { ...body, via: name };
}

const GRANT = resolveCapBody();

// ---------------------------------------------------------------------------
// 0. 대상 확정 — 캡 본문이 실제로 어디 있는지 먼저 못 박는다
// ---------------------------------------------------------------------------

describe('grant_catalyst 유효 정의', () => {
  it('클라 진입점에서 출발하면 캡 본문에 반드시 닿는다', () => {
    // 이 단언이 없으면, 누군가 뒤에 붙인 마이그레이션이 캡 없는 본문으로 되돌려도 아래 단언들이
    // "옛 파일을 읽고" 통과할 수 있다 — 어느 정의를 재고 있는지가 계약의 전제다.
    //
    // 양성 앵커: 해석기가 엉뚱한(비어 있는) 함수를 가리키면 여기서 죽는다. 이것이 없으면
    // 위임 추적이 빗나가도 아래가 전부 조용히 통과할 수 있다.
    expect(GRANT.code, `캡 본문을 못 찾았다(via=${GRANT.via})`).toContain('CAP_HOURLY_CATALYSTS');
    expect(GRANT.file).toMatch(/^\d{14}_.*\.sql$/);
  });

  it('진입점이 본문을 갖거나 정확히 하나에 위임한다 — 캡 우회 경로가 없다', () => {
    if (GRANT.via === 'grant_catalyst') {
      // 옛 형태: 진입점이 곧 본문이다.
      expect(ENTRY.code).toContain('insert into public.catalyst_grants');
      return;
    }
    // 2단 형태: 래퍼는 **본문을 갖지 않는다.** 본문이 두 벌이 되면 한쪽만 튜닝돼 캡이 갈리고,
    // 그때 클라 경로가 어느 쪽을 타는지는 아무도 모른다.
    expect(ENTRY.code, '래퍼가 아직 자기 캡 본문을 들고 있다').not.toContain('CAP_HOURLY_CATALYSTS');
    expect(ENTRY.code, '래퍼가 자기 원장을 쓴다').not.toContain('insert into public.catalyst_grants');
    // 그리고 래퍼는 수신자를 **자기 JWT 에서만** 만든다 — 인자로 받으면 클라가 남의 촉매를
    // 늘릴 수 있고, 그 순간 이 함수가 authenticated 에 열려 있다는 사실이 결함이 된다.
    expect(ENTRY.code, '래퍼가 auth.uid() 가 아닌 값을 수신자로 넘긴다').toMatch(
      /grant_catalyst_[a-z_]+\(\s*auth\.uid\(\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// 1. 누적 캡 — 존재와 산정식
// ---------------------------------------------------------------------------

describe('grant_catalyst — 1h·24h 누적 캡', () => {
  it('catalyst_grants 원장에서 두 창의 실적립 합을 읽는다', () => {
    expect(GRANT.code).toContain('public.catalyst_grants');
    expect(GRANT.code, '1시간 창 질의가 없다').toContain("interval '1 hour'");
    expect(GRANT.code, '24시간 창 질의가 없다').toContain("interval '24 hours'");
    // 합산 축은 requested 가 아니라 실적립 qty 여야 한다 — requested 로 세면 거부된 요청이
    // 정직한 플레이어의 예산을 갉아먹는다.
    expect(GRANT.code).toMatch(/coalesce\(sum\(qty\),\s*0\)\s+into\s+v_1h/);
    expect(GRANT.code).toMatch(/coalesce\(sum\(qty\),\s*0\)\s+into\s+v_24h/);
  });

  it('남은 예산이 1h·24h 잔여의 최소값이다', () => {
    const m = /v_rem\s*:=\s*least\(([\s\S]*?)\);/.exec(GRANT.code);
    expect(m, 'v_rem := least(...) 형상이 아니다').not.toBeNull();
    const expr = (m![1] ?? '').replace(/\s+/g, ' ');
    expect(expr).toContain('CAP_HOURLY_CATALYSTS - v_1h');
    expect(expr).toContain('CAP_DAILY_CATALYSTS - v_24h');
    expect(expr, '음수 예산 방어(greatest(0, ..))가 없다').toContain('greatest(0,');
  });

  it('실적립이 per-call 캡·남은 예산·요청량 셋의 최소값이다', () => {
    expect(GRANT.code).toMatch(/v_call\s*:=\s*least\(v_want,\s*CAP_GRANT_PER_CALL\)/);
    expect(GRANT.code).toMatch(/v_grant\s*:=\s*greatest\(0,\s*least\(v_call,\s*v_rem\)\)/);
  });

  it('캡 초과를 예외가 아니라 클램프로 처리한다', () => {
    // 정산 경로가 fire-and-forget(src/net/index.ts grantCatalystDrops)이라 예외를 던지면
    // 정직한 플레이어가 캡 근처에서 드랍을 통째로 잃는다. raise 는 로그인·미지 id 둘뿐이다.
    const raises = [...GRANT.code.matchAll(/raise exception/g)];
    expect(raises.length, 'raise exception 이 2개(로그인·미지 id)를 넘는다 — 캡이 예외로 바뀌었다').toBe(2);
    expect(GRANT.code).toContain("'clamped'");
  });
});

// ---------------------------------------------------------------------------
// 2. 캡 값의 파생 — 리터럴이 아니라 관측 가정에서 나와야 한다
// ---------------------------------------------------------------------------

describe('캡 상수의 파생 (하드코딩 금지)', () => {
  it('시간당 캡이 정직한 플레이 가정 × 여유에서 파생된다', () => {
    // 값 하나만 박아 두면 "왜 360인가"가 사라지고, 밸런스 패스에서 근거 없이 흔들린다.
    expect(declaredConstant(GRANT.code, 'CAP_HOURLY_CATALYSTS')).toBe(
      'PLAUSIBLE_RUNS_PER_HOUR * PLAUSIBLE_CATALYSTS_PER_RUN * CAP_HEADROOM',
    );
    expect(declaredConstant(GRANT.code, 'CAP_DAILY_CATALYSTS')).toBe('CAP_HOURLY_CATALYSTS * 6');
  });

  it('일일 캡이 시간당 캡보다 크다', () => {
    const runs = Number(declaredConstant(GRANT.code, 'PLAUSIBLE_RUNS_PER_HOUR'));
    const perRun = Number(declaredConstant(GRANT.code, 'PLAUSIBLE_CATALYSTS_PER_RUN'));
    const head = Number(declaredConstant(GRANT.code, 'CAP_HEADROOM'));
    const hourly = runs * perRun * head;
    expect(Number.isFinite(hourly)).toBe(true);
    expect(hourly).toBeGreaterThan(0);
    expect(hourly * 6).toBeGreaterThan(hourly);
  });

  it('per-call 캡은 20260727000000 의 100 을 승계한다', () => {
    // 이 축의 결함은 per-call 값이 아니라 누적 캡의 부재였다. 값을 함께 흔들면 회귀 원인이 둘이 된다.
    expect(declaredConstant(GRANT.code, 'CAP_GRANT_PER_CALL')).toBe('100');
  });

  it('시간당 캡이 정직한 최대 적립 속도보다 넉넉히 크다', () => {
    // 캡이 정직한 플레이를 막으면 그건 방어가 아니라 버그다. 현실적 피크(20런/h × 3)의 3배 이상.
    const runs = Number(declaredConstant(GRANT.code, 'PLAUSIBLE_RUNS_PER_HOUR'));
    const perRun = Number(declaredConstant(GRANT.code, 'PLAUSIBLE_CATALYSTS_PER_RUN'));
    const hourly = runs * perRun * Number(declaredConstant(GRANT.code, 'CAP_HEADROOM'));
    expect(hourly).toBeGreaterThanOrEqual(3 * (20 * perRun));
  });
});

// ---------------------------------------------------------------------------
// 3. 원장 — 캡의 유일한 근거. 기록이 빠지면 캡이 조용히 무한대가 된다.
// ---------------------------------------------------------------------------

describe('catalyst_grants 원장', () => {
  const raw = rawMigrationText();

  it('테이블 DDL 이 존재하고 절삭 폭(requested)을 보존한다', () => {
    const m = /create table if not exists public\.catalyst_grants \(([\s\S]*?)\n\);/.exec(raw);
    expect(m, 'catalyst_grants 테이블 선언이 없다').not.toBeNull();
    const cols = stripLineComments(m![1] ?? '');
    for (const c of ['profile_id', 'catalyst_id', 'requested', 'qty', 'created_at']) {
      expect(cols, `컬럼 ${c} 이 없다`).toContain(c);
    }
    expect(cols, '음수 적립 방어 체크가 없다').toMatch(/check\s*\(\s*qty\s*>=\s*0\s*\)/);
  });

  it('RLS 가 켜져 있고 본인 select 만 허용하며 쓰기 정책이 없다', () => {
    expect(raw).toContain('alter table public.catalyst_grants enable row level security');
    expect(raw).toMatch(/create policy catalyst_grants_select_own[\s\S]*?for select/);
    // 원장을 클라가 쓸 수 있으면 캡이 그 위조로 열린다 — 쓰기 정책은 단 하나도 없어야 한다.
    const policies = [...raw.matchAll(/create policy \w+\s+on public\.catalyst_grants for (\w+)/g)]
      .map((x) => x[1]);
    expect(policies).toEqual(['select']);
  });

  it('누적 캡 질의를 태울 인덱스가 있다', () => {
    expect(raw).toMatch(
      /create index if not exists \w+\s+on public\.catalyst_grants \(profile_id, created_at desc\)/,
    );
  });

  it('grant_catalyst 가 실적립 시 원장에 기록한다', () => {
    expect(GRANT.code).toMatch(/insert into public\.catalyst_grants[\s\S]*?requested[\s\S]*?qty/);
    expect(GRANT.code, '기록이 v_grant > 0 분기 안에 있어야 한다').toMatch(
      /if v_grant > 0 then[\s\S]*?insert into public\.catalyst_grants/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. GC TTL > 누적 창 — 뒤집히면 캡이 스스로 열린다
// ---------------------------------------------------------------------------

describe('catalyst_grants GC', () => {
  it('TTL 이 누적 창(24h)보다 길다', () => {
    const raw = rawMigrationText();
    const at = raw.indexOf("'planet-blitz-gc-catalyst-grants'");
    expect(at, 'catalyst_grants GC cron 이 등록돼 있지 않다 — 원장이 무한히 자란다').toBeGreaterThan(-1);
    const block = raw.slice(at, at + 600);
    expect(block).toContain('delete from public.catalyst_grants');
    const m = /interval '(\d+) hours'/.exec(block);
    expect(m, 'GC TTL interval 을 찾지 못했다').not.toBeNull();
    expect(
      Number(m![1]),
      'GC TTL 이 누적 창(24h) 이하다 — GC 가 캡의 근거 행을 지워 캡이 스스로 열린다',
    ).toBeGreaterThan(24);
  });
});

// ---------------------------------------------------------------------------
// 5. 잠금 순서 — grant_catalyst 가 profiles 를 잠그기 시작했으므로 규약 대상이 3종이 됐다
// ---------------------------------------------------------------------------

describe('ABBA 데드락 방지 — catalyst_inventory → profiles (3종 전부)', () => {
  for (const name of ['salvage_catalyst', 'buy_catalyst', 'grant_catalyst'] as const) {
    it(`${name} 의 for update 등장 순서가 inventory → profiles 다`, () => {
      const order = forUpdateLockOrder(effectiveFunctionBody(name).code);
      expect(
        order,
        '잠금 순서가 뒤집히면 세 RPC 가 정면 교착한다 — 단위 테스트·1바퀴 플레이·육안 중 무엇으로도 안 잡힌다',
      ).toEqual(['catalyst_inventory', 'profiles']);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. 플래깅 — 절삭 전 요청량으로 판정해야 한다
// ---------------------------------------------------------------------------

describe('극단 요청 플래깅', () => {
  it('flagged 를 세우고, 판정 기준이 절삭 전 요청량(v_want)이다', () => {
    expect(GRANT.code).toMatch(/update public\.profiles set flagged = true/);
    // v_grant(절삭 후)로 판정하면 캡이 증거를 지운다 — 무한 적립 시도가 영원히 무기록이 된다.
    expect(GRANT.code).toMatch(/if v_want > FLAG_MULTIPLE \* CAP_GRANT_PER_CALL then/);
  });
});

// ---------------------------------------------------------------------------
// 7. 유령 행 — 0 요청이 원장에 행을 만들면 안 된다
// ---------------------------------------------------------------------------

describe('0 요청 조기 반환', () => {
  it('v_want <= 0 이면 잠금·행 생성 이전에 반환한다', () => {
    const code = GRANT.code;
    const guard = code.indexOf('if v_want <= 0 then');
    const ensure = code.indexOf('insert into public.catalyst_inventory');
    expect(guard, '0 요청 게이트가 없다 — qty=0 유령 행이 생긴다').toBeGreaterThan(-1);
    expect(ensure).toBeGreaterThan(guard);
    expect(code).toContain('nothing-to-grant');
  });
});
