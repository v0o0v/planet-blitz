/**
 * Star-map / planet-select overlay (DOM — M2 Phase D3, plan §4, AC8/AC9/AC10).
 *
 * The pre-run screen: pick a planet (data-driven from data/planets.ts), a tier
 * (정찰/교전), and — when the seed offers one — accept or reject the run's anomaly
 * (OQ-M2-3: chosen before the run, carried as a config flag so the sim stays a
 * function of [seed + inputs + config]). "출격" hands a `LaunchSelection` back to
 * the caller, which assembles the WorldConfig (planet/tier/anomaly + loadout).
 *
 * Pure view: no sim import at runtime beyond the anomaly kind CONSTANTS (numbers)
 * used to label the offer. Never touches the simulation.
 */

import { PLANETS, TIERS, planetById } from '../../data/planets.js';
import { canEnterTier, ANNIHILATION_UNLOCK_LEVEL } from '../../data/waves.js';
import { ANOMALY_GRAVITY, ANOMALY_SWARM, ANOMALY_NEBULA, ANOMALY_NONE } from '../sim/anomaly.js';

/** What the player chose on the star map. */
export interface LaunchSelection {
  planet: number;
  tier: number;
  /** Whether the offered anomaly was accepted (false when none offered). */
  anomalyAccepted: boolean;
  /** 보스 이전 일반 세그먼트 수 상한(튜토리얼 단축판). absent = 풀 런. */
  maxSegments?: number;
}

/** Human-readable anomaly labels (render-only). */
const ANOMALY_LABEL: Record<number, { name: string; desc: string }> = {
  [ANOMALY_GRAVITY]: { name: '중력 폭풍', desc: '적 탄속 ↓ · 드랍률 +50%' },
  [ANOMALY_SWARM]: { name: '군체 대발생', desc: '적 수 ×2 · 개체 약화' },
  [ANOMALY_NEBULA]: { name: '암흑 성운', desc: '시야 ↓ · 유니크 드랍 ×2' },
};

const STYLE = `
#pb-planet { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; background:radial-gradient(circle at 50% 30%,#0a1226,#03050c 70%); font-family:'Segoe UI',system-ui,sans-serif; z-index:25; overflow:auto; }
#pb-planet h1 { margin:0; color:#7affea; font-size:30px; font-weight:900; letter-spacing:3px; text-shadow:0 3px 12px #000; }
#pb-planet .pb-subtitle { color:#8896b8; font-size:14px; margin-top:-8px; }
#pb-planet .pb-planets { display:flex; gap:20px; }
#pb-planet .pb-planet-card { width:230px; padding:20px; background:linear-gradient(160deg,#131a2e,#0b1020); border:2px solid #2a3552; border-radius:16px; cursor:pointer; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease; }
#pb-planet .pb-planet-card:hover { transform:translateY(-4px); }
#pb-planet .pb-planet-card.sel { border-color:#4cd7ff; box-shadow:0 8px 28px rgba(76,215,255,.3); }
#pb-planet .pb-orb { width:88px; height:88px; margin:0 auto 12px; border-radius:50%; box-shadow:0 0 30px 4px rgba(0,0,0,.5) inset, 0 0 22px 2px currentColor; }
#pb-planet .pb-planet-name { color:#fff; font-size:20px; font-weight:800; }
#pb-planet .pb-planet-sub { color:#aab6d6; font-size:13px; margin-top:6px; }
#pb-planet .pb-row { display:flex; gap:10px; align-items:center; }
#pb-planet .pb-seg { display:flex; gap:8px; }
#pb-planet .pb-seg button { pointer-events:auto; cursor:pointer; padding:8px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:10px; transition:all .1s ease; }
#pb-planet .pb-seg button.sel { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border-color:transparent; }
#pb-planet .pb-seg button.locked { opacity:.45; cursor:not-allowed; border-style:dashed; }
#pb-planet .pb-tierdesc { color:#8896b8; font-size:12px; min-height:16px; }
#pb-planet .pb-anomaly { display:flex; flex-direction:column; align-items:center; gap:8px; background:rgba(40,16,50,.5); border:1px solid #6a3a7a; border-radius:14px; padding:14px 22px; }
#pb-planet .pb-anomaly .pb-atitle { color:#e6a8ff; font-weight:800; letter-spacing:1px; }
#pb-planet .pb-anomaly .pb-adesc { color:#c9b6d6; font-size:13px; }
#pb-planet .pb-anomaly .pb-seg button.sel { background:linear-gradient(90deg,#c86aff,#e6a8ff); }
#pb-planet .pb-launch { pointer-events:auto; cursor:pointer; margin-top:6px; padding:13px 46px; font-size:17px; font-weight:900; letter-spacing:2px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:12px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-planet .pb-launch:hover { transform:translateY(-2px); box-shadow:0 8px 26px rgba(76,215,255,.4); }
#pb-planet .pb-meta { color:#68789c; font-size:12px; }
#pb-planet .pb-inv-btn { pointer-events:auto; cursor:pointer; padding:9px 20px; font-size:13px; font-weight:700; color:#aab6d6; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:10px; }
#pb-planet .pb-inv-btn:hover { border-color:#4cd7ff; color:#fff; }
`;

/** Active-ship level required for the 섬멸 tier (surfaced as a lock reason). */
const ANNIHILATION_LEVEL = ANNIHILATION_UNLOCK_LEVEL;

export class PlanetSelect {
  private readonly root: HTMLElement;
  private planet = 0;
  private tier = 0;
  private anomalyKind = ANOMALY_NONE;
  private anomalyAccepted = false;
  /** Active-ship level — gates the 섬멸 tier (canEnterTier). */
  private level = 1;
  private onLaunch: ((sel: LaunchSelection) => void) | null = null;
  private onInventory: (() => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-planet';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Show the star map for an upcoming run.
   * @param anomalyOffered the anomaly kind the seed rolled (ANOMALY_NONE = none).
   * @param meta a short status line (credits / active ship level).
   */
  show(
    opts: {
      anomalyOffered: number;
      meta: string;
      /** Active-ship level (gates the 섬멸 tier). Defaults to 1 when omitted. */
      level?: number;
      onLaunch: (sel: LaunchSelection) => void;
      onInventory: () => void;
      /** Optional "back to base map" affordance (plan D1 왕복 동선). */
      onBack?: () => void;
    },
  ): void {
    this.anomalyKind = opts.anomalyOffered;
    this.anomalyAccepted = false;
    this.level = opts.level ?? 1;
    // Keep the selected tier valid for this level (a demotion clamps 섬멸 away).
    if (!canEnterTier(this.tier, this.level)) this.tier = 0;
    this.onLaunch = opts.onLaunch;
    this.onInventory = opts.onInventory;
    this.onBack = opts.onBack ?? null;
    this.render(opts.meta);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onLaunch = null;
    this.onInventory = null;
    this.onBack = null;
  }

  private render(meta: string): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = '성계 지도 — 출격 준비';
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-subtitle';
    sub.textContent = '행성과 작전 강도를 선택하라.';
    this.root.appendChild(sub);

    // Planet cards.
    const planets = document.createElement('div');
    planets.className = 'pb-planets';
    for (const p of PLANETS) {
      const card = document.createElement('div');
      card.className = `pb-planet-card${p.id === this.planet ? ' sel' : ''}`;
      const orb = document.createElement('div');
      orb.className = 'pb-orb';
      orb.style.color = p.accent;
      orb.style.background = `radial-gradient(circle at 35% 30%, ${p.accent}, #05060a)`;
      const name = document.createElement('div');
      name.className = 'pb-planet-name';
      name.textContent = p.name;
      const psub = document.createElement('div');
      psub.className = 'pb-planet-sub';
      psub.textContent = p.subtitle;
      card.appendChild(orb);
      card.appendChild(name);
      card.appendChild(psub);
      card.addEventListener('click', () => {
        this.planet = p.id;
        this.render(meta);
      });
      planets.appendChild(card);
    }
    this.root.appendChild(planets);

    // Tier segmented control.
    const tierRow = document.createElement('div');
    tierRow.className = 'pb-row';
    const tierLabel = document.createElement('span');
    tierLabel.className = 'pb-meta';
    tierLabel.textContent = '작전 강도';
    const seg = document.createElement('div');
    seg.className = 'pb-seg';
    for (const t of TIERS) {
      const unlocked = canEnterTier(t.id, this.level);
      const b = document.createElement('button');
      b.className = `${t.id === this.tier ? 'sel' : ''}${unlocked ? '' : ' locked'}`.trim();
      b.textContent = unlocked ? t.name : `🔒 ${t.name}`;
      b.addEventListener('click', () => {
        if (!canEnterTier(t.id, this.level)) return; // locked: keep current selection
        this.tier = t.id;
        this.render(meta);
      });
      seg.appendChild(b);
    }
    tierRow.appendChild(tierLabel);
    tierRow.appendChild(seg);
    this.root.appendChild(tierRow);
    const tierDesc = document.createElement('div');
    tierDesc.className = 'pb-tierdesc';
    const selTier = TIERS.find((t) => t.id === this.tier);
    // Show the lock reason for any tier that is gated at the current level.
    const lockedTier = TIERS.find((t) => !canEnterTier(t.id, this.level));
    tierDesc.textContent =
      lockedTier !== undefined
        ? `${selTier?.desc ?? ''}   ·   🔒 ${lockedTier.name}: 기체 Lv ${ANNIHILATION_LEVEL} 필요 (현재 Lv ${this.level})`
        : (selTier?.desc ?? '');
    this.root.appendChild(tierDesc);

    // Anomaly offer (only when the seed rolled one).
    if (this.anomalyKind !== ANOMALY_NONE) {
      const info = ANOMALY_LABEL[this.anomalyKind];
      const box = document.createElement('div');
      box.className = 'pb-anomaly';
      const atitle = document.createElement('div');
      atitle.className = 'pb-atitle';
      atitle.textContent = `⚠ 변칙 경보: ${info?.name ?? '알 수 없음'}`;
      const adesc = document.createElement('div');
      adesc.className = 'pb-adesc';
      adesc.textContent = info?.desc ?? '';
      const achoice = document.createElement('div');
      achoice.className = 'pb-seg';
      const accept = document.createElement('button');
      accept.className = this.anomalyAccepted ? 'sel' : '';
      accept.textContent = '수락';
      accept.addEventListener('click', () => {
        this.anomalyAccepted = true;
        this.render(meta);
      });
      const reject = document.createElement('button');
      reject.className = !this.anomalyAccepted ? 'sel' : '';
      reject.textContent = '거부';
      reject.addEventListener('click', () => {
        this.anomalyAccepted = false;
        this.render(meta);
      });
      achoice.appendChild(accept);
      achoice.appendChild(reject);
      box.appendChild(atitle);
      box.appendChild(adesc);
      box.appendChild(achoice);
      this.root.appendChild(box);
    }

    // Actions.
    const actions = document.createElement('div');
    actions.className = 'pb-row';
    if (this.onBack !== null) {
      const backBtn = document.createElement('button');
      backBtn.className = 'pb-inv-btn';
      backBtn.textContent = '◀ 기지로';
      backBtn.addEventListener('click', () => {
        const cb = this.onBack;
        this.hide();
        cb?.();
      });
      actions.appendChild(backBtn);
    }
    const invBtn = document.createElement('button');
    invBtn.className = 'pb-inv-btn';
    invBtn.textContent = '🛠 장비 정비';
    invBtn.addEventListener('click', () => this.onInventory?.());
    const launch = document.createElement('button');
    launch.className = 'pb-launch';
    launch.textContent = `▶ ${planetById(this.planet).name} 출격`;
    launch.addEventListener('click', () => {
      const cb = this.onLaunch;
      this.hide();
      cb?.({
        planet: this.planet,
        tier: this.tier,
        anomalyAccepted: this.anomalyKind !== ANOMALY_NONE && this.anomalyAccepted,
      });
    });
    actions.appendChild(invBtn);
    actions.appendChild(launch);
    this.root.appendChild(actions);

    const metaEl = document.createElement('div');
    metaEl.className = 'pb-meta';
    metaEl.textContent = meta;
    this.root.appendChild(metaEl);
  }
}
