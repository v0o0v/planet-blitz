/**
 * 그래픽 설정 시스템 (Phase 0 — plan §AC-0.2; ADR-0031 "규율 있는 하이브리드 글로우").
 *
 * 품질 티어(자동/수동)와 접근성 감소 토글(모션·발광)의 **지속 저장·구독**을 담당한다.
 * 구조는 사운드 설정({@link file://../render/audio.ts})을 그대로 복제한다 — 순수 파싱/직렬화/
 * 클램프 함수 + localStorage guard(`readStored`/`writeStored`) + onChange/emit 구독 패턴.
 *
 * ── 결정론(ADR-0005) ── 그래픽 설정은 순수 render 레이어다. sim 은 품질·발광·흔들림을 전혀
 * 모르며(해시·리플레이 무관), 티어/게이트는 render 가 이 설정을 관찰해 파생한다(단방향).
 * 이 모듈은 `src/sim/` 에서 절대 import 되지 않는다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 기본 품질은 'auto'(FPS 자동 적응), 감소 토글은 모두
 * off 로 둔다. FPS 임계·티어 게이팅 수치는 {@link file://../render/qualityTier.ts} 에 있고 전부
 * 출시 직전 일괄 튜닝 대상(placeholder)이다.
 *
 * ── 테스트 안전 ── 설정 직렬화는 순수 함수({@link parse}/{@link serialize}/{@link clamp})로
 * 분리해 node 환경에서 검증한다. localStorage 접근은 전부 `typeof` 가드.
 */

/** 품질 선택값. 'auto'=FPS 자동 적응, 나머지=수동 오버라이드(자동을 잠금). */
export type Quality = 'auto' | 'low' | 'med' | 'high';

/** 지속 저장되는 그래픽 설정(품질 오버라이드 + 접근성 감소 토글 2종). */
export interface GraphicsSettings {
  /** 품질 티어 선택. 'auto' 면 런타임 FPS 로 자동 적응, 구체 티어면 수동 잠금. */
  quality: Quality;
  /** 모션 감소: 화면 흔들림·히트 플래시를 끈다(광과민·멀미 대응, 티어와 직교). */
  reducedMotion: boolean;
  /** 발광 감소: 헤일로·블룸을 끈다(광과민·저사양 대응, 티어와 직교). */
  reducedGlow: boolean;
}

/**
 * clamp/parse 가 받는 느슨한 입력(런타임 손상값 방어). 실제 {@link GraphicsSettings} 는
 * 각 필드가 이 unknown 슬롯의 서브타입이라 그대로 대입 가능하고, 손상된 저장본도 받아낸다.
 */
type LooseGraphics = { quality?: unknown; reducedMotion?: unknown; reducedGlow?: unknown };

/** localStorage 키. */
export const STORAGE_KEY = 'pb.graphics';

/** 유효한 품질 값 화이트리스트(clamp 판정용). */
const VALID_QUALITIES: readonly Quality[] = ['auto', 'low', 'med', 'high'];

/**
 * 기본 설정(품질 자동, 감소 토글 해제). **quality:'auto' 는 FPS 자동 적응이 기본**이라는
 * 구조적 선택이며(수치가 아님), 감소 토글 기본 off 도 접근성 옵트인 관례를 따른다.
 */
export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  quality: 'auto',
  reducedMotion: false,
  reducedGlow: false,
};

/** 품질 값을 유효 집합으로 강제(손상/미지값 → 'auto'). 순수. */
function coerceQuality(q: unknown): Quality {
  return typeof q === 'string' && (VALID_QUALITIES as readonly string[]).includes(q)
    ? (q as Quality)
    : DEFAULT_GRAPHICS_SETTINGS.quality;
}

/** 불리언 강제(타입 틀리면 해당 필드 기본값). 순수. */
function coerceBool(b: unknown, fallback: boolean): boolean {
  return typeof b === 'boolean' ? b : fallback;
}

/**
 * 손상값 방어 클램프(순수). 잘못된 quality → 'auto', 값들 bool 강제, 누락/타입오류 필드는
 * 각 기본값으로 대체한다. 유효한 {@link GraphicsSettings} 를 넘겨도 그대로 통과한다.
 */
export function clamp(s: LooseGraphics): GraphicsSettings {
  return {
    quality: coerceQuality(s.quality),
    reducedMotion: coerceBool(s.reducedMotion, DEFAULT_GRAPHICS_SETTINGS.reducedMotion),
    reducedGlow: coerceBool(s.reducedGlow, DEFAULT_GRAPHICS_SETTINGS.reducedGlow),
  };
}

/**
 * 저장값 → 설정(관대·방어, 순수). 문자열이면 JSON 파싱을 시도하고, 이미 객체면 그대로 받는다.
 * null/손상/비객체(숫자·불리언·null)면 기본값 사본. 유효 객체는 {@link clamp} 로 정규화.
 */
export function parse(raw: unknown): GraphicsSettings {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_GRAPHICS_SETTINGS };
    }
  }
  if (obj === null || typeof obj !== 'object') return { ...DEFAULT_GRAPHICS_SETTINGS };
  return clamp(obj as LooseGraphics);
}

/** 설정 → 저장 문자열(순수, 3필드). 직렬화 시 clamp 로 방어. */
export function serialize(s: GraphicsSettings): string {
  const c = clamp(s);
  return JSON.stringify({
    quality: c.quality,
    reducedMotion: c.reducedMotion,
    reducedGlow: c.reducedGlow,
  });
}

/** localStorage 에서 읽기(부재/예외를 audio.ts 와 동일하게 guard). */
export function readStored(): GraphicsSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_GRAPHICS_SETTINGS };
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

/** localStorage 에 쓰기(부재/예외를 audio.ts 와 동일하게 guard). */
export function writeStored(s: GraphicsSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, serialize(s));
  } catch {
    // 저장 실패는 무시(세션 내 설정은 유지) — audio.ts writeStored 와 동형.
  }
}

/**
 * 그래픽 설정 스토어(설정 패널 라이브 반영 + FPS 티어 구동부가 관찰). GameAudio 의
 * 설정 관리부(getSettings/onChange/emit + 저장 setter)를 그대로 복제한다. render 전용이라
 * sim 무관. 브라우저 밖(테스트)에서도 안전하게 생성된다(readStored 가 localStorage guard).
 */
export class GraphicsSettingsStore {
  private settings: GraphicsSettings;
  private readonly listeners = new Set<(s: GraphicsSettings) => void>();

  constructor() {
    this.settings = readStored();
  }

  /** 현재 설정 사본. */
  getSettings(): GraphicsSettings {
    return { ...this.settings };
  }

  /** 설정 변경 구독(설정 패널 라이브 반영). 해제 함수 반환. audio.ts onChange 동형. */
  onChange(fn: (s: GraphicsSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.getSettings();
    for (const fn of this.listeners) fn(snap);
  }

  /** 부분 갱신(설정 패널이 여러 필드를 한 번에 바꿀 때). clamp·저장·통지. */
  set(patch: Partial<GraphicsSettings>): void {
    this.settings = clamp({ ...this.settings, ...patch });
    writeStored(this.settings);
    this.emit();
  }

  /** 품질 오버라이드 설정('auto'|'low'|'med'|'high'). */
  setQuality(quality: Quality): void {
    this.set({ quality });
  }

  /** 모션 감소 토글(흔들림·플래시 억제). */
  setReducedMotion(reducedMotion: boolean): void {
    this.set({ reducedMotion });
  }

  /** 발광 감소 토글(헤일로·블룸 억제). */
  setReducedGlow(reducedGlow: boolean): void {
    this.set({ reducedGlow });
  }
}

/** 공유 그래픽 설정 스토어 싱글턴(설정 패널·FPS 티어 구동부가 함께 구독). */
export const graphicsSettings = new GraphicsSettingsStore();
