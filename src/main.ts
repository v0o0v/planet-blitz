/**
 * Entry point.
 *
 * Wires the deterministic sim to the PixiJS renderer with a fixed-timestep loop:
 * the sim steps at exactly 60 Hz (accumulator pattern) while rendering happens
 * every animation frame, interpolating between the two most recent sim snapshots
 * so motion is smooth on any refresh rate.
 *
 * M2 wraps the run in a meta loop (plan Phase C/D): a persistent `Profile`
 * (localStorage) feeds the star-map screen (planet/stage/catalysts) and the
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
import { graphicsTierController } from './render/graphicsRuntime.js';
import { graphicsSettings } from './render/graphicsSettings.js';
import { Radar } from './render/radar.js';
import { UniqueCeremony } from './render/ceremony.js';
import { ScreenTransition } from './render/screenTransition.js';
import { InputController } from './input/controller.js';
import { Hud } from './ui/hud.js';
import type { BossHudState } from './ui/hud.js';
import { PowerupOverlay } from './ui/powerupOverlay.js';
import { EncounterOverlay, encounterPromptView } from './ui/encounterOverlay.js';
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
  encounterShardOf,
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
import { runBench } from './bench/bench.js';
// 런 설정 조립 **단일 정본**(M8 설계서 §10-2). PvE·정식 침공·하네스 침공 세 경로가 전부
// 이것만 쓴다 — main.ts 안에서 config 를 다시 조립하지 마라(3중복이 배선 누락의 원인이었다).
import { buildRunConfig } from './run/runConfig.js';
import { buildCallupPilot } from './run/callupPilot.js';
import { loadProfile, saveProfile, activeShip } from './save/profile.js';
import { settleRun } from './save/settlement.js';
import type { SettlementOutcome } from './save/settlement.js';
// M4 네트워크 계층(Phase B3): Supabase 미설정 시 완전 no-op, 절대 throw 안 함.
// 정산 시점에서만 fire-and-forget 로 호출 — sim/게임루프와 무관(결정론·오프라인 우선).
import {
  migrateLocalProfileToServer,
  recordPveRunResult,
  settlePveRunCurrency,
  isNetConfigured,
  pushProfileToServer,
  consumeCatalystsOnServer,
  fetchCatalystInventoryOnline,
  grantCatalystDrops,
  setHarnessCatalystGateway,
} from './net/index.js';
// 촉매 시스템(ADR-0029, Lane 4): 드랍 파생(순수) + 출격 폴백 모달.
import { catalystDropsFromRun } from './data/catalystDrops.js';
import { CatalystSortieModal } from './ui/pixi/catalystSortieModal.js';
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
import { RunSoundObserver, DropObserver } from './render/soundScape.js';
import { MusicDirector, type MusicZone } from './render/musicDirector.js';
import { setUiAudio } from './render/uiSound.js';
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
  // 조우 프롬프트(ADR-0033). 파워업 오버레이(레벨업 3택)와 **완전히 같은 짝**이다 —
  // 오버레이는 선택을 컨트롤러 큐에 넣기만 하고, 실제 반영은 다음 입력 프레임의
  // `SPECIAL_ENCOUNTER_*` 비트를 sim 이 읽으면서 일어난다. 이 짝이 없어서 조우 5종 중
  // 3종이 실제 플레이에서 도달 불가였다(리뷰 CRITICAL). `stepWorld` 직접 호출 금지 —
  // 입력 프레임에 실리지 않은 선택은 리플레이·서버 재검증에 존재하지 않는 사건이 된다.
  const encounterOverlay = new EncounterOverlay({
    onEnter: () => controller.queueEncounterEnter(),
    onDecline: () => controller.queueEncounterDecline(),
    onAltarPick: (index) => controller.queueEncounterAltarPick(index),
    onExit: () => controller.queueEncounterExit(),
  });
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
  // 촉매 소모 실패 폴백 모달(ADR-0029) — 출격 직전 consume_catalysts 가 거부/오프라인이면
  // [재시도]/[촉매 빼고 출격] 을 묻는다. 성계 지도 위에 얹히므로 같은 stage 에 뒤늦게 붙인다.
  const catalystSortieModal = new CatalystSortieModal(gameApp.stage);
  // 카툰나무풍 롤아웃 #5: DOM `ResultOverlay` 대신 Pixi 캔버스 정산 화면으로 교체(show/hide/
  // visible + ResultState 동일). 다른 캔버스 화면과 같은 이유로 여기서 만든다 — 앞쪽(텍스처
  // 로드 전)에서 만들면 entityRenderer·radar 보다 먼저 stage 에 붙어 아레나 아래에 깔린다.
  const resultOverlay = new ResultOverlayScreen(gameApp.stage);
  // AC-5.1 메타 화면 전환 커튼(카툰나무 슬라이드, ADR-0031). clearToMenu() 단일 초크포인트가 play() 로
  // 트리거하고, 렌더 루프가 매 프레임 update(진행) + 재생 중엔 stage 최상단으로 raise 해 전 화면·크롬 UI
  // 위를 덮는다. render-only(sim 무관). 비재생 시 커튼은 화면 밖·invisible 로 파킹된다.
  const screenTransition = new ScreenTransition();
  gameApp.stage.addChild(screenTransition.container);
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
  // 메타 UI 음(AC16)이 흐를 사운드 보드를 UI 훅에 1회 주입 — PixiButton 등 공유 UI 가 playUi 로 낸다.
  setUiAudio(audio);
  const soundObserver = new RunSoundObserver(audio);
  // 이원 드랍 관측자(바닥 loot 엔티티 등장 + state.loot 직행 증분 — AC13·R8). 런마다 reset.
  const dropObserver = new DropObserver();
  // BGM 존 디렉터(사운드 풍성화 Phase 3 — 화면/보스 상태를 관찰해 존 전환·정산 스팅어). 순수 render.
  const music = new MusicDirector(audio);
  // 초기 존을 큐잉한다 — ctx 미준비라 pendingZone='menu' 로 대기하다 첫 제스처(unlock)에서 재생된다
  // (타이틀 메뉴곡 자동재생 정책 지연, AC7).
  music.setZone('menu');
  // 자동재생 정책: 아무 첫 사용자 제스처에서 오디오 컨텍스트를 잠금 해제한다. 음악도 같은
  // 제스처에서 핸드셰이크(unlock)로 큐잉된 존을 시작한다.
  const unlockAudioOnce = (): void => {
    audio.unlock();
    music.unlock();
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
  // 레벨업 링(AC-4.6) 발화용 직전 프레임 레벨. -1 = 미관측(첫 관측은 기준선만, 링 없음 — soundObserver
  // baseline 패턴). 런은 항상 레벨 1로 시작하므로 이전 런의 max 가 남아 있어도 새 런에서 오발하지 않는다.
  let prevRingLevel = -1;

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
  /**
   * 현재 런 종류(BGM 존 분기용 — `run` 화면은 다형성이라 화면 이름만으론 PvE/침공을 못 가른다,
   * AC3). 각 런 진입점이 `setScreen('run')` 직전에 세운다(정식 침공·하네스 침공=invasion, PvE=pve).
   */
  let currentRunKind: 'pve' | 'invasion' = 'pve';

  /** 화면 안 판정용 뷰 반폭(월드 단위). entityRenderer 가 월드↔디자인px 를 1:1 로 그려(줌 없음). */
  const VIEW_HALF_WIDTH = DESIGN_WIDTH / 2;

  /** 화면 이름 → BGM 존(AC2·AC3·AC5). `result` 는 정산 스팅어가 음악을 소유하므로 null(존 미변경). */
  function zoneForScreen(name: string): MusicZone | null {
    switch (name) {
      case 'run':
        return currentRunKind === 'invasion' ? 'invasion' : 'combatPvE';
      case 'spectate':
        return 'invasion';
      case 'result':
        return null; // 스팅어(playStinger)가 존 정지→one-shot→menu 복귀를 담당(AC6).
      default:
        // title·base·defense·archive·controlTower·starMap·inventory·research·refinery → 메뉴·기지(AC2).
        return 'menu';
    }
  }

  /** 스크린 전환 시 BGM 존 갱신 + 하네스에 통지(스냅샷 screen + screenChange 이벤트). */
  function setScreen(name: string): void {
    currentScreenName = name;
    const zone = zoneForScreen(name);
    if (zone !== null) music.setZone(zone);
    // 런 진입 시 boss 트랙을 미리 fetch+decode 해 둔다 — 보스 등장 크로스페이드의 로드 지연 제거
    // (AC7 "화면 전환 직전 프리페치"; 보스는 런 도중 전환이라 미리 데워 두는 게 가장 값지다).
    if (name === 'run') music.prefetch('boss');
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
    // AC-5.1 균일 전환 커튼(카툰나무 슬라이드) — 전 메타 화면 swap 의 단일 초크포인트라 여기서 1회 트리거해
    // 모든 화면 전환에 균일 적용한다. 화면 teardown(아래)+호출자의 새 화면 show()는 같은 프레임에 동기로
    // 끝나 swap 이 원자적이므로(플래시 없음), 커튼은 그 위를 카툰 결로 쓸어 전환을 읽히게 하는 연출이다.
    // play()는 멱등·재진입 안전이라 여러 초크포인트에서 불려도 안전(처음부터 재시작). render-only.
    screenTransition.play();
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
    catalystSortieModal.hide(); // 촉매 폴백 모달이 떠 있으면 함께 내린다(화면 전환 잔상 방지).
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
    // 조우 프롬프트도 런 전용 UI 다. 렌더 루프가 매 프레임 재도출하므로 보통은 저절로
    // 사라지지만, 화면 전환과 다음 프레임 사이에 프롬프트가 남는 한 프레임을 없앤다.
    encounterOverlay.hide();
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
    dropObserver.reset();
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
    const pilot = buildCallupPilot(profile, pilotGuardianId);
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
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = target;
    harnessInvasionRun = false; // 정식 침공: 정산·제출 경로를 탄다
    currentRunKind = 'invasion'; // 정식 침공 런 → invasion 존(AC3).
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
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = null;
    harnessInvasionRun = true;
    currentRunKind = 'invasion'; // 하네스 침공도 침공 런 → invasion 존(AC3).
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
    // 정산 스팅어(AC6): 전투·보스존 정지 → 승/패 one-shot → 종료 후 menu 존 복귀. 침공 런당 1회.
    // 서버 판정은 잠정 결과 이후 확정되지만, 스팅어는 런 종료 순간의 클라 연출이다(PvE 와 동형).
    music.playStinger(w.victory ? 'victory' : 'defeat');
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
    // 촉매 주입 패널·픽커(ADR-0029)는 성계 지도가 소유하고, 주입 촉매는 sel.catalysts 로 온다.
    // 보유 원장은 서버 권위라 온라인 조회 provider 를 넘긴다(미설정이면 null → 빈 보유 = 주입 불가).
    planetSelect.show({
      meta: metaLine(),
      // 행성별 개방 상한 산정(ADR-0022): 그 행성 최고 클리어 단계 → max(10, +5).
      bestStageCleared: (planet) => profile.planetProgress[planet]?.bestStageCleared ?? 0,
      // 촉매가 주입돼 있으면 출격 직전 consume 를 거치고, 아니면 즉시 startRun(무촉매 경로 불변).
      onLaunch: (sel) => beginSortie(seed, sel),
      onInventory: () => {
        planetSelect.hide();
        inventory.show(profile, () => openStarMap());
      },
      onBack: () => openBaseMap(),
      fetchCatalystInventory: () => fetchCatalystInventoryOnline(),
    });
  }

  /**
   * 출격 진입(ADR-0029) — 주입 촉매가 없으면 즉시 startRun(무촉매·오프라인 경로 **불변**), 있으면
   * 출격 직전 `consume_catalysts` 를 거친다. buildRunConfig 조립은 언제나 startRun 안 단일 정본만
   * 쓴다(여기서 config 를 손대지 않는다 — 설계서 §10-2, shipIntegration grep 게이트).
   */
  function beginSortie(seed: number, sel: LaunchSelection): void {
    const cats = sel.catalysts ?? [];
    if (cats.length === 0) {
      startRun(seed, sel);
      return;
    }
    void consumeAndLaunch(seed, sel, cats);
  }

  /**
   * 촉매 소모 → 성공 시 발급 runId·촉매를 sel 에 실어 런 시작, 실패 시 [재시도]/[촉매 빼고 출격]
   * 모달. **실패 경로에서 아이템은 미소모**다 — consume 실패는 서버 트랜잭션 롤백이라 클라가 상태를
   * 만지지 않는다(낙관적 로컬 차감 없음). [촉매 빼고 출격]은 무촉매(runId 없음)로 시작해 오프라인
   * 폴백을 보존하고, X/취소는 성계 지도로 되돌린다(주입은 그대로 남아 재시도 가능).
   */
  async function consumeAndLaunch(
    seed: number,
    sel: LaunchSelection,
    cats: number[],
  ): Promise<void> {
    const outcome = await consumeCatalystsOnServer(cats, sel.planet);
    if (outcome.status === 'ok') {
      startRun(seed, { ...sel, catalysts: cats, runId: outcome.runId });
      return;
    }
    // unconfigured(영구 오프라인)·failed(거부/일시 오프라인) 모두 2선택 모달로 처리한다.
    catalystSortieModal.show({
      onRetry: () => void consumeAndLaunch(seed, sel, cats),
      // 촉매·runId 를 뺀 무촉매 sel 로 시작(오프라인 폴백 보존). 명시 재조립으로 잔여 필드 누락 방지.
      onSkip: () =>
        startRun(seed, {
          planet: sel.planet,
          stage: sel.stage,
          ...(sel.maxSegments !== undefined ? { maxSegments: sel.maxSegments } : {}),
        }),
      onCancel: () => openStarMap(),
    });
  }

  /** Build the tutorial run: homeworld orbit, fixed seed, current loadout. */
  function startTutorial(): void {
    startRun(TUTORIAL_SEED, {
      planet: TUTORIAL_PLANET,
      stage: TUTORIAL_STAGE,
      maxSegments: TUTORIAL_MAX_SEGMENTS,
    });
    tutorialActive = true; // startRun cleared it; mark this run as the tutorial.
    ftue.markCombat();
    tutorialOverlay.show();
  }

  /** Assemble the run config from the selection + active loadout, then start. */
  function startRun(seed: number, sel: LaunchSelection): void {
    pendingRunSeed = null; // 이번 시드 소진 — 다음 성계 지도는 새 시드를 굴린다
    tutorialActive = false; // normal run unless startTutorial re-flags it
    invasionTarget = null; // PvE 런: 침공 컨텍스트 해제(endRun 이 정산 경로로 분기)
    harnessInvasionRun = false;
    currentRunKind = 'pve'; // PvE 런 → combatPvE 존(AC3).
    shownInvasionPhase = -1; // 침공 배경 추적 해제(PvE 는 행성 배경)
    shownLevel = 0; // 새 런: 레벨업 오버레이 표시 상태 초기화
    echoToastShown = false; // 새 런: 에코 안정화 로어 토스트 재무장
    // 런 조립 단일 정본. 투자 벡터·기체 타입·계보 보너스는 전부 이 안에서 접힌다 —
    // 튜토리얼 단축판(maxSegments)도 여기로 넘겨 config 후처리를 남기지 않는다.
    // 촉매 주입(ADR-0029): 성계 지도 픽커가 `sel.catalysts` 를, consume 성공이 `sel.runId` 를 실어
    // 여기로 온다. 무촉매면 둘 다 미지정이라 buildRunConfig 가 `catalysts: []` 로 스탬프(경로 불변).
    // exactOptionalPropertyTypes 규율상 값이 있을 때만 전달한다.
    const config = buildRunConfig(profile, {
      planet: sel.planet,
      stage: sel.stage,
      ...(sel.maxSegments !== undefined ? { maxSegments: sel.maxSegments } : {}),
      ...(sel.catalysts !== undefined && sel.catalysts.length > 0 ? { catalysts: sel.catalysts } : {}),
      ...(sel.runId !== undefined ? { runId: sel.runId } : {}),
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
    dropObserver.reset();
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
    // 이번 런에서 파생·적립한 촉매 드랍 총량(결과 오버레이 표시용). 오염/하네스 침공 런은
    // 정산 블록에 들어가지 않으므로 0 으로 남는다(격리면 안에서만 적립·표시).
    let catalystDropTotal = 0;
    if (!settled) {
      settled = true;
      // M5 C1: 승/패 연출 사운드(런당 1회). 격추 사출음(eject)은 피격 관찰에서 이미 났으므로
      // 여기서는 결과 팡파레/하강음만 낸다.
      audio.play(w.victory ? 'victory' : 'defeat');
      // 정산 스팅어(AC6, 음악 계층 — 위 SFX victory/defeat 와 공존): 전투·보스존 정지 → 승/패
      // one-shot → 종료 후 menu 존 복귀. PvE·하네스 침공 런(invasionTarget 없음)이 이 경로를 탄다.
      music.playStinger(w.victory ? 'victory' : 'defeat');
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
          // 조우 프레임워크(ADR-0033): 기록 파편우도 **같은 기록 파편 축**으로 합류한다
          // (명세의 "신규 보상 시스템 0" 제약 — 파편 슬롯 소비 로직을 두 벌로 만들지 않는다).
          // 둘 다 순수 리더라 sim 무수정이고, OR 라서 에코 단독 런의 거동은 그대로다.
          echoStabilized: echoStabilizedOf(w) || encounterShardOf(w),
          storyMetricDeltas: runStoryMetrics(w),
        });
        // Completing the tutorial (win or lose) reveals the base and makes the run
        // skippable thereafter (OQ-M3-7). Persist the flag with the settlement.
        if (tutorialActive) profile.tutorialDone = true;
        // 재화 지급(ADR-0026/0027 서버 권위): settleRun 은 재화를 만지지 않고 델타만 반환한다.
        //  - 온라인(설정) → settle_pve_run(자원→credits·광물→minerals) + story 보상 grant 를
        //    서버로 지급하고 응답 잔액으로 미러를 갱신(서버값이 정본). 전송 실패는 대기 큐 재시도.
        //  - 미설정(오프라인 단일플레이) → 로컬 미러에 직접 가산(기존 동작 100% 보존).
        // isNetConfigured() 로 분기해 미설정 폴백을 saveProfile **전에** 동기 반영한다.
        const creditsGained = lastOutcome.creditsGained;
        const storyReward = lastOutcome.storyRewardCredits ?? 0;
        if (isNetConfigured()) {
          void settlePveRunCurrency(profile, {
            summary: {
              victory: w.victory,
              planet: w.config.planet ?? 0,
              stage: w.config.stage ?? 1,
              finalTick: w.tick,
              resources: creditsGained,
              minerals: 0,
              kills: w.kills,
              // 촉매 소모 영수증 런 id 관통(ADR-0029): consume 성공 시 buildRunConfig 가
              // config.runId 로 스탬프한 값을 그대로 실어, 서버 settle_pve_run 이 이 id 로 pending
              // 영수증(자원 배율)을 조회해 캡을 상향한다. 무촉매 런은 undefined → 기존 base 경로.
              ...(w.config.runId !== undefined ? { runId: w.config.runId } : {}),
            },
            storyRewardCredits: storyReward,
          });
        } else {
          profile.credits += creditsGained + storyReward;
        }
        saveProfile(profile);
        // 설계도 지급(M7b): 정산이 파생한 목록을 서버 보유량에 얹는다. 미설정·오프라인이면
        // no-op 이고 throw 하지 않는다. 오염 런·하네스 침공 런은 이 블록에 들어오지 않으므로
        // 설계도도 함께 차단된다(ADR-0008 과 같은 격리면).
        void grantBlueprintDrops(lastOutcome.blueprintsGained);
        // 촉매 드랍 적립(ADR-0029): 장비 드랍 시드에서 **순수 파생**한 촉매 목록을 서버 원장에 얹는다.
        // catalystDropsFromRun 은 dropRng 를 소비하지 않고 이미 뽑힌 시드를 되풀어 쓰므로 sim 해시·
        // 리플레이가 불변이다(blueprintDropsFromLoot 와 같은 규율). 미설정/오프라인이면 no-op·throw X.
        const catalystDrops = catalystDropsFromRun({
          loot: w.loot,
          planet: w.config.planet ?? 0,
          catalysts: w.config.catalysts ?? [],
        });
        catalystDropTotal = catalystDrops.reduce((n, d) => n + d.qty, 0);
        void grantCatalystDrops(catalystDrops);
        // PvE 런 결과(정산된 메타: 아이템·XP·진행도 — 재화는 서버 컬럼 정본이라 미러만)를 서버
        // save 에 반영. 미설정이면 no-op, 실패 시 로컬 대기 슬롯에 남아 재시도(오프라인 우선).
        // ADR-0026: 리플레이 업로드(recordPveRun/pve_runs)는 폐기했다 — 재화가 서버 권위라
        // 사후 샘플링 재검증이 불필요해졌다(ReplayRecorder 는 침공 제출용으로만 살아있다).
        void recordPveRunResult(profile);
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
                // 이번 런에 얻은 촉매 총량(ADR-0029) — 있을 때만 정산 항목으로 노출.
                ...(catalystDropTotal > 0 ? { catalystDrops: catalystDropTotal } : {}),
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

    // AC-5.1 화면 전환 커튼: 매 프레임 진행(비재생 시 no-op) + 재생 중엔 stage 최상단으로 올려
    // 전 화면·크롬 UI 위를 덮는다(settings.raise 뒤라 커튼이 그 위). render-only.
    screenTransition.update(frame);
    if (screenTransition.active) {
      const st = gameApp.stage;
      st.setChildIndex(screenTransition.container, st.children.length - 1);
    }
    // AC-5.2 보상 세리머니 진행 — 정산 화면엔 자체 프레임 루프가 없어 여기서 매 프레임 구동한다
    // (비표시 시 no-op). 공개→유지→페이드아웃 흐름을 굴려 결과 패널을 드러낸다.
    resultOverlay.update(frame);

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

    // 레벨업 링(AC-4.6) — 런 레벨이 오르면 렌더러에 링을 예약(soundObserver 의 levelUp 과 동일 신호,
    // render-only). 스냅샷엔 level 이 없어 렌더가 스스로 감지 못 하므로 여기서 imperative 로 넘긴다.
    // 첫 관측(prevRingLevel<0)은 기준선만 세우고 링을 내지 않는다. 다음 render 가 플레이어 위치에 방출.
    if (w !== null) {
      if (prevRingLevel >= 0 && w.level > prevRingLevel) entityRenderer.pulseLevelUp();
      prevRingLevel = w.level;
    }

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

    // 조우 프롬프트(ADR-0033): 파워업과 같은 규율 — 오버레이가 스스로 토글하지 않고 sim
    // 상태(`encounterRuntime`)에서 매 프레임 순수 도출한다(encounterPromptView). 선택은
    // 컨트롤러 큐 → 다음 입력 프레임의 SPECIAL_ENCOUNTER_* 비트로만 sim 에 들어간다.
    //
    // ⚠️ **레벨업 오버레이가 떠 있으면 무조건 숨긴다.** 두 오버레이가 `Digit1~3` 을 공유하는
    // 유일한 충돌 지점이고, 프리즈 중에는 `stepWorld` 가 파워업만 처리하고 return 하므로
    // 그 프레임의 조우 비트는 어차피 sim 이 읽지 않는다(컨트롤러도 같은 이유로 큐를 유지한다).
    // 관전(spectating)은 남의 리플레이를 보는 화면이라 입력 자체가 sim 에 들어가지 않는다.
    if (!spectating && w !== null && !resultOverlay.visible && !powerupOverlay.visible) {
      encounterOverlay.update(encounterPromptView(w.encounterRuntime));
    } else {
      encounterOverlay.update(null);
    }

    // Settlement screen on death or clear. `settled`로 게이트한다(런 종료당 정확히 1회
    // — shouldEnterSettlement 참조). `!resultOverlay.visible`로 게이트하면 '장비 정비'가
    // 오버레이를 숨긴 뒤 endRun이 재호출되어 결과 화면이 인벤토리 위로 다시 뜬다.
    // 판정 자체는 settleIfRunOver 한 곳에만 산다 — DEV 하네스 훅도 같은 함수를 부른다.
    settleIfRunOver();

    // --- HUD (only during a live run) ---
    const f = fps.tick(frame);
    // 품질 티어 런타임 감시(Phase 0 — AC-0.4): 평활 FPS·프레임 델타·수동 오버라이드를 넘겨
    // 활성 티어를 갱신한다(롤링 창·판정 페이싱은 컨트롤러 소관). 활성 티어의 이펙트 소비는 후속 Phase.
    graphicsTierController.tick(f, frame, graphicsSettings.getSettings().quality);
    frameCount++;
    if (w !== null) {
      const p = w.entities[0];
      let enemyN = 0;
      let bulletN = 0;
      let playerBulletN = 0;
      let bossEnt: (typeof w.entities)[number] | undefined;
      let supplyActive = false;
      // 사운드 파생용 per-entity 스캔(원칙2: SoundFrame 은 스칼라만, per-entity 는 호출부 도출).
      const lootEntities: { id: number; x: number; rarity: number }[] = [];
      // 적 특수탄/보스탄 경고(AC19): 규칙(특수 거동탄 = 거동코드 ≠ BK_NONE)은 순수함수 shouldWarn
      // 이 테스트로 고정하고, 여기 hot path(탄막 밀도, R4·드라이버2)에서는 배열 할당 없이 인라인
      // 단락 판정한다. **한계**: 보스 직진탄(BK_NONE)은 render 가 소유주를 식별할 신호(ownerId 미설정)
      // 가 없어 경고에서 빠진다 — 신규 sim 플래그 추가 금지 제약에 내재된 것으로 문서화(plan Follow-up).
      // 특수 거동 보스탄(ring/spiral/aimedBurst 등)은 커버된다.
      let warnPresent = false;
      for (const e of w.entities) {
        if (e.kind === 'enemy') enemyN++;
        else if (e.kind === 'enemyBullet') {
          bulletN++;
          if (e.enemyType !== -1) warnPresent = true; // -1 = BK_NONE(직진 잡몹탄, bullets.ts:32) → 무음.
        } else if (e.kind === 'bullet') {
          bulletN++;
          playerBulletN++;
        } else if (e.kind === 'boss') bossEnt = e;
        else if (e.kind === 'supply') supplyActive = true;
        else if (e.kind === 'loot') {
          // 바닥 드랍 loot 엔티티(id·좌표 x·rarity=enemyType) — 이원 드랍 관측 입력(AC13·R8).
          lootEntities.push({ id: e.id, x: e.x, rarity: e.enemyType });
        }
      }
      // M5 C1 + 사운드 풍성화(P2/P4): 사운드 트리거 파생(render 관찰, sim 무수정). 프레임당 1회.
      // 이원 드랍 관측(바닥 loot 엔티티 등장 + state.loot 직행 증분 — 더블카운트 금지, AC13·R8),
      // 적 특수탄/보스탄 경고(AC19), 발사음 5종 변주(weaponType, AC12), 관전 SFX 억제(suppressSfx, AC21).
      const drops = dropObserver.observe(lootEntities, w.loot, p?.x ?? 0, VIEW_HALF_WIDTH);
      const warn = warnPresent;
      soundObserver.observe(
        {
          kills: w.kills,
          level: w.level,
          playerHp: p?.hp ?? 0,
          resources: w.resources,
          hasBoss: bossEnt !== undefined,
          bulletCount: playerBulletN,
          weaponType: w.weapon.weaponType,
          gameOver: w.gameOver,
          victory: w.victory,
        },
        { drops, warn, suppressSfx: spectating },
      );
      // 보스 존 전환(AC4): 라이브 런에서만 보스 등장→boss 존, 처치→런종류 존 복귀(짧은 보스전
      // thrash 방지 최소유지 가드는 MusicDirector 내부). 관전은 invasion 존 고정이라 제외(AC21).
      if (currentScreenName === 'run' && !spectating) {
        music.setZone(
          bossEnt !== undefined ? 'boss' : currentRunKind === 'invasion' ? 'invasion' : 'combatPvE',
        );
      }
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
      // 조우 프롬프트 — 조우 롤이 ≈2% 라 자연 발생을 기다릴 수 없다. 하네스에서 이 참조로
      // 프롬프트를 직접 띄워 문구·버튼을 눈으로 확인한다(조우 런타임 주입은 sim 쪽 몫).
      encounterOverlay,
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

    // 촉매 하네스 모의(ADR-0029, DEV): 실 Supabase 없이도 "보유 시드→픽커 주입→출격→정산"
    // 정규경로를 관측하려면 촉매 4함수(consume/salvage/grant/fetch)가 모의 성공해야 한다. 인메모리
    // 원장 게이트웨이를 net 에 폴백 주입한다(실 서버가 있으면 그쪽이 이긴다 — 폴백은 미설정 때만).
    // 동적 import 라 프로덕션 번들에서 제거되고, 프로덕션은 이 setter 를 아예 호출하지 않아 불변.
    // 재화 리더는 라이브 하네스 프로필을 가리킨다(분해 잔액을 현재 재화 기준으로 산정).
    const catalystMockMod = await import('./harness/catalystMock.js');
    const catalystMock = new catalystMockMod.HarnessCatalystGateway({
      credits: () => profile.credits,
      minerals: () => profile.minerals,
    });
    setHarnessCatalystGateway(catalystMock);
    const catalystControl: import('./harness/cheatPanel.js').HarnessCatalystControl = {
      seedAll: (qty) => {
        catalystMock.seedAll(qty);
        // 픽커 즉시 표시: 성계 지도에 모의 원장 스냅샷을 직접 주입(fetch 비동기 대기 없이).
        planetSelect.setCatalystInventory(catalystMock.snapshot());
      },
      clear: () => {
        catalystMock.clear();
        planetSelect.setCatalystInventory(new Map<number, number>());
      },
      stock: () => {
        const snap = catalystMock.snapshot();
        let total = 0;
        for (const q of snap.values()) total += q;
        return { types: snap.size, total };
      },
      setConsumeFail: (fail) => catalystMock.setConsumeFail(fail),
      consumeFail: () => catalystMock.isConsumeFail(),
      openStarMapPicker: () => {
        // 성계 지도로 이동(fetch 는 모의로 라우팅) 후 픽커를 연다. seedAll 이 이미
        // setCatalystInventory 로 보유를 직접 넣어, fetch 비동기 완료 전에도 픽커가 수량을 보인다.
        openStarMap();
        planetSelect.openCatalystPicker();
      },
      injectedCount: () => planetSelect.getInjectedCatalysts().length,
    };

    // DEV 치트 패널(개발 도구): 하네스를 구동하는 우하단 접이식 오버레이(백틱 ` 토글).
    // 동적 import라 프로덕션 번들에서 완전히 제거된다(import.meta.env.DEV 정적 false).
    const cheatPanel = await import('./harness/cheatPanel.js');
    const panel = cheatPanel.createCheatPanel({
      harness,
      catalyst: catalystControl,
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

    // URL 딥링크(DEV): ?gallery=1 로 부팅 후 프로토타입 갤러리(6종 변형 라이브 비교)를 게임 화면 위에
    // 바로 띄운다 — 치트 패널 '갤러리' 탭과 같은 공유 씬 싱글턴을 마운트. render-only.
    if (params.get('gallery') === '1') {
      const { galleryScene } = await import('./harness/gallery/galleryScene.js');
      galleryScene.mount(gameApp.stage, gameApp.app);
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
