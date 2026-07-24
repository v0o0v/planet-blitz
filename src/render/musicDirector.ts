/**
 * BGM 존 디렉터 (사운드 풍성화 Phase 3 — plan §bgm-zone, AC1~AC7; ADR-0029 하이브리드).
 *
 * 4개 지속 존(menu / combatPvE / boss / invasion)과 정산 스팅어(victory / defeat one-shot)를
 * equal-power 크로스페이드로 이어 붙이는 상태기계다. 트랙은 {@link GameAudio} 가 여는
 * `bgm` 버스({@link GameAudio.getBus}) 게인에 직접 연결하고, 디코드는 지연(요청 시)로 한다.
 *
 * ── 결정론(ADR-0005) ── 순수 render 레이어다. sim 은 음악을 전혀 모르며(해시·리플레이·정산
 * 무관), 존 전환은 호출부(main.ts)가 화면/보스 상태를 관찰해 {@link MusicDirector.setZone} 로
 * 지시한다(sim → render 단방향). 이 모듈은 `src/sim/` 에서 절대 import 되지 않는다. 타이밍은
 * `Date.now` 가 아니라 `ctx.currentTime` 을 쓴다(결정론 무관하나 render 규율 유지).
 *
 * ── 하이브리드 에셋(ADR-0029) ── SFX 는 절차 합성(audio.ts)이지만 BGM 만 외부 5트랙이다.
 * 실제 음악은 사람이 큐레이션하며(로열티프리/CC0/상업 라이선스, AI 생성 음악 금지 —
 * assets/audio/CREDITS.md), 지금은 **placeholder** 다. 트랙 URL 은 vite 의 `import.meta.glob`
 * 으로 `assets/audio/` 에 **실재하는 파일만** 해석하므로, 음악 파일이 없어도 glob 은 빈 집합을
 * 돌려주고 빌드는 깨지지 않는다(정적 import 해석 실패가 원천적으로 없음). 실행 시에는 fetch
 * 404 / decode 실패를 try/catch 로 삼켜 해당 존을 조용히 무음 처리한다(throw 금지). `?url`
 * 이라 오디오 바이트는 초기 JS 청크에 실리지 않고, 우리가 fetch 할 때만 별도 에셋으로 로드된다
 * (AC7 지연 로딩).
 *
 * ── 자동재생 정책 ── AudioContext 는 첫 사용자 제스처 이후에야 준비되므로(P1 ensureCtx),
 * ctx 미준비 중 요청된 존은 {@link MusicDirector.unlock} 핸드셰이크까지 큐잉한다(타이틀 메뉴곡은
 * 첫 제스처까지 지연 — AC7 명시).
 *
 * ── 밸런스 유예 ── 크로스페이드 duration / 보스존 최소 유지시간 / 스팅어 페이드는 잠정
 * 코드값이며(아래 상수) 출시 전 밸런스 패스 조정 대상이다(plan 원칙4 — 구조/배선만 확정).
 *
 * ── 테스트 안전 ── 존 전환 판정은 순수 함수({@link shouldSwitchZone})로 분리해 AudioContext
 * 없는 node 환경에서 검증한다. WebAudio 접근은 전부 null 가드 + try/catch.
 */

import type { GameAudio } from './audio.js';

/** 지속 BGM 존(스팅어는 존이 아니라 one-shot 이라 별도). */
export type MusicZone = 'menu' | 'combatPvE' | 'boss' | 'invasion';

/** 트랙 매니페스트 키(4존 + 정산 스팅어 2변종). */
export type TrackKey = MusicZone | 'stingerVictory' | 'stingerDefeat';

/** 한 트랙의 소스 파일(ogg 우선, mp3 폴백 — Safari 등 ogg 미지원 대비). */
export interface TrackSource {
  /** `assets/audio/` 내 basename(예: `bgm_menu.ogg`). */
  ogg: string;
  /** `assets/audio/` 내 basename(예: `bgm_menu.mp3`). */
  mp3: string;
}

/** 4개 지속 존(전환 순서·UI 매핑용 열거). */
export const MUSIC_ZONES: readonly MusicZone[] = ['menu', 'combatPvE', 'boss', 'invasion'];

/**
 * 존/스팅어 → 소스 파일(ogg + mp3) 매니페스트. **파일은 placeholder** — 실제 음악은 사람이
 * `assets/audio/` 에 큐레이션한다(CREDITS.md). basename 만 두고, 실 URL 은 {@link resolveAudioUrl}
 * 이 glob 으로 해석한다(없으면 null → 무음).
 */
export const TRACK_MANIFEST: Record<TrackKey, TrackSource> = {
  menu: { ogg: 'bgm_menu.ogg', mp3: 'bgm_menu.mp3' },
  combatPvE: { ogg: 'bgm_combat_pve.ogg', mp3: 'bgm_combat_pve.mp3' },
  boss: { ogg: 'bgm_boss.ogg', mp3: 'bgm_boss.mp3' },
  invasion: { ogg: 'bgm_invasion.ogg', mp3: 'bgm_invasion.mp3' },
  stingerVictory: { ogg: 'stinger_victory.ogg', mp3: 'stinger_victory.mp3' },
  stingerDefeat: { ogg: 'stinger_defeat.ogg', mp3: 'stinger_defeat.mp3' },
};

// ── 밸런스 유예 코드값(출시 전 밸런스 패스 조정 대상, plan 원칙4) ──────────────────────
/** 존 전환 equal-power 크로스페이드 길이(초). 잠정값. */
const CROSSFADE_SEC = 1.5;
/** 보스존 최소 유지시간(초) — 짧은 보스전 thrash 방지(AC4·R6). 잠정값. */
const BOSS_MIN_HOLD_SEC = 6;
/** 스팅어 재생 전 현재 존 페이드아웃 길이(초). 잠정값. */
const STINGER_FADE_SEC = 0.35;

/**
 * `assets/audio/` 의 실재 오디오 파일 URL 을 build 시 해석한다(`?url` — 바이트가 아닌 URL 문자열).
 * **실재하는 파일만** 잡히므로 placeholder 부재 시 빈 집합이라 빌드가 깨지지 않는다
 * (textures.ts 의 PNG glob 과 동일 패턴). 오디오 바이트는 초기 청크에 실리지 않고 fetch 시 로드.
 */
const AUDIO_URLS = import.meta.glob('../../assets/audio/*.{ogg,mp3}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename → 해석된 URL(없으면 null). textures.ts assetUrl 패턴. */
function resolveAudioUrl(basename: string): string | null {
  for (const key in AUDIO_URLS) {
    if (key.endsWith(`/${basename}`)) {
      const url = AUDIO_URLS[key];
      if (url !== undefined) return url;
    }
  }
  return null;
}

/** ogg 재생 가능 여부(1회 캐시). 브라우저 밖(node/테스트)에서는 true 로 가정(무해 — URL 없으면 무음). */
let oggSupport: boolean | null = null;
function canPlayOgg(): boolean {
  if (oggSupport !== null) return oggSupport;
  try {
    if (typeof document === 'undefined') {
      oggSupport = true;
      return true;
    }
    const el = document.createElement('audio');
    oggSupport = el.canPlayType('audio/ogg; codecs="vorbis"') !== '';
  } catch {
    oggSupport = true;
  }
  return oggSupport;
}

/** 존/스팅어 트랙의 최적 URL(ogg 우선, 미지원/부재면 mp3, 둘 다 없으면 null → 무음). */
function trackUrl(key: TrackKey): string | null {
  const src = TRACK_MANIFEST[key];
  const primary = canPlayOgg() ? src.ogg : src.mp3;
  const secondary = canPlayOgg() ? src.mp3 : src.ogg;
  return resolveAudioUrl(primary) ?? resolveAudioUrl(secondary);
}

/** equal-power 크로스페이드 곡선(fadeIn: sin 0→1, fadeOut: cos 1→0 — 제곱합 ≈ 1로 음량 일정). */
function equalPowerCurve(fadeIn: boolean, points = 65): Float32Array {
  const c = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const x = (t * Math.PI) / 2;
    c[i] = fadeIn ? Math.sin(x) : Math.cos(x);
  }
  return c;
}
const EQ_IN = equalPowerCurve(true);
const EQ_OUT = equalPowerCurve(false);

/**
 * 존 전환 가부 판정(순수, AC4·R6). AudioContext 없이 검증한다.
 * - 같은 존 → false(멱등).
 * - 현재 boss 존이고 진입 후 경과 < minHold → false(최소 유지 가드; 호출부가 매프레임
 *   재호출하므로 minHold 경과 후 자연 전환).
 * - 그 외 → true.
 *
 * @param current 현재 존(없으면 null — 스팅어 중/초기)
 * @param target 전환하려는 존
 * @param currentEnteredAt current 존 진입 시각(ctx.currentTime 기준, 초)
 * @param now 현재 시각(ctx.currentTime 기준, 초)
 * @param bossMinHold 보스존 최소 유지시간(초)
 */
export function shouldSwitchZone(
  current: MusicZone | null,
  target: MusicZone,
  currentEnteredAt: number,
  now: number,
  bossMinHold: number,
): boolean {
  if (current === target) return false;
  if (current === 'boss' && now - currentEnteredAt < bossMinHold) return false;
  return true;
}

/** 현재 재생 중인 트랙(소스 + 자기 게인). */
interface ActiveTrack {
  key: TrackKey;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * BGM 존 상태기계. GameAudio 와 생애주기가 전혀 달라 흡수하지 않고 분리한다(책임 분해 —
 * GameAudio=신스+버스, MusicDirector=트랙 디코드/crossfade/존 상태). `bgm` 버스 게인은
 * {@link GameAudio.getBus} 접근자로만 받는다(privates reach-in 금지).
 */
export class MusicDirector {
  private currentZone: MusicZone | null = null;
  /** currentZone 진입 시각(ctx.currentTime 기준). 보스 최소 유지 가드에 쓴다. */
  private currentEnteredAt = 0;
  /** ctx 미준비 중 요청된 존(unlock 에서 시작) 또는 스팅어 중 대기 존. */
  private pendingZone: MusicZone | null = null;
  /** 현재 재생 중인 지속 존 트랙. */
  private current: ActiveTrack | null = null;
  /** 재생 중인 정산 스팅어 트랙(one-shot). */
  private stingerTrack: ActiveTrack | null = null;
  /** 스팅어 재생 중 여부(true 면 setZone 은 큐잉만). */
  private stingerActive = false;
  /**
   * 전환 세대 카운터. 비동기 디코드가 완료됐을 때 더 최신 전환이 이미 일어났으면(gen 불일치)
   * 낡은 트랙 시작을 폐기해 경합을 막는다.
   */
  private gen = 0;

  /** 디코드된 AudioBuffer 캐시(트랙별 1회 디코드). */
  private readonly bufferCache = new Map<TrackKey, AudioBuffer>();
  /** 원시 바이트 캐시(ctx 미준비 시에도 네트워크 프리워밍 — decodeAudioData 는 버퍼를 detach 하므로 slice 사용). */
  private readonly rawCache = new Map<TrackKey, ArrayBuffer>();
  /** 진행 중 fetch 중복 제거. */
  private readonly fetching = new Map<TrackKey, Promise<ArrayBuffer | null>>();
  /** 진행 중 decode 중복 제거. */
  private readonly decoding = new Map<TrackKey, Promise<AudioBuffer | null>>();

  constructor(private readonly audio: GameAudio) {}

  /** 현재 지속 존(스팅어 중이거나 초기면 null). 호스트 관찰·테스트용. */
  getZone(): MusicZone | null {
    return this.currentZone;
  }

  /**
   * 지속 존으로 전환(멱등·최소유지 가드). ctx 미준비면 큐잉 후 {@link unlock} 에서 시작.
   * 스팅어 재생 중이면 큐잉만 하고 스팅어 종료 후 반영(AC6).
   */
  setZone(zone: MusicZone): void {
    const ctx = this.audio.getContext();
    if (ctx === null) {
      this.pendingZone = zone;
      return;
    }
    if (this.stingerActive) {
      this.pendingZone = zone;
      return;
    }
    if (!shouldSwitchZone(this.currentZone, zone, this.currentEnteredAt, ctx.currentTime, BOSS_MIN_HOLD_SEC)) {
      return;
    }
    this.crossfadeTo(zone, ctx);
  }

  /**
   * 정산 스팅어(승/패 one-shot) 재생 → 종료 후 menu 존 자동 복귀(AC6). 현재 존은 짧게
   * 페이드아웃. ctx 미준비면 재생 불가이므로 종료 후 메뉴 복귀 의도만 큐잉한다.
   */
  playStinger(variant: 'victory' | 'defeat'): void {
    const key: TrackKey = variant === 'victory' ? 'stingerVictory' : 'stingerDefeat';
    const ctx = this.audio.getContext();
    if (ctx === null) {
      this.pendingZone = 'menu';
      return;
    }
    this.gen++;
    const myGen = this.gen;
    this.stingerActive = true;
    // 진행 중이던 스팅어·지속 존 모두 페이드아웃.
    this.stopStinger(ctx);
    const prev = this.current;
    this.current = null;
    this.currentZone = null;
    if (prev !== null) this.fadeOutAndStop(prev, ctx, STINGER_FADE_SEC);
    void this.playStingerTrack(key, myGen);
  }

  /**
   * 사용자 제스처 핸드셰이크. ctx 를 확보/resume 하고, 큐잉된 존이 있으면 시작한다
   * (타이틀 메뉴곡은 여기서 처음 울린다 — 자동재생 정책).
   */
  unlock(): void {
    this.audio.unlock();
    const pending = this.pendingZone;
    if (pending === null) return;
    const ctx = this.audio.getContext();
    if (ctx === null) return; // 여전히 미준비(미지원 환경) — 큐 유지.
    this.pendingZone = null;
    this.crossfadeTo(pending, ctx);
  }

  /** 트랙을 미리 fetch(+ctx 준비 시 decode)해 캐시한다(화면 전환 직전 프리페치, AC7 옵션). */
  prefetch(zone: MusicZone): void {
    void this.loadBuffer(zone);
  }

  /** 모든 BGM 재생 정지(존/스팅어 페이드아웃). */
  stop(): void {
    const ctx = this.audio.getContext();
    this.gen++;
    this.pendingZone = null;
    this.stingerActive = false;
    if (ctx === null) {
      this.current = null;
      this.stingerTrack = null;
      this.currentZone = null;
      return;
    }
    const prev = this.current;
    this.current = null;
    this.currentZone = null;
    if (prev !== null) this.fadeOutAndStop(prev, ctx, STINGER_FADE_SEC);
    this.stopStinger(ctx);
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────────

  /** 존 크로스페이드 시작(동기 상태 갱신 + 비동기 디코드/재생). */
  private crossfadeTo(zone: MusicZone, ctx: AudioContext): void {
    this.currentZone = zone;
    this.currentEnteredAt = ctx.currentTime;
    const prev = this.current;
    this.current = null;
    this.gen++;
    const myGen = this.gen;
    // 이전 존은 즉시 페이드아웃(디코드 대기 없이 반응성 확보). superseded 콜은 prev=null 을
    // 잡으므로 이중 페이드 없음.
    if (prev !== null) this.fadeOutAndStop(prev, ctx, CROSSFADE_SEC);
    void this.startZoneTrack(zone, myGen);
  }

  /** 존 트랙 디코드 후 fade-in 재생(superseded 면 폐기, 디코드 실패면 무음). */
  private async startZoneTrack(zone: MusicZone, myGen: number): Promise<void> {
    const buffer = await this.loadBuffer(zone);
    if (this.gen !== myGen) return; // 더 최신 전환이 우선함 — 폐기.
    const ctx = this.audio.getContext();
    const bus = this.audio.getBus('bgm');
    if (buffer === null || ctx === null || bus === null) return; // 무음(placeholder 부재/미지원).
    const track = this.startSource(zone, buffer, true, ctx, bus);
    this.scheduleFade(track.gain, ctx, true, CROSSFADE_SEC);
    this.current = track;
  }

  /** 스팅어 트랙 디코드 후 one-shot 재생, 종료 시 menu 복귀(무음이면 즉시 복귀). */
  private async playStingerTrack(key: TrackKey, myGen: number): Promise<void> {
    const buffer = await this.loadBuffer(key);
    if (this.gen !== myGen) return; // 더 최신 전환이 우선함.
    const ctx = this.audio.getContext();
    const bus = this.audio.getBus('bgm');
    if (buffer === null || ctx === null || bus === null) {
      this.finishStinger(myGen);
      return;
    }
    const track = this.startSource(key, buffer, false, ctx, bus);
    track.source.onended = () => this.finishStinger(myGen);
    this.stingerTrack = track;
  }

  /** 스팅어 종료 후 처리 — pendingZone(있으면) 또는 menu 존으로 복귀. */
  private finishStinger(myGen: number): void {
    if (this.gen !== myGen) return; // 이미 다른 전환이 우선함.
    this.stingerActive = false;
    this.stingerTrack = null;
    const next: MusicZone = this.pendingZone ?? 'menu';
    this.pendingZone = null;
    const ctx = this.audio.getContext();
    if (ctx === null) {
      this.pendingZone = next; // ctx 잃으면 큐 유지.
      return;
    }
    this.crossfadeTo(next, ctx);
  }

  /** 소스+게인 생성·연결·시작(loop=지속 존 fade-in, one-shot=스팅어 full-gain). */
  private startSource(
    key: TrackKey,
    buffer: AudioBuffer,
    loop: boolean,
    ctx: AudioContext,
    bus: GainNode,
  ): ActiveTrack {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop; // 지속 존은 seamless loop(AudioBufferSourceNode — HTMLAudio 루프 갭 회피, AC7).
    const gain = ctx.createGain();
    gain.gain.value = loop ? 0 : 1; // 존은 0에서 fade-in, 스팅어는 즉시 full.
    source.connect(gain);
    gain.connect(bus);
    try {
      source.start(ctx.currentTime);
    } catch {
      // 이미 시작/컨텍스트 문제 — 무시(무음).
    }
    return { key, source, gain };
  }

  /** 트랙 페이드아웃 후 정지(equal-power cos 곡선). */
  private fadeOutAndStop(track: ActiveTrack, ctx: AudioContext, fadeSec: number): void {
    this.scheduleFade(track.gain, ctx, false, fadeSec);
    try {
      track.source.stop(ctx.currentTime + fadeSec + 0.06);
    } catch {
      // 이미 정지됨 — 무시.
    }
  }

  /** 진행 중 스팅어 정지. */
  private stopStinger(ctx: AudioContext): void {
    const s = this.stingerTrack;
    if (s === null) return;
    this.stingerTrack = null;
    s.source.onended = null;
    this.fadeOutAndStop(s, ctx, STINGER_FADE_SEC);
  }

  /** 게인에 equal-power 페이드 곡선 예약(중첩 예약 예외는 즉시 목표값 폴백). */
  private scheduleFade(gain: GainNode, ctx: AudioContext, fadeIn: boolean, fadeSec: number): void {
    const now = ctx.currentTime;
    const dur = Math.max(0.01, fadeSec);
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueCurveAtTime(fadeIn ? EQ_IN : EQ_OUT, now, dur);
    } catch {
      try {
        gain.gain.setValueAtTime(fadeIn ? 1 : 0, now);
      } catch {
        // 게인 스케줄 실패 — 무시(무음/현상 유지).
      }
    }
  }

  /** 트랙 바이트를 fetch 하고 ctx 준비 시 decode 해 캐시(중복 제거, 실패는 null). */
  private async loadBuffer(key: TrackKey): Promise<AudioBuffer | null> {
    const decoded = this.bufferCache.get(key);
    if (decoded !== undefined) return decoded;
    const inFlight = this.decoding.get(key);
    if (inFlight !== undefined) return inFlight;
    const p = (async (): Promise<AudioBuffer | null> => {
      const bytes = await this.fetchBytes(key);
      if (bytes === null) return null;
      const ctx = this.audio.getContext();
      if (ctx === null) return null; // ctx 미준비 — 바이트만 캐시, 나중에 디코드.
      try {
        return await ctx.decodeAudioData(bytes.slice(0));
      } catch {
        return null; // decode 실패 삼킴 → 무음.
      }
    })();
    this.decoding.set(key, p);
    const buffer = await p;
    this.decoding.delete(key);
    if (buffer !== null) this.bufferCache.set(key, buffer);
    return buffer;
  }

  /** 트랙 원시 바이트 fetch(중복 제거·캐시). URL 부재/fetch 실패는 null → 무음. */
  private async fetchBytes(key: TrackKey): Promise<ArrayBuffer | null> {
    const cached = this.rawCache.get(key);
    if (cached !== undefined) return cached;
    const inFlight = this.fetching.get(key);
    if (inFlight !== undefined) return inFlight;
    const p = (async (): Promise<ArrayBuffer | null> => {
      const url = trackUrl(key);
      if (url === null) return null; // placeholder 부재 — 무음.
      try {
        if (typeof fetch === 'undefined') return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.arrayBuffer();
      } catch {
        return null; // fetch 실패 삼킴 → 무음.
      }
    })();
    this.fetching.set(key, p);
    const bytes = await p;
    this.fetching.delete(key);
    if (bytes !== null) this.rawCache.set(key, bytes);
    return bytes;
  }
}
