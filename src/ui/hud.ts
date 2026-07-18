/**
 * DOM HUD overlay (ADR-0001: RPG/UI is DOM, not canvas).
 *
 * M1 Phase 3 HUD: HP bar, XP/level bar, run timer, combo multiplier, and a boss
 * health bar with phase markers + overheat indicator. The debug telemetry line
 * (`set`) from Phase 1 is kept for development and reused by the bench scene.
 *
 * The HUD is a pure view: `update` is called each frame with a plain snapshot of
 * numbers pulled from sim state — it never touches the simulation itself.
 */

import { t } from '../i18n/index.js';

export interface BossHudState {
  hp: number;
  maxHp: number;
  /** Phase index 0/1/2. */
  phase: number;
  /** Overheat window open (takes double damage). */
  overheat: boolean;
  /** Phase-transition animation in progress. */
  transitioning: boolean;
}

export interface HudState {
  hp: number;
  maxHp: number;
  xp: number;
  xpNeed: number;
  level: number;
  timeSec: number;
  combo: number;
  multiplier: number;
  /** Present only during the boss fight. */
  boss?: BossHudState | undefined;
  /** A supply raider is currently on screen. */
  supplyActive: boolean;
}

function bar(label: string, colorClass: string): { root: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'pb-bar';
  const track = document.createElement('div');
  track.className = 'pb-track';
  const fill = document.createElement('div');
  fill.className = `pb-fill ${colorClass}`;
  const text = document.createElement('div');
  text.className = 'pb-bartext';
  track.appendChild(fill);
  track.appendChild(text);
  const lbl = document.createElement('div');
  lbl.className = 'pb-label';
  lbl.textContent = label;
  root.appendChild(lbl);
  root.appendChild(track);
  return { root, fill, text };
}

const STYLE = `
#pb-hud { position:absolute; left:16px; bottom:16px; width:340px; font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecff; pointer-events:none; user-select:none; }
#pb-hud .pb-bar { display:flex; align-items:center; gap:8px; margin:4px 0; }
#pb-hud .pb-label { width:34px; font-size:11px; font-weight:700; letter-spacing:.5px; text-shadow:0 1px 2px #000; }
#pb-hud .pb-track { position:relative; flex:1; height:16px; background:rgba(8,10,20,.75); border:1px solid rgba(255,255,255,.15); border-radius:8px; overflow:hidden; }
#pb-hud .pb-fill { position:absolute; inset:0; width:0%; border-radius:8px 0 0 8px; transition:width .08s linear; }
#pb-hud .pb-fill.hp { background:linear-gradient(90deg,#ff5566,#ff8899); }
#pb-hud .pb-fill.xp { background:linear-gradient(90deg,#4cd7ff,#7affea); }
#pb-hud .pb-bartext { position:relative; z-index:1; text-align:center; line-height:16px; font-size:11px; font-weight:600; text-shadow:0 1px 2px #000; }
#pb-hud .pb-topline { display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:6px; text-shadow:0 1px 3px #000; }
#pb-hud .pb-combo { color:#ffd24c; }
#pb-supply { position:absolute; top:96px; left:50%; transform:translateX(-50%); background:rgba(255,180,40,.14); border:1px solid #ffcc44; color:#ffd98a; padding:6px 18px; border-radius:20px; font:700 15px 'Segoe UI',sans-serif; letter-spacing:1px; pointer-events:none; text-shadow:0 1px 2px #000; }
#pb-boss { position:absolute; top:20px; left:50%; transform:translateX(-50%); width:640px; max-width:80vw; font-family:'Segoe UI',sans-serif; color:#fff; pointer-events:none; text-align:center; }
#pb-boss .pb-bossname { font-size:14px; font-weight:800; letter-spacing:2px; text-shadow:0 1px 3px #000; margin-bottom:4px; }
#pb-boss .pb-bosstrack { position:relative; height:20px; background:rgba(10,5,8,.8); border:2px solid #ff6a3c; border-radius:4px; overflow:hidden; }
#pb-boss .pb-bossfill { position:absolute; inset:0; width:100%; background:linear-gradient(90deg,#ff3020,#ff7a1a); transition:width .1s linear; }
#pb-boss .pb-bossfill.overheat { background:linear-gradient(90deg,#ffdd44,#ff5522); box-shadow:0 0 16px 4px rgba(255,120,20,.8) inset; }
#pb-boss .pb-bossmark { position:absolute; top:0; bottom:0; width:2px; background:rgba(255,255,255,.7); }
#pb-boss .pb-bossmsg { font-size:12px; font-weight:700; color:#ffd98a; margin-top:3px; height:14px; text-shadow:0 1px 2px #000; }
`;

export class Hud {
  private readonly el: HTMLElement;
  private readonly root: HTMLElement;
  private readonly topline: HTMLElement;
  private readonly hpBar: ReturnType<typeof bar>;
  private readonly xpBar: ReturnType<typeof bar>;
  private readonly comboEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly supplyBanner: HTMLElement;
  private readonly bossRoot: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossMsg: HTMLElement;

  constructor(elementId = 'hud') {
    const el = document.getElementById(elementId);
    if (el === null) throw new Error(`HUD element #${elementId} not found`);
    this.el = el;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-hud';
    this.topline = document.createElement('div');
    this.topline.className = 'pb-topline';
    this.timeEl = document.createElement('span');
    this.comboEl = document.createElement('span');
    this.comboEl.className = 'pb-combo';
    this.topline.appendChild(this.timeEl);
    this.topline.appendChild(this.comboEl);
    this.hpBar = bar('HP', 'hp');
    this.xpBar = bar('LV', 'xp');
    this.root.appendChild(this.topline);
    this.root.appendChild(this.hpBar.root);
    this.root.appendChild(this.xpBar.root);
    document.body.appendChild(this.root);

    this.supplyBanner = document.createElement('div');
    this.supplyBanner.id = 'pb-supply';
    this.supplyBanner.textContent = t('hud.supplyRaid');
    this.supplyBanner.style.display = 'none';
    document.body.appendChild(this.supplyBanner);

    this.bossRoot = document.createElement('div');
    this.bossRoot.id = 'pb-boss';
    this.bossName = document.createElement('div');
    this.bossName.className = 'pb-bossname';
    this.bossName.textContent = '카르곤 · 용암 요새 전차';
    const track = document.createElement('div');
    track.className = 'pb-bosstrack';
    this.bossFill = document.createElement('div');
    this.bossFill.className = 'pb-bossfill';
    track.appendChild(this.bossFill);
    // Phase markers at 35% and 70%.
    for (const pct of [35, 70]) {
      const m = document.createElement('div');
      m.className = 'pb-bossmark';
      m.style.left = `${pct}%`;
      track.appendChild(m);
    }
    this.bossMsg = document.createElement('div');
    this.bossMsg.className = 'pb-bossmsg';
    this.bossRoot.appendChild(this.bossName);
    this.bossRoot.appendChild(track);
    this.bossRoot.appendChild(this.bossMsg);
    this.bossRoot.style.display = 'none';
    document.body.appendChild(this.bossRoot);
  }

  /** Debug telemetry line (kept from Phase 1; also used by the bench scene). */
  set(text: string): void {
    this.el.textContent = text;
  }

  update(s: HudState): void {
    const hpPct = s.maxHp > 0 ? Math.max(0, (s.hp / s.maxHp) * 100) : 0;
    this.hpBar.fill.style.width = `${hpPct}%`;
    this.hpBar.text.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;

    const xpPct = s.xpNeed > 0 ? Math.min(100, (s.xp / s.xpNeed) * 100) : 0;
    this.xpBar.fill.style.width = `${xpPct}%`;
    this.xpBar.text.textContent = `Lv ${s.level}  ·  ${s.xp}/${s.xpNeed}`;

    const m = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    this.timeEl.textContent = `⏱ ${m}:${sec.toString().padStart(2, '0')}`;
    this.comboEl.textContent =
      s.combo > 0 ? t('hud.combo', { mult: s.multiplier.toFixed(2), combo: s.combo }) : '';

    this.supplyBanner.style.display = s.supplyActive ? 'block' : 'none';

    if (s.boss !== undefined) {
      this.bossRoot.style.display = 'block';
      const pct = s.boss.maxHp > 0 ? Math.max(0, (s.boss.hp / s.boss.maxHp) * 100) : 0;
      this.bossFill.style.width = `${pct}%`;
      this.bossFill.className = `pb-bossfill${s.boss.overheat ? ' overheat' : ''}`;
      this.bossMsg.textContent = s.boss.transitioning
        ? t('hud.phaseTransition', { n: s.boss.phase + 1 })
        : s.boss.overheat
          ? t('hud.overheat')
          : t('hud.phase', { n: s.boss.phase + 1 });
    } else {
      this.bossRoot.style.display = 'none';
    }
  }
}
