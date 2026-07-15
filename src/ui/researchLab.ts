/**
 * Research lab overlay (DOM — M3 Phase D2, plan §4, AC1/AC7).
 *
 * The base's 연구소: visualises the three skill trees (화력·생존·기동, 20 nodes
 * each laid out as 5 tiers × 4 columns), lets the pilot spend banked skill points
 * into nodes (`investSkill`), respec the whole tree for a credit cost
 * (`respecSkills`/`respecCost`), and previews the derived stats the current
 * investment produces (`computeSkillStats`) — the same block the loadout pipeline
 * feeds the run. Synergy (lower-tier investment amplifies higher tiers) is noted.
 *
 * Pure DOM meta screen: mutates the passed `Profile` in place, persists after
 * every change, and never touches the simulation.
 */

import {
  SKILLS,
  SKILL_TREES,
  NODES_PER_TREE,
  TREE_DEPTH,
  treeRange,
  type SkillTree,
} from '../../data/skills.js';
import type { StatKey } from '../items/types.js';
import { computeSkillStats } from '../items/skills.js';
import {
  investSkill,
  respecSkills,
  respecCost,
  totalInvested,
  saveProfile,
  activeShip,
  type KeyValueStore,
  type Profile,
} from '../save/profile.js';

/** Tree id → header label + accent colour. */
const TREE_META: Record<SkillTree, { name: string; accent: string }> = {
  firepower: { name: '화력', accent: '#ff7a4c' },
  survival: { name: '생존', accent: '#4cd7ff' },
  mobility: { name: '기동', accent: '#8fd94c' },
};

/** Derived-stat preview rows: [StatKey, label, isPercent]. */
const PREVIEW_ROWS: readonly [StatKey, string, boolean][] = [
  ['damagePct', '탄환 데미지', true],
  ['fireRatePct', '연사 속도', true],
  ['bulletCount', '추가 탄환', false],
  ['pierce', '관통', false],
  ['bulletSpeedPct', '탄속', true],
  ['rangeFlat', '사거리', false],
  ['maxHpFlat', '최대 HP(고정)', false],
  ['maxHpPct', '최대 HP', true],
  ['dashCdPct', '대시 재충전 감소', true],
  ['moveSpeedPct', '이동 속도', true],
  ['magnetPct', '자석 반경', true],
  ['xpPct', '경험치', true],
];

const STYLE = `
#pb-lab { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; gap:14px; padding:24px 16px; box-sizing:border-box; background:radial-gradient(circle at 50% 20%,#0a1020,#03050c 75%); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:29; overflow:auto; }
#pb-lab h1 { margin:0; color:#7affea; font-size:24px; font-weight:900; letter-spacing:2px; }
#pb-lab .pb-bar { display:flex; gap:18px; align-items:center; color:#e8ecff; font-size:14px; font-weight:700; }
#pb-lab .pb-bar .sp { color:#7affea; }
#pb-lab .pb-bar .cr { color:#ffd24c; }
#pb-lab .pb-cols { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; justify-content:center; }
#pb-lab .pb-tree { background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:14px; padding:14px; width:280px; }
#pb-lab .pb-tree h2 { margin:0 0 4px; font-size:16px; font-weight:800; letter-spacing:1px; }
#pb-lab .pb-tree .pb-tsub { color:#68789c; font-size:11px; margin-bottom:10px; }
#pb-lab .pb-tier { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; margin-bottom:7px; }
#pb-lab .pb-node { position:relative; background:rgba(20,26,44,.85); border:1px solid #2a3552; border-radius:9px; padding:7px 8px; cursor:pointer; transition:border-color .1s ease,transform .08s ease; }
#pb-lab .pb-node:hover { border-color:#4cd7ff; transform:translateY(-1px); }
#pb-lab .pb-node.maxed { border-color:#7affea; box-shadow:0 0 10px rgba(122,255,234,.25) inset; }
#pb-lab .pb-node.invested { border-color:#4a80c0; }
#pb-lab .pb-node.cant { cursor:default; opacity:.75; }
#pb-lab .pb-node .nm { color:#dfe6f5; font-size:11px; font-weight:700; line-height:1.2; }
#pb-lab .pb-node .pt { color:#8896b8; font-size:10px; margin-top:3px; display:flex; justify-content:space-between; }
#pb-lab .pb-node .pt b { color:#7affea; }
#pb-lab .pb-stats { background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:14px; padding:14px; width:240px; }
#pb-lab .pb-stats h2 { margin:0 0 10px; color:#aab6d6; font-size:14px; font-weight:700; letter-spacing:1px; }
#pb-lab .pb-statrow { display:flex; justify-content:space-between; gap:14px; font-size:12px; padding:2px 0; border-bottom:1px solid rgba(255,255,255,.05); }
#pb-lab .pb-statrow .k { color:#8896b8; } #pb-lab .pb-statrow .v { color:#fff; font-weight:700; }
#pb-lab .pb-synergy { color:#8fb6d6; font-size:11px; margin-top:10px; line-height:1.4; }
#pb-lab .pb-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
#pb-lab button.pb-act { pointer-events:auto; cursor:pointer; padding:9px 16px; font-size:13px; font-weight:700; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px; }
#pb-lab button.pb-act:hover:not(:disabled) { border-color:#4cd7ff; color:#fff; }
#pb-lab button.pb-act:disabled { opacity:.4; cursor:default; }
#pb-lab button.pb-close { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; font-weight:800; }
#pb-lab .pb-hint { color:#ff9a7a; font-size:12px; min-height:14px; }
`;

export class ResearchLab {
  private readonly root: HTMLElement;
  private profile: Profile;
  private store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';

  constructor(profile: Profile, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-lab';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onClose = null;
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  private invest(index: number): void {
    if (!investSkill(this.profile, index)) {
      this.hint = this.profile.skillPoints <= 0 ? '스킬 포인트가 부족합니다.' : '이미 최대까지 투자했습니다.';
      this.render();
      return;
    }
    this.hint = '';
    this.persist();
    this.render();
  }

  private respec(): void {
    if (!respecSkills(this.profile)) {
      this.hint =
        totalInvested(this.profile) === 0
          ? '되돌릴 투자가 없습니다.'
          : `크레딧이 부족합니다 (필요 ${respecCost(this.profile)}).`;
      this.render();
      return;
    }
    this.hint = '스킬 트리를 초기화하고 포인트를 환급했습니다.';
    this.persist();
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = '연구소 — 스킬 트리';
    this.root.appendChild(h1);

    const bar = document.createElement('div');
    bar.className = 'pb-bar';
    const ship = activeShip(this.profile);
    bar.innerHTML =
      `<span>스킬 포인트 <b class="sp">${this.profile.skillPoints}</b></span>` +
      `<span>투자 <b>${totalInvested(this.profile)}</b></span>` +
      `<span>크레딧 <b class="cr">${this.profile.credits}</b></span>` +
      `<span>기체 Lv <b>${ship.level}</b></span>`;
    this.root.appendChild(bar);

    const cols = document.createElement('div');
    cols.className = 'pb-cols';
    for (const tree of SKILL_TREES) cols.appendChild(this.treePanel(tree));
    cols.appendChild(this.statsPanel());
    this.root.appendChild(cols);

    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    const respecBtn = this.actionBtn(`리스펙 (${respecCost(this.profile)} 크레딧)`, () => this.respec());
    if (totalInvested(this.profile) === 0) respecBtn.disabled = true;
    actions.appendChild(respecBtn);
    const closeBtn = this.actionBtn('◀ 기지로', () => {
      const cb = this.onClose;
      this.hide();
      cb?.();
    });
    closeBtn.classList.add('pb-close');
    actions.appendChild(closeBtn);
    this.root.appendChild(actions);

    const hintEl = document.createElement('div');
    hintEl.className = 'pb-hint';
    hintEl.textContent = this.hint;
    this.root.appendChild(hintEl);
  }

  private treePanel(tree: SkillTree): HTMLElement {
    const meta = TREE_META[tree];
    const panel = document.createElement('div');
    panel.className = 'pb-tree';
    const h2 = document.createElement('h2');
    h2.textContent = meta.name;
    h2.style.color = meta.accent;
    panel.appendChild(h2);
    const sub = document.createElement('div');
    sub.className = 'pb-tsub';
    const { start } = treeRange(tree);
    let invested = 0;
    for (let j = 0; j < NODES_PER_TREE; j++) invested += this.profile.skillInvest[start + j] ?? 0;
    sub.textContent = `누적 투자 ${invested}pt · 하위 투자가 상위 노드를 증폭`;
    panel.appendChild(sub);

    // 5 tiers × 4 nodes. SKILLS within a tree are tier-ascending, 4 per tier.
    for (let tier = 0; tier < TREE_DEPTH; tier++) {
      const row = document.createElement('div');
      row.className = 'pb-tier';
      for (let c = 0; c < NODES_PER_TREE / TREE_DEPTH; c++) {
        const localIdx = tier * (NODES_PER_TREE / TREE_DEPTH) + c;
        const index = start + localIdx;
        const node = SKILLS[index];
        if (node === undefined) continue;
        row.appendChild(this.nodeEl(index, meta.accent));
      }
      panel.appendChild(row);
    }
    return panel;
  }

  private nodeEl(index: number, accent: string): HTMLElement {
    const node = SKILLS[index]!;
    const cur = this.profile.skillInvest[index] ?? 0;
    const el = document.createElement('div');
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;
    el.className = `pb-node${maxed ? ' maxed' : cur > 0 ? ' invested' : ''}${canInvest ? '' : ' cant'}`;
    el.title = node.desc;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = node.name;
    const pt = document.createElement('div');
    pt.className = 'pt';
    pt.innerHTML = `<span>${node.desc}</span><b>${cur}/${node.maxPoints}</b>`;
    el.appendChild(nm);
    el.appendChild(pt);
    if (cur > 0) el.style.borderColor = accent;
    el.addEventListener('click', () => this.invest(index));
    return el;
  }

  private statsPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-stats';
    const h = document.createElement('h2');
    h.textContent = '파생 스탯 (시너지 반영)';
    panel.appendChild(h);
    const sums = computeSkillStats(this.profile.skillInvest);
    for (const [key, label, isPct] of PREVIEW_ROWS) {
      const v = sums[key];
      if (v === 0) continue;
      const row = document.createElement('div');
      row.className = 'pb-statrow';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = label;
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = isPct ? `+${v}%` : `+${v}`;
      row.appendChild(kEl);
      row.appendChild(vEl);
      panel.appendChild(row);
    }
    const syn = document.createElement('div');
    syn.className = 'pb-synergy';
    syn.textContent =
      '시너지: 각 노드의 출력은 같은 계열 하위 티어에 투자한 포인트만큼 소폭 증폭됩니다(최대 +50%). 깊게 투자할수록 상위 노드가 강해집니다.';
    panel.appendChild(syn);
    return panel;
  }

  private actionBtn(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'pb-act';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
