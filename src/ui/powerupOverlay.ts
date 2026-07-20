/**
 * Level-up powerup pick overlay (DOM — plan task 13).
 *
 * Shown while the sim is frozen on a pending level-up. The render loop keeps
 * running underneath (the freeze stalls sim ticks, not the display), so the
 * three cards animate over the live arena. Picking (click or keys 1/2/3) reports
 * the chosen offer index back to the caller, which queues it as the next input
 * frame's SPECIAL_POWERUP_PICK — keeping the choice on the replay log.
 *
 * 표시/숨김은 이 오버레이가 스스로 토글하지 않는다. 렌더 루프가 sim의
 * `pendingLevelUp`을 근거로 show/hide를 구동한다({@link levelUpOverlayAction}).
 * 클릭 시 낙관적으로 숨기면 `pendingLevelUp`이 아직 참인 프레임에 재표시되며
 * 오버레이가 뒤에서 진행되는 게임 위에 고아로 남는 레이스가 생겼기 때문이다. 픽은
 * 다음 sim 틱에서 소비되어 `pendingLevelUp`을 내리고, 그때 렌더 루프가 숨긴다.
 */

import { POWERUPS } from '../sim/powerups.js';
import { choiceRelevance, type BuildStatus } from './buildStatus.js';
import { powerupIconKeys } from './powerupIcons.js';
import { iconUrl, pixelIcon } from './uiIcons.js';
import { t } from '../i18n/index.js';

/** 카드 바탕 스탯 아이콘 한 변(px). 원본 PNG 가 64px 라 1:1 — 확대하면 픽셀이 갈린다. */
const ICON_SIZE = 64;
/**
 * 우하단 무기 배지 한 변(px). 26px 에서는 네 무기(스프레드·레일건·미사일·빔)가 전부
 * "금·탄 대각선 총열"로 뭉개져 구별되지 않았다 — 키 조합 충돌은 0 인데 지각 충돌이 남았다.
 *
 * 32px 인 이유는 두 가지다. ① 64px 원본의 정확히 1/2 이라 nearest 축소가 픽셀을 2:1 로
 * 깨끗이 접는다(26px 은 2.46:1 이라 인접 픽셀이 불규칙하게 버려져 실루엣이 뭉개진다).
 * ② 그러고도 바탕 아이콘을 더 가리지 않는다 — 칩 전체가 40px 이 되지만 바깥으로 12px
 * 밀어내서 실제 가림은 28×28(바탕의 19%, 기존 26×26=16.5%)이고 중심(32,32)은 4px 여유로
 * 열려 있다.
 */
const BADGE_SIZE = 32;
/** 배지 칩을 아이콘 상자 밖으로 밀어내는 양(px) — 중심 실루엣을 비우기 위한 값. */
const BADGE_OFFSET = 12;

const STYLE = `
#pb-powerup { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; background:rgba(4,6,14,.72); backdrop-filter:blur(2px); font-family:'Segoe UI',system-ui,sans-serif; z-index:20; }
#pb-powerup h2 { color:#7affea; font-size:26px; font-weight:800; letter-spacing:2px; margin:0; text-shadow:0 2px 8px #000; }
#pb-powerup .pb-status { display:flex; flex-wrap:wrap; gap:6px 14px; justify-content:center; max-width:720px; padding:12px 18px; background:linear-gradient(160deg,#0f1626,#0a0e1a); border:1px solid #223052; border-radius:12px; }
#pb-powerup .pb-status .st { color:#aab6d6; font-size:13px; white-space:nowrap; }
#pb-powerup .pb-status .st b { color:#e8f0ff; font-weight:700; }
#pb-powerup .pb-status .st.wpn b { color:#7affea; }
#pb-powerup .pb-cards { display:flex; gap:20px; }
#pb-powerup .pb-card { position:relative; width:220px; padding:20px 18px 18px; background:linear-gradient(160deg,#141a2e,#0d1120); border:2px solid #2a3552; border-radius:14px; cursor:pointer; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease,opacity .1s ease; }
#pb-powerup .pb-card:hover { transform:translateY(-6px); border-color:#4cd7ff; box-shadow:0 10px 30px rgba(76,215,255,.25); }
#pb-powerup .pb-card.match { border-color:#7affea; }
#pb-powerup .pb-key { display:inline-block; width:26px; height:26px; line-height:26px; border-radius:6px; background:#4cd7ff; color:#04121a; font-weight:800; margin-bottom:10px; }
#pb-powerup .pb-badge { position:absolute; top:10px; right:10px; font-size:10px; font-weight:700; letter-spacing:.5px; color:#8896b8; background:#1a2340; border:1px solid #2a3552; border-radius:5px; padding:2px 6px; }
#pb-powerup .pb-badge.match { color:#04121a; background:#7affea; border-color:#7affea; }
#pb-powerup .pb-icon { position:relative; width:${ICON_SIZE}px; height:${ICON_SIZE}px; margin:0 auto 10px; }
#pb-powerup .pb-icon img { display:block; }
#pb-powerup .pb-wbadge { position:absolute; right:-${BADGE_OFFSET}px; bottom:-${BADGE_OFFSET}px; padding:2px; background:#03050c; border:2px solid #9db3e0; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.8); }
#pb-powerup .pb-name { color:#fff; font-size:19px; font-weight:800; margin-bottom:10px; }
#pb-powerup .pb-desc { color:#aab6d6; font-size:14px; line-height:1.5; }
#pb-powerup.picked .pb-card { cursor:default; }
#pb-powerup.picked .pb-card:not(.chosen) { opacity:.4; }
#pb-powerup.picked .pb-card:hover { transform:none; border-color:#2a3552; box-shadow:none; }
#pb-powerup .pb-card.chosen { border-color:#7affea; box-shadow:0 0 24px rgba(122,255,234,.4); }
#pb-powerup .pb-hint { color:#68789c; font-size:12px; letter-spacing:1px; }
`;

/**
 * 카드 아이콘 블록(스탯 아이콘 + 무기 배지)을 만든다.
 *
 * 아이콘 PNG 가 아직 없을 수 있으므로 자산이 없으면 `null` 을 돌려주고 카드는 기존
 * 이름/설명 텍스트만으로 성립한다(자산이 빠져도 화면이 죽지 않는다). 배지만 없을
 * 때는 스탯 아이콘만 표시한다.
 */
function buildIcon(poolIndex: number, alt: string): HTMLElement | null {
  const keys = powerupIconKeys(poolIndex);
  if (keys === undefined) return null;
  const statUrl = iconUrl(keys.statKey);
  if (statUrl === undefined) return null;

  const box = document.createElement('div');
  box.className = 'pb-icon';
  box.appendChild(pixelIcon(statUrl, ICON_SIZE, alt));

  const badgeUrl = keys.badgeKey !== undefined ? iconUrl(keys.badgeKey) : undefined;
  if (badgeUrl !== undefined) {
    const badge = document.createElement('div');
    badge.className = 'pb-wbadge';
    badge.appendChild(pixelIcon(badgeUrl, BADGE_SIZE));
    box.appendChild(badge);
  }
  return box;
}

export class PowerupOverlay {
  private readonly root: HTMLElement;
  private readonly statusBar: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly hint: HTMLElement;
  private onPick: ((offerIndex: number) => void) | null = null;
  private offered: number[] = [];
  /** 이번 표시에서 이미 선택이 이뤄졌는지(중복 픽·재표시 전 추가 클릭 차단). */
  private picked = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-powerup';
    this.root.style.display = 'none';
    const title = document.createElement('h2');
    title.textContent = t('powerup.title');
    this.statusBar = document.createElement('div');
    this.statusBar.className = 'pb-status';
    this.cards = document.createElement('div');
    this.cards.className = 'pb-cards';
    this.hint = document.createElement('div');
    this.hint.className = 'pb-hint';
    this.hint.textContent = t('powerup.hint', { keys: '1 / 2 / 3' });
    this.root.appendChild(title);
    this.root.appendChild(this.statusBar);
    this.root.appendChild(this.cards);
    this.root.appendChild(this.hint);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.visible || this.picked) return;
    // 도박사 칩(오퍼 4장)까지 커버하도록 4번 키도 매핑(offered.length로 게이트).
    const map: Record<string, number> = {
      Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
      Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3,
    };
    const idx = map[e.code];
    if (idx !== undefined && idx < this.offered.length) {
      e.preventDefault();
      this.pick(idx);
    }
  };

  /**
   * 선택을 보고한다. 오버레이를 여기서 숨기지 않는다 — 픽을 큐에 넣고 시각적으로
   * "선택됨"만 표시하며, 실제 숨김은 sim이 `pendingLevelUp`을 내린 뒤 렌더 루프가 한다.
   */
  private pick(offerIndex: number): void {
    if (this.picked) return; // 중복 클릭·재입력 방지(픽은 한 번만).
    this.picked = true;
    this.root.classList.add('picked');
    const chosen = this.cards.children[offerIndex];
    if (chosen !== undefined) chosen.classList.add('chosen');
    if (this.onPick !== null) this.onPick(offerIndex);
  }

  /** Show the three offered powerups (pool indices) + the current build status. */
  show(choices: number[], status: BuildStatus, onPick: (offerIndex: number) => void): void {
    this.offered = choices.slice();
    this.onPick = onPick;
    this.picked = false;
    this.root.classList.remove('picked');
    this.renderStatus(status);

    this.cards.innerHTML = '';
    choices.forEach((poolIndex, offerIndex) => {
      const def = POWERUPS[poolIndex];
      const rel = choiceRelevance(poolIndex, status.weaponType);
      const card = document.createElement('div');
      card.className = `pb-card${rel.matchesWeapon ? ' match' : ''}`;
      // 최소 접근성: 스크린리더가 카드를 버튼으로 인식하고 이름을 읽도록.
      card.setAttribute('role', 'button');
      card.setAttribute(
        'aria-label',
        t('powerup.aria', { n: offerIndex + 1, name: def?.name ?? '', desc: def?.desc ?? '' }),
      );

      if (rel.label !== '') {
        const badge = document.createElement('div');
        badge.className = `pb-badge${rel.matchesWeapon ? ' match' : ''}`;
        badge.textContent = rel.label;
        card.appendChild(badge);
      }

      const key = document.createElement('div');
      key.className = 'pb-key';
      key.textContent = String(offerIndex + 1);
      const icon = buildIcon(poolIndex, def?.name ?? '');
      const name = document.createElement('div');
      name.className = 'pb-name';
      name.textContent = def?.name ?? '???';
      const desc = document.createElement('div');
      desc.className = 'pb-desc';
      desc.textContent = def?.desc ?? '';
      card.appendChild(key);
      if (icon !== null) card.appendChild(icon);
      card.appendChild(name);
      card.appendChild(desc);
      card.addEventListener('click', () => this.pick(offerIndex));
      this.cards.appendChild(card);
    });
    // 힌트를 오퍼 수에 맞춰 갱신(도박사 칩 4장 대응).
    const keys = choices.map((_, i) => String(i + 1)).join(' / ');
    this.hint.textContent = t('powerup.hint', { keys });
    this.root.style.display = 'flex';
  }

  /** 현재 빌드 상태 바를 렌더(레벨업 선택 판단용, 표시 전용). */
  private renderStatus(s: BuildStatus): void {
    const items: { label: string; value: string; cls?: string }[] = [
      { label: t('powerup.stat.weapon'), value: s.weaponName, cls: 'wpn' },
      { label: t('powerup.stat.level'), value: String(s.level) },
      { label: t('powerup.stat.damage'), value: String(s.damage) },
      { label: t('powerup.stat.bullets'), value: String(s.bulletCount) },
      { label: t('powerup.stat.fire'), value: `${s.shotsPerSec}/s` },
      { label: t('powerup.stat.pierce'), value: String(s.pierce) },
      { label: t('powerup.stat.spread'), value: `${s.spreadDeg}°` },
      { label: t('powerup.stat.move'), value: String(s.moveSpeed) },
      { label: t('powerup.stat.dash'), value: `${(s.dashCooldownTicks / 60).toFixed(1)}s` },
      { label: t('powerup.stat.hp'), value: `${s.hp}/${s.maxHp}` },
      { label: t('powerup.stat.magnet'), value: String(s.magnetRadius) },
    ];
    this.statusBar.innerHTML = '';
    for (const it of items) {
      const el = document.createElement('span');
      el.className = `st${it.cls !== undefined ? ` ${it.cls}` : ''}`;
      const b = document.createElement('b');
      b.textContent = it.value;
      el.append(`${it.label} `, b);
      this.statusBar.appendChild(el);
    }
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.classList.remove('picked');
    this.onPick = null;
    this.offered = [];
    this.picked = false;
  }
}
