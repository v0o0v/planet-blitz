/**
 * 치트 패널 (개발 도구, DEV 전용 — ADR-0008).
 *
 * A collapsible bottom-right DOM overlay whose PRIMARY purpose is to let the
 * developer *play each scene by hand and verify behaviour with their own eyes*.
 * The panel is organised **per scene** (씬 중심 재편, 2026-07-19), top→bottom:
 *   1) 재생 제어 — 횡단 도구(속도 1/4/16, 일시정지/재개, 틱 스텝, ff). 항상 표시.
 *   2) 씬 탭 바  — 런 / 보스전 / 연출 / 정산 / 메뉴 / 수호·계보 / 인스펙터.
 *   3) 탭 콘텐츠 — 선택한 씬의 "띄우기" 버튼과 그 씬에서 유효한 치트·관찰 도구만
 *                  표시한다(한 번에 한 씬 — 눈 검증 중 시각 소음 최소화).
 * 탭 선택은 클로저 상태(activeTab)로 보존되어 250ms 자동 재렌더에도 유지된다.
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
import { parseReplay, replaySummary, serializeReplay } from './replayStore.js';
import { INVASION_PRESET_KINDS } from './presets.js';
import type { InvasionPresetKind } from './presets.js';
import { MAINTENANCE_FULL } from '../sim/invasion/guardian.js';
import {
  INVASION_ASCENSION_MAX,
  INVASION_LEVEL_MAX,
  INVASION_LEVEL_MIN,
  INVASION_RARITY_COUNT,
  INVASION_TOTAL_TICKS,
} from '../sim/invasion/index.js';
import { catalogSizeFor, clearSlot, fillAll, listSlots, setSlot } from './invasionEdit.js';
import type { EntitySnapshot } from '../sim/snapshot.js';
import { xpToNext } from '../sim/world.js';
import { spawnLoot } from '../sim/entities.js';
import { SEGMENTS, LEVEL_CAP } from '../../data/waves.js';
import { PLANETS } from '../../data/planets/index.js';
import { makeElite, ELITE_AFFIX_COUNT, isElite } from '../sim/elite.js';
import { rollItem } from '../items/roll.js';
import type { Item, Rarity, SlotKind, EquipSlotId } from '../items/types.js';
import { EQUIP_SLOTS, RARITY_CODE } from '../items/types.js';
import { activeShip } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { retireActiveShip, bulkDismissGuardians, investLineageBranch } from '../save/guardianLifecycle.js';
import { setLineageGatewayOverride, hasLineageGatewayOverride } from '../net/lineage.js';
import { hasDefenseUnitsGatewayOverride } from '../net/defenseUnits.js';
import { readSupabaseConfig } from '../net/config.js';
import { getSignedInUser } from '../net/auth.js';
import { GUARDIAN_TITAN, GUARDIAN_INTERCEPTOR } from '../../data/guardian.js';
import {
  branchBonusBp,
  guardianMilestones,
  hasMilestone,
  MILESTONE_REBOOT,
  MILESTONE_CORE_GUARD,
  MILESTONE_SHIELD_SHARE,
} from '../../data/lineage.js';
import type { Application, Container } from 'pixi.js';
import { galleryScene } from './gallery/galleryScene.js';
import {
  ALL_ON_PLAYER_VISUAL_FLAGS,
  playerVisualFlags,
  resetPlayerVisualFlags,
  setPlayerVisualFlags,
  type PlayerVisualFlags,
} from '../render/entity/playerVisualFlags.js';

/**
 * 촉매 하네스 제어(ADR-0029, DEV). main.ts 가 인메모리 모의 원장(`HarnessCatalystGateway`)과
 * 성계 지도 촉매 픽커를 위임한다 — 하네스가 실 Supabase 없이도 "보유 시드→픽커 주입→출격→정산"
 * 정규경로를 관측할 수 있게 한다. 로직은 전부 main/net/mock 쪽에 있고 여기 UI 는 버튼만 건다.
 */
export interface HarnessCatalystControl {
  /** 모의 원장에 48종을 각 qty 개 시드하고 성계 지도 픽커 표시(inventory)에 반영한다. */
  seedAll(qty: number): void;
  /** 모의 원장을 비운다(픽커·보관함이 빈 보유로 돌아간다). */
  clear(): void;
  /** 현재 모의 보유 요약(보유 종류 수·총 개수). */
  stock(): { types: number; total: number };
  /** consume 강제 실패 토글 — 출격 시 폴백 모달([재시도]/[촉매 빼고 출격])을 재현한다. */
  setConsumeFail(fail: boolean): void;
  /** 현재 consume 강제 실패 여부. */
  consumeFail(): boolean;
  /** 성계 지도로 이동한 뒤 촉매 주입 픽커를 연다(48종·보유 수량 확인 → 주입). */
  openStarMapPicker(): void;
  /** 현재 성계 지도에 주입된 촉매 총 개수(중복 스택 포함). */
  injectedCount(): number;
}

/**
 * 방어체 강화 하네스 제어(DEV). 방어 사령부의 강화(레벨업·승급·리롤·등급 승급·제작)는
 * **서버 권위**라 로그인 없이는 한 줄도 돌지 않는다 — 그래서 하네스는 인메모리 모의
 * 게이트웨이(`src/harness/defenseMock.ts`)를 `setDefenseUnitsGatewayOverride` 로 끼워 넣고,
 * 그 모의 원장의 재화(크레딧·희귀 광물·설계도)를 이 제어로 조절한다.
 *
 * 로직은 전부 mock/main 쪽에 있고 여기 UI 는 숫자를 넣고 버튼만 건다
 * ({@link HarnessCatalystControl} 과 같은 규율).
 */
export interface HarnessDefenseControl {
  /** 모의 게이트웨이 사용 여부(끄면 실제 서버 경로로 되돌아간다). */
  enabled(): boolean;
  /** 모의 게이트웨이 on/off. 켜면 방어 사령부가 오프라인에서도 채워진다. */
  setEnabled(on: boolean): void;
  /** 현재 모의 원장의 재화. */
  currency(): { credits: number; minerals: number; blueprints: number };
  /** 모의 원장의 재화를 설정한다(지정한 항목만). */
  setCurrency(next: Partial<{ credits: number; minerals: number; blueprints: number }>): void;
  /** 모의 보관함에 방어체 n기를 결정론 시드로 채운다. */
  seedUnits(count: number): void;
  /** 모의 원장을 초기 상태로 되돌린다. */
  reset(): void;
  /** 모의 보관함 보유 수(표시용). */
  unitCount(): number;
}

/**
 * main.ts가 주입하는 치트 패널 호스트. 하네스 공개 API로는 닿지 않는 프로필 지급·
 * 엔티티 스냅샷 접근·튜토리얼 흐름을 최소 위임으로 열어 준다(로직은 전부 이 파일에 있음).
 */
export interface CheatPanelHost {
  /**
   * 촉매 하네스 제어(ADR-0029, DEV). 촉매 배선이 없는 호스트(구버전·테스트 fake)에서는
   * 미주입(undefined)이라 촉매 탭이 안내만 띄운다.
   */
  catalyst?: HarnessCatalystControl;
  /**
   * 방어체 강화 모의 제어(DEV). 미주입이면 침공 탭의 재화 줄이 안내만 띄운다
   * ({@link HarnessCatalystControl} 과 같은 규율).
   */
  defense?: HarnessDefenseControl;
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

/** planetMode 코드 → 한글 라벨(인덱스 = 코드, src/sim/planetMode.ts `PLANET_MODE` 와 정합). */
const MODE_LABEL: readonly string[] = ['뱀서류', '블록격파', '레이싱', '추격', '수축', '오염'];
/**
 * 씬 런처 셀렉트용 행성 이름(planet index = 배열 인덱스). **PLANETS 레지스트리에서 파생**한다 —
 * 하드코딩하면 신규 행성(Lane9 톡사르·크라스 등) 추가 시 하네스 목록만 뒤처져 실행할 수 없게
 * 된다(재발 방지, ADR-0021).
 */
const PLANET_NAMES: readonly string[] = PLANETS.map((p) => p.name);
/** 행성 index → 모드 한글 라벨(런처 셀렉트에 "행성 · 모드"로 표시해 어느 모드를 띄우는지 알려 준다). */
const PLANET_MODE_LABELS: readonly string[] = PLANETS.map((p) => MODE_LABEL[p.mode] ?? String(p.mode));
/** 일반 전투 세그먼트 수(보스 세그먼트 제외 — 마지막 인덱스는 보스). */
const NORMAL_SEGMENTS = SEGMENTS.length - 1;

/** 씬 탭 id — 패널은 씬 단위로 테스트 도구를 묶는다. */
type SceneTab =
  | 'run'
  | 'catalyst'
  | 'invasion'
  | 'boss'
  | 'fx'
  | 'ship'
  | 'gallery'
  | 'result'
  | 'menus'
  | 'guardian'
  | 'inspect';
/**
 * 기체 탭에 나열할 플레이어 비주얼 항목. 번호는 레인 계약(`playerVisual.ts` 헤더 표)의 항목
 * 번호라 화면에서 고른 결과를 그대로 코드로 옮길 수 있다.
 */
const SHIP_VISUAL_GROUPS: readonly {
  title: string;
  items: readonly { key: keyof PlayerVisualFlags; label: string; desc: string }[];
}[] = [
  {
    title: '엔진',
    items: [
      { key: 'flame', label: '② 엔진 불꽃', desc: '기체 뒤 3구 노즐의 시안 불꽃. 속도에 따라 길어진다.' },
    ],
  },
  {
    title: '선체 표현',
    items: [
      { key: 'contour', label: '⓪ 감산 컨투어', desc: '기체 둘레의 어두운 띠(밝은 배경에서 실루엣을 떼어낸다).' },
      { key: 'banking', label: '① 뱅킹/롤', desc: '선회할 때 기체가 기울고 횡폭이 눌린다.' },
      { key: 'rim', label: '③ 림라이트', desc: '광원 쪽 가장자리에 차가운 흰 하이라이트.' },
      { key: 'surface', label: '⑩ 판면 방향광', desc: '선체 표면이 광원·롤에 따라 밝고 어두워진다.' },
      { key: 'idleBob', label: '⑥ 아이들 부유', desc: '정지 시 위아래로 천천히 흔들린다.' },
      { key: 'damageScorch', label: '⑦ 손상 그을림', desc: 'HP 가 낮을수록 선체가 어둡고 난색으로 탄다.' },
    ],
  },
  {
    title: '피격',
    items: [
      { key: 'hitKick', label: '④ 피격 반동', desc: '맞으면 기수 반대 방향으로 튀었다 돌아온다.' },
      { key: 'shield', label: '④ 무적 실드 셸', desc: '피격 후 0.67초간 조여드는 육각 시안 링.' },
    ],
  },
  {
    title: '대시(회피)',
    items: [
      { key: 'dashCore', label: '2b 대시 심', desc: '대시 중 불꽃 안쪽에 밝은 시안 코어가 뜬다.' },
      { key: 'dashGhosts', label: '⑤ 대시 잔상', desc: '대시 궤적을 따라 반투명 기체가 남는다.' },
      { key: 'dashRing', label: '5b 충격파 링', desc: '대시 시작 순간 퍼져 나가는 시안 링(0.28초).' },
      { key: 'dashTrauma', label: '대시 화면 흔들림', desc: '대시 시작 시 카메라가 살짝 흔들린다.' },
    ],
  },
  {
    title: '발광 헤일로 (레인 이전부터 있던 표현)',
    items: [
      { key: 'halo', label: '기체 주위 파란 발광', desc: '발광체 헤일로. 젬·전리품·보스도 쓰는 공통 표현이며 여기서는 플레이어만 끈다.' },
      { key: 'haloAniso', label: '⑨ 헤일로 늘이기', desc: '헤일로를 기수 축으로 늘여 물방울 모양으로 만든다(레인 추가분).' },
    ],
  },
];

/** 씬 탭 정의(표시 순서). */
const SCENE_TABS: readonly { id: SceneTab; label: string }[] = [
  { id: 'run', label: '런' },
  { id: 'catalyst', label: '촉매' },
  { id: 'invasion', label: '침공' },
  { id: 'boss', label: '보스전' },
  { id: 'fx', label: '연출' },
  { id: 'ship', label: '기체' },
  { id: 'gallery', label: '갤러리' },
  { id: 'result', label: '정산' },
  { id: 'menus', label: '메뉴' },
  { id: 'guardian', label: '수호·계보' },
  { id: 'inspect', label: '인스펙터' },
];

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
/* 씬 탭 바: 선택한 씬의 테스트 도구만 아래 pane에 표시. */
#pb-cheat .pb-c-tabs { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0 6px; }
#pb-cheat button.pb-c-tab { pointer-events:auto; cursor:pointer; padding:4px 9px; font-size:11px; font-weight:800; letter-spacing:.3px; color:#8896b8; background:rgba(16,22,40,.9); border:1px solid #2a3552; border-radius:8px 8px 3px 3px; }
#pb-cheat button.pb-c-tab:hover { border-color:#4cd7ff; color:#dce4ff; }
#pb-cheat button.pb-c-tab.on { background:linear-gradient(180deg,#20406a,#16294a); color:#7affea; border-color:#34507a; }
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
  const source = { planet: 0, stage: 11 };
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
  /**
   * 접속 배지가 쓰는 로그인 상태 캐시.
   *
   * `getSignedInUser()` 는 비동기인데 `render()` 는 동기다(250ms 자동 갱신이 body 를 통째로
   * 다시 그린다). 매 렌더마다 부르면 세션 조회가 초당 4회 돌므로, 결과를 여기 캐시하고
   * 갱신은 {@link refreshAccount} 가 따로 돌린다. `'unknown'` 은 아직 첫 조회 전.
   */
  let accountEmail: string | null | 'unknown' = 'unknown';
  // 씬 런처 입력값은 250ms 자동 갱신(render)이 body를 통째로 다시 그려도 유지되도록
  // 클로저 상태로 보존한다(입력 요소는 매 렌더 이 값에서 복원). 시드를 고정하면 씬이
  // 재현 가능해진다("핀"), 빈 값은 랜덤.
  let seedStr = '';
  let planetIdx = 0;
  let stageValue = 1;
  // 씬 탭 선택 — 자동 갱신 재렌더를 넘어 보존(클로저 상태). 한 번에 한 씬의 도구만
  // 보여주는 씬 중심 레이아웃의 축.
  let activeTab: SceneTab = 'run';
  // 촉매 탭 시드 수량(각 48종 지급 개수 — 250ms 자동 재렌더를 넘어 보존).
  let catalystSeedQty = 3;
  // 침공 탭 입력값(250ms 자동 재렌더를 넘어 보존되는 클로저 상태).
  //
  // 기본값이 `def3-empty` 인 이유: 하네스의 예약 배치 기본값(`createHarness` 의 pendingLayers)과
  // **같아야** 한다. 다른 값을 기본으로 두면 셀렉트가 가리키는 것과 실제 예약이 어긋나고,
  // 그렇다고 패널 생성 시 `harness.preset()` 으로 맞추면 이번엔 **패널이 존재한다는 이유만으로**
  // 콘솔의 `__pb.harness.startInvasion()` 기본 무대가 바뀐다(재현 스크립트가 조용히 다른 배치를
  // 돌게 된다). 기본값을 일치시키는 쪽이 어느 방향으로도 거짓말을 안 한다.
  let invasionPreset: InvasionPresetKind = 'def3-empty';
  /**
   * 라이브 런 중에 고른 프리셋을 아직 예약에 반영하지 못했는가. 반영은 `harness.preset` 이
   * 하는데 그것이 라이브 런을 오염시키므로, 런이 도는 동안에는 미뤘다가 다음 런 시작 직전에
   * 건다({@link sceneInvasion}).
   */
  let presetPending = false;

  /**
   * 지금 월드가 살아 있는가(런 또는 관전 재생 중). 스냅샷 해시는 월드가 없을 때만 빈 문자열
   * 이므로(`core.ts` snapshot), 화면 이름을 열거하지 않고도 정확히 판별된다.
   */
  function liveRun(): boolean {
    return harness.snapshot().hash !== '';
  }
  /** 침공 시작 시 걸 정비도(centi-percent). 100% = 완전 정비. */
  let invasionMaintCP: number = MAINTENANCE_FULL;
  /** 침공 시작 시 걸 총 제한 시간(틱). 기본값은 sim 정본 상수. */
  let invasionTimeLimit: number = INVASION_TOTAL_TICKS;
  /** 리플레이 붙여넣기 상자의 내용(250ms 자동 재렌더를 넘어 보존). */
  let replayPaste = '';
  // 배치 슬롯 편집기 상태(250ms 자동 재렌더를 넘어 보존). 인덱스는 `listSlots()` 순서다.
  let slotIdx = 0;
  let slotCatalogId = 0;
  let slotLevel: number = INVASION_LEVEL_MIN;
  let slotRarity = 0;
  let slotAscension = 0;
  let slotAffixSeed = 0;
  // 런 식별 추적: 새 런이 시작되면 런 스코프 치트 상태(무적)를 리셋한다.
  // 무적은 일회성 world 변형이라 런을 넘어가면 실제 효과가 없는데 UI만 ON으로
  // 남고, OFF 시 이전 런의 savedMaxHp를 새 런에 덮어쓰는 desync가 생긴다(리뷰 LOW).
  let lastRunSeed: number | null = null;
  let lastRunTick = -1;
  // 포인터로 버튼을 누르는 동안(pointerdown~pointerup)에는 250ms 자동 재빌드를
  // 건너뛴다. 재빌드는 body.innerHTML 을 통째로 갈아엎어 눌린 버튼 DOM 을 교체하는데,
  // mousedown~mouseup 사이에 그게 끼면 브라우저가 click 을 발화하지 않아 클릭이
  // 유실된다 — 씬 런처 버튼이 "눌러도 화면이 안 바뀐다(될 때도 안 될 때도)"의 근본 원인.
  // 라이브 런 중에는 snapshot(tick)이 매 틱 바뀌어 재빌드가 항상 실제 DOM 을 교체하므로
  // 특히 잘 씹힌다. 억제 구간은 버튼을 누르고 있는 짧은 순간뿐이라 인스펙터 실시간
  // 갱신 손실은 사실상 없다.
  let pointerActive = false;

  // 프로토타입 갤러리 씬(Phase 1, DEV) — 모듈 공유 싱글턴 galleryScene 을 쓴다(위 import). 갤러리 탭의
  // 열기/닫기 토글과 ?gallery=1 딥링크(main.ts)가 같은 인스턴스를 구동해 이중 마운트를 막고, 패널
  // destroy(HMR) 시에도 unmount 로 정리한다.

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
      stage: stageValue,
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  function sceneFreshRun(): void {
    stageRun();
    handOver();
    setHint(`런 처음부터 · ${PLANET_NAMES[planetIdx] ?? planetIdx} / 단계 ${stageValue}`);
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

  /**
   * 침공 3레이어 무대(M7a L8). 배치 프리셋을 **런 시작 전에** 걸어 비오염 런을 세운다
   * (프리셋을 런 중에 걸면 harness.preset 이 오염시킨다 — 시작 전에 거는 것이 규율).
   * 레이어를 2·3 으로 지정하면 그 점프만 오염이다.
   */
  function sceneInvasion(layer: 1 | 2 | 3): void {
    const seed = readSeedOpt();
    // 라이브 런 중에 고른 프리셋이 있으면 여기서 반영한다. 이 시점의 오염은 무해하다 —
    // 지금 도는 런은 바로 다음 줄에서 새 런으로 교체된다.
    if (presetPending) {
      harness.preset(invasionPreset);
      presetPending = false;
    }
    // 배치는 **예약된 것**(`harness.invasionLayers()`)을 쓴다 — 프리셋은 셀렉트를 바꾼 순간
    // 이미 예약에 반영됐고, 그 위에 슬롯 편집기가 한 칸씩 얹기 때문이다. 여기서 다시
    // `preset` 을 넘기면 슬롯 편집이 매 시작마다 조용히 되돌려진다.
    harness.startInvasion({
      maintenance: invasionMaintCP,
      timeLimitTicks: invasionTimeLimit,
      layer,
      ...(seed !== undefined ? { seed } : {}),
    });
    handOver();
    const tail = layer === 1 ? '비오염' : `L${layer} 점프 · 오염`;
    setHint(
      `침공 ${invasionPreset}(+편집) · 정비도 ${invasionMaintCP / 100}% · ` +
        `${Math.round(invasionTimeLimit / 60)}초 (${tail})`,
    );
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

  // --- 접속 상태 -------------------------------------------------------------

  /**
   * 로그인 상태를 다시 읽고, 값이 바뀌었을 때만 다시 그린다.
   *
   * OAuth 왕복 직후에는 세션이 늦게 잡히므로 한 번만 읽어서는 "미로그인"으로 굳는다.
   * 자동 갱신 주기에 얹되 조회 자체는 여기서만 한다.
   */
  function refreshAccount(): void {
    void getSignedInUser()
      .then((u) => {
        const next = u === null ? null : (u.email ?? '(이메일 없음)');
        if (next === accountEmail) return;
        accountEmail = next;
        render();
      })
      .catch(() => {
        /* 세션 조회 실패는 미로그인과 같게 둔다 — 배지가 그렇게 표시한다. */
      });
  }

  /**
   * 접속 배지 문구. **왜 이 배지가 필요한가**:
   *
   * 하네스에서 화면이 비어 있을 때 원인이 셋인데 화면상으로는 전부 똑같이 "빈 목록"이다 —
   * (a) `.env.local` 이 없어 설정 자체가 없다 (b) 설정은 있는데 로그인을 안 했다
   * (c) 둘 다 되는데 모의 게이트웨이가 실서버를 가리고 있다. (c) 가 특히 고약하다:
   * `defenseUnits`/`lineage` 의 대체는 설정보다 **먼저** 검사되므로, 켜 둔 것을 잊으면
   * 실서버에 붙어 있는데도 인메모리 원장을 보면서 "서버가 반영이 안 된다"고 오진하게 된다.
   * 그래서 셋을 한 줄에 드러낸다.
   */
  function describeConnection(): { text: string; ok: boolean } {
    const masked: string[] = [];
    if (hasDefenseUnitsGatewayOverride()) masked.push('방어체');
    if (hasLineageGatewayOverride()) masked.push('계보');
    const maskSuffix = masked.length > 0 ? ` · ⚠ 모의가 가림: ${masked.join('·')}` : '';

    if (readSupabaseConfig() === null) {
      return { text: `오프라인 — .env.local 없음(서버 화면 전부 잠김)${maskSuffix}`, ok: false };
    }
    if (accountEmail === 'unknown') return { text: `로그인 확인 중…${maskSuffix}`, ok: false };
    if (accountEmail === null) {
      return { text: `미로그인 — ⚙ 설정에서 로그인(서버 화면 잠김)${maskSuffix}`, ok: false };
    }
    return {
      text: `온라인 · ${accountEmail} · 침공은 NPC 대상만${maskSuffix}`,
      ok: masked.length === 0,
    };
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

    // 접속 배지 — 왜 필요한가는 describeConnection 주석에.
    const conn = describeConnection();
    const connBadge = document.createElement('div');
    connBadge.className = `pb-c-badge${conn.ok ? ' clean' : ''}`;
    connBadge.textContent = conn.text;
    body.appendChild(connBadge);

    // 1) 재생 제어 — 횡단 도구(어느 씬에서든 배속/정지/스텝/ff). 항상 표시.
    {
      const s = section('재생');
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

      const ffRow = document.createElement('div');
      ffRow.className = 'pb-c-row';
      ffRow.appendChild(btn('+1 틱', () => harness.step(1)));
      ffRow.appendChild(btn('+10 틱', () => harness.step(10)));
      ffRow.appendChild(btn('+60 틱', () => harness.step(60)));
      const ffTicks = numInput(600);
      const apChk = document.createElement('label');
      apChk.className = 'pb-c-chk';
      const ap = document.createElement('input');
      ap.type = 'checkbox';
      ap.checked = true;
      apChk.appendChild(ap);
      apChk.appendChild(document.createTextNode('오토파일럿'));
      ffRow.appendChild(ffTicks);
      ffRow.appendChild(apChk);
      ffRow.appendChild(
        btn('▶▶ ff', () => {
          const n = Math.max(0, Math.floor(Number(ffTicks.value) || 0));
          harness.ff(n, { autopilot: ap.checked });
          setHint(`ff ${n}틱 (${ap.checked ? '오토파일럿' : '중립'})`);
        }),
      );
      s.appendChild(ffRow);
      body.appendChild(s);
    }

    // 2) 씬 탭 바 — 선택한 씬의 테스트 도구만 아래 pane에 표시.
    const tabBar = document.createElement('div');
    tabBar.className = 'pb-c-tabs';
    for (const tab of SCENE_TABS) {
      const b = document.createElement('button');
      b.className = `pb-c-tab${activeTab === tab.id ? ' on' : ''}`;
      b.textContent = tab.label;
      b.addEventListener('click', () => {
        activeTab = tab.id;
        render();
      });
      tabBar.appendChild(b);
    }
    body.appendChild(tabBar);

    // 3) 선택된 씬 탭의 콘텐츠(빌더는 아래 함수 선언 — 호이스팅으로 접근 가능).
    {
      const pane = document.createElement('div');
      pane.className = 'pb-c-sec pb-c-launcher';
      switch (activeTab) {
        case 'run':
          buildRunTab(pane);
          break;
        case 'catalyst':
          buildCatalystTab(pane);
          break;
        case 'invasion':
          buildInvasionTab(pane);
          break;
        case 'boss':
          buildBossTab(pane);
          break;
        case 'fx':
          buildFxTab(pane);
          break;
        case 'ship':
          buildShipTab(pane);
          break;
        case 'gallery':
          buildGalleryTab(pane);
          break;
        case 'result':
          buildResultTab(pane);
          break;
        case 'menus':
          buildMenusTab(pane);
          break;
        case 'guardian':
          buildGuardianTab(pane);
          break;
        case 'inspect':
          buildInspectTab(pane);
          break;
      }
      body.appendChild(pane);
    }

    /** seed/행성/티어 핀 행(런·보스전·연출 탭 공유) — 클로저 상태에서 복원. */
    function buildPinRow(): HTMLElement {
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
      planetSel.title = '행성 = 게임플레이 모드(ADR-0021). 괄호가 이 행성이 도는 모드다.';
      for (let i = 0; i < PLANET_NAMES.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        const modeLbl = PLANET_MODE_LABELS[i];
        o.textContent = `${PLANET_NAMES[i] ?? i}${modeLbl !== undefined ? ` · ${modeLbl}` : ''}`;
        if (i === planetIdx) o.selected = true;
        planetSel.appendChild(o);
      }
      planetSel.addEventListener('change', () => {
        planetIdx = Number(planetSel.value) || 0;
      });
      // 침략 단계(1..∞, ADR-0022): 티어 3버튼 대신 단계 숫자 입력(개발 도구라 상한 없이 넉넉히).
      const stageIn = document.createElement('input');
      stageIn.type = 'number';
      stageIn.min = '1';
      stageIn.step = '1';
      stageIn.value = String(stageValue);
      stageIn.title = '침략 단계(1..∞). 1 = 구 정찰.';
      stageIn.style.width = '64px';
      stageIn.addEventListener('input', () => {
        const n = Math.floor(Number(stageIn.value));
        stageValue = Number.isFinite(n) && n >= 1 ? n : 1;
      });
      const stageLbl = document.createElement('span');
      stageLbl.className = 'pb-c-lbl';
      stageLbl.textContent = '단계';
      const seedLbl = document.createElement('span');
      seedLbl.className = 'pb-c-lbl';
      seedLbl.textContent = 'seed';
      cfgRow.append(seedLbl, seedIn, planetSel, stageLbl, stageIn);
      return cfgRow;
    }

    /** 전투 치트 묶음(런·보스전 탭 공유): 무적/풀힐/레벨업 + 스폰 개입(오염). */
    function appendCombatCheats(s: HTMLElement): void {
      s.appendChild(subLabel('전투 치트 (오염)'));
      const row1 = document.createElement('div');
      row1.className = 'pb-c-row';
      const invBtn = btn('무적', toggleInvincible);
      if (invincible) invBtn.classList.add('on');
      row1.append(invBtn, btn('풀 힐', fullHeal), btn('레벨업 +1', levelUp));
      s.appendChild(row1);
      const row2 = document.createElement('div');
      row2.className = 'pb-c-row';
      const bulletBtn = btn('적탄 소거', clearEnemyBullets);
      const killBtn = btn('적 전멸', killAllEnemies);
      const eliteBtn = btn('정예 승격', spawnElite);
      if (!live) {
        for (const b of [bulletBtn, killBtn, eliteBtn]) {
          b.disabled = true;
          b.title = '진행 중인 런이 없습니다';
        }
      }
      row2.append(bulletBtn, killBtn, eliteBtn);
      s.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'pb-c-row';
      const cdBtn = btn('액티브 쿨다운 리셋', () => {
        harness.resetActiveCooldowns();
        setHint('액티브 쿨다운 → 0/0');
      }, 'z/x 액티브 쿨다운 두 슬롯을 즉시 0으로(ADR-0041).');
      if (!live) {
        cdBtn.disabled = true;
        cdBtn.title = '진행 중인 런이 없습니다';
      }
      row3.append(cdBtn);
      s.appendChild(row3);
    }

    /** 라이브 상태 한 줄(런·보스전 탭): 눈 검증 중 흘끗 볼 핵심 수치. */
    function appendLiveStatusLine(s: HTMLElement): void {
      const line = document.createElement('div');
      line.className = 'pb-c-lbl';
      line.textContent = live
        ? `hp ${Math.ceil(snap.hp)}/${snap.maxHp} · lv ${snap.level} · seg ${snap.segment} · kills ${snap.kills}`
        : '진행 중인 런 없음';
      s.appendChild(line);
    }

    /** 런 탭: 깨끗한 런/튜토리얼 진입 + 세그먼트 점프 + 전투 치트. */
    function buildRunTab(s: HTMLElement): void {
      s.appendChild(buildPinRow());
      s.appendChild(subLabel('띄우기 (클릭 → 직접 조작)'));
      const playRow = document.createElement('div');
      playRow.className = 'pb-c-row';
      playRow.append(
        btn('▶ 런 처음부터', sceneFreshRun, '선택한 행성/티어로 깨끗한 런 시작(비오염)', 'play'),
        btn('튜토리얼', sceneTutorial, '정식 튜토리얼(고정 시드 + 힌트 오버레이)', 'play'),
      );
      s.appendChild(playRow);

      s.appendChild(subLabel('세그먼트 점프 (풀 힐 후 시작 · 오염)'));
      const segRow = document.createElement('div');
      segRow.className = 'pb-c-row';
      for (let n = 1; n <= NORMAL_SEGMENTS; n++) {
        segRow.appendChild(btn(String(n), () => sceneSegment(n), `세그먼트 ${n} 전투로 점프`));
      }
      s.appendChild(segRow);

      appendCombatCheats(s);
      appendLiveStatusLine(s);
    }

    /**
     * 촉매 탭(ADR-0029, Lane 5): "보유 시드→픽커 주입→출격→정산" 정규경로를 하네스에서 실증한다.
     * 실 Supabase 없이도 main 이 인메모리 모의 원장(`HarnessCatalystGateway`)을 net 촉매 4함수에
     * 폴백 주입하므로, 여기 버튼은 그 원장을 시드/비우고 성계 지도 픽커를 여는 접점만 건다.
     *  ① 48종×N 시드 → ② 성계 지도+픽커(48종·수량 확인·주입) → ③ 출격 버튼(consume 모의 성공 =
     *  실제 주입 출격) → ④ ff 로 정산(촉매 드랍 적립 → 다음 주입). consume 강제 실패로 폴백 모달도.
     */
    function buildCatalystTab(s: HTMLElement): void {
      const cat = host.catalyst;
      if (cat === undefined) {
        const note = document.createElement('div');
        note.className = 'pb-c-lbl';
        note.textContent = '이 호스트에는 촉매 하네스 배선이 없습니다(구버전/테스트).';
        s.appendChild(note);
        return;
      }

      // ① 모의 보유 원장 시드/비우기.
      s.appendChild(subLabel('① 모의 보유 원장 (서버 조회 우회)'));
      const seedRow = document.createElement('div');
      seedRow.className = 'pb-c-row';
      const qtyIn = numInput(catalystSeedQty, 56);
      qtyIn.min = '1';
      qtyIn.title = '48종 각각 몇 개씩 지급할지';
      qtyIn.addEventListener('input', () => {
        const n = Math.floor(Number(qtyIn.value));
        catalystSeedQty = Number.isFinite(n) && n >= 1 ? n : 1;
      });
      seedRow.append(
        qtyIn,
        btn('48종×N 시드', () => {
          cat.seedAll(catalystSeedQty);
          const st = cat.stock();
          setHint(`촉매 원장 시드: ${st.types}종 · 총 ${st.total}개`);
        }, '48종을 각 N개씩 모의 원장에 지급(픽커·보관함이 읽는다)'),
        btn('원장 비우기', () => {
          cat.clear();
          setHint('촉매 원장 비움(빈 보유)');
        }),
      );
      s.appendChild(seedRow);
      const stock = cat.stock();
      const stockLine = document.createElement('div');
      stockLine.className = 'pb-c-lbl';
      stockLine.textContent = `보유 ${stock.types}종 · 총 ${stock.total}개 · 주입 ${cat.injectedCount()}개`;
      s.appendChild(stockLine);

      // ② 성계 지도 + 픽커.
      s.appendChild(subLabel('② 주입 (성계 지도 픽커)'));
      const pickRow = document.createElement('div');
      pickRow.className = 'pb-c-row';
      pickRow.append(
        btn('성계 지도 + 픽커 열기', () => {
          cat.openStarMapPicker();
          setHint('성계 지도 픽커 — 48종·보유 수량 확인 후 주입, 확정 뒤 [출격]');
        }, '성계 지도로 이동해 촉매 주입 픽커를 연다', 'play'),
      );
      s.appendChild(pickRow);

      // ③ 출격 폴백 실증(consume 강제 실패).
      s.appendChild(subLabel('③ 출격 폴백 (RPC 실패 재현)'));
      const failRow = document.createElement('div');
      failRow.className = 'pb-c-row';
      const failChk = document.createElement('label');
      failChk.className = 'pb-c-chk';
      const failInput = document.createElement('input');
      failInput.type = 'checkbox';
      failInput.checked = cat.consumeFail();
      failInput.addEventListener('change', () => {
        cat.setConsumeFail(failInput.checked);
        setHint(failInput.checked ? 'consume 강제 실패 ON — 출격 시 폴백 모달' : 'consume 강제 실패 OFF');
      });
      failChk.append(failInput, document.createTextNode('consume 강제 실패'));
      failRow.appendChild(failChk);
      s.appendChild(failRow);

      const flow = document.createElement('div');
      flow.className = 'pb-c-lbl';
      flow.textContent =
        '흐름: 시드 → 픽커 주입 → [출격](consume 모의 성공=실제 주입 출격) → ▶▶ff 로 정산' +
        '(촉매 드랍 적립) → 메뉴>인벤토리>촉매 보관함에서 분해.';
      s.appendChild(flow);
    }

    /**
     * 침공 탭(M7a L8): 3레이어 침공 런 진입 + 레이어 점프 + 레이어 상태 라인.
     * 배치 프리셋·정비도가 방어 측 입력이고, 시드 핀은 런 재현용이다(행성·티어는 무의미).
     */
    function buildInvasionTab(s: HTMLElement): void {
      // 시드 핀만 재사용한다(행성·티어는 침공에 의미가 없어 셀렉트를 따로 두지 않는다).
      const cfgRow = document.createElement('div');
      cfgRow.className = 'pb-c-row';
      const seedIn = document.createElement('input');
      seedIn.type = 'text';
      seedIn.placeholder = 'seed(빈=랜덤)';
      seedIn.value = seedStr;
      seedIn.title = '시드를 고정하면 침공 런이 재현 가능해집니다(핀). 빈 값은 랜덤.';
      seedIn.addEventListener('input', () => {
        seedStr = seedIn.value;
      });
      const presetSel = document.createElement('select');
      for (const k of INVASION_PRESET_KINDS) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = k;
        if (k === invasionPreset) o.selected = true;
        presetSel.appendChild(o);
      }
      presetSel.title =
        'def3-empty = 전 슬롯 비움(기본 수비대 충원) · def3-mid = 절반 배치 · def3-maxed = 만렙 전 슬롯';
      presetSel.addEventListener('change', () => {
        const v = INVASION_PRESET_KINDS.find((k) => k === presetSel.value);
        if (v === undefined) return;
        invasionPreset = v;
        // 프리셋은 예약 배치에 즉시 반영해야 슬롯 편집기가 "지금 무엇이 예약돼 있는지"를
        // 보여줄 수 있다. 그런데 `harness.preset` 은 라이브 런을 **오염**시킨다 — 런 중에
        // 드롭다운을 훑기만 해도 그 런이 정산·제출에서 조용히 빠지는 회귀가 된다(리뷰 MEDIUM).
        // 그래서 라이브 런이 있으면 반영을 미루고(`presetPending`), 런 시작 직전에 건다.
        if (liveRun()) {
          presetPending = true;
          setHint(`라이브 런 중 — 프리셋 ${v} 는 다음 침공 런 시작 때 반영됩니다`);
          return;
        }
        presetPending = false;
        harness.preset(v);
        render();
      });
      const maintIn = numInput(invasionMaintCP / 100, 56);
      maintIn.title = '방어 정비도(%) — 0%면 설비 발사 간격이 2배(풍화 상한)';
      maintIn.addEventListener('input', () => {
        const pct = Number(maintIn.value);
        if (!Number.isFinite(pct)) return;
        const cp = Math.round(pct * 100);
        invasionMaintCP = cp < 0 ? 0 : cp > MAINTENANCE_FULL ? MAINTENANCE_FULL : cp;
      });
      const maintLbl = document.createElement('span');
      maintLbl.className = 'pb-c-lbl';
      maintLbl.textContent = '정비도%';
      const limitMaxSec = (INVASION_TOTAL_TICKS * 4) / 60;
      const limitIn = numInput(Math.round(invasionTimeLimit / 60), 56);
      limitIn.min = '1';
      limitIn.max = String(limitMaxSec);
      limitIn.title =
        `총 제한 시간(초, 1..${limitMaxSec}). 기본 ${INVASION_TOTAL_TICKS / 60}초 — 도달하면 패배(hard)`;
      limitIn.addEventListener('input', () => {
        const sec = Number(limitIn.value);
        if (!Number.isFinite(sec)) return;
        // 하한 1초: 0 이하면 런이 시작하자마자 끝나 무대가 아예 안 선다.
        // 상한 기본의 4배: 실수로 자릿수를 하나 더 찍었을 때 ff 가 끝나지 않는 런을 만들지 않는다.
        const ticks = Math.round(sec * 60);
        invasionTimeLimit = ticks < 60 ? 60 : ticks > INVASION_TOTAL_TICKS * 4 ? INVASION_TOTAL_TICKS * 4 : ticks;
      });
      const limitLbl = document.createElement('span');
      limitLbl.className = 'pb-c-lbl';
      limitLbl.textContent = '제한초';
      cfgRow.append(seedIn, presetSel, maintLbl, maintIn, limitLbl, limitIn);
      s.appendChild(cfgRow);

      s.appendChild(subLabel('띄우기 (클릭 → 직접 조작)'));
      const playRow = document.createElement('div');
      playRow.className = 'pb-c-row';
      playRow.append(
        btn('▶ 침공 시작 (L1)', () => sceneInvasion(1), '선택한 배치로 3레이어 침공 시작(비오염)', 'play'),
        btn('L2 회랑부터', () => sceneInvasion(2), 'L2 회랑 돌파로 점프해 시작(오염)'),
        btn('L3 코어방부터', () => sceneInvasion(3), 'L3 코어방으로 점프해 시작(오염)'),
      );
      s.appendChild(playRow);

      s.appendChild(subLabel('라이브 런 레이어 점프 (오염)'));
      const jumpRow = document.createElement('div');
      jumpRow.className = 'pb-c-row';
      const inv = snap.invasion;
      for (const layer of [2, 3] as const) {
        const b = btn(`→ L${layer}`, () => {
          const ok = harness.jumpInvasionLayer(layer);
          setHint(ok ? `L${layer} 로 점프(오염)` : `L${layer} 로 점프할 수 없습니다`);
        });
        if (inv === null || inv.phase >= layer - 1) {
          b.disabled = true;
          b.title = inv === null ? '진행 중인 침공 런이 없습니다' : '이미 그 레이어를 지났습니다';
        }
        jumpRow.appendChild(b);
      }
      s.appendChild(jumpRow);

      const line = document.createElement('div');
      line.className = 'pb-c-lbl';
      line.textContent =
        inv === null
          ? '진행 중인 침공 런 없음'
          : `L${inv.phase + 1} · 진입틱 ${inv.phaseEnterTick} · 스크롤 (${inv.scrollX},${inv.scrollY}) · ` +
            `가속 ${inv.accelCp}cp · 폭탄 ${inv.bombs}`;
      s.appendChild(line);

      appendLayoutEditor(s);
      appendDefenseCurrency(s);
      appendReplaySection(s);
      appendCombatCheats(s);
      appendLiveStatusLine(s);
    }

    /**
     * 배치 슬롯 편집기(침공 탭). 프리셋이 "시작점"이라면 이쪽은 **한 칸씩 찍어 무대를 만드는**
     * 도구다 — L1 편대 6칸 · L2 소켓(템플릿 종속) · L3 보스 1 + 기물 6 을 카탈로그·레벨·등급·
     * 승급·어픽스 시드 다섯 정수로 직접 지정한다.
     *
     * 편집 결과는 `harness.setInvasionLayers` 로 **다음 런에 예약**된다. 프리셋과 같은 규율로
     * 런 시작 **전에** 걸어야 비오염이다(라이브 런 중에 걸면 그 런이 오염된다).
     */
    function appendLayoutEditor(s: HTMLElement): void {
      const slots = listSlots(harness.invasionLayers());
      if (slotIdx >= slots.length) slotIdx = 0;
      const current = slots[slotIdx];

      s.appendChild(subLabel('배치 슬롯 편집 (다음 런에 예약)'));

      const pickRow = document.createElement('div');
      pickRow.className = 'pb-c-row';
      const slotSel = document.createElement('select');
      slotSel.style.flex = '1';
      slots.forEach((slot, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        const state = slot.ref === null ? '비움' : `${slot.catalogName} Lv${slot.ref.level}`;
        o.textContent = `${slot.label} — ${state}`;
        if (i === slotIdx) o.selected = true;
        slotSel.appendChild(o);
      });
      slotSel.title = 'L1 편대 · L2 설비 소켓 · L3 보스/기물. 소켓 수는 맵 템플릿에 종속된다.';
      slotSel.addEventListener('change', () => {
        slotIdx = Number(slotSel.value) || 0;
        // 선택한 슬롯의 현재 값을 입력칸으로 끌어온다 — 한 칸을 살짝 고치는 것이 주 조작이라
        // 매번 다섯 값을 새로 찍게 하면 실수로 다른 슬롯 값을 덮어쓰기 쉽다.
        const picked = listSlots(harness.invasionLayers())[slotIdx];
        if (picked?.ref != null) {
          slotCatalogId = picked.ref.catalogId;
          slotLevel = picked.ref.level;
          slotRarity = picked.ref.rarity;
          slotAscension = picked.ref.ascension;
          slotAffixSeed = picked.ref.affixSeed;
        } else {
          // 빈 슬롯: 기본값으로 되돌린다. 직전 슬롯 값을 남겨 두면 곧바로 [슬롯 적용]을 눌렀을 때
          // **다른 슬롯의 스펙**이 들어간다 — 이 핸들러가 막으려던 실수가 여기서 그대로 난다.
          slotCatalogId = 0;
          slotLevel = INVASION_LEVEL_MIN;
          slotRarity = 0;
          slotAscension = 0;
          slotAffixSeed = 0;
        }
        render();
      });
      pickRow.appendChild(slotSel);
      s.appendChild(pickRow);

      /** 라벨 + 숫자 입력 한 쌍(편집기 전용 — 값은 클로저 상태에 바로 반영). */
      function field(
        label: string,
        value: number,
        max: number,
        title: string,
        set: (n: number) => void,
      ): HTMLElement {
        const wrap = document.createElement('span');
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '3px';
        const lbl = document.createElement('span');
        lbl.className = 'pb-c-lbl';
        lbl.textContent = label;
        const input = numInput(value, 56);
        input.min = '0';
        input.max = String(max);
        input.title = title;
        input.addEventListener('input', () => {
          const n = Number(input.value);
          if (Number.isFinite(n)) set(n);
        });
        wrap.append(lbl, input);
        return wrap;
      }

      const editRow = document.createElement('div');
      editRow.className = 'pb-c-row';
      const group = current?.path.group ?? 'wave';
      editRow.append(
        field(
          '카탈로그',
          slotCatalogId,
          Math.max(0, catalogSizeFor(group) - 1),
          `이 그룹의 카탈로그 인덱스(0..${Math.max(0, catalogSizeFor(group) - 1)})`,
          (n) => {
            slotCatalogId = n;
          },
        ),
        field('레벨', slotLevel, INVASION_LEVEL_MAX, `${INVASION_LEVEL_MIN}..${INVASION_LEVEL_MAX}`, (n) => {
          slotLevel = n;
        }),
        field('등급', slotRarity, INVASION_RARITY_COUNT - 1, '0=일반 · 1=마법 · 2=희귀 · 3=유니크', (n) => {
          slotRarity = n;
        }),
      );
      s.appendChild(editRow);

      const editRow2 = document.createElement('div');
      editRow2.className = 'pb-c-row';
      editRow2.append(
        field('승급', slotAscension, INVASION_ASCENSION_MAX, `0..${INVASION_ASCENSION_MAX}`, (n) => {
          slotAscension = n;
        }),
        field('어픽스시드', slotAffixSeed, 0xffffffff, '같은 시드 → 같은 어픽스(결정론 재현)', (n) => {
          slotAffixSeed = n;
        }),
      );
      s.appendChild(editRow2);

      /** 현재 입력칸이 가리키는 Ref 스펙. */
      function spec(): {
        catalogId: number;
        level: number;
        rarity: number;
        ascension: number;
        affixSeed: number;
      } {
        return {
          catalogId: slotCatalogId,
          level: slotLevel,
          rarity: slotRarity,
          ascension: slotAscension,
          affixSeed: slotAffixSeed,
        };
      }

      const applyRow = document.createElement('div');
      applyRow.className = 'pb-c-row';
      applyRow.append(
        btn(
          '슬롯 적용',
          () => {
            if (current === undefined) return;
            harness.setInvasionLayers(setSlot(harness.invasionLayers(), current.path, spec()));
            setHint(`${current.label} 적용 — 다음 침공 런에 반영`);
          },
          '선택한 슬롯을 위 값으로 채운다(다음 런에 예약)',
        ),
        btn(
          '슬롯 비움',
          () => {
            if (current === undefined) return;
            harness.setInvasionLayers(clearSlot(harness.invasionLayers(), current.path));
            setHint(`${current.label} 비움 — 기본 수비대가 충원한다`);
          },
          '선택한 슬롯을 비운다(빈 슬롯은 기본 수비대가 충원)',
        ),
        btn(
          '전체 채움',
          () => {
            harness.setInvasionLayers(fillAll(harness.invasionLayers(), spec()));
            // 카탈로그 id 상한은 **그룹마다 다르다** — 입력칸의 max 는 지금 선택한 그룹 기준이라
            // 편대 기준으로 큰 id 를 찍으면 보스·기물에서는 조용히 낮은 id 로 접힌다. 그 사실을
            // 힌트에 적어 "왜 다른 게 나왔지"를 없앤다.
            setHint(
              `전 슬롯을 Lv${slotLevel}·등급${slotRarity} 로 채움 ` +
                '(카탈로그 id 는 그룹별 상한으로 접힘)',
            );
          },
          '전 슬롯을 위 값으로 덮는다(최악 부하 배치 만들기). 카탈로그 id 는 그룹별 상한으로 클램프된다.',
        ),
      );
      s.appendChild(applyRow);

      const filled = slots.filter((x) => x.ref !== null).length;
      const summary = document.createElement('div');
      summary.className = 'pb-c-lbl';
      summary.textContent = `예약 배치: ${filled}/${slots.length} 슬롯 채움`;
      s.appendChild(summary);
    }

    /**
     * 방어체 강화 재화 섹션(침공 탭). 방어 사령부의 강화는 **서버 권위**라 로그인 없이는
     * 아무것도 안 돌아간다 — 모의 게이트웨이를 켜면 오프라인에서도 레벨업·승급·리롤·등급
     * 승급·제작 흐름을 그대로 밟을 수 있고, 그 원장의 크레딧·희귀 광물·설계도를 여기서 준다.
     */
    function appendDefenseCurrency(s: HTMLElement): void {
      s.appendChild(subLabel('방어체 강화 재화 (모의 원장)'));
      const control = host.defense;
      if (control === undefined) {
        const note = document.createElement('div');
        note.className = 'pb-c-lbl';
        note.textContent = '방어 모의 배선이 없는 호스트입니다(main.ts 주입 필요).';
        s.appendChild(note);
        return;
      }

      const toggleRow = document.createElement('div');
      toggleRow.className = 'pb-c-row';
      const on = control.enabled();
      const toggle = btn(
        on ? '모의 ON' : '모의 OFF',
        () => {
          control.setEnabled(!control.enabled());
          setHint(control.enabled() ? '방어체 모의 원장 사용' : '실제 서버 경로로 복귀');
        },
        '켜면 방어 사령부가 인메모리 모의 원장을 쓴다(로그인 불필요)',
        on ? 'on' : undefined,
      );
      toggleRow.append(
        toggle,
        btn('보관함 12기 시드', () => {
          control.seedUnits(12);
          setHint(`모의 보관함 ${control.unitCount()}기`);
        }),
        btn('초기화', () => {
          control.reset();
          setHint('모의 원장 초기화');
        }),
      );
      s.appendChild(toggleRow);

      const cur = control.currency();
      const curRow = document.createElement('div');
      curRow.className = 'pb-c-row';
      const crIn = numInput(cur.credits, 84);
      const minIn = numInput(cur.minerals, 72);
      const bpIn = numInput(cur.blueprints, 64);
      crIn.title = '크레딧(레벨업·승급 비용)';
      minIn.title = '희귀 광물(레벨업·리롤 비용)';
      bpIn.title = '설계도(승급·등급 승급·제작 재료)';
      const crLbl = document.createElement('span');
      crLbl.className = 'pb-c-lbl';
      crLbl.textContent = 'cr / min / bp';
      curRow.append(
        crLbl,
        crIn,
        minIn,
        bpIn,
        btn('적용', () => {
          control.setCurrency({
            credits: Number(crIn.value) || 0,
            minerals: Number(minIn.value) || 0,
            blueprints: Number(bpIn.value) || 0,
          });
          const next = control.currency();
          setHint(`재화 ${next.credits}cr / ${next.minerals}min / ${next.blueprints}bp`);
        }),
      );
      s.appendChild(curRow);

      const line = document.createElement('div');
      line.className = 'pb-c-lbl';
      line.textContent = `보관함 ${control.unitCount()}기 · ${cur.credits}cr / ${cur.minerals}min / ${cur.blueprints}bp`;
      s.appendChild(line);
    }

    /**
     * 리플레이 섹션(침공 탭). 방금 돌린 침공을 **관전 재생**으로 되돌려 보고, 결정론 재현을
     * 해시로 확인하고, JSON 으로 주고받는다.
     *
     * 재생은 정식 관전(F3)과 **같은 경로**(main.ts `beginSpectate`)를 탄다 — 재생 루프를
     * 하네스가 따로 갖지 않아야 "하네스에서는 되는데 실제 관전은 깨지는" 갈림이 안 생긴다.
     * 관전 월드는 진입 즉시 오염되어 정산·제출 대상에서 빠진다(ADR-0008).
     *
     * 해시 검증(`verifyReplay`)은 sim 정본 `runReplay` 를 그대로 쓰므로, 여기서 나온 최종
     * 해시는 서버 재실행(verify-invasion)이 보는 값과 같은 축이다.
     */
    function appendReplaySection(s: HTMLElement): void {
      s.appendChild(subLabel('리플레이 (관전 재생 · 결정론 검증)'));

      const live = harness.replay();
      const last = harness.lastReplay();

      const row = document.createElement('div');
      row.className = 'pb-c-row';
      const playLast = btn(
        '▶ 마지막 런 재생',
        () => {
          setHint(harness.playReplay() ? '리플레이 재생 시작' : '재생할 리플레이가 없습니다');
        },
        '마지막으로 끝난 런(없으면 지금 도는 런)의 리플레이를 관전 재생',
        'play',
      );
      if (last === null && live === null) playLast.disabled = true;
      const playLive = btn(
        '▶ 현재 런 재생',
        () => {
          const r = harness.replay();
          setHint(
            r !== null && harness.playReplay(r)
              ? '현재 런의 리플레이 재생 시작'
              : '진행 중인 런의 리플레이가 없습니다',
          );
        },
        '지금 도는 런을 여기까지 기록한 리플레이를 관전 재생(런은 중단된다)',
      );
      if (live === null) playLive.disabled = true;
      const verify = btn(
        '해시 검증',
        () => {
          const v = harness.verifyReplay();
          // 문구를 세 갈래로 나눈다. `compared === false` 를 "재현 OK" 로 적으면 **검증하지
          // 않은 것을 검증했다고 표시**하는 셈이다(리뷰 HIGH) — 이 저장소에서 해시 발산은
          // 서버 거부로 직결되는 축이라 그 오도가 특히 비싸다.
          setHint(
            v.compared
              ? v.ok
                ? `재현 OK · ${v.ticks}틱 · hash ${v.finalHash}`
                : `재현 실패 · ${v.reason}`
              : `해시 출력 ${v.finalHash || '—'} · ${v.ticks}틱 (${v.reason})`,
          );
        },
        '리플레이를 헤드리스로 재실행해 최종 해시를 내고, 기준선이 있으면 대조한다(화면 무변경)',
      );
      if (last === null && live === null) verify.disabled = true;
      row.append(playLast, playLive, verify);
      s.appendChild(row);

      const ioRow = document.createElement('div');
      ioRow.className = 'pb-c-row';
      ioRow.append(
        btn(
          'JSON 복사',
          () => {
            const r = last ?? live;
            if (r === null) {
              setHint('복사할 리플레이가 없습니다');
              return;
            }
            const json = serializeReplay(r);
            // 클립보드는 두 가지로 실패한다: ① 권한 거부(reject) ② **API 자체 부재**.
            // ②는 비보안 컨텍스트(하네스를 `http://<LAN-IP>:5185` 로 다른 기기에서 열 때)에서
            // 흔한데, `navigator.clipboard?.writeText(...).then(...)` 은 옵셔널 체이닝이 체인
            // **전체**를 단락시켜 폴백도 힌트도 안 도는 완전 무반응이 된다. 두 경로를 갈라 둔다.
            const fallback = (): void => {
              replayPaste = json;
              setHint('클립보드 사용 불가 — 아래 상자에 넣었습니다');
            };
            const p = navigator.clipboard?.writeText(json);
            if (p === undefined) fallback();
            else void p.then(() => setHint(`리플레이 JSON 복사(${json.length}자)`), fallback);
          },
          '리플레이를 JSON 문자열로 클립보드에 복사',
        ),
        btn(
          '붙여넣기 재생',
          () => {
            const r = parseReplay(replayPaste);
            if (r === null) {
              setHint('리플레이 JSON 을 읽을 수 없습니다(형식 확인)');
              return;
            }
            setHint(harness.playReplay(r, '붙여넣은 리플레이') ? '리플레이 재생 시작' : '재생 실패');
          },
          '아래 상자의 JSON 을 리플레이로 읽어 관전 재생',
        ),
        btn(
          '상자 비움',
          () => {
            replayPaste = '';
            setHint('붙여넣기 상자를 비웠습니다');
          },
        ),
      );
      s.appendChild(ioRow);

      const paste = document.createElement('textarea');
      paste.value = replayPaste;
      paste.rows = 2;
      paste.placeholder = '리플레이 JSON 붙여넣기';
      paste.style.width = '100%';
      paste.style.boxSizing = 'border-box';
      paste.title = '다른 세션·서버에서 받은 리플레이 JSON 을 넣고 [붙여넣기 재생]';
      paste.addEventListener('input', () => {
        replayPaste = paste.value;
      });
      s.appendChild(paste);

      const line = document.createElement('div');
      line.className = 'pb-c-lbl';
      const describe = (label: string, r: ReturnType<Harness['replay']>): string => {
        if (r === null) return `${label} 없음`;
        const sum = replaySummary(r);
        const kind = sum.invasion ? '침공' : 'PvE';
        return `${label} ${kind} · seed ${sum.seed} · ${sum.ticks}틱(${sum.durationSec}초)`;
      };
      line.textContent = `${describe('현재', live)} / ${describe('마지막', last)}`;
      s.appendChild(line);
    }

    /** 보스전 탭: 보스 세그먼트 진입 + 보스 상태 라인 + 전투 치트. */
    function buildBossTab(s: HTMLElement): void {
      s.appendChild(buildPinRow());
      s.appendChild(subLabel('띄우기'));
      const row = document.createElement('div');
      row.className = 'pb-c-row';
      row.append(
        btn('보스전 시작', sceneBoss, '보스 세그먼트로 점프해 sim이 보스를 소환(풀 힐 · 오염)', 'play'),
      );
      s.appendChild(row);
      const bossLine = document.createElement('div');
      bossLine.className = 'pb-c-lbl';
      bossLine.textContent = snap.boss
        ? `보스 HP ${Math.ceil(snap.boss.hp)}/${snap.boss.maxHp} · 페이즈 ${snap.boss.phase}`
        : '보스 없음 — 위 버튼으로 진입하면 다음 틱에 소환됩니다';
      s.appendChild(bossLine);
      appendCombatCheats(s);
      appendLiveStatusLine(s);
    }

    /** 연출 탭: 레벨업 오버레이·유니크 세리머니(버튼이 무대+발동까지 수행). */
    function buildFxTab(s: HTMLElement): void {
      s.appendChild(buildPinRow());
      s.appendChild(subLabel('연출 발동 (새 런 무대 · 오염)'));
      const row = document.createElement('div');
      row.className = 'pb-c-row';
      row.append(
        btn('레벨업 오버레이', sceneLevelUp, '다음 틱에 3지선다 파워업 오버레이 표시'),
        btn('유니크 세리머니', sceneUnique, '근처에 유니크 loot 드랍 → 금빛 슬로모'),
      );
      s.appendChild(row);
    }

    /**
     * 기체 탭 — 플레이어 비주얼 **항목별 on/off**.
     *
     * 기체 AAA 비주얼 레인(PR#205)이 넣은 표현을 하나씩 켜고 끄며 눈으로 비교하기 위한 도구다.
     * 기본값은 사용자가 이 탭으로 항목을 하나씩 비교해 **확정한 조합**이고(뱅킹/롤·헤일로 2종만
     * 끔), `전부 켜기` 가 레인 머지 직후 화면이다. 토글은 **다음 프레임에 즉시** 반영된다(장식자가 매
     * 프레임 플래그를 다시 읽는다). 런 중에 켜고 꺼도 상태가 튀지 않게 각 항목의 상태 기계는
     * 스위치 밖에서 계속 돈다.
     *
     * 오염(tainted)과 무관하다 — 렌더 전용 스위치라 sim·해시·리플레이에 닿지 않는다.
     */
    function buildShipTab(s: HTMLElement): void {
      s.appendChild(buildPinRow());
      s.appendChild(subLabel('플레이어 비주얼 항목 (렌더 전용 · 비오염)'));

      const presets = document.createElement('div');
      presets.className = 'pb-c-row';
      presets.append(
        btn('확정 조합 (기본)', () => {
          resetPlayerVisualFlags();
          render();
        }, '사용자가 항목별 비교로 확정한 조합 — 뱅킹/롤과 헤일로 2종만 끈다'),
        btn('전부 켜기', () => {
          setPlayerVisualFlags(ALL_ON_PLAYER_VISUAL_FLAGS);
          render();
        }, 'PR#205 머지 직후 화면 — 레인이 넣은 것을 전부 켠다'),
        btn('전부 끄기', () => {
          setPlayerVisualFlags(
            Object.fromEntries(
              Object.keys(ALL_ON_PLAYER_VISUAL_FLAGS).map((k) => [k, false]),
            ) as Partial<PlayerVisualFlags>,
          );
          render();
        }, '레인 이전 + 헤일로까지 뺀 순수 스프라이트'),
      );
      s.appendChild(presets);

      const flags = playerVisualFlags();
      for (const group of SHIP_VISUAL_GROUPS) {
        s.appendChild(subLabel(group.title));
        for (const item of group.items) {
          const line = document.createElement('label');
          line.className = 'pb-c-chk';
          // 공용 pb-c-chk 는 inline-flex 라 항목이 옆으로 붙는다 — 목록은 한 줄에 하나여야 읽힌다.
          line.style.display = 'flex';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = flags[item.key];
          cb.addEventListener('change', () => {
            setPlayerVisualFlags({ [item.key]: cb.checked } as Partial<PlayerVisualFlags>);
            setHint(`${item.label}: ${cb.checked ? '켬' : '끔'}`);
          });
          line.appendChild(cb);
          line.appendChild(document.createTextNode(` ${item.label}`));
          line.title = item.desc;
          s.appendChild(line);
        }
      }
      s.appendChild(
        subLabel('※ 항목에 마우스를 올리면 설명이 뜹니다. 대시 항목은 회피(대시) 중에만 보입니다.'),
      );
    }

    /**
     * 갤러리 탭(Phase 1, DEV — plan §AC-1.1): 6종 변형군을 게임 화면 위 반투명 갤러리로 열어
     * 라이브 비교하고 셀 클릭으로 variant id 를 콘솔에 로그한다. window.__pb.gameApp(stage/app)에
     * 씬을 마운트한다 — main.ts 의 접근 방식(캐스팅)을 모방한다. render-only.
     */
    function buildGalleryTab(s: HTMLElement): void {
      const pb = (window as unknown as { __pb?: { gameApp?: { stage: Container; app: Application } } }).__pb;
      const gameApp = pb?.gameApp;
      const open = galleryScene.isOpen();

      s.appendChild(subLabel('프로토타입 갤러리 (6종 변형 · 라이브 비교)'));
      const row = document.createElement('div');
      row.className = 'pb-c-row';
      const toggle = btn(
        open ? '갤러리 닫기' : '갤러리 열기',
        () => {
          if (gameApp === undefined) {
            setHint('갤러리: __pb.gameApp 미배선(구버전/테스트 호스트)');
            return;
          }
          if (galleryScene.isOpen()) {
            galleryScene.unmount();
            setHint('갤러리 닫음');
          } else {
            galleryScene.mount(gameApp.stage, gameApp.app);
            setHint('갤러리 열림 — 셀 클릭 시 variant id 가 콘솔에 찍힙니다');
          }
          render();
        },
        '6종 변형군(폭발·글로우·디졸브·충격파·전환·세리머니)을 한 화면에서 라이브 비교',
        open ? 'on' : 'play',
      );
      if (gameApp === undefined) {
        toggle.disabled = true;
        toggle.title = '__pb.gameApp 미배선(구버전/테스트 호스트)';
      }
      row.appendChild(toggle);
      s.appendChild(row);

      const note = document.createElement('div');
      note.className = 'pb-c-lbl';
      note.textContent = open
        ? '열림: 시안 테두리=추천 기본값. 셀 클릭 → 콘솔에 variant id. 고른 뒤 알려주세요.'
        : 'DEV 전용 · render-only. 게임 화면 위에 반투명 갤러리를 띄웁니다.';
      s.appendChild(note);
    }

    /** 정산 탭: 승/패 결과 오버레이(오염 런은 settlement 생략, 화면 표시만). */
    function buildResultTab(s: HTMLElement): void {
      s.appendChild(subLabel('결과 오버레이 (새 런 무대 · 오염)'));
      const row = document.createElement('div');
      row.className = 'pb-c-row';
      row.append(
        btn('정산 · 승리', () => sceneResult(true), '승리 강제 → 결과 오버레이'),
        btn('정산 · 패배', () => sceneResult(false), '패배 강제 → 결과 오버레이'),
      );
      s.appendChild(row);
    }

    /** 메뉴 탭: 화면 점프 + 프로필 데이터 지급(메뉴 UI 변화를 눈으로 확인). */
    function buildMenusTab(s: HTMLElement): void {
      s.appendChild(subLabel('화면 점프'));
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

      s.appendChild(subLabel('재화 지급 (하네스 프로필)'));
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

      s.appendChild(subLabel('장비 지급 (활성 기체)'));
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

      // 액티브 슬롯 장착 치트(ADR-0041). 슬롯 1=z · 슬롯 2=x. 정규화(그 타입의 스킬이 아니면
      // 탈락)는 저장층이 하므로 여기선 셀렉트 값을 그대로 넘긴다. 레지스트리가 비어 있으면
      // (0a-14 시점 — 0b/E 레인이 채운다) 빈 슬롯 선택지뿐이다.
      s.appendChild(subLabel('액티브 슬롯 장착 (활성 기체)'));
      const catalog = harness.activeSkillCatalog();
      const curSlots = harness.snapshot().activeSlots;
      const buildSlotSel = (): HTMLSelectElement => {
        const sel = document.createElement('select');
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '(비움)';
        sel.appendChild(empty);
        for (const d of catalog) {
          const o = document.createElement('option');
          o.value = d.id;
          o.textContent = `${d.id} [${d.tier}/${d.kind}]`;
          sel.appendChild(o);
        }
        return sel;
      };
      const slot1Sel = buildSlotSel();
      slot1Sel.value = curSlots[0] ?? '';
      const slot2Sel = buildSlotSel();
      slot2Sel.value = curSlots[1] ?? '';
      const activeRow = document.createElement('div');
      activeRow.className = 'pb-c-row';
      activeRow.append(
        slot1Sel,
        slot2Sel,
        btn('액티브 장착', () => {
          const applied = harness.setActiveSlots([
            slot1Sel.value || null,
            slot2Sel.value || null,
          ]);
          setHint(`액티브 슬롯 → [${applied[0] ?? '-'}, ${applied[1] ?? '-'}]`);
        }, '슬롯1(z)/슬롯2(x)에 장착할 액티브를 고른다. 그 기체 타입의 스킬이 아니면 저장 시 탈락.'),
      );
      s.appendChild(activeRow);
      if (catalog.length === 0) {
        const note = document.createElement('div');
        note.className = 'pb-c-lbl';
        note.textContent = '이 기체 타입의 액티브 레지스트리가 비어 있습니다(구현 대기).';
        s.appendChild(note);
      }

      // 기체 타입 치트(M8). 런의 `WorldConfig.shipType` 은 createWorld 시점에 봉인되므로
      // **런을 시작하기 전에** 바꿔야 그 타입으로 도는 런이 만들어진다(라이브 런에 걸면 오염).
      s.appendChild(subLabel('기체 타입 (런 시작 전에 바꿀 것 — ADR-0008)'));
      const shipRow = document.createElement('div');
      shipRow.className = 'pb-c-row';
      const shipSel = document.createElement('select');
      const slugs = harness.shipTypeSlugs();
      const currentType = harness.snapshot().shipTypeId;
      for (let i = 0; i < slugs.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${i}: ${slugs[i] ?? '?'}`;
        if (i === currentType) o.selected = true;
        shipSel.appendChild(o);
      }
      shipSel.title =
        '활성 기체의 타입을 바꾼다. 투자 벡터는 그 타입의 무투자 벡터로 초기화된다 ' +
        '(타입마다 노드 수·의미가 달라 옛 벡터를 그대로 두면 다른 트리로 잘못 읽힌다). ' +
        '라이브 런이 있으면 그 런은 오염된다 — 반드시 런 시작 전에.';
      shipRow.append(
        shipSel,
        btn('기체 타입 적용', () => {
          const applied = harness.setShipType(Number(shipSel.value));
          setHint(`기체 타입 → ${applied}:${slugs[applied] ?? '?'} (런은 새로 시작할 것)`);
        }),
      );
      s.appendChild(shipRow);

      s.appendChild(subLabel('프리셋 (하네스 프로필 통째 교체)'));
      const row4 = document.createElement('div');
      row4.className = 'pb-c-row';
      row4.append(
        btn('프리셋: 신규', () => {
          harness.preset('fresh');
          setHint('프리셋 fresh 주입');
        }),
        btn('프리셋: 만렙', () => {
          harness.preset('maxed');
          setHint('프리셋 maxed 주입');
        }),
      );
      s.appendChild(row4);
    }

    /** 수호·계보 탭(M5 Phase A — 퇴역 1사이클 딥링크: AC1/AC3/AC4 흐름 검증). */
    function buildGuardianTab(s: HTMLElement): void {
      const status = document.createElement('div');
      status.className = 'pb-c-lbl';
      const refreshStatus = (): void => {
        const p = host.getProfile();
        const active = p.guardians.filter((g) => !g.retired).length;
        const shipPct = (branchBonusBp(p.lineage.shipLevel) / 100).toFixed(1);
        const guardPct = (branchBonusBp(p.lineage.guardianLevel) / 100).toFixed(1);
        // 해금된 마일스톤 질적 노드(레벨 도달 자동 해금 — 격추 재기동/코어 근접/실드 공유).
        const mask = guardianMilestones(p.lineage.guardianLevel);
        const nodes: string[] = [];
        if (hasMilestone(mask, MILESTONE_REBOOT)) nodes.push('격추재기동');
        if (hasMilestone(mask, MILESTONE_CORE_GUARD)) nodes.push('코어근접');
        if (hasMilestone(mask, MILESTONE_SHIELD_SHARE)) nodes.push('실드공유');
        const milestoneText = nodes.length > 0 ? nodes.join('·') : '없음';
        status.textContent =
          `수호 ${active}기(활성)/${p.guardians.length}(총) · 계보 pt ${p.lineage.available} · ` +
          `기체Lv ${p.lineage.shipLevel}(+${shipPct}%)·수호Lv ${p.lineage.guardianLevel}(+${guardPct}%) · ` +
          `마일스톤 ${milestoneText}`;
      };
      refreshStatus();

      const retireRow = document.createElement('div');
      retireRow.className = 'pb-c-row';
      /**
       * 치트 퇴역 = **만렙 강제 후 퇴역**. 퇴역은 만렙 게이트(`retireActiveShip`)가 걸려 있어
       * 레벨을 올려 주지 않으면 치트 버튼이 조용히 아무 일도 안 한다(치트 패널의 존재 이유가
       * "조건 없이 상태를 만들어 본다" 이므로 게이트를 우회하는 쪽이 의도에 맞다).
       */
      const cheatRetire = (preset: number, label: string): void => {
        const profile = host.getProfile();
        activeShip(profile).level = LEVEL_CAP;
        const r = retireActiveShip(profile, preset);
        if (r === null) {
          setHint(`퇴역(${label}) 거부 — 만렙 게이트`);
          return;
        }
        host.saveProfile();
        refreshStatus();
        setHint(`퇴역(${label}) → 수호 생성 전투력 ${r.guardian.combatScore}, 계보 +${r.granted}pt`);
      };
      retireRow.appendChild(
        btn('퇴역 · 타이탄', () => cheatRetire(GUARDIAN_TITAN, '타이탄'),
          '만렙 강제 후 퇴역 → 타이탄형 수호 기체 생성 + 계보 지급'),
      );
      retireRow.appendChild(
        btn('퇴역 · 인터셉터', () => cheatRetire(GUARDIAN_INTERCEPTOR, '인터셉터'),
          '만렙 강제 후 퇴역 → 인터셉터형 수호 기체 생성 + 계보 지급'),
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

      /**
       * 계보 **서버 모의** 토글 — 계보 조작은 서버가 확정하므로(ADR-0007 배선), Supabase 설정이
       * 없는 개발 환경에서는 계보 전당·로스터 소멸·기체 교체가 통째로 잠긴다. 이 토글이 모의
       * 게이트웨이를 끼워 그 화면들을 밟을 수 있게 한다(방어 사령부 모의와 같은 규율).
       *
       * ⚠️ 위 [일괄 소멸]·[계보 투자] 버튼은 **로컬 Profile 을 직접 만지는 구 경로**다. 모의
       * 서버를 켠 상태에서 쓰면 로컬만 앞서 나가고, 화면 진입 시 pull 이 서버 값으로 되돌린다 —
       * 그 되돌림을 관찰하는 것이 이 조합의 용도다(실사용자에게 일어날 수 있는 상태다).
       */
      const mockRow = document.createElement('div');
      mockRow.className = 'pb-c-row';
      let lineageMock: import('./lineageMock.js').HarnessLineageGateway | null = null;
      mockRow.appendChild(
        btn('계보 서버 모의 ON/OFF', () => {
          void (async () => {
            if (lineageMock !== null) {
              setLineageGatewayOverride(null);
              lineageMock = null;
              setHint('계보 서버 모의 OFF — 계보 화면이 오프라인으로 잠긴다');
              return;
            }
            const mod = await import('./lineageMock.js');
            const gw = new mod.HarnessLineageGateway();
            // 지금 로컬에 있는 수호기를 모의 서버로 옮겨 심는다 — 안 그러면 pull 이 목록을
            // 비워 소멸 화면을 밟을 수 없다(pull 은 서버 정본으로 **교체**한다).
            const p = host.getProfile();
            gw.seedGuardians(
              p.guardians
                .filter((g) => !g.retired)
                .map((g) => ({
                  snapshot: g.snapshot,
                  performanceCP: g.performanceCP,
                  combatScore: g.combatScore,
                  preset: g.preset,
                  ...(g.build !== undefined ? { build: g.build } : {}),
                })),
            );
            gw.grantPoints(p.lineage.available);
            setLineageGatewayOverride(gw);
            lineageMock = gw;
            const st = gw.peek();
            setHint(`계보 서버 모의 ON — 수호 ${st.guardians}기 · ${st.available}pt 이관`);
          })();
        }, '설정 없는 dev 에서 계보 화면을 밟기 위한 인메모리 서버(ADR-0008 하네스 전용)'),
      );
      s.appendChild(mockRow);
      s.appendChild(status);
    }

    /** 인스펙터 탭: 스냅샷 덤프 + 최근 이벤트 + 엔티티 목록. */
    function buildInspectTab(s: HTMLElement): void {
      const dump = document.createElement('pre');
      dump.className = 'pb-c-dump';
      const bossLine = snap.boss
        ? `boss hp ${Math.ceil(snap.boss.hp)}/${snap.boss.maxHp} ph${snap.boss.phase}`
        : 'boss -';
      const counts = Object.entries(snap.entityCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      // 행성 모드 라인(ADR-0021): 도는 모드에서만 의미 있는 수치 하나를 붙인다(그 외는 slug 만).
      const m = snap.mode;
      const modeDetail =
        m.slug === 'shrink'
          ? ` 안전R ${m.safeRadius}`
          : m.slug === 'chase'
            ? ` 대피소 ${m.sheltersSecured}/${m.sheltersTotal} 시야R ${m.visionRadius}`
            : m.slug === 'blockBreak' || m.slug === 'racing'
              ? ` 구간 ${m.scrollSection}`
              : m.slug === 'contamination'
                ? ` 임계 ${m.contaminationCritical ? 'YES' : 'no'}`
                : '';
      dump.textContent =
        `screen ${snap.screen}  tick ${snap.tick}\n` +
        `hp ${Math.ceil(snap.hp)}/${snap.maxHp}  lv ${snap.level}  xp ${snap.xp}\n` +
        `seg ${snap.segment}  kills ${snap.kills}  combo ${snap.combo}\n` +
        `모드 ${m.slug}(${m.mode})${modeDetail}\n` +
        `${bossLine}\n` +
        `hash ${snap.hash || '-'}  seed ${snap.seed}\n` +
        `프로필 c${snap.profileSummary.credits} m${snap.profileSummary.minerals} ` +
        `shipLv${snap.profileSummary.shipLevel} type${snap.shipTypeId}\n` +
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

  // 포인터로 패널을 누르는 동안 자동 재빌드를 억제해 click 유실을 막는다(pointerActive).
  // pointerup 직후 click 이 동기로 발화하므로, 억제 해제는 다음 프레임(rAF)으로 미뤄
  // 그 click 과 그 안의 render()가 끝난 뒤에야 250ms 재빌드가 재개되게 한다. rAF 가
  // 없는 환경(테스트 등)에서는 setTimeout(0)로 폴백한다.
  const releasePointer = (): void => {
    pointerActive = false;
  };
  function onPointerDown(): void {
    pointerActive = true;
  }
  function schedulePointerRelease(): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(releasePointer);
    else window.setTimeout(releasePointer, 0);
  }
  root.addEventListener('pointerdown', onPointerDown);
  // pointerup 은 패널 밖에서 떼도 잡도록 window 에 건다. 드래그 이탈·터치 취소
  // (pointercancel), 그리고 버튼을 누른 채 커서가 창 밖으로 나가 떼는 경우의 안전망으로
  // window blur 까지 해제 트리거로 묶는다 — 포인터가 정상 해제되지 않아 억제가 true 로
  // 고착돼 인스펙터 자동 갱신이 멈추는 상황을 막기 위함(그래도 다음 창 내부 클릭이 자가 치유).
  window.addEventListener('pointerup', schedulePointerRelease);
  window.addEventListener('pointercancel', schedulePointerRelease);
  window.addEventListener('blur', schedulePointerRelease);

  // 열려 있는 동안 250ms마다 인스펙터/상태 갱신. 단, (1) 패널 안의 입력 필드를 편집
  // 중이거나 (2) 포인터로 버튼을 누르는 중이면 재빌드를 건너뛴다 — render()가 innerHTML을
  // 갈아엎어 포커스·캐럿을 훔치거나(리뷰 MED) 눌린 버튼을 교체해 click 을 유실시키기 때문.
  const timer = window.setInterval(() => {
    if (body.classList.contains('hidden')) return;
    if (pointerActive) return;
    const ae = document.activeElement;
    if (ae !== null && body.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    render();
  }, 250);

  // 로그인 상태는 따로, 더 느리게 읽는다 — 250ms 주기에 얹으면 세션 조회가 초당 4회 돈다.
  // 2초면 OAuth 왕복 복귀 직후의 지연을 흡수하기에 충분하다.
  refreshAccount();
  const accountTimer = window.setInterval(() => {
    if (body.classList.contains('hidden')) return;
    refreshAccount();
  }, 2000);

  return {
    destroy(): void {
      window.clearInterval(accountTimer);
      // 갤러리 씬이 열려 있으면 함께 정리(ticker 콜백·핸들·백드롭 누수 0).
      galleryScene.unmount();
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', schedulePointerRelease);
      window.removeEventListener('pointercancel', schedulePointerRelease);
      window.removeEventListener('blur', schedulePointerRelease);
      root.remove();
      style.remove();
    },
  };
}
