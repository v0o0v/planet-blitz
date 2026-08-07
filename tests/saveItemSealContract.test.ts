/**
 * `profiles.save` 아이템 증가분 봉인 계약 대조 (ADR-0050 §3 단계 1 · 정정 1 ·
 * `supabase/migrations/20260808040000_save_item_seal.sql`).
 *
 * 이 계약이 지키는 것은 일곱이고, **일곱 다 깨져도 런타임에는 조용하다** — 봉인이 없어도
 * 게임은 똑같이 돌고, 봉인이 과하게 물어도 증상이 "아이템이 가끔 안 들어온다"라 원인이
 * 화면에 안 나온다:
 *
 *   ① 봉인이 **UPDATE·INSERT 양쪽에** 걸린다 — INSERT 를 빠뜨리면 "지우고 위조 세이브로 다시
 *      INSERT" 로 통째 우회된다(RLS 는 소유권만 검사한다)
 *   ② 기존 스칼라 봉인 **12(UPDATE)·6(INSERT)이 한 개도 안 줄었다** — 이 리포는 함수 재정의 때
 *      앞 정의의 일부를 흘려 PvE 정산을 100% 깨뜨린 전례가 있다(20260802000000:4-15)
 *   ③ ⭐ 프로필 식별자가 **`old.id`** — `new.id` 면 id 를 바꿔 보내 남의 원장으로 조회를 돌린다
 *   ④ ⭐ 원장 조회 셋 전부 **`profile_id = p_profile` 로 못박혔다** — 빠지면 한 명이 받은
 *      유니크를 전원이 심을 수 있다
 *   ⑤ ⭐ allowlist 가 `it-starter-%`(슬롯 고정)만 열고 **`it-{seed}`(자유 시드)는 안 연다** —
 *      후자를 열면 봉인이 아무것도 막지 않는다(위조자가 쓰는 접두사가 정확히 그것이다)
 *   ⑥ save 안 아이템이 사는 **네 자리를 전수로 훑는다** — 빠진 자리에 위조자가 정확히 심는다
 *   ⑦ ⭐⭐ **TS 가 만드는 id 접두사와 SQL allowlist 가 같다** — 한쪽만 바뀌면 봉인이 정직한
 *      배송을 위조로 보고 **전 유저가 배송을 못 받는다.** ①~⑥ 이 전부 통과해도 이것 하나로
 *      게임이 죽는다
 *
 * ⚠️ 단언은 `body` 가 아니라 **`code`(줄 주석 제거본)** 로 한다 — 이 리포의 SQL 은 규약을 길게
 * 주석으로 적어 두고 그 주석에 계약 문자열이 그대로 들어 있다.
 *
 * ⚠️ 부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다 — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rollItem } from '../src/items/roll.js';
import { starterEquipped } from '../src/items/starterKit.js';
import { dropGrantItemId } from '../src/items/dropGrant.js';
import { commissionGrantItemId } from '../src/items/commissionGrant.js';
import { dailyRewardItemId } from '../src/net/dailyReward.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const MINE = '20260808040000_save_item_seal.sql';

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

/**
 * 적용 순 기준 **마지막** 정의 본문 = 실제로 사는 정의.
 *
 * ⭐ 이 헬퍼가 이 파일의 핵심이다. 내 마이그레이션만 읽고 단언하면, 나중에 누가 뒤 타임스탬프로
 * 같은 함수를 재정의하며 봉인을 흘려도 **이 테스트는 계속 초록**이다.
 */
function effectiveFunctionCode(name: string): { file: string; code: string } {
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

/** `new.X := ...;` 대입의 좌변 집합. */
function guardAssignments(code: string): string[] {
  return [...code.matchAll(/new\.(\w+)\s*:=/g)].map((m) => m[1] as string);
}

function srcText(rel: string): string {
  return new TextDecoder().decode(readFileSync(SRC_DIR + rel));
}

describe('save 아이템 증가분 봉인 — 트리거 배선', () => {
  it('① UPDATE 가드의 **현행 정의**가 save 봉인을 부른다', () => {
    const { code } = effectiveFunctionCode('guard_profiles_client_write');
    expect(code).toContain('public.seal_save_items(');
    expect(code).toMatch(/new\.save\s*:=\s*public\.seal_save_items\(/);
  });

  it('① INSERT 가드의 **현행 정의**도 save 봉인을 부른다 (빠지면 통째 우회)', () => {
    const { code } = effectiveFunctionCode('guard_profiles_client_insert');
    expect(code).toMatch(/new\.save\s*:=\s*public\.seal_save_items\(/);
    // OLD 가 없으므로 grandfather 집합은 빈 객체여야 한다. `old.` 를 쓰면 INSERT 에서 터진다.
    expect(code).toContain(`'{}'::jsonb`);
  });

  it('② 기존 스칼라 봉인이 한 개도 안 줄었다 — UPDATE 12 · INSERT 6', () => {
    const upd = guardAssignments(effectiveFunctionCode('guard_profiles_client_write').code);
    const ins = guardAssignments(effectiveFunctionCode('guard_profiles_client_insert').code);
    // save 는 신설분이라 총수에서 뺀다. 나머지가 종전 그대로여야 한다.
    const updScalars = upd.filter((x) => x !== 'save');
    const insScalars = ins.filter((x) => x !== 'save');
    expect(updScalars.length, `UPDATE 스칼라 대입 총수: ${updScalars.join(',')}`).toBe(12);
    expect(insScalars.length, `INSERT 스칼라 대입 총수: ${insScalars.join(',')}`).toBe(6);
    expect(new Set(updScalars)).toEqual(new Set([
      'flagged', 'is_npc', 'lineage_points', 'lineage_ship_level', 'lineage_guardian_level',
      'lineage_last_retired_at', 'credits', 'minerals', 'catalyst_residue',
      'daily_last_claim_seed', 'daily_streak', 'lifetime_granted',
    ]));
    expect(new Set(insScalars)).toEqual(new Set([
      'credits', 'minerals', 'catalyst_residue',
      'daily_last_claim_seed', 'daily_streak', 'lifetime_granted',
    ]));
    // save 봉인이 실제로 그 목록에 **더해졌는지**(빼기만 세고 끝나지 않게) 양성으로 확인한다.
    expect(upd).toContain('save');
    expect(ins).toContain('save');
  });

  it('② 봉인이 is_service_role() 분기 **안**에 있다 (definer 자기참조 차단)', () => {
    for (const fn of ['guard_profiles_client_write', 'guard_profiles_client_insert']) {
      const { code } = effectiveFunctionCode(fn);
      const guardAt = code.indexOf('is_service_role()');
      const sealAt = code.indexOf('seal_save_items(');
      expect(guardAt, `${fn}: is_service_role 분기가 없다`).toBeGreaterThan(-1);
      expect(sealAt, `${fn}: 봉인이 서비스롤 분기 앞에 있다`).toBeGreaterThan(guardAt);
    }
  });

  it('③ ⭐ UPDATE 봉인이 `old.id` 를 쓴다 — `new.id` 면 남의 원장으로 조회가 돈다', () => {
    const { code } = effectiveFunctionCode('guard_profiles_client_write');
    const call = /public\.seal_save_items\(([^)]*)\)/.exec(code);
    expect(call, '봉인 호출을 파싱하지 못했다').not.toBeNull();
    const args = (call?.[1] ?? '').split(',').map((s) => s.trim());
    expect(args[0]).toBe('old.id');
    // 양성 — 나머지 두 인자도 OLD/NEW 쌍이어야 증가분 비교가 성립한다.
    expect(args[1]).toBe('old.save');
    expect(args[2]).toBe('new.save');
  });
});

describe('save 아이템 증가분 봉인 — allowlist 술어', () => {
  it('④ ⭐ 원장 조회 셋 전부 profile_id 로 못박혔다', () => {
    const { code } = effectiveFunctionCode('item_id_ledgered');
    for (const table of ['item_grants', 'commission_grants', 'daily_reward_claims']) {
      const at = code.indexOf(`public.${table}`);
      expect(at, `${table} 조회가 없다`).toBeGreaterThan(-1);
      // 그 exists 절 안(다음 원장 조회가 시작되기 전)에 profile_id 조건이 있어야 한다.
      const rest = code.slice(at, at + 320);
      expect(rest, `${table}: profile_id 고정이 없다`).toMatch(/profile_id\s*=\s*p_profile/);
    }
  });

  it('⑤ ⭐ allowlist 가 `it-starter-%` 만 열고 자유 시드 `it-%` 는 안 연다', () => {
    const { code } = effectiveFunctionCode('item_id_ledgered');
    // 양성 — 초기 지급이 실제로 통과해야 한다. 없으면 신규 계정이 첫 장비를 잃는다.
    expect(code).toMatch(/like\s+'it-starter-%'\s+then\s+true/);
    // 부재 — 자유 시드 접두를 무조건 통과시키는 분기가 있으면 봉인이 장식이 된다.
    expect(code).not.toMatch(/like\s+'it-%'/);
    expect(code).not.toMatch(/like\s+'it-'\s*\|\|/);
    // 기본 분기가 **거짓**이어야 한다 — `else true` 면 모든 것이 통과한다.
    expect(code).toMatch(/else\s+false\s*\n?\s*end/);
  });

  it('⑥ save 안 아이템이 사는 네 자리를 전수로 훑는다', () => {
    const { code } = effectiveFunctionCode('save_item_ids');
    expect(code).toContain(`p_save->'inventory'`);
    expect(code).toContain(`p_save->'stash'`);
    expect(code).toContain(`p_save->'ships'`);
    expect(code).toContain(`sh->'equipped'`);
    expect(code).toContain(`p_save->'guardians'`);
    expect(code).toContain(`g->'build'->'equipped'`);
    // 장착은 배열이 아니라 객체(Partial<Record<EquipSlotId, Item>>)라 jsonb_each 여야 한다.
    expect(code).toContain('jsonb_each(');
  });

  it('⑥ 위반 제거가 **배열 순서를 보존**한다 (인벤 순서 = 화면 배치)', () => {
    const { code } = effectiveFunctionCode('reject_items_by_id');
    expect(code).toMatch(/jsonb_agg\([^)]*order by/);
    expect(code).toContain('with ordinality');
  });
});

describe('save 아이템 증가분 봉인 — ⑦ TS ↔ SQL 접두사 미러', () => {
  // ⭐⭐ 이 절이 이 파일에서 가장 값비싼 축이다. 위 여섯이 전부 통과해도, TS 가 만드는 id 와
  //    SQL allowlist 가 어긋나면 **정직한 배송이 전부 위조로 판정돼 전 유저가 아이템을 못 받는다.**
  //    한쪽만 고치는 것이 정확히 그 사고의 경로다.
  const code = mineCode();

  it('드랍 배송 id 접두사가 SQL allowlist 와 같다', () => {
    const id = dropGrantItemId('11111111-2222-3333-4444-555555555555');
    expect(id.startsWith('drop:')).toBe(true);
    expect(code).toContain(`like 'drop:%'`);
    // 조립 방식도 같아야 한다 — SQL 이 `'drop:' || grant_id` 로 만든다.
    expect(code).toContain(`'drop:' || g.grant_id::text`);
    expect(`drop:${'11111111-2222-3333-4444-555555555555'}`).toBe(id);
  });

  it('의뢰 배송 id 접두사가 SQL allowlist 와 같다', () => {
    const id = commissionGrantItemId('11111111-2222-3333-4444-555555555555');
    expect(id.startsWith('commission:')).toBe(true);
    expect(code).toContain(`like 'commission:%'`);
    expect(code).toContain(`'commission:' || g.grant_id::text`);
  });

  it('일일 보상 id 접두사가 SQL allowlist 와 같다', () => {
    const id = dailyRewardItemId(20260808);
    expect(id).toBe('daily:20260808');
    expect(code).toContain(`like 'daily:%'`);
    expect(code).toContain(`'daily:' || c.date_seed::text`);
  });

  it('⭐ 초기 지급 8칸이 전부 allowlist 접두사를 쓴다 (안 그러면 신규 계정이 첫 장비를 잃는다)', () => {
    const eq = starterEquipped();
    const ids = Object.values(eq).map((it) => it.id);
    expect(ids.length, '초기 지급이 아무것도 안 만든다').toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.startsWith('it-starter-'), `초기 지급 id 가 allowlist 밖이다: ${id}`).toBe(true);
    }
  });

  it('⭐ 드랍 롤이 만드는 id 는 allowlist **밖**이다 (봉인이 실제로 무언가를 막는다)', () => {
    // 이 단언이 빨개지는 유일한 경우는 `rollItem` 이 접두사를 바꾼 때다. 그때 봉인은 아무것도
    // 막지 않게 되므로(또는 반대로 전부 막게 되므로) 반드시 여기서 걸려야 한다.
    const it = rollItem(1234, 'normal', { planet: 0, stage: 1, levelCap: 1 });
    expect(it.id).toBe('it-1234');
    expect(it.id.startsWith('it-starter-')).toBe(false);
  });
});

describe('save 아이템 증가분 봉인 — 짝이 되는 클라 변경', () => {
  it('온라인 계정은 로컬 롤로 강등하지 않는다 (클라가 심고 서버가 지우는 상태 차단)', () => {
    const main = srcText('main.ts');
    const m = /const serverDrops = ([^;]+);/.exec(main);
    expect(m, 'serverDrops 판정을 찾지 못했다').not.toBeNull();
    const expr = (m?.[1] ?? '').replace(/\s+/g, ' ');
    // 양성 — 등록된 런은 여전히 서버 권위다.
    expect(expr).toContain('dropRunId !== null');
    // ⭐ 신설 — 설정된 계정이면 등록이 없어도 로컬 롤로 내려가지 않는다.
    expect(expr).toContain('isNetConfigured()');
  });

  it('미설정(데모/하네스) 경로의 로컬 롤은 살아 있다', () => {
    // `settleRun` 의 로컬 롤 루프가 지워지면 미설정 플레이가 전리품을 통째로 잃는다.
    const settlement = srcText('save/settlement.ts');
    expect(settlement).toContain('if (!opts.serverDrops)');
    expect(settlement).toContain('rollItem(');
  });
});

describe('save 아이템 증가분 봉인 — items · ships RLS 축소 (부수)', () => {
  it('클라 쓰기 정책(for all)이 사라지고 select 만 남았다', () => {
    const code = mineCode();
    expect(code).toContain('drop policy if exists items_rw_own on public.items');
    expect(code).toContain('drop policy if exists ships_rw_own on public.ships');
    // 양성 — 조회는 남겨야 한다(정책이 0개면 조회도 막혀 나중에 배선할 때 원인을 못 찾는다).
    expect(code).toMatch(/create policy items_select_own[\s\S]*?for select/);
    expect(code).toMatch(/create policy ships_select_own[\s\S]*?for select/);
    // 이 마이그레이션이 두 테이블에 `for all` 을 다시 만들지 않는다.
    const forAllOnMine = [...code.matchAll(/create policy (\w+)\s+on public\.(items|ships) for all/g)];
    expect(forAllOnMine.length, `for all 정책이 남아 있다: ${JSON.stringify(forAllOnMine)}`).toBe(0);
  });
});
