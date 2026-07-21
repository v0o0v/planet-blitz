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

import type { SkillNode } from '../../data/skills.js';
import {
  shipTypeDef,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
  type ShipTypeDef,
  type TreeAffinity,
} from '../../data/ships/index.js';
import type { StatKey } from '../items/types.js';
import { computeSkillStats, shipCapstoneUnlocked, shipTreeBaseInvested } from '../items/skills.js';
import { shipTreeName } from './pixi/shipLabels.js';
import { t, type MessageKey } from '../i18n/index.js';
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

/**
 * 계열 강조색의 축은 **affinity(역할)** 다 — 트리 이름도 인덱스도 아니다(M8, 설계서 §2).
 * Pixi 판 `AFFINITY_ACCENT` 와 같은 색이고, 스트라이커 3계열의 기존 색이 그대로 보존된다.
 */
const AFFINITY_ACCENT: Readonly<Record<TreeAffinity, string>> = {
  offense: '#ff7a4c',
  defense: '#4cd7ff',
  utility: '#8fd94c',
};

/** Derived-stat preview rows: [StatKey, labelKey, isPercent]. */
const PREVIEW_ROWS: readonly [StatKey, MessageKey, boolean][] = [
  ['damagePct', 'lab.stat.damage', true],
  ['fireRatePct', 'lab.stat.fireRate', true],
  ['bulletCount', 'lab.stat.bulletCount', false],
  ['pierce', 'lab.stat.pierce', false],
  ['bulletSpeedPct', 'lab.stat.bulletSpeed', true],
  ['rangeFlat', 'lab.stat.range', false],
  ['maxHpFlat', 'lab.stat.maxHpFlat', false],
  ['maxHpPct', 'lab.stat.maxHp', true],
  ['dashCdPct', 'lab.stat.dashCd', true],
  ['moveSpeedPct', 'lab.stat.moveSpeed', true],
  ['magnetPct', 'lab.stat.magnet', true],
  ['xpPct', 'lab.stat.xp', true],
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
#pb-lab .pb-capstone { margin-top:7px; background:linear-gradient(160deg,rgba(40,30,16,.9),rgba(20,26,44,.9)); border-color:#c8a24c; }
#pb-lab .pb-capstone .nm { color:#ffd98c; }
#pb-lab .pb-capstone.maxed { border-color:#ffd24c; box-shadow:0 0 12px rgba(255,210,76,.3) inset; }
#pb-lab .pb-capstone.cant { opacity:.7; }
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

  /** 현재 편집 대상 = 활성 기체의 타입 정의(트리 수·노드 수·게이트의 단일 출처). */
  private def(): ShipTypeDef {
    return shipTypeDef(activeShip(this.profile).typeId);
  }

  /**
   * 투자 벡터 정본(M8 v4) = **활성 기체 벡터**. 계정 단위 `Profile.skillInvest` 는 M8-L7 이
   * 삭제했다(설계서 §6) — 미러도 별칭도 남아 있지 않으므로 여기가 유일한 읽기 경로다.
   */
  private invest(): number[] {
    return activeShip(this.profile).skillInvest;
  }

  private investNode(index: number): void {
    if (!investSkill(this.profile, index)) {
      this.hint = this.profile.skillPoints <= 0 ? t('lab.err.noPoints') : t('lab.err.maxed');
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
          ? t('lab.err.noInvest')
          : t('lab.err.noCredits', { n: respecCost(this.profile) });
      this.render();
      return;
    }
    this.hint = t('lab.respecDone');
    this.persist();
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('lab.title');
    this.root.appendChild(h1);

    const bar = document.createElement('div');
    bar.className = 'pb-bar';
    const ship = activeShip(this.profile);
    bar.innerHTML =
      `<span>${t('lab.bar.points')} <b class="sp">${this.profile.skillPoints}</b></span>` +
      `<span>${t('lab.bar.invest')} <b>${totalInvested(this.profile)}</b></span>` +
      `<span>${t('lab.bar.credits')} <b class="cr">${this.profile.credits}</b></span>` +
      `<span>${t('lab.bar.shipLv')} <b>${ship.level}</b></span>`;
    this.root.appendChild(bar);

    const cols = document.createElement('div');
    cols.className = 'pb-cols';
    // 계열 수·구성은 활성 기체 타입이 정한다(3계열 고정 가정 제거).
    this.def().trees.forEach((_, i) => cols.appendChild(this.treePanel(i)));
    cols.appendChild(this.statsPanel());
    this.root.appendChild(cols);

    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    const respecBtn = this.actionBtn(t('lab.respecBtn', { n: respecCost(this.profile) }), () => this.respec());
    if (totalInvested(this.profile) === 0) respecBtn.disabled = true;
    actions.appendChild(respecBtn);
    const closeBtn = this.actionBtn(t('common.backToBase'), () => {
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

  private treePanel(treeIndex: number): HTMLElement {
    const def = this.def();
    const treeDef = def.trees[treeIndex]!;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const nodes = flattenShipNodes(def);
    const panel = document.createElement('div');
    panel.className = 'pb-tree';
    const h2 = document.createElement('h2');
    h2.textContent = shipTreeName(treeDef);
    h2.style.color = accent;
    panel.appendChild(h2);
    const sub = document.createElement('div');
    sub.className = 'pb-tsub';
    sub.textContent = t('lab.tree.sub', { n: shipTreeBaseInvested(this.invest(), def, treeIndex) });
    panel.appendChild(sub);

    // ⚠️ 티어 행은 노드의 **`tier` 값으로 묶는다**. 예전 구현은 `NODES_PER_TREE / TREE_DEPTH`
    // (= 20/5 = 4)를 "티어당 노드 수" 로 나눠 썼는데, 그 산술은 스트라이커 한 타입에만 맞는
    // 우연이다 — 비온(25노드)에서는 5가 되어 티어 경계가 통째로 어긋난다.
    const { start, end } = shipTreeRange(def, treeIndex);
    const byTier = new Map<number, { index: number; node: SkillNode }[]>();
    for (let index = start; index < end; index++) {
      const node = nodes[index];
      if (node === undefined) continue;
      const bucket = byTier.get(node.tier);
      if (bucket === undefined) byTier.set(node.tier, [{ index, node }]);
      else bucket.push({ index, node });
    }
    for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
      const row = document.createElement('div');
      row.className = 'pb-tier';
      for (const entry of byTier.get(tier) ?? []) row.appendChild(this.nodeEl(entry.index, accent));
      panel.appendChild(row);
    }
    // 최상위 질적 캡스톤(GDD §4): 계열 base 게이트(타입별)를 채우면 해금·투자 가능.
    panel.appendChild(this.capstoneEl(treeIndex, accent));
    return panel;
  }

  /** 계열 캡스톤 노드 엘리먼트(게이트 미달이면 잠금 표시 + 진행도, 통과면 투자 가능). */
  private capstoneEl(treeIndex: number, accent: string): HTMLElement {
    const def = this.def();
    const invest = this.invest();
    const index = shipCapstoneIndex(def, treeIndex);
    const node = flattenShipNodes(def)[index]!;
    const cur = invest[index] ?? 0;
    const unlocked = shipCapstoneUnlocked(invest, def, treeIndex);
    const invested = shipTreeBaseInvested(invest, def, treeIndex);
    const gate = def.capstoneGate;
    const maxed = cur >= node.maxPoints;
    const el = document.createElement('div');
    el.className = `pb-node pb-capstone${maxed ? ' maxed' : cur > 0 ? ' invested' : ''}${unlocked && !maxed ? '' : ' cant'}`;
    el.title = node.desc;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = `★ ${node.name}`;
    const pt = document.createElement('div');
    pt.className = 'pt';
    if (unlocked) {
      pt.innerHTML = `<span>${node.desc}</span><b>${cur}/${node.maxPoints}</b>`;
      if (cur > 0) el.style.borderColor = accent;
    } else {
      pt.innerHTML = `<span>${t('lab.capstone.locked', { g: gate })}</span><b>${invested}/${gate}</b>`;
    }
    el.appendChild(nm);
    el.appendChild(pt);
    el.addEventListener('click', () => this.investCapstone(index, unlocked));
    return el;
  }

  private investCapstone(index: number, unlocked: boolean): void {
    if (!unlocked) {
      this.hint = t('lab.capstone.needGate', { g: this.def().capstoneGate });
      this.render();
      return;
    }
    this.investNode(index);
  }

  private nodeEl(index: number, accent: string): HTMLElement {
    const node = flattenShipNodes(this.def())[index]!;
    const cur = this.invest()[index] ?? 0;
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
    el.addEventListener('click', () => this.investNode(index));
    return el;
  }

  private statsPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-stats';
    const h = document.createElement('h2');
    h.textContent = t('lab.derivedStats');
    panel.appendChild(h);
    const sums = computeSkillStats(this.invest(), this.def().id);
    for (const [key, labelKey, isPct] of PREVIEW_ROWS) {
      const v = sums[key];
      if (v === 0) continue;
      const row = document.createElement('div');
      row.className = 'pb-statrow';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = t(labelKey);
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = isPct ? `+${v}%` : `+${v}`;
      row.appendChild(kEl);
      row.appendChild(vEl);
      panel.appendChild(row);
    }
    const syn = document.createElement('div');
    syn.className = 'pb-synergy';
    syn.textContent = t('lab.synergy');
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
