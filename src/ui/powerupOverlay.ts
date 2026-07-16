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
#pb-powerup .pb-name { color:#fff; font-size:19px; font-weight:800; margin-bottom:10px; }
#pb-powerup .pb-desc { color:#aab6d6; font-size:14px; line-height:1.5; }
#pb-powerup.picked .pb-card { cursor:default; }
#pb-powerup.picked .pb-card:not(.chosen) { opacity:.4; }
#pb-powerup.picked .pb-card:hover { transform:none; border-color:#2a3552; box-shadow:none; }
#pb-powerup .pb-card.chosen { border-color:#7affea; box-shadow:0 0 24px rgba(122,255,234,.4); }
#pb-powerup .pb-hint { color:#68789c; font-size:12px; letter-spacing:1px; }
`;

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
    title.textContent = '레벨 업! — 강화를 선택하라';
    this.statusBar = document.createElement('div');
    this.statusBar.className = 'pb-status';
    this.cards = document.createElement('div');
    this.cards.className = 'pb-cards';
    this.hint = document.createElement('div');
    this.hint.className = 'pb-hint';
    this.hint.textContent = '클릭 또는 숫자 키';
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
      card.setAttribute('aria-label', `${offerIndex + 1}번 강화: ${def?.name ?? ''} — ${def?.desc ?? ''}`);

      if (rel.label !== '') {
        const badge = document.createElement('div');
        badge.className = `pb-badge${rel.matchesWeapon ? ' match' : ''}`;
        badge.textContent = rel.label;
        card.appendChild(badge);
      }

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
    // 힌트를 오퍼 수에 맞춰 갱신(도박사 칩 4장 대응).
    const keys = choices.map((_, i) => String(i + 1)).join(' / ');
    this.hint.textContent = `클릭 또는 ${keys} 키`;
    this.root.style.display = 'flex';
  }

  /** 현재 빌드 상태 바를 렌더(레벨업 선택 판단용, 표시 전용). */
  private renderStatus(s: BuildStatus): void {
    const items: { label: string; value: string; cls?: string }[] = [
      { label: '무기', value: s.weaponName, cls: 'wpn' },
      { label: 'Lv', value: String(s.level) },
      { label: '데미지', value: String(s.damage) },
      { label: '탄환', value: String(s.bulletCount) },
      { label: '연사', value: `${s.shotsPerSec}/s` },
      { label: '관통', value: String(s.pierce) },
      { label: '확산', value: `${s.spreadDeg}°` },
      { label: '이동', value: String(s.moveSpeed) },
      { label: '대시', value: `${(s.dashCooldownTicks / 60).toFixed(1)}s` },
      { label: 'HP', value: `${s.hp}/${s.maxHp}` },
      { label: '자석', value: String(s.magnetRadius) },
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
