/**
 * Refinery overlay (DOM — M3 Phase D3, plan §4, AC3).
 *
 * The base's 정제소: reforges an item's affixes. Pick an item from the inventory,
 * optionally LOCK one affix (the 광물 3배 option — a locked reroll preserves that
 * affix and redraws the rest), then reroll. A slot-machine spin (render-only
 * flourish) settles onto the result. The actual reforge is the pure, deterministic
 * `rerollAffixes(item, seed, lockedIndex?)` from the item pipeline; the reroll seed
 * is generated here in the UI layer (outside the sim, so free to use Math.random).
 *
 * Mutates the passed `Profile` in place (swaps the reforged item back into the
 * inventory by id) and persists. Never touches the simulation.
 */

import type { Item, Rarity } from '../items/types.js';
import { AFFIX_BY_ID, AFFIXES } from '../../data/affixes.js';
import { rerollAffixes } from '../items/roll.js';
import { saveProfile, type KeyValueStore, type Profile } from '../save/profile.js';
import { UI_LOCK_URL, UI_UNLOCK_URL, pixelIcon } from './uiIcons.js';
import { t, type MessageKey } from '../i18n/index.js';

/** Minerals for a standard reroll; a locked reroll costs 3× (plan AC3). */
export const REFINERY_REROLL_COST = 12;
/** Locked-reroll cost multiplier (광물 3배). */
export const LOCKED_REROLL_MULT = 3;

const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#b8c2d8',
  magic: '#6aa0ff',
  rare: '#ffd24c',
  unique: '#ff8a3c',
};

/** Slot id → i18n key (reuses the shared item.slot.* catalog). */
const SLOT_LABEL_KEY: Record<string, MessageKey> = {
  main: 'item.slot.main',
  sub: 'item.slot.sub',
  armor: 'item.slot.armor',
  shield: 'item.slot.shield',
  engine: 'item.slot.engine',
  core: 'item.slot.core',
  module: 'item.slot.module',
};

/** Localised slot label (falls back to the raw slot id). */
function slotLabel(slot: string): string {
  const key = SLOT_LABEL_KEY[slot];
  return key !== undefined ? t(key) : slot;
}

/** Weapon-type i18n keys (0 발칸 … 4 빔; M3 무기 5타입 — reuses shared item.weapon.*). */
const WEAPON_KEY: readonly MessageKey[] = [
  'item.weapon.0',
  'item.weapon.1',
  'item.weapon.2',
  'item.weapon.3',
  'item.weapon.4',
];

/** Localised weapon label (falls back to '?' when out of range). */
function weaponLabel(type: number): string {
  const key = WEAPON_KEY[type];
  return key !== undefined ? t(key) : '?';
}

const STYLE = `
#pb-ref { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; gap:14px; padding:24px 16px; box-sizing:border-box; background:radial-gradient(circle at 50% 20%,#0a1220,#03050c 75%); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:29; overflow:auto; }
#pb-ref h1 { margin:0; color:#7affea; font-size:24px; font-weight:900; letter-spacing:2px; }
#pb-ref .pb-bar { display:flex; gap:18px; color:#e8ecff; font-size:14px; font-weight:700; }
#pb-ref .pb-bar .m { color:#ffd24c; }
#pb-ref .pb-cols { display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; justify-content:center; }
#pb-ref .pb-panel { background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:14px; padding:16px; }
#pb-ref .pb-panel h2 { margin:0 0 10px; color:#aab6d6; font-size:14px; font-weight:700; letter-spacing:1px; }
#pb-ref .pb-list { display:grid; grid-template-columns:repeat(6,42px); gap:6px; max-height:320px; overflow:auto; }
#pb-ref .pb-cell { width:42px; height:42px; border-radius:8px; background:rgba(20,26,44,.8); border:1px solid #2a3552; display:flex; align-items:center; justify-content:center; }
#pb-ref .pb-item { width:100%; height:100%; border-radius:7px; border:2px solid; display:flex; align-items:center; justify-content:center; font-size:18px; cursor:pointer; box-sizing:border-box; }
#pb-ref .pb-item.sel { outline:2px solid #7affea; outline-offset:1px; }
#pb-ref .pb-detail { min-width:280px; }
#pb-ref .pb-iname { font-size:16px; font-weight:800; margin-bottom:2px; }
#pb-ref .pb-islot { font-size:11px; color:#8896b8; margin-bottom:12px; }
#pb-ref .pb-affix { display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:6px; background:rgba(20,26,44,.85); border:1px solid #2a3552; border-radius:9px; }
#pb-ref .pb-affix.locked { border-color:#ffd24c; box-shadow:0 0 8px rgba(255,210,76,.2) inset; }
#pb-ref .pb-affix.spin { color:#8896b8; font-style:italic; }
#pb-ref .pb-affix .txt { flex:1; font-size:13px; color:#dfe6f5; }
#pb-ref .pb-affix .lockbtn { pointer-events:auto; cursor:pointer; font-size:14px; background:none; border:none; color:#68789c; }
#pb-ref .pb-affix.locked .lockbtn { color:#ffd24c; }
#pb-ref .pb-empty { color:#68789c; font-size:13px; padding:20px 0; text-align:center; }
#pb-ref .pb-cost { color:#ffd24c; font-size:13px; margin:10px 0 4px; }
#pb-ref .pb-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
#pb-ref button.pb-act { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:10px; }
#pb-ref button.pb-act:disabled { opacity:.4; cursor:default; filter:grayscale(.5); }
#pb-ref button.pb-ghost { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px; }
#pb-ref .pb-hint { color:#ff9a7a; font-size:12px; min-height:14px; }
`;

export class Refinery {
  private readonly root: HTMLElement;
  private profile: Profile;
  private store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private selectedId: string | null = null;
  private lockedIndex: number | null = null;
  private spinning = false;
  private hint = '';
  private spinTimer: ReturnType<typeof setInterval> | null = null;

  constructor(profile: Profile, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-ref';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.selectedId = null;
    this.lockedIndex = null;
    this.spinning = false;
    this.hint = '';
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.stopSpin();
    this.root.style.display = 'none';
    this.onClose = null;
  }

  private stopSpin(): void {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.spinning = false;
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  /** Inventory items with at least one affix (the only ones worth reforging). */
  private rerollable(): Item[] {
    return this.profile.inventory.filter((it) => it.affixes.length > 0);
  }

  private selected(): Item | undefined {
    if (this.selectedId === null) return undefined;
    return this.profile.inventory.find((it) => it.id === this.selectedId);
  }

  private currentCost(): number {
    return this.lockedIndex !== null ? REFINERY_REROLL_COST * LOCKED_REROLL_MULT : REFINERY_REROLL_COST;
  }

  private reroll(): void {
    const item = this.selected();
    if (item === undefined || this.spinning) return;
    const cost = this.currentCost();
    if (this.profile.minerals < cost) {
      this.hint = t('refine.err.noMinerals', { n: cost });
      this.render();
      return;
    }
    // Reroll seed is generated in the UI layer (outside the sim → Math.random OK).
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const lockIdx = this.lockedIndex ?? undefined;
    const reforged = rerollAffixes(item, seed, lockIdx);

    // Charge minerals + swap the reforged item into the inventory by id.
    this.profile.minerals -= cost;
    const idx = this.profile.inventory.findIndex((it) => it.id === item.id);
    if (idx >= 0) this.profile.inventory[idx] = reforged;
    this.persist();

    // Slot-machine spin (render-only): cycle random affix names, then settle.
    this.hint = '';
    this.spinning = true;
    this.render();
    let ticks = 0;
    const TOTAL = 12;
    this.spinTimer = setInterval(() => {
      ticks++;
      if (ticks >= TOTAL) {
        this.stopSpin();
        this.render();
      } else {
        this.renderSpinFrame();
      }
    }, 70);
  }

  private toggleLock(index: number): void {
    if (this.spinning) return;
    this.lockedIndex = this.lockedIndex === index ? null : index;
    this.render();
  }

  private select(item: Item): void {
    if (this.spinning) return;
    this.selectedId = item.id;
    this.lockedIndex = null;
    this.hint = '';
    this.render();
  }

  private itemName(item: Item): string {
    if (item.slot === 'main' && item.weaponType !== undefined) {
      return `${t('item.slot.main')} · ${weaponLabel(item.weaponType)}`;
    }
    return slotLabel(item.slot);
  }

  private affixText(item: Item, i: number): string {
    const a = item.affixes[i];
    if (a === undefined) return '';
    const def = AFFIX_BY_ID.get(a.id);
    return def !== undefined ? `${def.name} (${a.stat} +${a.value})` : `${a.stat} +${a.value}`;
  }

  // --- Render --------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('refine.title');
    this.root.appendChild(h1);

    const bar = document.createElement('div');
    bar.className = 'pb-bar';
    bar.innerHTML =
      `<span class="m">${t('refine.bar.minerals')} <b>${this.profile.minerals}</b></span>` +
      `<span>${t('refine.bar.credits')} <b>${this.profile.credits}</b></span>`;
    this.root.appendChild(bar);

    const cols = document.createElement('div');
    cols.className = 'pb-cols';

    // --- Item list ---
    const listPanel = document.createElement('div');
    listPanel.className = 'pb-panel';
    const listH = document.createElement('h2');
    const items = this.rerollable();
    listH.textContent = t('refine.listHeader', { n: items.length });
    listPanel.appendChild(listH);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pb-empty';
      empty.textContent = t('refine.noItems');
      empty.style.whiteSpace = 'pre-line';
      listPanel.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'pb-list';
      for (const it of items) {
        const cell = document.createElement('div');
        cell.className = 'pb-cell';
        const el = document.createElement('div');
        el.className = `pb-item${it.id === this.selectedId ? ' sel' : ''}`;
        el.style.borderColor = RARITY_COLOR[it.rarity];
        el.style.color = RARITY_COLOR[it.rarity];
        el.textContent = it.slot === 'main' ? '✷' : it.slot === 'sub' ? '❋' : '◈';
        el.title = this.itemName(it);
        el.addEventListener('click', () => this.select(it));
        cell.appendChild(el);
        grid.appendChild(cell);
      }
      listPanel.appendChild(grid);
    }
    cols.appendChild(listPanel);

    // --- Detail / reroll ---
    cols.appendChild(this.detailPanel());
    this.root.appendChild(cols);

    const hintEl = document.createElement('div');
    hintEl.className = 'pb-hint';
    hintEl.textContent = this.hint;
    this.root.appendChild(hintEl);

    // Back button (row of its own so it's reachable even with no item selected).
    const back = document.createElement('button');
    back.className = 'pb-ghost';
    back.textContent = t('common.backToBase');
    back.addEventListener('click', () => {
      if (this.spinning) return;
      const cb = this.onClose;
      this.hide();
      cb?.();
    });
    this.root.appendChild(back);
  }

  private detailPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel pb-detail';
    const item = this.selected();
    const h2 = document.createElement('h2');
    h2.textContent = t('refine.reroll');
    panel.appendChild(h2);

    if (item === undefined) {
      const empty = document.createElement('div');
      empty.className = 'pb-empty';
      empty.textContent = t('refine.selectPrompt');
      panel.appendChild(empty);
      return panel;
    }

    const name = document.createElement('div');
    name.className = 'pb-iname';
    name.style.color = RARITY_COLOR[item.rarity];
    name.textContent = this.itemName(item);
    panel.appendChild(name);
    const slot = document.createElement('div');
    slot.className = 'pb-islot';
    slot.textContent = `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)} · ${t('refine.lockNote', { mult: LOCKED_REROLL_MULT })}`;
    panel.appendChild(slot);

    for (let i = 0; i < item.affixes.length; i++) {
      const rowEl = document.createElement('div');
      const isLocked = this.lockedIndex === i;
      rowEl.className = `pb-affix${isLocked ? ' locked' : ''}${this.spinning ? ' spin' : ''}`;
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = this.affixText(item, i);
      const lockBtn = document.createElement('button');
      lockBtn.className = 'lockbtn';
      lockBtn.appendChild(
        pixelIcon(
          isLocked ? UI_LOCK_URL : UI_UNLOCK_URL,
          16,
          isLocked ? t('refine.lock.alt.locked') : t('refine.lock.alt.unlocked'),
        ),
      );
      lockBtn.title = isLocked ? t('refine.lock.title.unlock') : t('refine.lock.title.lock');
      lockBtn.addEventListener('click', () => this.toggleLock(i));
      rowEl.appendChild(txt);
      rowEl.appendChild(lockBtn);
      panel.appendChild(rowEl);
    }

    const cost = document.createElement('div');
    cost.className = 'pb-cost';
    cost.textContent =
      this.lockedIndex !== null
        ? t('refine.cost.locked', { n: this.currentCost() })
        : t('refine.cost.normal', { n: this.currentCost() });
    panel.appendChild(cost);

    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    const btn = document.createElement('button');
    btn.className = 'pb-act';
    btn.textContent = this.spinning ? t('refine.spinning') : t('refine.rollBtn');
    btn.disabled = this.spinning || this.profile.minerals < this.currentCost();
    btn.addEventListener('click', () => this.reroll());
    actions.appendChild(btn);
    panel.appendChild(actions);
    return panel;
  }

  /** Slot-machine frame: overwrite each unlocked affix row with a random name. */
  private renderSpinFrame(): void {
    const rows = this.root.querySelectorAll<HTMLElement>('.pb-affix');
    rows.forEach((rowEl, i) => {
      if (this.lockedIndex === i) return; // locked rows stay put
      const txt = rowEl.querySelector<HTMLElement>('.txt');
      if (txt === null) return;
      const def = AFFIXES[(Math.random() * AFFIXES.length) | 0];
      if (def !== undefined) txt.textContent = `${def.name} (${def.stat} +?)`;
    });
  }
}
