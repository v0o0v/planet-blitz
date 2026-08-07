/**
 * 아이템 서버 원장 계약 대조 (ADR-0050 §3 단계 1 ·
 * `supabase/migrations/20260808010000_item_grants_ledger.sql`).
 *
 * 이 계약이 지키는 것은 여섯이고, **여섯 다 깨져도 런타임에는 조용하다** — 아이템은 어차피
 * 나오고, 그것이 서버 것인지 클라 것인지는 화면에 안 보인다:
 *
 *   ① 원장에 **클라 쓰기 정책이 없다** — 생기면 "클라는 무엇이 나올지 모른다"가 즉시 거짓이 된다
 *   ② `server_secrets` 가 **완전 비공개** — 새면 어떤 drop_index 가 유니크를 내는지 오프라인
 *      전수 탐색이 가능하다(ADR-0050 정정 2 가 클라 시드 안을 기각한 바로 그 이유)
 *   ③ ⭐ **시드 산식에 클라 입력이 없다** — 한 바이트라도 들어가면 위 탐색이 다시 열린다
 *   ④ ⭐ **개수 캡의 분모가 서버 것**(`now() - started_at`). 클라 값으로 바뀌면 캡은 장식이다.
 *      `settle_pve_run` 의 개연성 캡 ①항이 정확히 그 상태다(20260802000000:88-90)
 *   ⑤ **등급 분포 미러가 TS 와 일치** — 조용히 낡으면 서버 드랍만 분포가 어긋나고, 그 차이는
 *      수천 판을 모아야 보인다(촉매 미러가 겪은 드리프트의 재발 방지)
 *   ⑥ 배송 확인이 **`auth.uid()` 로 수령자를 고정** — 파라미터로 받으면 남의 배송을 소진시킨다
 *
 * ⚠️ 단언은 `body` 가 아니라 **`code`(줄 주석 제거본)** 로 한다 — 이 리포의 SQL 은 규약을 길게
 * 주석으로 적어 두고 그 주석에 계약 문자열이 그대로 들어 있다.
 *
 * ⚠️ 부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다 — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DROP_ODDS, stageRareMult, stageUniqueMult } from '../src/sim/drops.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const MINE = '20260808010000_item_grants_ledger.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function mineCode(): string {
  const m = migrationsInOrder().find((x) => x.file === MINE);
  if (m === undefined) throw new Error(`${MINE} 을 찾지 못했습니다`);
  return stripLineComments(m.sql);
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

/** DECLARE 의 `NAME constant <타입> := <식>;` 우변. */
function constantOf(code: string, name: string): string {
  const m = code.match(new RegExp(`${name}\\s+constant\\s+\\w+\\s*:=\\s*([^;]+);`));
  if (m === null || m[1] === undefined) throw new Error(`${name} 상수를 찾지 못했습니다`);
  return m[1].trim();
}

/** drop_odds_mirror 시드 INSERT 의 values 목록. */
function mirrorSeedValues(): number[] {
  const code = mineCode();
  const at = code.indexOf('insert into public.drop_odds_mirror');
  expect(at, 'drop_odds_mirror 시드 INSERT 가 없다').toBeGreaterThan(-1);
  const vals = /values \('default',([^)]*)\)/.exec(code.slice(at));
  if (vals === null || vals[1] === undefined) throw new Error('시드 values 를 파싱하지 못했습니다');
  return vals[1].split(',').map((s) => Number(s.trim()));
}

describe('① 원장은 클라가 쓰지 못한다', () => {
  it('item_grants 에 select 정책만 있고 쓰기 정책이 없다', () => {
    const code = mineCode();
    // 양성: select 정책은 실제로 있어야 한다(테이블만 만들고 조회를 막으면 배송이 안 된다).
    expect(code).toContain('create policy item_grants_select_own');
    expect(code).toMatch(/on public\.item_grants for select/);
    expect(code).toContain('alter table public.item_grants enable row level security');
    // 부재: insert/update/delete 정책이 생기면 "클라는 무엇이 나올지 모른다"가 거짓이 된다.
    expect(code).not.toMatch(/on public\.item_grants\s+for\s+(insert|update|delete|all)/);
  });

  it('한 런의 같은 자리는 한 번만 — 재호출 복제를 구조가 막는다', () => {
    expect(mineCode()).toMatch(/unique \(run_id, drop_index\)/);
  });
});

describe('② server_secrets 는 완전 비공개다', () => {
  it('RLS 를 켜고 정책을 하나도 만들지 않는다', () => {
    const code = mineCode();
    expect(code).toContain('alter table public.server_secrets enable row level security');
    // 정책이 하나라도 생기면 비밀이 새고, 새는 순간 유니크 자리를 오프라인 탐색할 수 있다.
    expect(code).not.toMatch(/on public\.server_secrets\s+for\s+\w+/);
    expect(code).toMatch(/revoke all on table public\.server_secrets from anon, authenticated/);
  });

  it('비밀은 재적용해도 바뀌지 않는다 (바뀌면 발급된 원장의 시드를 재확정 못 한다)', () => {
    expect(mineCode()).toMatch(/insert into public\.server_secrets[\s\S]*?on conflict \(key\) do nothing/);
  });
});

describe('③ ⭐ 시드 산식에 클라 입력이 없다', () => {
  const seedLines = () => {
    const code = effectiveFunctionBody('grant_run_drops').code;
    const from = code.indexOf('v_seed :=');
    const to = code.indexOf('if v_r < v_uni');
    expect(from, '시드 산식을 찾지 못함').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return code.slice(from, to);
  };

  it('시드 = hash(비밀, run_id, drop_index) — 셋이 전부 들어간다', () => {
    const s = seedLines();
    expect(s).toContain('v_secret');
    expect(s).toContain('p_run_id');
    expect(s).toContain("'sha256'");
    // drop_index 는 루프 변수 i 로 들어간다. 빠지면 한 런의 모든 드랍이 같은 아이템이 된다.
    expect(s).toMatch(/i::text::bytea/);
  });

  it('클라가 주는 인자가 시드에 한 바이트도 안 들어간다', () => {
    const s = seedLines();
    for (const clientArg of ['p_claimed', 'p_planet', 'p_stage', 'p_level_cap']) {
      expect(s, `${clientArg} 가 시드 산식에 섞였다 — 오프라인 전수 탐색이 열린다`).not.toContain(
        clientArg,
      );
    }
  });

  it('등급 난수를 시드와 다른 도메인에서 뽑는다', () => {
    // 같은 해시를 겹쳐 쓰면 원장의 drop_seed 만 보고 등급을 역산할 수 있다.
    expect(seedLines()).toContain("'rarity'::bytea");
  });
});

describe('④ ⭐ 개수 캡의 분모가 서버 것이다', () => {
  const code = () => effectiveFunctionBody('grant_run_drops').code;

  it('분모가 now() - started_at 이다', () => {
    const c = code();
    expect(c).toMatch(/v_elapsed\s*:=\s*extract\(epoch from \(now\(\) - v_started\)\)/);
    // started_at 은 begin_pve_run(definer)만 찍고 guard 가 클라 insert 를 막는다(20260808000000).
    expect(c).toMatch(/started_at is not null/);
  });

  it('개수 = least(클라 주장, 시간 개연성, 런 절대 상한)', () => {
    const c = code();
    expect(c).toMatch(/v_grant\s*:=\s*least\(/);
    expect(c).toContain('v_plaus');
    expect(c).toContain('CAP_DROPS_PER_RUN');
    expect(constantOf(c, 'CAP_DROPS_PER_RUN')).toBe('24');
    expect(constantOf(c, 'PLAUS_DROPS_PER_MIN')).toBe('4');
  });

  it('개연성 항의 분모에 클라 주장이 섞이지 않는다', () => {
    const c = code();
    const plaus = c.slice(c.indexOf('v_plaus   :='), c.indexOf('v_grant :='));
    expect(plaus).toContain('v_elapsed');
    // p_claimed 가 여기 들어가면 "클라가 캡을 스스로 정하는" 장식 캡이 된다.
    expect(plaus).not.toContain('p_claimed');
  });

  it('런 소유자를 auth.uid() 로 고정하고 definer 로 돈다', () => {
    const c = code();
    expect(c).toContain('security definer');
    expect(c).toContain('profile_id = v_me');
    expect(c).toContain('for update');
  });

  it('같은 런에 두 번 굴리지 않는다(멱등)', () => {
    expect(code()).toContain("'already-granted'");
  });
});

describe('⑤ ⭐ 등급 분포 미러가 TS 와 일치한다', () => {
  it('세 base 값이 DEFAULT_DROP_ODDS 와 같다', () => {
    const [eliteUnique, eliteRare, bossUnique] = mirrorSeedValues();
    expect(eliteUnique).toBe(DEFAULT_DROP_ODDS.eliteUniqueBase);
    expect(eliteRare).toBe(DEFAULT_DROP_ODDS.eliteRareBase);
    expect(bossUnique).toBe(DEFAULT_DROP_ODDS.bossUniqueBase);
  });

  it('단계 보정 커브가 TS stageUniqueMult/stageRareMult 를 재현한다', () => {
    const [, , , uniqueCap, uniqueK, rareCap, rareK] = mirrorSeedValues();
    // SQL stage_quality_mult 의 식을 그대로 옮긴 것. 미러 파라미터가 TS 와 어긋나면 갈린다.
    const sqlMult = (stage: number, cap: number, k: number): number =>
      stage <= 1 ? 1 : 1 + ((cap - 1) * (stage - 1)) / (stage - 1 + k);

    for (const stage of [0, 1, 2, 5, 10, 25, 60, 200]) {
      expect(sqlMult(stage, uniqueCap!, uniqueK!), `stage=${stage} unique 배율이 갈렸다`).toBeCloseTo(
        stageUniqueMult(stage),
        12,
      );
      expect(sqlMult(stage, rareCap!, rareK!), `stage=${stage} rare 배율이 갈렸다`).toBeCloseTo(
        stageRareMult(stage),
        12,
      );
    }
  });

  it('SQL stage_quality_mult 의 식이 TS 와 같은 모양이다', () => {
    const { code } = effectiveFunctionBody('stage_quality_mult');
    expect(code).toMatch(/p_stage <= 1 then 1/);
    expect(code).toMatch(/1 \+ \(\(p_cap - 1\) \* \(p_stage - 1\)\) \/ \(\(p_stage - 1\) \+ p_k\)/);
  });

  it('등급 판정 경계가 TS rollEliteDrop 과 같은 순서다', () => {
    // TS: r < unique → unique; r < unique+rare → rare; else magic. 순서가 뒤집히면 분포가 갈린다.
    const c = effectiveFunctionBody('grant_run_drops').code;
    expect(c).toMatch(/if v_r < v_uni then v_rarity := 'unique'/);
    expect(c).toMatch(/elsif v_r < v_uni \+ v_rare then v_rarity := 'rare'/);
    expect(c).toMatch(/else v_rarity := 'magic'/);
  });
});

describe('⑥ 배송 확인은 수령자를 고정한다', () => {
  it('auth.uid() 로 고정하고 파라미터로 받지 않는다', () => {
    const { code } = effectiveFunctionBody('mark_item_grant_applied');
    expect(code).toContain('auth.uid()');
    expect(code).toContain('profile_id = v_me');
    expect(code).toContain('applied_at is null');
    // 수령자를 인자로 받으면 남의 배송을 소진시킬 수 있다.
    expect(code).not.toMatch(/p_profile_id/);
  });

  it('0행 갱신도 멱등 성공이다', () => {
    const { code } = effectiveFunctionBody('mark_item_grant_applied');
    expect(code).toMatch(/'ok', true/);
    expect(code).toContain('get diagnostics');
  });
});

describe('settle_pve_run 불가침 (이 레인의 상시 경계)', () => {
  it('이 마이그레이션은 settle 계열을 재정의하지 않는다', () => {
    const code = mineCode();
    expect(code).not.toContain('create or replace function public.settle_pve_run');
    expect(code).not.toContain('create or replace function public.settle_commission');
  });
});
