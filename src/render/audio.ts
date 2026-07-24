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
  | 'warn';

/** 믹싱 버스(각 GainNode 로 매핑). BGM=음악, SFX=전투 효과음, UI=메뉴/버튼음. */
export type AudioBus = 'bgm' | 'sfx' | 'ui';

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

  /** 사운드 이름 → 라우팅 버스 게인. UI 계열은 UI 버스, 나머지 전투 SFX(드랍·경고 포함)는 SFX 버스. */
  private busFor(name: SoundName): GainNode | null {
    switch (name) {
      case 'ui':
      case 'uiNavigate':
      case 'uiConfirm':
      case 'uiPositive':
      case 'uiNegative':
      case 'uiCelebrate':
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
    // pan 이 있으면 패너를 끼운 그래프 종단을 dest 로 사용.
    const dest = this.applyPan(bus, opts?.pan, now);
    switch (name) {
      case 'shot':
        this.playShot(dest, now, opts?.weaponType);
        break;
      case 'hit':
        // 피격: 노이즈 + 저음 톱니 + 레이어(저역 thud) 보강(AC17). 지터로 반복 균질화 방지.
        this.noise(dest, now, 0.16, 900, this.jGain(0.35));
        this.blip(dest, now, this.jFreq(180), 0.14, 'sawtooth', this.jGain(0.25));
        this.blip(dest, now, this.jFreq(90), 0.1, 'sine', this.jGain(0.18));
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
        this.sweep(dest, now, 90, 220, 0.7, 'sawtooth', 0.4);
        this.noise(dest, now, 0.5, 400, 0.25);
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
   */
  private playShot(dest: AudioNode, now: number, weaponType: number | undefined): void {
    switch (weaponType) {
      case 1: // SPREAD — 넓고 낮은 산탄감.
        this.blip(dest, now, this.jFreq(520), 0.05, 'square', this.jGain(0.11));
        break;
      case 2: // RAILGUN — 고음 샤프 자프(하강 스윕).
        this.sweep(dest, now, this.jFreq(1400), 700, 0.06, 'sawtooth', this.jGain(0.12));
        break;
      case 3: // MISSILE — 저음 텀프 + 소량 노이즈.
        this.blip(dest, now, this.jFreq(300), 0.08, 'triangle', this.jGain(0.13));
        this.noise(dest, now, 0.06, 800, this.jGain(0.12));
        break;
      case 4: // BEAM — 지속감 있는 사인 톤.
        this.blip(dest, now, this.jFreq(900), 0.08, 'sine', this.jGain(0.1));
        break;
      case 0: // VULCAN — 기본.
      default:
        this.blip(dest, now, this.jFreq(620), 0.05, 'square', this.jGain(0.12));
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
