/**
 * 코어 모듈 효과를 **수치로** 말하는 계약 (사용자 지시 2026-08-03).
 *
 * ## 이 파일이 막는 것
 * ① **표기명만 있고 효과가 없는 상태로 되돌아가는 것.** 그때까지 화면은 `소화의 +12` 처럼
 *    표기명 + 롤 값만 보여 줬다 — 12 가 무엇을 얼마나 바꾸는지는 어디에도 없었다.
 * ② **조용한 키 누락.** `t` 는 키를 못 찾으면 **키 문자열 자체**를 돌려주므로 라벨 하나를
 *    빼먹어도 예외도 로그도 없이 화면에 `mod.stat.bossDamagePct` 가 찍힌다. 스탯·조건·트리거·
 *    유니크 목록은 전부 데이터 배열에서 **파생**해 전수 검사한다(축을 추가하면 문구를 채우기
 *    전까지 빨간불로 남는다).
 * ③ **치환 안 된 자리표시자.** `{n}` 이 그대로 남으면 수치를 보여 준다는 계약이 깨진다.
 * ④ **조건을 빠뜨리는 것.** 조건부 18% 와 무조건 18% 는 완전히 다른 값이라, 수치만 보여 주고
 *    "언제"를 빼면 여전히 거짓말이다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n/index.js';
import { EN, KO } from '../src/i18n/catalog.js';
import {
  MODULE_STAT_KEYS,
  MODULE_AFFIXES,
  MODULE_PREFIXES,
  MODULE_SUFFIXES,
  MODULE_BASE_EFFECT,
  CORE_MODULE_UNIQUES,
  rollModule,
  type ModuleInstance,
} from '../data/coreModules.js';
import {
  moduleStatText,
  moduleAffixWhen,
  moduleUniqueStatText,
  moduleEffectLines,
} from '../src/ui/modulesView.js';

const LOCALES = ['en', 'ko'] as const;
afterEach(() => setLocale('en'));

/** 키가 그대로 새어 나왔는가(= 카탈로그에 문구가 없다). */
function looksLikeKey(s: string): boolean {
  return /^mod\.[a-z]/i.test(s.trim());
}

/** 치환되지 않은 자리표시자가 남았는가. */
function hasPlaceholder(s: string): boolean {
  return /\{[a-zA-Z]+\}/.test(s);
}

describe('스탯 축은 전부 수치가 붙은 문구를 갖는다', () => {
  it('MODULE_STAT_KEYS 전수 — 키가 새지 않고 값이 문구에 실린다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const stat of MODULE_STAT_KEYS) {
        const text = moduleStatText(stat, 17);
        expect(looksLikeKey(text), `${locale} ${stat} 문구 없음`).toBe(false);
        expect(hasPlaceholder(text), `${locale} ${stat} 치환 안 됨`).toBe(false);
        // 값이 실제로 보여야 한다 — 이것이 이 레인의 요구 그 자체다.
        expect(text, `${locale} ${stat} 에 수치가 없다`).toContain('17');
      }
    }
  });

  it('부호는 문구가 갖는다 — 감소 축은 -, 증가 축은 +', () => {
    setLocale('ko');
    // 값은 항상 양수 롤이고 부호는 문구에 있다. 값에 부호를 넣으면 "감소량이 클수록 좋은" 축
    // (받는 피해 감소)에서 -가 나쁜 것처럼 읽힌다.
    expect(moduleStatText('incomingDmgReductionPct', 12)).toContain('-12');
    expect(moduleStatText('attackerSlowPct', 20)).toContain('-20');
    expect(moduleStatText('bossDamagePct', 40)).toContain('+40');
    expect(moduleStatText('facilityFireRatePct', 25)).toContain('+25');
  });
});

describe('"언제" 가 모든 모듈 어픽스에 붙는다', () => {
  it('접두 8종 · 접미 8종 전수 — 조건/트리거 문구가 있고 임계가 실린다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const def of MODULE_AFFIXES) {
        const when = moduleAffixWhen(def);
        expect(when, `${locale} ${def.id} 조건 문구 없음`).not.toBeNull();
        if (when === null) continue;
        expect(looksLikeKey(when), `${locale} ${def.id} 키가 샜다`).toBe(false);
        expect(hasPlaceholder(when), `${locale} ${def.id} 치환 안 됨`).toBe(false);
        // 임계가 있는 트리거는 그 수치를 말해야 한다(`설비 3기` · `코어 HP 30%`).
        if (def.threshold !== undefined) {
          expect(when, `${locale} ${def.id} 에 임계 ${def.threshold} 가 없다`).toContain(
            String(def.threshold),
          );
        }
      }
    }
  });

  it('접두는 조건, 접미는 트리거를 갖는다(정의 자체의 계약)', () => {
    for (const a of MODULE_PREFIXES) expect(a.condition, a.id).toBeDefined();
    for (const a of MODULE_SUFFIXES) expect(a.trigger, a.id).toBeDefined();
  });

  it('정의를 못 찾으면 null 이다(조용한 키 노출 대신 효과만 보여 준다)', () => {
    expect(moduleAffixWhen(undefined)).toBeNull();
  });
});

describe('유니크 고유 효과도 수치로 말한다', () => {
  it('유니크 4종 전수 — 렌더 결과에 키도 자리표시자도 남지 않고 수치가 보인다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const u of CORE_MODULE_UNIQUES) {
        const text = moduleUniqueStatText(u.id);
        expect(text, `${locale} ${u.id} 문구 없음`).not.toBeNull();
        if (text === null) continue;
        expect(looksLikeKey(text), `${locale} ${u.id} 키가 샜다`).toBe(false);
        expect(hasPlaceholder(text), `${locale} ${u.id} 치환 안 됨`).toBe(false);
        expect(/\d/.test(text), `${locale} ${u.id} 에 수치가 없다`).toBe(true);
      }
    }
  });

  it('수치를 **손으로 적지 않는다** — 카탈로그 원문에 자리표시자가 있어야 한다', () => {
    /*
     * 렌더 결과만 보면 손으로 적은 수치와 파라미터에서 온 수치가 **구분되지 않는다**
     * (`uq-blackout` 을 "첫 30초"로 적었을 때 정본 `radarDisableTicks: 1800` 을 60 으로 나눈
     * 값과 출력이 정확히 같았다). 튜닝으로 파라미터가 움직이는 순간부터 화면이 조용히
     * 거짓말하므로, 판정은 **카탈로그 원문**에서 해야 한다.
     */
    for (const [label, table] of [
      ['EN', EN as unknown as Record<string, string>],
      ['KO', KO as unknown as Record<string, string>],
    ] as const) {
      for (const u of CORE_MODULE_UNIQUES) {
        const raw = table[`mod.uq.${u.id}`] ?? '';
        expect(raw.length, `${label} mod.uq.${u.id} 문구 없음`).toBeGreaterThan(0);
        expect(/\{[a-zA-Z]+\}/.test(raw), `${label} ${u.id}: 수치를 손으로 적었다`).toBe(true);
      }
      // 스탯 축도 같은 규율 — `{n}` 없이 수치를 박으면 롤 값이 화면에 안 실린다.
      for (const stat of MODULE_STAT_KEYS) {
        const raw = table[`mod.stat.${stat}`] ?? '';
        expect(raw.includes('{n}'), `${label} mod.stat.${stat}: {n} 이 없다`).toBe(true);
      }
      // 임계가 있는 트리거도 마찬가지다.
      for (const a of MODULE_SUFFIXES) {
        if (a.threshold === undefined || a.trigger === undefined) continue;
        const raw = table[`mod.when.${a.trigger}`] ?? '';
        expect(raw.includes('{n}'), `${label} mod.when.${a.trigger}: {n} 이 없다`).toBe(true);
      }
    }
  });

  it('유니크가 아니거나 미지 id 면 null', () => {
    expect(moduleUniqueStatText(undefined)).toBeNull();
    expect(moduleUniqueStatText('uq-does-not-exist')).toBeNull();
  });
});

describe('moduleEffectLines — 모듈 하나가 하는 일 전량', () => {
  /** 등급만 주고 실제 생성기로 뽑는다(화면이 받는 것과 같은 인스턴스). */
  function rolled(seed: number, rarity: ModuleInstance['rarity']): ModuleInstance {
    return rollModule(seed, rarity);
  }

  it('어픽스가 없는 normal 도 기저 효과를 **수치로** 말한다', () => {
    setLocale('ko');
    const m = rolled(1234, 'normal');
    const lines = moduleEffectLines(m);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const base = MODULE_BASE_EFFECT.normal;
    // 옛 화면은 여기서 "기저 효과만" 한 마디로 끝났다 — 있는 효과를 없다고 말하고 있었다.
    expect(lines[0]).toContain(String(base.allDamagePct));
    expect(lines[0]).toContain(String(base.coreHpPct));
  });

  it('첫 줄은 언제나 **무조건 걸리는** 기저다(최소 보장이 첫 줄에서 끝난다)', () => {
    setLocale('ko');
    for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
      const m = rolled(99 + rarity.length, rarity);
      const first = moduleEffectLines(m)[0] ?? '';
      expect(first, rarity).toContain(String(MODULE_BASE_EFFECT[rarity].allDamagePct));
    }
  });

  it('줄 수 = 기저 1 + 유니크 여부 + 접두 + 접미', () => {
    setLocale('ko');
    for (const seed of [7, 88, 4242, 999_331]) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const m = rolled(seed, rarity);
        const expected =
          1 + (m.uniqueId !== undefined ? 1 : 0) + m.prefixes.length + m.suffixes.length;
        expect(moduleEffectLines(m).length, `${rarity}/${seed}`).toBe(expected);
      }
    }
  });

  it('어떤 롤에서도 키가 새거나 자리표시자가 남지 않는다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (let seed = 1; seed <= 60; seed++) {
        for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
          for (const line of moduleEffectLines(rolled(seed * 7919, rarity))) {
            expect(looksLikeKey(line), `${locale} ${rarity}/${seed}: ${line}`).toBe(false);
            expect(hasPlaceholder(line), `${locale} ${rarity}/${seed}: ${line}`).toBe(false);
            // 모든 줄이 수치를 담는다 — 그것이 이 레인의 요구다.
            expect(/\d/.test(line), `${locale} ${rarity}/${seed}: 수치 없음 — ${line}`).toBe(true);
          }
        }
      }
    }
  });

  it('조건부 어픽스 줄은 **언제**와 **효과**를 둘 다 담는다', () => {
    setLocale('ko');
    // 조건부 18% 와 무조건 18% 는 완전히 다른 값이다 — 수치만 보여 주고 조건을 빼면 거짓말이다.
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 8; seed++) {
      const m = rolled(seed * 31, 'rare');
      const lines = moduleEffectLines(m);
      for (const roll of [...m.prefixes, ...m.suffixes]) {
        const def = MODULE_AFFIXES.find((a) => a.id === roll.id);
        if (def === undefined) continue;
        const when = moduleAffixWhen(def);
        if (when === null) continue;
        const hit = lines.find((l) => l.includes(when));
        expect(hit, `${roll.id} 의 조건이 어느 줄에도 없다`).toBeDefined();
        expect(hit ?? '', roll.id).toContain(String(roll.value));
        checked++;
      }
    }
    expect(checked, '검사 표본이 안 잡혔다').toBeGreaterThan(0);
  });
});

describe('화면 배선 대조 — 화면이 정말 이 조립을 쓰는가', () => {
  it('Pixi 화면이 어픽스 한 줄 대신 효과 블록을 그린다', async () => {
    // 순수 함수만 검증하면 "함수는 맞는데 화면은 옛 코드를 그대로 쓴다"가 통째로 지나간다 —
    // 이 프로젝트에서 여덟 번 재발한 유형이다.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../src/ui/pixi/modulesView.ts', import.meta.url))),
    );
    expect(src).toContain('moduleEffectLines');
    // 옛 한 줄 표기로 되돌아가면 여기서 걸린다(관제탑은 계속 그것을 쓴다 — 이 화면만 본다).
    expect(src).not.toContain('moduleAffixOneLine');
  });
});
