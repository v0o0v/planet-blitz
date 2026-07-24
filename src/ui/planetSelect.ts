/**
 * Star-map / planet-select overlay (DOM — 레거시. 실사용은 Pixi 판 `pixi/planetSelect.ts`).
 *
 * The pre-run screen: pick a planet (data-driven from data/planets.ts) and 침략 단계
 * (ADR-0022 — 행성별 1..개방 상한). "출격" hands a `LaunchSelection` back to the caller,
 * which assembles the WorldConfig (planet/stage + loadout). 촉매 주입(ADR-0029)은 Lane 4 픽커
 * 소관 — 이 레거시 DOM 판에는 아직 없다(Pixi 판 자리에 얹힌다).
 *
 * Pure view: never touches the simulation.
 */

import { PLANETS, planetById } from '../../data/planets.js';
import { stageOpenCap } from '../../data/waves.js';
import { t } from '../i18n/index.js';

/** What the player chose on the star map. */
export interface LaunchSelection {
  planet: number;
  /** 침략 단계(1..개방 상한, ADR-0022). */
  stage: number;
  /** 보스 이전 일반 세그먼트 수 상한(튜토리얼 단축판). absent = 풀 런. */
  maxSegments?: number;
}

/** 선택한 행성의 개방 상한을 산정하는 콜백(행성별 최고 클리어 단계 → 상한). */
export type BestStageClearedFn = (planet: number) => number;

const STYLE = `
#pb-planet { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; background:radial-gradient(circle at 50% 30%,#0a1226,#03050c 70%); font-family:'Segoe UI',system-ui,sans-serif; z-index:25; overflow:auto; }
#pb-planet h1 { margin:0; color:#7affea; font-size:30px; font-weight:900; letter-spacing:3px; text-shadow:0 3px 12px #000; }
#pb-planet .pb-subtitle { color:#8896b8; font-size:14px; margin-top:-8px; }
#pb-planet .pb-planets { display:flex; gap:20px; }
#pb-planet .pb-planet-card { width:230px; padding:20px; background:linear-gradient(160deg,#131a2e,#0b1020); border:2px solid #2a3552; border-radius:16px; cursor:pointer; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease; }
#pb-planet .pb-planet-card:hover { transform:translateY(-4px); }
#pb-planet .pb-planet-card.sel { border-color:#4cd7ff; box-shadow:0 8px 28px rgba(76,215,255,.3); }
#pb-planet .pb-orb { width:88px; height:88px; margin:0 auto 12px; border-radius:50%; box-shadow:0 0 30px 4px rgba(0,0,0,.5) inset, 0 0 22px 2px currentColor; }
#pb-planet .pb-planet-name { color:#fff; font-size:20px; font-weight:800; }
#pb-planet .pb-planet-sub { color:#aab6d6; font-size:13px; margin-top:6px; }
#pb-planet .pb-row { display:flex; gap:10px; align-items:center; }
#pb-planet .pb-seg { display:flex; gap:8px; }
#pb-planet .pb-seg button { pointer-events:auto; cursor:pointer; padding:8px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:10px; transition:all .1s ease; }
#pb-planet .pb-seg button.sel { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border-color:transparent; }
#pb-planet .pb-seg button.locked { opacity:.45; cursor:not-allowed; border-style:dashed; }
#pb-planet .pb-tierdesc { color:#8896b8; font-size:12px; min-height:16px; }
#pb-planet .pb-launch { pointer-events:auto; cursor:pointer; margin-top:6px; padding:13px 46px; font-size:17px; font-weight:900; letter-spacing:2px; color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border:none; border-radius:12px; transition:transform .1s ease,box-shadow .1s ease; }
#pb-planet .pb-launch:hover { transform:translateY(-2px); box-shadow:0 8px 26px rgba(76,215,255,.4); }
#pb-planet .pb-meta { color:#68789c; font-size:12px; }
#pb-planet .pb-inv-btn { pointer-events:auto; cursor:pointer; padding:9px 20px; font-size:13px; font-weight:700; color:#aab6d6; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:10px; }
#pb-planet .pb-inv-btn:hover { border-color:#4cd7ff; color:#fff; }
`;

export class PlanetSelect {
  private readonly root: HTMLElement;
  private planet = 0;
  /** 선택된 침략 단계(1..개방 상한). */
  private stage = 1;
  /** 행성별 개방 상한 산정 콜백(미지정 = 최고 클리어 0 → 상한 10). */
  private bestStageCleared: BestStageClearedFn = () => 0;
  private onLaunch: ((sel: LaunchSelection) => void) | null = null;
  private onInventory: (() => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-planet';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Show the star map for an upcoming run.
   * @param meta a short status line (credits / active ship level).
   */
  show(
    opts: {
      meta: string;
      /** 행성별 개방 상한 산정 콜백(ADR-0022). 생략 시 최고 클리어 0(상한 10). */
      bestStageCleared?: BestStageClearedFn;
      onLaunch: (sel: LaunchSelection) => void;
      onInventory: () => void;
      /** Optional "back to base map" affordance (plan D1 왕복 동선). */
      onBack?: () => void;
    },
  ): void {
    this.bestStageCleared = opts.bestStageCleared ?? (() => 0);
    // 선택 단계를 현재 행성 개방 상한으로 클램프한다.
    this.stage = this.clampStage(this.stage);
    this.onLaunch = opts.onLaunch;
    this.onInventory = opts.onInventory;
    this.onBack = opts.onBack ?? null;
    this.render(opts.meta);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onLaunch = null;
    this.onInventory = null;
    this.onBack = null;
  }

  /** 현재 선택 행성의 개방 상한(max(10, 최고 클리어 + 5)). */
  private openCap(): number {
    return stageOpenCap(this.bestStageCleared(this.planet));
  }

  /** 단계를 [1, 개방 상한]으로 클램프한다. */
  private clampStage(stage: number): number {
    const cap = this.openCap();
    return stage < 1 ? 1 : stage > cap ? cap : stage;
  }

  private render(meta: string): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('planet.title');
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-subtitle';
    sub.textContent = t('planet.sub');
    this.root.appendChild(sub);

    // Planet cards.
    const planets = document.createElement('div');
    planets.className = 'pb-planets';
    for (const p of PLANETS) {
      const card = document.createElement('div');
      card.className = `pb-planet-card${p.id === this.planet ? ' sel' : ''}`;
      const orb = document.createElement('div');
      orb.className = 'pb-orb';
      orb.style.color = p.accent;
      orb.style.background = `radial-gradient(circle at 35% 30%, ${p.accent}, #05060a)`;
      const name = document.createElement('div');
      name.className = 'pb-planet-name';
      name.textContent = p.name;
      const psub = document.createElement('div');
      psub.className = 'pb-planet-sub';
      psub.textContent = p.subtitle;
      card.appendChild(orb);
      card.appendChild(name);
      card.appendChild(psub);
      card.addEventListener('click', () => {
        this.planet = p.id;
        // 행성마다 개방 상한이 다르므로 선택 단계를 새 행성 상한으로 클램프한다.
        this.stage = this.clampStage(this.stage);
        this.render(meta);
      });
      planets.appendChild(card);
    }
    this.root.appendChild(planets);

    // 침략 단계 스텝퍼(± 버튼 + 현재 단계, 1..개방 상한 클램프).
    const cap = this.openCap();
    const stageRow = document.createElement('div');
    stageRow.className = 'pb-row';
    const stageLabel = document.createElement('span');
    stageLabel.className = 'pb-meta';
    stageLabel.textContent = t('planet.stageLabel');
    const seg = document.createElement('div');
    seg.className = 'pb-seg';
    const dec = document.createElement('button');
    dec.textContent = '−';
    dec.addEventListener('click', () => {
      this.stage = this.clampStage(this.stage - 1);
      this.render(meta);
    });
    const cur = document.createElement('button');
    cur.className = 'sel';
    cur.textContent = String(this.stage);
    const inc = document.createElement('button');
    inc.textContent = '+';
    inc.addEventListener('click', () => {
      this.stage = this.clampStage(this.stage + 1);
      this.render(meta);
    });
    seg.appendChild(dec);
    seg.appendChild(cur);
    seg.appendChild(inc);
    stageRow.appendChild(stageLabel);
    stageRow.appendChild(seg);
    this.root.appendChild(stageRow);
    const stageDesc = document.createElement('div');
    stageDesc.className = 'pb-tierdesc';
    stageDesc.textContent = t('planet.stageDesc', { stage: this.stage, cap });
    this.root.appendChild(stageDesc);

    // 촉매 주입 패널(변칙 패널 자리, ADR-0029)은 Lane 4 픽커가 얹는다 — 이 레거시 DOM 판엔 없다.

    // Actions.
    const actions = document.createElement('div');
    actions.className = 'pb-row';
    if (this.onBack !== null) {
      const backBtn = document.createElement('button');
      backBtn.className = 'pb-inv-btn';
      backBtn.textContent = t('planet.back');
      backBtn.addEventListener('click', () => {
        const cb = this.onBack;
        this.hide();
        cb?.();
      });
      actions.appendChild(backBtn);
    }
    const invBtn = document.createElement('button');
    invBtn.className = 'pb-inv-btn';
    invBtn.textContent = t('planet.inventory');
    invBtn.addEventListener('click', () => this.onInventory?.());
    const launch = document.createElement('button');
    launch.className = 'pb-launch';
    launch.textContent = t('planet.launch', { name: planetById(this.planet).name });
    launch.addEventListener('click', () => {
      const cb = this.onLaunch;
      this.hide();
      cb?.({
        planet: this.planet,
        stage: this.stage,
      });
    });
    actions.appendChild(invBtn);
    actions.appendChild(launch);
    this.root.appendChild(actions);

    const metaEl = document.createElement('div');
    metaEl.className = 'pb-meta';
    metaEl.textContent = meta;
    this.root.appendChild(metaEl);
  }
}
