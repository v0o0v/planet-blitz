/**
 * Title screen + tutorial (FTUE) overlays (DOM — M3 Phase E1, plan §4, AC8;
 * GDD §12).
 *
 * First launch flow: 타이틀 → (입력) → 즉시 튜토리얼 런 → 첫 드랍 → 기지 공개. The
 * tutorial run reuses the homeworld-orbit content (planet 0 카르곤 / tier 0 정찰) at
 * a FIXED seed so it is fully deterministic (a scripted first impression). Scripted
 * hints are a render-only overlay layered over the live run — they never touch the
 * simulation. The tutorial is forced exactly once (OQ-M3-7); afterwards the title's
 * start button drops straight into the base map and the run is skippable.
 *
 * FTUE instrumentation (AC8 / 게이트 ①): {@link FtueTracker} logs the time from the
 * start input to combat entry (must be < 60s) and to the first drop (< 4min) so the
 * gate can be measured from the console.
 */

import { t } from '../i18n/index.js';

/** Fixed tutorial run seed — deterministic first impression (ADR-0005 spirit). */
export const TUTORIAL_SEED = 0x7b1a2c3d;
/** Tutorial content: homeworld orbit (카르곤) at the standard 정찰 tier. */
export const TUTORIAL_PLANET = 0;
export const TUTORIAL_TIER = 0;
/**
 * 튜토리얼 단축판(GDD §12 "3~4분 단축판"): 일반 세그먼트 3개(45s×3) 후 곧장 보스
 * 세그먼트로 점프 — 보스전 포함 약 3~4분. sim의 config.maxSegments로 전달된다.
 */
export const TUTORIAL_MAX_SEGMENTS = 3;

// ---------------------------------------------------------------------------
// FTUE instrumentation (AC8, 게이트 ①)
// ---------------------------------------------------------------------------

/** Logs the FTUE timing gates from the start input. Render/meta only. */
export class FtueTracker {
  private inputAt = 0;
  private combatLogged = false;
  private dropLogged = false;

  /** Stamp the moment the pilot pressed 시작 (the 60s clock starts here). */
  markInput(): void {
    this.inputAt = now();
    this.combatLogged = false;
    this.dropLogged = false;
  }

  /** Combat entry (the tutorial run began). */
  markCombat(): void {
    if (this.inputAt === 0 || this.combatLogged) return;
    this.combatLogged = true;
    const s = (now() - this.inputAt) / 1000;
    console.info(`[FTUE] 입력→전투 진입: ${s.toFixed(2)}s (목표 <60s) ${s < 60 ? '✅' : '⚠️'}`);
  }

  /** First drop collected in the tutorial run. */
  markFirstDrop(): void {
    if (this.inputAt === 0 || this.dropLogged) return;
    this.dropLogged = true;
    const s = (now() - this.inputAt) / 1000;
    console.info(`[FTUE] 입력→첫 드랍: ${s.toFixed(2)}s (목표 <240s) ${s < 240 ? '✅' : '⚠️'}`);
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ---------------------------------------------------------------------------
// Title screen
// ---------------------------------------------------------------------------

const TITLE_STYLE = `
#pb-title { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; background:radial-gradient(circle at 50% 32%,#0b1730,#03050c 70%); font-family:'Segoe UI',system-ui,sans-serif; z-index:26; }
#pb-title .pb-logo { color:#7affea; font-size:52px; font-weight:900; letter-spacing:6px; text-shadow:0 4px 20px rgba(76,215,255,.4); }
#pb-title .pb-tag { color:#8896b8; font-size:15px; letter-spacing:1px; margin-top:-6px; }
#pb-title .pb-start { pointer-events:auto; cursor:pointer; margin-top:16px; padding:15px 56px; font-size:19px; font-weight:900; letter-spacing:2px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:12px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-title .pb-start:hover { transform:translateY(-2px); box-shadow:0 8px 28px rgba(76,215,255,.45); }
#pb-title .pb-note { color:#68789c; font-size:12px; margin-top:8px; }
`;

export class TitleScreen {
  private readonly root: HTMLElement;

  constructor() {
    const style = document.createElement('style');
    style.textContent = TITLE_STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-title';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** @param firstRun true = start button launches the forced tutorial run. */
  show(opts: { firstRun: boolean; onStart: () => void }): void {
    this.root.innerHTML = '';
    const logo = document.createElement('div');
    logo.className = 'pb-logo';
    logo.textContent = 'PLANET BLITZ';
    this.root.appendChild(logo);
    const tag = document.createElement('div');
    tag.className = 'pb-tag';
    tag.textContent = t('title.tag');
    this.root.appendChild(tag);

    const btn = document.createElement('button');
    btn.className = 'pb-start';
    btn.textContent = opts.firstRun ? t('title.startTutorial') : t('title.enterBase');
    btn.addEventListener('click', () => {
      this.hide();
      opts.onStart();
    });
    this.root.appendChild(btn);

    if (opts.firstRun) {
      const note = document.createElement('div');
      note.className = 'pb-note';
      note.textContent = t('title.note');
      this.root.appendChild(note);
    }

    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Tutorial hint overlay (render-only, layered over the live run)
// ---------------------------------------------------------------------------

/** Scripted hints keyed to the run's elapsed seconds (render-only, i18n key). */
const HINTS: readonly { fromSec: number; key: 'tutorial.hint0' | 'tutorial.hint1' | 'tutorial.hint2' | 'tutorial.hint3' }[] = [
  { fromSec: 0, key: 'tutorial.hint0' },
  { fromSec: 6, key: 'tutorial.hint1' },
  { fromSec: 14, key: 'tutorial.hint2' },
  { fromSec: 24, key: 'tutorial.hint3' },
];

const TUT_STYLE = `
#pb-tut { position:absolute; left:50%; top:18px; transform:translateX(-50%); z-index:23; pointer-events:none; max-width:560px; padding:12px 22px; background:rgba(6,10,22,.82); border:1px solid #33507a; border-radius:12px; box-shadow:0 6px 24px rgba(0,0,0,.5); font-family:'Segoe UI',system-ui,sans-serif; text-align:center; }
#pb-tut .pb-th { color:#7affea; font-size:12px; font-weight:800; letter-spacing:2px; margin-bottom:3px; }
#pb-tut .pb-tt { color:#e8ecff; font-size:15px; font-weight:600; }
`;

export class TutorialOverlay {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private dropSeen = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = TUT_STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-tut';
    this.root.style.display = 'none';
    this.title = document.createElement('div');
    this.title.className = 'pb-th';
    this.title.textContent = t('tutorial.label');
    this.body = document.createElement('div');
    this.body.className = 'pb-tt';
    this.root.appendChild(this.title);
    this.root.appendChild(this.body);
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(): void {
    this.dropSeen = false;
    this.body.textContent = HINTS[0] !== undefined ? t(HINTS[0].key) : '';
    this.root.style.display = 'block';
  }

  /**
   * Advance the scripted hint for the current run time. Once a drop has appeared
   * the overlay latches onto the drop message.
   * @param tick sim tick (60 Hz); @param hasDrop true once loot exists this run.
   */
  update(tick: number, hasDrop: boolean): void {
    if (!this.visible) return;
    if (hasDrop) this.dropSeen = true;
    if (this.dropSeen) {
      this.body.textContent = t('tutorial.drop');
      return;
    }
    const sec = tick / 60;
    let text = HINTS[0] !== undefined ? t(HINTS[0].key) : '';
    for (const h of HINTS) {
      if (sec >= h.fromSec) text = t(h.key);
    }
    this.body.textContent = text;
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
