/**
 * Level-up powerup pick overlay (DOM — plan task 13).
 *
 * Shown while the sim is frozen on a pending level-up. The render loop keeps
 * running underneath (the freeze stalls sim ticks, not the display), so the
 * three cards animate over the live arena. Picking (click or keys 1/2/3) reports
 * the chosen offer index back to the caller, which queues it as the next input
 * frame's SPECIAL_POWERUP_PICK — keeping the choice on the replay log.
 */

import { POWERUPS } from '../sim/powerups.js';

const STYLE = `
#pb-powerup { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; background:rgba(4,6,14,.72); backdrop-filter:blur(2px); font-family:'Segoe UI',system-ui,sans-serif; z-index:20; }
#pb-powerup h2 { color:#7affea; font-size:26px; font-weight:800; letter-spacing:2px; margin:0; text-shadow:0 2px 8px #000; }
#pb-powerup .pb-cards { display:flex; gap:20px; }
#pb-powerup .pb-card { width:220px; padding:22px 18px; background:linear-gradient(160deg,#141a2e,#0d1120); border:2px solid #2a3552; border-radius:14px; cursor:pointer; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease; }
#pb-powerup .pb-card:hover { transform:translateY(-6px); border-color:#4cd7ff; box-shadow:0 10px 30px rgba(76,215,255,.25); }
#pb-powerup .pb-key { display:inline-block; width:26px; height:26px; line-height:26px; border-radius:6px; background:#4cd7ff; color:#04121a; font-weight:800; margin-bottom:12px; }
#pb-powerup .pb-name { color:#fff; font-size:19px; font-weight:800; margin-bottom:10px; }
#pb-powerup .pb-desc { color:#aab6d6; font-size:14px; line-height:1.5; }
#pb-powerup .pb-hint { color:#68789c; font-size:12px; letter-spacing:1px; }
`;

export class PowerupOverlay {
  private readonly root: HTMLElement;
  private readonly cards: HTMLElement;
  private onPick: ((offerIndex: number) => void) | null = null;
  private offered: number[] = [];

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-powerup';
    this.root.style.display = 'none';
    const title = document.createElement('h2');
    title.textContent = '레벨 업! — 강화를 선택하라';
    this.cards = document.createElement('div');
    this.cards.className = 'pb-cards';
    const hint = document.createElement('div');
    hint.className = 'pb-hint';
    hint.textContent = '클릭 또는 1 / 2 / 3 키';
    this.root.appendChild(title);
    this.root.appendChild(this.cards);
    this.root.appendChild(hint);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.visible) return;
    const map: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
    const idx = map[e.code];
    if (idx !== undefined && idx < this.offered.length) {
      e.preventDefault();
      this.pick(idx);
    }
  };

  private pick(offerIndex: number): void {
    const cb = this.onPick;
    this.hide();
    if (cb !== null) cb(offerIndex);
  }

  /** Show the three offered powerups (pool indices). */
  show(choices: number[], onPick: (offerIndex: number) => void): void {
    this.offered = choices.slice();
    this.onPick = onPick;
    this.cards.innerHTML = '';
    choices.forEach((poolIndex, offerIndex) => {
      const def = POWERUPS[poolIndex];
      const card = document.createElement('div');
      card.className = 'pb-card';
      const key = document.createElement('div');
      key.className = 'pb-key';
      key.textContent = String(offerIndex + 1);
      const name = document.createElement('div');
      name.className = 'pb-name';
      name.textContent = def?.name ?? '???';
      const desc = document.createElement('div');
      desc.className = 'pb-desc';
      desc.textContent = def?.desc ?? '';
      card.appendChild(key);
      card.appendChild(name);
      card.appendChild(desc);
      card.addEventListener('click', () => this.pick(offerIndex));
      this.cards.appendChild(card);
    });
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onPick = null;
    this.offered = [];
  }
}
