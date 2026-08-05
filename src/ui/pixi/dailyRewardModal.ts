/**
 * 일일 보상 통지 팝업 — Pixi (ADR-0048 §화면, AC-14 · AC-19 · AC-21).
 *
 * ## 이 화면은 "받기"가 아니라 통지다 (AC-19)
 *
 * **버튼이 닫기 하나뿐인 것이 설계다.** 팝업이 열린 시점에 서버는 이미 지급을 끝냈다 —
 * 수령은 행위가 아니라 시점이고(CONTEXT.md §일일 보상), 수령·**보상 예고** 확정·**연속 접속**
 * 증가가 한 지점에서 원자적으로 일어난다. 여기에 "받기"를 놓으면 *"오늘 아직 안 받은 상태"* 라는
 * 제3의 상태가 생기고, 그동안 연속일도 예고도 미확정이라 **화면이 무엇을 표시할지부터 갈린다.**
 * 그래서 이 모듈은 버튼 부품(`./button.js`)을 아예 들이지 않으며, `tests/dailyRewardModal.test.ts`
 * 가 그 사실을 소스 대조로 잠근다 — 레이아웃 단언만으로는 나중에 누가 "편의상" 버튼을 하나 더
 * `addChild` 하는 것을 못 막는다. 버튼 이름을 이 파일 어디에도 적지 않는 것이 그 대조의 전제다.
 *
 * ## 예고는 종류까지만, 굴림 값은 감춘다 (AC-21)
 *
 * {@link DailyRewardModalSubject} 는 굴림 결과 두 필드(`affixes`·`uses`)를 들고 있지만
 * **`today` 에서만 그려진다.** `tomorrow` 쪽 값은 레이아웃이 통째로 버린다 — 예고가 확정하는
 * 것은 *무엇이 오는가*(종류·등급·지시 계급)이고, 값까지 미리 보여주면 *"별로네"* 가 그날
 * 들어오지 않을 이유가 된다. 반대로 종류마저 감추면 "확정된 약속"이라는 예고의 정의가 무너진다.
 * 필드를 타입에서 지우지 않고 **버리는 자리를 만든 것**이 의도다: 호출부가 같은 자료형 하나로
 * 오늘 것과 내일 것을 넘길 수 있고, 감추는 규칙이 화면 한 곳에 모여 테스트로 잠긴다.
 *
 * ## 레이아웃은 순수 함수가 정한다
 *
 * {@link layoutDailyRewardModal} 이 좌표·줄바꿈·폭을 전부 계산하고, 렌더는 그 결과를 Pixi 노드로
 * 옮기기만 한다. vitest 는 node 환경이라 `Text` 를 세울 수 없어(캔버스 없음) **순수 함수로 뽑지
 * 않으면 겹침·넘침이 눈으로만 잡힌다** — 이 리포가 반복해서 밟은 자리다(`helpModal.helpTextWidth`
 * 가 같은 이유로 뽑혀 있다). 폭은 {@link estimateTextWidth} 로 **넘치는 쪽으로** 재므로, 추정이
 * 안쪽 폭에 들어오면 실제 글자는 반드시 들어온다(대리 지표를 상한이 아니라 **하한**으로만 쓴다).
 *
 * ## 지켜야 하는 규칙 (전부 실측 전례가 있다)
 * ① 콘텐츠는 {@link modalBodyTop} **아래**에서 시작한다. `box.y` 에 놓으면 제목과 정확히 겹친다.
 * ② 좌표는 전부 정수다. 반픽셀 부유가 테두리 번쩍임을 만든다.
 * ③ `Sprite` 에 자식을 붙이지 않는다(리포 규율) — 이 파일은 `Container` + `Text` + `Graphics` 만 쓴다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { makeModal } from './modal.js';
import { modalBodyTop } from './modal.js';
import { panelContent, type PanelContentBox } from './nineSlicePanel.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { stripEmoji } from './text.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DAILY_STREAK_CYCLE } from '../../../data/dailyReward.js';
import type { DailyRewardAxis, DailyRewardStep } from '../../../data/dailyRewardSelection.js';
import type { Rarity } from '../../items/types.js';
import type { CommissionGrade } from '../../run/commission.js';

// ---------------------------------------------------------------------------
// 입력 — 순수 데이터만
// ---------------------------------------------------------------------------

/**
 * 지급물 하나의 **표시용** 서술. Pixi 객체도 net 응답 타입도 받지 않는다 — 그래야 테스트가
 * 캔버스 없이 돌고, 하네스 모의가 실서버와 **같은 것**을 넘길 수 있다.
 *
 * 축마다 채우는 필드가 다르다. 비어 있는 필드는 그 줄에서 그냥 빠지므로, 호출부가 축별로
 * 분기해 문장을 만들 필요가 없다(문장 조립은 {@link subjectLine} 한 곳에 있다).
 */
export interface DailyRewardModalSubject {
  /** 어느 축인가. 라벨은 `daily.axis.<axis>` 에서 온다. */
  readonly axis: DailyRewardAxis;
  /**
   * 구체 이름 — **이미 번역된 문자열**. 촉매·설계도처럼 이름이 데이터에 있는 축만 채운다.
   * 여기에 굴림 값을 끼워 넣지 마라(예고에서 감추는 규칙이 이 필드를 우회한다).
   */
  readonly name?: string;
  /** 장수·개수. 2 이상일 때만 표시한다(1개는 소음이다). */
  readonly count?: number;
  /** 등급(장비·코어 모듈). 노말·매직·레어·유니크. */
  readonly rarity?: Rarity;
  /** 지시 계급(의뢰서 1..4). */
  readonly grade?: CommissionGrade;
  /** 크레딧(재화 축). */
  readonly credits?: number;
  /** 광물(재화 축). */
  readonly minerals?: number;
  /**
   * 굴린 어픽스 라벨들 — ⚠️ **수령분(`today`)에만 표시된다.** 예고(`tomorrow`)에 채워 넣어도
   * 레이아웃이 버린다(AC-21). 값을 여기 담아 예고로 새게 하려는 시도를 테스트가 잡는다.
   */
  readonly affixes?: readonly string[];
  /** 굴린 사용 횟수 — 위와 같은 규칙으로 수령분에만 표시된다. */
  readonly uses?: number;
}

/** 팝업이 그리는 것 전부. 순수 데이터다. */
export interface DailyRewardModalData {
  /** 이번 수령 뒤의 연속 접속 일차(1..{@link DAILY_STREAK_CYCLE}). 정의역 밖은 접힌다. */
  readonly streak: number;
  /** 오늘 지급된 주 보상. */
  readonly today: DailyRewardModalSubject;
  /** 곁들이 크레딧. 0 이거나 없으면 그 줄을 그리지 않는다. */
  readonly sideCredits?: number;
  /** 내일 예고. 서버가 아직 안 적었으면 생략한다(그 자리에 "아직 없다"가 그려진다). */
  readonly tomorrow?: DailyRewardModalSubject;
  /**
   * 반복 걸음 순번 (AC-14). **없으면 그 줄 자체를 그리지 않는다** — 단발 목표에 "1 중 1째"를
   * 띄우면 존재하지 않는 카운트다운을 표시하는 것이 된다.
   */
  readonly step?: DailyRewardStep;
}

// ---------------------------------------------------------------------------
// 폭 추정 — 캔버스 없이 넘침을 잰다
// ---------------------------------------------------------------------------

/** 한글·한자·가나·전각 기호는 폭이 글자 크기와 같다(정방 글리프). */
function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // 한글 자모
    (cp >= 0x2e80 && cp <= 0x303f) || // CJK 부수 · 기호
    (cp >= 0x3040 && cp <= 0x30ff) || // 가나
    (cp >= 0x3130 && cp <= 0x318f) || // 호환 자모
    (cp >= 0x4e00 && cp <= 0x9fff) || // 한자
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xff00 && cp <= 0xff60) // 전각
  );
}

/**
 * 라틴 글자 한 개의 폭 계수. Malgun Gothic 의 라틴 평균은 0.5em 안팎이고 최대(`W`·`M`)가
 * 0.78em 이다. **평균이 아니라 위쪽에 가까운 값**을 쓰는 이유는 이 추정이 *"들어온다"* 를
 * 증명하는 데만 쓰이기 때문이다 — 과소평가하면 통과했는데 실화면에서 넘친다.
 */
const LATIN_ADVANCE = 0.66;
/** 공백은 라틴보다 훨씬 좁다. 여기까지 0.66 으로 세면 긴 영문 문장이 근거 없이 넘친다고 나온다. */
const SPACE_ADVANCE = 0.32;

/**
 * 글자열의 렌더 폭 **상한** 추정(px). 순수.
 *
 * 정확한 값이 아니라 **넘지 않는다는 보증**이 목적이다. 그래서 실제 폭보다 크게 나오도록
 * 계수를 잡았고, 이 값이 안쪽 폭에 들어오면 실제 글자는 반드시 들어온다.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === ' ') units += SPACE_ADVANCE;
    else if (isWideChar(cp)) units += 1;
    else units += LATIN_ADVANCE;
  }
  return units * fontSize;
}

/**
 * 추정 폭으로 그리디 줄바꿈(순수). Pixi 의 `wordWrap` 을 **흉내 내되 더 이르게** 접는다 —
 * 추정이 실제보다 넓으므로 여기서 나온 줄 수는 실제 줄 수 이상이고, 그래서 이 줄 수로 잰
 * 높이는 실제 높이의 상한이 된다(팝업이 내용보다 짧아지는 사고가 구조적으로 안 난다).
 *
 * 공백이 없는 긴 덩어리(한글 붙임글·긴 URL)는 글자 단위로 끊는다. 렌더 쪽도 `breakWords` 를
 * 켜 두어 같은 규칙을 쓴다.
 */
export function wrapByEstimate(text: string, fontSize: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const out: string[] = [];
  let line = '';
  const flush = (): void => {
    if (line.length > 0) out.push(line);
    line = '';
  };
  const pushChar = (ch: string): void => {
    if (estimateTextWidth(line + ch, fontSize) > maxWidth && line.length > 0) flush();
    line += ch;
  };
  for (const word of text.split(' ')) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    flush();
    if (estimateTextWidth(word, fontSize) <= maxWidth) {
      line = word;
      continue;
    }
    for (const ch of word) pushChar(ch);
  }
  flush();
  return out.length === 0 ? [''] : out;
}

// ---------------------------------------------------------------------------
// 기하 상수
// ---------------------------------------------------------------------------

/**
 * 팝업 가로. 세로는 내용에서 역산한다({@link layoutDailyRewardModal}) — 걸음 순번·곁들이
 * 크레딧·예고가 있고 없고에 따라 줄 수가 달라지므로, 높이를 못 박으면 어느 조합에선 빈 자리가
 * 남고 어느 조합에선 마지막 줄이 잘린다.
 */
export const DAILY_MODAL_W = 860;

/** 글자 크기 — 계층이 읽히도록 넷으로만 나눈다(더 늘리면 위계가 아니라 잡음이 된다). */
const FS_STREAK = 26;
const FS_SECTION = 21;
const FS_SUBJECT = 23;
const FS_META = 16;

/** 줄 높이(글자 크기 대비). Pixi 기본 행간과 비슷하되 조금 넉넉하다. */
function lineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.34);
}

/** 연속 접속 게이지 두께. */
const BAR_H = 12;
/** 절과 절 사이. 줄 사이(작은 값)와 확실히 달라야 절 경계가 읽힌다. */
const SECTION_GAP = 26;
/** 같은 절 안 줄 사이. */
const ROW_GAP = 6;

// ---------------------------------------------------------------------------
// 레이아웃 — 순수
// ---------------------------------------------------------------------------

/** 그려질 글자 줄 하나. 좌표는 **패널 로컬**이며 전부 정수다. */
export interface DailyRewardTextRow {
  /** 줄 식별자(테스트가 존재/부재를 이 키로 본다). */
  readonly id: string;
  /** 원문(줄바꿈 전). */
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly weight: '400' | '800';
  readonly color: number;
  /** 이 줄이 쓸 수 있는 가로 한계. 렌더는 이 값을 `wordWrapWidth` 로 쓴다. */
  readonly maxWidth: number;
  /** 추정 줄바꿈 결과. 단행이면 길이 1. */
  readonly lines: readonly string[];
  /** 가장 긴 줄의 추정 폭(px). `<= maxWidth` 가 불변식이다. */
  readonly estWidth: number;
  /** 이 줄이 차지하는 세로(px). */
  readonly height: number;
}

/** 연속 접속 게이지 사각형(패널 로컬, 정수). */
export interface DailyRewardBar {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 채움 비율 0..1 = `streak / DAILY_STREAK_CYCLE`. 1 이면 최고점이다. */
  readonly fill: number;
}

/**
 * 상호작용 가능한 요소 목록 — **닫기 하나뿐이다**(AC-19).
 *
 * 상수로 못 박아 두는 이유는 "받기 버튼이 없다"를 테스트가 **부재**가 아니라 **전수**로 볼 수
 * 있게 하기 위해서다. 부재 단언(`not.toContain('claim')`)은 이름만 바꾸면 통과한다.
 */
export const DAILY_MODAL_INTERACTIVE: readonly string[] = ['close'];

export interface DailyRewardModalLayout {
  readonly width: number;
  readonly height: number;
  readonly box: PanelContentBox;
  /** 콘텐츠가 시작해도 되는 y(제목 밴드 아래). */
  readonly bodyTop: number;
  /** 콘텐츠가 쓸 수 있는 안쪽 가로. */
  readonly innerWidth: number;
  readonly rows: readonly DailyRewardTextRow[];
  readonly bar: DailyRewardBar;
  readonly interactive: readonly string[];
}

/** 천 단위 구분(순수 — 로케일 함수를 쓰지 않는다. 같은 입력에 같은 문자열이어야 한다). */
function groupInt(n: number): string {
  const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 동적 i18n 키. 카탈로그가 `Record<MessageKey, string>` 이라 조립 키는 캐스팅이 필요하다. */
function tk(key: string, params?: Readonly<Record<string, string | number>>): string {
  return t(key as MessageKey, params);
}

/**
 * 지급물 한 줄의 문장. 축마다 있는 것만 ` · ` 로 잇는다.
 *
 * @param reveal 굴림 값(어픽스·사용 횟수)을 드러낼지. **예고는 항상 false** 다 (AC-21).
 */
function subjectLine(s: DailyRewardModalSubject, reveal: boolean): string {
  const parts: string[] = [tk(`daily.axis.${s.axis}`)];
  if (s.name !== undefined && s.name.length > 0) parts.push(s.name);
  if (s.rarity !== undefined) parts.push(tk(`item.rarity.${s.rarity}`));
  if (s.grade !== undefined) parts.push(tk(`commission.grade.${Math.min(4, Math.max(1, s.grade))}`));
  if (s.credits !== undefined && s.credits > 0) {
    parts.push(t('daily.amount.credits', { n: groupInt(s.credits) }));
  }
  if (s.minerals !== undefined && s.minerals > 0) {
    parts.push(t('daily.amount.minerals', { n: groupInt(s.minerals) }));
  }
  if (s.count !== undefined && s.count > 1) parts.push(t('daily.count', { n: Math.floor(s.count) }));
  if (reveal && s.uses !== undefined && s.uses > 0) {
    parts.push(t('daily.uses', { n: Math.floor(s.uses) }));
  }
  if (reveal && s.affixes !== undefined && s.affixes.length > 0) parts.push(...s.affixes);
  return parts.join(' · ');
}

/**
 * 팝업 전체 배치를 계산한다. **순수**(현재 로케일에만 의존하며, 같은 로케일·같은 입력에 같은 결과).
 *
 * 높이는 마지막 줄에서 역산하고, 아래 여백을 위 여백(`box.y`)과 같게 둔다 — 그래야 어느
 * 조합에서도 위아래가 같은 두께로 남는다.
 */
export function layoutDailyRewardModal(data: DailyRewardModalData): DailyRewardModalLayout {
  // 콘텐츠 상자의 x·y·w 는 팝업 높이와 무관하다(사방 inset 이 같다). 그래서 높이를 정하기 전에
  // 먼저 상자를 얻어 줄을 쌓고, 마지막에 높이를 채워 넣는다.
  const probe = panelContent(DAILY_MODAL_W, 0);
  const innerWidth = probe.w;
  const rows: DailyRewardTextRow[] = [];
  let cy = modalBodyTop(probe);

  const push = (
    id: string,
    text: string,
    fontSize: number,
    weight: '400' | '800',
    color: number,
  ): void => {
    const clean = stripEmoji(text);
    const lines = wrapByEstimate(clean, fontSize, innerWidth);
    const estWidth = lines.reduce((m, l) => Math.max(m, estimateTextWidth(l, fontSize)), 0);
    const height = lineHeight(fontSize) * lines.length;
    rows.push({
      id,
      text: clean,
      x: Math.round(probe.x),
      y: Math.round(cy),
      fontSize,
      weight,
      color,
      maxWidth: innerWidth,
      lines,
      estWidth,
      height,
    });
    cy += height + ROW_GAP;
  };

  // ── 연속 접속 ── 몇 일차인지와 "30일차가 최고점"이 한 덩어리로 읽혀야 한다.
  const streak = Math.min(DAILY_STREAK_CYCLE, Math.max(1, Math.floor(data.streak) || 1));
  push('streak', t('daily.streak', { n: streak }), FS_STREAK, '800', COLOR.gold);
  const bar: DailyRewardBar = {
    x: Math.round(probe.x),
    y: Math.round(cy),
    w: Math.round(innerWidth),
    h: BAR_H,
    fill: streak / DAILY_STREAK_CYCLE,
  };
  cy += BAR_H + ROW_GAP;
  push('streakSub', t('daily.streak.sub', { max: DAILY_STREAK_CYCLE }), FS_META, '400', COLOR.muted);
  cy += SECTION_GAP;

  // ── 오늘 받은 것 ── 굴림 값을 드러낸다(이미 열어 본 물건이다).
  push('todayHead', t('daily.today'), FS_SECTION, '800', COLOR.gold);
  push('todaySubject', subjectLine(data.today, true), FS_SUBJECT, '800', COLOR.cream);
  push('todayNotice', t('daily.today.notice'), FS_META, '400', COLOR.muted);
  if (data.sideCredits !== undefined && data.sideCredits > 0) {
    push(
      'todaySide',
      t('daily.today.side', { n: groupInt(data.sideCredits) }),
      FS_META,
      '400',
      COLOR.muted,
    );
  }
  // 걸음 순번은 **있을 때만** 그린다 — 없는 카운트다운을 표시하지 않는다(AC-14).
  const step = data.step;
  if (step !== undefined) {
    const total = Math.max(1, Math.floor(step.total) || 1);
    const index = Math.min(total, Math.max(1, Math.floor(step.index) || 1));
    push('step', t('daily.step', { index, total }), FS_META, '400', COLOR.muted);
  }
  cy += SECTION_GAP;

  // ── 내일 예고 ── 굴림 값은 넘어와도 버린다(AC-21).
  push('tomorrowHead', t('daily.tomorrow'), FS_SECTION, '800', COLOR.gold);
  const tomorrow = data.tomorrow;
  if (tomorrow === undefined) {
    push('tomorrowSubject', t('daily.tomorrow.none'), FS_SUBJECT, '800', COLOR.cream);
  } else {
    push('tomorrowSubject', subjectLine(tomorrow, false), FS_SUBJECT, '800', COLOR.cream);
    push('tomorrowHidden', t('daily.tomorrow.hidden'), FS_META, '400', COLOR.muted);
  }
  cy += SECTION_GAP;

  // ── 도움말 두 줄 ── 규칙을 그대로 적는다. 은유는 쓰지 않는다(직역 함정 주석 참조).
  push('helpReset', t('daily.help.reset'), FS_META, '400', COLOR.muted);
  push('helpCeiling', t('daily.help.ceiling'), FS_META, '400', COLOR.muted);

  // 마지막 줄 뒤의 ROW_GAP 을 걷어내고 위 여백과 같은 두께를 아래에 둔다.
  const height = Math.round(cy - ROW_GAP + probe.y);
  return {
    width: DAILY_MODAL_W,
    height,
    box: panelContent(DAILY_MODAL_W, height),
    bodyTop: modalBodyTop(probe),
    innerWidth,
    rows,
    bar,
    interactive: DAILY_MODAL_INTERACTIVE,
  };
}

// ---------------------------------------------------------------------------
// 렌더 · 수명
// ---------------------------------------------------------------------------

/** 게이지 배경·채움 색(파낸 홈 위에 금빛 눈금 — 이 리포의 "채워지는 것" 어휘). */
const BAR_TRACK = 0x14100a;
const BAR_FILL = 0xffd678;

let host: Container | null = null;
let root: Container | null = null;
let ui: UiTextures = {};
let uiRequested = false;
let currentData: DailyRewardModalData | null = null;
let currentOnClose: (() => void) | null = null;

/**
 * 팝업을 붙일 곳을 등록한다. 화면 배선 시점(스테이지 생성 직후)에 **한 번** 부른다.
 *
 * 호스트를 `show` 인자로 매번 받지 않는 이유는 호출부가 *"그날 첫 진입인가"* 판정 옆에서
 * 데이터만 들고 부르는 자리이기 때문이다. 대신 미등록 상태의 호출은 **던진다** — 조용히
 * 아무것도 안 하면 그날의 지급 통지가 통째로 사라지고 아무도 모른다(이 리포가 가장 자주 밟는
 * 결함 모양이다).
 */
export function setDailyRewardModalHost(container: Container): void {
  host = container;
}

/** 팝업이 떠 있는가. 언어 전환 후 다시 세울지 판단하는 데 쓴다. */
export function isDailyRewardModalVisible(): boolean {
  return root !== null;
}

function label(row: DailyRewardTextRow): Text {
  return new Text({
    resolution: 2,
    text: row.text,
    style: {
      fontFamily: UI_FONT,
      fontSize: row.fontSize,
      fontWeight: row.weight,
      fill: row.color,
      wordWrap: true,
      // 추정 줄바꿈과 **같은 규칙**을 쓴다 — 공백 없는 덩어리도 끊는다.
      breakWords: true,
      wordWrapWidth: row.maxWidth,
      lineHeight: lineHeight(row.fontSize),
      dropShadow: TEXT_SHADOW,
    },
  });
}

function build(data: DailyRewardModalData): Container {
  const layout = layoutDailyRewardModal(data);
  const parts = makeModal({
    width: layout.width,
    height: layout.height,
    title: t('daily.title'),
    onClose: () => {
      const cb = currentOnClose;
      hideDailyRewardModal();
      if (cb !== null) cb();
    },
    panelTexture: ui['ui_panel.png'],
    closeTexture: ui['ui_icon_close.png'],
  });

  // 연속 접속 게이지 — 30일 주기의 어디쯤인지가 숫자보다 먼저 눈에 들어와야 한다.
  const bar = new Graphics();
  bar
    .roundRect(layout.bar.x, layout.bar.y, layout.bar.w, layout.bar.h, 6)
    .fill({ color: BAR_TRACK, alpha: 0.9 });
  const fillW = Math.round(layout.bar.w * Math.min(1, Math.max(0, layout.bar.fill)));
  if (fillW > 0) {
    bar
      .roundRect(layout.bar.x, layout.bar.y, fillW, layout.bar.h, 6)
      .fill({ color: BAR_FILL, alpha: 0.92 });
  }
  parts.panel.addChild(bar);

  for (const row of layout.rows) {
    const el = label(row);
    el.position.set(row.x, row.y);
    parts.panel.addChild(el);
  }
  return parts.root;
}

function rebuild(): void {
  if (host === null || currentData === null) return;
  if (root !== null) {
    root.parent?.removeChild(root);
    root.destroy({ children: true });
    root = null;
  }
  root = build(currentData);
  host.addChild(root);
  host.setChildIndex(root, host.children.length - 1);
}

/**
 * 팝업을 띄운다. `onClose` 는 닫기(X)·암막 탭 **양쪽** 모두에서 한 번 불린다 —
 * "이 날짜의 통지를 봤다"를 호출부가 기록하는 자리다(`shouldOpenDailyReward` 의 짝).
 *
 * ⚠️ {@link setDailyRewardModalHost} 를 먼저 부르지 않으면 던진다(위 주석의 이유).
 */
export function showDailyRewardModal(data: DailyRewardModalData, onClose?: () => void): void {
  if (host === null) {
    throw new Error(
      'showDailyRewardModal: 호스트 미등록 — setDailyRewardModalHost(stage) 를 배선 시점에 먼저 부른다',
    );
  }
  currentData = data;
  currentOnClose = onClose ?? null;
  // 나무 프레임·닫기 아이콘은 늦게 와도 된다(없으면 Graphics 폴백). 도착하면 다시 세운다.
  if (!uiRequested) {
    uiRequested = true;
    void loadUiTextures().then((tex) => {
      ui = tex;
      if (root !== null) rebuild();
    });
  }
  rebuild();
}

/** 팝업을 내린다. `onClose` 는 부르지 않는다 — 닫기 경로가 이미 부른 뒤 여기로 온다. */
export function hideDailyRewardModal(): void {
  if (root !== null) {
    root.parent?.removeChild(root);
    root.destroy({ children: true });
    root = null;
  }
  currentData = null;
  currentOnClose = null;
}
