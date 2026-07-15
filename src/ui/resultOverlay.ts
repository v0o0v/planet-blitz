/**
 * Run settlement overlay (DOM — plan task 16).
 *
 * Shown when a run ends: victory (boss defeated) or defeat (HP 0). On defeat the
 * pilot comically ejects and parachutes down — a pure render/DOM flourish with
 * zero simulation impact (spec: humour softens the loss). Reports the seed, XP,
 * kills, max combo and resources so a run is legible, plus a restart button.
 */

export interface ResultState {
  victory: boolean;
  seed: number;
  xpTotal: number;
  kills: number;
  maxCombo: number;
  resources: number;
  level: number;
  timeSec: number;
}

const STYLE = `
#pb-result { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; background:rgba(3,5,12,.82); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:30; overflow:hidden; }
#pb-result .pb-eject { font-size:56px; animation:pb-para 2.6s ease-in-out infinite; }
@keyframes pb-para { 0%{ transform:translateY(-24px) rotate(-8deg);} 50%{ transform:translateY(8px) rotate(8deg);} 100%{ transform:translateY(-24px) rotate(-8deg);} }
#pb-result h1 { margin:6px 0; font-size:40px; font-weight:900; letter-spacing:3px; text-shadow:0 3px 12px #000; }
#pb-result h1.win { color:#7affea; } #pb-result h1.lose { color:#ff6a7a; }
#pb-result .pb-sub { color:#aab6d6; font-size:15px; margin-bottom:14px; }
#pb-result .pb-stats { display:grid; grid-template-columns:auto auto; gap:8px 26px; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:12px; padding:20px 30px; }
#pb-result .pb-stats .k { color:#8896b8; font-size:14px; text-align:right; }
#pb-result .pb-stats .v { color:#fff; font-size:16px; font-weight:700; }
#pb-result button { margin-top:22px; pointer-events:auto; cursor:pointer; padding:12px 34px; font-size:16px; font-weight:800; letter-spacing:1px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:10px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-result button:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(76,215,255,.35); }
`;

function row(k: string, v: string): HTMLElement {
  const frag = document.createElement('div');
  frag.className = 'pb-rowwrap';
  frag.style.display = 'contents';
  const kEl = document.createElement('div');
  kEl.className = 'k';
  kEl.textContent = k;
  const vEl = document.createElement('div');
  vEl.className = 'v';
  vEl.textContent = v;
  frag.appendChild(kEl);
  frag.appendChild(vEl);
  return frag;
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

  show(s: ResultState, onRestart: () => void): void {
    if (this.shown) return;
    this.shown = true;
    this.root.innerHTML = '';

    if (!s.victory) {
      const eject = document.createElement('div');
      eject.className = 'pb-eject';
      eject.textContent = '🪂';
      this.root.appendChild(eject);
    } else {
      const trophy = document.createElement('div');
      trophy.className = 'pb-eject';
      trophy.textContent = '🏆';
      this.root.appendChild(trophy);
    }

    const h1 = document.createElement('h1');
    h1.className = s.victory ? 'win' : 'lose';
    h1.textContent = s.victory ? '행성 정복!' : '격추당했다…';
    this.root.appendChild(h1);

    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = s.victory
      ? '용암 요새 전차를 격파했다.'
      : '파일럿은 무사히 사출했다. 다시 출격하자.';
    this.root.appendChild(sub);

    const min = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    const stats = document.createElement('div');
    stats.className = 'pb-stats';
    stats.appendChild(row('생존 시간', `${min}:${sec.toString().padStart(2, '0')}`));
    stats.appendChild(row('도달 레벨', `Lv ${s.level}`));
    stats.appendChild(row('획득 경험치', `${s.xpTotal}`));
    stats.appendChild(row('처치 수', `${s.kills}`));
    stats.appendChild(row('최대 콤보', `${s.maxCombo}`));
    stats.appendChild(row('보급 자원', `${s.resources}`));
    stats.appendChild(row('시드', `${s.seed}`));
    this.root.appendChild(stats);

    const btn = document.createElement('button');
    btn.textContent = '다시 출격';
    btn.addEventListener('click', onRestart);
    this.root.appendChild(btn);

    this.root.style.display = 'flex';
  }

  hide(): void {
    this.shown = false;
    this.root.style.display = 'none';
  }
}
