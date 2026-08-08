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
import { slotLabel, weaponKindLabel } from './itemNames.js';
import { bossName } from './bossLabels.js';
import type { Item, Rarity, SlotKind } from '../items/types.js';

/** 정산 화면에 표시할 획득 장비 1개(표시 전용 요약). */
export interface ResultDrop {
  rarity: Rarity;
  slot: SlotKind;
  /** 주무기 종류 코드(0..2) — `main` 슬롯일 때만. */
  weaponType?: number;
  /**
   * 확정된 실물 아이템(사용자 요청 2026-07-26 — 정산 획득 장비 hover 상세 팝업).
   *
   * 이 요약이 등급·슬롯만 담고 있어 툴팁이 "코어 · 매직" 두 줄에서 멈췄고, 무엇을 주웠는지
   * 격납고에 들어가 봐야만 알 수 있었다. 어픽스·요구 레벨·전투력을 그 자리에서 읽히게 하려면
   * 정산이 이미 손에 쥔 `Item` 을 그대로 넘겨주는 것이 가장 단순하다(재도출·재조회 없음).
   *
   * **optional** 이라 이 필드를 채우지 않는 호출부(구 경로·테스트 픽스처)는 무영향이고,
   * 툴팁은 기존 최소 표시로 우아하게 내려앉는다. 표시 전용이며 sim·세이브와 무관하다.
   */
  item?: Item;
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
  /** 이번 런에 얻은 촉매 총량(ADR-0029). > 0 일 때만 정산 항목으로 표시. */
  catalystDrops?: number;
  /**
   * 이번 런에 얻은 촉매의 **내역**(id + 수량, `catalystDropsFromRun` 결과 그대로).
   *
   * 총량만 있던 시절에는 정산이 "촉매 +3" 이라고만 말해서 **무엇을** 얻었는지 알 수 없었고,
   * 확인하려면 촉매 재고 화면까지 가야 했다(사용자 요청 2026-07-28). 정산 화면이 이 목록을
   * 개별 아이콘 칩으로 편다. 비었거나 없으면 칩 줄 자체를 그리지 않는다.
   */
  catalystDropList?: readonly { readonly id: number; readonly qty: number }[];
  /**
   * `id 18 mercantile` 이 **런 자원에서 갚은** 액수(ADR-0052). > 0 일 때만 줄이 선다.
   *
   * ⚠️ {@link SettlementSummary.debtSeized} 와 **반드시 갈려 보여야 한다**(명세의 `신호:` 칸).
   * 한 줄로 합치면 "자원이 왜 줄었나"와 "장비가 왜 사라졌나"가 구분되지 않고, 그러면 빚 카드를
   * 받을지 말지가 정보 없는 도박이 된다.
   */
  debtRepaid?: number;
  /** 미상환분 때문에 **이 런의 전리품에서** 압류된 점수. > 0 일 때만 줄이 선다. */
  debtSeized?: number;
}

/**
 * 의뢰 확정 지급물 판정 표시(의뢰서 시스템 Phase E — 서버 계약 §7).
 *
 * 런 종료 순간에는 아직 알 수 없다(`verify-commission` 왕복이 필요) — 그래서 `pending` 으로
 * 시작해 응답이 오면 `ResultOverlayScreen.updateCommission()` 이 갈아끼운다.
 */
export interface CommissionResultInfo {
  /**
   * `unconfigured` = 서버 미설정(오프라인, 제출 자체가 불가) · `queued` = 전송 실패로 대기
   * 큐에 남음(다음 기회에 재시도) · `lost` = 전송도 실패하고 **큐 저장까지 실패**(쿼터 초과 등)
   * 해 재시도 기회가 없다. `queued` 와 `lost` 를 같은 문구로 말하면 안 된다 — 전자는 "나중에
   * 다시 시도됨"이고 후자는 "제출하지 못했다"이다.
   */
  status: 'pending' | 'verified' | 'rejected' | 'queued' | 'lost' | 'unconfigured';
  /** `status === 'verified'` 일 때만 의미가 있다. */
  grantedCredits?: number;
  /** `status === 'verified'` 일 때만 의미가 있다. */
  grantedMinerals?: number;
  /**
   * 종이에 적힌 **확정 경험치**(`commissionXpReward`). `status === 'verified'` 일 때만 의미가
   * 있다 — 재화와 달리 서버 원장이 없어 클라가 승인 직후 활성 기체에 적립한다.
   */
  grantedXp?: number;
  /** 그 적립으로 오른 레벨 수(0 이면 문구에서 뺀다). */
  xpLevels?: number;
  /** `status === 'rejected'` 일 때 서버 거부 사유(원문 — 고정 매핑표를 두지 않는다). */
  reason?: string;
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
  /**
   * 이 런의 행성 인덱스. 승리 문구가 **격파한 보스 이름**을 여기서 파생한다 — 예전에는
   * 카르곤 보스가 문구에 박혀 있어 어느 행성을 정복해도 "용암 요새 전차" 였다
   * (사용자 신고 2026-07-27, HUD 체력바 머리글과 같은 뿌리).
   */
  planet?: number;
  /** Present once the run has been settled into the profile (M2). */
  settlement?: SettlementSummary;
  /**
   * 의뢰 런일 때만 설정한다(의뢰서 시스템 Phase E). 무의뢰 런은 항상 `undefined` 라 이 축이
   * 화면에 전혀 나타나지 않는다(조건부 스탬프 규율과 같은 결).
   */
  commission?: CommissionResultInfo;
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

/**
 * 장비 1개의 표시 이름(주무기는 무기 종류, 그 외는 슬롯명 — i18n).
 * Pixi 판(`src/ui/pixi/resultOverlay.ts`)이 그대로 import 한다 — 이름 규칙이 두 벌로
 * 갈리면 같은 드랍이 화면마다 다른 이름으로 보인다.
 */
export function dropName(d: ResultDrop): string {
  // 무기(주/보조)는 종류명으로 부른다 — `itemNames.ts` 단일 정본(사용자 요청 2026-07-27:
  // "무기일 경우 유도탄/빔 등 장비 이름"). 슬롯명은 부제가 따로 말하므로 여기선 종류만 쓴다.
  const kind = weaponKindLabel(d);
  return kind ?? slotLabel(d.slot);
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
    sub.textContent = s.victory
      ? t('result.win.sub', { name: bossName(s.planet) })
      : t('result.lose.sub');
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
      // `id 18 mercantile` — 상환분과 압류분은 **두 줄로 갈라** 적는다(SettlementSummary 주석).
      if (st.debtRepaid !== undefined && st.debtRepaid > 0) {
        loot.appendChild(row(t('result.loot.debtRepaid'), `-${st.debtRepaid}`));
      }
      if (st.debtSeized !== undefined && st.debtSeized > 0) {
        loot.appendChild(
          row(t('result.loot.debtSeized'), t('result.loot.debtSeizedVal', { n: st.debtSeized })),
        );
      }
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
