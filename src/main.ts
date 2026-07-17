/**
 * Entry point.
 *
 * Wires the deterministic sim to the PixiJS renderer with a fixed-timestep loop:
 * the sim steps at exactly 60 Hz (accumulator pattern) while rendering happens
 * every animation frame, interpolating between the two most recent sim snapshots
 * so motion is smooth on any refresh rate.
 *
 * M2 wraps the run in a meta loop (plan Phase C/D): a persistent `Profile`
 * (localStorage) feeds the star-map screen (planet/tier/anomaly) and the
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
import { loadGameTextures } from './render/textures.js';
import { EntityRenderer } from './render/entityRenderer.js';
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
import { ResultOverlay } from './ui/resultOverlay.js';
import { PlanetSelect } from './ui/planetSelect.js';
import type { LaunchSelection } from './ui/planetSelect.js';
import { InventoryOverlay } from './ui/inventory.js';
import { BaseMap } from './ui/baseMap.js';
import { ResearchLab } from './ui/researchLab.js';
import { Refinery } from './ui/refinery.js';
import { DefenseCommand } from './ui/defenseCommand.js';
import { ControlTower } from './ui/controlTower.js';
import type { ControlTowerShowOpts, InvasionResultView } from './ui/controlTower.js';
import {
  TitleScreen,
  TutorialOverlay,
  FtueTracker,
  TUTORIAL_SEED,
  TUTORIAL_PLANET,
  TUTORIAL_TIER,
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
} from './sim/world.js';
import type { WorldState, WorldConfig, InputFrame } from './sim/world.js';
// DEV 하네스: 타입만 정적 import(런타임 값은 아래 import.meta.env.DEV 블록에서 동적
// import 하므로 프로덕션 번들에서 완전히 제거된다). 타입 import는 컴파일 시 소거됨.
import type { Harness, HarnessScreen } from './harness/core.js';
import { snapshotWorld } from './sim/snapshot.js';
import type { WorldSnapshot } from './sim/snapshot.js';
import { ReplayRecorder, hashWorld } from './sim/replay.js';
import { SeededRng } from './sim/rng.js';
import { rollAnomaly } from './sim/anomaly.js';
import { runBench } from './bench/bench.js';
import { EQUIP_SLOTS } from './items/types.js';
import type { Item } from './items/types.js';
import { computeLoadoutStats } from './items/loadout.js';
import { loadProfile, saveProfile, activeShip } from './save/profile.js';
import { settleRun } from './save/settlement.js';
import type { SettlementOutcome } from './save/settlement.js';
// M4 네트워크 계층(Phase B3): Supabase 미설정 시 완전 no-op, 절대 throw 안 함.
// 정산 시점에서만 fire-and-forget 로 호출 — sim/게임루프와 무관(결정론·오프라인 우선).
import { migrateLocalProfileToServer, recordPveRunResult, recordPveRun } from './net/index.js';
// M4 침공(비동기 PvP) 제출: 미설정 시 submitInvasion 은 null(잠정 결과만 표시).
import {
  submitInvasion,
  buildClientResult,
  maintenanceToCenti,
  fetchInvasionReplay,
  setInvasionSticker,
} from './net/invasion.js';
import type { InvasionTarget } from './net/invasion.js';
import { DEFAULT_TIME_LIMIT_TICKS } from './sim/defense.js';
import type { InvasionConfig, DefenseLayout } from './sim/defense.js';
// M4 Phase F: 리플레이 관전(F3) + 도발 스티커(F2).
import { SpectateOverlay, isPlayableReplay, nextSpectateSpeed } from './ui/replaySpectate.js';
import type { SpectateSpeed } from './ui/replaySpectate.js';
import { StickerPicker } from './ui/stickerPicker.js';
import type { Replay } from './sim/replay.js';
// M5 Phase C: 사운드(C1)·정산 완성판(C2)·로컬라이즈(C3). 전부 render/UI 레이어(sim 무수정).
import { GameAudio } from './render/audio.js';
import { RunSoundObserver } from './render/soundScape.js';
import { SettingsPanel } from './ui/settingsPanel.js';
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
  const resultOverlay = new ResultOverlay();
  const planetSelect = new PlanetSelect();
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
  // Load all four planet Wang tilesets up front (missing ones resolve to null →
  // that planet falls back to the procedural TilingSprite, regression 0).
  const wangTiles: (WangTiles | null)[] = await Promise.all([
    loadWangTiles(0),
    loadWangTiles(1),
    loadWangTiles(2),
    loadWangTiles(3),
  ]);
  const entityRenderer = new EntityRenderer(textures);
  gameApp.stage.addChild(entityRenderer.layer);

  // 우상단 플레이어 중심 레이더(렌더 전용, ADR-0009). entityRenderer.layer는 카메라를
  // 따라 팬되지만 레이더는 stage에 직접 붙여 화면 고정 HUD로 둔다. 하단-좌 HUD·상단-중
  // 보스바·하단-우 치트 패널과 겹치지 않는 우상단에 배치.
  const radar = new Radar();
  radar.layer.position.set(DESIGN_WIDTH - 24 - radar.radiusPx, 24 + radar.radiusPx);
  gameApp.stage.addChild(radar.layer);

  const controller = new InputController(gameApp);
  const fps = new FpsMeter();
  // 유니크 드랍 세리머니(렌더 전용): 슬로모 + 금빛 플래시. 시뮬 결과 무영향.
  const ceremony = new UniqueCeremony();

  // --- Persistent meta state (M2) ---
  const profile = loadProfile();
  // 로컬 세이브 → 서버 1회 이관(멱등, 무손실). 미설정이면 no-op. 비차단.
  void migrateLocalProfileToServer(profile);
  const inventory = new InventoryOverlay(profile);
  // M3 base-map hub + building screens + FTUE (Phase D/E).
  const baseMap = new BaseMap();
  const researchLab = new ResearchLab(profile);
  const refinery = new Refinery(profile);
  const defenseCommand = new DefenseCommand(profile);
  const controlTower = new ControlTower();
  // M4 Phase F: 관전 컨트롤 오버레이(F3) + 도발 스티커 선택(F2).
  const spectateOverlay = new SpectateOverlay();
  const stickerPicker = new StickerPicker();
  const titleScreen = new TitleScreen();
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
  // M5 C1/C3: 좌상단 설정 패널(음소거·볼륨·언어). 생성만으로 DOM 에 자기 등록하므로 참조를
  // 따로 보관하지 않는다. 언어 전환 시 현재 메뉴 화면을 다시 그린다.
  new SettingsPanel(audio, () => rerenderCurrentScreen());
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

  // --- 침공(비동기 PvP) 런 상태 ---
  // invasionTarget !== null 이면 현재 런은 침공 런이다 → endRun 이 PvE 정산 대신 서버
  // 제출로 분기한다. pendingInvasionResult 는 다음에 관제탑을 열 때 표시할 결과 배너.
  let invasionTarget: InvasionTarget | null = null;
  let pendingInvasionResult: InvasionResultView | null = null;

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
   * defenseCommand 등 아직 미로케일화된 화면도 안전하게 재오픈된다(문자열만 그대로).
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
    defenseCommand.hide();
    controlTower.hide();
    spectateOverlay.hide();
    stickerPicker.hide();
    spectateReplay = null; // 관전 종료(화면 전환 시 항상 해제)
    titleScreen.hide();
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
        defenseCommand.show(profile, () => openBaseMap());
      },
      onControl: () => {
        baseMap.hide();
        openControlTower();
      },
      onStarMap: () => openStarMap(),
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
    }
    if (opts.verifying === true) showOpts.verifying = true;
    controlTower.show(
      profile,
      {
        onInvade: (target, layout) => startInvasionRun(target, layout),
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
   * 침공 런 시작. 대상의 방어 배치(normalizeLayout 완료본)를 침공 config 로 넣어
   * 결정론 런을 돌린다(갈림길③A). 승리=코어 파괴, 패배=시간초과/격추. 런 종료 시
   * endRun 이 invasionTarget 을 보고 서버 제출로 분기한다.
   */
  function startInvasionRun(target: InvasionTarget, layout: DefenseLayout): void {
    // 관제탑 경유 시작 — 켜져 있을 수 있는 메뉴를 먼저 내린다(harness startRun 참조).
    planetSelect.hide();
    inventory.hide();
    researchLab.hide();
    refinery.hide();
    clearToMenu();
    tutorialActive = false;
    shownLevel = 0;
    const seed = nextSeed();
    const ship = activeShip(profile);
    const equipped: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) equipped.push(it);
    }
    const skillInvest = profile.skillInvest.slice();
    const { loadout } = computeLoadoutStats(equipped, skillInvest);
    // 방어 정비도(풍화, ADR-0006)를 sim centi-percent 로 변환해 config 에 싣는다.
    // 공식 Math.round(db*100)은 서버 EF 재실행과 동일해야 한다(어긋나면 해시 발산 오거부).
    const maintenance = maintenanceToCenti(target.maintenance);
    const invasion: InvasionConfig = {
      layout,
      timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
      ...(maintenance !== undefined ? { maintenance } : {}),
    };
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: 0,
      tier: 0,
      anomalyAccepted: false,
      loadout,
      skillInvest,
      invasion,
    };
    // 침공 아레나는 기본 배경(타일셋 없음) — 방어 배치가 무대다.
    background.texture = planetBackground(0);
    autotile.configure(null, seed);
    background.visible = true;
    currentSeed = seed;
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
    invasionTarget = null;
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
    const verdict = await submitInvasion({ target, replay, clientResult });
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
    const seed = nextSeed();
    // Pre-compute the anomaly the seed offers (same fork the sim uses) so the
    // player can accept/reject it before the run (OQ-M2-3).
    const offer = rollAnomaly(new SeededRng(seed).fork('anomaly'), false);
    planetSelect.show({
      anomalyOffered: offer.kind,
      meta: metaLine(),
      level: activeShip(profile).level,
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
      tier: TUTORIAL_TIER,
      anomalyAccepted: false,
      maxSegments: TUTORIAL_MAX_SEGMENTS,
    });
    tutorialActive = true; // startRun cleared it; mark this run as the tutorial.
    ftue.markCombat();
    tutorialOverlay.show();
  }

  /** Assemble the run config from the selection + active loadout, then start. */
  function startRun(seed: number, sel: LaunchSelection): void {
    tutorialActive = false; // normal run unless startTutorial re-flags it
    invasionTarget = null; // PvE 런: 침공 컨텍스트 해제(endRun 이 정산 경로로 분기)
    shownLevel = 0; // 새 런: 레벨업 오버레이 표시 상태 초기화
    const ship = activeShip(profile);
    const equipped: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) equipped.push(it);
    }
    // Skill investment (account-wide) folds into the loadout block and is carried
    // in the config as a snapshot (Replay.config) + read by the powerup weighting.
    const skillInvest = profile.skillInvest.slice();
    const { loadout } = computeLoadoutStats(equipped, skillInvest);
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: sel.planet,
      tier: sel.tier,
      anomalyAccepted: sel.anomalyAccepted,
      loadout,
      skillInvest,
    };
    // 튜토리얼 단축판: 상한이 지정된 런(startTutorial)만 세그먼트를 제한한다.
    if (sel.maxSegments !== undefined) config.maxSegments = sel.maxSegments;
    // Swap the arena backdrop to the launched planet's theme (render-only). The
    // Wang autotile floor takes over when the planet has a tileset; otherwise the
    // flat TilingSprite stays visible as the fallback.
    background.texture = planetBackground(sel.planet);
    const tiles = wangTiles[sel.planet] ?? null;
    autotile.configure(tiles, seed);
    background.visible = !autotile.active;
    currentSeed = seed;
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
      if (!w.tainted) {
        lastOutcome = settleRun(profile, {
          victory: w.victory,
          loot: w.loot,
          xpTotal: w.xpTotal,
          resources: w.resources,
          planet: w.config.planet ?? 0,
          tier: w.config.tier ?? 0,
        });
        // Completing the tutorial (win or lose) reveals the base and makes the run
        // skippable thereafter (OQ-M3-7). Persist the flag with the settlement.
        if (tutorialActive) profile.tutorialDone = true;
        saveProfile(profile);
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

  // Kick off at the title screen (first launch forces the tutorial → base map).
  openTitle();

  gameApp.app.ticker.add((ticker) => {
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

    // --- Render ---
    const alpha = accumulator / DT;
    entityRenderer.render(prevSnap, currSnap, alpha);
    // 우상단 레이더(렌더 전용): 현재 스냅샷만 읽어 보스·엘리트·드랍·기믹·해저드를 표시.
    radar.render(currSnap);

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
    if (!spectating && w !== null && shouldEnterSettlement(runOver, settled)) {
      endRun(w);
    }

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
          defenseCommand.show(profile, () => openBaseMap());
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
        radar.render(currSnap);
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
          tier: opts.tier,
          anomalyAccepted: opts.anomaly,
          ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
        });
      },
      nextSeed: () => nextSeed(),
      activateHarnessProfile: () => {
        core.setProfileStoreOverride(core.harnessProfileStore());
      },
      applyProfile: (p) => {
        Object.assign(profile, p);
        saveProfile(profile);
      },
      refreshScreen: () => harnessRefreshScreen(),
      getProfileSummary: () => ({
        credits: profile.credits,
        minerals: profile.minerals,
        shipLevel: activeShip(profile).level,
      }),
      markTaintedIfLive: () => {
        const w = world;
        if (w !== null && !w.gameOver && !w.victory) markTainted(w);
      },
      isTainted: () => world?.tainted ?? false,
      currentScreen: () => currentScreenName,
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
        radar.render(currSnap);
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
      saveProfile: () => saveProfile(profile),
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
  }
}

main().catch((err: unknown) => {
  console.error(err);
  const hudEl = document.getElementById('hud');
  if (hudEl !== null) hudEl.textContent = `Fatal: ${String(err)}`;
});
