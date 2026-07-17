/**
 * Run settlement overlay (DOM — plan task 16; M5 Phase C2 완성판).
 *
 * Shown when a run ends: victory (boss defeated) or defeat (HP 0). On defeat the
 * pilot comically ejects and parachutes down — a pure render/DOM flourish with
 * zero simulation impact (spec: humour softens the loss). Reports the seed, XP,
 * kills, max combo and resources so a run is legible, plus a restart button.
 *
 * M5 C2 완성판: 정산 요약(획득 장비 수·레벨업·스킬·크레딧)에 더해 **획득 장비 목록(등급별
 * 색상)** 과 **획득 전투력**(save/combatPower)을 표시한다. 모든 문자열은 i18n(`t`) 경유라
 * 언어 전환에 즉시 반응한다. **광고 정산 보너스 지점은 구현하지 않는다**(CrazyGames SDK 연동
 * 시 일괄 — 개발 플래그 포함 전부 제외, 사용자 지시).
 *
 * 순수 render/UI 레이어 — sim/결정론 무관.
 */

import { t } from '../i18n/index.js';
import type { Rarity, SlotKind } from '../items/types.js';

/** 정산 화면에 표시할 획득 장비 1개(표시 전용 요약). */
export interface ResultDrop {
  rarity: Rarity;
  slot: SlotKind;
  /** 주무기 종류 코드(0..2) — `main` 슬롯일 때만. */
  weaponType?: number;
}

/** Settlement summary (M2 — what the run added to the profile). */
export interface SettlementSummary {
  itemsGained: number;
  levelsGained: number;
  skillPointsGained: number;
  creditsGained: number;
  overflow: number;
  /** 이번 런 획득 장비의 전투력 합계(M5 C2). */
  combatPower: number;
  /** 획득 장비 표시 목록(등급별 색상 칩, M5 C2). */
  drops: ResultDrop[];
}

export interface ResultState {
  victory: boolean;
  seed: number;
  xpTotal: number;
  kills: number;
  maxCombo: number;
  resources: number;
  level: number;
  timeSec: number;
  /** Present once the run has been settled into the profile (M2). */
  settlement?: SettlementSummary;
}

/** 등급 → 표시 색상(inventory 와 동일 팔레트). */
const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#b8c2d8',
  magic: '#6aa0ff',
  rare: '#ffd24c',
  unique: '#ff8a3c',
};

/** 정산 목록에 보여줄 최대 장비 칩 수(넘치면 "외 N개"). */
const MAX_DROP_CHIPS = 8;

const STYLE = `
#pb-result { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; background:rgba(3,5,12,.82); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:30; overflow:auto; padding:20px 0; }
#pb-result .pb-eject { font-size:56px; animation:pb-para 2.6s ease-in-out infinite; }
@keyframes pb-para { 0%{ transform:translateY(-24px) rotate(-8deg);} 50%{ transform:translateY(8px) rotate(8deg);} 100%{ transform:translateY(-24px) rotate(-8deg);} }
#pb-result h1 { margin:6px 0; font-size:40px; font-weight:900; letter-spacing:3px; text-shadow:0 3px 12px #000; }
#pb-result h1.win { color:#7affea; } #pb-result h1.lose { color:#ff6a7a; }
#pb-result .pb-sub { color:#aab6d6; font-size:15px; margin-bottom:14px; }
#pb-result .pb-stats { display:grid; grid-template-columns:auto auto; gap:8px 26px; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:12px; padding:20px 30px; }
#pb-result .pb-stats .k { color:#8896b8; font-size:14px; text-align:right; }
#pb-result .pb-stats .v { color:#fff; font-size:16px; font-weight:700; }
#pb-result .pb-stats .v.power { color:#7affea; }
#pb-result .pb-loot-title { color:#8896b8; font-size:13px; font-weight:700; letter-spacing:1px; margin:14px 0 2px; }
#pb-result .pb-drops { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; max-width:520px; }
#pb-result .pb-chip { font-size:12px; font-weight:700; padding:4px 10px; border-radius:8px; border:1px solid currentColor; background:rgba(12,16,30,.6); }
#pb-result .pb-drops-none { color:#68789c; font-size:13px; }
#pb-result button { margin-top:22px; pointer-events:auto; cursor:pointer; padding:12px 34px; font-size:16px; font-weight:800; letter-spacing:1px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:10px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-result button:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(76,215,255,.35); }
`;

function row(k: string, v: string, valueClass?: string): HTMLElement {
  const frag = document.createElement('div');
  frag.className = 'pb-rowwrap';
  frag.style.display = 'contents';
  const kEl = document.createElement('div');
  kEl.className = 'k';
  kEl.textContent = k;
  const vEl = document.createElement('div');
  vEl.className = valueClass !== undefined ? `v ${valueClass}` : 'v';
  vEl.textContent = v;
  frag.appendChild(kEl);
  frag.appendChild(vEl);
  return frag;
}

/** 장비 1개의 표시 이름(주무기는 무기 종류, 그 외는 슬롯명 — i18n). */
function dropName(d: ResultDrop): string {
  if (d.slot === 'main' && d.weaponType !== undefined) {
    const key = `item.weapon.${d.weaponType}` as 'item.weapon.0' | 'item.weapon.1' | 'item.weapon.2';
    return t(key);
  }
  const slotKey = `item.slot.${d.slot}` as
    | 'item.slot.main' | 'item.slot.sub' | 'item.slot.armor' | 'item.slot.shield'
    | 'item.slot.engine' | 'item.slot.core' | 'item.slot.module';
  return t(slotKey);
}

export class ResultOverlay {
  private readonly root: HTMLElement;
  private shown = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-result';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  show(s: ResultState, onRestart: () => void, onInventory?: () => void): void {
    if (this.shown) return;
    this.shown = true;
    this.root.innerHTML = '';

    const eject = document.createElement('div');
    eject.className = 'pb-eject';
    eject.textContent = s.victory ? '🏆' : '🪂';
    this.root.appendChild(eject);

    const h1 = document.createElement('h1');
    h1.className = s.victory ? 'win' : 'lose';
    h1.textContent = s.victory ? t('result.win.title') : t('result.lose.title');
    this.root.appendChild(h1);

    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = s.victory ? t('result.win.sub') : t('result.lose.sub');
    this.root.appendChild(sub);

    const min = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    const stats = document.createElement('div');
    stats.className = 'pb-stats';
    stats.appendChild(row(t('result.stat.time'), `${min}:${sec.toString().padStart(2, '0')}`));
    stats.appendChild(row(t('result.stat.level'), t('result.levelShort', { n: s.level })));
    stats.appendChild(row(t('result.stat.xp'), `${s.xpTotal}`));
    stats.appendChild(row(t('result.stat.kills'), `${s.kills}`));
    stats.appendChild(row(t('result.stat.combo'), `${s.maxCombo}`));
    stats.appendChild(row(t('result.stat.resources'), `${s.resources}`));
    stats.appendChild(row(t('result.stat.seed'), `${s.seed}`));
    this.root.appendChild(stats);

    if (s.settlement !== undefined) {
      const st = s.settlement;
      const loot = document.createElement('div');
      loot.className = 'pb-stats';
      loot.style.marginTop = '12px';
      loot.appendChild(row(t('result.loot.items'), t('result.loot.count', { n: st.itemsGained })));
      loot.appendChild(row(t('result.loot.levels'), `+${st.levelsGained}`));
      loot.appendChild(row(t('result.loot.skillPoints'), `+${st.skillPointsGained}`));
      loot.appendChild(row(t('result.loot.credits'), `+${st.creditsGained}`));
      loot.appendChild(row(t('result.loot.power'), `+${st.combatPower}`, 'power'));
      if (st.overflow > 0) {
        loot.appendChild(row(t('result.loot.overflow'), t('result.loot.overflowVal', { n: st.overflow })));
      }
      this.root.appendChild(loot);

      // 획득 장비 목록(등급별 색상 칩). 없으면 안내 문구.
      const lootTitle = document.createElement('div');
      lootTitle.className = 'pb-loot-title';
      lootTitle.textContent = t('result.drops.title');
      this.root.appendChild(lootTitle);

      if (st.drops.length === 0) {
        const none = document.createElement('div');
        none.className = 'pb-drops-none';
        none.textContent = t('result.drops.none');
        this.root.appendChild(none);
      } else {
        const chips = document.createElement('div');
        chips.className = 'pb-drops';
        for (const d of st.drops.slice(0, MAX_DROP_CHIPS)) {
          const chip = document.createElement('span');
          chip.className = 'pb-chip';
          chip.style.color = RARITY_COLOR[d.rarity];
          chip.textContent = dropName(d);
          chips.appendChild(chip);
        }
        if (st.drops.length > MAX_DROP_CHIPS) {
          const more = document.createElement('span');
          more.className = 'pb-drops-none';
          more.textContent = t('result.drops.more', { n: st.drops.length - MAX_DROP_CHIPS });
          chips.appendChild(more);
        }
        this.root.appendChild(chips);
      }
    }

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '12px';
    if (onInventory !== undefined) {
      const invBtn = document.createElement('button');
      invBtn.textContent = t('result.btn.inventory');
      invBtn.style.background = 'linear-gradient(90deg,#8896b8,#aab6d6)';
      invBtn.addEventListener('click', onInventory);
      buttons.appendChild(invBtn);
    }
    const btn = document.createElement('button');
    btn.textContent = t('result.btn.restart');
    btn.addEventListener('click', onRestart);
    buttons.appendChild(btn);
    this.root.appendChild(buttons);

    this.root.style.display = 'flex';
  }

  hide(): void {
    this.shown = false;
    this.root.style.display = 'none';
  }
}
