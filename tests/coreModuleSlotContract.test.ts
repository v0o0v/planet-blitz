/**
 * 코어 모듈 장착 슬롯 계약 대조 (E-1/E-2).
 *
 * 계약: **슬롯 i ↔ 표시 i**. 장착 배열은 고정 길이 {@link MODULE_EQUIP_SLOTS}, 빈 슬롯은 `null`,
 * **밀집화 금지**. 이 계약은 세 곳에 따로 적혀 있다.
 *   ① 클라 net 계층 — `src/net/modules.ts normalizeEquippedModules`(고정 길이 정규화)
 *   ② DB 트리거 — `guard_defenses_equipped_modules`(저장 직전 검증)
 *   ③ DB 경제 RPC — `apply_invasion_result`(소진 차감) · `apply_module_fusion`(재료 소모) ·
 *      `salvage_core_module`(분해) 의 장착 해제 블록
 *
 * 계약이 여러 곳에 적히면 조용히 갈린다 — 실제로 갈려 있었다. `20260722010000_m7b_core_modules.sql`
 * 의 트리거가 검증 전에 `array(select x ... where x is not null)` 로 배열을 재작성해 **null 을
 * 제거**했다(before 트리거라 그 결과가 저장된다). 그래서 슬롯1 을 비우고 슬롯2 에만 장착하면
 * 서버 왕복 후 모듈이 슬롯1 로 이동했다. `apply_invasion_result` 가 `when x is null then null` 로
 * 애써 남긴 빈 슬롯도 같은 update 의 트리거가 다시 지웠다.
 *
 * 클라 단위 테스트만으로는 절대 잡히지 않는 유형이라(클라는 정상, 서버가 어긋남) 여기서는
 * ⓐ 클라 **정규 경로**(`equipModules`/`fetchModuleEquip` 공개 API — 내부 함수 직접 호출 금지)의
 *    실제 wire 값과, ⓑ 마이그레이션 SQL 의 **유효 정의**(같은 함수가 여러 마이그레이션에 있으면
 *    파일명 순서상 마지막 것 = 실제 적용본)를 함께 못박는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { equipModules, fetchModuleEquip, normalizeEquippedModules } from '../src/net/modules.js';
import type { ModulesGateway, ModuleEquipState } from '../src/net/modules.js';
import { MODULE_EQUIP_SLOTS } from '../data/coreModules.js';
import { INVASION_CORE_MODULE_SLOTS } from '../src/sim/invasion/constants.js';

// ---------------------------------------------------------------------------
// 마이그레이션 유효 정의 추출 (파일명 순 = 적용 순 → 마지막 정의가 실제로 산다)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** 마이그레이션 파일을 적용 순(파일명 오름차순)으로 [이름, 본문] 나열. */
function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다(m7bIntegration.test.ts 동일 관용구).
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/**
 * `create or replace function public.<name>(` 의 **마지막** 정의 본문을 돌려준다(적용 순 기준).
 * 본문은 선언부터 본문 종결 `$$;` 까지. 못 찾으면 throw(계약 대상이 사라진 것도 회귀다).
 */
function effectiveFunctionBody(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const marker = `create or replace function public.${name}(`;
    const at = sql.lastIndexOf(marker);
    if (at < 0) continue;
    const end = sql.indexOf('\n$$;', at);
    expect(end, `${file}: ${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    found = { file, body: sql.slice(at, end + 4) };
  }
  if (found === null) throw new Error(`마이그레이션에서 ${name} 정의를 찾지 못했습니다`);
  return found;
}

/** 장착 해제/정리용 `update public.defenses` 블록만 잘라낸다. */
function defensesUnequipBlock(body: string): string {
  const at = body.indexOf('update public.defenses d');
  expect(at, '장착 해제 update 블록이 없다').toBeGreaterThan(-1);
  const end = body.indexOf(';', body.indexOf('where', at));
  return body.slice(at, end > at ? end : body.length);
}

// ---------------------------------------------------------------------------
// 1. 상수 미러 — 세 곳이 같은 슬롯 수를 본다
// ---------------------------------------------------------------------------

describe('코어 모듈 슬롯 수 — 클라 상수 ↔ 트리거 상한', () => {
  const guard = effectiveFunctionBody('guard_defenses_equipped_modules');

  it('MODULE_EQUIP_SLOTS 와 INVASION_CORE_MODULE_SLOTS 가 같다', () => {
    expect(MODULE_EQUIP_SLOTS).toBe(INVASION_CORE_MODULE_SLOTS);
  });

  it('트리거 상한 리터럴이 클라 상수와 같다', () => {
    const m = /if v_len > (\d+) then/.exec(guard.body);
    expect(m, '트리거에 슬롯 수 상한 판정이 없다').not.toBeNull();
    expect(Number(m![1])).toBe(MODULE_EQUIP_SLOTS);
  });
});

// ---------------------------------------------------------------------------
// 2. 트리거는 빈 슬롯을 보존한다 (E-1 본체)
// ---------------------------------------------------------------------------

describe('guard_defenses_equipped_modules — 빈 슬롯 보존(밀집화 금지)', () => {
  const guard = effectiveFunctionBody('guard_defenses_equipped_modules');

  it('null 을 걸러내는 방식으로 배열을 재작성하지 않는다', () => {
    // 구 정의의 밀집화 구문. before 트리거라 재작성 결과가 그대로 저장돼 슬롯이 앞으로 당겨졌다.
    expect(guard.body).not.toMatch(/new\.equipped_module_ids\s*:=\s*array\(\s*select\s+x\s+from\s+unnest/);
    expect(guard.body).not.toContain('where x is not null');
  });

  it('배열에 대한 유일한 대입은 null → 빈 배열 정규화뿐이다', () => {
    const assigns = guard.body.match(/new\.equipped_module_ids\s*:=/g) ?? [];
    expect(assigns.length).toBe(1);
    expect(guard.body).toMatch(/if new\.equipped_module_ids is null then\s*\n\s*new\.equipped_module_ids := '\{\}'::uuid\[\];/);
  });

  it('원래 의도(길이 상한·중복 금지·소유 검증)는 그대로 남아 있다', () => {
    expect(guard.body).toContain('array_length(new.equipped_module_ids, 1)');
    expect(guard.body).toContain('코어 모듈 슬롯은 최대');
    expect(guard.body).toContain('같은 코어 모듈을 두 슬롯에 장착할 수 없음');
    expect(guard.body).toContain('소유하지 않은 코어 모듈은 장착 불가');
    expect(guard.body).toContain('c.profile_id = new.profile_id');
    // 거부는 check_violation 으로(클라 net 계층이 error 로 흡수하는 계약).
    expect((guard.body.match(/errcode = 'check_violation'/g) ?? []).length).toBe(3);
  });

  it('중복·소유 판정은 non-null 원소 수(count) 기준이다 — 빈 슬롯이 판정을 오염시키지 않는다', () => {
    expect(guard.body).toMatch(/count\(x\)/);
    expect(guard.body).toMatch(/count\(distinct x\)/);
  });
});

// ---------------------------------------------------------------------------
// 3. 장착 해제를 하는 모든 서버 경로가 같은 규약을 따른다
// ---------------------------------------------------------------------------

describe('장착 해제 경로 3종 — 뺀 자리는 null 로 남긴다', () => {
  const paths = [
    'apply_invasion_result', // 침공 확정: 소진(charges 0) 모듈 정리
    'apply_module_fusion', // 합성: 재료 3개 소모
    'salvage_core_module', // 분해: 1개 소멸
  ] as const;

  for (const name of paths) {
    it(`${name} 이 빈 슬롯을 밀집화하지 않는다`, () => {
      const block = defensesUnequipBlock(effectiveFunctionBody(name).body);
      expect(block).toContain('when x is null then null');
      // `where x <> ...` 필터 방식은 x 가 null 이면 결과가 null → 빈 슬롯까지 탈락시킨다.
      expect(block).not.toMatch(/where\s+x\s*<>/);
      // 순서 보존(ordinality) 없이 재작성하면 자리 자체가 무의미해진다.
      expect(block).toContain('with ordinality');
      expect(block).toContain('order by t.ord');
    });
  }
});

// ---------------------------------------------------------------------------
// 4. 클라 정규 경로가 실제로 고정 길이 + null 자리를 보내고 읽는다
// ---------------------------------------------------------------------------

const M1 = '11111111-1111-1111-1111-111111111111';
const M2 = '22222222-2222-2222-2222-222222222222';

/** setEquippedModules 로 넘어온 wire 값을 그대로 붙잡는 fake. */
function captureGateway(equip: ModuleEquipState = { defenseId: 'def-1', equipped: [] }): {
  gateway: ModulesGateway;
  sent: (string | null)[][];
} {
  const sent: (string | null)[][] = [];
  const gateway = {
    getUserId: async () => 'uid',
    buyShopModule: async () => ({ ok: false }),
    fuseModules: async () => ({ ok: false }),
    salvageModule: async () => ({ ok: false }),
    listInventory: async () => [],
    fetchEquip: async () => equip,
    setEquippedModules: async (_defenseId: string, moduleIds: readonly (string | null)[]) => {
      sent.push([...moduleIds]);
    },
    listShopPurchases: async () => [],
  } satisfies ModulesGateway;
  return { gateway, sent };
}

describe('클라 정규 경로 — equipModules / fetchModuleEquip', () => {
  it('슬롯2 에만 장착하면 wire 값도 [null, M] 이다(앞으로 당기지 않는다)', async () => {
    const { gateway, sent } = captureGateway();
    const ok = await equipModules('def-1', [null, M2], { gateway });
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([null, M2]);
    expect(sent[0]).toHaveLength(MODULE_EQUIP_SLOTS);
  });

  it('짧은 배열도 고정 길이로 채워 보낸다(슬롯 개수가 항상 일정)', async () => {
    const { gateway, sent } = captureGateway();
    await equipModules('def-1', [M1], { gateway });
    expect(sent[0]).toEqual([M1, null]);
  });

  it('빈 슬롯만 있어도 길이를 유지한다', async () => {
    const { gateway, sent } = captureGateway();
    await equipModules('def-1', [null, null], { gateway });
    expect(sent[0]).toEqual([null, null]);
  });

  it('서버가 보존한 [null, M] 을 그대로 슬롯2 로 읽는다', async () => {
    const { gateway } = captureGateway({ defenseId: 'def-1', equipped: [null, M2] });
    const state = await fetchModuleEquip({ gateway });
    expect(state?.equipped).toEqual([null, M2]);
  });

  it('서버가 밀집화하면 클라는 복구할 수 없다 — 그래서 서버가 보존해야 한다', async () => {
    // 사용자는 슬롯2 에 꽂았는데 서버가 [M2] 로 압축해 돌려준 상황.
    const { gateway } = captureGateway({ defenseId: 'def-1', equipped: [M2] });
    const state = await fetchModuleEquip({ gateway });
    // 클라에는 원래 자리를 알 방법이 없어 슬롯1 로 표시된다(= E-1 의 사용자 관측 증상).
    expect(state?.equipped).toEqual([M2, null]);
  });
});

// ---------------------------------------------------------------------------
// 5. normalizeEquippedModules 자체 규약
// ---------------------------------------------------------------------------

describe('normalizeEquippedModules — 고정 길이·자리 보존·중복 제거', () => {
  it('길이를 항상 MODULE_EQUIP_SLOTS 로 맞춘다', () => {
    expect(normalizeEquippedModules(null)).toHaveLength(MODULE_EQUIP_SLOTS);
    expect(normalizeEquippedModules([M1, M2, M1])).toHaveLength(MODULE_EQUIP_SLOTS);
  });

  it('빈 슬롯 자리를 옮기지 않는다', () => {
    expect(normalizeEquippedModules([null, M2])).toEqual([null, M2]);
  });

  it('같은 모듈이 두 슬롯에 오면 뒤 슬롯을 비운다(서버 트리거와 같은 규칙)', () => {
    expect(normalizeEquippedModules([M1, M1])).toEqual([M1, null]);
  });
});
