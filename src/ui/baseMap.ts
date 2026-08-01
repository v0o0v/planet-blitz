/**
 * Base-map hub overlay (DOM — M3 Phase D1, plan §4, AC7; GDD §7/§10).
 *
 * The home base: a single fixed-view screen (OQ-M3-6: 1화면 고정) of five
 * buildings the pilot clicks to enter their functions —
 *   격납고 (hangar → inventory/equip, reused M2 screen),
 *   연구소 (research lab → skill tree),
 *   정제소 (refinery → affix reroll),
 *   방어 사령부 / 관제탑 (M4 content — shown "준비 중" so the layout is built once).
 * A 출격 action opens the star map for a run. Locked buildings render a lock
 * overlay so the unlock order (격납고 → Lv3 연구소 → 행성 1클리어 정제소 → M4) is
 * surfaced naturally (plan E2 / GDD §7).
 *
 * Pure DOM meta screen: reads a `Profile` to derive unlocks/meta; never touches
 * the simulation.
 */

import { computeUnlocks, activeShip, RESEARCH_UNLOCK_LEVEL, type Profile } from '../save/profile.js';
import { UI_LOCK_URL, pixelIcon } from './uiIcons.js';
import { t, type MessageKey } from '../i18n/index.js';

// 기지 건물 픽셀아트(PixelLab 생성, 64px side view — 이모지 폴백 대체).
import hangarPng from '../../assets/ui_bld_hangar.png';
import researchPng from '../../assets/ui_bld_research.png';
import refineryPng from '../../assets/ui_bld_refinery.png';
import defensePng from '../../assets/ui_bld_defense.png';
import controlPng from '../../assets/ui_bld_control.png';

/** A building tile on the base map. 이름/설명은 i18n 키로 지연 로케일화. */
interface Building {
  key: 'hangar' | 'research' | 'refinery' | 'defense' | 'control';
  nameKey: MessageKey;
  icon: string;
  descKey: MessageKey;
  accent: string;
}

const BUILDINGS: readonly Building[] = [
  { key: 'hangar', nameKey: 'base.bld.hangar.name', icon: hangarPng, descKey: 'base.bld.hangar.desc', accent: '#4cd7ff' },
  { key: 'research', nameKey: 'base.bld.research.name', icon: researchPng, descKey: 'base.bld.research.desc', accent: '#ff7a4c' },
  { key: 'refinery', nameKey: 'base.bld.refinery.name', icon: refineryPng, descKey: 'base.bld.refinery.desc', accent: '#ffd24c' },
  { key: 'defense', nameKey: 'base.bld.defense.name', icon: defensePng, descKey: 'base.bld.defense.desc', accent: '#8fd94c' },
  { key: 'control', nameKey: 'base.bld.control.name', icon: controlPng, descKey: 'base.bld.control.desc', accent: '#c86aff' },
];

const STYLE = `
#pb-base { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; background:radial-gradient(circle at 50% 25%,#0c1630,#040610 72%); font-family:'Segoe UI',system-ui,sans-serif; z-index:24; overflow:auto; }
#pb-base h1 { margin:0; color:#7affea; font-size:28px; font-weight:900; letter-spacing:3px; text-shadow:0 3px 12px #000; }
#pb-base .pb-sub { color:#8896b8; font-size:13px; margin-top:-10px; }
#pb-base .pb-grid { display:grid; grid-template-columns:repeat(3,168px); gap:16px; }
#pb-base .pb-bld { position:relative; width:168px; height:132px; padding:14px; box-sizing:border-box; background:linear-gradient(160deg,#141d33,#0a1020); border:2px solid #2a3552; border-radius:16px; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease; }
#pb-base .pb-bld:hover { transform:translateY(-4px); box-shadow:0 10px 28px rgba(0,0,0,.5); }
#pb-base .pb-bld .ic { font-size:40px; filter:drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
#pb-base .pb-bld .nm { color:#fff; font-size:16px; font-weight:800; }
#pb-base .pb-bld .ds { color:#aab6d6; font-size:11px; }
#pb-base .pb-bld.locked { cursor:not-allowed; }
#pb-base .pb-bld.locked .ic, #pb-base .pb-bld.locked .nm, #pb-base .pb-bld.locked .ds { opacity:.35; }
#pb-base .pb-bld .lockov { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border-radius:14px; background:rgba(4,8,18,.55); }
#pb-base .pb-bld .lockov .lk { font-size:26px; }
#pb-base .pb-bld .lockov .rs { color:#ff9a7a; font-size:11px; font-weight:700; padding:0 8px; text-align:center; }
#pb-base .pb-launch { pointer-events:auto; cursor:pointer; margin-top:4px; padding:14px 52px; font-size:18px; font-weight:900; letter-spacing:2px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:12px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-base .pb-launch:hover { transform:translateY(-2px); box-shadow:0 8px 26px rgba(76,215,255,.4); }
#pb-base .pb-meta { color:#68789c; font-size:12px; }
`;

export interface BaseMapCallbacks {
  onHangar: () => void;
  onResearch: () => void;
  onRefinery: () => void;
  onDefense: () => void;
  onControl: () => void;
  onStarMap: () => void;
  /** 기록 보관소(서사 열람 시설) 진입 — 상시 개방(스토리 시스템 Phase C2). */
  onArchive: () => void;
  /** 지시 수신소(의뢰서 시스템 Phase E) 진입 — 상시 개방. */
  onCommission: () => void;
}

export class BaseMap {
  private readonly root: HTMLElement;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-base';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(profile: Profile, cb: BaseMapCallbacks): void {
    this.render(profile, cb);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** Lock reason for a building, or null when unlocked. */
  private lockReason(key: Building['key'], profile: Profile): string | null {
    const u = computeUnlocks(profile);
    switch (key) {
      case 'hangar':
        return u.hangar ? null : t('base.lock.pre');
      case 'research':
        return u.research ? null : t('base.lock.level', { lvl: RESEARCH_UNLOCK_LEVEL });
      case 'refinery':
        return u.refinery ? null : t('base.lock.clear');
      case 'defense':
        return u.defenseCommand ? null : t('base.lock.clear');
      case 'control':
        // 관제탑(침공·래더) — 방어 사령부와 동일 해금 조건(행성 1회 클리어)으로 활성화.
        // (computeUnlocks.controlTower 는 save 계층 소유라, 해금 판정은 여기서 미러한다.)
        return u.defenseCommand ? null : t('base.lock.clear');
      default:
        return null;
    }
  }

  private enter(key: Building['key'], cb: BaseMapCallbacks): void {
    switch (key) {
      case 'hangar':
        cb.onHangar();
        break;
      case 'research':
        cb.onResearch();
        break;
      case 'refinery':
        cb.onRefinery();
        break;
      case 'defense':
        cb.onDefense();
        break;
      case 'control':
        cb.onControl();
        break;
    }
  }

  private render(profile: Profile, cb: BaseMapCallbacks): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('base.title');
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = t('base.sub');
    this.root.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'pb-grid';
    for (const b of BUILDINGS) {
      const reason = this.lockReason(b.key, profile);
      const locked = reason !== null;
      const tile = document.createElement('div');
      tile.className = `pb-bld${locked ? ' locked' : ''}`;
      tile.style.borderColor = locked ? '#2a3552' : b.accent;

      const bname = t(b.nameKey);
      const ic = document.createElement('div');
      ic.className = 'ic';
      ic.appendChild(pixelIcon(b.icon, 56, bname));
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = bname;
      const ds = document.createElement('div');
      ds.className = 'ds';
      ds.textContent = t(b.descKey);
      tile.appendChild(ic);
      tile.appendChild(nm);
      tile.appendChild(ds);

      if (locked) {
        const ov = document.createElement('div');
        ov.className = 'lockov';
        const lk = document.createElement('div');
        lk.className = 'lk';
        lk.appendChild(pixelIcon(UI_LOCK_URL, 26, t('base.locked')));
        const rs = document.createElement('div');
        rs.className = 'rs';
        rs.textContent = reason;
        ov.appendChild(lk);
        ov.appendChild(rs);
        tile.appendChild(ov);
      } else {
        tile.addEventListener('click', () => this.enter(b.key, cb));
      }
      grid.appendChild(tile);
    }
    this.root.appendChild(grid);

    const launch = document.createElement('button');
    launch.className = 'pb-launch';
    launch.textContent = t('base.launch');
    launch.addEventListener('click', () => cb.onStarMap());
    this.root.appendChild(launch);

    const ship = activeShip(profile);
    const meta = document.createElement('div');
    meta.className = 'pb-meta';
    meta.textContent = t('meta.line', {
      c: profile.credits,
      m: profile.minerals,
      lv: ship.level,
      sp: profile.skillPoints,
    });
    this.root.appendChild(meta);
  }
}
