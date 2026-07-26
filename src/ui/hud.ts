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
import type { BossProgress } from '../sim/bossProgress.js';

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
  /**
   * 보스 등장까지 남은 진행도(사용자 요청 2026-07-26). 침공 런은 세그먼트 축이 없어 undefined
   * 이고, 그때는 게이지를 아예 감춘다. 보스 진입(`bossActive`) 후에도 감춘다 — 그 자리는 보스
   * 체력바가 이어받는다.
   */
  bossEta?: BossProgress | undefined;
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
#pb-bossmeter { position:absolute; top:20px; left:50%; transform:translateX(-50%); width:640px; max-width:80vw; font-family:'Segoe UI',sans-serif; color:#fff; pointer-events:none; user-select:none; }
#pb-bossmeter .pb-etahead { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; font-weight:800; letter-spacing:1.5px; color:#ffd98a; text-shadow:0 1px 3px #000; margin-bottom:3px; }
#pb-bossmeter .pb-etapct { font-size:12px; font-weight:800; color:#ffb84c; }
#pb-bossmeter .pb-etatrack { position:relative; height:14px; background:rgba(10,8,14,.78); border:2px solid rgba(255,150,60,.65); border-radius:4px; overflow:hidden; }
#pb-bossmeter .pb-etafill { position:absolute; inset:0; width:0%; background:linear-gradient(90deg,#ff8a2a,#ffd24c); transition:width .12s linear; }
#pb-bossmeter .pb-etamark { position:absolute; top:0; bottom:0; width:2px; background:rgba(0,0,0,.55); }
#pb-bossmeter .pb-etadetail { display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#d8c9a8; margin-top:3px; text-shadow:0 1px 2px #000; }
#pb-lore { position:absolute; top:140px; left:50%; transform:translateX(-50%); max-width:80vw; background:rgba(18,24,44,.82); border:1px solid rgba(120,200,255,.55); box-shadow:0 0 18px 2px rgba(60,140,220,.35) inset; color:#dbe8ff; padding:10px 22px; border-radius:12px; font-family:'Segoe UI',system-ui,sans-serif; text-align:center; pointer-events:none; user-select:none; }
#pb-lore .pb-lore-line { font-size:14px; font-weight:600; letter-spacing:.4px; text-shadow:0 1px 3px #000; line-height:1.5; }
#pb-lore .pb-lore-line + .pb-lore-line { font-size:12px; font-weight:500; color:#a9c6ff; }
#pb-lore.pb-lore-in { animation:pb-lore-fade 5.2s ease-in-out forwards; }
@keyframes pb-lore-fade { 0%{opacity:0;transform:translate(-50%,-8px);} 8%{opacity:1;transform:translate(-50%,0);} 82%{opacity:1;transform:translate(-50%,0);} 100%{opacity:0;transform:translate(-50%,-8px);} }
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
  /** 보스 등장 예고 게이지(사용자 요청 2026-07-26). 보스전 시작 전까지만 보인다. */
  private readonly etaRoot: HTMLElement;
  private readonly etaTrack: HTMLElement;
  private readonly etaFill: HTMLElement;
  private readonly etaPct: HTMLElement;
  private readonly etaSegment: HTMLElement;
  private readonly etaGate: HTMLElement;
  /** 현재 트랙에 그려 둔 구간 눈금 수(바뀔 때만 다시 그린다). */
  private etaMarks = -1;
  /** 스토리 로어 토스트 배너(에코 안정화 등). 기본 숨김, {@link showLore} 로 잠깐 표시. */
  private readonly loreToast: HTMLElement;
  private loreTimer: ReturnType<typeof setTimeout> | null = null;

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

    // 보스 등장 예고 게이지 — 제목/퍼센트 줄 + 구간 눈금 트랙 + 상세(구간·게이트) 줄.
    this.etaRoot = document.createElement('div');
    this.etaRoot.id = 'pb-bossmeter';
    const etaHead = document.createElement('div');
    etaHead.className = 'pb-etahead';
    const etaTitle = document.createElement('span');
    etaTitle.textContent = t('hud.bossEta.title');
    this.etaPct = document.createElement('span');
    this.etaPct.className = 'pb-etapct';
    etaHead.appendChild(etaTitle);
    etaHead.appendChild(this.etaPct);
    this.etaTrack = document.createElement('div');
    this.etaTrack.className = 'pb-etatrack';
    this.etaFill = document.createElement('div');
    this.etaFill.className = 'pb-etafill';
    this.etaTrack.appendChild(this.etaFill);
    const etaDetail = document.createElement('div');
    etaDetail.className = 'pb-etadetail';
    this.etaSegment = document.createElement('span');
    this.etaGate = document.createElement('span');
    etaDetail.appendChild(this.etaSegment);
    etaDetail.appendChild(this.etaGate);
    this.etaRoot.appendChild(etaHead);
    this.etaRoot.appendChild(this.etaTrack);
    this.etaRoot.appendChild(etaDetail);
    this.etaRoot.style.display = 'none';
    document.body.appendChild(this.etaRoot);

    this.loreToast = document.createElement('div');
    this.loreToast.id = 'pb-lore';
    this.loreToast.style.display = 'none';
    document.body.appendChild(this.loreToast);
  }

  /**
   * 스토리 로어 토스트를 잠깐 띄운다(에코 안정화·파편 획득 등, 스토리 Phase E). 각 줄이 별도
   * 라인으로 표시되고 약 5초 후 자동으로 사라진다. 연달아 부르면 이전 타이머를 취소하고 재무장한다
   * (겹침 방지). 순수 표시 — sim·정산과 무관하며, 표시할 줄이 없으면 no-op.
   */
  showLore(lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.loreToast.replaceChildren();
    for (const line of lines) {
      const el = document.createElement('div');
      el.className = 'pb-lore-line';
      el.textContent = line;
      this.loreToast.appendChild(el);
    }
    this.loreToast.style.display = 'block';
    // 애니메이션 재시작(연속 호출 시 처음부터 페이드). reflow 를 강제해 클래스 재적용이 먹게 한다.
    this.loreToast.classList.remove('pb-lore-in');
    void this.loreToast.offsetWidth;
    this.loreToast.classList.add('pb-lore-in');
    if (this.loreTimer !== null) clearTimeout(this.loreTimer);
    this.loreTimer = setTimeout(() => {
      this.loreToast.style.display = 'none';
      this.loreToast.classList.remove('pb-lore-in');
      this.loreTimer = null;
    }, 5200);
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

    this.updateBossEta(s.bossEta);
  }

  /**
   * 보스 등장 예고 게이지를 갱신한다. 보스전이 시작됐거나(bossActive) 세그먼트 축이 없는 런
   * (침공)이면 감춘다 — 그 자리는 보스 체력바가 이어받는다. 순수 표시(값 파생은 sim/bossProgress).
   */
  private updateBossEta(eta: BossProgress | undefined): void {
    if (eta === undefined || eta.bossActive) {
      this.etaRoot.style.display = 'none';
      return;
    }
    this.etaRoot.style.display = 'block';

    // 구간 눈금: 구간 경계마다 한 줄(마지막 경계 = 보스라 트랙 끝이므로 그리지 않는다).
    if (this.etaMarks !== eta.totalSegments) {
      for (const m of [...this.etaTrack.querySelectorAll('.pb-etamark')]) m.remove();
      for (let i = 1; i < eta.totalSegments; i++) {
        const m = document.createElement('div');
        m.className = 'pb-etamark';
        m.style.left = `${(i / eta.totalSegments) * 100}%`;
        this.etaTrack.appendChild(m);
      }
      this.etaMarks = eta.totalSegments;
    }

    this.etaFill.style.width = `${eta.frac * 100}%`;
    this.etaPct.textContent = `${Math.floor(eta.frac * 100)}%`;
    this.etaSegment.textContent = t('hud.bossEta.segment', {
      n: eta.segment,
      total: eta.totalSegments,
    });
    this.etaGate.textContent =
      eta.gate === 'kills'
        ? t('hud.bossEta.kills', { n: eta.current, goal: eta.goal })
        : t(`hud.bossEta.${eta.gate}` as const);
  }
}
