/**
 * DOM HUD overlay (ADR-0001: RPG/UI is DOM, not canvas).
 *
 * M1 Phase 3 HUD: HP bar, XP/level bar, run timer, combo multiplier, and a boss
 * health bar with phase markers + overheat indicator. The debug telemetry line
 * (`set`) from Phase 1 is kept for development and reused by the bench scene.
 *
 * The HUD is a pure view: `update` is called each frame with a plain snapshot of
 * numbers pulled from sim state — it never touches the simulation itself.
 */

import { t } from '../i18n/index.js';
import type { BossProgress } from '../sim/bossProgress.js';
import type { InvasionHudState } from './invasionProgress.js';
import type { RunObjectiveState } from './runObjective.js';
import type { WorldState } from '../sim/world.js';
import {
  ACTIVES_BY_SHIP,
  activeByWireId,
  activeCooldownTicks,
  investedInTree,
} from '../../data/ships/actives/index.js';
import {
  ACTIVE_SLOT_COUNT,
  activeSkillIconName,
  activeSkillNameKey,
} from '../../data/ships/actives/types.js';
import { SHIP_TYPES } from '../../data/ships/index.js';
import { uiAssetUrl } from './pixi/uiTextures.js';
import { tShipKey } from './pixi/shipLabels.js';

export interface BossHudState {
  hp: number;
  maxHp: number;
  /** Phase index 0/1/2. */
  phase: number;
  /** Overheat window open (takes double damage). */
  overheat: boolean;
  /** Phase-transition animation in progress. */
  transitioning: boolean;
  /**
   * 체력바 머리글(`행성 · 보스`). **런의 행성에서 파생해 호출부가 넣는다**
   * (`src/ui/bossLabels.ts` bossHudName). 예전에는 생성자에서 카르곤 보스를 하드코딩하고
   * 한 번도 갱신하지 않아 어느 행성을 돌아도 "카르곤 · 용암 요새 전차" 가 떴다
   * (사용자 신고 2026-07-27).
   */
  name: string;
}

export interface HudState {
  hp: number;
  maxHp: number;
  xp: number;
  xpNeed: number;
  level: number;
  timeSec: number;
  combo: number;
  multiplier: number;
  /** Present only during the boss fight. */
  boss?: BossHudState | undefined;
  /** A supply raider is currently on screen. */
  supplyActive: boolean;
  /**
   * 보스 등장까지 남은 진행도(사용자 요청 2026-07-26). 침공 런은 세그먼트 축이 없어 undefined
   * 이고, 그때는 게이지를 아예 감춘다. 보스 진입(`bossActive`) 후에도 감춘다 — 그 자리는 보스
   * 체력바가 이어받는다.
   */
  bossEta?: BossProgress | undefined;
  /**
   * 오염도(톡사르=오염 모드). `cells`/`critical` 에 닿으면 즉시 실패다. 그 외 런은 undefined 고
   * 게이지를 감춘다. 예전엔 이 값을 화면 어디에도 안 보여줘서 실패가 예고 없이 떴다
   * (사용자 신고 2026-07-27 "일정 시간 넘으면 갑자기 실패").
   */
  contamination?: { cells: number; critical: number } | undefined;
  /**
   * 장착 액티브 2칸의 쿨다운(ADR-0041 · AC-18). 미장착 런은 빈 배열/undefined 라 칸을 감춘다.
   *
   * ⚠️ **optional 이어야 한다.** 필수 필드로 만들면 `HudState` 를 직접 짓는 기존 테스트가 전부
   * 깨진다(보스·오염 게이지가 optional 인 것과 같은 이유). 값은 호출부가 `WorldState` 에서
   * 직접 파생한다({@link hudActives}) — `bossEta: bossProgress(w)` 와 같은 선례다.
   */
  actives?: readonly HudActiveState[] | undefined;
}

/** 좌하단 쿨다운 한 칸. 문자열은 호출부가 이미 번역해 넣는다(BossHudState.name 과 같은 규율). */
export interface HudActiveState {
  /** 발동 키 라벨(`Z`/`X`). ASCII 고정 — 폰트·로케일과 무관하게 같은 글자를 보여 준다. */
  key: string;
  /** 번역된 스킬 이름. */
  name: string;
  /** 쿨다운 잔여 틱(0 = 발동 가능). */
  cd: number;
  /** 현재 투자량 기준 실효 쿨다운(틱). 진행률의 분모다. */
  cdMax: number;
  /**
   * 아이콘 URL(번들 해석 완료). 미등재·미생성이면 `undefined` 이고, 그때는 발동 키 글자를
   * 절차적 자리표시자로 그린다 — **조용히 빈 칸이 되지 않게** 하는 것이 계약이다.
   *
   * Pixi 텍스처 캐시는 캔버스 전용이라 DOM 오버레이가 재사용할 수 없다. 그래서
   * `uiAssetUrl`(`src/ui/pixi/uiTextures.ts`)로 번들 URL 을 직접 얻는다.
   */
  iconUrl?: string;
}

/** 발동 키 라벨(슬롯 축). z/x 는 입력 레인이 소유하는 계약이고 여기서는 표시만 한다. */
const ACTIVE_KEY_LABELS: readonly string[] = ['Z', 'X'];

/**
 * 쿨다운 **잔여 비율**(0..1). 1 = 방금 발동, 0 = 발동 가능. 순수 함수라 단위 테스트가
 * 경계(분모 0·음수·초과)를 잠근다 — 화면에서는 이 값이 채움 높이가 된다.
 */
export function activeCooldownFraction(cd: number, cdMax: number): number {
  if (!(cdMax > 0)) return 0;
  return Math.max(0, Math.min(1, cd / cdMax));
}

/**
 * 라이브 `WorldState` 에서 좌하단 쿨다운 칸을 파생한다(읽기 전용 — sim 무영향).
 *
 * 스냅샷 경유가 **불필요**하다: `hud.update` 호출부가 월드를 손에 쥐고 있고, 장착 wire·투자
 * 벡터·쿨다운 잔여가 전부 `WorldState`/`WorldConfig` 안에 있다. 미장착 런은 `config.activeSlots`
 * 필드 자체가 없으므로(runConfig 조건부 스탬프) 빈 배열이 나가고 HUD 가 칸을 감춘다.
 */
export function hudActives(w: WorldState): readonly HudActiveState[] {
  const wires = w.config.activeSlots;
  if (wires === undefined) return [];
  const invest = w.config.skillInvest ?? [];
  const cds = [w.activeCd0, w.activeCd1];
  // E7: 조율 포인트(파워업 24/25) 슬롯별 누적. 런 밖(프로필 화면 등)에서는 이 함수 자체가
  // 안 불리므로 여기는 항상 라이브 런 값이다 — HUD 가 sim 과 같은 실효 쿨다운을 봐야 화면과
  // 실측이 갈리지 않는다(`src/sim/actives.ts` 의 `activeCooldownTicks` 호출과 같은 파생식).
  const tunes = [w.activeTune0, w.activeTune1];
  const out: HudActiveState[] = [];
  for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
    const def = activeByWireId(wires[slot] ?? -1);
    if (def === undefined) continue;
    // 기체 타입 고유(ADR-0041) — 손상 세이브가 남의 스킬을 실어도 발동하지 않으므로 표시도 안 한다.
    if (def.shipTypeId !== (w.config.shipType ?? 0)) continue;
    out.push({
      key: ACTIVE_KEY_LABELS[slot] ?? `${slot + 1}`,
      // ⚠️ 이 호출이 84키의 사문화 방지 참조다(AC-22 · tests/i18n.test.ts).
      name: tShipKey(activeSkillNameKey(def.id), def.id),
      cd: Math.max(0, cds[slot] ?? 0),
      cdMax: activeCooldownTicks(def, investedInTree(invest, def) + (tunes[slot] ?? 0)),
      // 아이콘 URL 은 **있을 때만** 싣는다(exactOptionalPropertyTypes: undefined 대입 금지).
      // 파일명 규약의 정본은 `activeSkillIconName` 하나이고, 인덱스는 그 기체 안 순서다.
      ...(() => {
        const idx = (ACTIVES_BY_SHIP[def.shipTypeId] ?? []).findIndex((d) => d.id === def.id);
        const slug = SHIP_TYPES[def.shipTypeId]?.slug;
        if (idx < 0 || slug === undefined) return {};
        const url = uiAssetUrl(activeSkillIconName(slug, idx));
        return url !== undefined ? { iconUrl: url } : {};
      })(),
    });
  }
  return out;
}

/**
 * 런 중 **침공 정보판**(화면 우측 가운데, 사용자 요청 2026-07-28).
 *
 * 지금 어느 행성 몇 단계를 돌고 있고, 주입한 촉매가 이 런에 어떤 페널티/보상을 걸고 있는지를
 * 한자리에 모은다. 예전에는 이 정보가 **출격 전 성계 지도에만** 있었다 — 런에 들어오면
 * 무엇을 걸고 싸우는지 확인할 방법이 없었다.
 *
 * 값은 전부 호출부가 파생해 넣는다(HUD 는 순수 뷰 — `BossHudState.name` 과 같은 규율).
 */
export interface RunInfoState {
  /** 행성 이름(`planetById(planet).name`). */
  planetName: string;
  /** `3단계` 등 이미 번역된 단계 문구. */
  stageLabel: string;
  /** `촉매 3장` / `주입 촉매 없음` — 이미 번역된 문구. */
  catalystLabel: string;
  /** 페널티 줄(라벨 + `+40%`). 비어 있으면 그 열을 감춘다. */
  penalties: readonly { label: string; value: string }[];
  /** 보상 줄(라벨 + `+30%`). 비어 있으면 그 열을 감춘다. */
  rewards: readonly { label: string; value: string }[];
  /** 소제목 문구(`페널티`/`보상`) — i18n 은 호출부가 푼다. */
  penaltyHead: string;
  rewardHead: string;
}

function bar(label: string, colorClass: string): { root: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'pb-bar';
  const track = document.createElement('div');
  track.className = 'pb-track';
  const fill = document.createElement('div');
  fill.className = `pb-fill ${colorClass}`;
  const text = document.createElement('div');
  text.className = 'pb-bartext';
  track.appendChild(fill);
  track.appendChild(text);
  const lbl = document.createElement('div');
  lbl.className = 'pb-label';
  lbl.textContent = label;
  root.appendChild(lbl);
  root.appendChild(track);
  return { root, fill, text };
}

/**
 * 침공 진행 패널의 게이지 한 줄(라벨 + 트랙 + 트랙 위 수치). {@link bar} 와 달리 트랙 폭이 좁고
 * 라벨이 고정폭이라, 레이어·코어·보스 세 줄이 같은 세로 격자에 정렬된다.
 */
function invRow(
  name: string,
  colorClass: string,
): { root: HTMLElement; label: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'pb-ip-row';
  const label = document.createElement('div');
  label.className = 'pb-ip-name';
  label.textContent = name;
  const track = document.createElement('div');
  track.className = 'pb-ip-track';
  const fill = document.createElement('div');
  fill.className = `pb-ip-fill ${colorClass}`;
  const text = document.createElement('div');
  text.className = 'pb-ip-text';
  track.appendChild(fill);
  track.appendChild(text);
  root.appendChild(label);
  root.appendChild(track);
  return { root, label, fill, text };
}

/** 잔여 초 → `M:SS`. 침공은 분 단위(최대 5분)라 시간 자리는 두지 않는다. */
function mmss(sec: number): string {
  const s = sec > 0 ? Math.ceil(sec) : 0;
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const STYLE = `
#pb-hud { position:absolute; left:16px; bottom:16px; width:340px; font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecff; pointer-events:none; user-select:none; }
#pb-hud .pb-bar { display:flex; align-items:center; gap:8px; margin:4px 0; }
#pb-hud .pb-label { width:34px; font-size:11px; font-weight:700; letter-spacing:.5px; text-shadow:0 1px 2px #000; }
#pb-hud .pb-track { position:relative; flex:1; height:16px; background:rgba(8,10,20,.75); border:1px solid rgba(255,255,255,.15); border-radius:8px; overflow:hidden; }
#pb-hud .pb-fill { position:absolute; inset:0; width:0%; border-radius:8px 0 0 8px; transition:width .08s linear; }
#pb-hud .pb-fill.hp { background:linear-gradient(90deg,#ff5566,#ff8899); }
#pb-hud .pb-fill.xp { background:linear-gradient(90deg,#4cd7ff,#7affea); }
#pb-hud .pb-bartext { position:relative; z-index:1; text-align:center; line-height:16px; font-size:11px; font-weight:600; text-shadow:0 1px 2px #000; }
#pb-hud .pb-topline { display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:6px; text-shadow:0 1px 3px #000; }
#pb-hud .pb-combo { color:#ffd24c; }
#pb-supply { position:absolute; top:300px; left:50%; transform:translateX(-50%); background:rgba(255,180,40,.14); border:1px solid #ffcc44; color:#ffd98a; padding:6px 18px; border-radius:20px; font:700 15px 'Segoe UI',sans-serif; letter-spacing:1px; pointer-events:none; text-shadow:0 1px 2px #000; }
#pb-boss { position:absolute; top:20px; left:50%; transform:translateX(-50%); width:640px; max-width:80vw; font-family:'Segoe UI',sans-serif; color:#fff; pointer-events:none; text-align:center; }
#pb-boss .pb-bossname { font-size:14px; font-weight:800; letter-spacing:2px; text-shadow:0 1px 3px #000; margin-bottom:4px; }
#pb-boss .pb-bosstrack { position:relative; height:20px; background:rgba(10,5,8,.8); border:2px solid #ff6a3c; border-radius:4px; overflow:hidden; }
#pb-boss .pb-bossfill { position:absolute; inset:0; width:100%; background:linear-gradient(90deg,#ff3020,#ff7a1a); transition:width .1s linear; }
#pb-boss .pb-bossfill.overheat { background:linear-gradient(90deg,#ffdd44,#ff5522); box-shadow:0 0 16px 4px rgba(255,120,20,.8) inset; }
#pb-boss .pb-bossmark { position:absolute; top:0; bottom:0; width:2px; background:rgba(255,255,255,.7); }
#pb-boss .pb-bossmsg { font-size:12px; font-weight:700; color:#ffd98a; margin-top:3px; height:14px; text-shadow:0 1px 2px #000; }
#pb-bossmeter { position:absolute; top:20px; left:50%; transform:translateX(-50%); width:640px; max-width:80vw; font-family:'Segoe UI',sans-serif; color:#fff; pointer-events:none; user-select:none; }
#pb-bossmeter .pb-etahead { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; font-weight:800; letter-spacing:1.5px; color:#ffd98a; text-shadow:0 1px 3px #000; margin-bottom:3px; }
#pb-bossmeter .pb-etapct { font-size:12px; font-weight:800; color:#ffb84c; }
#pb-bossmeter .pb-etatrack { position:relative; height:14px; background:rgba(10,8,14,.78); border:2px solid rgba(255,150,60,.65); border-radius:4px; overflow:hidden; }
#pb-bossmeter .pb-etafill { position:absolute; inset:0; width:0%; background:linear-gradient(90deg,#ff8a2a,#ffd24c); transition:width .12s linear; }
#pb-bossmeter .pb-etamark { position:absolute; top:0; bottom:0; width:2px; background:rgba(0,0,0,.55); }
#pb-bossmeter .pb-etadetail { display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#d8c9a8; margin-top:3px; text-shadow:0 1px 2px #000; }
#pb-contam { position:absolute; top:138px; left:50%; transform:translateX(-50%); width:420px; max-width:70vw; font-family:'Segoe UI',sans-serif; color:#fff; pointer-events:none; user-select:none; }
#pb-contam .pb-contamhead { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; font-weight:800; letter-spacing:1.5px; color:#b6ff8a; text-shadow:0 1px 3px #000; margin-bottom:3px; }
#pb-contam .pb-contamtrack { position:relative; height:12px; background:rgba(8,14,10,.78); border:2px solid rgba(120,220,110,.55); border-radius:4px; overflow:hidden; }
#pb-contam .pb-contamfill { position:absolute; inset:0; width:0%; background:linear-gradient(90deg,#7bd44a,#c8e05a); transition:width .12s linear; }
#pb-contam.warn .pb-contamfill { background:linear-gradient(90deg,#e0a63a,#ffd24c); }
#pb-contam.danger .pb-contamfill { background:linear-gradient(90deg,#ff3b30,#ff8a3c); }
#pb-contam.danger { animation:pb-contam-pulse .9s ease-in-out infinite; }
#pb-contam.danger .pb-contamhead { color:#ff9a8a; }
#pb-contam .pb-contammsg { font-size:11px; font-weight:700; color:#ffb0a0; margin-top:3px; height:13px; text-shadow:0 1px 2px #000; }
@keyframes pb-contam-pulse { 0%,100%{opacity:1;} 50%{opacity:.55;} }
#pb-objective { position:absolute; top:78px; left:50%; transform:translateX(-50%); width:640px; max-width:80vw; font-family:'Segoe UI',sans-serif; text-align:center; pointer-events:none; user-select:none; }
#pb-objective .pb-obj-goal { font-size:19px; font-weight:800; letter-spacing:.4px; color:#ffe9b0; text-shadow:0 2px 4px #000,0 0 12px rgba(255,180,60,.45); }
#pb-objective .pb-obj-caution { margin-top:3px; font-size:13px; font-weight:700; color:#a9b6d6; text-shadow:0 1px 3px #000; }
#pb-objective .pb-obj-caution.alert { color:#ff9a8a; animation:pb-obj-alert .9s ease-in-out infinite; }
@keyframes pb-obj-alert { 0%,100%{opacity:1;} 50%{opacity:.5;} }
#pb-runinfo { position:absolute; right:16px; top:50%; transform:translateY(-50%); width:250px; background:rgba(14,12,26,.74); border:1px solid rgba(255,200,120,.35); border-radius:10px; padding:10px 12px; font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecff; pointer-events:none; user-select:none; }
#pb-runinfo .pb-ri-planet { font-size:15px; font-weight:800; color:#ffd98a; letter-spacing:.5px; text-shadow:0 1px 3px #000; }
#pb-runinfo .pb-ri-stage { font-size:12px; font-weight:700; color:#d8c9a8; margin-top:1px; text-shadow:0 1px 2px #000; }
#pb-runinfo .pb-ri-cat { font-size:12px; font-weight:700; color:#8affc0; margin-top:6px; text-shadow:0 1px 2px #000; }
#pb-runinfo .pb-ri-head { font-size:11px; font-weight:800; letter-spacing:1px; margin-top:8px; text-shadow:0 1px 2px #000; }
#pb-runinfo .pb-ri-head.pen { color:#ff9a8a; }
#pb-runinfo .pb-ri-head.rew { color:#8affc0; }
#pb-runinfo .pb-ri-row { display:flex; justify-content:space-between; gap:10px; font-size:12px; font-weight:600; margin-top:2px; text-shadow:0 1px 2px #000; }
#pb-runinfo .pb-ri-row .v { font-weight:800; }
#pb-runinfo .pb-ri-row.pen .v { color:#ff9a8a; }
#pb-runinfo .pb-ri-row.rew .v { color:#8affc0; }
#pb-invprog { position:absolute; left:16px; top:16px; width:260px; background:rgba(12,16,30,.74); border:1px solid rgba(120,190,255,.35); border-radius:10px; padding:9px 11px; font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecff; pointer-events:none; user-select:none; }
#pb-invprog .pb-ip-head { display:flex; justify-content:space-between; align-items:baseline; font-size:11px; font-weight:800; letter-spacing:1.2px; color:#8ec8ff; text-shadow:0 1px 3px #000; }
#pb-invprog .pb-ip-layer { font-size:13px; font-weight:800; color:#dbe8ff; margin-top:3px; text-shadow:0 1px 3px #000; }
#pb-invprog .pb-ip-row { display:flex; align-items:center; gap:7px; margin-top:5px; }
#pb-invprog .pb-ip-name { width:52px; flex:none; font-size:10px; font-weight:800; letter-spacing:.6px; color:#a9c6ff; text-shadow:0 1px 2px #000; }
#pb-invprog .pb-ip-track { position:relative; flex:1; height:13px; background:rgba(8,10,20,.8); border:1px solid rgba(255,255,255,.18); border-radius:7px; overflow:hidden; }
#pb-invprog .pb-ip-fill { position:absolute; inset:0; width:0%; border-radius:7px 0 0 7px; transition:width .12s linear; }
#pb-invprog .pb-ip-fill.layer { background:linear-gradient(90deg,#3f9bff,#8affea); }
#pb-invprog .pb-ip-fill.core { background:linear-gradient(90deg,#ffb84c,#ffe98a); }
#pb-invprog .pb-ip-fill.boss { background:linear-gradient(90deg,#ff3020,#ff7a1a); }
#pb-invprog .pb-ip-text { position:relative; z-index:1; text-align:center; line-height:13px; font-size:10px; font-weight:700; text-shadow:0 1px 2px #000; }
#pb-invprog .pb-ip-time { display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#d8c9a8; margin-top:6px; text-shadow:0 1px 2px #000; }
#pb-invprog .pb-ip-time.urgent { color:#ff9a8a; }
#pb-invprog .pb-ip-defhead { font-size:10px; font-weight:800; letter-spacing:1px; color:#8affc0; margin-top:7px; text-shadow:0 1px 2px #000; }
#pb-invprog .pb-ip-def { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:11px; font-weight:700; margin-top:2px; text-shadow:0 1px 2px #000; }
#pb-invprog .pb-ip-def span b { color:#8affc0; font-weight:800; }
#pb-actives { position:absolute; left:16px; bottom:96px; width:340px; font-family:'Segoe UI',system-ui,sans-serif; color:#e8ecff; pointer-events:none; user-select:none; }
#pb-actives .pb-ac-head { font-size:10px; font-weight:800; letter-spacing:1.4px; color:#ffd98a; text-shadow:0 1px 3px #000; margin-bottom:4px; }
#pb-actives .pb-ac-row { display:flex; gap:10px; }
#pb-actives .pb-ac { width:84px; }
#pb-actives .pb-ac-tile { position:relative; width:60px; height:60px; margin:0 auto; background:rgba(10,12,24,.82); border:2px solid rgba(255,255,255,.22); border-radius:10px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,.5); }
#pb-actives .pb-ac.ready .pb-ac-tile { border-color:#ffd24c; box-shadow:0 0 10px 2px rgba(255,210,76,.42); }
#pb-actives .pb-ac-glyph { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:800; color:#6f7ba8; text-shadow:0 1px 3px #000; }
#pb-actives .pb-ac.ready .pb-ac-glyph { color:#ffd98a; }
#pb-actives .pb-ac-img { width:100%; height:100%; object-fit:contain; image-rendering:pixelated; }
#pb-actives .pb-ac-cool { position:absolute; left:0; right:0; bottom:0; height:0%; background:rgba(4,6,14,.74); transition:height .08s linear; }
#pb-actives .pb-ac-key { position:absolute; left:0; top:0; z-index:3; padding:1px 5px; font-size:11px; font-weight:800; color:#0d0f1c; background:rgba(255,210,76,.92); border-radius:8px 0 8px 0; }
#pb-actives .pb-ac-cd { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; color:#ffe6b0; text-shadow:0 1px 3px #000; }
#pb-actives .pb-ac-name { margin-top:3px; text-align:center; font-size:10px; font-weight:700; line-height:12px; max-height:24px; overflow:hidden; color:#cdd6f5; text-shadow:0 1px 2px #000; }
/* 시험 침공 이탈 버튼 — **하단 중앙**. 이 화면에서 남은 유일한 빈 자리다: 좌상단은 설정 톱니
   (캔버스)와 침공 진행 패널, 우상단은 레이더(캔버스), 좌하단은 런 HUD 와 액티브 칸, 우하단은
   DEV 텔레메트리와 치트 패널 버튼이 이미 쓴다. 그리고 이것은 HUD 에서 **유일하게 클릭을 받는**
   요소라, 자리를 잘못 잡으면 겹친 쪽의 클릭을 조용히 훔친다(다른 판들은 전부 pointer-events:none
   이라 겹쳐도 티가 안 났다). */
#pb-exitrun { position:absolute; bottom:18px; left:50%; transform:translateX(-50%); display:flex; }
#pb-exitrun button { font:800 15px 'Segoe UI',system-ui,sans-serif; letter-spacing:.6px; color:#ffe6b0; background:rgba(24,16,20,.86); border:2px solid rgba(255,150,110,.62); border-radius:10px; padding:9px 22px; cursor:pointer; text-shadow:0 1px 3px #000; box-shadow:0 2px 10px rgba(0,0,0,.55); }
#pb-exitrun button:hover { color:#fff3d6; border-color:#ff9b6e; background:rgba(40,22,26,.92); }
#pb-lore { position:absolute; top:352px; left:50%; transform:translateX(-50%); max-width:80vw; background:rgba(18,24,44,.82); border:1px solid rgba(120,200,255,.55); box-shadow:0 0 18px 2px rgba(60,140,220,.35) inset; color:#dbe8ff; padding:10px 22px; border-radius:12px; font-family:'Segoe UI',system-ui,sans-serif; text-align:center; pointer-events:none; user-select:none; }
#pb-lore .pb-lore-line { font-size:14px; font-weight:600; letter-spacing:.4px; text-shadow:0 1px 3px #000; line-height:1.5; }
#pb-lore .pb-lore-line + .pb-lore-line { font-size:12px; font-weight:500; color:#a9c6ff; }
#pb-lore.pb-lore-in { animation:pb-lore-fade 5.2s ease-in-out forwards; }
@keyframes pb-lore-fade { 0%{opacity:0;transform:translate(-50%,-8px);} 8%{opacity:1;transform:translate(-50%,0);} 82%{opacity:1;transform:translate(-50%,0);} 100%{opacity:0;transform:translate(-50%,-8px);} }
`;

export class Hud {
  private readonly el: HTMLElement;
  private readonly root: HTMLElement;
  private readonly topline: HTMLElement;
  private readonly hpBar: ReturnType<typeof bar>;
  private readonly xpBar: ReturnType<typeof bar>;
  private readonly comboEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly supplyBanner: HTMLElement;
  private readonly bossRoot: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossMsg: HTMLElement;
  /** 보스 등장 예고 게이지(사용자 요청 2026-07-26). 보스전 시작 전까지만 보인다. */
  private readonly etaRoot: HTMLElement;
  private readonly etaTrack: HTMLElement;
  private readonly etaFill: HTMLElement;
  private readonly etaPct: HTMLElement;
  private readonly etaSegment: HTMLElement;
  private readonly etaGate: HTMLElement;
  /** 현재 트랙에 그려 둔 구간 눈금 수(바뀔 때만 다시 그린다). */
  private etaMarks = -1;
  /**
   * 런 목표·주의 2줄(상단중앙, 보스 게이지/보스 체력바 **아래**). 세그먼트 게이지와 자리를
   * 나눠 갖지 않고 별도 블록으로 둔 이유는 **보이는 조건이 다르기** 때문이다 — 게이지는 보스전과
   * 침공에서 사라지지만, 주의 줄은 바로 그때도 남아야 한다(보스전의 추격 포식자, 침공의 제한시간).
   * 값은 {@link setObjective} 가 프레임마다 채운다(파생은 src/ui/runObjective.ts).
   */
  private readonly objRoot: HTMLElement;
  private readonly objGoal: HTMLElement;
  private readonly objCaution: HTMLElement;
  /** 오염도 게이지(톡사르=오염 모드). 그 외 런에서는 숨는다. */
  private readonly contamRoot: HTMLElement;
  private readonly contamFill: HTMLElement;
  private readonly contamPct: HTMLElement;
  private readonly contamMsg: HTMLElement;
  /** 런 중 침공 정보판(우측 가운데). 기본 숨김, {@link setRunInfo} 로 런 시작 때 채운다. */
  private readonly runInfo: HTMLElement;
  /**
   * 침공 진행 패널(좌상단). 침공 런에서만 뜬다 — {@link setInvasion} 이 `null` 을 받으면 감춘다.
   * 좌하단 `#pb-hud`·상단중앙 `#pb-boss`/`#pb-bossmeter`·그 아래 `#pb-contam`·우중앙 `#pb-runinfo`
   * 와 자리가 겹치지 않는다.
   */
  private readonly invRoot: HTMLElement;
  private readonly invLayer: HTMLElement;
  private readonly invLayerBar: ReturnType<typeof invRow>;
  private readonly invCoreBar: ReturnType<typeof invRow>;
  private readonly invBossBar: ReturnType<typeof invRow>;
  private readonly invTime: HTMLElement;
  private readonly invTimeLayer: HTMLElement;
  private readonly invTimeTotal: HTMLElement;
  /** 방어 잔존 4항목 값 노드(설비·수호·기물·적 순). 라벨은 생성 시 한 번만 쓴다. */
  private readonly invDefValues: readonly HTMLElement[];
  /**
   * 시험 침공 이탈 버튼(하단 중앙). 기본 숨김 — {@link setExitRun} 이 켜는 런에서만 뜬다.
   *
   * ⚠️ HUD 에서 **유일하게 `pointer-events` 를 받는 요소다.** 나머지 판은 전부 `none` 이라 캔버스
   * 클릭을 통과시키지만, 이 버튼은 그 자리의 클릭을 먹는다 — 그래서 자리(하단 중앙)와 크기를
   * 함부로 늘리면 안 된다(CSS 주석이 어느 자리가 왜 막혀 있는지 열거해 뒀다).
   */
  private readonly exitRoot: HTMLElement;
  private readonly exitBtn: HTMLButtonElement;
  /** 지금 걸려 있는 이탈 핸들러(`null` = 버튼 숨김). 버튼은 한 번만 짓고 핸들러만 갈아 끼운다. */
  private exitHandler: (() => void) | null = null;
  /** 스토리 로어 토스트 배너(에코 안정화 등). 기본 숨김, {@link showLore} 로 잠깐 표시. */
  private readonly loreToast: HTMLElement;
  private loreTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 좌하단 액티브 쿨다운 칸(AC-18). `#pb-hud` 바로 위에 뜬다 — `#pb-invprog`(좌상단)·
   * `#pb-runinfo`(우중앙)·`#pb-boss`(상단중앙) 어느 것과도 자리가 겹치지 않는다.
   */
  private readonly activesRoot: HTMLElement;
  private readonly activesRow: HTMLElement;
  /** 지금 그려 둔 칸들(키+이름). 바뀔 때만 DOM 을 다시 짓고, 평소엔 값만 갈아끼운다. */
  private activesSig = '';
  private activeCells: readonly { root: HTMLElement; cool: HTMLElement; cd: HTMLElement }[] = [];

  constructor(elementId = 'hud') {
    const el = document.getElementById(elementId);
    if (el === null) throw new Error(`HUD element #${elementId} not found`);
    this.el = el;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-hud';
    this.topline = document.createElement('div');
    this.topline.className = 'pb-topline';
    this.timeEl = document.createElement('span');
    this.comboEl = document.createElement('span');
    this.comboEl.className = 'pb-combo';
    this.topline.appendChild(this.timeEl);
    this.topline.appendChild(this.comboEl);
    this.hpBar = bar('HP', 'hp');
    this.xpBar = bar('LV', 'xp');
    this.root.appendChild(this.topline);
    this.root.appendChild(this.hpBar.root);
    this.root.appendChild(this.xpBar.root);
    document.body.appendChild(this.root);

    this.supplyBanner = document.createElement('div');
    this.supplyBanner.id = 'pb-supply';
    this.supplyBanner.textContent = t('hud.supplyRaid');
    this.supplyBanner.style.display = 'none';
    document.body.appendChild(this.supplyBanner);

    this.bossRoot = document.createElement('div');
    this.bossRoot.id = 'pb-boss';
    this.bossName = document.createElement('div');
    this.bossName.className = 'pb-bossname';
    // 초기값은 비워 둔다 — 이름은 매 갱신마다 런의 행성에서 파생돼 들어온다(BossHudState.name).
    const track = document.createElement('div');
    track.className = 'pb-bosstrack';
    this.bossFill = document.createElement('div');
    this.bossFill.className = 'pb-bossfill';
    track.appendChild(this.bossFill);
    // Phase markers at 35% and 70%.
    for (const pct of [35, 70]) {
      const m = document.createElement('div');
      m.className = 'pb-bossmark';
      m.style.left = `${pct}%`;
      track.appendChild(m);
    }
    this.bossMsg = document.createElement('div');
    this.bossMsg.className = 'pb-bossmsg';
    this.bossRoot.appendChild(this.bossName);
    this.bossRoot.appendChild(track);
    this.bossRoot.appendChild(this.bossMsg);
    this.bossRoot.style.display = 'none';
    document.body.appendChild(this.bossRoot);

    // 보스 등장 예고 게이지 — 제목/퍼센트 줄 + 구간 눈금 트랙 + 상세(구간·게이트) 줄.
    this.etaRoot = document.createElement('div');
    this.etaRoot.id = 'pb-bossmeter';
    const etaHead = document.createElement('div');
    etaHead.className = 'pb-etahead';
    const etaTitle = document.createElement('span');
    etaTitle.textContent = t('hud.bossEta.title');
    this.etaPct = document.createElement('span');
    this.etaPct.className = 'pb-etapct';
    etaHead.appendChild(etaTitle);
    etaHead.appendChild(this.etaPct);
    this.etaTrack = document.createElement('div');
    this.etaTrack.className = 'pb-etatrack';
    this.etaFill = document.createElement('div');
    this.etaFill.className = 'pb-etafill';
    this.etaTrack.appendChild(this.etaFill);
    const etaDetail = document.createElement('div');
    etaDetail.className = 'pb-etadetail';
    this.etaSegment = document.createElement('span');
    this.etaGate = document.createElement('span');
    etaDetail.appendChild(this.etaSegment);
    etaDetail.appendChild(this.etaGate);
    this.etaRoot.appendChild(etaHead);
    this.etaRoot.appendChild(this.etaTrack);
    this.etaRoot.appendChild(etaDetail);
    this.etaRoot.style.display = 'none';
    document.body.appendChild(this.etaRoot);

    // 런 목표·주의 2줄. 기본 숨김 — setObjective 가 채우기 전에는 자리를 차지하지 않는다.
    this.objRoot = document.createElement('div');
    this.objRoot.id = 'pb-objective';
    this.objGoal = document.createElement('div');
    this.objGoal.className = 'pb-obj-goal';
    this.objCaution = document.createElement('div');
    this.objCaution.className = 'pb-obj-caution';
    this.objRoot.appendChild(this.objGoal);
    this.objRoot.appendChild(this.objCaution);
    this.objRoot.style.display = 'none';
    document.body.appendChild(this.objRoot);

    // 오염도 게이지 — 제목/수치 줄 + 트랙 + 경고 줄. 임계에 가까워지면 색이 오르고 맥동한다.
    this.contamRoot = document.createElement('div');
    this.contamRoot.id = 'pb-contam';
    const contamHead = document.createElement('div');
    contamHead.className = 'pb-contamhead';
    const contamTitle = document.createElement('span');
    contamTitle.textContent = t('hud.contamination.title');
    this.contamPct = document.createElement('span');
    contamHead.appendChild(contamTitle);
    contamHead.appendChild(this.contamPct);
    const contamTrack = document.createElement('div');
    contamTrack.className = 'pb-contamtrack';
    this.contamFill = document.createElement('div');
    this.contamFill.className = 'pb-contamfill';
    contamTrack.appendChild(this.contamFill);
    this.contamMsg = document.createElement('div');
    this.contamMsg.className = 'pb-contammsg';
    this.contamRoot.appendChild(contamHead);
    this.contamRoot.appendChild(contamTrack);
    this.contamRoot.appendChild(this.contamMsg);
    this.contamRoot.style.display = 'none';
    document.body.appendChild(this.contamRoot);

    // 런 중 침공 정보판(우측 가운데) — 런 시작 때 setRunInfo 로 채워지고, 그 전까지 숨는다.
    this.runInfo = document.createElement('div');
    this.runInfo.id = 'pb-runinfo';
    this.runInfo.style.display = 'none';
    document.body.appendChild(this.runInfo);

    // 침공 진행 패널(좌상단) — 구조는 여기서 한 번만 짓고 매 프레임 값만 갈아끼운다.
    // `setRunInfo` 처럼 매번 다시 지으면 프레임당 DOM 재구축이 되므로(HP/XP 와 같은 성격의
    // 실시간 값이다) 갱신 경로를 값 대입으로만 남긴다.
    this.invRoot = document.createElement('div');
    this.invRoot.id = 'pb-invprog';
    const invHead = document.createElement('div');
    invHead.className = 'pb-ip-head';
    const invTitle = document.createElement('span');
    invTitle.textContent = t('hud.inv.title');
    invHead.appendChild(invTitle);
    this.invLayer = document.createElement('div');
    this.invLayer.className = 'pb-ip-layer';
    this.invLayerBar = invRow('', 'layer');
    this.invCoreBar = invRow(t('hud.inv.core'), 'core');
    this.invBossBar = invRow(t('hud.inv.boss'), 'boss');
    this.invTime = document.createElement('div');
    this.invTime.className = 'pb-ip-time';
    this.invTimeLayer = document.createElement('span');
    this.invTimeTotal = document.createElement('span');
    this.invTime.appendChild(this.invTimeLayer);
    this.invTime.appendChild(this.invTimeTotal);
    const invDefHead = document.createElement('div');
    invDefHead.className = 'pb-ip-defhead';
    invDefHead.textContent = t('hud.inv.defense');
    const invDef = document.createElement('div');
    invDef.className = 'pb-ip-def';
    const defValues: HTMLElement[] = [];
    for (const key of [
      'hud.inv.facilities',
      'hud.inv.guardians',
      'hud.inv.props',
      'hud.inv.enemies',
    ] as const) {
      const cell = document.createElement('span');
      cell.append(`${t(key)} `);
      const v = document.createElement('b');
      v.textContent = '0';
      cell.appendChild(v);
      invDef.appendChild(cell);
      defValues.push(v);
    }
    this.invDefValues = defValues;
    this.invRoot.appendChild(invHead);
    this.invRoot.appendChild(this.invLayer);
    this.invRoot.appendChild(this.invLayerBar.root);
    this.invRoot.appendChild(this.invCoreBar.root);
    this.invRoot.appendChild(this.invBossBar.root);
    this.invRoot.appendChild(this.invTime);
    this.invRoot.appendChild(invDefHead);
    this.invRoot.appendChild(invDef);
    this.invRoot.style.display = 'none';
    document.body.appendChild(this.invRoot);

    // 액티브 쿨다운 칸(좌하단) — 머리글 + 칸 줄. 칸 자체는 장착이 확정되는 첫 갱신에서 짓는다.
    this.activesRoot = document.createElement('div');
    this.activesRoot.id = 'pb-actives';
    const acHead = document.createElement('div');
    acHead.className = 'pb-ac-head';
    acHead.textContent = t('hud.active.title');
    this.activesRow = document.createElement('div');
    this.activesRow.className = 'pb-ac-row';
    this.activesRoot.appendChild(acHead);
    this.activesRoot.appendChild(this.activesRow);
    this.activesRoot.style.display = 'none';
    document.body.appendChild(this.activesRoot);

    // 시험 침공 이탈 버튼 — 한 번만 짓고 라벨·핸들러만 갈아 끼운다. 클릭은 **현재 핸들러**를
    // 읽어서 부른다(리스너를 붙였다 뗐다 하면 해제 누락 한 번으로 옛 런의 핸들러가 살아남는다).
    this.exitRoot = document.createElement('div');
    this.exitRoot.id = 'pb-exitrun';
    this.exitBtn = document.createElement('button');
    this.exitBtn.type = 'button';
    this.exitBtn.addEventListener('click', () => {
      this.exitHandler?.();
    });
    this.exitRoot.appendChild(this.exitBtn);
    this.exitRoot.style.display = 'none';
    document.body.appendChild(this.exitRoot);

    this.loreToast = document.createElement('div');
    this.loreToast.id = 'pb-lore';
    this.loreToast.style.display = 'none';
    document.body.appendChild(this.loreToast);
  }

  /**
   * 런 화면의 이탈 버튼을 켜거나 끈다(`null` = 끔). 지금 쓰는 곳은 **방어 사령부의 시험 침공**
   * 하나다 — 그 런은 정산도 리플레이 제출도 타지 않는 오염 런이라 끝까지 갈 이유가 없는데,
   * 여태 화면에 나가는 길이 없어 죽거나 시간이 다 될 때까지 기다려야 했다(사용자 요청 2026-08-05).
   *
   * ⚠️ **런을 시작하는 모든 경로가 이 값을 명시로 세워야 한다.** 한 곳이라도 빠뜨리면 시험 침공에서
   * 나간 뒤 시작한 정식 런에 이탈 버튼이 그대로 남아, 정산을 건너뛰고 빠져나가는 길이 열린다.
   * 그래서 화면 전환의 단일 관문(`clearToMenu`)에서 끄는 것을 기본으로 삼는다.
   */
  setExitRun(label: string | null, onExit?: () => void): void {
    if (label === null || onExit === undefined) {
      this.exitHandler = null;
      this.exitRoot.style.display = 'none';
      return;
    }
    this.exitHandler = onExit;
    this.exitBtn.textContent = label;
    this.exitRoot.style.display = 'flex';
  }

  /**
   * 런 HUD 전체를 보이거나 감춘다. **정산 화면이 뜬 뒤에도 world 는 살아 있어서** 렌더 루프가
   * `hud.update` 를 계속 부르고, 그러면 보스 예고 게이지 같은 진행 바가 결과 화면 위에 그대로
   * 남는다(사용자 신고 2026-07-28). 각 게이지의 `display` 토글은 update 가 상태에서 파생하는
   * 소관이므로 건드리지 않고, 직교 축인 `visibility` 로만 덮어쓴다 — 두 축이 섞이지 않아
   * "감췄다가 다시 보이면 원래 표시 규칙이 그대로 복원"된다.
   *
   * 런 중 침공 정보판({@link setRunInfo})·침공 진행 패널({@link setInvasion})도 같이 덮는다 —
   * 둘 다 런에만 뜨는 판이라 정산 위에 남으면 같은 결함이다. 특히 진행 패널은 매 프레임
   * 상태에서 파생돼 다시 켜지므로(정산 후에도 world 가 살아 있다) `display` 만으로는 못 막는다.
   */
  setVisible(visible: boolean): void {
    const v = visible ? '' : 'hidden';
    for (const el of [
      this.el,
      this.root,
      this.supplyBanner,
      this.bossRoot,
      this.etaRoot,
      this.objRoot,
      this.contamRoot,
      this.loreToast,
      this.runInfo,
      this.invRoot,
      this.activesRoot,
      // 이탈 버튼도 함께 덮는다 — 정산 화면 위에 남으면 "결과를 보는 중에 런에서 나가기"라는
      // 있지도 않은 동작을 제안하게 된다. `visibility` 는 클릭도 함께 막으므로 이 하나로 끝난다.
      this.exitRoot,
    ]) {
      el.style.visibility = v;
    }
  }

  /**
   * 런 중 침공 정보판을 채운다(`null` = 감춤). **매 프레임이 아니라 런 시작 때 한 번** 부른다 —
   * 행성·단계·주입 촉매는 런 도중 바뀌지 않는 값이라 `update()` 경로에 넣으면 매 프레임 DOM 을
   * 다시 짓는 낭비가 된다(HP/XP 와 성격이 다르다).
   *
   * 침공(수비 시설 공략)·튜토리얼처럼 행성/촉매 축이 없는 런은 호출부가 `null` 을 준다.
   */
  /**
   * 런 목표·주의 2줄을 채운다(`null` = 감춤 — 런이 아닌 화면). 값 파생은 전부
   * {@link runObjective} 가 하고 여기서는 그리기만 한다(`setInvasion` 과 같은 규율).
   *
   * 목표 줄은 보스전에서 `null` 로 온다 — 그 자리를 보스 체력바가 이미 말하고 있으므로 줄을
   * 통째로 비운다. 주의 줄은 그때도 남는다(이 게임의 즉사 규칙은 보스전에도 그대로다).
   */
  setObjective(s: RunObjectiveState | null): void {
    if (s === null) {
      this.objRoot.style.display = 'none';
      return;
    }
    this.objRoot.style.display = 'block';
    const goal = s.objective ?? '';
    if (this.objGoal.textContent !== goal) this.objGoal.textContent = goal;
    this.objGoal.style.display = goal.length > 0 ? 'block' : 'none';
    if (this.objCaution.textContent !== s.caution) this.objCaution.textContent = s.caution;
    const cls = s.alert ? 'pb-obj-caution alert' : 'pb-obj-caution';
    if (this.objCaution.className !== cls) this.objCaution.className = cls;
    this.restackTop();
  }

  setRunInfo(info: RunInfoState | null): void {
    if (info === null) {
      this.runInfo.style.display = 'none';
      this.runInfo.replaceChildren();
      return;
    }
    this.runInfo.replaceChildren();

    const planet = document.createElement('div');
    planet.className = 'pb-ri-planet';
    planet.textContent = info.planetName;
    this.runInfo.appendChild(planet);

    const stage = document.createElement('div');
    stage.className = 'pb-ri-stage';
    stage.textContent = info.stageLabel;
    this.runInfo.appendChild(stage);

    const cat = document.createElement('div');
    cat.className = 'pb-ri-cat';
    cat.textContent = info.catalystLabel;
    this.runInfo.appendChild(cat);

    // 줄이 없는 축은 소제목까지 통째로 생략한다 — 무촉매 런에서 빈 '페널티'/'보상' 머리글만
    // 남으면 "효과가 있는데 표시가 안 된다"로 오해된다.
    this.appendRunInfoRows(info.penaltyHead, 'pen', info.penalties);
    this.appendRunInfoRows(info.rewardHead, 'rew', info.rewards);

    this.runInfo.style.display = 'block';
  }

  private appendRunInfoRows(
    heading: string,
    kind: 'pen' | 'rew',
    rows: readonly { label: string; value: string }[],
  ): void {
    if (rows.length === 0) return;
    const head = document.createElement('div');
    head.className = `pb-ri-head ${kind}`;
    head.textContent = heading;
    this.runInfo.appendChild(head);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = `pb-ri-row ${kind}`;
      const label = document.createElement('span');
      label.textContent = r.label;
      const value = document.createElement('span');
      value.className = 'v';
      value.textContent = r.value;
      row.appendChild(label);
      row.appendChild(value);
      this.runInfo.appendChild(row);
    }
  }

  /**
   * 침공 진행 패널을 갱신한다(`null` = 감춤 — 침공 런이 아니거나 런이 없을 때).
   *
   * `setRunInfo` 와 달리 **매 프레임** 부른다 — 레이어 진행·잔여 시간·잔존 수가 전부 실시간
   * 값이라 HP/XP 와 같은 성격이다. 대신 DOM 구조는 생성자에서 한 번만 짓고 여기서는 값만
   * 대입한다(프레임당 재구축 금지).
   *
   * 순수 뷰다 — 파생은 전부 `src/ui/invasionProgress.ts` 가 한다({@link RunInfoState} 와 같은 규율).
   */
  setInvasion(s: InvasionHudState | null): void {
    if (s === null) {
      this.invRoot.style.display = 'none';
      return;
    }
    this.invRoot.style.display = 'block';
    this.invLayer.textContent = s.layerLabel;

    const pct = Math.round(Math.max(0, Math.min(1, s.layerFraction)) * 100);
    this.invLayerBar.fill.style.width = `${pct}%`;
    this.invLayerBar.text.textContent = `${pct}%`;

    Hud.updateInvBar(this.invCoreBar, s.core);
    Hud.updateInvBar(this.invBossBar, s.boss);

    this.invTimeLayer.textContent = `${t('hud.inv.layerTime')} ${mmss(s.layerRemainSec)}`;
    this.invTimeTotal.textContent = `${t('hud.inv.totalTime')} ${mmss(s.totalRemainSec)}`;
    // 총 제한시간이 임박하면 색으로 알린다 — hard 상한이라 도달하면 그 자리에서 실패다.
    this.invTime.className = `pb-ip-time${s.totalRemainSec <= Hud.INV_TIME_URGENT_SEC ? ' urgent' : ''}`;

    const d = s.defense;
    for (const [i, n] of [d.facilities, d.guardians, d.props, d.enemies].entries()) {
      const cell = this.invDefValues[i];
      if (cell !== undefined) cell.textContent = `${n}`;
    }
  }

  /** 총 제한시간 경고 임계(초). 이 아래로 내려가면 시간 줄이 경고색으로 바뀐다. */
  private static readonly INV_TIME_URGENT_SEC = 30;

  /**
   * 침공 패널의 체력 게이지 한 줄(코어·보스)을 갱신한다. 값이 없으면 줄을 통째로 감춘다 —
   * L1/L2 에는 코어도 방어 보스도 존재하지 않아, 0% 로 굳은 빈 게이지를 남기면 "이미 다
   * 깎았다"로 오독된다.
   */
  private static updateInvBar(
    row: ReturnType<typeof invRow>,
    v: { hp: number; maxHp: number } | undefined,
  ): void {
    if (v === undefined || v.maxHp <= 0) {
      row.root.style.display = 'none';
      return;
    }
    row.root.style.display = 'flex';
    const frac = Math.max(0, Math.min(1, v.hp / v.maxHp));
    row.fill.style.width = `${frac * 100}%`;
    row.text.textContent = `${Math.ceil(Math.max(0, v.hp))} / ${v.maxHp}`;
  }

  /**
   * 스토리 로어 토스트를 잠깐 띄운다(에코 안정화·파편 획득 등, 스토리 Phase E). 각 줄이 별도
   * 라인으로 표시되고 약 5초 후 자동으로 사라진다. 연달아 부르면 이전 타이머를 취소하고 재무장한다
   * (겹침 방지). 순수 표시 — sim·정산과 무관하며, 표시할 줄이 없으면 no-op.
   */
  showLore(lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.loreToast.replaceChildren();
    for (const line of lines) {
      const el = document.createElement('div');
      el.className = 'pb-lore-line';
      el.textContent = line;
      this.loreToast.appendChild(el);
    }
    this.loreToast.style.display = 'block';
    // 애니메이션 재시작(연속 호출 시 처음부터 페이드). reflow 를 강제해 클래스 재적용이 먹게 한다.
    this.loreToast.classList.remove('pb-lore-in');
    void this.loreToast.offsetWidth;
    this.loreToast.classList.add('pb-lore-in');
    if (this.loreTimer !== null) clearTimeout(this.loreTimer);
    this.loreTimer = setTimeout(() => {
      this.loreToast.style.display = 'none';
      this.loreToast.classList.remove('pb-lore-in');
      this.loreTimer = null;
    }, 5200);
  }

  /** Debug telemetry line (kept from Phase 1; also used by the bench scene). */
  set(text: string): void {
    this.el.textContent = text;
  }

  update(s: HudState): void {
    const hpPct = s.maxHp > 0 ? Math.max(0, (s.hp / s.maxHp) * 100) : 0;
    this.hpBar.fill.style.width = `${hpPct}%`;
    this.hpBar.text.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;

    const xpPct = s.xpNeed > 0 ? Math.min(100, (s.xp / s.xpNeed) * 100) : 0;
    this.xpBar.fill.style.width = `${xpPct}%`;
    this.xpBar.text.textContent = `Lv ${s.level}  ·  ${s.xp}/${s.xpNeed}`;

    const m = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    this.timeEl.textContent = `⏱ ${m}:${sec.toString().padStart(2, '0')}`;
    this.comboEl.textContent =
      s.combo > 0 ? t('hud.combo', { mult: s.multiplier.toFixed(2), combo: s.combo }) : '';

    this.supplyBanner.style.display = s.supplyActive ? 'block' : 'none';

    if (s.boss !== undefined) {
      this.bossRoot.style.display = 'block';
      this.bossName.textContent = s.boss.name;
      const pct = s.boss.maxHp > 0 ? Math.max(0, (s.boss.hp / s.boss.maxHp) * 100) : 0;
      this.bossFill.style.width = `${pct}%`;
      this.bossFill.className = `pb-bossfill${s.boss.overheat ? ' overheat' : ''}`;
      this.bossMsg.textContent = s.boss.transitioning
        ? t('hud.phaseTransition', { n: s.boss.phase + 1 })
        : s.boss.overheat
          ? t('hud.overheat')
          : t('hud.phase', { n: s.boss.phase + 1 });
    } else {
      this.bossRoot.style.display = 'none';
    }

    this.updateBossEta(s.bossEta);
    this.updateContamination(s.contamination);
    this.updateActives(s.actives);
    // 상단중앙 스택은 **표시 조합이 확정된 뒤** 다시 쌓는다(이 세 갱신이 display 를 정한다).
    this.restackTop();
  }

  /**
   * 좌하단 액티브 쿨다운 칸을 갱신한다(AC-18). 장착이 없으면 통째로 감춘다 — 미장착 런에서
   * 빈 칸 두 개가 남으면 "장착했는데 안 보인다"로 오독된다(침공 코어 게이지와 같은 규율).
   *
   * DOM 은 **장착 구성이 바뀔 때만** 다시 짓는다. 쿨다운은 매 프레임 값이라 나머지 경로는
   * 채움 높이·숫자 대입뿐이다(`setInvasion` 과 같은 규율 — 프레임당 재구축 금지).
   */
  private updateActives(list: readonly HudActiveState[] | undefined): void {
    const items = list ?? [];
    if (items.length === 0) {
      this.activesRoot.style.display = 'none';
      return;
    }
    this.activesRoot.style.display = 'block';

    const sig = items.map((a) => `${a.key}|${a.name}`).join(';');
    if (sig !== this.activesSig) {
      this.activesSig = sig;
      this.activesRow.replaceChildren();
      this.activeCells = items.map((a) => Hud.buildActiveCell(a, this.activesRow));
    }

    for (const [i, a] of items.entries()) {
      const cell = this.activeCells[i];
      if (cell === undefined) continue;
      const frac = activeCooldownFraction(a.cd, a.cdMax);
      cell.cool.style.height = `${frac * 100}%`;
      // 남은 초는 올림 — 0.4초 남았는데 "0"이 뜨면 눌러도 안 나가는 것처럼 보인다.
      cell.cd.textContent = a.cd > 0 ? `${Math.ceil(a.cd / 60)}` : '';
      cell.root.className = `pb-ac${a.cd > 0 ? '' : ' ready'}`;
    }
  }

  /**
   * 칸 하나를 짓는다. **아이콘 자산(`active_<slug>_<n>.png`)이 아직 없어** 지금은 발동 키
   * 글자를 절차적 자리표시자로 그린다 — 그림이 오면 `.pb-ac-glyph` 를 `<img>` 로 바꾸면 된다.
   */
  private static buildActiveCell(
    a: HudActiveState,
    parent: HTMLElement,
  ): { root: HTMLElement; cool: HTMLElement; cd: HTMLElement } {
    const root = document.createElement('div');
    root.className = 'pb-ac';
    const tile = document.createElement('div');
    tile.className = 'pb-ac-tile';
    // 아이콘이 있으면 그림, 없으면 발동 키 글자를 절차적 자리표시자로 그린다.
    let glyph: HTMLElement;
    if (a.iconUrl !== undefined) {
      const img = document.createElement('img');
      img.className = 'pb-ac-glyph pb-ac-img';
      img.src = a.iconUrl;
      img.alt = '';
      glyph = img;
    } else {
      glyph = document.createElement('div');
      glyph.className = 'pb-ac-glyph';
      glyph.textContent = a.key;
    }
    const cool = document.createElement('div');
    cool.className = 'pb-ac-cool';
    const cd = document.createElement('div');
    cd.className = 'pb-ac-cd';
    const key = document.createElement('div');
    key.className = 'pb-ac-key';
    key.textContent = a.key;
    tile.appendChild(glyph);
    tile.appendChild(cool);
    tile.appendChild(cd);
    tile.appendChild(key);
    const name = document.createElement('div');
    name.className = 'pb-ac-name';
    name.textContent = a.name;
    root.appendChild(tile);
    root.appendChild(name);
    parent.appendChild(root);
    return { root, cool, cd };
  }

  /** 오염도 경고 단계 임계(0..1). 이 위는 주의색, {@link CONTAM_DANGER} 위는 위험색+맥동. */
  private static readonly CONTAM_WARN = 0.55;
  private static readonly CONTAM_DANGER = 0.8;

  /**
   * 오염도 게이지를 갱신한다(오염 모드 전용, 그 외 런은 감춘다). 단계별 색 전환으로 "임계에
   * 가까워지고 있다"를 실패 **전에** 알린다 — 이 표시가 없어서 실패가 갑자기 뜨는 것으로
   * 보였다(사용자 신고 2026-07-27). 순수 표시(값 파생은 sim/modes/contamination).
   */
  private updateContamination(c: { cells: number; critical: number } | undefined): void {
    if (c === undefined || c.critical <= 0) {
      this.contamRoot.style.display = 'none';
      return;
    }
    this.contamRoot.style.display = 'block';
    const frac = Math.max(0, Math.min(1, c.cells / c.critical));
    this.contamFill.style.width = `${frac * 100}%`;
    this.contamPct.textContent = `${c.cells} / ${c.critical}`;
    const danger = frac >= Hud.CONTAM_DANGER;
    this.contamRoot.className = danger ? 'danger' : frac >= Hud.CONTAM_WARN ? 'warn' : '';
    this.contamMsg.textContent = danger ? t('hud.contamination.warn') : '';
  }

  /**
   * 보스 등장 예고 게이지를 갱신한다. 보스전이 시작됐거나(bossActive) 세그먼트 축이 없는 런
   * (침공)이면 감춘다 — 그 자리는 보스 체력바가 이어받는다. 순수 표시(값 파생은 sim/bossProgress).
   */
  private updateBossEta(eta: BossProgress | undefined): void {
    if (eta === undefined || eta.bossActive) {
      this.etaRoot.style.display = 'none';
      return;
    }
    this.etaRoot.style.display = 'block';

    // 구간 눈금: 구간 경계마다 한 줄(마지막 경계 = 보스라 트랙 끝이므로 그리지 않는다).
    if (this.etaMarks !== eta.totalSegments) {
      for (const m of [...this.etaTrack.querySelectorAll('.pb-etamark')]) m.remove();
      for (let i = 1; i < eta.totalSegments; i++) {
        const m = document.createElement('div');
        m.className = 'pb-etamark';
        m.style.left = `${(i / eta.totalSegments) * 100}%`;
        this.etaTrack.appendChild(m);
      }
      this.etaMarks = eta.totalSegments;
    }

    this.etaFill.style.width = `${eta.frac * 100}%`;
    this.etaPct.textContent = `${Math.floor(eta.frac * 100)}%`;
    this.etaSegment.textContent = t('hud.bossEta.segment', {
      n: eta.segment,
      total: eta.totalSegments,
    });
    // 게이트 상세는 **목표 줄이 가져갔다**(2026-08-04). 처치 할당만 여기 남긴다 — 그건 매 초
    // 변하는 수치라 게이지 옆이 제자리이고, 나머지 게이트 문구는 두 줄이 같은 말을 반복했다.
    this.etaGate.textContent =
      eta.gate === 'kills' ? t('hud.bossEta.kills', { n: eta.current, goal: eta.goal }) : '';
  }

  /**
   * 상단중앙 세로 스택(보스 체력바 → 보스 예고 게이지 → 목표/주의 → 오염도)의 `top` 을 이번
   * 프레임의 **표시 조합**에 맞춰 다시 쌓는다.
   *
   * 왜 필요한가: 넷 다 `top` 고정이었고 보스 체력바와 예고 게이지는 **같은 20px** 이었다. 대개
   * 배타적이라 안 드러났지만 추격 모드는 포식자가 런 시작부터 `boss` 엔티티라 **둘이 처음부터
   * 겹쳐** 글자가 서로를 뚫고 나왔다(2026-08-04 화면 확인). 고정값을 더 늘리는 대신 표시 중인
   * 것만 순서대로 쌓는다 — 어느 조합이든 겹치지 않는다.
   */
  private restackTop(): void {
    let y = 20;
    const place = (el: HTMLElement, height: number): void => {
      if (el.style.display === 'none') return;
      el.style.top = `${y}px`;
      y += height;
    };
    place(this.bossRoot, 76); // 이름 + 트랙 + 메시지 줄
    place(this.etaRoot, 62); // 머리글 + 트랙 + 상세
    place(this.objRoot, this.objGoal.style.display === 'none' ? 30 : 54);
    place(this.contamRoot, 62);
  }
}
