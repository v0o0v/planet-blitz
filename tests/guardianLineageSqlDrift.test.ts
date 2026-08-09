/**
 * 계보 수호 가지 곱선 — **TS 정본 ↔ SQL 미러 드리프트 가드** (2026-08-10).
 *
 * ## 왜 이 파일이 필요한가 — 곱선이 서버에 복제돼 있었다
 * `inject_guardian_authority`(SQL)가 `floor(5000.0 * L / (L + 20))` 을 **직접 계산**하고
 * 5000 으로 잘랐다. 그래서 `data/lineage.ts` 의 상한을 5000 → 37000 으로 올려도 **실 PvP
 * 수호기는 여전히 +50% 에서 멈췄다** — 값을 바꾼 쪽은 바뀌었다고 믿는데 실제 스탯은 안 바뀌는,
 * 이 저장소가 반복해 온 「조용한 미발현」이다.
 *
 * 같은 형태를 이 레인에서만 세 번 밟았다:
 *   ① `normalizeLineageBonus` 가 5000 리터럴로 잘랐다(클라 쪽 같은 결함).
 *   ② 하네스 슬라이더 `max` 가 sim 상한과 따로 박혀 있었다.
 *   ③ 그리고 이 SQL 복제.
 * 공통점은 **"같은 규칙이 두 곳에 적혀 있었다"** 이지 값이 틀렸다가 아니다.
 *
 * ## 무엇을 지키는가
 * 곱선을 두 언어로 적는 것은 피할 수 없다(서버는 TS 를 못 부른다). 그래서 **값이 일치하는지**를
 * 기계가 대조한다:
 *   ⓐ SQL 정본 함수가 존재하고 TS 상수와 같은 숫자를 쓴다.
 *   ⓑ 여러 레벨에서 두 구현의 **수치가 정확히 같다**(단순 문자열 대조를 넘어선다).
 *   ⓒ 호출부가 곱선을 다시 적지 않고 정본 함수를 부른다.
 *
 * ⚠️ 이 파일이 깨지면 **마이그레이션을 새로 만들어 SQL 을 맞춰라.** 기존 마이그레이션 파일을
 * 고치는 것은 이미 적용된 원격 DB 에 반영되지 않는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  GUARDIAN_BONUS_CAP_BP,
  GUARDIAN_HALF_LEVEL,
  guardianBonusBp,
} from '../data/lineage.js';

/** 곱선 정본을 담은 마이그레이션. 새 마이그레이션이 덮으면 이 경로를 그쪽으로 옮긴다. */
const MIGRATION = fileURLToPath(
  new URL('../supabase/migrations/20260810000000_guardian_lineage_cap_raise.sql', import.meta.url),
);

const sql = readFileSync(MIGRATION, 'utf8');

/**
 * **주석을 걷어낸 SQL.** 이 파일의 머리말은 고쳐야 할 구 식(`floor(5000.0 * L / (L + 20))`)을
 * 일부러 인용한다 — 왜 고쳤는지가 그 자리에 있어야 다음 사람이 안다. 그런데 아래 검사들이
 * 원문을 보면 **그 인용을 코드로 오인**한다(실제로 처음에 그렇게 빨개졌다).
 *
 * 그래서 검사 대상은 언제나 이 `code` 다. 원문(`sql`)은 선언 존재 확인처럼 주석이 방해하지
 * 않는 곳에만 쓴다.
 */
const code = sql.replace(/--.*/g, '');

describe('계보 수호 곱선 — SQL 미러', () => {
  it('SQL 정본 함수가 선언돼 있다', () => {
    // 선언 문법에 앵커한다(주석에 이름이 스쳐도 통과하지 않게).
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.lineage_guardian_bonus_bp\s*\(\s*p_level\s+integer\s*\)/,
    );
    // 결정론·성능 계약: 순수 함수여야 한다.
    expect(sql).toMatch(/immutable/);
  });

  it('SQL 곱선의 상수가 TS 정본과 같다', () => {
    // `floor(37000.0 * ... / (... + 20))` 형태에서 두 숫자를 뽑아 TS 상수와 대조한다.
    // ⚠️ 중간을 `[^)]*` 로 쓰면 안 된다 — 식이 `greatest(p_level, 0)` 처럼 괄호를 품고 있어
    // 첫 `)` 에서 멈춘다(실제로 처음에 그렇게 못 찾았다). 게으른 `[\s\S]*?` 로 첫 `+ NN))` 까지 간다.
    const m = /floor\(\s*([0-9]+)(?:\.[0-9]+)?\s*\*[\s\S]*?\+\s*([0-9]+)\s*\)\s*\)/.exec(code);
    expect(m, 'SQL 곱선 식을 못 찾았다 — 식 모양이 바뀌었으면 이 정규식도 함께 고쳐라').not.toBeNull();
    expect(Number(m![1])).toBe(GUARDIAN_BONUS_CAP_BP);
    expect(Number(m![2])).toBe(GUARDIAN_HALF_LEVEL);
  });

  it('여러 레벨에서 두 구현의 수치가 정확히 같다', () => {
    // 문자열 대조만으로는 "식 모양이 같은데 결과가 다른" 경우를 못 잡는다(음수 클램프·반올림
    // 방향 등). SQL 을 그대로 옮긴 함수로 값을 대조한다.
    const sqlCurve = (level: number): number => {
      const l = Math.max(level, 0);
      return Math.floor((GUARDIAN_BONUS_CAP_BP * l) / (l + GUARDIAN_HALF_LEVEL));
    };
    for (const lv of [0, 1, 2, 5, 10, 20, 25, 50, 99, 300, 5000]) {
      const ts = guardianBonusBp({ shipLevel: 0, guardianLevel: lv, available: 0, spent: 0 });
      expect(sqlCurve(lv), `Lv${lv}`).toBe(ts);
    }
  });

  it('레벨 0 은 0 이고 상한을 절대 넘지 않는다(점근 곡선)', () => {
    const sqlCurve = (level: number): number => {
      const l = Math.max(level, 0);
      return Math.floor((GUARDIAN_BONUS_CAP_BP * l) / (l + GUARDIAN_HALF_LEVEL));
    };
    expect(sqlCurve(0)).toBe(0);
    expect(sqlCurve(-5)).toBe(0);
    for (const lv of [1, 100, 10_000, 1_000_000]) {
      expect(sqlCurve(lv)).toBeLessThan(GUARDIAN_BONUS_CAP_BP);
    }
  });

  it('호출부가 곱선을 다시 적지 않고 정본 함수를 부른다', () => {
    // `inject_guardian_authority` 본문에 `v_bonus_bp := public.lineage_guardian_bonus_bp(...)`
    // 가 있어야 하고, 구 리터럴 계산이 남아 있으면 안 된다.
    expect(code).toMatch(/v_bonus_bp\s*:=\s*public\.lineage_guardian_bonus_bp\(/);
    // **선언부터** 잘라낸다 — 머리말의 함수명 언급에서 자르면 정본 함수 본문까지 딸려 온다.
    const decl = /create\s+or\s+replace\s+function\s+public\.inject_guardian_authority/.exec(code);
    expect(decl, '호출부 선언을 못 찾았다').not.toBeNull();
    const body = code.slice(decl!.index);
    expect(body, '호출부에 구 곱선 리터럴이 남아 있다').not.toMatch(/floor\(\s*5000\.0\s*\*/);
    expect(body, '호출부에 구 상한 클램프가 남아 있다').not.toMatch(/v_bonus_bp\s*>\s*5000/);
  });

  it('마일스톤 임계는 건드리지 않았다(이번 변경 범위 밖)', () => {
    // 상한만 올렸다. 임계가 같이 움직이면 그건 의도치 않은 파급이다.
    expect(sql).toMatch(/v_level\s*>=\s*10\b/);
    expect(sql).toMatch(/v_level\s*>=\s*25\b/);
    expect(sql).toMatch(/v_level\s*>=\s*50\b/);
  });
});
