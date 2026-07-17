/**
 * 리플레이 관전(F3, AC10) — 침공당한 리플레이를 렌더와 함께 재생하는 관전 오버레이.
 *
 * 하네스 fast-forward(headless·즉시)와 달리 **실시간 재생**이다. main.ts 가 침공/PvE 런과
 * 동일한 고정 timestep 루프에 리플레이 입력을 주입해 결정론 재실행하고, 이 오버레이는
 * 재생/일시정지·배속(1/2/4)·종료의 최소 컨트롤과 진행률만 담당한다(렌더 전용).
 *
 * 무결성: 관전 월드는 진입 즉시 `markTainted` 되어(main) 정산·서버 제출 대상에서 빠진다
 * (기존 하네스 오염 런 패턴 — ADR-0008). sim 무수정, 순수 렌더 재생이다.
 *
 * 이 파일의 순수 로직(리플레이 shape 검증·진행 라벨)은 DOM 무관이라 단위 테스트 대상이다.
 */

import type { Replay } from '../sim/replay.js';

// ---------------------------------------------------------------------------
// 순수 로직 (테스트 대상 — DOM 무관)
// ---------------------------------------------------------------------------

/**
 * 서버에서 받은 리플레이가 재생 가능한 shape 인지 검증(순수). 검증된 침공의 리플레이라
 * 신뢰하되, jsonb 왕복으로 손상됐을 수 있어 재실행 전 최소 형태를 확인한다:
 *   - seed 가 유한한 수
 *   - inputs 가 비어 있지 않은 배열
 * config 는 선택(부재 시 DEFAULT_CONFIG). 실패하면 관전 진입을 막고 안내한다.
 */
export function isPlayableReplay(replay: unknown): replay is Replay {
  if (typeof replay !== 'object' || replay === null) return false;
  const r = replay as Record<string, unknown>;
  if (typeof r.seed !== 'number' || !Number.isFinite(r.seed)) return false;
  if (!Array.isArray(r.inputs) || r.inputs.length === 0) return false;
  return true;
}

/** 배속 사이클(1 → 2 → 4 → 1). 관전 UI 의 배속 버튼이 순환한다. */
export type SpectateSpeed = 1 | 2 | 4;
export function nextSpectateSpeed(speed: SpectateSpeed): SpectateSpeed {
  return speed === 1 ? 2 : speed === 2 ? 4 : 1;
}

/** 진행 라벨("1:23 / 4:00" 형식, 60fps 기준 초 환산). total 0 이면 "0:00 / 0:00". */
export function spectateProgressLabel(tick: number, total: number): string {
  const fmt = (t: number): string => {
    const sec = Math.max(0, Math.floor(t / 60));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  return `${fmt(tick)} / ${fmt(total)}`;
}

/** 진행률 0..1(클램프). total 0 이면 0. */
export function spectateFraction(tick: number, total: number): number {
  if (total <= 0) return 0;
  const f = tick / total;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// ---------------------------------------------------------------------------
// DOM 오버레이
// ---------------------------------------------------------------------------

const STYLE = `
#pb-spec { position:absolute; left:0; right:0; bottom:0; display:flex; flex-direction:column; align-items:center; gap:8px; padding:12px 16px 18px; box-sizing:border-box; pointer-events:none; z-index:31; font-family:'Segoe UI',system-ui,sans-serif; }
#pb-spec .pb-spec-title { pointer-events:none; color:#c3cdea; font-size:12px; font-weight:700; text-shadow:0 1px 3px #000; }
#pb-spec .pb-spec-title b { color:#c86aff; }
#pb-spec .pb-spec-bar { pointer-events:none; width:min(560px,86vw); height:6px; border-radius:4px; background:rgba(20,24,44,.8); border:1px solid #2a3552; overflow:hidden; }
#pb-spec .pb-spec-fill { height:100%; width:0%; background:linear-gradient(90deg,#c86aff,#7affea); transition:width .08s linear; }
#pb-spec .pb-spec-ctrls { pointer-events:auto; display:flex; align-items:center; gap:8px; background:rgba(12,14,30,.86); border:1px solid #2a3552; border-radius:12px; padding:7px 12px; }
#pb-spec .pb-spec-ctrls button { pointer-events:auto; cursor:pointer; padding:6px 12px; font-size:13px; font-weight:800; color:#150a24; background:linear-gradient(90deg,#c86aff,#7affea); border:none; border-radius:8px; min-width:52px; }
#pb-spec .pb-spec-ctrls button.ghost { color:#aab6d6; background:rgba(20,24,44,.9); border:1px solid #2a3552; }
#pb-spec .pb-spec-time { pointer-events:none; color:#8fd94c; font-size:12px; font-weight:700; min-width:96px; text-align:center; font-variant-numeric:tabular-nums; }
`;

/** 관전 오버레이 콜백(main 이 재생 상태를 구동). */
export interface SpectateCallbacks {
  /** 재생/일시정지 토글. */
  onTogglePlay: () => void;
  /** 배속 순환(1→2→4→1). */
  onCycleSpeed: () => void;
  /** 관전 종료(관제탑으로 복귀). */
  onExit: () => void;
}

/** show() 옵션. */
export interface SpectateShowOpts {
  /** 총 틱 수(진행바 분모). */
  total: number;
  /** 관전 대상 표시명(배너 문구). */
  targetName: string;
}

/** 관전 컨트롤 오버레이(재생/배속/종료 + 진행률). 렌더 전용. */
export class SpectateOverlay {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private total = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-spec';
    this.root.style.display = 'none';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'pb-spec-title';

    const bar = document.createElement('div');
    bar.className = 'pb-spec-bar';
    this.fillEl = document.createElement('div');
    this.fillEl.className = 'pb-spec-fill';
    bar.appendChild(this.fillEl);

    const ctrls = document.createElement('div');
    ctrls.className = 'pb-spec-ctrls';
    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '⏸ 일시정지';
    this.speedBtn = document.createElement('button');
    this.speedBtn.className = 'ghost';
    this.speedBtn.textContent = '1x';
    this.timeEl = document.createElement('div');
    this.timeEl.className = 'pb-spec-time';
    this.timeEl.textContent = '0:00 / 0:00';
    const exitBtn = document.createElement('button');
    exitBtn.className = 'ghost';
    exitBtn.textContent = '종료';
    ctrls.append(this.playBtn, this.speedBtn, this.timeEl, exitBtn);

    this.root.append(this.titleEl, bar, ctrls);
    document.body.appendChild(this.root);

    // 콜백은 show() 에서 바인딩(재진입 안전하도록 핸들러를 매번 교체).
    this.playBtn.addEventListener('click', () => this.cb?.onTogglePlay());
    this.speedBtn.addEventListener('click', () => this.cb?.onCycleSpeed());
    exitBtn.addEventListener('click', () => this.cb?.onExit());
  }

  private cb: SpectateCallbacks | null = null;

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(cb: SpectateCallbacks, opts: SpectateShowOpts): void {
    this.cb = cb;
    this.total = opts.total;
    const who = opts.targetName.length > 0 ? opts.targetName : '상대 기지';
    this.titleEl.innerHTML = `<b>관전</b> — ${escapeHtml(who)} 침공 리플레이 (렌더 전용·기록에 영향 없음)`;
    this.update({ tick: 0, playing: true, speed: 1, ended: false });
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.cb = null;
  }

  /** 매 프레임 재생 상태를 반영(진행바·시간·버튼 라벨). */
  update(state: { tick: number; playing: boolean; speed: SpectateSpeed; ended: boolean }): void {
    this.fillEl.style.width = `${(spectateFraction(state.tick, this.total) * 100).toFixed(1)}%`;
    this.timeEl.textContent = spectateProgressLabel(state.tick, this.total);
    this.speedBtn.textContent = `${state.speed}x`;
    if (state.ended) {
      this.playBtn.textContent = '⟲ 처음부터';
    } else {
      this.playBtn.textContent = state.playing ? '⏸ 일시정지' : '▶ 재생';
    }
  }
}

/** 최소 HTML 이스케이프(표시명 주입 방지 — 표시명은 서버 유래 문자열). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
