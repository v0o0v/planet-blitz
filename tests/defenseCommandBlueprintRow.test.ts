/**
 * 방어 사령부 **설계도 행과 거부 문구** (2026-08-08 사용자 신고).
 *
 * ## 신고 둘
 * 1. [제작]이 실패하면 좌하단에 `insufficient-funds` 라는 **raw 영문 슬러그**가 그대로 떴다.
 *    `runUpgrade` 가 서버 `result.code` 를 i18n 을 안 태우고 `msgText` 에 직접 넣고 있었다.
 *    코드는 서버·SQL·하네스 모의가 공유하는 내부 식별자지 사용자 문구가 아니다.
 * 2. 설계도 행이 **이름·장수뿐**이라 얼마가 드는지도, 무엇이 나오는지도 화면에 없었다 —
 *    [제작]을 눌러 실패해야만 비용을 알 수 있었다.
 *
 * 여기서 잠그는 것은 순수 파생 셋이다: 코드→문구 매핑이 **전부 번역을 타는가**, 비용이
 * **정본에서 오는가**(표기용 산식 금지), 부족 판정이 실제 재화와 맞는가.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setLocale, getLocale } from '../src/i18n/index.js';
import {
  upgradeErrorMessage,
  blueprintCraftCost,
  blueprintDesc,
  costShortfall,
  costLine,
  DEFENSE_BOXES,
} from '../src/ui/pixi/defenseCommand.js';
import { craftMineralCost, CRAFT_BLUEPRINT_COST } from '../data/planets/blueprints.js';
import { INVASION_CATALOG, CATALOG_BOSS } from '../data/invasion/catalog.js';
import { EN, KO } from '../src/i18n/catalog.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new TextDecoder().decode(
  readFileSync(fileURLToPath(new URL('../src/ui/pixi/defenseCommand.ts', import.meta.url))),
);

/** 방어 사령부 경로에서 실제로 도달 가능한 서버 거부 코드 전량. */
const REACHABLE_CODES = [
  'insufficient-funds',
  'insufficient-minerals',
  'insufficient-credits',
  'insufficient-blueprints',
  'storage-full',
  'bad-catalog',
  'not-owned',
  'max-level',
  'max-ascension',
  'max-rarity',
  'no-affix-slots',
  'need-three',
  'rarity-mismatch',
  'dup-ids',
  'too-many',
  'bad-input',
  'no-auth',
  'no-profile',
] as const;

// 이 파일은 **문구**를 보므로 로케일을 고정한다. vitest 는 navigator·localStorage 가 없어
// 기본이 en 이라, 한글 문구를 재려면 명시적으로 ko 로 둬야 한다.
const ORIGINAL_LOCALE = getLocale();
beforeEach(() => setLocale('ko'));
afterAll(() => setLocale(ORIGINAL_LOCALE));

describe('⚠️ 서버 거부 코드가 화면에 raw 로 새지 않는다', () => {
  it('도달 가능한 코드 전량이 EN·KO 문구를 갖는다', () => {
    for (const code of REACHABLE_CODES) {
      const key = `def3.cmd.err.code.${code}`;
      expect(EN, `${key} 가 EN 에 없다`).toHaveProperty(key);
      expect(KO, `${key} 가 KO 에 없다`).toHaveProperty(key);
    }
  });

  it('문구에 코드 슬러그가 그대로 실려 있지 않다(번역을 실제로 했는가)', () => {
    // `'insufficient-funds': 'insufficient-funds'` 로 때우는 회귀를 막는다.
    for (const code of REACHABLE_CODES) {
      const key = `def3.cmd.err.code.${code}`;
      for (const [lang, table] of [
        ['EN', EN],
        ['KO', KO],
      ] as const) {
        const s = (table as Record<string, string>)[key] ?? '';
        expect(s.length, `${lang} ${key} 가 비었다`).toBeGreaterThan(0);
        expect(s, `${lang} ${key} 가 코드를 그대로 쓴다`).not.toContain(code);
      }
    }
  });

  it('코드가 문구로 바뀐다 — 신고 그대로의 insufficient-funds', () => {
    const msg = upgradeErrorMessage('insufficient-funds');
    expect(msg).not.toBe('insufficient-funds');
    expect(msg).toBe(KO['def3.cmd.err.code.insufficient-funds']);
  });

  it('부족분이 필요·보유까지 말한다(신고 시점 상태: 광물 5 보유 · 12 필요)', () => {
    const need = { credits: 0, minerals: 12, blueprints: 1 };
    const have = { credits: 9503, minerals: 5, blueprints: 1 };
    const msg = upgradeErrorMessage('insufficient-funds', need, have);
    expect(msg).toContain('12');
    expect(msg).toContain('5');
    // 모자라지 **않은** 축은 끌어들이지 않는다 — 크레딧은 9503 으로 충분하다.
    expect(msg).not.toContain('9503');
  });

  it('need/have 가 없으면 코드 문장만 낸다(클라가 값을 지어내지 않는다)', () => {
    expect(upgradeErrorMessage('max-level')).toBe(KO['def3.cmd.err.code.max-level']);
  });

  it('미지 코드도 삼키지 않고 코드를 괄호에 남긴다', () => {
    const msg = upgradeErrorMessage('some-new-code-from-the-future');
    expect(msg).toContain('some-new-code-from-the-future');
    expect(msg).not.toBe('some-new-code-from-the-future');
  });

  it('코드가 없으면(네트워크 실패 등) 일반 실패 문구다', () => {
    expect(upgradeErrorMessage(undefined)).toBe(KO['def3.cmd.err.failed']);
    expect(upgradeErrorMessage('')).toBe(KO['def3.cmd.err.failed']);
  });

  it('⚠️ 화면이 그 매핑을 **실제로** 탄다(배선 대조 — 결함은 여기 한 줄이었다)', () => {
    // `upgradeErrorMessage` 가 아무리 옳아도 `runUpgrade` 가 안 부르면 raw 코드가 다시 샌다.
    expect(SRC, 'runUpgrade 가 매핑을 안 탄다').toContain('upgradeErrorMessage(result?.code');
    // 되돌리는 형태를 직접 막는다: `result.code` 를 msgText 에 그대로 넣는 대입.
    expect(SRC, 'result.code 를 msgText 에 직접 넣는 대입이 살아 있다').not.toMatch(
      /msgText\s*=\s*result\??\.code/,
    );
  });

  it('en 로케일에서도 코드가 아니라 문장이 나온다(회귀는 언어 무관이다)', () => {
    setLocale('en');
    const msg = upgradeErrorMessage('insufficient-funds');
    expect(msg).toBe(EN['def3.cmd.err.code.insufficient-funds']);
    expect(msg).not.toContain('insufficient-funds');
  });
});

describe('설계도 행이 비용과 결과물을 말한다', () => {
  it('⚠️ 제작 비용이 데이터 정본에서 온다(표기용 산식 금지)', () => {
    for (const e of INVASION_CATALOG) {
      const cost = blueprintCraftCost(e.kind);
      expect(cost.minerals, `kind ${e.kind}`).toBe(craftMineralCost(e.kind));
      expect(cost.blueprints).toBe(CRAFT_BLUEPRINT_COST);
      expect(cost.credits).toBe(0);
    }
  });

  it('보스 설계도가 더 비싸다(그 차이가 표기에 실제로 드러난다)', () => {
    const boss = blueprintCraftCost(CATALOG_BOSS);
    const other = blueprintCraftCost(0);
    expect(boss.minerals).toBeGreaterThan(other.minerals);
    expect(costLine(boss)).not.toBe(costLine(other));
  });

  it('비용 한 줄이 번역을 탄다(raw `min`/`bp` 약어 금지)', () => {
    const s = costLine({ credits: 0, minerals: 12, blueprints: 1 });
    expect(s).toContain('12');
    expect(s).toContain('1');
    expect(s, 'raw 영문 약어가 남아 있다').not.toMatch(/\b(min|bp|cr)\b/);
  });

  it('카탈로그 전종이 빈 설명이 아니다(행 셋째 줄이 공백이 되면 안 된다)', () => {
    for (const e of INVASION_CATALOG) {
      const d = blueprintDesc(e.kind, e.catalogId);
      expect(d.length, `${e.i18nId} 설명이 비었다`).toBeGreaterThan(0);
      expect(d, `${e.i18nId} 가 키를 그대로 낸다`).not.toContain('def3.');
    }
  });

  it('미등록 카탈로그에서 조용히 죽지 않는다', () => {
    expect(blueprintDesc(99, 99)).toBe('');
  });

  it('부족 판정이 축별로 갈린다', () => {
    const need = { credits: 0, minerals: 12, blueprints: 1 };
    expect(costShortfall(need, { credits: 0, minerals: 5, blueprints: 1 })).toBe(true);
    expect(costShortfall(need, { credits: 0, minerals: 12, blueprints: 0 })).toBe(true);
    expect(costShortfall(need, { credits: 0, minerals: 12, blueprints: 1 })).toBe(false);
    // 요구가 0 인 축은 보유 0 이어도 부족이 아니다.
    expect(costShortfall(need, { credits: 0, minerals: 99, blueprints: 9 })).toBe(false);
  });

  it('⚠️ 설계도 행이 비용·설명을 **실제로** 그린다(순수 함수만 통과하는 것으로는 부족하다)', () => {
    // 위 단언들은 헬퍼가 옳은지만 본다 — 결함은 화면이 그 헬퍼를 **안 부른** 것이었다.
    expect(SRC, '설계도 행이 비용을 안 부른다').toContain('blueprintCraftCost(bp.kind)');
    expect(SRC, '설계도 행이 설명을 안 부른다').toContain('blueprintDesc(bp.kind, bp.catalogId)');
  });

  it('⚠️ 행 높이가 세 줄을 담는다(예전 76px 한 줄로 되돌리는 회귀 차단)', () => {
    // 이름(14~) · 비용(42~) · 설명 2줄(66~102) + 아래 여백.
    expect(DEFENSE_BOXES.bpRowH).toBeGreaterThanOrEqual(102);
    // 상한이 자연 높이보다 낮으면 내용이 판 밖으로 나간다(fillRowHeights 주석의 그 결함).
    expect(DEFENSE_BOXES.bpRowMaxH).toBeGreaterThanOrEqual(DEFENSE_BOXES.bpRowH);
  });
});
