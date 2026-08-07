/**
 * 축 A — 침공 빈도 캡 계약 대조 (ADR-0050 §3 단계 2 ·
 * `supabase/migrations/20260808020000_invasion_rate_cap.sql`).
 *
 * 이 계약이 지키는 것은 넷이고, **넷 다 깨져도 런타임에는 조용하다** — 침공은 어차피 되고,
 * "무제한으로도 된다"는 것은 정직한 플레이에서 절대 안 보인다:
 *
 *   ① 캡의 존재 — 없으면 클라가 PostgREST 직타로 침공 행을 무제한 만든다
 *   ② ⭐ **분모가 서버 것**(`now()` + 실제 행 수). 클라 값이 섞이면 캡은 장식이다
 *   ③ **공격자 기준**으로 센다 — 쌍(공격자×방어자) 기준으로 세면 상대만 바꿔 빠져나간다.
 *      기존 재도전 쿨다운(20260726000000:332-349)이 정확히 그 한계였고, 이 캡이 그것을 메운다
 *   ④ 기존 self-invasion 가드와 **공존** — 트리거 이름이 겹치면 이전 축이 조용히 사라진다
 *
 * ⚠️ 단언은 줄 주석 제거본으로 한다 — 이 리포의 SQL 은 규약을 길게 주석으로 적어 두고
 * 그 주석에 계약 문자열이 그대로 들어 있다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const MINE = '20260808020000_invasion_rate_cap.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** 적용 순 기준 **마지막** 정의 본문 = 실제로 사는 정의. */
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

function constantOf(code: string, name: string): string {
  const m = code.match(new RegExp(`${name}\\s+constant\\s+\\w+\\s*:=\\s*([^;]+);`));
  if (m === null || m[1] === undefined) throw new Error(`${name} 상수를 찾지 못했습니다`);
  return m[1].trim();
}

const guard = () => effectiveFunctionBody('guard_invasions_rate_limit').code;
/** 캡 판정부(카운트 시작 ~ 예외)만 잘라낸다. */
const capWindow = (): string => {
  const c = guard();
  const from = c.indexOf('select count(*)');
  const to = c.indexOf('raise exception');
  expect(from, '카운트 질의를 찾지 못함').toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return c.slice(from, to);
};

describe('① 캡이 존재하고 실제로 막는다', () => {
  it('상한 상수와 초과 시 거부가 있다', () => {
    const c = guard();
    expect(constantOf(c, 'CAP_INVASIONS_PER_HOUR')).toBe('20');
    expect(c).toContain('v_count >= CAP_INVASIONS_PER_HOUR');
    // 양성 단언 — 상수만 두고 안 쓰는 빈 구현을 막는다.
    expect(c).toContain('raise exception');
    expect(c).toContain("errcode = 'check_violation'");
  });

  it('트리거가 실제로 붙어 있다', () => {
    const code = stripLineComments(
      migrationsInOrder().find((m) => m.file === MINE)!.sql,
    );
    expect(code).toMatch(/create or replace trigger trg_invasions_rate_limit/);
    expect(code).toMatch(/before insert on public\.invasions/);
    expect(code).toContain('execute function public.guard_invasions_rate_limit()');
  });
});

describe('② ⭐ 분모가 서버 것이다', () => {
  it('now() 벽시계 + 실제 침공 행 수로 센다', () => {
    const w = capWindow();
    expect(w).toContain('public.invasions');
    expect(w).toContain("created_at > now() - interval '1 hour'");
  });

  it('캡 판정에 클라가 주는 값이 안 들어간다', () => {
    const w = capWindow();
    // 트리거의 NEW 에서 캡 판정에 써도 되는 것은 attacker_id(신원) 하나뿐이다.
    // 클라가 값을 정하는 다른 컬럼이 분모에 섞이면 캡을 스스로 열 수 있다.
    for (const clientCol of ['new.created_at', 'new.client_result', 'new.replay', 'new.is_revenge']) {
      expect(w, `${clientCol} 가 캡 분모에 섞였다 — 캡이 장식이 된다`).not.toContain(clientCol);
    }
  });
});

describe('③ ⭐ 공격자 기준으로 센다 (쌍 기준이면 상대만 바꿔 빠져나간다)', () => {
  it('분모가 attacker_id 이고 defender_id 가 아니다', () => {
    const w = capWindow();
    expect(w).toContain('attacker_id = new.attacker_id');
    // 쌍으로 좁히면 기존 재도전 쿨다운과 같은 한계가 되어 이 캡이 아무것도 안 막는다.
    expect(w, 'defender_id 로 좁히면 상대를 바꿔 무제한으로 빠져나간다').not.toContain(
      'defender_id',
    );
  });
});

describe('④ 기존 가드와 공존한다', () => {
  it('self-invasion 가드를 덮지 않는다 (트리거·함수 이름이 다르다)', () => {
    const code = stripLineComments(
      migrationsInOrder().find((m) => m.file === MINE)!.sql,
    );
    // 이 리포는 재정의가 이전 축을 조용히 떨어뜨리는 결함을 반복해 겪었다.
    expect(code).not.toContain('guard_invasions_self');
    expect(code).not.toMatch(/drop trigger[\s\S]*invasions/);
  });

  it('service_role 은 면제하되 클라는 면제하지 않는다', () => {
    const c = guard();
    expect(c).toContain('is_service_role()');
    // 면제가 캡보다 **먼저** 와야 검증 스크립트가 안 막힌다. 순서가 뒤집히면 무해하지만
    // 면제 자체가 사라지면 supabase/tests/*.sql 이 통째로 깨진다.
    expect(c.indexOf('is_service_role()')).toBeLessThan(c.indexOf('select count(*)'));
  });
});

describe('settle 계열 불가침 (이 레인의 상시 경계)', () => {
  it('이 마이그레이션은 settle 계열을 재정의하지 않는다', () => {
    const code = stripLineComments(
      migrationsInOrder().find((m) => m.file === MINE)!.sql,
    );
    expect(code).not.toContain('create or replace function public.settle_pve_run');
    expect(code).not.toContain('create or replace function public.settle_commission');
    expect(code).not.toContain('create or replace function public.apply_invasion_result');
  });
});
