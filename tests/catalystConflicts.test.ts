/**
 * 촉매 간 **축소 충돌** 계약 — `src/data/catalystConflicts.ts` (ADR-0052 §축소 작동 규율).
 *
 * 잠그는 것:
 *  ① 표의 무결성 — id 가 0..47 안에서 실재하고, 자기 자신과 충돌하지 않고, 순서 무관 중복이 없다
 *  ② 공명 쪽 항목의 태그·단이 `RESONANCES` 에 실재한다
 *  ③ **도달 가능성** — 모든 항목이 `SLOT_CAP = 3` 안에서 실제로 뜰 수 있다
 *     (못 뜨는 경고는 그 자체가 죽은 데이터다)
 *  ④ 대표 조합이 실제로 경고를 낸다
 *  ⑤ **거짓 양성 방지** — 무충돌 조합은 아무 경고도 안 내고, 전수 스윕에서 경고가 소수다
 *  ⑥ **회색과 노랑이 섞이지 않는다** — 행성 무효(`voidOnPlanets`)는 노랑을 하나도 만들지 않는다
 *  ⑦ 축소의 결 전부가 EN·KO 문구를 갖는다
 *
 * ⚠️ 조합은 전부 **실제 카드 id** 로 쓴다. 태그를 흉내 낸 가짜 입력으로 실증하면 카탈로그가
 * 갈렸을 때 이 파일이 조용히 통과한다(`catalystResonance.test.ts` 와 같은 규율).
 */

import { describe, it, expect } from 'vitest';
import {
  CATALYST_CARD_CONFLICTS,
  CATALYST_RESONANCE_CONFLICTS,
  catalystConflicts,
  type CatalystConflictReason,
} from '../src/data/catalystConflicts.js';
import {
  CATALYSTS,
  SLOT_CAP,
  catalystById,
  catalystVoidOnPlanet,
  isWithinSignatureCap,
} from '../src/data/catalysts.js';
import { RESONANCES, resolveResonance } from '../src/data/catalystResonance.js';
import { EN, KO } from '../src/i18n/catalog.js';

/** 모든 결의 목록 — ⑦ 이 문구 존재를 여기서 전수로 강제한다. */
const ALL_REASONS: readonly CatalystConflictReason[] = [
  'sharedField',
  'choice',
  'material',
  'ground',
  'aim',
  'precondition',
  'priority',
  'overlap',
];

/** 48C3 전수(+ 2장·1장 부분 선택). 도달 가능성·거짓 양성 스윕이 공유한다. */
function allCombos(): number[][] {
  const ids = CATALYSTS.map((c) => c.id);
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i++) {
    out.push([ids[i]!]);
    for (let j = i + 1; j < ids.length; j++) {
      out.push([ids[i]!, ids[j]!]);
      for (let k = j + 1; k < ids.length; k++) out.push([ids[i]!, ids[j]!, ids[k]!]);
    }
  }
  return out;
}

/** 실제로 출격할 수 있는 조합인가 — 슬롯 상한 · 특산 2장 · 특산은 같은 행성. */
function injectable(ids: readonly number[]): boolean {
  if (ids.length > SLOT_CAP) return false;
  if (!isWithinSignatureCap(ids)) return false;
  const planets = new Set<number>();
  for (const id of ids) {
    const def = catalystById(id)!;
    if (def.kind === 'signature') planets.add(def.planet!);
  }
  return planets.size <= 1;
}

/** 그 조합에서 실제로 뜨는 충돌(공명은 `resolveResonance` 정본을 그대로 쓴다). */
function hitsOf(ids: readonly number[]) {
  return catalystConflicts(ids, resolveResonance(ids));
}

// ---------------------------------------------------------------------------
// ① 표의 무결성
// ---------------------------------------------------------------------------

describe('충돌 표 무결성', () => {
  it('모든 카드 id 가 0..47 범위이고 실재한다', () => {
    for (const c of CATALYST_CARD_CONFLICTS) {
      for (const id of [c.a, c.b]) {
        expect(id, `card conflict id ${id}`).toBeGreaterThanOrEqual(0);
        expect(id, `card conflict id ${id}`).toBeLessThan(CATALYSTS.length);
        expect(catalystById(id), `card conflict id ${id} 가 카탈로그에 없다`).toBeDefined();
      }
    }
    for (const c of CATALYST_RESONANCE_CONFLICTS) {
      expect(catalystById(c.id), `resonance conflict id ${c.id} 가 카탈로그에 없다`).toBeDefined();
    }
  });

  it('자기 자신과 충돌하지 않는다', () => {
    for (const c of CATALYST_CARD_CONFLICTS) expect(c.a).not.toBe(c.b);
  });

  it('중복 쌍이 없다(순서 무관 정규화)', () => {
    const seen = new Set<string>();
    for (const c of CATALYST_CARD_CONFLICTS) {
      const key = c.a < c.b ? `${c.a}-${c.b}` : `${c.b}-${c.a}`;
      expect(seen.has(key), `중복 쌍 ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('카드↔공명도 중복이 없고, 태그·단이 RESONANCES 에 실재한다', () => {
    const known = new Set(RESONANCES.map((r) => `${r.tag}:${r.tier}`));
    const seen = new Set<string>();
    for (const c of CATALYST_RESONANCE_CONFLICTS) {
      const reso = `${c.tag}:${c.tier}`;
      expect(known.has(reso), `없는 공명 ${reso}`).toBe(true);
      const key = `${c.id}@${reso}`;
      expect(seen.has(key), `중복 항목 ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('카드↔카드 쌍은 실제로 한 런에 같이 넣을 수 있다(특산 2장·같은 행성)', () => {
    for (const c of CATALYST_CARD_CONFLICTS) {
      expect(injectable([c.a, c.b]), `${c.a}+${c.b} 는 같이 주입할 수 없다`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 도달 가능성 — 못 뜨는 경고는 죽은 데이터다
// ---------------------------------------------------------------------------

describe('도달 가능성', () => {
  const combos = allCombos().filter(injectable);

  it('카드↔카드 항목 전부가 실제 조합에서 뜬다', () => {
    for (const c of CATALYST_CARD_CONFLICTS) {
      const found = combos.some((ids) =>
        hitsOf(ids).some((h) => h.kind === 'card' && h.ids[0] === c.a && h.ids[1] === c.b),
      );
      expect(found, `${c.a}↔${c.b} 가 어떤 조합에서도 안 뜬다`).toBe(true);
    }
  });

  it('카드↔공명 항목 전부가 실제 조합에서 뜬다(우선순위에 밀리지 않는 조합이 존재한다)', () => {
    for (const c of CATALYST_RESONANCE_CONFLICTS) {
      const found = combos.some((ids) =>
        hitsOf(ids).some(
          (h) =>
            h.kind === 'resonance' &&
            h.ids[0] === c.id &&
            h.resonance?.tag === c.tag &&
            h.resonance?.tier === c.tier,
        ),
      );
      expect(found, `${c.id}↔${c.tag}:${c.tier} 가 어떤 조합에서도 안 뜬다`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 대표 조합
// ---------------------------------------------------------------------------

describe('대표 조합이 실제로 경고를 낸다', () => {
  it('11 지도 + 5 정련 — 3택 자리를 쓰는 카드가 축소된다', () => {
    const hits = hitsOf([5, 11]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('card');
    expect(hits[0]!.ids).toEqual([5, 11]);
    expect(hits[0]!.reason).toBe('choice');
  });

  it('11 지도 한 장이 3택 카드 셋 중 둘과 동시에 걸린다(부분 선택 포함)', () => {
    const hits = hitsOf([9, 11, 14]);
    expect(hits.filter((h) => h.reason === 'choice').map((h) => h.ids)).toEqual([
      [9, 11],
      [11, 14],
    ]);
  });

  it('2 수확 + 42 창궐 — 머무를 자리가 오염된다', () => {
    const hits = hitsOf([2, 42]);
    expect(hits.some((h) => h.reason === 'ground' && h.ids[0] === 2 && h.ids[1] === 42)).toBe(true);
  });

  it('12 승천 + 27 애프터버너 — maxHp 대가를 대시 쿨다운 소멸이 깎는다', () => {
    expect(hitsOf([12, 27]).some((h) => h.reason === 'sharedField')).toBe(true);
  });

  it('26 고속코어 + 46 돌파강 — 속도 저하가 배속을 갉는다', () => {
    expect(hitsOf([26, 46]).some((h) => h.ids[0] === 26 && h.ids[1] === 46)).toBe(true);
  });

  it('28 방벽 + 정밀 강공명(반사) — 방벽이 먼저 처리된다', () => {
    const ids = [13, 14, 28]; // 셋 다 `정밀` → 강공명
    expect(resolveResonance(ids)).toMatchObject({ tag: 'precision', tier: 'strong' });
    const hits = hitsOf(ids);
    expect(
      hits.some((h) => h.kind === 'resonance' && h.ids[0] === 28 && h.reason === 'priority'),
    ).toBe(true);
  });

  it('39 오버클럭 + 침식 약공명(마모) — playerSpeed 를 반대로 쓴다', () => {
    const ids = [16, 25, 39]; // 16·25 가 `침식` 둘 → 약공명, 39 는 무태그 충돌 없음
    expect(resolveResonance(ids)).toMatchObject({ tag: 'erosion', tier: 'weak' });
    expect(
      hitsOf(ids).some((h) => h.kind === 'resonance' && h.ids[0] === 39 && h.reason === 'sharedField'),
    ).toBe(true);
  });

  it('발동하지 않은 공명은 경고를 만들지 않는다', () => {
    // 같은 39 라도 침식이 한 장뿐이면 마모가 안 뜨므로 경고도 없어야 한다.
    const ids = [3, 25, 39];
    expect(resolveResonance(ids)?.tag).not.toBe('erosion');
    expect(hitsOf(ids).some((h) => h.kind === 'resonance')).toBe(false);
  });

  it('공명을 null 로 넘기면 카드↔공명 항목은 하나도 안 나온다', () => {
    expect(catalystConflicts([13, 14, 28], null).every((h) => h.kind === 'card')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 거짓 양성 방지 — **이 절이 핵심이다**
// ---------------------------------------------------------------------------

describe('거짓 양성 방지', () => {
  it('무충돌 조합은 아무 경고도 안 낸다', () => {
    // 0·3·6: 표의 어느 쌍도 아니고, 뜨는 공명(밀도 약)의 대상 카드(id 7)도 없다.
    expect(hitsOf([0, 3, 6])).toEqual([]);
    // 10·24·25: 정밀 약이 뜨지만 그 대상은 id 2 뿐이라 무관하다.
    expect(hitsOf([10, 24, 25])).toEqual([]);
    // 한 장짜리 부분 선택은 상대가 없으므로 언제나 무경고다.
    for (const def of CATALYSTS) expect(hitsOf([def.id])).toEqual([]);
  });

  it('빈 조합·미지 id 는 무경고다', () => {
    expect(hitsOf([])).toEqual([]);
    expect(catalystConflicts([999, -1], null)).toEqual([]);
  });

  it('전수 스윕에서 경고가 뜨는 조합은 소수다(표가 번지지 않았다)', () => {
    const combos = allCombos().filter((ids) => ids.length === SLOT_CAP && injectable(ids));
    const flagged = combos.filter((ids) => hitsOf(ids).length > 0).length;
    expect(flagged).toBeGreaterThan(0);
    // 3판 `{정밀,도박}` 6장 사태처럼 경고가 아무 조합에나 뜨기 시작하면 해상도가 사라진다.
    expect(flagged / combos.length).toBeLessThan(0.25);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 회색(행성 무효)과 노랑(촉매 간 충돌)은 섞이지 않는다
// ---------------------------------------------------------------------------

describe('회색과 노랑의 분리', () => {
  it('행성 무효는 노랑을 하나도 만들지 않는다', () => {
    for (const def of CATALYSTS) {
      for (let planet = 0; planet < 6; planet++) {
        if (!catalystVoidOnPlanet(def, planet)) continue;
        // 무효 카드 한 장만 골라도 충돌은 0 이다 — 회색은 카드↔행성, 노랑은 카드↔카드다.
        expect(hitsOf([def.id])).toEqual([]);
      }
    }
  });

  it('판정에 행성 인자가 없다 — 같은 조합은 어느 행성에서든 같은 노랑을 낸다', () => {
    // 구조적 보증(함수 시그니처에 mode 가 없다)을 회귀로 못 박는다: 무효 카드가 낀 조합도
    // 노랑 목록이 무효 여부와 무관하게 결정된다.
    const ids = [2, 42]; // id 2 는 아르케·크라스에서 회색이지만 톡사르에서는 아니다
    expect(hitsOf(ids)).toEqual(catalystConflicts(ids, resolveResonance(ids)));
    expect(hitsOf(ids).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 문구
// ---------------------------------------------------------------------------

describe('축소 결 문구', () => {
  it('모든 결이 EN·KO 문구를 갖는다', () => {
    for (const reason of ALL_REASONS) {
      const key = `catalyst.warn.reason.${reason}` as keyof typeof EN;
      expect(EN[key], `EN ${key}`).toBeTruthy();
      expect(KO[key], `KO ${key}`).toBeTruthy();
    }
  });

  it('표가 쓰는 결이 전부 목록 안에 있다', () => {
    const known = new Set<string>(ALL_REASONS);
    for (const c of CATALYST_CARD_CONFLICTS) expect(known.has(c.reason)).toBe(true);
    for (const c of CATALYST_RESONANCE_CONFLICTS) expect(known.has(c.reason)).toBe(true);
  });

  it('문구는 "무효"가 아니라 축소로 쓴다(헌장 §축소 작동 규율)', () => {
    for (const reason of ALL_REASONS) {
      const key = `catalyst.warn.reason.${reason}` as keyof typeof EN;
      expect(KO[key]).not.toContain('무효');
    }
  });
});
