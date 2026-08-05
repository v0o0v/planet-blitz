/**
 * 일일 보상 통지 팝업 계약 (ADR-0048 · AC-14 · AC-19 · AC-21).
 *
 * ## 왜 수치로 잠그는가
 *
 * vitest 는 node 환경이라 Pixi `Text` 를 세울 수 없다(캔버스 없음). 그래서 화면 파일에 좌표를
 * 직접 박아 두면 **겹침·넘침을 눈으로만 잡게 된다** — 이 리포가 반복해서 밟은 자리다(제목 위에
 * 태그라인이 덮친 파일럿 파일 팝업, 스크롤 막대 밑으로 파고든 도움말 본문). 그래서
 * `dailyRewardModal.ts` 는 배치를 순수 함수(`layoutDailyRewardModal`)로 뽑아 두었고, 이 파일이
 * 그 결과에 부등식을 건다.
 *
 * 폭은 {@link estimateTextWidth} 로 **넘치는 쪽으로** 잰다. 대리 지표라 정확한 값이 아니지만
 * 방향이 한쪽이라 **하한 보증**으로는 안전하다 — 추정이 안쪽 폭에 들어오면 실제 글자는 반드시
 * 들어온다. 한글이 영문보다 길어질 수도, 그 반대일 수도 있어 **두 카탈로그 양쪽으로** 잰다.
 *
 * ## 여기서 잡는 것
 * ① 제목 밴드와 콘텐츠가 겹치지 않는다 · 좌표가 정수다 · 글이 패널을 넘지 않는다.
 * ② **"받기" 버튼이 없다**(AC-19). 상호작용 전수 + 소스 대조 두 겹이다 — 부재 단언만 두면
 *    이름만 바꿔 붙인 버튼이 통과한다.
 * ③ **예고가 굴림 값을 흘리지 않는다**(AC-21). 어픽스·사용 횟수를 채운 예고를 넣고 그 문자열이
 *    어느 줄에도 안 나오는지 본다.
 * ④ 걸음 순번은 있을 때만 그려진다(AC-14).
 * ⑤ `daily.*` 문구가 EN·KO 짝으로 다 있고, **용어 정본의 기피어를 쓰지 않는다**.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EN, KO } from '../src/i18n/catalog.js';
import { setLocale, type Locale } from '../src/i18n/index.js';
import { DESIGN_HEIGHT } from '../src/render/app.js';
import { MODAL_TITLE_BAND } from '../src/ui/pixi/modal.js';
import { DAILY_STREAK_CYCLE } from '../data/dailyReward.js';
import {
  DAILY_MODAL_W,
  DAILY_MODAL_INTERACTIVE,
  estimateTextWidth,
  layoutDailyRewardModal,
  wrapByEstimate,
  type DailyRewardModalData,
} from '../src/ui/pixi/dailyRewardModal.js';

afterEach(() => {
  setLocale('en'); // 다른 테스트에 로케일 누수 방지(i18n.test.ts 선례).
});

const LOCALES: readonly Locale[] = ['en', 'ko'];

/** 어픽스·사용 횟수를 **예고에도** 채운 데이터. AC-21 이 실제로 무는지 보려면 흘릴 것이 있어야 한다. */
const AFFIX_TODAY = '치명타 확률 +12%';
const AFFIX_TOMORROW = '내일치어픽스누출표식';

const FULL: DailyRewardModalData = {
  streak: 12,
  today: {
    axis: 'gear',
    rarity: 'rare',
    affixes: [AFFIX_TODAY],
    uses: 3,
  },
  sideCredits: 500,
  tomorrow: {
    axis: 'coreModule',
    rarity: 'unique',
    // ⚠️ 일부러 채운다 — 화면이 이것을 버리는지가 이 파일의 요점이다.
    affixes: [AFFIX_TOMORROW],
    uses: 7,
  },
  step: { index: 2, total: 3 },
};

/** 걸음 순번도 예고도 없는 최소 데이터(폴백 재화 지급 모양). */
const MINIMAL: DailyRewardModalData = {
  streak: 1,
  today: { axis: 'currency', credits: 2000 },
};

// ---------------------------------------------------------------------------
// 레이아웃
// ---------------------------------------------------------------------------

describe('일일 보상 팝업 배치', () => {
  it('콘텐츠가 제목 밴드 아래에서 시작한다 — 제목과 겹칠 수 없다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const data of [FULL, MINIMAL]) {
        const l = layoutDailyRewardModal(data);
        // 밴드 정의 자체를 다시 확인한다(호출자가 box.y 에 놓는 옛 관례로 돌아가면 여기서 걸린다).
        expect(l.bodyTop).toBe(l.box.y + MODAL_TITLE_BAND);
        expect(l.rows.length).toBeGreaterThan(0);
        for (const row of l.rows) {
          expect(row.y, `${locale} ${row.id} 가 제목 밴드를 침범`).toBeGreaterThanOrEqual(l.bodyTop);
        }
        // 게이지도 마찬가지다(그래픽이라 "글자 겹침" 검사에 안 걸린다).
        expect(l.bar.y).toBeGreaterThanOrEqual(l.bodyTop);
      }
    }
  });

  it('줄이 서로 겹치지 않고 선언 순서대로 내려간다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      const l = layoutDailyRewardModal(FULL);
      for (let i = 1; i < l.rows.length; i++) {
        const prev = l.rows[i - 1]!;
        const cur = l.rows[i]!;
        expect(cur.y, `${locale} ${prev.id} → ${cur.id} 겹침`).toBeGreaterThanOrEqual(
          prev.y + prev.height,
        );
      }
    }
  });

  it('좌표가 전부 정수다 — 반픽셀 부유가 테두리를 번쩍이게 한다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const data of [FULL, MINIMAL]) {
        const l = layoutDailyRewardModal(data);
        for (const v of [l.width, l.height, l.bodyTop, l.innerWidth]) {
          expect(Number.isInteger(v)).toBe(true);
        }
        for (const v of [l.bar.x, l.bar.y, l.bar.w, l.bar.h]) {
          expect(Number.isInteger(v)).toBe(true);
        }
        for (const row of l.rows) {
          expect(Number.isInteger(row.x), `${row.id} x`).toBe(true);
          expect(Number.isInteger(row.y), `${row.id} y`).toBe(true);
        }
      }
    }
  });

  it('글이 패널 안쪽 폭을 넘지 않는다 — KO·EN 양쪽', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const data of [FULL, MINIMAL]) {
        const l = layoutDailyRewardModal(data);
        expect(l.innerWidth).toBeGreaterThan(0);
        for (const row of l.rows) {
          expect(row.estWidth, `${locale} ${row.id} 넘침`).toBeLessThanOrEqual(l.innerWidth);
          expect(row.x + row.maxWidth, `${locale} ${row.id} 우단`).toBeLessThanOrEqual(l.box.right);
          for (const line of row.lines) {
            expect(estimateTextWidth(line, row.fontSize)).toBeLessThanOrEqual(l.innerWidth);
          }
        }
      }
    }
  });

  it('팝업 높이가 마지막 줄을 덮고 화면 세로 안에 들어온다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const data of [FULL, MINIMAL]) {
        const l = layoutDailyRewardModal(data);
        const last = l.rows[l.rows.length - 1]!;
        // 아래 여백이 위 여백(box.y)과 같아야 위아래가 같은 두께로 남는다.
        expect(l.height).toBe(last.y + last.height + l.box.y);
        expect(l.height).toBeLessThanOrEqual(DESIGN_HEIGHT);
        expect(l.width).toBe(DAILY_MODAL_W);
      }
    }
  });

  it('연속 접속 게이지가 30일 주기를 비율로 나타낸다 — 30일차가 가득이다', () => {
    setLocale('ko');
    expect(layoutDailyRewardModal({ ...MINIMAL, streak: 1 }).bar.fill).toBeCloseTo(
      1 / DAILY_STREAK_CYCLE,
    );
    expect(layoutDailyRewardModal({ ...MINIMAL, streak: DAILY_STREAK_CYCLE }).bar.fill).toBe(1);
    // 손상 입력(0·음수·주기 초과)이 게이지를 비우거나 넘치게 하지 않는다.
    for (const bad of [0, -5, 999, Number.NaN]) {
      const fill = layoutDailyRewardModal({ ...MINIMAL, streak: bad }).bar.fill;
      expect(fill).toBeGreaterThan(0);
      expect(fill).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-14 · 반복 걸음 순번
// ---------------------------------------------------------------------------

describe('반복 걸음 순번 (AC-14)', () => {
  it('step 이 없으면 그 줄 자체가 없다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      const ids = layoutDailyRewardModal(MINIMAL).rows.map((r) => r.id);
      expect(ids).not.toContain('step');
    }
  });

  it('step 이 있으면 index <= total 로 접혀 표시된다', () => {
    setLocale('ko');
    const row = layoutDailyRewardModal(FULL).rows.find((r) => r.id === 'step');
    expect(row).toBeDefined();
    expect(row!.text).toContain('2');
    expect(row!.text).toContain('3');

    // 손상 입력이 "5 중 7째"를 띄우지 않는다 — 화면이 산식 고장으로 읽히는 자리다.
    const broken = layoutDailyRewardModal({ ...FULL, step: { index: 7, total: 5 } });
    const brokenRow = broken.rows.find((r) => r.id === 'step')!;
    expect(brokenRow.text).toContain('5');
    expect(brokenRow.text).not.toContain('7');
  });
});

// ---------------------------------------------------------------------------
// AC-19 · "받기" 버튼이 없다
// ---------------------------------------------------------------------------

describe('통지이지 수령 요청이 아니다 (AC-19)', () => {
  const source = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/ui/pixi/dailyRewardModal.ts', import.meta.url))),
  );

  it('상호작용 가능한 요소가 닫기 하나뿐이다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const data of [FULL, MINIMAL]) {
        // 부재가 아니라 **전수**로 본다 — 이름만 바꾼 버튼이 부재 단언을 빠져나간다.
        expect(layoutDailyRewardModal(data).interactive).toEqual(['close']);
      }
    }
    expect(DAILY_MODAL_INTERACTIVE).toEqual(['close']);
  });

  it('화면 소스가 버튼 부품을 아예 들이지 않는다(배선 대조)', () => {
    // `PixiButton` 이 없으면 "편의상 받기 버튼" 을 붙일 수 없다. 단언을 소스에 거는 이유는
    // 레이아웃 전수만으로는 렌더가 몰래 버튼을 하나 더 addChild 하는 것을 못 보기 때문이다.
    expect(source).not.toMatch(/PixiButton/);
    expect(source).not.toMatch(/from '\.\/button\.js'/);
    // makeModal 의 닫기 아이콘 외에 아이콘 버튼을 직접 세우지 않는다.
    expect(source).not.toMatch(/makeIconButton\(/);
  });

  it('카탈로그에 수령을 요청하는 문구가 없다', () => {
    const dailyKeys = Object.keys(EN).filter((k) => k.startsWith('daily.'));
    expect(dailyKeys.length).toBeGreaterThan(0);
    for (const key of dailyKeys) {
      expect(key, `${key} 가 수령 행위 키처럼 보인다`).not.toMatch(/claim|receive|collect/);
    }
    const ko = KO as unknown as Record<string, string>;
    for (const key of dailyKeys) {
      // "받으세요"·"수령하기" 같은 명령형은 누를 것이 있다는 뜻이 된다.
      expect(ko[key] ?? '', `KO ${key}`).not.toMatch(/받으세요|수령하기|받기/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-21 · 예고는 굴림 값을 감춘다
// ---------------------------------------------------------------------------

describe('보상 예고가 굴림 값을 흘리지 않는다 (AC-21)', () => {
  it('예고에 채운 어픽스·사용 횟수가 어느 줄에도 나오지 않는다', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      const l = layoutDailyRewardModal(FULL);
      const all = l.rows.map((r) => r.text).join(' ');
      expect(all, `${locale} 예고 어픽스 누출`).not.toContain(AFFIX_TOMORROW);
      // 사용 횟수 7 도 예고에서 나오면 안 된다(오늘 것 3 은 나와도 된다).
      const tomorrowRows = l.rows.filter((r) => r.id.startsWith('tomorrow'));
      for (const row of tomorrowRows) {
        expect(row.text, `${locale} ${row.id}`).not.toContain('7');
        expect(row.text, `${locale} ${row.id}`).not.toContain(AFFIX_TOMORROW);
      }
    }
  });

  it('예고는 종류·등급까지는 그대로 적는다 — 감추기만 하면 약속이 아니게 된다', () => {
    setLocale('ko');
    const row = layoutDailyRewardModal(FULL).rows.find((r) => r.id === 'tomorrowSubject')!;
    expect(row.text).toContain(KO['daily.axis.coreModule']);
    expect(row.text).toContain(KO['item.rarity.unique']);
  });

  it('오늘 받은 것에는 굴린 값이 그대로 보인다(이미 열어 본 물건이다)', () => {
    setLocale('ko');
    const row = layoutDailyRewardModal(FULL).rows.find((r) => r.id === 'todaySubject')!;
    expect(row.text).toContain(AFFIX_TODAY.slice(0, 3));
  });

  it('예고가 없으면 "아직 없다"가 그 자리를 채운다(빈 절을 남기지 않는다)', () => {
    setLocale('ko');
    const l = layoutDailyRewardModal(MINIMAL);
    const ids = l.rows.map((r) => r.id);
    expect(ids).toContain('tomorrowSubject');
    expect(ids).not.toContain('tomorrowHidden');
    expect(l.rows.find((r) => r.id === 'tomorrowSubject')!.text).toBe(KO['daily.tomorrow.none']);
  });
});

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

describe('daily.* 문구', () => {
  const en = EN as unknown as Record<string, string>;
  const ko = KO as unknown as Record<string, string>;
  const KEYS = Object.keys(EN).filter((k) => k.startsWith('daily.'));

  it('EN·KO 짝이 전부 있고 비어 있지 않다', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(20);
    const koKeys = Object.keys(KO).filter((k) => k.startsWith('daily.'));
    expect(koKeys.sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect((en[key] ?? '').length, `EN empty ${key}`).toBeGreaterThan(0);
      expect((ko[key] ?? '').length, `KO empty ${key}`).toBeGreaterThan(0);
    }
  });

  it('여섯 지급 축과 화면 구성 요소의 키가 전부 있다', () => {
    for (const axis of ['currency', 'catalyst', 'blueprint', 'coreModule', 'gear', 'commission']) {
      expect(en, `EN daily.axis.${axis}`).toHaveProperty(`daily.axis.${axis}`);
      expect(ko, `KO daily.axis.${axis}`).toHaveProperty(`daily.axis.${axis}`);
    }
    for (const key of [
      'daily.title',
      'daily.streak',
      'daily.today',
      'daily.tomorrow',
      'daily.step',
      'daily.help.reset',
      'daily.help.ceiling',
    ]) {
      expect(en, `EN ${key}`).toHaveProperty(key);
      expect(ko, `KO ${key}`).toHaveProperty(key);
    }
  });

  it('이모지·마크다운 잔재·빈 줄이 없다(Pixi 두부 · stripEmoji 접힘 방지)', () => {
    for (const key of KEYS) {
      for (const [label, table] of [
        ['EN', en],
        ['KO', ko],
      ] as const) {
        const v = table[key] ?? '';
        expect(v, `${label} ${key} 이모지`).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(v, `${label} ${key} 마크다운`).not.toMatch(/\*\*/);
        // `stripEmoji` 가 `\s{2,}` 를 공백 하나로 접으므로 문자열 안 줄바꿈은 화면에 도달 못 한다.
        expect(v.match(/\s{2,}/), `${label} ${key} 연속 공백`).toBeNull();
        expect(v, `${label} ${key} 빈 줄`).not.toContain('\n');
      }
    }
  });

  /**
   * 용어 정본(CONTEXT.md §일일 보상 · §연속 접속)의 **기피어**. 근태 문법(`출석`)은 이 세계에
   * 학교도 직장도 없고 지급 주체가 죽은 자동 시스템이라 기각됐고, `누적 접속일`은 리셋이 없다는
   * 오해를 만든다. 문구를 손볼 때 조용히 되돌아오는 자리라 테스트로 못 박는다.
   */
  it('KO 문구가 기피어를 쓰지 않는다', () => {
    const banned = ['출석', '로그인 보너스', '데일리', '누적 접속일', 'streak', '희귀 광물'];
    for (const key of KEYS) {
      const v = ko[key] ?? '';
      for (const w of banned) {
        expect(v.includes(w), `KO ${key} 에 기피어 "${w}": ${v}`).toBe(false);
      }
    }
  });

  /**
   * ⚠️ **옛 상한 문구는 거짓이다.** 상한 앵커가 `pve_runs` 의 클리어 단계에서
   * `profiles.lifetime_granted`(서버가 실제로 지급한 총량)로 바뀌었다 — 단계는 클라가 정산
   * 요약에 채우는 주장이고 서버는 PvE 를 재실행하지 않으므로 앵커가 될 수 없다. 그 표현이
   * 화면에 남으면 UI 가 플레이어에게 거짓을 말한다.
   */
  it('상한 안내가 "클리어 단계" 가 아니라 서버 지급 총량을 가리킨다', () => {
    expect(ko['daily.help.ceiling']).toContain('서버');
    expect(ko['daily.help.ceiling']).not.toMatch(/클리어 단계|침략 단계|최고 단계/);
    expect(en['daily.help.ceiling']?.toLowerCase()).toContain('granted');
    expect(en['daily.help.ceiling']).not.toMatch(/stage|cleared/i);
  });

  it('연속 리셋 안내가 1일차라고 정확히 말한다(0 도 절반도 아니다)', () => {
    expect(ko['daily.help.reset']).toContain('1일차');
    expect(en['daily.help.reset']).toMatch(/day 1/i);
  });
});

// ---------------------------------------------------------------------------
// 폭 추정기 자체
// ---------------------------------------------------------------------------

describe('폭 추정기', () => {
  it('한글은 글자 크기와 같은 폭, 라틴은 그보다 좁다', () => {
    expect(estimateTextWidth('가나다', 20)).toBe(60);
    expect(estimateTextWidth('abc', 20)).toBeLessThan(estimateTextWidth('가나다', 20));
    expect(estimateTextWidth('', 20)).toBe(0);
  });

  it('줄바꿈 결과의 어느 줄도 한계를 넘지 않는다', () => {
    const long = '연속 접속 일수가 길어질수록 지급 규모가 매일 조금씩 오르는 직선이 됩니다';
    for (const w of [120, 240, 480]) {
      const lines = wrapByEstimate(long, 16, w);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(estimateTextWidth(line, 16)).toBeLessThanOrEqual(w);
      // 글자를 잃지 않는다(공백만 재배치된다).
      expect(lines.join(' ').replace(/\s+/g, '')).toBe(long.replace(/\s+/g, ''));
    }
  });

  it('공백 없는 긴 덩어리도 글자 단위로 끊는다', () => {
    const blob = '가'.repeat(60);
    const lines = wrapByEstimate(blob, 16, 160);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(estimateTextWidth(line, 16)).toBeLessThanOrEqual(160);
  });
});
