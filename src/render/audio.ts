/**
 * 절차 합성 사운드 시스템 (M5 Phase C1 — plan §4, AC8; CrazyGames QA "볼륨 조절").
 *
 * 외부 오디오 에셋을 전혀 다운로드하지 않는다 — WebAudio 의 oscillator/noise 로 모든 SFX 를
 * 런타임에 절차 합성한다(격추 사출, 피격, 발사, 픽업, 처치, 보스 등장, 레벨업, 승/패, UI).
 * 번들 크기 0, 라이선스 이슈 0.
 *
 * ── 결정론(ADR-0005) ── 사운드는 순수 render 레이어다. sim 은 소리를 전혀 모르며(해시·
 * 리플레이 무관), 트리거는 render 가 sim 스냅샷/요약을 **관찰**해 파생한다(sim → render 단방향,
 * {@link RunSoundObserver}). 이 모듈은 `src/sim/` 에서 절대 import 되지 않는다. 합성에 쓰는
 * `Math.random`(노이즈 버퍼)은 render 전용이라 결정론에 무관하다.
 *
 * ── 3버스 믹싱/음소거 ── `master`(→destination) 아래 `bgm`/`sfx`/`ui` 3개 GainNode 를 두고
 * 각 사운드를 해당 버스로 라우팅한다. 버스별 0..1 볼륨은 각 버스 게인이, 전역 음소거는 master
 * 게인(muted?0:1)이 담당한다. 설정은 localStorage 에 저장한다(CrazyGames 포털 QA 요구). BGM 은
 * 이 보드가 합성하지 않고 musicDirector 가 {@link GameAudio.getBus}('bgm') 게인에 직접 연결한다.
 * AudioContext 는 브라우저 자동재생 정책에 맞춰 **첫 사용자 제스처 이후 지연 생성/resume** 한다.
 *
 * ── 테스트 안전 ── 설정 직렬화는 순수 함수({@link parseAudioSettings}/{@link clampVolume})로
 * 분리해 node 환경에서 검증한다. AudioContext 접근은 전부 `typeof` 가드.
 */

/** 사운드 이름(합성 테이블 키). */
export type SoundName =
  | 'shot'
  | 'hit'
  | 'kill'
  | 'pickup'
  | 'boss'
  | 'levelUp'
  | 'victory'
  | 'defeat'
  | 'eject'
  | 'ui'
  // ── P2(sfx-expansion) 추가 ──
  // 드랍 등급음(AC13·AC14): 노말/매직 공용·레어 강조·유니크 팡파레. SFX 버스.
  | 'dropCommon'
  | 'dropRare'
  | 'dropUnique'
  // 메타 UI 의미범주(AC16): 이동·확정·긍정·부정·축하. UI 버스.
  | 'uiNavigate'
  | 'uiConfirm'
  | 'uiPositive'
  | 'uiNegative'
  | 'uiCelebrate'
  // 적 특수탄/보스탄 경고(AC19). SFX 버스.
  | 'warn'
  /**
   * 렙업 카드 **등장**음(사용자 요청 2026-08-05). UI 버스.
   *
   * `levelUp`(레벨 수치가 오른 프레임)과 **다른 사건**이다 — 카드 등장은 프리즈가 걸려 선택을
   * 요구하는 순간이고, 그것이 플레이어가 실제로 반응해야 하는 지점이다. 둘을 한 소리로 묶으면
   * 화면이 멈춘 이유를 소리가 말해 주지 못한다.
   */
  | 'card';

/** 믹싱 버스(각 GainNode 로 매핑). BGM=음악, SFX=전투 효과음, UI=메뉴/버튼음. */
export type AudioBus = 'bgm' | 'sfx' | 'ui';

// ---------------------------------------------------------------------------
// CC0 실음원 샘플 레이어 (사용자 지시 2026-08-05 — "공개 사운드 중에 괜찮은걸로")
// ---------------------------------------------------------------------------

/**
 * 실음원 샘플 키. 발사음은 **무기 종류별로 갈린다**(사용자 지시 "기체의 탄 발사 소리는 기체의
 * 장비에 맞춰서 소리를 바꿔준다") — 그래서 `shot` 하나가 아니라 `shot0..4` 다.
 *
 * ## 왜 절차 합성을 지우지 않는가
 * 이 게임은 SFX 를 전부 WebAudio 로 합성해 왔다(이 파일 머리). 그 방식의 장점(번들 0·라이선스
 * 0)은 그대로지만 사용자 판정은 "너무 투박하다"였다. 그래서 **덮어쓰지 않고 얹는다**:
 * 샘플이 로드돼 있으면 샘플을, 아니면 기존 합성을 쓴다({@link GameAudio.playSample}).
 *
 * 폴백이 실제로 필요한 경우가 있다: 파일은 **ogg 단일 포맷**이라 Ogg Vorbis 를 디코드하지
 * 못하는 브라우저(주로 Safari)에서는 `decodeAudioData` 가 실패한다. 그 환경은 조용히 합성으로
 * 돌아가므로 **무음이 되지 않는다.** mp3 병행이 필요해지면 `assets/audio/sfx/` 에 같은 basename
 * 의 mp3 를 넣고 {@link SFX_MANIFEST} 를 쌍으로 바꾸면 된다(BGM 이 이미 그 구조다).
 */
export type SampleKey =
  | 'shot0'
  | 'shot1'
  | 'shot2'
  | 'shot3'
  | 'shot4'
  | 'hit'
  | 'card'
  /**
   * 보스 **예고 루프**(등장 전 반복 → 등장하면 정지). `src/render/bossWarn.ts` 가 구동한다.
   *
   * ⚠️ **보스 "등장음" 은 없다**(사용자 선택 2026-08-05 — 청취실 X0). 반복되던 이 소리가
   * 뚝 끊기는 **정적 자체가** 등장 신호이고, 같은 순간 보스 BGM 존으로 전환된다. 등장음을
   * 얹으면 그 정적이 메워져 구조가 무너지므로 `'boss'` 키는 의도적으로 없다.
   */
  | 'bossWarn';

/**
 * 샘플 키 → `assets/audio/sfx/` 안의 basename + 재생 게인.
 *
 * ⚠️ **게인은 후보 간 체감 음량을 맞추는 보정치**다. 원본 음원의 피크가 제각각이라 1.0 으로
 * 두면 발사음만 귀를 때린다. 특히 `shot*` 은 초당 5~15회 울리므로 다른 것보다 크게 낮다 —
 * 이 값을 올리고 싶어지면 반드시 **연사 상태에서** 확인하라(`playShot` 주석의 함정).
 *
 * ## `maxSec` — 재생 길이 상한(발사음 전용)
 * 고른 원본의 길이가 제각각이다(실측: 발칸 0.25s · 스프레드 0.32s · 레일건 0.71s ·
 * **미사일 1.26s** · **빔 0.97s**). 발사 간격보다 긴 샘플은 **겹쳐 쌓인다** — 초당 8발이면
 * 1초짜리 샘플이 8겹이 되어 음량이 치솟고 개별 타격이 뭉갠다(보이스 상한 24 가 폭주만 막을 뿐
 * 뭉개짐은 못 막는다). 그래서 원본을 재인코딩하지 않고 **재생 시점에** 페이드아웃하며 끊는다.
 *
 * 값은 무기의 대략적 연사 간격에서 잡았다. 늘리고 싶으면 그 무기의 실제 발사 간격을 먼저
 * 재라 — 간격보다 길면 반드시 겹친다. `undefined` = 원본을 끝까지 재생(피격·카드·예고는 잦지
 * 않아 상한이 필요 없다). TODO(밸런스): 실플레이 후 조정.
 *
 * 출처·라이선스는 `assets/audio/CREDITS.md` 에 있다(전부 Kenney.nl · CC0 1.0).
 */
const SFX_MANIFEST: Readonly<Record<SampleKey, { file: string; gain: number; maxSec?: number }>> = {
  shot0: { file: 'sfx_shot_vulcan.ogg', gain: 0.5, maxSec: 0.28 },
  shot1: { file: 'sfx_shot_spread.ogg', gain: 0.45, maxSec: 0.32 },
  shot2: { file: 'sfx_shot_railgun.ogg', gain: 0.45, maxSec: 0.5 },
  shot3: { file: 'sfx_shot_missile.ogg', gain: 0.5, maxSec: 0.45 },
  shot4: { file: 'sfx_shot_beam.ogg', gain: 0.45, maxSec: 0.3 },
  hit: { file: 'sfx_hit.ogg', gain: 0.85 },
  card: { file: 'sfx_card.ogg', gain: 0.7 },
  bossWarn: { file: 'sfx_boss_warn.ogg', gain: 0.7 },
};

/**
 * `maxSec` 로 잘라 낼 때의 페이드아웃 길이(초). 이보다 급하게 끊으면 파형이 0 이 아닌 지점에서
 * 잘려 "틱" 하는 클릭 노이즈가 난다.
 */
const SAMPLE_CUT_FADE_SEC = 0.04;

/**
 * `assets/audio/sfx/` 의 실재 파일 URL 을 build 시 해석한다(`?url` — 바이트가 아닌 URL 문자열).
 * **실재하는 파일만** 잡히므로 파일이 없어도 빌드가 깨지지 않고 빈 집합이 된다(musicDirector 의
 * `AUDIO_URLS` 와 동일 패턴). 오디오 바이트는 초기 JS 청크에 실리지 않고 fetch 시 로드된다.
 */
const SFX_URLS = import.meta.glob('../../assets/audio/sfx/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 해석된 URL(없으면 null). musicDirector `resolveAudioUrl` 과 같은 패턴. */
function resolveSfxUrl(basename: string): string | null {
  for (const key in SFX_URLS) {
    if (key.endsWith(`/${basename}`)) {
      const url = SFX_URLS[key];
      if (url !== undefined) return url;
    }
  }
  return null;
}

/**
 * 사운드 이름(+무기 종류) → 실음원 키. 실음원을 두지 않는 사운드는 **null**(= 기존 절차 합성
 * 그대로). 순수 함수라 테스트가 매핑을 직접 못 박는다.
 *
 * ⚠️ 발사음만 `weaponType` 을 탄다. 0..4 밖이거나 미지정이면 기본 발칸(`shot0`)으로 접는다 —
 * `playShot` 의 `default` 분기와 **같은 규약**이라 샘플/합성 어느 쪽으로 떨어져도 같은 무기가
 * 같은 소리를 낸다.
 */
export function sampleKeyFor(name: SoundName, weaponType?: number): SampleKey | null {
  switch (name) {
    case 'shot': {
      const w = weaponType;
      if (w === 1) return 'shot1';
      if (w === 2) return 'shot2';
      if (w === 3) return 'shot3';
      if (w === 4) return 'shot4';
      return 'shot0';
    }
    case 'hit':
      return 'hit';
    case 'card':
      return 'card';
    default:
      return null;
  }
}

/**
 * `play()` 옵션. **P1 은 타입만 예약하고 실제 소비는 P2(sfx-expansion)가 구현**한다.
 * - `pan`: -1(좌)..1(우) 스테레오 패닝(거리 감쇠 없음).
 * - `weaponType`: 무기 발사음 변주(0..4).
 */
export type PlayOpts = { pan?: number; weaponType?: number };

/** 지속 저장되는 오디오 설정(3버스 볼륨 + 전역 음소거). */
export interface AudioSettings {
  muted: boolean;
  /** 0..1 BGM(음악) 버스 볼륨. */
  bgmVolume: number;
  /** 0..1 SFX(전투 효과음) 버스 볼륨. */
  sfxVolume: number;
  /** 0..1 UI(메뉴/버튼음) 버스 볼륨. */
  uiVolume: number;
}

/** localStorage 키. */
const STORAGE_KEY = 'pb.audio';

/** clampVolume 이 유한하지 않은 입력에 돌려줄 안전 폴백(모든 버스 공통, 중간값). */
const FALLBACK_VOLUME = 0.5;

/**
 * 기본 설정(음소거 해제, 버스별 잠정 볼륨). **BGM 0.5·SFX 0.6·UI 0.5 는 잠정값이며 출시 전
 * 밸런스 패스에서 조정 대상**이다(plan 원칙4 — 구조/배선만 확정).
 */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  bgmVolume: 0.5,
  sfxVolume: 0.6,
  uiVolume: 0.5,
};

/** 볼륨을 0..1 로 클램프(NaN/범위 밖 방어, 순수). */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return FALLBACK_VOLUME;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 저장 문자열(JSON) → 설정(방어적, 순수). 손상/부재면 기본값.
 *
 * **레거시 마이그레이션(R5·AC10, 무손실)**: 구형 저장본은 단일 `{muted, volume}` 형태였다.
 * 신형 버스 필드(`bgmVolume`)가 없고 `volume` 숫자만 있으면 그 값을 3버스에 **동일 복사**해
 * 데이터 손실 없이 승격한다. 신형이면 각 버스 필드를 개별 파싱·clamp 하고, 타입이 틀리거나
 * 없는 필드는 해당 버스 기본값으로 대체한다.
 */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (raw === null) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_AUDIO_SETTINGS };
    const o = parsed as Record<string, unknown>;
    const muted = typeof o.muted === 'boolean' ? o.muted : DEFAULT_AUDIO_SETTINGS.muted;
    // 레거시: 신형 버스 필드가 없고 구형 단일 volume 숫자만 있으면 3버스에 무손실 복사.
    if (typeof o.bgmVolume !== 'number' && typeof o.volume === 'number') {
      const v = clampVolume(o.volume);
      return { muted, bgmVolume: v, sfxVolume: v, uiVolume: v };
    }
    return {
      muted,
      bgmVolume: typeof o.bgmVolume === 'number' ? clampVolume(o.bgmVolume) : DEFAULT_AUDIO_SETTINGS.bgmVolume,
      sfxVolume: typeof o.sfxVolume === 'number' ? clampVolume(o.sfxVolume) : DEFAULT_AUDIO_SETTINGS.sfxVolume,
      uiVolume: typeof o.uiVolume === 'number' ? clampVolume(o.uiVolume) : DEFAULT_AUDIO_SETTINGS.uiVolume,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** 설정 → 저장 문자열(순수, 신형 4필드). */
export function serializeAudioSettings(s: AudioSettings): string {
  return JSON.stringify({
    muted: s.muted,
    bgmVolume: clampVolume(s.bgmVolume),
    sfxVolume: clampVolume(s.sfxVolume),
    uiVolume: clampVolume(s.uiVolume),
  });
}

function readStored(): AudioSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_AUDIO_SETTINGS };
    return parseAudioSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function writeStored(s: AudioSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, serializeAudioSettings(s));
  } catch {
    // 저장 실패는 무시(세션 내 설정은 유지).
  }
}

/** 브라우저에 WebAudio 가 있는지. */
function audioSupported(): boolean {
  return typeof window !== 'undefined' && typeof AudioContext !== 'undefined';
}

/** pan 을 -1..1 로 클램프(NaN 방어, 순수). */
function clampPan(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/**
 * 사운드별 최소 재생 간격(초, ctx.currentTime 기준). **전부 잠정값 — 밸런스 유예**(plan 원칙4).
 * 목록에 없는 사운드는 {@link DEFAULT_THROTTLE_S}. 발사(shot)는 기존 40ms 스로틀을 일반화한 것.
 */
const THROTTLE_S: Partial<Record<SoundName, number>> = {
  shot: 0.04,
  hit: 0.03,
  kill: 0.03,
  warn: 0.15,
};
/** 스로틀 목록에 없는 사운드의 기본 최소 간격(초). 잠정값 — 밸런스 유예. */
const DEFAULT_THROTTLE_S = 0.02;
/** 동시 활성 source(osc/bufferSource) 상한. 초과 시 oldest stop(voice-steal). 잠정값 — 밸런스 유예. */
const MAX_VOICES = 24;

/**
 * 보이스 관리(AC18·R4). 두 가지를 담당한다:
 *  1. **사운드별 스로틀** — {@link THROTTLE_S} 최소 간격 미달이면 재생 skip(1 play 당 1회 판정).
 *  2. **동시 source 상한** — 활성 source 를 추적(1 play 가 N source 면 N 카운트), 상한 초과 시
 *     oldest 를 stop 한다. 각 source 는 `onended` 로 활성 목록에서 자동 제거된다.
 *
 * 순수 render. sim 무관. `ctx.currentTime`(Date.now 아님)만 신뢰한다.
 */
class VoiceAllocator {
  private readonly lastAt = new Map<SoundName, number>();
  private readonly active: AudioScheduledSourceNode[] = [];

  /** 이 사운드가 지금(now) 스로틀을 통과하는지. 통과하면 마지막 시각을 갱신한다. */
  gate(name: SoundName, now: number): boolean {
    const min = THROTTLE_S[name] ?? DEFAULT_THROTTLE_S;
    const last = this.lastAt.get(name);
    if (last !== undefined && now - last < min) return false;
    this.lastAt.set(name, now);
    return true;
  }

  /** 활성 source 등록. 상한 초과 시 oldest stop(steal). onended 로 자동 해제. */
  track(src: AudioScheduledSourceNode): void {
    this.active.push(src);
    src.onended = () => {
      const i = this.active.indexOf(src);
      if (i >= 0) this.active.splice(i, 1);
    };
    while (this.active.length > MAX_VOICES) {
      const oldest = this.active.shift();
      if (oldest === undefined) break;
      try {
        oldest.stop();
      } catch {
        // 이미 정지/미시작 — 무시.
      }
    }
  }
}

/**
 * WebAudio 절차 합성 사운드 보드. 브라우저 밖(테스트)에서도 안전하게 생성되며, 미지원/
 * 음소거 시 `play` 는 조용히 no-op 한다.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  /** 전역 음소거 스위치(muted?0:1). 버스 게인은 건드리지 않는다. */
  private master: GainNode | null = null;
  /** 버스 게인(각 버스 볼륨 담당). BGM 은 musicDirector 가 이 노드에 직접 연결한다. */
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: AudioSettings;
  /** 보이스 관리(사운드별 스로틀 + 동시 source 상한/steal). 기존 발사 스로틀을 흡수한다. */
  private readonly voices = new VoiceAllocator();
  private readonly listeners = new Set<(s: AudioSettings) => void>();
  /** 디코드 완료된 CC0 실음원. 키가 없으면 그 사운드는 절차 합성으로 떨어진다. */
  private readonly samples = new Map<SampleKey, AudioBuffer>();
  /** 샘플 로딩을 한 번만 돌리기 위한 가드(중복 fetch·decode 방지). */
  private samplesRequested = false;

  constructor() {
    this.settings = readStored();
  }

  /** 현재 설정 사본. */
  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** 설정 변경 구독(설정 패널 라이브 반영). 해제 함수 반환. */
  onChange(fn: (s: AudioSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.getSettings();
    for (const fn of this.listeners) fn(snap);
  }

  /** 전역 음소거 토글(master 게인만 0/1 전환 — 버스 볼륨은 보존). */
  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyGain();
    writeStored(this.settings);
    this.emit();
  }

  /** 지정 버스 볼륨 설정(0..1). 음소거·다른 버스는 유지. */
  setBusVolume(bus: AudioBus, v: number): void {
    const vol = clampVolume(v);
    switch (bus) {
      case 'bgm':
        this.settings.bgmVolume = vol;
        break;
      case 'sfx':
        this.settings.sfxVolume = vol;
        break;
      case 'ui':
        this.settings.uiVolume = vol;
        break;
    }
    this.applyGain();
    writeStored(this.settings);
    this.emit();
  }

  /**
   * 버스 게인 노드 접근자(musicDirector 가 'bgm' 버스에 소스를 연결하는 데 쓴다).
   * ctx 미준비면 null — 호출부는 먼저 {@link getContext} 로 ctx 를 확보한 뒤 사용한다.
   */
  getBus(bus: AudioBus): GainNode | null {
    switch (bus) {
      case 'bgm':
        return this.bgmGain;
      case 'sfx':
        return this.sfxGain;
      case 'ui':
        return this.uiGain;
    }
  }

  /**
   * AudioContext 접근자(musicDirector 가 decode/BufferSource 생성에 쓴다). 내부에서
   * {@link ensureCtx} 를 먼저 호출하므로, 자동재생 정책상 사용자 제스처 이후에 부르면
   * 컨텍스트가 준비된다(미지원 환경이면 null).
   */
  getContext(): AudioContext | null {
    this.ensureCtx();
    return this.ctx;
  }

  /** master=음소거 스위치(0/1), 각 버스 게인=버스 볼륨. */
  private applyGain(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const now = ctx.currentTime;
    if (this.master !== null) this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, now, 0.01);
    if (this.bgmGain !== null) this.bgmGain.gain.setTargetAtTime(clampVolume(this.settings.bgmVolume), now, 0.01);
    if (this.sfxGain !== null) this.sfxGain.gain.setTargetAtTime(clampVolume(this.settings.sfxVolume), now, 0.01);
    if (this.uiGain !== null) this.uiGain.gain.setTargetAtTime(clampVolume(this.settings.uiVolume), now, 0.01);
  }

  /**
   * 사용자 제스처(클릭/키다운)에서 호출 — AudioContext 를 생성/resume 한다. 자동재생 정책상
   * 첫 소리 전에 최소 1회 필요. 미지원 환경이면 no-op.
   */
  unlock(): void {
    this.ensureCtx();
    if (this.ctx !== null && this.ctx.state === 'suspended') void this.ctx.resume();
    // CC0 실음원은 여기서 처음 받는다 — ctx 가 서기 전에는 decodeAudioData 를 부를 수 없다.
    this.loadSamples();
  }

  private ensureCtx(): void {
    if (this.ctx !== null || !audioSupported()) return;
    try {
      const ctx = new AudioContext();
      // master(음소거 스위치) → destination. 각 버스 게인(볼륨) → master.
      const master = ctx.createGain();
      master.gain.value = this.settings.muted ? 0 : 1;
      master.connect(ctx.destination);
      const bgmGain = ctx.createGain();
      const sfxGain = ctx.createGain();
      const uiGain = ctx.createGain();
      bgmGain.gain.value = clampVolume(this.settings.bgmVolume);
      sfxGain.gain.value = clampVolume(this.settings.sfxVolume);
      uiGain.gain.value = clampVolume(this.settings.uiVolume);
      bgmGain.connect(master);
      sfxGain.connect(master);
      uiGain.connect(master);
      // 노이즈 버퍼(0.4s 화이트 노이즈) — 폭발/피격/사출 합성용. Math.random 은 render 전용.
      const len = Math.floor(ctx.sampleRate * 0.4);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.bgmGain = bgmGain;
      this.sfxGain = sfxGain;
      this.uiGain = uiGain;
      this.noiseBuffer = buf;
    } catch {
      this.ctx = null;
    }
  }

  /**
   * CC0 실음원을 내려받아 디코드한다(사용자 제스처 이후 1회 — `unlock` 이 부른다).
   *
   * **실패는 전부 조용히 흡수한다.** 파일 부재·네트워크 실패·ogg 미지원(Safari) 어느 경우든
   * 해당 키가 `samples` 에 안 들어갈 뿐이고, `play` 는 기존 절차 합성으로 떨어진다 — 무음이
   * 되는 경로가 없다({@link SampleKey} 주석).
   *
   * 각 파일은 수십 KB 라 전부 받아도 1MB 미만이고, 초기 JS 청크와 무관하다(`?url` 지연 로딩).
   */
  private loadSamples(): void {
    if (this.samplesRequested) return;
    const ctx = this.ctx;
    if (ctx === null || typeof fetch !== 'function') return;
    this.samplesRequested = true;
    for (const key of Object.keys(SFX_MANIFEST) as SampleKey[]) {
      const url = resolveSfxUrl(SFX_MANIFEST[key].file);
      if (url === null) continue; // 파일 미배치 — 합성 폴백.
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          this.samples.set(key, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // ogg 미지원·네트워크 실패 — 합성 폴백(무음 아님).
        }
      })();
    }
  }

  /**
   * 실음원 1회 재생. 버퍼가 아직 없으면 **false** 를 돌려주고, 호출부가 절차 합성으로 떨어진다.
   *
   * `gainScale` 은 호출부가 거는 추가 배율이다(예: 예고 루프가 보스에 가까워질수록 키운다).
   * 매니페스트의 기준 게인에 곱한다.
   */
  playSample(key: SampleKey, opts?: PlayOpts & { gainScale?: number }): boolean {
    if (this.settings.muted) return false;
    this.ensureCtx();
    const ctx = this.ctx;
    const buf = this.samples.get(key);
    // 발사음은 SFX, 카드는 UI 버스다 — 이름 규칙이 아니라 키로 가른다.
    const bus = key === 'card' ? this.uiGain : this.sfxGain;
    if (ctx === null || buf === undefined || bus === null || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    const dest = this.applyPan(bus, opts?.pan, now);
    const spec = SFX_MANIFEST[key];
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    const peak = spec.gain * (opts?.gainScale ?? 1);
    gain.gain.value = peak;
    src.connect(gain);
    gain.connect(dest);
    src.start(now);
    // 원본이 재생 상한보다 길면 페이드아웃하며 끊는다(§ maxSec — 연사 겹침 방지).
    const max = spec.maxSec;
    if (max !== undefined && buf.duration > max) {
      const fadeFrom = Math.max(0, max - SAMPLE_CUT_FADE_SEC);
      gain.gain.setValueAtTime(peak, now + fadeFrom);
      gain.gain.linearRampToValueAtTime(0.0001, now + max);
      src.stop(now + max);
    }
    this.voices.track(src);
    return true;
  }

  /** 이 샘플이 디코드돼 재생 가능한 상태인가(예고 루프가 시작 전 확인한다). */
  hasSample(key: SampleKey): boolean {
    return this.samples.has(key);
  }

  /** 사운드 이름 → 라우팅 버스 게인. UI 계열은 UI 버스, 나머지 전투 SFX(드랍·경고 포함)는 SFX 버스. */
  private busFor(name: SoundName): GainNode | null {
    switch (name) {
      case 'ui':
      case 'uiNavigate':
      case 'uiConfirm':
      case 'uiPositive':
      case 'uiNegative':
      case 'uiCelebrate':
      case 'card':
        return this.uiGain;
      default:
        // shot/hit/kill/pickup/boss/levelUp/victory/defeat/eject/drop*/warn → SFX 버스.
        return this.sfxGain;
    }
  }

  /**
   * pan 이 주어지면 sound→bus 사이에 StereoPannerNode 를 삽입해 반환(합성 그래프의 dest 로 사용).
   * 없거나 미지원이면 버스를 그대로 반환(직결). 거리 감쇠는 없다 — 좌우 패닝만(AC15).
   */
  private applyPan(bus: AudioNode, pan: number | undefined, now: number): AudioNode {
    const ctx = this.ctx;
    if (ctx === null || pan === undefined || typeof ctx.createStereoPanner !== 'function') return bus;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampPan(pan), now);
    panner.connect(bus);
    return panner;
  }

  /** 반복 SFX 주파수 지터(±3%). Math.random 은 render 전용(결정론 무관). 잠정폭 — 밸런스 유예. */
  private jFreq(freq: number): number {
    return freq * (1 + (Math.random() - 0.5) * 0.06);
  }

  /** 반복 SFX 게인 지터(±10%). 잠정폭 — 밸런스 유예. */
  private jGain(peak: number): number {
    return peak * (1 + (Math.random() - 0.5) * 0.2);
  }

  /**
   * 사운드 재생(미지원/음소거/컨텍스트 미준비면 조용히 no-op). 각 사운드는 {@link busFor}
   * 로 결정된 버스 게인에 합성한다(master 는 음소거 스위치일 뿐 볼륨은 버스가 담당).
   *
   * `opts.pan`(-1..1)이 있으면 sound→bus 사이에 StereoPanner 를 끼운다(패닝만, 감쇠 없음).
   * `opts.weaponType`(0..4)는 `shot` 음색을 5종으로 변주한다. 폭주 방지·동시 source 상한은
   * {@link VoiceAllocator}(스로틀 gate + track/steal)가 담당한다.
   */
  play(name: SoundName, opts?: PlayOpts): void {
    if (this.settings.muted) return;
    this.ensureCtx();
    const ctx = this.ctx;
    const bus = this.busFor(name);
    if (ctx === null || bus === null || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // 사운드별 스로틀(1 play 당 1회 판정). 미달이면 skip.
    if (!this.voices.gate(name, now)) return;
    // CC0 실음원이 있으면 그것을 쓰고, 없으면 아래 절차 합성으로 떨어진다({@link SampleKey}).
    // 발사음만 무기 종류에 따라 키가 갈린다(0..4 밖은 기본 발칸으로 접는다).
    const sampleKey = sampleKeyFor(name, opts?.weaponType);
    if (sampleKey !== null && this.playSample(sampleKey, opts)) return;
    // pan 이 있으면 패너를 끼운 그래프 종단을 dest 로 사용.
    const dest = this.applyPan(bus, opts?.pan, now);
    switch (name) {
      case 'shot':
        this.playShot(dest, now, opts?.weaponType);
        break;
      case 'hit':
        // 피격(내 기체가 맞았다) — 임팩트 + 선체 금속 링잉(2026-08-05 개편).
        //
        // ## 왜 바꿨나
        // 구 조합(로우패스 노이즈 + 저음 톱니)은 `kill`(처치)과 **같은 대역**에 있었다. 전투
        // 중에는 처치음이 초당 여러 번 울리므로 피격이 그 안에 묻혀 "맞았다"가 안 읽혔다
        // (사용자 지시 "피격 당했을때도 사운드 추가" — 소리가 없던 게 아니라 안 들렸다).
        // 지금은 ①짧은 고역 임팩트 ②저역으로 떨어지는 바디 ③**중고역 금속 링잉 꼬리**로
        // 나눈다. ③이 처치음에 없는 성분이라 겹쳐도 분리돼 들린다.
        this.noise(dest, now, 0.06, 1800, this.jGain(0.3));
        this.drop(dest, now, this.jFreq(220), 55, 0.2, 'sine', this.jGain(0.34));
        this.bell(dest, now + 0.012, this.jFreq(430), 0.42, 0.16, [1, 2.4, 4.1]);
        break;
      case 'kill':
        // 처치: 블립 + 하강 스윕 + 레이어(파열 노이즈) 보강(AC17). 지터 적용.
        this.blip(dest, now, this.jFreq(340), 0.1, 'triangle', this.jGain(0.28));
        this.sweep(dest, now, this.jFreq(420), 120, 0.16, 'sawtooth', this.jGain(0.22));
        this.noise(dest, now, 0.12, 1400, this.jGain(0.16));
        break;
      case 'pickup':
        this.blip(dest, now, 880, 0.07, 'sine', 0.3);
        this.blip(dest, now + 0.06, 1240, 0.08, 'sine', 0.3);
        break;
      case 'boss':
        // 보스 등장 — 브라스 스팅어(2026-08-05 개편): 아래로 떨어졌다가 위로 강타.
        //
        // 구 조합은 0.7초짜리 단일 상승 스윕이라 **레벨업·승리음과 같은 문법**(올라가면 좋은
        // 일)이었다. 보스 등장은 좋은 일이 아니라 위협이므로 방향이 반대여야 하고, 무엇보다
        // 그 전에 **정적**이 있어야 강타가 산다 — 앞의 하강이 그 정적을 만든다.
        this.sweep(dest, now, 300, 70, 0.55, 'sawtooth', 0.22);
        this.noise(dest, now + 0.45, 0.5, 900, 0.28);
        this.tone(dest, now + 0.5, 87, 1.1, 'sawtooth', 0.34, 1800, 300, 3); // 근음
        this.tone(dest, now + 0.5, 130.8, 1.1, 'sawtooth', 0.22, 2200, 400, 3); // 5도
        this.tone(dest, now + 0.52, 174.6, 1.0, 'square', 0.1, 1400, 350, 4); // 옥타브
        this.drop(dest, now + 0.5, 110, 42, 1.2, 'sine', 0.3); // 서브 바디
        break;
      case 'levelUp':
        // 상승 아르페지오(축하).
        this.blip(dest, now, 523, 0.12, 'triangle', 0.3);
        this.blip(dest, now + 0.1, 659, 0.12, 'triangle', 0.3);
        this.blip(dest, now + 0.2, 784, 0.16, 'triangle', 0.32);
        break;
      case 'victory':
        this.blip(dest, now, 523, 0.16, 'square', 0.3);
        this.blip(dest, now + 0.14, 659, 0.16, 'square', 0.3);
        this.blip(dest, now + 0.28, 784, 0.16, 'square', 0.3);
        this.blip(dest, now + 0.42, 1047, 0.3, 'square', 0.34);
        break;
      case 'defeat':
        // 하강(패배 + 사출 낙하 톤).
        this.sweep(dest, now, 440, 110, 0.6, 'sawtooth', 0.32);
        break;
      case 'eject':
        // 사출 "뿅" + 낙하산 바람 노이즈(격추 유머).
        this.sweep(dest, now, 300, 1100, 0.18, 'sine', 0.3);
        this.noise(dest, now + 0.18, 0.5, 1600, 0.18);
        break;
      case 'ui':
        this.blip(dest, now, 660, 0.05, 'sine', 0.22);
        break;
      // ── 드랍 등급음(AC14) ── 노말/매직 공용·레어 강조·유니크 팡파레.
      case 'dropCommon':
        // 짧고 부드러운 "팅"(픽업과 구별되는 획득 확인음). 미세 지터.
        this.blip(dest, now, this.jFreq(700), 0.08, 'triangle', this.jGain(0.22));
        this.blip(dest, now + 0.05, this.jFreq(990), 0.07, 'sine', this.jGain(0.2));
        break;
      case 'dropRare':
        // 레어 강조: 더 밝은 2음 상승 + 반짝임.
        this.blip(dest, now, 784, 0.1, 'square', 0.24);
        this.blip(dest, now + 0.08, 1175, 0.12, 'triangle', 0.26);
        this.blip(dest, now + 0.16, 1568, 0.1, 'sine', 0.2);
        break;
      case 'dropUnique':
        // 유니크 팡파레: 화려한 4음 상승(시각 레지스터 정합 — 유니크만 고유, 원칙5).
        this.blip(dest, now, 659, 0.12, 'square', 0.3);
        this.blip(dest, now + 0.1, 880, 0.12, 'square', 0.3);
        this.blip(dest, now + 0.2, 1175, 0.14, 'triangle', 0.32);
        this.blip(dest, now + 0.32, 1568, 0.28, 'square', 0.34);
        this.blip(dest, now + 0.34, 2093, 0.24, 'sine', 0.2);
        break;
      // ── 메타 UI 의미범주(AC16) ── 이동·확정·긍정·부정·축하. UI 버스.
      case 'uiNavigate':
        // 이동/포커스: 아주 짧은 소프트 틱.
        this.blip(dest, now, 520, 0.04, 'sine', 0.18);
        break;
      case 'uiConfirm':
        // 확정/선택: 2음 상승 확인.
        this.blip(dest, now, 660, 0.05, 'sine', 0.22);
        this.blip(dest, now + 0.05, 880, 0.06, 'sine', 0.22);
        break;
      case 'uiPositive':
        // 긍정/성공: 밝은 상승.
        this.blip(dest, now, 784, 0.08, 'triangle', 0.26);
        this.blip(dest, now + 0.08, 1047, 0.12, 'triangle', 0.28);
        break;
      case 'uiNegative':
        // 부정/거부: 낮은 하강 버즈.
        this.sweep(dest, now, 300, 170, 0.14, 'sawtooth', 0.22);
        break;
      case 'uiCelebrate':
        // 축하: 짧은 3음 아르페지오.
        this.blip(dest, now, 659, 0.09, 'triangle', 0.28);
        this.blip(dest, now + 0.08, 880, 0.09, 'triangle', 0.28);
        this.blip(dest, now + 0.16, 1175, 0.14, 'square', 0.3);
        break;
      // ── 렙업 카드 등장(2026-08-05) ── "카드 뽑기": 스치는 휙 → 착지 → 반짝.
      case 'card':
        this.sweep(dest, now, 1800, 5200, 0.13, 'sawtooth', 0.05); // 종이가 스치는 공기음
        this.bnoise(dest, now, 0.14, 3600, 0.1, 0.8);
        this.tone(dest, now + 0.13, 392, 0.16, 'triangle', 0.2, 2600, 700, 5); // 착지
        this.bell(dest, now + 0.16, 1046, 0.4, 0.16, [1, 2.1, 3.6]); // 반짝
        this.bell(dest, now + 0.26, 1568, 0.34, 0.11, [1, 2.4]);
        break;
      // ── 적 특수탄/보스탄 경고(AC19) ── 긴장감 있는 짧은 경보(2펄스).
      case 'warn':
        this.blip(dest, now, 233, 0.09, 'square', 0.24);
        this.blip(dest, now + 0.11, 233, 0.09, 'square', 0.24);
        break;
    }
  }

  /**
   * 무기 발사음 5종 변주(AC12: 0 VULCAN·1 SPREAD·2 RAILGUN·3 MISSILE·4 BEAM). weaponType 미지정
   * 이면 기본 VULCAN 계열. 잦은 사운드라 지터로 반복 피로/균질화를 완화한다(AC17). 게인은 낮게.
   *
   * ## 2026-08-05 개편 — "너무 투박하다"의 정체는 **어택 트랜지언트의 부재**였다
   * 구 구현은 5종 전부 생 오실레이터 한 발({@link blip})이었다. 실제 총성은 ①아주 짧은 광대역
   * 파열(총구) ②그 뒤에 남는 몸통, 두 층으로 되어 있고 **①이 없으면 "삑"으로 들린다.** 게인
   * 엔벨로프를 아무리 짧게 잘라도 그 층은 생기지 않는다 — 성분 자체가 다르기 때문이다.
   *
   * 그래서 5종 모두 **{@link bnoise}(또는 {@link noise}) 어택 + {@link tone}(필터가 닫히는 몸통)**
   * 두 층으로 다시 짰다. 몸통의 lowpass 가 시간에 따라 닫히면서 고차 배음을 걷어내므로, 파형이
   * sawtooth 여도 귀에 거칠지 않다.
   *
   * ⚠️ 발사음은 **초당 5~15회** 울린다. 게인·길이를 키우고 싶어지면 반드시 연사 상태에서
   * 들어라 — 단발로 좋은 소리가 연사에서 귀를 때리는 것이 이 축의 기본 함정이다.
   */
  private playShot(dest: AudioNode, now: number, weaponType: number | undefined): void {
    switch (weaponType) {
      case 1: // SPREAD — 넓고 낮은 산탄감(어택 노이즈가 넓다).
        this.bnoise(dest, now, 0.03, 1500, this.jGain(0.1), 0.9);
        this.tone(dest, now, this.jFreq(300), 0.07, 'sawtooth', this.jGain(0.09), 2200, 480, 5);
        break;
      case 2: // RAILGUN — 고역 자프 + 아래로 빠지는 전자기 꼬리.
        this.bnoise(dest, now, 0.012, 5200, this.jGain(0.08), 2.5);
        this.tone(dest, now, this.jFreq(1150), 0.06, 'sawtooth', this.jGain(0.09), 7000, 1400, 10);
        this.drop(dest, now, 2200, 900, 0.07, 'sine', this.jGain(0.05));
        break;
      case 3: // MISSILE — 추진 노이즈 + 저역으로 꺼지는 텀프.
        this.noise(dest, now, 0.05, 700, this.jGain(0.1));
        this.drop(dest, now, this.jFreq(240), 70, 0.12, 'sine', this.jGain(0.13));
        this.tone(dest, now, 380, 0.06, 'triangle', this.jGain(0.06), 1800, 400, 4);
        break;
      case 4: // BEAM — 지속감 있는 사인 톤 + 미세 고역 반짝.
        this.tone(dest, now, this.jFreq(760), 0.1, 'sine', this.jGain(0.1), 3000, 1200, 8);
        this.bnoise(dest, now, 0.02, 3400, this.jGain(0.04), 3);
        break;
      case 0: // VULCAN — 기본.
      default:
        this.bnoise(dest, now, 0.018, 2600, this.jGain(0.09), 1.2);
        this.tone(dest, now, this.jFreq(430), 0.055, 'sawtooth', this.jGain(0.1), 3200, 700, 7);
        break;
    }
  }

  /** 단일 오실레이터 블립(주파수·길이·파형·피크게인). */
  private blip(
    dest: AudioNode,
    start: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    this.voices.track(osc);
  }

  /** 주파수 스윕(글리산도). */
  private sweep(
    dest: AudioNode,
    start: number,
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    this.voices.track(osc);
  }

  /**
   * **필터 엔벨로프가 걸린 톤** — 열렸다 닫히는 lowpass 를 통과시킨다.
   *
   * ## 왜 이것이 필요했나 (사용자 지시 2026-08-05 "현재 소리는 너무 투박하다")
   * 기존 SFX 는 전부 {@link blip}(생 오실레이터 + 게인 엔벨로프)으로 만들었다. square·sawtooth
   * 의 고차 배음이 감쇠 없이 그대로 나오기 때문에 짧게 잘라도 "삑"·"직"으로 들린다 — 실제
   * 악기·총성이 부드럽게 들리는 이유는 어택 직후 **고역이 먼저 죽기** 때문인데, 게인 엔벨로프
   * 하나로는 그 축을 만들 수 없다. 이 함수가 그 축을 준다: 파형은 그대로 두고 배음만 시간에
   * 따라 걷어낸다.
   */
  private tone(
    dest: AudioNode,
    start: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    cutFrom: number,
    cutTo: number,
    q = 6,
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    filter.type = 'lowpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(cutFrom, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutTo), start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    this.voices.track(osc);
  }

  /**
   * **피치가 떨어지는 바디**(임팩트·타격의 무게). {@link sweep} 과 달리 게인이 어택 없이
   * 최대에서 시작해 곧장 감쇠한다 — 스윕은 "지나가는 소리"이고 이쪽은 "부딪히는 소리"다.
   */
  private drop(
    dest: AudioNode,
    start: number,
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur * 0.7);
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    this.voices.track(osc);
  }

  /**
   * **대역 통과 노이즈** — 좁은 대역만 남긴 짧은 잡음. 어택 트랜지언트(총구의 "챡")와 금속·
   * 유리의 파열감을 만든다. {@link noise} 는 로우패스라 저역이 함께 남아 "퍽" 에 가깝다.
   */
  private bnoise(dest: AudioNode, start: number, dur: number, center: number, peak: number, q = 2): void {
    const ctx = this.ctx;
    if (ctx === null || this.noiseBuffer === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(center, start);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(start);
    src.stop(start + dur + 0.02);
    this.voices.track(src);
  }

  /**
   * **벨/링잉** — 비정수 배음비의 사인 다중합. 금속 선체가 우는 소리, 유리, 종. 배음비가
   * 정수가 아니어야 "음정"이 아니라 "울림"으로 들린다(기본값은 튜블러 벨 계열).
   */
  private bell(
    dest: AudioNode,
    start: number,
    freq: number,
    dur: number,
    peak: number,
    ratios: readonly number[] = [1, 2.76, 5.4],
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i] ?? 1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * r, start);
      // 높은 배음일수록 작고 빨리 죽는다(실제 금속체의 감쇠 특성).
      const p = peak / (i + 1.6);
      const d = dur * (1 - i * 0.22);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(p, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.03, d));
      osc.connect(gain);
      gain.connect(dest);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      this.voices.track(osc);
    }
  }

  /** 노이즈 버스트(로우패스로 톤 성형). */
  private noise(dest: AudioNode, start: number, dur: number, cutoff: number, peak: number): void {
    const ctx = this.ctx;
    if (ctx === null || this.noiseBuffer === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(start);
    src.stop(start + dur + 0.02);
    this.voices.track(src);
  }
}
