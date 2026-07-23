/**
 * Entry point.
 *
 * Wires the deterministic sim to the PixiJS renderer with a fixed-timestep loop:
 * the sim steps at exactly 60 Hz (accumulator pattern) while rendering happens
 * every animation frame, interpolating between the two most recent sim snapshots
 * so motion is smooth on any refresh rate.
 *
 * M2 wraps the run in a meta loop (plan Phase C/D): a persistent `Profile`
 * (localStorage) feeds the star-map screen (planet/stage/anomaly) and the
 * inventory/equip screen. The active ship's equipped gear becomes a `LoadoutConfig`
 * (computeLoadoutStats) injected into the run's WorldConfig; when the run ends the
 * collected loot + XP are settled back into the profile and saved, then the
 * player returns to the star map.
 *
 * `?bench=1` launches the performance bench scene instead (Phase 4 harness).
 * `?seed=<n>` pins the run seed (else a fresh random seed per launch).
 */

import { TilingSprite } from 'pixi.js';
import { createGameApp, DESIGN_WIDTH, DESIGN_HEIGHT } from './render/app.js';
import { loadGameTextures, applyShipSprite } from './render/textures.js';
import { EntityRenderer } from './render/entityRenderer.js';
import { DefensePreviewController } from './render/defensePreview.js';
import type { DefensePreviewControls } from './render/defensePreview.js';
import { AutotileBackground, loadWangTiles } from './render/autotile.js';
import type { WangTiles } from './render/autotile.js';
import { FpsMeter } from './render/fpsMeter.js';
import { Radar } from './render/radar.js';
import { UniqueCeremony } from './render/ceremony.js';
import { InputController } from './input/controller.js';
import { Hud } from './ui/hud.js';
import type { BossHudState } from './ui/hud.js';
import { PowerupOverlay } from './ui/powerupOverlay.js';
import { levelUpOverlayAction, readBuildStatus } from './ui/buildStatus.js';
import { shouldEnterSettlement } from './ui/runFlow.js';
import type { LaunchSelection } from './ui/planetSelect.js';
import { HangarScreen } from './ui/pixi/hangar.js';
import { BaseMapScreen } from './ui/pixi/baseMap.js';
import { ResearchLabScreen } from './ui/pixi/researchLab.js';
import { RefineryScreen } from './ui/pixi/refinery.js';
import { PlanetSelectScreen } from './ui/pixi/planetSelect.js';
import { ResultOverlayScreen } from './ui/pixi/resultOverlay.js';
import { ControlTowerScreen } from './ui/pixi/controlTower.js';
import { ModulesScreen } from './ui/pixi/modulesView.js';
import { DefenseCommandScreen } from './ui/pixi/defenseCommand.js';

import type { ControlTowerShowOpts, InvasionResultView } from './ui/controlTower.js';
import { TitleScreen } from './ui/pixi/titleScreen.js';
import { RecordsArchiveScreen } from './ui/pixi/recordsArchive.js';
import { IntroSlidesScreen } from './ui/pixi/introSlides.js';
import {
  TutorialOverlay,
  FtueTracker,
  TUTORIAL_SEED,
  TUTORIAL_PLANET,
  TUTORIAL_STAGE,
  TUTORIAL_MAX_SEGMENTS,
} from './ui/tutorial.js';
import {
  createWorld,
  stepWorld,
  markTainted,
  DT,
  xpToNext,
  comboMultiplier,
  DEFAULT_CONFIG,
  echoStabilizedOf,
  runStoryMetrics,
} from './sim/world.js';
import type { WorldState, InputFrame } from './sim/world.js';
// 스토리 시스템(Phase E): 에코 안정화로 실을 파편 슬롯이 남았는지 판정(로어 토스트 예측용).
import { RECORD_SHARDS } from '../data/lore/index.js';
// DEV 하네스: 타입만 정적 import(런타임 값은 아래 import.meta.env.DEV 블록에서 동적
// import 하므로 프로덕션 번들에서 완전히 제거된다). 타입 import는 컴파일 시 소거됨.
import type { Harness, HarnessScreen } from './harness/core.js';
import { snapshotWorld } from './sim/snapshot.js';
import type { WorldSnapshot } from './sim/snapshot.js';
import { ReplayRecorder, hashWorld } from './sim/replay.js';
import { SeededRng } from './sim/rng.js';
import { rollAnomaly } from './sim/anomaly.js';
import { runBench } from './bench/bench.js';
// 런 설정 조립 **단일 정본**(M8 설계서 §10-2). PvE·정식 침공·하네스 침공 세 경로가 전부
// 이것만 쓴다 — main.ts 안에서 config 를 다시 조립하지 마라(3중복이 배선 누락의 원인이었다).
import { buildRunConfig } from './run/runConfig.js';
import type { RunConfigOpts } from './run/runConfig.js';
import { EQUIP_SLOTS } from './items/types.js';
import type { Item } from './items/types.js';
import { loadProfile, saveProfile, activeShip } from './save/profile.js';
import { settleRun } from './save/settlement.js';
import type { SettlementOutcome } from './save/settlement.js';
// M4 네트워크 계층(Phase B3): Supabase 미설정 시 완전 no-op, 절대 throw 안 함.
// 정산 시점에서만 fire-and-forget 로 호출 — sim/게임루프와 무관(결정론·오프라인 우선).
import {
  migrateLocalProfileToServer,
  recordPveRunResult,
  recordPveRun,
  pushProfileToServer,
} from './net/index.js';
// M4 침공(비동기 PvP) 제출: 미설정 시 submitInvasion 은 null(잠정 결과만 표시).
import {
  submitInvasion,
  buildClientResult,
  maintenanceToCenti,
  beginInvasion,
  fetchInvasionReplay,
  setInvasionSticker,
} from './net/invasion.js';
import type { InvasionTarget } from './net/invasion.js';
// M7b 방어체 경제: 설계도 지급(정산 파생) + 보관함·강화 게이트웨이 팩토리 등록.
import { grantBlueprintDrops } from './net/blueprints.js';
import { setDefenseUnitsGatewayFactory } from './net/defenseUnits.js';
import { readSupabaseConfig } from './net/config.js';
// M7a 침공 3레이어(ADR-0017): 침공 런은 구 단일 아레나 `WorldConfig.invasion` 이 아니라
// `invasion3`(L1 대기권 → L2 회랑 → L3 코어방) 로 만든다. 두 필드를 함께 지정하면 방어
// 배치가 이중 스폰되므로 **한쪽만** 쓴다.
import {
  INVASION_TOTAL_TICKS,
  MAINTENANCE_FULL,
  PHASE_L1,
  normalizeInvasionLayers,
} from './sim/invasion/index.js';
import type { Invasion3Config } from './sim/invasion/index.js';
import type { CoreModuleConfig } from './sim/moduleEffects.js';
import type { ModuleInstance } from '../data/coreModules.js';
// M4 Phase F: 리플레이 관전(F3) + 도발 스티커(F2).
import { SpectateOverlay, isPlayableReplay, nextSpectateSpeed } from './ui/replaySpectate.js';
import type { SpectateSpeed } from './ui/replaySpectate.js';
import { StickerPicker } from './ui/stickerPicker.js';
import type { Replay } from './sim/replay.js';
// M5 Phase C: 사운드(C1)·정산 완성판(C2)·로컬라이즈(C3). 전부 render/UI 레이어(sim 무수정).
import { GameAudio } from './render/audio.js';
import { RunSoundObserver } from './render/soundScape.js';
import { SettingsScreen } from './ui/pixi/settingsPanel.js';
import { t } from './i18n/index.js';
import { totalCombatPower } from './save/combatPower.js';
import type { ResultDrop } from './ui/resultOverlay.js';

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  if (mount === null) throw new Error('#app mount element not found');

  const params = new URLSearchParams(window.location.search);
  if (params.get('bench') === '1') {
    await runBench(mount);
    return;
  }

  // DEV 하네스 프로필 활성화(ADR-0008): `?harness=1`이면 프로필 I/O를 격리된 하네스
  // 슬롯으로 리다이렉트한다 — 반드시 loadProfile 이전에 오버라이드를 걸어야 본 세이브
  // 대신 하네스 슬롯을 읽는다. 프로덕션에서는 import.meta.env.DEV가 정적으로 false라
  // 이 블록·동적 import가 통째로 제거된다.
  const harnessActive = import.meta.env.DEV && params.get('harness') === '1';
  if (harnessActive) {
    const core = await import('./harness/core.js');
    core.setProfileStoreOverride(core.harnessProfileStore());
  }

  const gameApp = await createGameApp(mount);
  const hud = new Hud();
  const powerupOverlay = new PowerupOverlay();
  const textures = await loadGameTextures(gameApp.app.renderer);
  // Planet backdrop by index, with a guaranteed non-undefined fallback (the
  // array always holds 4 entries; the extra `?? gem` only satisfies the strict
  // index type — it is never reached at runtime).
  const planetBackground = (i: number) =>
    textures.background[i] ?? textures.background[0] ?? textures.gem;
  // Arena backdrop tiled beneath the entities. Starts on the Kargon theme
  // (slot 0); `startRun` swaps in the launched planet's backdrop each run.
  const background = new TilingSprite({
    texture: planetBackground(0),
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  });
  gameApp.stage.addChild(background);
  // Wang autotile terrain floor (render-only). Sits above the flat TilingSprite
  // fallback and below entities. Each run's planet tileset + seed is applied in
  // `startRun`; a planet with no bundled tileset keeps the TilingSprite backdrop.
  const autotile = new AutotileBackground();
  gameApp.stage.addChild(autotile.layer);
  // Load all six planet Wang tilesets up front (missing ones resolve to null →
  // that planet falls back to the procedural TilingSprite, regression 0).
  const wangTiles: (WangTiles | null)[] = await Promise.all([
    loadWangTiles(0),
    loadWangTiles(1),
    loadWangTiles(2),
    loadWangTiles(3),
    loadWangTiles(4),
    loadWangTiles(5),
  ]);
  const entityRenderer = new EntityRenderer(textures);
  gameApp.stage.addChild(entityRenderer.layer);

  // 우상단 플레이어 중심 레이더(렌더 전용, ADR-0009). entityRenderer.layer는 카메라를
  // 따라 팬되지만 레이더는 stage에 직접 붙여 화면 고정 HUD로 둔다. 하단-좌 HUD·상단-중
  // 보스바·하단-우 치트 패널과 겹치지 않는 우상단에 배치.
  const radar = new Radar();
  radar.layer.position.set(DESIGN_WIDTH - 24 - radar.radiusPx, 24 + radar.radiusPx);
  gameApp.stage.addChild(radar.layer);

  // 블랙아웃(방어자 유니크 카드) 발동 중 공격자 화면에 띄우는 렌더 전용 배너. sim 무관 — 잔여
  // 틱만 관찰해 표시한다(카드 미장착/PvE 면 절대 뜨지 않음).
  const blackoutBanner = document.createElement('div');
  blackoutBanner.id = 'pb-blackout';
  blackoutBanner.style.cssText =
    'position:absolute; top:16px; left:50%; transform:translateX(-50%); z-index:28; display:none;' +
    "padding:6px 16px; border-radius:10px; font-family:'Segoe UI',system-ui,sans-serif; font-size:15px; font-weight:800;" +
    'color:#0a0410; background:linear-gradient(90deg,#c86aff,#7affea); box-shadow:0 4px 16px rgba(200,106,255,.4); pointer-events:none;';
  document.body.appendChild(blackoutBanner);

  /**
   * 레이더를 그리되, 방어자 코어 모듈 유니크 '블랙아웃'이 발동 중이면(공격자 = 현재 플레이어의
   * 레이더 무력화, moduleRuntime.blackoutTicksLeft>0) 레이더를 숨기고 상단 배너를 띄운다. 렌더
   * 전용 게이트 — sim 은 무변경(모듈 미장착/PvE 면 moduleRuntime 부재라 항상 정상 렌더).
   * 블랙아웃 잔여 틱은 stepModuleRuntime 이 카운트다운한다(M7b).
   */
  function renderRadarGated(): void {
    const cr = world?.moduleRuntime;
    if (cr !== undefined && cr.blackoutTicksLeft > 0) {
      radar.layer.visible = false;
      blackoutBanner.textContent = t('mod.hud.blackout', { n: Math.ceil(cr.blackoutTicksLeft / 60) });
      blackoutBanner.style.display = 'block';
      return;
    }
    if (blackoutBanner.style.display !== 'none') blackoutBanner.style.display = 'none';
    radar.render(currSnap);
  }

  const controller = new InputController(gameApp);
  const fps = new FpsMeter();
  // 유니크 드랍 세리머니(렌더 전용): 슬로모 + 금빛 플래시. 시뮬 결과 무영향.
  const ceremony = new UniqueCeremony();

  // --- Persistent meta state (M2) ---
  const profile = loadProfile();
  // 로컬 세이브 → 서버 1회 이관(멱등, 무손실). 미설정이면 no-op. 비차단.
  void migrateLocalProfileToServer(profile);
  // M7b: 방어체 보관함·강화 게이트웨이 팩토리 등록. 등록 전에는 net/defenseUnits 의 모든
  // 공개 함수가 no-op 이라 방어 사령부가 영구 '오프라인'으로 보인다. **설정이 있을 때만**
  // 동적 import 하는 이유는 Supabase SDK 를 메인 청크에 싣지 않기 위해서다(modules.ts 와
  // 같은 규율). 실패해도 삼킨다 — 배치 편집·프리뷰·시험 침공은 서버 없이도 전부 동작한다.
  if (readSupabaseConfig() !== null) {
    void import('./net/defenseUnitsGateway.js')
      .then((m) => {
        setDefenseUnitsGatewayFactory((config) => new m.SupabaseDefenseUnitsGateway(config));
      })
      .catch(() => {
        /* SDK 로드 실패 = 오프라인과 동일 취급 */
      });
  }
  // 격납고 카툰 UI 파일럿(plan hangar-cartoon-ui): 기존 DOM InventoryOverlay 대신 Pixi
  // 캔버스 격납고로 진입점을 교체한다(인터페이스 show/hide/visible 동일). InventoryOverlay
  // 클래스는 회귀 대비로 유지(삭제하지 않음).
  const inventory = new HangarScreen(profile, gameApp.stage);
  // M3 base-map hub + building screens + FTUE (Phase D/E).
  // 카툰나무풍 롤아웃 #1(cartoonwood-rollout §화면 1): DOM `BaseMap` 대신 Pixi 캔버스 허브로
  // 진입점을 교체한다(show/hide/visible + 콜백 타입 동일). DOM 클래스는 회귀 대비로 유지.
  const baseMap = new BaseMapScreen(gameApp.stage);
  // 카툰나무풍 롤아웃 #2: DOM `ResearchLab` 대신 Pixi 캔버스 연구소로 교체(인터페이스 동일).
  const researchLab = new ResearchLabScreen(profile, gameApp.stage);
  // 카툰나무풍 롤아웃 #3: DOM `Refinery` 대신 Pixi 캔버스 정제소로 교체(인터페이스 동일).
  const refinery = new RefineryScreen(profile, gameApp.stage);
  // 카툰나무풍 롤아웃 #4: DOM `PlanetSelect` 대신 Pixi 캔버스 성계 지도로 교체(show/hide/
  // visible + LaunchSelection 동일). 다른 캔버스 메타 화면과 같은 블록에서 만들어야
  // entityRenderer·radar 레이어보다 **뒤에** stage 에 붙어 위로 그려진다(z 순서).
  const planetSelect = new PlanetSelectScreen(gameApp.stage);
  // 카툰나무풍 롤아웃 #5: DOM `ResultOverlay` 대신 Pixi 캔버스 정산 화면으로 교체(show/hide/
  // visible + ResultState 동일). 다른 캔버스 화면과 같은 이유로 여기서 만든다 — 앞쪽(텍스처
  // 로드 전)에서 만들면 entityRenderer·radar 보다 먼저 stage 에 붙어 아레나 아래에 깔린다.
  const resultOverlay = new ResultOverlayScreen(gameApp.stage);
  // 카툰나무풍 롤아웃 #6: DOM `ControlTower` 대신 Pixi 캔버스 관제탑으로 교체(show/hide/
  // visible + 콜백·옵션 타입 동일). 다른 캔버스 화면과 같은 블록에서 만들어야
  // entityRenderer·radar 레이어보다 **뒤에** stage 에 붙어 위로 그려진다(z 순서).
  const controlTower = new ControlTowerScreen(gameApp.stage);
  // 스토리 시스템 Phase C2/C3: 기록 보관소(서사 열람 시설) + 세계관 인트로 슬라이드. 다른 캔버스
  // 화면과 같은 블록에서 만들어야 entityRenderer·radar 레이어보다 뒤에 붙어 위로 그려진다(z 순서).
  const recordsArchive = new RecordsArchiveScreen(gameApp.stage);
  const introSlides = new IntroSlidesScreen(gameApp.stage);
  // 코어 모듈 화면(M7b — 구 카드 화면 계승). 진입은 방어 사령부의 모듈 탭 버튼이고, 사령부는
  // 자기 화면만 suspend 로 감췄다가 닫힐 때 resume 한다(미저장 배치 편집을 지키기 위해 show 를
  // 다시 부르지 않는다). 다른 캔버스 화면과 같은 블록에서 만들어야 z 순서가 맞는다.
  const modulesScreen = new ModulesScreen(profile, gameApp.stage);

  // 3레이어 배치 프리뷰(M7b) — 방어 사령부가 자기 루트에 붙여 배경 위·패널 아래로 순서를
  // 잡는다(`attachTo`). 목업이 아니라 실제 `createWorld(invasion3)` 정지 렌더다.
  const defensePreview: DefensePreviewControls = new DefensePreviewController({ textures });
  // 방어 사령부(M7b-command-ui) — 침공 3레이어 배치 사령. 다른 캔버스 화면과 같은 블록에서
  // 만들어야 entityRenderer·radar 레이어보다 **뒤에** stage 에 붙어 위로 그려진다(z 순서).
  const defenseCommand = new DefenseCommandScreen(profile, gameApp.stage, defensePreview);

  /**
   * 방어 사령부 진입(기지 맵·하네스 공용).
   *
   * 코어 모듈 관리는 별도 캔버스 화면이라 **suspend/resume** 으로 오간다 — `show()` 로 되돌리면
   * 사령부의 미저장 배치 편집이 날아간다(실측 규율). 시험 침공은 하네스 침공 경로로 보낸다:
   * `startHarnessInvasionRun` 은 `invasionTarget` 을 세우지 않고 `harnessInvasionRun` 만 세우므로
   * 정산도 리플레이 제출도 타지 않는다(ADR-0008 오염 런 격리).
   */
  function openDefenseCommand(): void {
    defenseCommand.show(profile, {
      onClose: () => openBaseMap(),
      onTestInvade: (layers) => {
        startHarnessInvasionRun({
          seed: nextSeed(),
          layers,
          maintenance: MAINTENANCE_FULL,
          timeLimitTicks: INVASION_TOTAL_TICKS,
        });
      },
      onOpenModules: (resume) => {
        modulesScreen.show(profile, () => {
          resume();
        });
      },
    });
  }
  // M4 Phase F: 관전 컨트롤 오버레이(F3) + 도발 스티커 선택(F2).
  const spectateOverlay = new SpectateOverlay();
  const stickerPicker = new StickerPicker();
  // 타이틀도 카툰나무풍 Pixi 다(#8 과 같은 PR) — DOM 판이면 캔버스 안 설정 톱니를 덮는다.
  const titleScreen = new TitleScreen(gameApp.stage);
  const tutorialOverlay = new TutorialOverlay();
  const ftue = new FtueTracker();
  // M5 C1: 절차 합성 사운드 + 런 사운드 관찰자(sim 스냅샷 델타 → SFX, 단방향 render).
  const audio = new GameAudio();
  const soundObserver = new RunSoundObserver(audio);
  // 자동재생 정책: 아무 첫 사용자 제스처에서 오디오 컨텍스트를 잠금 해제한다.
  const unlockAudioOnce = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudioOnce);
    window.removeEventListener('keydown', unlockAudioOnce);
  };
  window.addEventListener('pointerdown', unlockAudioOnce);
  window.addEventListener('keydown', unlockAudioOnce);
  // M5 C1/C3: 좌상단 설정(사운드·볼륨·언어) — 카툰나무풍 롤아웃 #8 로 Pixi 이관.
  // 화면이 아니라 크롬 UI 라 clearToMenu() 에 없고 런 중에도 떠 있다. 다른 캔버스 화면이
  // show() 에서 자기를 stage 맨 앞으로 올리므로 렌더 루프에서 raise() 로 되돌린다.
  const settings = new SettingsScreen(audio, gameApp.stage, () => rerenderCurrentScreen());
  let tutorialActive = false;
  // 현재 오버레이가 띄운 레벨업의 기체 레벨(멀티 레벨업 시 신규 레벨업 감지용). 0 = 미표시.
  let shownLevel = 0;

  // An empty snapshot rendered on menu frames clears the arena behind overlays.
  const emptySnap: WorldSnapshot = {
    tick: 0,
    arenaWidth: DEFAULT_CONFIG.arenaWidth,
    arenaHeight: DEFAULT_CONFIG.arenaHeight,
    cameraX: 0,
    cameraY: 0,
    planet: 0,
    visionRadius: 0, // 메뉴 프레임 — 시야 제한 없음(추격 아님).
    safeRadius: 0, // 메뉴 프레임 — 안전 반경 제한 없음(수축 아님).
    entities: [],
    beams: [],
  };

  // --- Live run state (null while in menus) ---
  let world: WorldState | null = null;
  let recorder: ReplayRecorder | null = null;
  let currentSeed = 0;
  let settled = false;
  let lastOutcome: SettlementOutcome | null = null;
  let prevSnap: WorldSnapshot = emptySnap;
  let currSnap: WorldSnapshot = emptySnap;
  let accumulator = 0;
  let frameCount = 0;
  // 스토리 시스템(Phase E): 이번 런에 에코 안정화 로어 토스트를 이미 띄웠는가(런당 1회).
  // echoStabilizedOf 는 안정화 후 런 내내 true 라, 전이 관측을 이 플래그로 1회로 고정한다.
  let echoToastShown = false;

  // --- 침공(비동기 PvP) 런 상태 ---
  // invasionTarget !== null 이면 현재 런은 침공 런이다 → endRun 이 PvE 정산 대신 서버
  // 제출로 분기한다. pendingInvasionResult 는 다음에 관제탑을 열 때 표시할 결과 배너.
  let invasionTarget: InvasionTarget | null = null;
  // 현재 침공 런의 권위 스냅샷 id(begin_invasion 성공 시). 제출 시 invasions.snapshot_id 로
  // 동봉해 EF 가 T0 고정 권위로 대조하게 한다. null 이면 현행 라이브 경로(하위호환).
  let invasionSnapshotId: string | null = null;
  // DEV 하네스 침공 런(ADR-0008 오염 격리). 대상 기지가 없는 개발용 무대라 정산도 서버
  // 제출도 하지 않는다 — endRun 이 이 플래그를 보고 두 경로를 모두 건너뛴다.
  let harnessInvasionRun = false;
  let pendingInvasionResult: InvasionResultView | null = null;
  // 방금 상대한 방어의 장착 코어 모듈(T0 스냅샷 권위). 결과 배너와 함께 관제탑에서 정찰
  // 공개된다(스펙 R9) — 등급·잔여 횟수·모듈 어픽스까지 드러나 복수전·재침공의 역퍼즐이 된다.
  let pendingRevealModules: readonly ModuleInstance[] = [];

  // --- 리플레이 관전(F3) 상태 ---
  // spectateReplay !== null 이면 현재 화면은 관전 재생이다 → ticker 가 리플레이 입력을
  // 주입하고, 정산/레벨업 오버레이/제출 경로를 모두 건너뛴다(월드는 markTainted 됨).
  let spectateReplay: Replay | null = null;
  let spectateCursor = 0;
  let spectatePlaying = false;
  let spectateSpeed: SpectateSpeed = 1;
  let spectateName = '';

  // --- DEV 하네스 훅 상태(프로덕션에서는 harness가 항상 null → 분기 사문화·제거) ---
  let harness: Harness | null = null;
  /** 실시간 배속(치트 패널 setSpeed). 기본 1. */
  let harnessSpeed = 1;
  /** 하네스 일시정지(ticker 스텝 동결). */
  let harnessPaused = false;
  /** 스냅샷/이벤트용 현재 스크린 이름. */
  let currentScreenName = 'title';

  /** 스크린 전환 시 하네스에 통지(스냅샷 screen + screenChange 이벤트). */
  function setScreen(name: string): void {
    currentScreenName = name;
    harness?.observeScreen(name);
  }

  /** Seed for the next run: pinned by ?seed, else fresh random (UI layer). */
  function nextSeed(): number {
    const p = params.get('seed');
    if (p !== null) return Number(p) >>> 0;
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /**
   * 다음 런에 쓸 시드. 성계 지도를 열 때 한 번 뽑고, **런이 실제로 시작될 때까지 유지**한다.
   * 매번 새로 뽑으면 화면을 잠깐 나갔다 오는 것만으로 변칙 제안이 다시 굴러 "새로고침 뽑기"가
   * 된다(사용자 지적). 런이 시작되면 소진해서 다음 출격은 새 시드를 받는다.
   */
  let pendingRunSeed: number | null = null;

  /** Meta status line for the star map / no gameplay numbers. */
  function metaLine(): string {
    const ship = activeShip(profile);
    return t('meta.line', {
      c: profile.credits,
      m: profile.minerals,
      lv: ship.level,
      sp: profile.skillPoints,
    });
  }

  /**
   * 현재 메뉴 화면을 다시 그린다(M5 C3 언어 전환용). 런/정산/관전 중에는 안전하게 무시한다
   * — 사운드/사이드이펙트 재실행 없이 순수 메뉴 UI 만 새 로케일로 재구성한다. controlTower/
   * 관제탑 등 아직 미로케일화된 화면도 안전하게 재오픈된다(문자열만 그대로).
   */
  function rerenderCurrentScreen(): void {
    if (world !== null) return; // 런/관전 중에는 재렌더하지 않는다(HUD 는 다음 프레임 반영).
    switch (currentScreenName) {
      case 'title':
        openTitle();
        break;
      case 'base':
        openBaseMap();
        break;
      case 'starMap':
        openStarMap();
        break;
      case 'controlTower':
        openControlTower();
        break;
      case 'archive':
        openArchive();
        break;
      // inventory/research/refinery/defense 는 각 오버레이가 자체 콜백으로 기지 복귀하므로
      // 언어 전환 즉시 반영은 다음 진입 때 이뤄진다(안전한 기본 동작).
      default:
        break;
    }
  }

  /** Clear the live run + all menu overlays (called before every screen swap). */
  function clearToMenu(): void {
    world = null;
    recorder = null;
    prevSnap = emptySnap;
    currSnap = emptySnap;
    accumulator = 0;
    tutorialOverlay.hide();
    resultOverlay.hide();
    baseMap.hide();
    // 캔버스 화면(정산·성계 지도·격납고·연구소·정제소)은 DOM 오버레이와 달리 다음 화면이
    // 자동으로 덮지 않는다 — 같은 stage 위에 계속 그려지므로 화면 전환마다 명시적으로 숨긴다.
    planetSelect.hide();
    inventory.hide();
    researchLab.hide();
    refinery.hide();
    modulesScreen.hide();
    defenseCommand.hide();
    defensePreview.stop();
    controlTower.hide();
    recordsArchive.hide();
    introSlides.hide();
    spectateOverlay.hide();
    stickerPicker.hide();
    spectateReplay = null; // 관전 종료(화면 전환 시 항상 해제)
    titleScreen.hide();
    // 레벨업 오버레이는 런 종료(정산) 경로에서만 숨겨 왔다 — 런을 정산 없이 벗어나면
    // (하네스 goto 등) 메뉴 화면 위에 남는다. 런 전용 UI 이므로 화면 전환에서도 숨긴다.
    if (powerupOverlay.visible) powerupOverlay.hide();
    shownLevel = 0;
  }

  /** Title screen — first launch forces the tutorial; afterwards it enters base. */
  function openTitle(): void {
    clearToMenu();
    setScreen('title');
    titleScreen.show({
      firstRun: !profile.tutorialDone,
      onStart: () => {
        // The start click is the FTUE input (the 60s / 4min clock starts here).
        ftue.markInput();
        if (!profile.tutorialDone) startTutorial();
        else openBaseMap();
      },
    });
  }

  /**
   * 부팅 진입 — 첫 실행이면 세계관 인트로를 1회 보여준 뒤 타이틀로, 이미 봤으면 곧장 타이틀.
   * `introSeen` 은 튜토리얼과 별도 축이라 튜토리얼을 스킵한 유저도 인트로는 1회 본다. 인트로는
   * 언제든 스킵 가능하고 기록 보관소에서 다시 볼 수 있다(introSlides.finish → onDone).
   * `saveProfile` 은 로컬 저장이면 충분하다(introSeen 은 서버 권위 필드가 아니다).
   */
  function openIntroOrTitle(): void {
    if (!profile.introSeen) {
      introSlides.show({
        onDone: () => {
          profile.introSeen = true;
          saveProfile(profile);
          openTitle();
        },
      });
      return;
    }
    openTitle();
  }

  /** Base map hub — the meta home. Buildings gate by unlock (plan D1/E2). */
  function openBaseMap(): void {
    clearToMenu();
    setScreen('base');
    baseMap.show(profile, {
      onHangar: () => {
        baseMap.hide();
        inventory.show(profile, () => openBaseMap());
      },
      onResearch: () => {
        baseMap.hide();
        researchLab.show(profile, () => openBaseMap());
      },
      onRefinery: () => {
        baseMap.hide();
        refinery.show(profile, () => openBaseMap());
      },
      onDefense: () => {
        baseMap.hide();
        setScreen('defense');
        openDefenseCommand();
      },
      onControl: () => {
        baseMap.hide();
        openControlTower();
      },
      onArchive: () => {
        baseMap.hide();
        openArchive();
      },
      onStarMap: () => openStarMap(),
    });
  }

  /** 기록 보관소(서사 열람 시설) — 사연 도감 · 기록 파편 도감 · 프롤로그 다시보기. */
  function openArchive(): void {
    clearToMenu();
    setScreen('archive');
    recordsArchive.show(profile, {
      onBack: () => openBaseMap(),
      onReplayIntro: () => {
        // 인트로는 보관소 위 오버레이로 띄우고, 끝나면 보관소로 복귀한다(첫 실행 경로와 별개).
        introSlides.show({ onDone: () => openArchive() });
      },
    });
  }

  /**
   * 관제탑(침공 사령) 화면. 타깃·순위표는 net 계층이 비동기 로드한다(미설정이면 비활성
   * 안내). `pendingInvasionResult` 가 있으면 결과 배너로 소비한다(침공 런 종료 직후).
   */
  function openControlTower(opts: { verifying?: boolean } = {}): void {
    clearToMenu();
    setScreen('controlTower');
    const showOpts: ControlTowerShowOpts = {};
    if (pendingInvasionResult !== null) {
      showOpts.result = pendingInvasionResult;
      pendingInvasionResult = null;
      // 상대 코어 모듈 옵션 정찰 공개(스펙 R9). 입력은 방금 끝난 침공의 T0 권위 스냅샷
      // (begin_invasion 의 authority.modules)이라 라이브 재조회가 필요 없고, 방어자가 그
      // 사이 모듈을 바꿔도 "내가 상대한 방어"가 그대로 보인다(ADR-0012 스냅샷 고정).
      if (pendingRevealModules.length > 0) showOpts.revealModules = pendingRevealModules;
      pendingRevealModules = [];
    }
    if (opts.verifying === true) showOpts.verifying = true;
    controlTower.show(
      profile,
      {
        onInvade: (target, layout, pilotGuardianId) =>
          void startInvasionRun(target, layout, pilotGuardianId),
        onSpectate: (invasionId, attackerName) => void startSpectate(invasionId, attackerName),
        onSticker: (invasionId, attackerName) => promptSticker(invasionId, t('sticker.prompt.defend'), attackerName),
        onBack: () => openBaseMap(),
      },
      showOpts,
    );
  }

  /**
   * 도발 스티커 선택 UI 를 띄우고, 선택 시 서버에 설정한 뒤 관제탑을 다시 연다(F2).
   * 스티커는 재미 요소라 실패해도 게임 진행 무영향(setInvasionSticker 은 절대 throw 안 함).
   */
  function promptSticker(invasionId: string, title: string, otherName: string): void {
    stickerPicker.show(
      {
        onPick: (index) => {
          void setInvasionSticker(invasionId, index);
          openControlTower();
        },
        onSkip: () => openControlTower(),
      },
      { title, ...(otherName.length > 0 ? { subtitle: t('sticker.subtitle', { name: otherName }) } : {}) },
    );
  }

  /**
   * 리플레이 관전(F3): 침공 리플레이를 로드해 렌더와 함께 실시간 재생한다. 월드는 진입 즉시
   * markTainted 되어 정산·제출 대상에서 빠진다(렌더 전용). 로드 실패/손상이면 관제탑 유지.
   */
  async function startSpectate(invasionId: string, attackerName: string): Promise<void> {
    const replay = await fetchInvasionReplay(invasionId);
    if (replay === null || !isPlayableReplay(replay)) {
      // 로드 불가(미설정/오프라인/부재/손상) — 관제탑을 다시 열어 안내 상태로 둔다.
      openControlTower();
      return;
    }
    beginSpectate(replay, attackerName);
  }

  /** 관전 월드를 세팅하고 컨트롤 오버레이를 띄운다(재생 상태 초기화). */
  function beginSpectate(replay: Replay, attackerName: string): void {
    clearToMenu();
    setScreen('spectate');
    spectateReplay = replay;
    spectateName = attackerName;
    spectateCursor = 0;
    spectatePlaying = true;
    spectateSpeed = 1;
    const seed = replay.seed >>> 0;
    currentSeed = seed;
    // 이전 런의 스프라이트 캐시를 비운다(B-1). 렌더러는 엔티티 id 로 스프라이트를 캐시하고
    // 텍스처를 생성 시점에 한 번만 묶으므로, 비우지 않으면 관전 월드의 플레이어가 직전 런의
    // 기체 그림으로 뜬다. 정본 규약: `createWorld` 앞에 항상 `entityRenderer.reset()`.
    entityRenderer.reset();
    world = createWorld(seed, replay.config ?? DEFAULT_CONFIG);
    markTainted(world); // 렌더 전용 — 정산/제출 오염 차단(ADR-0008 패턴)
    recorder = null;
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    // 관전 아레나 배경(침공 아레나와 동일 규칙 — 기본 배경, autotile 없음).
    const planet = world.config.planet ?? 0;
    background.texture = planetBackground(planet);
    autotile.configure(null, seed);
    background.visible = true;
    spectateOverlay.show(
      {
        onTogglePlay: () => toggleSpectatePlay(),
        onCycleSpeed: () => {
          spectateSpeed = nextSpectateSpeed(spectateSpeed);
        },
        onExit: () => {
          spectateReplay = null;
          spectateOverlay.hide();
          openControlTower();
        },
      },
      { total: replay.inputs.length, targetName: attackerName },
    );
  }

  /** 재생/일시정지 토글. 재생이 끝난 상태(cursor 소진)면 처음부터 다시 재생한다. */
  function toggleSpectatePlay(): void {
    const replay = spectateReplay;
    if (replay === null) return;
    if (spectateCursor >= replay.inputs.length) {
      // 끝났으면 재시작(월드 재생성 — 결정론이라 동일 재현).
      beginSpectate(replay, spectateName);
      return;
    }
    spectatePlaying = !spectatePlaying;
  }

  /**
   * 레이어별 배경 텍스처 인덱스(L1 대기권 · L2 회랑 · L3 코어방).
   *
   * **L10 통합 지점**: 정식 배경 3종 + 전환 크로스페이드는 L10-render 가
   * `src/render/invasionBackdrop.ts` 로 제공한다. 그 모듈이 붙기 전까지는 기존 행성 배경을
   * 레이어마다 갈라 써서 전환이 눈에 보이게 한다(연출 없는 폴백 — 무결함 동작).
   */
  const INVASION_BACKDROP_PLANET: readonly number[] = [2, 1, 3];
  /** 마지막으로 배경에 반영한 침공 페이즈(-1 = 침공 아님). */
  let shownInvasionPhase = -1;

  /** 침공 레이어 배경 적용(렌더 전용 — sim 무영향). */
  function applyInvasionBackdrop(phase: number): void {
    shownInvasionPhase = phase;
    background.texture = planetBackground(INVASION_BACKDROP_PLANET[phase] ?? 0);
  }

  /**
   * 예비역 소집(ADR-0024) pilot opt 조립. `pilotGuardianId` 가 유효한 소집 대상(존재 + build 有)을
   * 가리키면 그 잠긴 실물 빌드를 `buildRunConfig` pilot 스냅샷으로 변환하고, 아니면 null(활성 기체
   * 출격 — 기존 거동 불변). `equipped` 는 `EQUIP_SLOTS` 순서로 모은다(runConfig 의 `equippedItems`
   * 와 동일한 순서 계약 — 어픽스 합산은 순서 무관이지만 무기/보조 선택은 순서 의존).
   *
   * ⚠️ `profile.activeShipIndex` 를 **건드리지 않는다** — 소집은 데이터 주입만 한다(활성 인덱스를
   * 바꾸면 정산 XP 가 엉뚱한 기체로 귀속된다, 스펙 Task #5).
   */
  function buildCallupPilot(
    pilotGuardianId: string | null | undefined,
  ): NonNullable<RunConfigOpts['pilot']> | null {
    if (typeof pilotGuardianId !== 'string' || pilotGuardianId.length === 0) return null;
    const guardian = profile.guardians.find((g) => g.id === pilotGuardianId);
    const build = guardian?.build;
    if (guardian === undefined || build === undefined) return null;
    const equipped: Item[] = [];
    for (const slot of EQUIP_SLOTS) {
      const it = build.equipped[slot];
      if (it !== undefined) equipped.push(it);
    }
    return {
      equipped,
      skillInvest: build.skillInvest,
      typeId: build.typeId,
      performanceCP: guardian.performanceCP,
    };
  }

  /**
   * 침공 런 시작. 대상의 방어 배치(서버 raw)를 3레이어 정규화해 침공 config 로 넣어
   * 결정론 런을 돌린다(갈림길③A). 승리=코어 파괴, 패배=시간초과/격추. 런 종료 시
   * endRun 이 invasionTarget 을 보고 서버 제출로 분기한다.
   *
   * `pilotGuardianId`(ADR-0024): 관제탑 출격 기체 선택 결과. null/undefined = 활성 기체,
   * 문자열 = 그 수호기 id 로 예비역 소집(활성 기체 대신 잠긴 빌드로 출격).
   */
  async function startInvasionRun(
    target: InvasionTarget,
    layout: unknown,
    pilotGuardianId?: string | null,
  ): Promise<void> {
    // 관제탑 경유 시작 — 켜져 있을 수 있는 메뉴를 먼저 내린다(harness startRun 참조).
    planetSelect.hide();
    inventory.hide();
    researchLab.hide();
    refinery.hide();
    clearToMenu();
    tutorialActive = false;
    shownLevel = 0;

    // (M5 레이스 B 폐쇄) 침공 개시 권위 스냅샷 고정: 대상 defenseId 로 begin_invasion 을
    // 호출해 T0 고정 layout(수호 권위 주입 완료)·정비도를 받는다. 성공하면 그 고정본으로
    // 런을 돌리고 제출 시 snapshot_id 를 동봉한다 → EF 가 라이브 재조회 없이 대조(T0↔T1
    // 사이 dismiss/retire/풍화 무영향). 실패(자격 미달·구버전 서버·오프라인)면 매치메이킹
    // serve layout(인자 layout)으로 폴백한다(하위호환 — 회귀 0). 매치메이킹 serve layout 도
    // 이미 라이브 수호 권위가 주입돼 있어(get_invasion_targets), 스냅샷 layout 과 정합한다.
    // 배치는 서버가 주는 raw 를 그대로 받아 공유 정규화(L0)를 한 번만 통과시킨다.
    // normalizeInvasionLayers 는 total function 이라 "정규화 실패" 상태가 없다 — 손상·구형식
    // 배치는 빈 배치로 접히고, 빈 슬롯은 스폰 단계에서 기본 수비대가 충원한다.
    let runLayoutRaw: unknown = layout;
    let runMaintenanceDb: number = target.maintenance;
    // 방어자 장착 코어 모듈 효력(M7b). begin_invasion 스냅샷이 실어 준 서버 권위
    // {instances,matchup}. 미장착·라이브 폴백·구버전 서버면 null → invasion3.modules 미포함
    // (모듈 미장착 = 거동·해시 무회귀).
    let runModules: CoreModuleConfig | null = null;
    invasionSnapshotId = null;
    // 이전 침공의 공개분이 남아 다음 결과 화면에 새지 않게 매 런 시작에 비운다.
    pendingRevealModules = [];
    if (target.defenseId !== null) {
      const snapshot = await beginInvasion(target.defenseId);
      if (snapshot !== null) {
        // 게이트웨이가 이미 3레이어 정규형으로 접어 둔 `layers` 가 정본이다(구 `layout` 은
        // @deprecated raw jsonb). normalizeInvasionLayers 는 멱등이라 아래에서 한 번 더
        // 통과해도 값이 변하지 않는다 — 폴백 경로(매치메이킹 serve layout, raw)와 같은
        // 코드로 접히게 두어 두 경로가 갈릴 여지를 없앤다.
        runLayoutRaw = snapshot.layers;
        runMaintenanceDb = snapshot.maintenance;
        invasionSnapshotId = snapshot.snapshotId;
        runModules = snapshot.modules ?? null;
        // 결과 화면의 정찰 공개용으로 남겨 둔다(런이 끝나야 보여 준다 — 침공 전에 알면
        // 카운터 모듈의 의미가 사라진다).
        pendingRevealModules = runModules !== null ? runModules.modules : [];
      }
    }

    const seed = nextSeed();
    // 방어 정비도(풍화, ADR-0006)를 sim centi-percent 로 변환해 config 에 싣는다.
    // 공식 Math.round(db*100)은 서버 EF 재실행과 동일해야 한다(어긋나면 해시 발산 오거부).
    const maintenance = maintenanceToCenti(runMaintenanceDb);
    // 코어 모듈 효력(M7b · ADR-0018). 서버 권위 스냅샷이 준 {instances,matchup} 을 그대로
    // 싣는다 — EF 가 같은 고정본으로 재실행하므로 hashStream 이 일치한다. 미장착이면 필드
    // 자체를 두지 않는다(조건부 접기 → 거동·해시 바이트 불변).
    const invasion3: Invasion3Config = {
      layers: normalizeInvasionLayers(runLayoutRaw),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      ...(maintenance !== undefined ? { maintenance } : {}),
      ...(runModules !== null ? { modules: runModules } : {}),
    };
    // 예비역 소집(ADR-0024): 호출부가 고른 수호기 id 가 있으면 그 잠긴 실물 빌드로 출격한다.
    // id 가 null/undefined 이거나(활성 기체 출격) 조회 실패·build 부재(구 수호기)면 pilot 은
    // undefined 로 두어 buildRunConfig 가 기존 활성 기체 경로를 **바이트 그대로** 탄다. 장비는
    // `EQUIP_SLOTS` 순서 배열로 모은다(runConfig.equippedItems 와 동일한 순서 계약).
    const pilot = buildCallupPilot(pilotGuardianId);
    // 런 조립은 단일 정본(`buildRunConfig`)만 쓴다 — 여기서 config 를 손보지 마라(설계서 §10-2).
    // 소집은 4번째 조립 사이트를 만들지 않고 **기존 호출의 opts 에만** pilot 을 얹는다(§10-2 grep 게이트).
    const config = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      invasion3,
      ...(pilot !== null ? { pilot } : {}),
    });
    // 기체 스프라이트 교체(렌더 전용) — `createWorld` 앞. PvE `startRun` 과 동일 규약. 소집이면
    // config.shipType 이 이미 pilot.typeId 라(buildRunConfig 가 스탬프) 스프라이트가 자동으로 따라간다.
    applyShipSprite(textures, config.shipType ?? 0);
    // 레이어별 배경(L1 대기권 → L2 회랑 → L3 코어방). 전환은 렌더 루프가 페이즈를 보고 건다.
    applyInvasionBackdrop(PHASE_L1);
    autotile.configure(null, seed);
    background.visible = true;
    currentSeed = seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞. 렌더러가 엔티티 id 로 스프라이트를 캐시하고
    // 텍스처를 생성 시점에 묶으므로, 비우지 않으면 바로 위 `applyShipSprite` 가 갈아끼운 기체가
    // 화면에 반영되지 않고 직전 런의 그림이 남는다.
    entityRenderer.reset();
    world = createWorld(seed, config);
    recorder = new ReplayRecorder(seed, world.config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = target;
    harnessInvasionRun = false; // 정식 침공: 정산·제출 경로를 탄다
    setScreen('run');
  }

  /**
   * DEV 하네스 침공 런(M7a L8). 대상 기지 없이 **배치만** 넘겨 3레이어 런을 세운다.
   *
   * ADR-0008 오염 격리: `invasionTarget` 을 세우지 않고 `harnessInvasionRun` 만 세운다 →
   * endRun 이 PvE 정산도 서버 제출도 하지 않는다. 리플레이 recorder 는 정식 런과 똑같이
   * 붙여서(같은 record 경로) 재현·해시 검증이 가능하게 한다.
   */
  function startHarnessInvasionRun(opts: {
    seed: number;
    layers: unknown;
    maintenance: number;
    timeLimitTicks: number;
  }): void {
    // 켜져 있을 수 있는 메뉴 화면을 먼저 내린다. 하네스 경유 진입(host.startInvasion)은 이미
    // clearToMenu 를 부르고 오지만(멱등), **방어 사령부의 [시험 침공] 버튼**은 자기 화면만
    // 감추고 이 함수로 바로 들어온다 — 그 경로에서는 배치 프리뷰(defensePreview)가 계속 켜진
    // 채로 런이 시작된다. 정식 침공(startInvasionRun)과 같은 규약으로 맞춘다.
    clearToMenu();
    tutorialActive = false;
    shownLevel = 0;
    const invasion3: Invasion3Config = {
      layers: normalizeInvasionLayers(opts.layers),
      timeLimitTicks: opts.timeLimitTicks,
      maintenance: opts.maintenance,
    };
    // 정식 침공과 **같은 조립**을 탄다(단일 정본). 하네스 런만 다른 config 를 갖게 되면
    // "하네스에서는 되는데 실제 런에서는 안 되는" 결함이 생긴다.
    const config = buildRunConfig(profile, { planet: 0, stage: 1, invasion3 });
    applyShipSprite(textures, config.shipType ?? 0);
    applyInvasionBackdrop(PHASE_L1);
    autotile.configure(null, opts.seed);
    background.visible = true;
    currentSeed = opts.seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞(정식 침공·PvE 와 같은 규약).
    entityRenderer.reset();
    world = createWorld(opts.seed, config);
    recorder = new ReplayRecorder(opts.seed, world.config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = null;
    harnessInvasionRun = true;
    setScreen('run');
  }

  /**
   * 침공 런 종료 처리: 리플레이+클라이언트 결과(해시 스트림)를 서버에 제출하고 판정을
   * 결과 배너로 표시한다. 서버 응답이 최종(서버 권위) — 클라 결과는 잠정이다. 오염 런/
   * 미설정/오프라인이면 제출하지 않고 잠정 결과만 안내한다.
   */
  async function finishInvasionRun(w: WorldState): Promise<void> {
    if (settled) return;
    settled = true;
    const target = invasionTarget;
    const rec = recorder;
    const snapshotId = invasionSnapshotId;
    invasionTarget = null;
    invasionSnapshotId = null;
    tutorialOverlay.hide();
    if (powerupOverlay.visible) powerupOverlay.hide();
    shownLevel = 0;
    if (target === null) {
      openBaseMap();
      return;
    }
    // 오염 런(ADR-0008) 또는 리플레이 부재 → 제출하지 않는다(잠정 결과만).
    if (w.tainted || rec === null) {
      pendingInvasionResult = {
        attackerWon: w.victory,
        submitted: false,
        targetName: target.displayName,
      };
      openControlTower();
      return;
    }
    const replay = rec.toReplay();
    const clientResult = buildClientResult(replay);
    // 먼저 "서버 검증 중" 상태로 관제탑을 연다(사용자 대기 안내).
    openControlTower({ verifying: true });
    const verdict = await submitInvasion({ target, replay, clientResult, snapshotId });
    if (verdict === null) {
      // 미설정/오프라인 — 잠정 결과만.
      pendingInvasionResult = {
        attackerWon: clientResult.attackerWon,
        submitted: false,
        targetName: target.displayName,
      };
    } else {
      pendingInvasionResult = {
        attackerWon: verdict.attackerWon,
        status: verdict.status,
        submitted: true,
        ladder: verdict.ladder,
        lootCount: verdict.loot.length,
        targetName: target.displayName,
        ...(verdict.revenge !== undefined ? { revenge: verdict.revenge } : {}),
        ...(verdict.bonusMinerals !== undefined ? { bonusMinerals: verdict.bonusMinerals } : {}),
      };
    }
    // 침공 성공(서버 확정)이면 도발 스티커 선택 UI 를 먼저 띄운다(F2). 선택/건너뛰기 후
    // 관제탑을 결과 배너와 함께 연다. invasionId 가 있어야 서버 설정이 가능하다.
    const invId = verdict?.invasionId;
    if (
      verdict !== null &&
      verdict.status === 'verified' &&
      verdict.attackerWon === true &&
      invId !== undefined &&
      invId.length > 0
    ) {
      promptSticker(invId, t('sticker.prompt.invade'), target.displayName);
      return;
    }
    // 관제탑이 아직 이 화면이면 결과 배너로 다시 그린다(사이에 사용자가 나갔으면 스킵).
    if (currentScreenName === 'controlTower') openControlTower();
  }

  /** Show the star map for the next run (world cleared while it is up). */
  function openStarMap(): void {
    clearToMenu();
    setScreen('starMap');
    // 이번 출격의 시드(pendingRunSeed 참조 — 화면을 오가도 같은 제안이 유지된다).
    pendingRunSeed ??= nextSeed();
    const seed = pendingRunSeed;
    // Pre-compute the anomaly the seed offers (same fork the sim uses) so the
    // player can accept/reject it before the run (OQ-M2-3).
    const offer = rollAnomaly(new SeededRng(seed).fork('anomaly'), false);
    planetSelect.show({
      anomalyOffered: offer.kind,
      meta: metaLine(),
      // 행성별 개방 상한 산정(ADR-0022): 그 행성 최고 클리어 단계 → max(10, +5).
      bestStageCleared: (planet) => profile.planetProgress[planet]?.bestStageCleared ?? 0,
      onLaunch: (sel) => startRun(seed, sel),
      onInventory: () => {
        planetSelect.hide();
        inventory.show(profile, () => openStarMap());
      },
      onBack: () => openBaseMap(),
    });
  }

  /** Build the tutorial run: homeworld orbit, fixed seed, current loadout. */
  function startTutorial(): void {
    startRun(TUTORIAL_SEED, {
      planet: TUTORIAL_PLANET,
      stage: TUTORIAL_STAGE,
      anomalyAccepted: false,
      maxSegments: TUTORIAL_MAX_SEGMENTS,
    });
    tutorialActive = true; // startRun cleared it; mark this run as the tutorial.
    ftue.markCombat();
    tutorialOverlay.show();
  }

  /** Assemble the run config from the selection + active loadout, then start. */
  function startRun(seed: number, sel: LaunchSelection): void {
    pendingRunSeed = null; // 이번 시드 소진 — 다음 성계 지도는 새 변칙 제안을 굴린다
    tutorialActive = false; // normal run unless startTutorial re-flags it
    invasionTarget = null; // PvE 런: 침공 컨텍스트 해제(endRun 이 정산 경로로 분기)
    harnessInvasionRun = false;
    shownInvasionPhase = -1; // 침공 배경 추적 해제(PvE 는 행성 배경)
    shownLevel = 0; // 새 런: 레벨업 오버레이 표시 상태 초기화
    echoToastShown = false; // 새 런: 에코 안정화 로어 토스트 재무장
    // 런 조립 단일 정본. 투자 벡터·기체 타입·계보 보너스는 전부 이 안에서 접힌다 —
    // 튜토리얼 단축판(maxSegments)도 여기로 넘겨 config 후처리를 남기지 않는다.
    const config = buildRunConfig(profile, {
      planet: sel.planet,
      stage: sel.stage,
      anomalyAccepted: sel.anomalyAccepted,
      ...(sel.maxSegments !== undefined ? { maxSegments: sel.maxSegments } : {}),
    });
    // 활성 기체의 인게임 스프라이트로 플레이어 슬롯을 교체(렌더 전용, sim 무영향).
    // `createWorld` **앞**이어야 이번 런의 플레이어 스프라이트가 올바른 기체로 생성된다.
    applyShipSprite(textures, config.shipType ?? 0);
    // Swap the arena backdrop to the launched planet's theme (render-only). The
    // Wang autotile floor takes over when the planet has a tileset; otherwise the
    // flat TilingSprite stays visible as the fallback.
    background.texture = planetBackground(sel.planet);
    const tiles = wangTiles[sel.planet] ?? null;
    autotile.configure(tiles, seed);
    background.visible = !autotile.active;
    currentSeed = seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞. 위 `applyShipSprite` 가 `textures.player` 를
    // 갈아끼워도, 이전 런의 플레이어 스프라이트(같은 엔티티 id)가 캐시에 남아 있으면 그 런 내내
    // 옛 기체 그림이 그대로 뜬다(세션 중 기체 교체 5종 전부 재현된 결함).
    entityRenderer.reset();
    world = createWorld(seed, config);
    recorder = new ReplayRecorder(seed, world.config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    setScreen('run');
  }

  /**
   * Advance the live world by exactly one tick with `input`, through the record +
   * snapshot path the real ticker uses. Factored out so the DEV 하네스(fast-forward
   * / single-step)가 실제 루프와 비트 동일하게 스텝하도록(리플레이 재현 보존) 공유한다.
   * 하네스가 없으면(프로덕션) 호출부는 ticker 하나뿐이라 사문화되지 않는다.
   */
  function stepOnce(input: InputFrame): void {
    const w = world;
    if (w === null) return;
    recorder?.record(input);
    stepWorld(w, input);
    prevSnap = currSnap;
    currSnap = snapshotWorld(w);
    harness?.observe(w);
  }

  /** Settle a finished run into the profile once, then show the result screen. */
  function endRun(w: WorldState): void {
    // 침공 런은 PvE 정산이 아니라 서버 제출로 분기한다(서버 권위). finishInvasionRun 이
    // settled 를 즉시 세워 프레임당 재진입을 막는다.
    if (invasionTarget !== null) {
      void finishInvasionRun(w);
      return;
    }
    if (!settled) {
      settled = true;
      // M5 C1: 승/패 연출 사운드(런당 1회). 격추 사출음(eject)은 피격 관찰에서 이미 났으므로
      // 여기서는 결과 팡파레/하강음만 낸다.
      audio.play(w.victory ? 'victory' : 'defeat');
      // 오염 런(ADR-0008): 하네스/치트 개입이 있었던 런은 정산하지 않는다 — 전리품·XP·
      // 튜토리얼 완료 플래그 모두 프로필에 반영되지 않고, 리플레이도 제출 대상에서
      // 빠진다(리플레이는 아직 어디에도 제출되지 않으므로 recorder 결과를 그냥 버린다).
      // 결과 화면은 정보 표시용으로 그대로 띄우되 settlement 블록만 생략한다.
      //
      // DEV 하네스 침공 런(M7a L8)도 같은 취급이다 — 대상 기지가 없는 개발용 무대라 전리품·
      // XP 를 계정에 넣지 않고 PvE 런 기록(recordPveRun)도 올리지 않는다. 침공 제출 경로는
      // invasionTarget 이 null 이라 애초에 타지 않는다(ADR-0008 오염 런 격리와 동일 규율).
      if (!w.tainted && !harnessInvasionRun) {
        lastOutcome = settleRun(profile, {
          victory: w.victory,
          loot: w.loot,
          xpTotal: w.xpTotal,
          resources: w.resources,
          planet: w.config.planet ?? 0,
          stage: w.config.stage ?? 1,
          // 스토리 시스템(Phase E): 에코 안정화(파편 수집) + 사연 마일스톤 관측 델타를 정산에
          // 실어 프로필에 누적한다. 헬퍼는 world.js(→echo.js) 재수출 순수 리더 — sim 무수정.
          // 침공 런은 이 블록에 도달하지 않는다(위 invasionTarget return · !harnessInvasionRun
          // 가드) — PvE 런만 조립하며, 에코도 PvE 전용(echoRuntime 미장착)이다.
          echoStabilized: echoStabilizedOf(w),
          storyMetricDeltas: runStoryMetrics(w),
        });
        // Completing the tutorial (win or lose) reveals the base and makes the run
        // skippable thereafter (OQ-M3-7). Persist the flag with the settlement.
        if (tutorialActive) profile.tutorialDone = true;
        saveProfile(profile);
        // 설계도 지급(M7b): 정산이 파생한 목록을 서버 보유량에 얹는다. 미설정·오프라인이면
        // no-op 이고 throw 하지 않는다. 오염 런·하네스 침공 런은 이 블록에 들어오지 않으므로
        // 설계도도 함께 차단된다(ADR-0008 과 같은 격리면).
        void grantBlueprintDrops(lastOutcome.blueprintsGained);
        // PvE 런 결과(정산된 메타)를 서버에 기록. 미설정이면 no-op, 실패 시 로컬
        // 대기 슬롯에 남아 재시도(오프라인 우선). 비차단 fire-and-forget.
        void recordPveRunResult(profile);
        // 개별 PvE 런 리플레이(시드·입력·해시)를 pve_runs 에 기록 → 서버 표본 재실행
        // 검증 대상 확보(계획 §4 F4). 오염 런은 이 블록에 들어오지 않으므로 제출 안전.
        // 미설정/오프라인이면 no-op. recorder 는 startRun 에서 항상 세팅되나 방어적으로 확인.
        if (recorder !== null) void recordPveRun(recorder.toReplay());
      }
    }
    tutorialOverlay.hide();
    if (powerupOverlay.visible) powerupOverlay.hide();
    shownLevel = 0; // 정산 화면 진입: 오버레이 표시 상태 초기화
    harnessInvasionRun = false; // 하네스 침공 런 종료(다음 런은 정식 경로)
    shownInvasionPhase = -1;
    setScreen('result');
    const o = lastOutcome;
    resultOverlay.show(
      {
        victory: w.victory,
        seed: currentSeed,
        xpTotal: w.xpTotal,
        kills: w.kills,
        maxCombo: w.maxCombo,
        resources: w.resources,
        level: activeShip(profile).level,
        timeSec: w.tick / 60,
        ...(o !== null
          ? {
              settlement: {
                itemsGained: o.itemsGained.length,
                levelsGained: o.levelsGained,
                skillPointsGained: o.skillPointsGained,
                creditsGained: o.creditsGained,
                overflow: o.overflow,
                // M5 C2: 획득 전투력 합계 + 등급별 장비 칩 목록(정산 완성판).
                combatPower: totalCombatPower(o.itemsGained),
                drops: o.itemsGained.map(
                  (it): ResultDrop => ({
                    rarity: it.rarity,
                    slot: it.slot,
                    ...(it.weaponType !== undefined ? { weaponType: it.weaponType } : {}),
                  }),
                ),
              },
            }
          : {}),
      },
      () => openBaseMap(),
      () => {
        resultOverlay.hide();
        inventory.show(profile, () => openBaseMap());
      },
    );
  }

  /**
   * 런 종료 판정 → 정산 → 결과 화면 전이를 **정확히 1회** 돌린다(런당).
   *
   * ticker 프레임과 DEV 하네스 훅({@link HarnessHost.settleIfRunOver})이 **공유하는 단일
   * 판정면**이다. 두 곳에 같은 판정을 적으면 갈라진다 — 이 저장소가 반복해서 당한 유형이라
   * 호출부는 이 함수만 부른다.
   *
   * 계약(하네스 훅과 동일): **sim 을 스텝하지 않는다.** 종료 판정 + 정산 + 화면 전이만
   * 한다 — `ff` 의 "정확히 N 틱" 결정론을 깨지 않기 위해서다. 정산의 오염/하네스 침공 격리
   * (ADR-0008)는 `endRun` 안의 `!w.tainted && !harnessInvasionRun` 가드가 그대로 맡는다:
   * 결과 화면으로는 넘어가되 재화·설계도·서버 제출은 차단된다.
   *
   * 관전(리플레이 재생)은 정산 경로를 타지 않으므로 여기서 먼저 걸러낸다.
   */
  function settleIfRunOver(): void {
    const w = world;
    if (w === null || spectateReplay !== null) return;
    if (!shouldEnterSettlement(w.gameOver || w.victory, settled)) return;
    endRun(w);
  }

  // 부팅 — 첫 실행이면 세계관 인트로를 먼저 1회, 그 뒤 타이틀(첫 실행은 튜토리얼 강제 → 기지 맵).
  openIntroOrTitle();

  gameApp.app.ticker.add((ticker) => {
    // 설정은 모든 화면 위에 떠 있는 크롬 UI 다 — 다른 캔버스 화면이 show() 에서 자기를 맨
    // 앞으로 올리므로 매 프레임 되돌린다(이미 마지막 자식이면 no-op).
    settings.raise();

    let frame = ticker.deltaMS / 1000;
    if (frame > 0.25) frame = 0.25; // clamp to avoid spiral-of-death after stalls

    const w = world;
    const runOver = w !== null && (w.gameOver || w.victory);
    const spectating = spectateReplay !== null;

    // 리플레이 관전(F3): 리플레이 입력을 고정 timestep 으로 주입해 실시간 재생한다. 정산·
    // 레벨업 오버레이·제출 경로는 모두 건너뛴다(월드는 markTainted). stepOnce 재사용으로
    // 재생도 원본 런과 비트 동일(결정론). 배속은 accumulator 유입만 스케일.
    if (spectating && w !== null && spectateReplay !== null) {
      const total = spectateReplay.inputs.length;
      if (spectatePlaying && spectateCursor < total) {
        accumulator += frame * spectateSpeed;
        while (accumulator >= DT && spectateCursor < total) {
          const input = spectateReplay.inputs[spectateCursor];
          spectateCursor++;
          if (input !== undefined) stepOnce(input);
          accumulator -= DT;
        }
        if (spectateCursor >= total) spectatePlaying = false; // 재생 종료
      } else {
        accumulator = 0;
      }
      spectateOverlay.update({
        tick: spectateCursor,
        playing: spectatePlaying,
        speed: spectateSpeed,
        ended: spectateCursor >= total,
      });
    } else if (w !== null && !runOver && !harnessPaused) {
      // 유니크 세리머니 슬로모: 게임 루프 dt에 배율만 곱한다(hit-stop). 입력 로그는 매
      // 틱 그대로 기록되므로 리플레이/해시는 불변(렌더 페이싱만 늘어짐).
      const timeScale = ceremony.update(frame);
      accumulator += frame * timeScale * harnessSpeed;
      while (accumulator >= DT) {
        const player = w.entities[0];
        const input = controller.sample(player?.x ?? 0, player?.y ?? 0);
        stepOnce(input);
        accumulator -= DT;
        // 새 유니크 loot가 나타나면 세리머니 발동(렌더 전용, 같은 loot는 한 번만).
        ceremony.notice(currSnap);
      }
    } else if (w === null || runOver) {
      accumulator = 0; // menus / settled run: sim is inert (일시정지 런은 유지)
    }

    // Tutorial: advance the scripted hint + instrument the first drop (FTUE, AC8).
    if (!spectating && tutorialActive && w !== null) {
      const hasDrop = w.loot.length > 0;
      if (hasDrop) ftue.markFirstDrop();
      tutorialOverlay.update(w.tick, hasDrop);
    }

    // 스토리 시스템(Phase E, ADR-0023): 에코 신호 안정화 전이를 렌더에서 관측해 로어 토스트 1줄을
    // 띄운다(런당 1회 — echoToastShown 게이트). 안정화(파편 획득)는 정산에서 프로필에 반영되지만,
    // 이 순간 로어를 보여 주는 게 서사 리빌이다. 관전 리플레이(spectating)는 남의 런이라 제외한다.
    // 파편 슬롯이 남았을 때만 shard.gained 를 함께 얹는다(전부 수집이면 정산이 파편을 안 담는다).
    if (!spectating && w !== null && !echoToastShown && echoStabilizedOf(w)) {
      echoToastShown = true;
      const lines = [t('echo.stabilized.toast')];
      if (profile.collectedShards.length < RECORD_SHARDS.length) lines.push(t('shard.gained'));
      hud.showLore(lines);
    }

    // 침공 레이어 전환 → 배경 교체(렌더 전용, sim 무영향). 페이즈는 sim 권위라 여기서는
    // 관찰만 한다 — 전환 크로스페이드는 L10 의 invasionBackdrop 이 붙으면 이 자리에서 건다.
    const inv3 = w?.invasion3;
    if (inv3 !== undefined && inv3.phase !== shownInvasionPhase) applyInvasionBackdrop(inv3.phase);

    // --- Render ---
    const alpha = accumulator / DT;
    entityRenderer.render(prevSnap, currSnap, alpha);
    // 우상단 레이더(렌더 전용): 현재 스냅샷만 읽어 보스·엘리트·드랍·기믹·해저드를 표시.
    // 블랙아웃 카드 발동 중이면 숨긴다(renderRadarGated — 렌더 게이트).
    renderRadarGated();

    // Seamless background scroll: the tiling sprite stays fixed over the viewport
    // and only its tile offset moves with the interpolated camera. Take the f64
    // modulo by the tile size BEFORE handing a small value to the renderer to
    // avoid f32 UV precision "swim" in PIXI. Render-only; the sim keeps full f64.
    const camX = prevSnap.cameraX + (currSnap.cameraX - prevSnap.cameraX) * alpha;
    const camY = prevSnap.cameraY + (currSnap.cameraY - prevSnap.cameraY) * alpha;
    if (autotile.active) {
      // 실제 보이는 design 사각형 = 화면(logical px) 네 모서리를 stage 역변환한 것.
      // DPR·비율·레터박스와 무관하게 창 전체를 덮게 하여 가장자리 빈 곳을 없앤다.
      const scr = gameApp.app.renderer.screen;
      const vTL = gameApp.stage.toLocal({ x: scr.x, y: scr.y });
      const vBR = gameApp.stage.toLocal({ x: scr.x + scr.width, y: scr.y + scr.height });
      // Wang floor scrolls by panning its layer + re-tiling on boundary crossings.
      autotile.update(camX, camY, vTL.x, vTL.y, vBR.x, vBR.y);
    } else {
      const tileW = background.texture.width;
      const tileH = background.texture.height;
      background.tilePosition.set(-camX % tileW, -camY % tileH);
    }

    // Level-up: freeze is handled in the sim. 오버레이 표시/숨김은 sim의
    // pendingLevelUp을 근거로 순수 결정한다(levelUpOverlayAction). 클릭으로 낙관적
    // 숨김을 하지 않으므로, 픽이 소비되기 전 프레임에 오버레이가 재표시되며 뒤에서
    // 게임이 진행되던 레이스가 사라진다. 픽은 SPECIAL_POWERUP_PICK 입력으로 큐잉된다.
    if (!spectating && w !== null && !resultOverlay.visible) {
      const action = levelUpOverlayAction(
        w.pendingLevelUp,
        w.level,
        powerupOverlay.visible,
        shownLevel,
      );
      if (action === 'show') {
        shownLevel = w.level;
        powerupOverlay.show([...w.powerupChoices], readBuildStatus(w), (offerIndex) => {
          controller.queuePowerupPick(offerIndex);
        });
      } else if (action === 'hide') {
        shownLevel = 0;
        powerupOverlay.hide();
      }
    }

    // Settlement screen on death or clear. `settled`로 게이트한다(런 종료당 정확히 1회
    // — shouldEnterSettlement 참조). `!resultOverlay.visible`로 게이트하면 '장비 정비'가
    // 오버레이를 숨긴 뒤 endRun이 재호출되어 결과 화면이 인벤토리 위로 다시 뜬다.
    // 판정 자체는 settleIfRunOver 한 곳에만 산다 — DEV 하네스 훅도 같은 함수를 부른다.
    settleIfRunOver();

    // --- HUD (only during a live run) ---
    const f = fps.tick(frame);
    frameCount++;
    if (w !== null) {
      const p = w.entities[0];
      let enemyN = 0;
      let bulletN = 0;
      let playerBulletN = 0;
      let bossEnt: (typeof w.entities)[number] | undefined;
      let supplyActive = false;
      for (const e of w.entities) {
        if (e.kind === 'enemy') enemyN++;
        else if (e.kind === 'enemyBullet' || e.kind === 'bullet') {
          bulletN++;
          if (e.kind === 'bullet') playerBulletN++;
        } else if (e.kind === 'boss') bossEnt = e;
        else if (e.kind === 'supply') supplyActive = true;
      }
      // M5 C1: 사운드 트리거 파생(render 관찰, sim 무수정). 프레임당 1회 — 처치·레벨업·
      // 피격·픽업·보스 등장·발사 델타를 감지해 SFX 를 낸다. 세리머니와 동일 관찰 패턴.
      soundObserver.observe({
        kills: w.kills,
        level: w.level,
        playerHp: p?.hp ?? 0,
        resources: w.resources,
        hasBoss: bossEnt !== undefined,
        bulletCount: playerBulletN,
        gameOver: w.gameOver,
        victory: w.victory,
      });
      const boss: BossHudState | undefined =
        bossEnt !== undefined
          ? {
              hp: bossEnt.hp,
              maxHp: bossEnt.maxHp,
              phase: bossEnt.phase,
              overheat: bossEnt.iframes > 0,
              transitioning: bossEnt.timer > 0,
            }
          : undefined;
      hud.update({
        hp: p?.hp ?? 0,
        maxHp: p?.maxHp ?? 0,
        xp: w.xp,
        xpNeed: xpToNext(w.level),
        level: w.level,
        timeSec: w.tick / 60,
        combo: w.combo,
        multiplier: comboMultiplier(w.combo),
        boss,
        supplyActive,
      });

      const seg = w.wave.segmentIndex + 1;
      // 처치 할당 진행(ADR-0011): 세그먼트는 시간이 아니라 처치 수로 넘어간다. 보스
      // 세그먼트는 보스 처치로 끝나므로 할당 대신 [BOSS]만 표시.
      const quotaTag = w.wave.boss
        ? '  [BOSS]'
        : `  kills ${Math.min(w.kills - w.wave.segmentBaseKills, w.wave.segmentKillGoal)}/${w.wave.segmentKillGoal}`;
      hud.set(
        `Planet Blitz — M2  ·  seed ${currentSeed}  tick ${w.tick}  seg ${seg}/6${quotaTag}\n` +
          `enemies ${enemyN}  bullets ${bulletN}/${w.bulletCap}  entities ${w.entities.length}\n` +
          `hash ${hashWorld(w).toString(16).padStart(8, '0')}  FPS ${f.toFixed(1)}`,
      );
    } else {
      hud.set('');
    }
  });

  // DEV-only inspection hook: lets tooling drive frames / read sim state when
  // the tab is throttled (background preview) and rAF is paused. Never bundled
  // into production builds (import.meta.env.DEV is statically false there).
  if (import.meta.env.DEV) {
    // 하네스 코어는 동적 import(값 참조)라 프로덕션 번들에서 완전히 제거된다. 하네스는
    // sim을 직접 스텝하지 않고 main의 루프 클로저(stepOnce/renderOnce/open* 등)를
    // HarnessHost로 주입받아 실제 게임을 구동한다(리플레이 재현 보존).
    const core = await import('./harness/core.js');

    /** DEV 하네스: 메뉴 스크린 점프(main의 open* 함수 재사용). */
    function harnessGoto(screen: HarnessScreen): void {
      switch (screen) {
        case 'title':
          openTitle();
          break;
        case 'base':
          openBaseMap();
          break;
        case 'starMap':
          openStarMap();
          break;
        case 'inventory':
          planetSelect.hide();
          clearToMenu();
          setScreen('inventory');
          inventory.show(profile, () => openBaseMap());
          break;
        case 'research':
          planetSelect.hide();
          clearToMenu();
          setScreen('research');
          researchLab.show(profile, () => openBaseMap());
          break;
        case 'refinery':
          planetSelect.hide();
          clearToMenu();
          setScreen('refinery');
          refinery.show(profile, () => openBaseMap());
          break;
        case 'defense':
          planetSelect.hide();
          clearToMenu();
          setScreen('defense');
          openDefenseCommand();
          break;
        case 'controlTower':
          planetSelect.hide();
          clearToMenu();
          openControlTower();
          break;
      }
    }

    /** DEV 하네스: 변경된 프로필 기준으로 현재 메뉴 스크린을 다시 그린다. */
    function harnessRefreshScreen(): void {
      switch (currentScreenName) {
        case 'title':
          openTitle();
          break;
        case 'starMap':
          openStarMap();
          break;
        case 'inventory':
        case 'research':
        case 'refinery':
        case 'defense':
        case 'controlTower':
          harnessGoto(currentScreenName);
          break;
        case 'base':
        default:
          // 런/정산 화면은 프로필 재주입으로 다시 그릴 필요가 없다 → base로 안전 복귀.
          if (world === null) openBaseMap();
          break;
      }
    }

    // 하네스 재화 치트를 서버에도 반영한다. 프로필을 로컬 저장한 뒤 서버로 통째로 push —
    // serializeProfile 이 크레딧·광물·장비·기체·계보 등 모든 재화를 담으므로, 한 번의 push 로
    // 하네스가 올릴 수 있는 재화 전부가 서버 권위 경로(카드 구매·정비가 읽는 profiles.save)에
    // 반영된다. DEV 전용·fire-and-forget(미설정/오프라인이면 로컬 저장만 하고 no-op).
    const saveProfileToLocalAndServer = (): void => {
      saveProfile(profile);
      void pushProfileToServer(profile);
    };

    const host: import('./harness/core.js').HarnessHost = {
      getWorld: () => world,
      getCurrentSeed: () => currentSeed,
      stepOnce: (input) => stepOnce(input),
      sampleInput: () => {
        const p = world?.entities[0];
        return controller.sample(p?.x ?? 0, p?.y ?? 0);
      },
      renderOnce: () => {
        entityRenderer.render(prevSnap, currSnap, 1);
        renderRadarGated();
        gameApp.app.renderer.render(gameApp.app.stage);
      },
      setSpeedFactor: (mult) => {
        harnessSpeed = mult;
      },
      setPaused: (paused) => {
        harnessPaused = paused;
      },
      isPaused: () => harnessPaused,
      goto: (screen) => harnessGoto(screen),
      startRun: (opts) => {
        // 게임 내부 startRun은 성도 화면에서 호출되는 전제라 메뉴 오버레이를 숨기지
        // 않는다(성도가 자기 자신을 숨기고 넘어옴). 하네스 경유 시작은 어느 스크린에서든
        // 가능하므로, 켜져 있을 수 있는 모든 메뉴를 먼저 내린다 — 안 그러면 런이 뒤에서
        // 도는데 타이틀/기지 화면이 위에 남아 "화면이 안 바뀌는" 증상이 된다.
        planetSelect.hide();
        inventory.hide();
        researchLab.hide();
        refinery.hide();
        clearToMenu();
        startRun(opts.seed, {
          planet: opts.planet,
          stage: opts.stage,
          anomalyAccepted: opts.anomaly,
          ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
        });
      },
      startInvasion: (opts) => {
        // startRun 과 같은 이유로 켜져 있을 수 있는 메뉴를 먼저 내린다(하네스 경유 진입은
        // 어느 스크린에서든 가능하다).
        planetSelect.hide();
        inventory.hide();
        researchLab.hide();
        refinery.hide();
        clearToMenu();
        startHarnessInvasionRun(opts);
      },
      nextSeed: () => nextSeed(),
      activateHarnessProfile: () => {
        core.setProfileStoreOverride(core.harnessProfileStore());
      },
      applyProfile: (p) => {
        Object.assign(profile, p);
        saveProfileToLocalAndServer();
      },
      refreshScreen: () => harnessRefreshScreen(),
      getProfileSummary: () => ({
        credits: profile.credits,
        minerals: profile.minerals,
        shipLevel: activeShip(profile).level,
      }),
      // 기체 타입 치트가 제자리 편집한다(편집 후 applyProfile 로 저장 + 서버 push).
      getProfile: () => profile,
      markTaintedIfLive: () => {
        const w = world;
        if (w !== null && !w.gameOver && !w.victory) markTainted(w);
      },
      isTainted: () => world?.tainted ?? false,
      currentScreen: () => currentScreenName,
      // ff 는 rAF 가 안 도는 환경에서도 쓰이므로 종료 판정을 명시적으로 부른다. ticker 와
      // **같은 함수**를 부른다 — 판정을 복제하면 두 경로가 갈라진다. sim 을 스텝하지 않아
      // ff 의 틱 결정론은 그대로고, 오염/하네스 침공 격리(ADR-0008)도 endRun 가드가 유지한다.
      settleIfRunOver: () => settleIfRunOver(),
    };

    harness = core.createHarness(host);

    (window as unknown as { __pb: unknown }).__pb = {
      gameApp,
      controller,
      entityRenderer,
      autotile,
      hud,
      powerupOverlay,
      resultOverlay,
      planetSelect,
      inventory,
      // 관제탑은 서버 왕복 화면이라 로그인 없이는 안내 상태만 뜬다 — 채워진 화면을
      // 검증하려면 이 참조로 뷰를 직접 띄운다(카툰나무풍 롤아웃 #6 검증 절차).
      controlTower,
      // 기록 보관소(서사 열람) + 인트로 슬라이드 — 검증 시 이 참조로 직접 show 한다.
      recordsArchive,
      introSlides,
      openArchive,
      // 코어 모듈 화면도 로그인해야 채워진다(미로그인이면 안내 상태) — 검증 시 이 참조로
      // 상태를 직접 넣고 render() 를 부른다.
      modulesScreen,
      // 방어 사령부(M7b) — 검증 시 이 참조로 탭·배치 상태를 직접 넣고 render() 를 부른다.
      defenseCommand,
      // 코어 모듈 화면 직행. 사령부를 거치지 않으므로 배치 편집 상태와 무관하다 — 사령부
      // 안에서 열 때는 suspend/resume 경로를 탄다.
      openModules: () => modulesScreen.show(profile, () => openBaseMap()),
      // 설정은 톱니 클릭으로만 열리는 크롬 UI 다 — 검증 시 이 참조로 직접 연다(#8).
      settings,
      // 하네스 API 표면(개발 도구): goto/startRun/ff/setSpeed/pause/resume/step/
      // preset/snapshot/events/cheat. 프로덕션 미포함.
      harness,
      get world() {
        return world;
      },
      startRun,
      openStarMap,
      injectInput(input: Partial<InputFrame>) {
        // NOTE: DEV-only; injected frames are NOT written to the replay log, so a
        // replay captured while tooling drove frames would not reproduce them. It
        // exists only to step the sim for inspection when rAF is throttled.
        const w = world;
        if (w === null) return;
        const merged = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0, ...input };
        stepWorld(w, merged);
        prevSnap = currSnap;
        currSnap = snapshotWorld(w);
        entityRenderer.render(prevSnap, currSnap, 1);
        renderRadarGated();
        gameApp.app.renderer.render(gameApp.app.stage);
      },
      get state() {
        return {
          tick: world?.tick ?? 0,
          frameCount,
          entities: currSnap.entities,
          kills: world?.kills ?? 0,
        };
      },
    };

    // DEV 치트 패널(개발 도구): 하네스를 구동하는 우하단 접이식 오버레이(백틱 ` 토글).
    // 동적 import라 프로덕션 번들에서 완전히 제거된다(import.meta.env.DEV 정적 false).
    const cheatPanel = await import('./harness/cheatPanel.js');
    const panel = cheatPanel.createCheatPanel({
      harness,
      getEntities: () => currSnap.entities,
      getProfile: () => profile,
      // 로컬 저장 + 서버 push(하네스 재화 치트를 서버 권위 경로에 반영 — 위 helper 주석 참조).
      saveProfile: () => saveProfileToLocalAndServer(),
      refreshScreen: () => harnessRefreshScreen(),
      activateHarnessProfile: () => {
        core.setProfileStoreOverride(core.harnessProfileStore());
      },
      // 씬 런처의 튜토리얼 버튼: 정식 튜토리얼 흐름(고정 시드 런 + 힌트 오버레이 +
      // FTUE 계측)을 그대로 태운다. 하네스 공개 API로는 오버레이·tutorialActive에
      // 닿지 않으므로 main의 startTutorial을 최소 위임으로 노출한다.
      startTutorial: () => {
        // 정식 흐름은 타이틀 '시작' 클릭이 titleScreen을 self-hide한 뒤 진입한다.
        // 하네스 경유는 그 클릭이 없으므로 동일하게 메뉴를 먼저 내린다(위 startRun 참조).
        planetSelect.hide();
        inventory.hide();
        researchLab.hide();
        refinery.hide();
        clearToMenu();
        startTutorial();
      },
    });
    // HMR로 main()이 재실행되면 이전 패널(스타일·인터벌·리스너)을 정리해 중복을
    // 막는다(리뷰 LOW). 프로덕션에서는 이 블록 전체가 DCE로 제거된다.
    import.meta.hot?.dispose(() => panel.destroy());

    // URL 딥링크(DEV): ?screen=starMap 등으로 부팅 후 해당 스크린으로 점프.
    const screenParam = params.get('screen');
    if (screenParam !== null) {
      const valid: readonly HarnessScreen[] = [
        'title',
        'base',
        'starMap',
        'inventory',
        'research',
        'refinery',
        'defense',
        'controlTower',
      ];
      if ((valid as readonly string[]).includes(screenParam)) {
        harnessGoto(screenParam as HarnessScreen);
      }
    }

    // URL 딥링크(DEV): `?invasion=def3-mid&invasionLayer=2` 로 3레이어 침공 런에 바로 진입.
    // `?invasion=1` 은 def3-empty(기본 수비대 전면 충원) 와 같다. 레이어 점프는 무대
    // 꾸미기라 오염 런으로 표시된다(ADR-0008).
    const invasionParam = params.get('invasion');
    if (invasionParam !== null && harness !== null) {
      // 프리셋 목록은 하네스 모듈에 있다 — 동적 import 라 프로덕션 번들에 들어가지 않는다.
      const presets = await import('./harness/presets.js');
      const presetParam = presets.INVASION_PRESET_KINDS.find((k) => k === invasionParam);
      const layerParam = Number(params.get('invasionLayer'));
      const layer = layerParam === 2 || layerParam === 3 ? layerParam : 1;
      harness.startInvasion({
        ...(presetParam !== undefined ? { preset: presetParam } : {}),
        layer,
      });
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  const hudEl = document.getElementById('hud');
  if (hudEl !== null) hudEl.textContent = `Fatal: ${String(err)}`;
});
