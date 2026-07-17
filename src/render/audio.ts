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
 * ── 볼륨/음소거 ── 마스터 게인으로 0..1 볼륨 + 음소거 토글을 제공하고 localStorage 에
 * 저장한다(CrazyGames 포털 QA 요구). AudioContext 는 브라우저 자동재생 정책에 맞춰 **첫 사용자
 * 제스처 이후 지연 생성/resume** 한다.
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
  | 'ui';

/** 지속 저장되는 오디오 설정. */
export interface AudioSettings {
  muted: boolean;
  /** 0..1 마스터 볼륨. */
  volume: number;
}

/** localStorage 키. */
const STORAGE_KEY = 'pb.audio';

/** 기본 설정(음소거 해제, 볼륨 60%). */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { muted: false, volume: 0.6 };

/** 볼륨을 0..1 로 클램프(NaN/범위 밖 방어, 순수). */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_AUDIO_SETTINGS.volume;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 저장 문자열(JSON) → 설정(방어적, 순수). 손상/부재면 기본값. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (raw === null) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const o = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_AUDIO_SETTINGS.muted,
      volume: typeof o.volume === 'number' ? clampVolume(o.volume) : DEFAULT_AUDIO_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** 설정 → 저장 문자열(순수). */
export function serializeAudioSettings(s: AudioSettings): string {
  return JSON.stringify({ muted: s.muted, volume: clampVolume(s.volume) });
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

/**
 * WebAudio 절차 합성 사운드 보드. 브라우저 밖(테스트)에서도 안전하게 생성되며, 미지원/
 * 음소거 시 `play` 는 조용히 no-op 한다.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: AudioSettings;
  /** 발사음 폭주 방지 스로틀(초 단위 ctx.currentTime 마지막 발사 시각). */
  private lastShotAt = -1;
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

  /** 음소거 토글. */
  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyGain();
    writeStored(this.settings);
    this.emit();
  }

  /** 볼륨 설정(0..1). 음소거는 유지(볼륨만 조절). */
  setVolume(v: number): void {
    this.settings.volume = clampVolume(v);
    this.applyGain();
    writeStored(this.settings);
    this.emit();
  }

  private applyGain(): void {
    if (this.master !== null && this.ctx !== null) {
      const g = this.settings.muted ? 0 : this.settings.volume;
      this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    }
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
      const master = ctx.createGain();
      master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      master.connect(ctx.destination);
      // 노이즈 버퍼(0.4s 화이트 노이즈) — 폭발/피격/사출 합성용. Math.random 은 render 전용.
      const len = Math.floor(ctx.sampleRate * 0.4);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = buf;
    } catch {
      this.ctx = null;
    }
  }

  /** 사운드 재생(미지원/음소거/컨텍스트 미준비면 조용히 no-op). */
  play(name: SoundName): void {
    if (this.settings.muted) return;
    this.ensureCtx();
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    switch (name) {
      case 'shot':
        // 발사음은 매우 잦으므로 40ms 스로틀 + 낮은 게인으로 귀 피로 방지.
        if (now - this.lastShotAt < 0.04) return;
        this.lastShotAt = now;
        this.blip(master, now, 620, 0.05, 'square', 0.12);
        break;
      case 'hit':
        this.noise(master, now, 0.16, 900, 0.35);
        this.blip(master, now, 180, 0.14, 'sawtooth', 0.25);
        break;
      case 'kill':
        this.blip(master, now, 340, 0.1, 'triangle', 0.28);
        this.sweep(master, now, 420, 120, 0.16, 'sawtooth', 0.22);
        break;
      case 'pickup':
        this.blip(master, now, 880, 0.07, 'sine', 0.3);
        this.blip(master, now + 0.06, 1240, 0.08, 'sine', 0.3);
        break;
      case 'boss':
        this.sweep(master, now, 90, 220, 0.7, 'sawtooth', 0.4);
        this.noise(master, now, 0.5, 400, 0.25);
        break;
      case 'levelUp':
        // 상승 아르페지오(축하).
        this.blip(master, now, 523, 0.12, 'triangle', 0.3);
        this.blip(master, now + 0.1, 659, 0.12, 'triangle', 0.3);
        this.blip(master, now + 0.2, 784, 0.16, 'triangle', 0.32);
        break;
      case 'victory':
        this.blip(master, now, 523, 0.16, 'square', 0.3);
        this.blip(master, now + 0.14, 659, 0.16, 'square', 0.3);
        this.blip(master, now + 0.28, 784, 0.16, 'square', 0.3);
        this.blip(master, now + 0.42, 1047, 0.3, 'square', 0.34);
        break;
      case 'defeat':
        // 하강(패배 + 사출 낙하 톤).
        this.sweep(master, now, 440, 110, 0.6, 'sawtooth', 0.32);
        break;
      case 'eject':
        // 사출 "뿅" + 낙하산 바람 노이즈(격추 유머).
        this.sweep(master, now, 300, 1100, 0.18, 'sine', 0.3);
        this.noise(master, now + 0.18, 0.5, 1600, 0.18);
        break;
      case 'ui':
        this.blip(master, now, 660, 0.05, 'sine', 0.22);
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
  }
}
