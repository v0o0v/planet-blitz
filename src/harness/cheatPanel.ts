/**
 * 치트 패널 (개발 도구, DEV 전용 — ADR-0008).
 *
 * A collapsible bottom-right DOM overlay whose PRIMARY purpose is to let the
 * developer *play each scene by hand and verify behaviour with their own eyes*.
 * The panel is organised around that intent, top→bottom:
 *   1) 씬 런처   — one click stages a scene and hands control back LIVE at speed 1
 *                  (screens, 런 처음부터, 세그먼트 전투, 보스전, 튜토리얼, 레벨업
 *                  오버레이, 유니크 세리머니, 정산 승/패). 패널의 주역.
 *   2) 관전 도구 — watching aids (속도 1/4/16, 일시정지/재개, 틱 스텝, ff).
 *   3) 개입      — collapsed cheats (무적/힐/레벨업/재화·장비/소거·전멸·정예/프리셋).
 *   4) 인스펙터  — collapsed live snapshot + 이벤트 + 엔티티 목록.
 *
 * 모든 상태 변경은 `harness.cheat()`(또는 프로필 지급)을 거쳐 오염 런(markTainted)으로
 * 표시된다. 씬 런처가 taint로 무대를 꾸민 경우 오염 배지가 그것을 알린다(ADR-0008 의도).
 *
 * 프로덕션 미포함: main.ts가 `import.meta.env.DEV` 가드 안에서만 이 모듈을 동적
 * import 하므로, 프로덕션 번들에서는 트리 셰이킹으로 완전히 제거된다(정적 false 분기).
 *
 * 이 파일은 sim/save를 절대 수정하지 않는다 — 순수 read-only import만 사용하고,
 * 씬 무대·세그먼트/보스/유니크는 `harness.cheat()`로 라이브 월드 상태를 변형해 구현한다
 * (무대 꾸미기는 본질적으로 오염이므로 ADR-0008 상 허용).
 */

import type { Harness, HarnessScreen } from './core.js';
import type { EntitySnapshot } from '../sim/snapshot.js';
import { xpToNext } from '../sim/world.js';
import { spawnLoot } from '../sim/entities.js';
import { SEGMENTS } from '../../data/waves.js';
import { makeElite, ELITE_AFFIX_COUNT, isElite } from '../sim/elite.js';
import { rollItem } from '../items/roll.js';
import type { Item, Rarity, SlotKind, EquipSlotId } from '../items/types.js';
import { EQUIP_SLOTS, RARITY_CODE } from '../items/types.js';
import { activeShip } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { retireActiveShip, bulkDismissGuardians, investLineageBranch } from '../save/guardianLifecycle.js';
import { GUARDIAN_TITAN, GUARDIAN_INTERCEPTOR } from '../../data/guardian.js';

/**
 * main.ts가 주입하는 치트 패널 호스트. 하네스 공개 API로는 닿지 않는 프로필 지급·
 * 엔티티 스냅샷 접근·튜토리얼 흐름을 최소 위임으로 열어 준다(로직은 전부 이 파일에 있음).
 */
export interface CheatPanelHost {
  /** window.__pb.harness (재생/점프/치트/인스펙터 구동). */
  harness: Harness;
  /** 렌더 스냅샷의 엔티티 목록(read-only, 오염 없음 — 인스펙터용). */
  getEntities(): readonly EntitySnapshot[];
  /** 라이브(=활성 슬롯) 프로필 참조. */
  getProfile(): Profile;
  /** 프로필을 활성 슬롯에 영속화. */
  saveProfile(): void;
  /** 변경된 프로필로 현재 메뉴 스크린을 다시 그림. */
  refreshScreen(): void;
  /** 프로필 I/O를 격리된 하네스 프로필 슬롯으로 전환(멱등). */
  activateHarnessProfile(): void;
  /**
   * 정식 튜토리얼 흐름을 태운다(고정 시드 런 + 힌트 오버레이 + FTUE 계측). 하네스
   * 공개 API로는 오버레이·tutorialActive에 닿지 않으므로 main이 위임으로 노출한다.
   */
  startTutorial(): void;
}

/** The equip position → slot kind it accepts. */
const SLOT_KIND_FOR: Record<EquipSlotId, SlotKind> = {
  main: 'main',
  sub: 'sub',
  armor: 'armor',
  shield: 'shield',
  engine: 'engine',
  core: 'core',
  module0: 'module',
  module1: 'module',
};

/** 장비 지급 슬롯 셀렉트의 한글 라벨. */
const SLOT_LABEL: Record<EquipSlotId, string> = {
  main: '주무기',
  sub: '보조무기',
  armor: '장갑',
  shield: '실드',
  engine: '엔진',
  core: '코어',
  module0: '모듈1',
  module1: '모듈2',
};

const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

/** 씬 런처 셀렉트용 행성 이름(planet index = 배열 인덱스, data/planets/index.ts와 정합). */
const PLANET_NAMES: readonly string[] = ['카르곤', '베르단', '니플헤임', '아르케'];
/** 씬 런처 셀렉트용 티어 이름(tier index = 배열 인덱스, data/waves.ts와 정합). */
const TIER_NAMES: readonly string[] = ['정찰', '교전', '섬멸'];
/** 일반 전투 세그먼트 수(보스 세그먼트 제외 — 마지막 인덱스는 보스). */
const NORMAL_SEGMENTS = SEGMENTS.length - 1;

const STYLE = `
#pb-cheat { position:absolute; right:12px; bottom:12px; z-index:60; font-family:'Segoe UI',system-ui,sans-serif; color:#dce4ff; }
#pb-cheat .pb-c-toggle { pointer-events:auto; cursor:pointer; width:36px; height:36px; border-radius:10px; border:1px solid #2a3552; background:rgba(12,16,30,.92); color:#7affea; font-size:18px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(0,0,0,.5); }
#pb-cheat .pb-c-toggle:hover { border-color:#4cd7ff; }
#pb-cheat .pb-c-body { position:absolute; right:0; bottom:44px; width:328px; max-height:82vh; overflow:auto; background:rgba(6,9,18,.96); border:1px solid #2a3552; border-radius:14px; padding:12px; box-shadow:0 10px 40px rgba(0,0,0,.6); backdrop-filter:blur(4px); }
#pb-cheat .pb-c-body.hidden { display:none; }
#pb-cheat h3 { margin:0 0 6px; color:#7affea; font-size:13px; font-weight:800; letter-spacing:1px; }
#pb-cheat .pb-c-sec { border-top:1px solid rgba(255,255,255,.07); padding:9px 0 4px; }
#pb-cheat .pb-c-sec:first-of-type { border-top:none; padding-top:2px; }
#pb-cheat .pb-c-sec > .pb-c-t { color:#9fb0d8; font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px; text-transform:uppercase; }
/* 씬 런처: 패널의 주역 — 강조 프레임. */
#pb-cheat .pb-c-launcher { border:1px solid #34507a; background:rgba(14,24,44,.7); border-radius:12px; padding:9px 10px 6px; margin-bottom:4px; }
#pb-cheat .pb-c-launcher > .pb-c-t { color:#7affea; font-size:12px; }
#pb-cheat .pb-c-row { display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-bottom:5px; }
#pb-cheat .pb-c-sub { color:#68789c; font-size:10px; font-weight:700; letter-spacing:.5px; margin:5px 0 3px; text-transform:uppercase; }
#pb-cheat button.pb-c-b { pointer-events:auto; cursor:pointer; padding:5px 9px; font-size:12px; font-weight:700; color:#c3cdea; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:8px; }
#pb-cheat button.pb-c-b:hover:not(:disabled) { border-color:#4cd7ff; color:#fff; }
#pb-cheat button.pb-c-b.on { background:linear-gradient(90deg,#4cd7ff,#7affea); color:#04121a; border:none; }
#pb-cheat button.pb-c-b.play { background:linear-gradient(90deg,#2b6cff,#4cd7ff); color:#02101f; border:none; }
#pb-cheat button.pb-c-b.play:hover:not(:disabled) { filter:brightness(1.12); color:#02101f; }
#pb-cheat button.pb-c-b:disabled { opacity:.35; cursor:default; }
#pb-cheat input, #pb-cheat select { pointer-events:auto; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:7px; color:#e8ecff; font-size:12px; padding:4px 6px; box-sizing:border-box; }
#pb-cheat input[type=number] { width:64px; }
#pb-cheat input[type=text] { width:96px; }
#pb-cheat label.pb-c-chk { display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#c3cdea; cursor:pointer; }
#pb-cheat .pb-c-lbl { font-size:11px; color:#8896b8; }
#pb-cheat .pb-c-badge { display:inline-block; background:#ff3355; color:#fff; font-size:12px; font-weight:900; letter-spacing:1px; padding:3px 10px; border-radius:20px; margin-bottom:8px; box-shadow:0 0 12px rgba(255,50,80,.7); }
#pb-cheat .pb-c-badge.clean { background:rgba(30,40,64,.9); color:#5f7196; box-shadow:none; }
#pb-cheat details.pb-c-sec > summary { color:#9fb0d8; font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px; text-transform:uppercase; cursor:pointer; list-style:none; user-select:none; }
#pb-cheat details.pb-c-sec > summary::-webkit-details-marker { display:none; }
#pb-cheat details.pb-c-sec > summary::before { content:'▸ '; color:#4cd7ff; }
#pb-cheat details.pb-c-sec[open] > summary::before { content:'▾ '; }
#pb-cheat pre.pb-c-dump { margin:0; font-family:'Consolas',monospace; font-size:11px; line-height:1.35; color:#b7c6ea; white-space:pre-wrap; word-break:break-word; }
#pb-cheat .pb-c-ents { max-height:150px; overflow:auto; border:1px solid #222c46; border-radius:8px; margin-top:5px; }
#pb-cheat .pb-c-ent { display:flex; justify-content:space-between; gap:8px; font-size:11px; padding:3px 7px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.04); }
#pb-cheat .pb-c-ent:hover { background:rgba(76,215,255,.12); }
#pb-cheat .pb-c-ent .k { color:#7affea; font-weight:700; }
#pb-cheat .pb-c-ent .p { color:#8896b8; }
#pb-cheat .pb-c-hint { color:#ffc96a; font-size:11px; min-height:13px; margin-top:4px; }
#pb-cheat .pb-c-evt { font-size:11px; color:#a7b6da; padding:1px 0; }
`;

/** 지정한 슬롯 종류·희귀도의 아이템을 결정론적으로 뽑는다(presets.ts와 동일 전략). */
function rollItemForSlot(startSeed: number, slotKind: SlotKind, rarity: Rarity): Item {
  const source = { planet: 0, tier: 1 };
  let last = rollItem(startSeed >>> 0, rarity, source);
  for (let i = 0; i < 4096; i++) {
    const item = rollItem((startSeed + i) >>> 0, rarity, source);
    if (item.slot === slotKind) return item;
    last = item;
  }
  return last;
}

/**
 * 치트 패널을 만들어 DOM에 붙인다. 반환된 핸들의 `destroy()`로 정리한다.
 * DEV 전용 — main.ts의 import.meta.env.DEV 블록에서만 호출된다.
 */
export function createCheatPanel(host: CheatPanelHost): { destroy(): void } {
  const { harness } = host;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pb-cheat';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'pb-c-toggle';
  toggleBtn.textContent = '⚙';
  toggleBtn.title = '치트 패널 (백틱 ` 키로 토글)';
  root.appendChild(toggleBtn);

  const body = document.createElement('div');
  body.className = 'pb-c-body hidden';
  root.appendChild(body);

  document.body.appendChild(root);

  let hint = '';
  let selectedEntityId: number | null = null;
  let speed: 1 | 4 | 16 = 1;
  let paused = false;
  let invincible = false;
  let savedMaxHp = 0;
  // 씬 런처 입력값은 250ms 자동 갱신(render)이 body를 통째로 다시 그려도 유지되도록
  // 클로저 상태로 보존한다(입력 요소는 매 렌더 이 값에서 복원). 시드를 고정하면 씬이
  // 재현 가능해진다("핀"), 빈 값은 랜덤.
  let seedStr = '';
  let planetIdx = 0;
  let tierIdx = 0;
  // 접이식 섹션(개입·인스펙터) 펼침 상태 — 자동 갱신 재렌더를 넘어 보존.
  let openIntervene = false;
  let openInspector = false;
  let openGuardian = false;
  // 런 식별 추적: 새 런이 시작되면 런 스코프 치트 상태(무적)를 리셋한다.
  // 무적은 일회성 world 변형이라 런을 넘어가면 실제 효과가 없는데 UI만 ON으로
  // 남고, OFF 시 이전 런의 savedMaxHp를 새 런에 덮어쓰는 desync가 생긴다(리뷰 LOW).
  let lastRunSeed: number | null = null;
  let lastRunTick = -1;

  // --- DOM 빌더 헬퍼 --------------------------------------------------------

  function section(title: string): HTMLElement {
    const s = document.createElement('div');
    s.className = 'pb-c-sec';
    const t = document.createElement('div');
    t.className = 'pb-c-t';
    t.textContent = title;
    s.appendChild(t);
    return s;
  }

  /** 펼침 상태를 클로저 boolean에 동기화하는 접이식 섹션(<details>). */
  function collapsible(title: string, isOpen: () => boolean, setOpen: (v: boolean) => void): HTMLDetailsElement {
    const d = document.createElement('details');
    d.className = 'pb-c-sec';
    d.open = isOpen();
    const sm = document.createElement('summary');
    sm.textContent = title;
    d.appendChild(sm);
    d.addEventListener('toggle', () => setOpen(d.open));
    return d;
  }

  function btn(label: string, onClick: () => void, title?: string, cls?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls !== undefined ? `pb-c-b ${cls}` : 'pb-c-b';
    b.textContent = label;
    if (title !== undefined) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function numInput(value: number, width = 64): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(value);
    i.style.width = `${width}px`;
    return i;
  }

  function subLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'pb-c-sub';
    el.textContent = text;
    return el;
  }

  function setHint(msg: string): void {
    hint = msg;
    render();
  }

  // --- 씬 런처: 스테이징 + 핸드오버 ----------------------------------------

  /** 씬 런처 시드 입력 → 숫자 또는 undefined(랜덤). */
  function readSeedOpt(): number | undefined {
    const s = seedStr.trim();
    if (s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n >>> 0 : undefined;
  }

  /** 핸드오버 규칙: 모든 씬 버튼은 라이브·속도 1·비일시정지 상태로 넘긴다. */
  function handOver(): void {
    speed = 1;
    harness.setSpeed(1);
    paused = false;
    harness.resume();
  }

  /** 선택된 시드/행성/티어로 런을 시작한다(비오염 — startRun은 taint하지 않는다). */
  function stageRun(): void {
    const seed = readSeedOpt();
    harness.startRun({
      planet: planetIdx,
      tier: tierIdx,
      anomaly: false,
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  function sceneFreshRun(): void {
    stageRun();
    handOver();
    setHint(`런 처음부터 · ${PLANET_NAMES[planetIdx] ?? planetIdx} / ${TIER_NAMES[tierIdx] ?? tierIdx}`);
  }

  /** 세그먼트 N(1-based, 일반 전투) 무대: 해당 세그먼트로 점프 + 풀 힐(오염). */
  function sceneSegment(n: number): void {
    stageRun();
    harness.cheat((w) => {
      const idx = n - 1;
      w.wave.segmentIndex = idx;
      // 처치 할당 게이트로 점프(ADR-0011): 진입 상태를 세그먼트 시작값으로 리셋 —
      // 급행 램프 0, 처치 스냅샷=현재 kills, 목표=해당 세그먼트 killGoal.
      w.wave.segmentElapsed = 0;
      w.wave.cardTimer = 0;
      w.wave.segmentBaseKills = w.kills;
      w.wave.segmentKillGoal = SEGMENTS[idx]?.killGoal ?? 0;
      w.wave.done = false;
      w.wave.boss = false;
      const p = w.entities[0];
      if (p !== undefined) p.hp = p.maxHp;
    });
    handOver();
    setHint(`세그먼트 ${n} 전투 (오염)`);
  }

  /** 보스전 무대: 보스 세그먼트로 점프 + 풀 힐(오염). sim이 다음 틱에 보스를 소환. */
  function sceneBoss(): void {
    stageRun();
    harness.cheat((w) => {
      w.wave.segmentIndex = SEGMENTS.length - 1;
      w.wave.segmentElapsed = 0;
      w.wave.cardTimer = 0;
      w.wave.segmentBaseKills = w.kills;
      w.wave.segmentKillGoal = SEGMENTS[SEGMENTS.length - 1]?.killGoal ?? 0;
      w.wave.done = false;
      const p = w.entities[0];
      if (p !== undefined) p.hp = p.maxHp;
    });
    handOver();
    setHint('보스전 (오염)');
  }

  /** 튜토리얼 무대: 정식 튜토리얼 흐름(고정 시드 + 힌트 오버레이 + FTUE, 비오염). */
  function sceneTutorial(): void {
    host.startTutorial();
    handOver();
    setHint('튜토리얼 런 (고정 시드 · 힌트 오버레이)');
  }

  /** 레벨업 오버레이 무대: 다음 레벨 임계치까지 XP 지급 → 다음 틱 파워업 선택(오염). */
  function sceneLevelUp(): void {
    stageRun();
    harness.cheat((w) => {
      w.xp += xpToNext(w.level);
    });
    handOver();
    setHint('레벨업 오버레이 (다음 틱 3지선다 표시)');
  }

  /** 유니크 세리머니 무대: 플레이어 근처에 유니크 loot를 떨궈 금빛 슬로모 발동(오염). */
  function sceneUnique(): void {
    stageRun();
    harness.cheat((w) => {
      const p = w.entities[0];
      const px = p?.x ?? 0;
      const py = p?.y ?? 0;
      // 시드 핀이 있으면 드랍도 재현되도록 그 시드에서 파생, 없으면 랜덤(리뷰 LOW).
      const pinned = readSeedOpt();
      const seed =
        pinned !== undefined
          ? (pinned ^ 0xc0ffee) >>> 0
          : (0xc0ffee + Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      // 조금 떨어뜨려(160px) 스냅샷에 한 번은 보이게 → 세리머니가 뜨고, 걸어가 줍는다.
      spawnLoot(w, px + 160, py, seed, RARITY_CODE.unique);
    });
    handOver();
    setHint('유니크 세리머니 (금빛 슬로모 · 근처 드랍)');
  }

  /**
   * 정산 화면 무대: 승리/패배 플래그를 강제해 결과 오버레이를 띄운다(오염). 오염 런은
   * settlement 블록만 생략되고 결과 오버레이는 endRun에서 그대로 표시된다(정보 표시용).
   */
  function sceneResult(victory: boolean): void {
    stageRun();
    harness.cheat((w) => {
      if (victory) {
        w.victory = true;
      } else {
        w.gameOver = true;
        const p = w.entities[0];
        if (p !== undefined) p.hp = 0;
      }
    });
    handOver();
    setHint(victory ? '정산 화면 (승리, 오염)' : '정산 화면 (패배, 오염)');
  }

  // --- 개입(치트) 액션 ------------------------------------------------------

  function grantCurrency(field: 'credits' | 'minerals', amount: number): void {
    host.activateHarnessProfile();
    host.getProfile()[field] += amount;
    host.saveProfile();
    host.refreshScreen();
    // 라이브 런이면 오염 표시(재화 개입). 런이 없으면 cheat는 무해한 no-op.
    harness.cheat(() => {});
    setHint(`${field === 'credits' ? '크레딧' : '광물'} +${amount} 지급 (하네스 프로필)`);
  }

  function grantItem(slotId: EquipSlotId, rarity: Rarity): void {
    host.activateHarnessProfile();
    const profile = host.getProfile();
    const ship = activeShip(profile);
    const seed = (0xc0ffee + Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const item = rollItemForSlot(seed, SLOT_KIND_FOR[slotId], rarity);
    // 기존 장착분은 인벤토리로 반환(정비 화면과 동일 규칙).
    const displaced = ship.equipped[slotId];
    if (displaced !== undefined) profile.inventory.push(displaced);
    ship.equipped[slotId] = item;
    host.saveProfile();
    host.refreshScreen();
    harness.cheat(() => {});
    setHint(`${SLOT_LABEL[slotId]} · ${rarity} 장착 (활성 기체)`);
  }

  function toggleInvincible(): void {
    invincible = !invincible;
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p === undefined) return;
      if (invincible) {
        savedMaxHp = p.maxHp;
        p.maxHp = 1e9;
        p.hp = 1e9;
      } else {
        p.maxHp = savedMaxHp > 0 ? savedMaxHp : p.maxHp;
        p.hp = p.maxHp;
      }
    });
    setHint(invincible ? '무적 ON (HP 1e9)' : '무적 OFF (HP 복구)');
  }

  function fullHeal(): void {
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p !== undefined) p.hp = p.maxHp;
    });
    setHint('풀 힐');
  }

  function levelUp(): void {
    // 정식 레벨업 흐름을 태운다: 다음 레벨 임계치까지 XP를 채우면 다음 틱에
    // pendingLevelUp(파워업 선택)으로 자연히 승급한다.
    harness.cheat((w) => {
      w.xp += xpToNext(w.level);
    });
    setHint('레벨업 +1 (다음 틱 파워업 선택)');
  }

  function clearEnemyBullets(): void {
    harness.cheat((w) => {
      const kept = w.entities.filter((e) => e.kind !== 'enemyBullet');
      w.entities.length = 0;
      for (const e of kept) w.entities.push(e);
    });
    setHint('적 탄막 소거');
  }

  function killAllEnemies(): void {
    harness.cheat((w) => {
      const kept = w.entities.filter((e) => e.kind !== 'enemy');
      w.entities.length = 0;
      for (const e of kept) w.entities.push(e);
    });
    setHint('모든 적 제거');
  }

  function spawnElite(): void {
    let ok = false;
    harness.cheat((w) => {
      const target = w.entities.find((e) => e.kind === 'enemy' && !isElite(e));
      if (target === undefined) return;
      makeElite(target, Math.floor(Math.random() * ELITE_AFFIX_COUNT));
      ok = true;
    });
    setHint(ok ? '정예 승격(현장 적 1기)' : '승격할 일반 적이 없습니다');
  }

  // --- 렌더 -----------------------------------------------------------------

  function render(): void {
    if (body.classList.contains('hidden')) return;
    body.innerHTML = '';

    const snap = harness.snapshot();
    const live = snap.segment > 0;

    // 새 런 감지(시드 변경 또는 틱 되감김) → 런 스코프 치트 상태 리셋.
    if (snap.screen === 'run') {
      if (snap.seed !== lastRunSeed || snap.tick < lastRunTick) {
        invincible = false;
        savedMaxHp = 0;
      }
      lastRunSeed = snap.seed;
      lastRunTick = snap.tick;
    }

    const h3 = document.createElement('h3');
    h3.textContent = '치트 패널';
    body.appendChild(h3);

    // 오염 배지
    const badge = document.createElement('div');
    badge.className = `pb-c-badge${snap.tainted ? '' : ' clean'}`;
    badge.textContent = snap.tainted ? '⚠ 오염 런 (정산·제출 제외)' : '정상 런';
    body.appendChild(badge);

    // 1) 씬 런처 (주역)
    {
      const s = document.createElement('div');
      s.className = 'pb-c-sec pb-c-launcher';
      const t = document.createElement('div');
      t.className = 'pb-c-t';
      t.textContent = '씬 런처 — 눈으로 검증';
      s.appendChild(t);

      // 시드/행성/티어 (씬 재현 핀). 클로저 상태에서 복원 → 자동 갱신에도 값 유지.
      const cfgRow = document.createElement('div');
      cfgRow.className = 'pb-c-row';
      const seedIn = document.createElement('input');
      seedIn.type = 'text';
      seedIn.placeholder = 'seed(빈=랜덤)';
      seedIn.value = seedStr;
      seedIn.title = '시드를 고정하면 씬이 재현 가능해집니다(핀). 빈 값은 랜덤.';
      seedIn.addEventListener('input', () => {
        seedStr = seedIn.value;
      });
      const planetSel = document.createElement('select');
      for (let i = 0; i < PLANET_NAMES.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = PLANET_NAMES[i] ?? String(i);
        if (i === planetIdx) o.selected = true;
        planetSel.appendChild(o);
      }
      planetSel.addEventListener('change', () => {
        planetIdx = Number(planetSel.value) || 0;
      });
      const tierSel = document.createElement('select');
      for (let i = 0; i < TIER_NAMES.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = TIER_NAMES[i] ?? String(i);
        if (i === tierIdx) o.selected = true;
        tierSel.appendChild(o);
      }
      tierSel.addEventListener('change', () => {
        tierIdx = Number(tierSel.value) || 0;
      });
      const seedLbl = document.createElement('span');
      seedLbl.className = 'pb-c-lbl';
      seedLbl.textContent = 'seed';
      cfgRow.append(seedLbl, seedIn, planetSel, tierSel);
      s.appendChild(cfgRow);

      // 화면(메뉴 점프)
      s.appendChild(subLabel('화면'));
      const scrRow = document.createElement('div');
      scrRow.className = 'pb-c-row';
      const screens: readonly [HarnessScreen, string][] = [
        ['title', '타이틀'],
        ['base', '기지'],
        ['starMap', '성도'],
        ['inventory', '인벤토리'],
        ['research', '연구소'],
        ['refinery', '정제소'],
        ['defense', '방어사령부'],
        ['controlTower', '관제탑'],
      ];
      for (const [scr, label] of screens) {
        scrRow.appendChild(
          btn(label, () => {
            harness.goto(scr);
            setHint(`화면 → ${label}`);
          }),
        );
      }
      s.appendChild(scrRow);

      // 플레이 씬(무대 → 라이브 핸드오버)
      s.appendChild(subLabel('플레이 씬 (클릭 → 직접 조작)'));
      const playRow1 = document.createElement('div');
      playRow1.className = 'pb-c-row';
      playRow1.append(
        btn('▶ 런 처음부터', sceneFreshRun, '선택한 행성/티어로 깨끗한 런 시작(비오염)', 'play'),
        btn('튜토리얼', sceneTutorial, '정식 튜토리얼(고정 시드 + 힌트 오버레이)', 'play'),
      );
      s.appendChild(playRow1);

      // 세그먼트 전투(일반 세그먼트 1~N)
      s.appendChild(subLabel('세그먼트 전투 (풀 힐 후 시작 · 오염)'));
      const segRow = document.createElement('div');
      segRow.className = 'pb-c-row';
      for (let n = 1; n <= NORMAL_SEGMENTS; n++) {
        segRow.appendChild(btn(String(n), () => sceneSegment(n), `세그먼트 ${n} 전투로 점프`));
      }
      segRow.appendChild(btn('보스전', sceneBoss, '보스 세그먼트로 점프해 sim이 보스를 소환', 'play'));
      s.appendChild(segRow);

      // 이벤트/연출 씬
      s.appendChild(subLabel('이벤트 · 연출 (오염)'));
      const fxRow = document.createElement('div');
      fxRow.className = 'pb-c-row';
      fxRow.append(
        btn('레벨업 오버레이', sceneLevelUp, '다음 틱에 3지선다 파워업 오버레이 표시'),
        btn('유니크 세리머니', sceneUnique, '근처에 유니크 loot 드랍 → 금빛 슬로모'),
      );
      s.appendChild(fxRow);
      const resRow = document.createElement('div');
      resRow.className = 'pb-c-row';
      resRow.append(
        btn('정산 · 승리', () => sceneResult(true), '승리 강제 → 결과 오버레이'),
        btn('정산 · 패배', () => sceneResult(false), '패배 강제 → 결과 오버레이'),
      );
      s.appendChild(resRow);
      body.appendChild(s);
    }

    // 2) 관전 도구 (재생 제어 — 검증을 지켜보기 위한 보조)
    {
      const s = section('관전 도구');
      const speedRow = document.createElement('div');
      speedRow.className = 'pb-c-row';
      for (const m of [1, 4, 16] as const) {
        const b = btn(`${m}×`, () => {
          speed = m;
          harness.setSpeed(m);
          render();
        });
        if (speed === m) b.classList.add('on');
        speedRow.appendChild(b);
      }
      const pb = btn(paused ? '▶ 재개' : '⏸ 일시정지', () => {
        paused = !paused;
        if (paused) harness.pause();
        else harness.resume();
        render();
      });
      if (paused) pb.classList.add('on');
      speedRow.appendChild(pb);
      s.appendChild(speedRow);

      const stepRow = document.createElement('div');
      stepRow.className = 'pb-c-row';
      stepRow.appendChild(btn('+1 틱', () => harness.step(1)));
      stepRow.appendChild(btn('+10 틱', () => harness.step(10)));
      stepRow.appendChild(btn('+60 틱', () => harness.step(60)));
      s.appendChild(stepRow);

      const ffRow = document.createElement('div');
      ffRow.className = 'pb-c-row';
      const ffTicks = numInput(600);
      const apChk = document.createElement('label');
      apChk.className = 'pb-c-chk';
      const ap = document.createElement('input');
      ap.type = 'checkbox';
      ap.checked = true;
      apChk.appendChild(ap);
      apChk.appendChild(document.createTextNode('오토파일럿'));
      const ffLbl = document.createElement('span');
      ffLbl.className = 'pb-c-lbl';
      ffLbl.textContent = 'ff';
      ffRow.appendChild(ffLbl);
      ffRow.appendChild(ffTicks);
      ffRow.appendChild(apChk);
      ffRow.appendChild(
        btn('▶▶ 실행', () => {
          const n = Math.max(0, Math.floor(Number(ffTicks.value) || 0));
          harness.ff(n, { autopilot: ap.checked });
          setHint(`ff ${n}틱 (${ap.checked ? '오토파일럿' : '중립'})`);
        }),
      );
      s.appendChild(ffRow);
      body.appendChild(s);
    }

    // 2.5) 수호·계보 (M5 Phase A — 퇴역 1사이클 딥링크: AC1/AC3/AC4 흐름 검증)
    {
      const s = collapsible(
        '수호·계보 (M5)',
        () => openGuardian,
        (v) => {
          openGuardian = v;
        },
      );

      const status = document.createElement('div');
      status.className = 'pb-c-lbl';
      const refreshStatus = (): void => {
        const p = host.getProfile();
        const active = p.guardians.filter((g) => !g.retired).length;
        status.textContent =
          `수호 ${active}기(활성)/${p.guardians.length}(총) · 계보 pt ${p.lineage.available} · ` +
          `기체Lv ${p.lineage.shipLevel}·수호Lv ${p.lineage.guardianLevel}`;
      };
      refreshStatus();

      const retireRow = document.createElement('div');
      retireRow.className = 'pb-c-row';
      retireRow.appendChild(
        btn('퇴역 · 타이탄', () => {
          const r = retireActiveShip(host.getProfile(), GUARDIAN_TITAN);
          host.saveProfile();
          refreshStatus();
          setHint(`퇴역(타이탄) → 수호 생성 전투력 ${r.guardian.combatScore}, 계보 +${r.granted}pt`);
        }, '만렙 퇴역 → 타이탄형 수호 기체 생성 + 계보 지급'),
      );
      retireRow.appendChild(
        btn('퇴역 · 인터셉터', () => {
          const r = retireActiveShip(host.getProfile(), GUARDIAN_INTERCEPTOR);
          host.saveProfile();
          refreshStatus();
          setHint(`퇴역(인터셉터) → 수호 생성 전투력 ${r.guardian.combatScore}, 계보 +${r.granted}pt`);
        }, '만렙 퇴역 → 인터셉터형 수호 기체 생성 + 계보 지급'),
      );
      s.appendChild(retireRow);

      const dismissRow = document.createElement('div');
      dismissRow.className = 'pb-c-row';
      dismissRow.appendChild(
        btn('일괄 소멸', () => {
          const r = bulkDismissGuardians(host.getProfile());
          host.saveProfile();
          refreshStatus();
          setHint(`수호 ${r.count}기 소멸 → 계보 +${r.points}pt 회수`);
        }, '활성 수호 전체 소멸 → 계보 포인트 회수(ADR-0007)'),
      );
      dismissRow.appendChild(
        btn('계보 투자 · 수호', () => {
          const ok = investLineageBranch(host.getProfile(), 'guardian');
          host.saveProfile();
          refreshStatus();
          setHint(ok ? '수호 가지 +1레벨(모든 수호 강화)' : '포인트 부족');
        }, '수호 가지 1레벨 투자(로그 점근 +50%)'),
      );
      dismissRow.appendChild(
        btn('계보 투자 · 기체', () => {
          const ok = investLineageBranch(host.getProfile(), 'ship');
          host.saveProfile();
          refreshStatus();
          setHint(ok ? '기체 가지 +1레벨(내 기체 강화)' : '포인트 부족');
        }, '기체 가지 1레벨 투자'),
      );
      s.appendChild(dismissRow);
      s.appendChild(status);
      body.appendChild(s);
    }

    // 3) 개입 (구 치트+스폰 병합 — 접이식, 기본 접힘)
    {
      const s = collapsible(
        '개입 (치트)',
        () => openIntervene,
        (v) => {
          openIntervene = v;
        },
      );

      const row1 = document.createElement('div');
      row1.className = 'pb-c-row';
      const invBtn = btn('무적', toggleInvincible);
      if (invincible) invBtn.classList.add('on');
      row1.append(invBtn, btn('풀 힐', fullHeal), btn('레벨업 +1', levelUp));
      s.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'pb-c-row';
      const credIn = numInput(10000, 72);
      row2.append(
        credIn,
        btn('크레딧', () => grantCurrency('credits', Math.max(0, Math.floor(Number(credIn.value) || 0)))),
      );
      const minIn = numInput(10000, 72);
      row2.append(
        minIn,
        btn('광물', () => grantCurrency('minerals', Math.max(0, Math.floor(Number(minIn.value) || 0)))),
      );
      s.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'pb-c-row';
      const slotSel = document.createElement('select');
      for (const id of EQUIP_SLOTS) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = SLOT_LABEL[id];
        slotSel.appendChild(o);
      }
      const raritySel = document.createElement('select');
      for (const r of RARITIES) {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        if (r === 'rare') o.selected = true;
        raritySel.appendChild(o);
      }
      row3.append(
        slotSel,
        raritySel,
        btn('장비 지급', () => grantItem(slotSel.value as EquipSlotId, raritySel.value as Rarity)),
      );
      s.appendChild(row3);

      // 스폰 개입(라이브 런에서만)
      const row4 = document.createElement('div');
      row4.className = 'pb-c-row';
      const bulletBtn = btn('적탄 소거', clearEnemyBullets);
      const killBtn = btn('적 전멸', killAllEnemies);
      const eliteBtn = btn('정예 승격', spawnElite);
      if (!live) {
        for (const b of [bulletBtn, killBtn, eliteBtn]) {
          b.disabled = true;
          b.title = '진행 중인 런이 없습니다';
        }
      }
      row4.append(bulletBtn, killBtn, eliteBtn);
      s.appendChild(row4);

      const row5 = document.createElement('div');
      row5.className = 'pb-c-row';
      row5.append(
        btn('프리셋: 신규', () => {
          harness.preset('fresh');
          setHint('프리셋 fresh 주입');
        }),
        btn('프리셋: 만렙', () => {
          harness.preset('maxed');
          setHint('프리셋 maxed 주입');
        }),
      );
      s.appendChild(row5);
      body.appendChild(s);
    }

    // 4) 인스펙터 (접이식, 기본 접힘)
    {
      const s = collapsible(
        '인스펙터',
        () => openInspector,
        (v) => {
          openInspector = v;
        },
      );
      const dump = document.createElement('pre');
      dump.className = 'pb-c-dump';
      const bossLine = snap.boss
        ? `boss hp ${Math.ceil(snap.boss.hp)}/${snap.boss.maxHp} ph${snap.boss.phase}`
        : 'boss -';
      const counts = Object.entries(snap.entityCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      dump.textContent =
        `screen ${snap.screen}  tick ${snap.tick}\n` +
        `hp ${Math.ceil(snap.hp)}/${snap.maxHp}  lv ${snap.level}  xp ${snap.xp}\n` +
        `seg ${snap.segment}  kills ${snap.kills}  combo ${snap.combo}\n` +
        `${bossLine}\n` +
        `hash ${snap.hash || '-'}  seed ${snap.seed}\n` +
        `프로필 c${snap.profileSummary.credits} m${snap.profileSummary.minerals} shipLv${snap.profileSummary.shipLevel}\n` +
        `엔티티 ${counts || '-'}`;
      s.appendChild(dump);

      // 최근 이벤트(최대 10)
      const events = harness.events().slice(-10).reverse();
      if (events.length > 0) {
        const evWrap = document.createElement('div');
        for (const e of events) {
          const line = document.createElement('div');
          line.className = 'pb-c-evt';
          line.textContent = `t${e.tick} ${e.type}${e.detail !== undefined ? ` (${e.detail})` : ''}`;
          evWrap.appendChild(line);
        }
        s.appendChild(evWrap);
      }

      // 엔티티 목록(클릭 인스펙트)
      const entities = host.getEntities();
      const list = document.createElement('div');
      list.className = 'pb-c-ents';
      // 관심 종류만: player/enemy/boss/supply/loot (탄·젬 제외로 잡음 감소).
      const KINDS = new Set(['player', 'enemy', 'boss', 'supply', 'loot', 'destructible']);
      const shown = entities.filter((e) => KINDS.has(e.kind)).slice(0, 60);
      for (const e of shown) {
        const item = document.createElement('div');
        item.className = 'pb-c-ent';
        const left = document.createElement('span');
        left.className = 'k';
        const eliteTag = e.elite >= 0 ? '★' : '';
        left.textContent = `#${e.id} ${e.kind}${eliteTag}`;
        const right = document.createElement('span');
        right.className = 'p';
        right.textContent = `hp ${Math.ceil(e.hp)}/${e.maxHp} (${Math.round(e.x)},${Math.round(e.y)})`;
        item.append(left, right);
        item.addEventListener('click', () => {
          selectedEntityId = e.id;
          setHint(`엔티티 #${e.id} ${e.kind} hp ${Math.ceil(e.hp)}/${e.maxHp} pos (${Math.round(e.x)},${Math.round(e.y)}) angle ${e.angle.toFixed(2)}`);
        });
        if (e.id === selectedEntityId) item.style.background = 'rgba(76,215,255,.18)';
        list.appendChild(item);
      }
      if (shown.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pb-c-evt';
        empty.style.padding = '4px 7px';
        empty.textContent = '표시할 엔티티 없음';
        list.appendChild(empty);
      }
      s.appendChild(list);
      body.appendChild(s);
    }

    // 힌트
    const hintEl = document.createElement('div');
    hintEl.className = 'pb-c-hint';
    hintEl.textContent = hint;
    body.appendChild(hintEl);
  }

  // --- 토글 + 라이브 갱신 ---------------------------------------------------

  function toggleOpen(): void {
    body.classList.toggle('hidden');
    if (!body.classList.contains('hidden')) render();
  }

  toggleBtn.addEventListener('click', toggleOpen);

  function onKey(ev: KeyboardEvent): void {
    // 백틱(`)으로 패널 토글. 입력 필드에 포커스가 있으면 무시.
    if (ev.key !== '`') return;
    const t = ev.target as HTMLElement | null;
    if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    ev.preventDefault();
    toggleOpen();
  }
  window.addEventListener('keydown', onKey);

  // 열려 있는 동안 250ms마다 인스펙터/상태 갱신. 단, 패널 안의 입력 필드를 편집
  // 중이면 재빌드를 건너뛴다 — render()가 innerHTML을 갈아엎어 포커스·캐럿을 훔치면
  // 시드 같은 여러 자리 값을 타이핑할 수 없다(리뷰 MED).
  const timer = window.setInterval(() => {
    if (body.classList.contains('hidden')) return;
    const ae = document.activeElement;
    if (ae !== null && body.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    render();
  }, 250);

  return {
    destroy(): void {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      root.remove();
      style.remove();
    },
  };
}
