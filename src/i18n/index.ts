/**
 * 로컬라이즈 코어 (M5 Phase C3 — plan §4, AC8).
 *
 * 게임 내 사용자 노출 문자열을 언어 카탈로그(en/ko)에서 키로 조회한다. 영어 우선
 * (CrazyGames 글로벌 배포) + 한국어 병행. 브라우저 언어 자동 감지 + 수동 토글, 선택은
 * localStorage 에 저장한다.
 *
 * ── 결정론(ADR-0005) ── i18n 은 순수 render/UI 레이어다. sim 은 문자열을 전혀 모르며
 * (해시·리플레이 무관), 이 모듈은 `src/sim/` 에서 절대 import 되지 않는다. `t()` 는 순수
 * 조회 함수라 같은 (locale, key, params) 에 항상 같은 문자열을 돌려준다.
 *
 * ── 테스트 안전 ── vitest 환경은 node(브라우저 전역 없음)라 localStorage/navigator 접근을
 * 전부 `typeof` 가드한다. `pickInitialLocale` 은 순수 함수로 분리해 브라우저 없이 검증한다.
 */

import { CATALOG, type MessageKey } from './catalog.js';

/** 지원 로케일(영어 우선). */
export type Locale = 'en' | 'ko';

/** 선택 가능한 로케일 목록(설정 토글 순서). */
export const LOCALES: readonly Locale[] = ['en', 'ko'];

/** localStorage 키(수동 선택 저장). */
const STORAGE_KEY = 'pb.locale';

/** `t()` 파라미터 치환 값(문자열/숫자). */
export type TParams = Readonly<Record<string, string | number>>;

/** 임의 문자열이 유효한 로케일 코드인지(순수). */
export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'ko';
}

/**
 * 초기 로케일 결정(순수 — 테스트 대상). 저장된 수동 선택이 최우선, 없으면 브라우저 언어의
 * 접두사(`ko-KR` → ko)를 보고, 그 외에는 영어 기본(글로벌 우선).
 */
export function pickInitialLocale(stored: string | null, navLang: string | undefined): Locale {
  if (isLocale(stored)) return stored;
  if (typeof navLang === 'string' && navLang.toLowerCase().startsWith('ko')) return 'ko';
  return 'en';
}

/** 브라우저 저장값을 안전하게 읽는다(node/미지원 환경이면 null). */
function readStored(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 브라우저 언어 문자열(없으면 undefined). */
function navigatorLang(): string | undefined {
  try {
    if (typeof navigator === 'undefined') return undefined;
    return navigator.language;
  } catch {
    return undefined;
  }
}

let current: Locale = pickInitialLocale(readStored(), navigatorLang());

/** 로케일 변경 구독자(설정 토글 시 현재 화면 다시 그리기용). */
const listeners = new Set<(locale: Locale) => void>();

/** 현재 로케일. */
export function getLocale(): Locale {
  return current;
}

/**
 * 로케일을 바꾸고 localStorage 에 저장한 뒤 구독자에게 통지한다. 같은 값이면 no-op.
 * 저장 실패(프라이빗 모드 등)는 조용히 무시 — 세션 내 전환은 그대로 유효.
 */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 저장 실패는 무시(세션 내 전환은 유지).
  }
  for (const fn of listeners) fn(locale);
}

/** 로케일 변경 구독(해제 함수 반환). */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `{name}` 형태 플레이스홀더를 params 값으로 치환한다(순수). */
function interpolate(template: string, params?: TParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/**
 * 키 → 현재 로케일 문자열. 현재 로케일에 없으면 영어 폴백, 영어에도 없으면 키 자체를
 * 돌려준다(개발 중 누락 키가 눈에 띄게). params 로 `{name}` 치환.
 */
export function t(key: MessageKey, params?: TParams): string {
  const table = CATALOG[current];
  const en = CATALOG.en;
  const raw = table[key] ?? en[key] ?? key;
  return interpolate(raw, params);
}

export type { MessageKey };
