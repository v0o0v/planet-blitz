/**
 * 마이그레이션의 **확장 함수 스키마 한정** 계약.
 *
 * ## 왜 이 파일이 생겼나 (2026-08-08, 실제 배포 실패)
 *
 * `20260808010000_item_grants_ledger.sql` 와 `20260808030000_refine_server_roll.sql` 이
 * pgcrypto 함수를 **`public.gen_random_bytes` · `public.digest`** 로 불렀다. 원격 적용이
 * 첫 시도에서 그대로 터졌다:
 *
 * ```
 * ERROR: 42883: function public.gen_random_bytes(integer) does not exist
 * ```
 *
 * Supabase 는 pgcrypto 를 **`extensions` 스키마**에 심는다(원격 실측: `gen_random_bytes` ·
 * `digest` · `hmac` 전부 `extensions`). 그래서 `create extension if not exists pgcrypto;` 는
 * 이미 설치돼 있어 **조용한 no-op** 이고, `public.` 한정은 영영 안 맞는다.
 * `gen_random_uuid` 만 예외로 `pg_catalog` 에도 있어 **한정 없이** 쓰면 항상 풀린다.
 *
 * ⭐⭐ **이 결함이 두 PR(#363·#367)을 통과해 머지된 이유**: 이 리포의 SQL 계약 테스트는 전부
 * **마이그레이션 파일을 텍스트로 읽어 단언**한다 — SQL 을 **실행하지 않는다.** 그래서
 * "문법이 맞나"도 "함수가 실재하나"도 아무도 안 본다. `pnpm verify` 가 전량 초록인 채로
 * **적용 불가능한 마이그레이션**이 두 개 쌓여 있었고, 배포를 시도한 순간에야 드러났다.
 *
 * 이 파일은 그 부류 전체를 막는다 — 개별 결함 두 건을 고치는 것으로 끝내면 다음 사람이
 * 같은 자리에서 같은 실수를 한다(확장 함수를 쓸 때 `public.` 을 붙이는 것이 자연스러워 보인다).
 *
 * ⚠️ **이것도 실행 검증은 아니다.** 여전히 텍스트 대조이고, 막는 것은 *"확장 함수를 `public.`
 *    로 한정했다"* 하나뿐이다. 진짜 안전망은 원격 적용 스크립트의 사후 검증절이다
 *    (`scripts/apply-item-ledger-migrations.ps1`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/**
 * `extensions` 스키마에 사는 함수들(Supabase 기본 배치). 여기 이름을 늘릴 때는 원격에서
 * `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace`
 * 로 **실측하고** 늘려라 — 추측으로 늘리면 이 테스트가 정상 코드를 빨갛게 만든다.
 */
const EXTENSION_FUNCTIONS = ['gen_random_bytes', 'digest', 'hmac', 'crypt', 'gen_salt'];

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거 — 이 리포 SQL 은 규약을 주석에 길게 적고 그 주석이 식별자를 그대로 인용한다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

describe('마이그레이션 — 확장 함수 스키마 한정', () => {
  it('⭐ pgcrypto 함수를 `public.` 으로 한정한 자리가 없다 (원격에서 42883 으로 터진다)', () => {
    const hits: string[] = [];
    for (const { file, sql } of migrations()) {
      const code = stripLineComments(sql);
      for (const fn of EXTENSION_FUNCTIONS) {
        const re = new RegExp(`public\\.${fn}\\s*\\(`, 'g');
        const n = (code.match(re) ?? []).length;
        if (n > 0) hits.push(`${file}: public.${fn}() x${n}`);
      }
    }
    expect(hits, `\n${hits.join('\n')}\n→ Supabase 는 pgcrypto 를 extensions 스키마에 심는다. \`extensions.\` 로 한정해라.`).toEqual([]);
  });

  it('⭐ gen_random_uuid 는 한정하지 않는다 (public 에는 없고 pg_catalog 에 있다)', () => {
    const hits: string[] = [];
    for (const { file, sql } of migrations()) {
      const code = stripLineComments(sql);
      const n = (code.match(/public\.gen_random_uuid\s*\(/g) ?? []).length;
      if (n > 0) hits.push(`${file}: public.gen_random_uuid() x${n}`);
    }
    expect(hits, `\n${hits.join('\n')}\n→ 한정을 떼라. pg_catalog 는 search_path 가 비어도 항상 풀린다.`).toEqual([]);
  });

  // 양성 단언 — 부재만 세면 "확장 함수를 아무도 안 쓴다"도 초록이 된다. 실제로 쓰이고 있고,
  // 그 자리가 `extensions.` 로 한정돼 있어야 이 계약이 무언가를 지키고 있는 것이다.
  it('아이템 원장·정련이 실제로 extensions 한정으로 확장 함수를 쓴다', () => {
    const byName = new Map(migrations().map((m) => [m.file, stripLineComments(m.sql)]));
    const ledger = byName.get('20260808010000_item_grants_ledger.sql');
    const refine = byName.get('20260808030000_refine_server_roll.sql');
    expect(ledger, '아이템 원장 마이그레이션을 찾지 못했다').toBeDefined();
    expect(refine, '정련 마이그레이션을 찾지 못했다').toBeDefined();
    expect(ledger).toContain('extensions.gen_random_bytes(');
    expect(ledger).toContain('extensions.digest(');
    expect(refine).toContain('extensions.gen_random_bytes(');
    // 시드 산식이 확장 함수 위에 서 있다는 사실 자체가 계약이다 — digest 가 사라지면
    // 시드가 클라 입력으로 되돌아갈 여지가 생긴다(ADR-0050 정정 2).
    expect((ledger?.match(/extensions\.digest\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
