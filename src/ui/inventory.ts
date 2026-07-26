/**
 * Inventory / equip overlay (DOM — M2 Phase D1+D2, plan §4, AC6).
 *
 * A pure DOM meta screen (no sim involvement): the eight equip positions, a 48-
 * slot inventory grid, a 96-slot stash (base 32 + two credit expansions), item
 * tooltips (rarity colour + affix list), a live compare against the currently-
 * equipped item, a derived-stat preview via `computeLoadoutStats`, and bulk
 * disenchant (normal/magic → credits, rare+ → minerals).
 *
 * It mutates the passed `Profile` in place and persists after every change, so
 * the next run's loadout reflects what the player equipped here.
 */

import type { Item, EquipSlotId, SlotKind, Rarity } from '../items/types.js';
import { EQUIP_SLOTS } from '../items/types.js';
import { AFFIX_BY_ID } from '../../data/affixes.js';
import { computeLoadoutStats } from '../items/loadout.js';
import {
  saveProfile,
  activeShip,
  stashCapacity,
  INVENTORY_CAP,
  MAX_STASH_EXPANSIONS,
  type KeyValueStore,
  type Profile,
} from '../save/profile.js';
import { salvageItems } from '../save/settlement.js';
import { t, type MessageKey } from '../i18n/index.js';
import { stashExpansionCost, canAfford, STASH_EXPANSION_BASE } from '../../data/economy.js';

/**
 * Credit cost of the *first* stash expansion (앵커). 실제 회차별 비용은
 * data/economy.ts stashExpansionCost(currentExpansions) 가 산출한다 — 제곱 곡선이라
 * 1회차 1000 · 2회차 4000 · 3회차 9000 · 4회차 16000 이다.
 *
 * 이 DOM 화면(구 InventoryOverlay)의 `expandStash()` 는 **서버를 부르지 않는다**(로컬 차감).
 * 그래서 Pixi 격납고가 겪은 "rejected 를 전부 크레딧 부족으로 뭉갠다" 결함이 여기엔 없다 —
 * 서버 권위(ADR-0027) 경로는 Pixi 격납고(`src/ui/pixi/hangar.ts`)가 정본이다.
 */
export const STASH_EXPANSION_COST = STASH_EXPANSION_BASE;

/** Rarity → display colour (shared with tooltips/borders). */
const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#b8c2d8',
  magic: '#6aa0ff',
  rare: '#ffd24c',
  unique: '#ff8a3c',
};

/** Slot-kind → i18n key for the equip row (reuses the shared item.slot.* catalog). */
const SLOT_LABEL_KEY: Record<SlotKind, MessageKey> = {
  main: 'item.slot.main',
  sub: 'item.slot.sub',
  armor: 'item.slot.armor',
  shield: 'item.slot.shield',
  engine: 'item.slot.engine',
  core: 'item.slot.core',
  module: 'item.slot.module',
};

/** Localised slot label. */
function slotLabel(kind: SlotKind): string {
  return t(SLOT_LABEL_KEY[kind]);
}

/** Weapon-type i18n keys for `main` items (reuses shared item.weapon.* catalog). */
const WEAPON_KEY: readonly MessageKey[] = ['item.weapon.0', 'item.weapon.1', 'item.weapon.2'];

/** Localised weapon label (falls back to '?' when the type is out of range). */
function weaponLabel(type: number): string {
  const key = WEAPON_KEY[type];
  return key !== undefined ? t(key) : '?';
}

/** Which SlotKind an equip position accepts. */
function slotKindOf(id: EquipSlotId): SlotKind {
  return (id === 'module0' || id === 'module1' ? 'module' : id) as SlotKind;
}

const STYLE = `
#pb-inv { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; gap:14px; padding:24px 16px; box-sizing:border-box; background:rgba(3,5,12,.92); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:28; overflow:auto; }
#pb-inv h1 { margin:0; color:#7affea; font-size:24px; font-weight:900; letter-spacing:2px; }
#pb-inv .pb-cols { display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; justify-content:center; }
#pb-inv .pb-panel { background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:14px; padding:16px; }
#pb-inv .pb-panel h2 { margin:0 0 10px; color:#aab6d6; font-size:14px; font-weight:700; letter-spacing:1px; }
#pb-inv .pb-equip { display:grid; grid-template-columns:repeat(4,58px); gap:10px; }
#pb-inv .pb-eslot { position:relative; width:58px; height:58px; border-radius:10px; border:2px dashed #33405f; display:flex; align-items:center; justify-content:center; cursor:pointer; }
#pb-inv .pb-eslot .pb-elabel { position:absolute; top:-15px; left:0; right:0; text-align:center; font-size:10px; color:#68789c; }
#pb-inv .pb-grid { display:grid; grid-template-columns:repeat(8,42px); gap:6px; }
#pb-inv .pb-stashgrid { display:grid; grid-template-columns:repeat(8,42px); gap:6px; max-height:300px; overflow:auto; }
#pb-inv .pb-cell { width:42px; height:42px; border-radius:8px; background:rgba(20,26,44,.8); border:1px solid #2a3552; display:flex; align-items:center; justify-content:center; }
#pb-inv .pb-item { width:100%; height:100%; border-radius:7px; border:2px solid; display:flex; align-items:center; justify-content:center; font-size:18px; cursor:pointer; box-sizing:border-box; }
#pb-inv .pb-item.sel { outline:2px solid #ff6a7a; outline-offset:1px; }
#pb-inv .pb-stats { min-width:210px; }
#pb-inv .pb-statrow { display:flex; justify-content:space-between; gap:16px; font-size:13px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.05); }
#pb-inv .pb-statrow .k { color:#8896b8; } #pb-inv .pb-statrow .v { color:#fff; font-weight:700; }
#pb-inv .pb-currency { display:flex; gap:18px; color:#e8ecff; font-size:14px; font-weight:700; }
#pb-inv .pb-currency .m { color:#ffd24c; }
#pb-inv .pb-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
#pb-inv button.pb-act { pointer-events:auto; cursor:pointer; padding:9px 16px; font-size:13px; font-weight:700; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px; }
#pb-inv button.pb-act:hover { border-color:#4cd7ff; color:#fff; }
#pb-inv button.pb-act:disabled { opacity:.4; cursor:default; }
#pb-inv button.pb-close { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; font-weight:800; }
#pb-inv .pb-hint { color:#ff9a7a; font-size:12px; min-height:14px; }
#pb-inv-tip { position:fixed; z-index:40; pointer-events:none; max-width:260px; background:#0b0f1c; border:1px solid #33405f; border-radius:10px; padding:10px 12px; font-family:'Segoe UI',sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.6); display:none; }
#pb-inv-tip .t-name { font-size:14px; font-weight:800; margin-bottom:4px; }
#pb-inv-tip .t-slot { font-size:11px; color:#8896b8; margin-bottom:6px; }
#pb-inv-tip .t-affix { font-size:12px; color:#c9d3ea; }
#pb-inv-tip .t-cmp { margin-top:8px; padding-top:6px; border-top:1px solid #33405f; font-size:11px; color:#8896b8; }
`;

export class InventoryOverlay {
  private readonly root: HTMLElement;
  private readonly tip: HTMLElement;
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
    this.root.id = 'pb-inv';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
    this.tip = document.createElement('div');
    this.tip.id = 'pb-inv-tip';
    document.body.appendChild(this.tip);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Open the inventory. `profile` is re-bound so it always reflects live state. */
  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.tip.style.display = 'none';
    this.onClose = null;
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  // --- Equip / unequip -----------------------------------------------------

  private equip(item: Item): void {
    const ship = activeShip(this.profile);
    const kind = item.slot;
    // Pick the target equip position (module → first empty of the two, else 0).
    let target: EquipSlotId;
    if (kind === 'module') {
      target = ship.equipped.module0 === undefined ? 'module0'
        : ship.equipped.module1 === undefined ? 'module1' : 'module0';
    } else {
      target = kind as EquipSlotId;
    }
    // Remove from inventory.
    const idx = this.profile.inventory.indexOf(item);
    if (idx >= 0) this.profile.inventory.splice(idx, 1);
    // Return any displaced item to the inventory.
    const displaced = ship.equipped[target];
    if (displaced !== undefined) this.profile.inventory.push(displaced);
    ship.equipped[target] = item;
    this.persist();
    this.render();
  }

  private unequip(id: EquipSlotId): void {
    const ship = activeShip(this.profile);
    const item = ship.equipped[id];
    if (item === undefined) return;
    if (this.profile.inventory.length >= INVENTORY_CAP) {
      this.hint = t('inv.err.full');
      this.render();
      return;
    }
    delete ship.equipped[id];
    this.profile.inventory.push(item);
    this.persist();
    this.render();
  }

  // --- Salvage / stash -----------------------------------------------------

  private salvageByRarities(rarities: readonly Rarity[]): void {
    const set = new Set(rarities);
    const targets = this.profile.inventory.filter((it) => set.has(it.rarity));
    if (targets.length === 0) {
      this.hint = t('inv.err.noSalvage');
      this.render();
      return;
    }
    const mineralFindMult = computeLoadoutStats(this.equippedItems()).worldMods.mineralFindMult;
    const y = salvageItems(this.profile, targets, mineralFindMult);
    this.hint = t('inv.salvageDone', { n: targets.length, credits: y.credits, minerals: y.minerals });
    this.persist();
    this.render();
  }

  private expandStash(): void {
    if (this.profile.stashExpansions >= MAX_STASH_EXPANSIONS) {
      this.hint = t('inv.stashMax');
      this.render();
      return;
    }
    const cost = stashExpansionCost(this.profile.stashExpansions);
    if (!canAfford(this.profile.credits, cost)) {
      this.hint = t('inv.err.noCredits', { n: cost });
      this.render();
      return;
    }
    this.profile.credits -= cost;
    this.profile.stashExpansions++;
    this.hint = t('inv.stashExpanded');
    this.persist();
    this.render();
  }

  private equippedItems(): Item[] {
    const ship = activeShip(this.profile);
    const out: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) out.push(it);
    }
    return out;
  }

  // --- Tooltip -------------------------------------------------------------

  private showTip(item: Item, ev: MouseEvent, compareTo?: Item): void {
    this.tip.innerHTML = '';
    const name = document.createElement('div');
    name.className = 't-name';
    name.style.color = RARITY_COLOR[item.rarity];
    name.textContent = this.itemName(item);
    const slot = document.createElement('div');
    slot.className = 't-slot';
    slot.textContent = `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`;
    this.tip.appendChild(name);
    this.tip.appendChild(slot);
    for (const a of item.affixes) {
      const def = AFFIX_BY_ID.get(a.id);
      const row = document.createElement('div');
      row.className = 't-affix';
      row.textContent = def !== undefined ? `${def.name} (${a.stat} +${a.value})` : `${a.stat} +${a.value}`;
      this.tip.appendChild(row);
    }
    if (compareTo !== undefined && compareTo !== item) {
      const cmp = document.createElement('div');
      cmp.className = 't-cmp';
      cmp.textContent = t('inv.tip.compare', { name: this.itemName(compareTo), n: compareTo.affixes.length });
      this.tip.appendChild(cmp);
    }
    this.tip.style.display = 'block';
    this.moveTip(ev);
  }

  private moveTip(ev: MouseEvent): void {
    const pad = 14;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    if (x + w > window.innerWidth) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight) y = ev.clientY - h - pad;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  private hideTip(): void {
    this.tip.style.display = 'none';
  }

  private itemName(item: Item): string {
    if (item.slot === 'main' && item.weaponType !== undefined) {
      return `${t('item.slot.main')} · ${weaponLabel(item.weaponType)}`;
    }
    return slotLabel(item.slot);
  }

  // --- Render --------------------------------------------------------------

  private cell(item: Item | undefined, onClick: () => void, compareTo?: Item): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'pb-cell';
    if (item !== undefined) {
      const el = document.createElement('div');
      el.className = 'pb-item';
      el.style.borderColor = RARITY_COLOR[item.rarity];
      el.style.color = RARITY_COLOR[item.rarity];
      el.textContent = item.slot === 'main' ? '✷' : item.slot === 'sub' ? '❋' : '◈';
      el.addEventListener('click', onClick);
      el.addEventListener('mouseenter', (e) => this.showTip(item, e, compareTo));
      el.addEventListener('mousemove', (e) => this.moveTip(e));
      el.addEventListener('mouseleave', () => this.hideTip());
      cell.appendChild(el);
    }
    return cell;
  }

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('inv.title');
    this.root.appendChild(h1);

    const currency = document.createElement('div');
    currency.className = 'pb-currency';
    const ship = activeShip(this.profile);
    currency.innerHTML =
      `<span>${t('inv.cur.credits')} <b>${this.profile.credits}</b></span>` +
      `<span class="m">${t('inv.cur.minerals')} <b>${this.profile.minerals}</b></span>` +
      `<span>${t('inv.cur.skillPoints')} <b>${this.profile.skillPoints}</b></span>` +
      `<span>${t('inv.cur.shipLv')} <b>${ship.level}</b></span>`;
    this.root.appendChild(currency);

    const cols = document.createElement('div');
    cols.className = 'pb-cols';

    // --- Equip panel ---
    const equipPanel = document.createElement('div');
    equipPanel.className = 'pb-panel';
    const eqH = document.createElement('h2');
    eqH.textContent = t('inv.equip');
    equipPanel.appendChild(eqH);
    const equipGrid = document.createElement('div');
    equipGrid.className = 'pb-equip';
    for (const id of EQUIP_SLOTS) {
      const slotEl = document.createElement('div');
      slotEl.className = 'pb-eslot';
      const lbl = document.createElement('div');
      lbl.className = 'pb-elabel';
      lbl.textContent =
        id === 'module0' ? t('inv.module1') : id === 'module1' ? t('inv.module2') : slotLabel(slotKindOf(id));
      slotEl.appendChild(lbl);
      const item = ship.equipped[id];
      if (item !== undefined) {
        const el = document.createElement('div');
        el.className = 'pb-item';
        el.style.borderColor = RARITY_COLOR[item.rarity];
        el.style.color = RARITY_COLOR[item.rarity];
        el.textContent = item.slot === 'main' ? '✷' : item.slot === 'sub' ? '❋' : '◈';
        el.addEventListener('click', () => this.unequip(id));
        el.addEventListener('mouseenter', (e) => this.showTip(item, e));
        el.addEventListener('mousemove', (e) => this.moveTip(e));
        el.addEventListener('mouseleave', () => this.hideTip());
        slotEl.appendChild(el);
      }
      equipGrid.appendChild(slotEl);
    }
    equipPanel.appendChild(equipGrid);
    cols.appendChild(equipPanel);

    // --- Derived-stat preview ---
    cols.appendChild(this.statsPanel());

    // --- Inventory panel ---
    const invPanel = document.createElement('div');
    invPanel.className = 'pb-panel';
    const invH = document.createElement('h2');
    invH.textContent = t('inv.invHeader', { n: this.profile.inventory.length, cap: INVENTORY_CAP });
    invPanel.appendChild(invH);
    const invGrid = document.createElement('div');
    invGrid.className = 'pb-grid';
    for (let i = 0; i < INVENTORY_CAP; i++) {
      const item = this.profile.inventory[i];
      const compareTo = item !== undefined ? this.equippedFor(item.slot) : undefined;
      invGrid.appendChild(this.cell(item, item !== undefined ? () => this.equip(item) : () => {}, compareTo));
    }
    invPanel.appendChild(invGrid);
    cols.appendChild(invPanel);

    // --- Stash panel ---
    const stashPanel = document.createElement('div');
    stashPanel.className = 'pb-panel';
    const cap = stashCapacity(this.profile.stashExpansions);
    const stashH = document.createElement('h2');
    stashH.textContent = t('inv.stashHeader', { n: this.profile.stash.length, cap });
    stashPanel.appendChild(stashH);
    const stashGrid = document.createElement('div');
    stashGrid.className = 'pb-stashgrid';
    for (let i = 0; i < cap; i++) {
      const item = this.profile.stash[i];
      stashGrid.appendChild(this.cell(item, () => {}));
    }
    stashPanel.appendChild(stashGrid);
    cols.appendChild(stashPanel);

    this.root.appendChild(cols);

    // --- Actions ---
    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    actions.appendChild(this.actionBtn(t('inv.act.salvageLow'), () => this.salvageByRarities(['normal', 'magic'])));
    actions.appendChild(this.actionBtn(t('inv.act.salvageHigh'), () => this.salvageByRarities(['rare', 'unique'])));
    const nextExpansionCost = stashExpansionCost(this.profile.stashExpansions);
    const expandBtn = this.actionBtn(
      t('inv.act.expand', { n: nextExpansionCost }),
      () => this.expandStash(),
    );
    if (this.profile.stashExpansions >= MAX_STASH_EXPANSIONS) {
      expandBtn.disabled = true;
      expandBtn.textContent = t('inv.act.expandMax');
    } else if (!canAfford(this.profile.credits, nextExpansionCost)) {
      expandBtn.disabled = true;
    }
    actions.appendChild(expandBtn);
    const closeBtn = this.actionBtn(t('inv.act.backToMap'), () => {
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

  /** The equipped item that a given slot-kind item would compare against. */
  private equippedFor(kind: SlotKind): Item | undefined {
    const ship = activeShip(this.profile);
    if (kind === 'module') return ship.equipped.module0 ?? ship.equipped.module1;
    return ship.equipped[kind as EquipSlotId];
  }

  private statsPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel pb-stats';
    const h = document.createElement('h2');
    h.textContent = t('inv.loadoutStats');
    panel.appendChild(h);
    const { loadout, worldMods } = computeLoadoutStats(this.equippedItems());
    const rows: [string, string][] = [
      [t('inv.stat.weapon'), t(WEAPON_KEY[loadout.weaponType] ?? 'item.weapon.0')],
      [t('inv.stat.damage'), `×${loadout.damageMult.toFixed(2)}`],
      [t('inv.stat.fireRate'), `×${(1 / loadout.fireRateMult).toFixed(2)}`],
      [t('inv.stat.bullets'), `+${loadout.bulletCountAdd}`],
      [t('inv.stat.pierce'), `+${loadout.pierceAdd}`],
      [t('inv.stat.moveSpeed'), `×${loadout.moveSpeedMult.toFixed(2)}`],
      [t('inv.stat.hp'), `+${loadout.maxHpAdd}`],
      [t('inv.stat.magnet'), `×${loadout.magnetMult.toFixed(2)}`],
      [t('inv.stat.xp'), `×${loadout.xpMult.toFixed(2)}`],
      [t('inv.stat.mineralFind'), `×${worldMods.mineralFindMult.toFixed(2)}`],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'pb-statrow';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = k;
      const vEl = document.createElement('span');
      vEl.className = 'v';
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      panel.appendChild(row);
    }
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
