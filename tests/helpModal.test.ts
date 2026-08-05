/**
 * 화면 도움말 팝업 — **여섯 화면 공통 계약** (사용자 요청 2026-08-05).
 *
 * ## 왜 화면별이 아니라 여기 한 곳인가
 * 도움말은 화면마다 절 목록(`HelpSpec`)만 다르고 기구는 `helpModal.ts` 하나가 쥔다. 계약도
 * 같은 모양이어야 한다 — 화면별 테스트에 흩어 두면 새 화면이 하나 늘 때 검사가 조용히 빠진다.
 * 아래 `SPECS` 에 화면을 추가하는 것이 곧 그 화면을 전 검사에 등록하는 것이다.
 *
 * ## 여기서 잡는 것 (전부 실제로 밟은 함정이다)
 * ① **키 누락** — EN/KO 한쪽이 빠지면 화면에 번역이 아니라 **키 이름**이 그대로 그려진다.
 * ② **문자열 안 빈 줄** — Pixi 라벨은 전부 `stripEmoji` 를 거치는데 그 함수가 `\s{2,}` 를 공백
 *    하나로 접는다. 빈 줄로 나눈 문단은 화면에 도달하지 못하고 **조용히 한 덩어리가 된다**.
 *    (m7b 통합 테스트가 같은 불변식을 걸어 두었지만 그쪽은 `def3.*` 만 본다 — 나머지 다섯
 *    화면의 접두사는 그 그물에 안 걸린다.)
 * ③ **이모지** — 사용자 지시이자, Pixi 에서 두부 글리프로 떨어진다.
 * ④ **손잡이 자리** — 줄바꿈 폭을 스크롤 창 폭과 같게 주면 긴 줄이 막대 아래로 파고든다
 *    (사용자 신고 2026-08-05 "스크롤바가 너무 붙어있어"). 겹침 예외도 경고도 없다.
 * ⑤ **마크다운 잔재** — `**강조**` 는 캔버스에서 별표 그대로 그려진다.
 */

import { describe, it, expect } from 'vitest';
import { EN, KO } from '../src/i18n/catalog.js';
import {
  HELP_MODAL,
  helpTextWidth,
  helpWindowWidth,
  helpHeadKey,
  helpBodyKey,
  helpTitleKey,
  HELP_HEAD_W,
  type HelpSpec,
} from '../src/ui/pixi/helpModal.js';
import { SCROLL_THUMB_W, SCROLL_THUMB_PAD } from '../src/ui/pixi/scrollArea.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { DEFENSE_HELP } from '../src/ui/pixi/defenseCommand.js';
import { LAB_HELP } from '../src/ui/pixi/researchLab.js';
import { REFINERY_HELP } from '../src/ui/pixi/refinery.js';
import { TOWER_HELP } from '../src/ui/pixi/controlTower.js';
import { ARCHIVE_HELP } from '../src/ui/pixi/recordsArchive.js';
import { DESK_HELP } from '../src/ui/pixi/commissionDesk.js';
import { HANGAR_HELP } from '../src/ui/pixi/hangar.js';
import { STAR_HELP } from '../src/ui/pixi/planetSelect.js';
import { MODULES_HELP } from '../src/ui/pixi/modulesView.js';
import { CATALYST_HELP } from '../src/ui/pixi/catalystArchive.js';
import { CHAMPION_HELP } from '../src/ui/pixi/championSelect.js';
import { ROSTER_HELP } from '../src/ui/pixi/guardianRoster.js';
import { LINEAGE_HELP } from '../src/ui/pixi/lineageHall.js';

/**
 * 도움말을 가진 화면 전부. **새 화면에 도움말을 붙이면 여기에 한 줄 추가한다** — 그것이
 * 아래 검사 전부에 등록하는 유일한 절차다.
 */
const SPECS: readonly { readonly screen: string; readonly spec: HelpSpec }[] = [
  { screen: '방어 사령부', spec: DEFENSE_HELP },
  { screen: '연구소', spec: LAB_HELP },
  { screen: '정제소', spec: REFINERY_HELP },
  { screen: '관제탑', spec: TOWER_HELP },
  { screen: '기록 보관소', spec: ARCHIVE_HELP },
  { screen: '지시 수신소', spec: DESK_HELP },
  { screen: '격납고', spec: HANGAR_HELP },
  { screen: '성계 지도', spec: STAR_HELP },
  { screen: '코어 모듈', spec: MODULES_HELP },
  { screen: '촉매 보관함', spec: CATALYST_HELP },
  { screen: '기체 선택', spec: CHAMPION_HELP },
  { screen: '예비역 로스터', spec: ROSTER_HELP },
  { screen: '계보 전당', spec: LINEAGE_HELP },
];

const en = EN as Record<string, string>;
const ko = KO as Record<string, string>;

describe('도움말 — 여섯 화면이 같은 계약을 지킨다', () => {
  it('화면마다 절이 최소 넷은 있다(한두 줄짜리는 도움말이 아니다)', () => {
    for (const { screen, spec } of SPECS) {
      expect(spec.sections.length, `${screen} 의 절이 너무 적다`).toBeGreaterThanOrEqual(4);
      // 절 id 가 중복되면 같은 글이 두 번 그려지고도 아무도 모른다.
      expect(new Set(spec.sections).size, `${screen} 에 중복 절 id`).toBe(spec.sections.length);
    }
  });

  it('접두사가 화면마다 다르다(겹치면 남의 글이 섞여 나온다)', () => {
    const prefixes = SPECS.map((s) => s.spec.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  for (const { screen, spec } of SPECS) {
    describe(screen, () => {
      const keys = [
        helpTitleKey(spec),
        ...spec.sections.flatMap((id) => [helpHeadKey(spec, id), helpBodyKey(spec, id)]),
      ];

      it('제목·절 문구가 EN·KO 양쪽에 다 있다', () => {
        for (const key of keys) {
          expect(en[key], `EN 미등재: ${key}`).toBeTruthy();
          expect(ko[key], `KO 미등재: ${key}`).toBeTruthy();
        }
        // 헤더 버튼 라벨도 짝이 있어야 한다(`<prefix>` 에서 `.help` 까지가 버튼 키다).
        const btnKey = spec.prefix;
        expect(en[btnKey], `EN 미등재(버튼): ${btnKey}`).toBeTruthy();
        expect(ko[btnKey], `KO 미등재(버튼): ${btnKey}`).toBeTruthy();
      });

      it('미해석 키가 문구로 새지 않는다', () => {
        for (const key of keys) {
          expect(en[key]).not.toContain(spec.prefix);
          expect(ko[key]).not.toContain(spec.prefix);
        }
      });

      it('문단 구분이 홑 개행이다 — 빈 줄은 stripEmoji 가 접어 화면에 도달하지 못한다', () => {
        for (const key of keys) {
          for (const [loc, cat] of [
            ['EN', en],
            ['KO', ko],
          ] as const) {
            const text = cat[key] ?? '';
            expect(text, `${loc} ${key} 에 빈 줄`).not.toContain('\n\n');
            // 연속 공백 일반형까지 막는다 — stripEmoji 가 접는 대상이 `\s{2,}` 전체다.
            expect(text.match(/\s{2,}/), `${loc} ${key} 에 연속 공백`).toBeNull();
          }
        }
      });

      it('이모지와 마크다운 잔재가 없다', () => {
        for (const key of keys) {
          for (const [loc, cat] of [
            ['EN', en],
            ['KO', ko],
          ] as const) {
            const text = cat[key] ?? '';
            expect(/\p{Extended_Pictographic}/u.test(text), `${loc} ${key} 에 이모지`).toBe(false);
            // `**강조**` 는 캔버스에서 별표가 그대로 그려진다.
            expect(text, `${loc} ${key} 에 마크다운 강조`).not.toMatch(/\*\*/);
          }
        }
      });

      it('본문이 제목보다 충분히 길다 — 절이 빈 껍데기로 남지 않는다', () => {
        for (const id of spec.sections) {
          const head = ko[helpHeadKey(spec, id)] ?? '';
          const body = ko[helpBodyKey(spec, id)] ?? '';
          expect(body.length, `${screen} ${id} 본문이 부실함`).toBeGreaterThan(head.length * 3);
        }
      });
    });
  }
});

describe('도움말 팝업 기하', () => {
  it('화면 안에 들어오고 스크롤 창 + 닫기 버튼으로 세로가 정확히 나뉜다', () => {
    expect(HELP_MODAL.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(HELP_MODAL.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
    // 등호라 한쪽만 바꾸면 깨진다(빈 세로가 생기거나 버튼이 상자를 뚫는다).
    expect(HELP_MODAL.blockH).toBe(HELP_MODAL.bodyH + 16 + HELP_MODAL.btnH);
    expect(HELP_MODAL.h).toBe(HELP_MODAL.boxY + HELP_MODAL.blockH + HELP_MODAL.edgePad);
  });

  it('본문 오른쪽에 스크롤 손잡이 자리가 남는다', () => {
    const boxW = HELP_MODAL.w - HELP_MODAL.edgePad * 2;
    const gutter = helpWindowWidth(boxW) - helpTextWidth(boxW);
    // 손잡이 폭에 딱 맞추면 글이 막대에 닿는다 — 여유까지 있어야 "붙었다"로 안 읽힌다.
    expect(gutter).toBeGreaterThanOrEqual(SCROLL_THUMB_W + SCROLL_THUMB_PAD * 2 + 8);
    // 그렇다고 글이 쓸데없이 좁아지면 안 된다(빈 자리 금지).
    expect(helpTextWidth(boxW)).toBeGreaterThan(helpWindowWidth(boxW) * 0.9);
  });

  it('헤더 버튼 공통 폭이 각인 제목 대역을 침범하지 않는다', () => {
    // 오른쪽 컨트롤 줄은 재화 칩 2장(190) + 닫기(56) + 여백으로 1424 에서 시작한다.
    // 도움말은 그 왼쪽에 앉으므로 좌측 끝이 제목 대역 우단(960+280=1240)보다 커야 한다.
    const rightRowStart = 1424;
    const helpLeft = rightRowStart - 12 - 2 - HELP_HEAD_W;
    expect(helpLeft).toBeGreaterThan(DESIGN_WIDTH / 2 + 280);
  });
});
