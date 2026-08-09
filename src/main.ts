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
import {
  playerVisualFlags,
  setPlayerVisualFlags,
  resetPlayerVisualFlags,
} from './render/entity/playerVisualFlags.js';
import { DefensePreviewController } from './render/defensePreview.js';
import type { DefensePreviewControls } from './render/defensePreview.js';
import { AutotileBackground, loadWangTiles, loadInvasionWangTiles } from './render/autotile.js';
import type { WangTiles } from './render/autotile.js';
import { PlanetEnvironment } from './render/env/planetEnvironment.js';
// 침공 환경 테마의 합성 행성 인덱스(6·7·8). 침공 런의 `config.planet` 은 항상 0(카르곤)이라
// 행성 축을 그대로 넘기면 "침공인데 카르곤 화면" 이 된다 — 그 자리를 이 함수가 막는다.
import { invasionEnvPlanet } from './render/env/themes/invasion/index.js';
import { InvasionBackdrop } from './render/invasionBackdrop.js';
import { FpsMeter } from './render/fpsMeter.js';
import { graphicsTierController } from './render/graphicsRuntime.js';
import { graphicsSettings } from './render/graphicsSettings.js';
import { Radar } from './render/radar.js';
import { UniqueCeremony } from './render/ceremony.js';
import { InputController } from './input/controller.js';
import { Hud, hudActives } from './ui/hud.js';
import type { BossHudState, CatalystSlotState, RunInfoState } from './ui/hud.js';
import { invasionHudState } from './ui/invasionProgress.js';
import { runObjective, shelterArrivalMessage } from './ui/runObjective.js';
import { chaseSheltersSecured, chaseShelterTotal } from './sim/modes/chase.js';
import { PLANET_MODE } from './sim/planetMode.js';
import { bossHudName } from './ui/bossLabels.js';
import { bossProgress } from './sim/bossProgress.js';
import { PowerupOverlay } from './ui/powerupOverlay.js';
import { EncounterOverlay, encounterPromptView } from './ui/encounterOverlay.js';
import { levelUpOverlayAction, readBuildStatus, mercantileDebtOffer } from './ui/buildStatus.js';
import { mercantileDebtOf, MERCANTILE_DEBT_PER_PICK } from './sim/catalyst/resource.js';
import { shouldEnterSettlement } from './ui/runFlow.js';
import type { LaunchSelection } from './ui/planetSelect.js';
import { HangarScreen } from './ui/pixi/hangar.js';
import { BaseMapScreen } from './ui/pixi/baseMap.js';
// 일일 보상(ADR-0048) — 모달은 통지이지 수령 창구가 아니다("받기" 버튼이 없다).
import {
  setDailyRewardModalHost,
  showDailyRewardModal,
  hideDailyRewardModal,
  type DailyRewardModalData,
  type DailyRewardModalSubject,
} from './ui/pixi/dailyRewardModal.js';
import { loadDailySeenSeed, saveDailySeenSeed } from './save/dailySeen.js';
import {
  DAILY_SIDE_CREDITS,
  DAILY_STREAK_CYCLE,
  dailyDateSeed,
  shouldOpenDailyReward,
} from '../data/dailyReward.js';
import { DAILY_REWARD_AXES, type DailyRewardAxis } from '../data/dailyRewardSelection.js';
import { ResearchLabScreen } from './ui/pixi/researchLab.js';
import { RefineryScreen } from './ui/pixi/refinery.js';
import { PlanetSelectScreen } from './ui/pixi/planetSelect.js';
import { ResultOverlayScreen } from './ui/pixi/resultOverlay.js';
import { ControlTowerScreen } from './ui/pixi/controlTower.js';
import { ModulesScreen } from './ui/pixi/modulesView.js';
import { DefenseCommandScreen, catalogName } from './ui/pixi/defenseCommand.js';

import type { ControlTowerShowOpts, InvasionResultView } from './ui/controlTower.js';
import { TitleScreen } from './ui/pixi/titleScreen.js';
import { RecordsArchiveScreen } from './ui/pixi/recordsArchive.js';
import { IntroSlidesScreen } from './ui/pixi/introSlides.js';
// 의뢰서 시스템 Phase E: 지시 수신소(PvE 출격구 #2 — 성계 지도와 별개, CONTEXT.md 정본).
import { CommissionDeskScreen } from './ui/pixi/commissionDesk.js';
import { commissionGradeLabel } from './ui/pixi/commissionDeskView.js';
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
  markTainted,
  DT,
  xpToNextForRun,
  comboMultiplier,
  DEFAULT_CONFIG,
  echoStabilizedOf,
  catalystSettlementOf,
  catalystContributionsOf,
  catalystLootMultOf,
  bossKilledOf,
  encounterShardOf,
  encounterTypeOf,
  runStoryMetrics,
} from './sim/world.js';
import type { WorldState, InputFrame } from './sim/world.js';
// ⚠️ 런 전진은 `stepRun` 만 쓴다 — `stepWorld` 직접 import 는 eslint 가 막는다(계약 §6-4).
// 다구간 의뢰는 구간마다 **새 월드**를 만들므로, 반환값을 `world` 에 다시 대입하지 않으면
// 2구간부터 죽은 월드를 스텝하게 된다.
import { stepRun } from './sim/commissionSegment.js';
// 스토리 시스템(Phase E): 에코 안정화로 실을 파편 슬롯이 남았는지 판정(로어 토스트 예측용).
import { RECORD_SHARDS } from '../data/lore/index.js';
// DEV 하네스: 타입만 정적 import(런타임 값은 아래 import.meta.env.DEV 블록에서 동적
// import 하므로 프로덕션 번들에서 완전히 제거된다). 타입 import는 컴파일 시 소거됨.
import type { Harness, HarnessScreen } from './harness/core.js';
import { snapshotWorld } from './sim/snapshot.js';
// 촉매 통지 → 소리·색 해석(ADR-0052 §귀속 규율). 순수 함수라 매핑을 테스트가 직접 못 박는다.
import { catalystFxSound, catalystFxFlashesSlot, FX_SELF_HARM } from './render/catalystFx.js';
import type { WorldSnapshot } from './sim/snapshot.js';
import { ReplayRecorder, hashWorld } from './sim/replay.js';
import { runBench } from './bench/bench.js';
// 런 설정 조립 **단일 정본**(M8 설계서 §10-2). PvE·정식 침공·하네스 침공 세 경로가 전부
// 이것만 쓴다 — main.ts 안에서 config 를 다시 조립하지 마라(3중복이 배선 누락의 원인이었다).
import { buildRunConfig } from './run/runConfig.js';
import { buildCallupPilot } from './run/callupPilot.js';
import { loadProfile, saveProfile, activeShip, newPlayerProfile } from './save/profile.js';
import type { Profile } from './save/profile.js';
import { INVASION_GARRISON_LEVEL_DEFAULT } from '../data/invasion/garrison.js';
// 게스트 첫 부팅의 출발점(중반 진행 프리셋). 구글 계정은 이 경로를 타지 않는다.
import { guestPresetProfile } from './save/guestPreset.js';
// 서버가 정본인 축(촉매·설계도·방어체·배치·순위·의뢰서)의 게스트 시드. 서버가 1회성을 지킨다.
import { seedGuestAccount } from './net/guestSeed.js';
import { settleRun, grantXp } from './save/settlement.js';
import type { SettlementOutcome } from './save/settlement.js';
// M4 네트워크 계층(Phase B3): Supabase 미설정 시 완전 no-op, 절대 throw 안 함.
// 정산 시점에서만 fire-and-forget 로 호출 — sim/게임루프와 무관(결정론·오프라인 우선).
import {
  migrateLocalProfileToServer,
  recordPveRunResult,
  settlePveRunCurrency,
  grantCurrencyToServer,
  isNetConfigured,
  pushProfileToServer,
  consumeCatalystsOnServer,
  fetchCatalystInventoryOnline,
  grantCatalystDrops,
  setHarnessCatalystGateway,
  markCommissionActiveOnServer,
  submitCommissionRun,
  flushPendingCommissionSubmissions,
  pullServerProfileInto,
  claimDailyRewardOnServer,
  flushPendingDailyRewardDeliveries,
  type DailyRewardNetDeps,
  fetchCommissionGrantsOnline,
  fetchCommissionInventoryOnline,
  markCommissionGrantAppliedOnline,
  beginPveRunOnServer,
  grantRunDropsOnServer,
  fetchPendingItemGrantsOnServer,
  markItemGrantAppliedOnServer,
} from './net/index.js';
// 서버 드랍 배송(원장 → 세이브) — ADR-0050 §3 단계 1. 발급은 서버가 하고 배송은 클라만 할 수
// 있다(`items` 테이블에 클라가 한 줄도 안 쓴다 — itemGrantDelivery.ts 머리 참조).
import { deliverItemGrants } from './run/itemGrantDelivery.js';
import type { ItemGrantDeliveryReport } from './run/itemGrantDelivery.js';
import { newlyIssuedCommissions } from './run/commissionIssueDiff.js';
// 의뢰 확정 지급물 배송(발급 원장 → 세이브). 발급은 서버가 하고 배송은 클라만 할 수 있다 —
// `items` 는 클라 rw 미러라 서버가 심을 자리가 없다(commissionGrantDelivery.ts 머리 참조).
import { deliverCommissionGrants } from './run/commissionGrantDelivery.js';
// 구글 로그인(로그인 필수 정책). 미설정이면 전부 no-op 이고 DEV 는 게이트만 꺼진다.
// 이 모듈은 SDK 를 함수 안에서 동적 import 하므로 여기서 정적으로 끌어도 초기 청크가 안 는다.
import {
  isLoginConfigured,
  getSignedInUser,
  signInWithGoogle,
  signInAsGuest,
  signOut,
} from './net/auth.js';
// 계정이 바뀌면 로컬 계정 데이터를 버린다(재화 이전 경로 차단).
import { reconcileAccountScope, clearAccountScope, accountStore } from './net/accountScope.js';
// 의뢰서 시스템 Phase E — 서버 원장 payload → `WorldConfig` 형태 변환(sim 입력이 아닌
// rewards 를 뺀다). 봉인 로드아웃은 지시 수신소 화면이 출격 시점에 직접 계산해 싣는다.
import { commissionRunConfigFromPayload } from './run/commission.js';
import type { CommissionGrade, CommissionPayload } from './run/commission.js';
import type { Rarity } from './items/types.js';
import { commissionXpReward } from './run/commissionConstants.js';
// 행성 인기 배율(ADR-0038): 30분 폴링 캐시. 출격 경로를 블로킹하지 않는 **동기** 리더만 쓴다.
import {
  startPlanetMultiplierPolling,
  currentMultipliers,
  multCentiFor,
} from './net/planetMultipliers.js';
// 촉매 시스템(ADR-0029, Lane 4): 드랍 파생(순수) + 출격 폴백 모달.
import { catalystDropsFromRun, catalystDropMultFromContributions } from './data/catalystDrops.js';
import { normalizeCatalystArray, catalystById, catalystIconKey } from './data/catalysts.js';
import { resolveResonance } from './data/catalystResonance.js';
import { planetById } from '../data/planets.js';
import { catalystName, resonanceName, resonanceTierLabel } from './ui/catalystText.js';
import { uiAssetUrl } from './ui/pixi/uiTextures.js';
import { CatalystSortieModal } from './ui/pixi/catalystSortieModal.js';
// M4 침공(비동기 PvP) 제출: 미설정 시 submitInvasion 은 null(잠정 결과만 표시).
import {
  submitInvasion,
  buildClientResult,
  maintenanceToCenti,
  beginInvasion,
  setInvasionSticker,
} from './net/invasion.js';
import type { InvasionTarget } from './net/invasion.js';
// M7b 방어체 경제: 설계도 지급(정산 파생) + 보관함·강화 게이트웨이 팩토리 등록.
import { grantBlueprintDrops } from './net/blueprints.js';
import { setDefenseUnitsGatewayFactory, setDefenseUnitsGatewayOverride } from './net/defenseUnits.js';
import { setLineageGatewayFactory } from './net/lineage.js';
import { readSupabaseConfig } from './net/config.js';
// M7a 침공 3레이어(ADR-0017): 침공 런은 구 단일 아레나 `WorldConfig.invasion` 이 아니라
// `invasion3`(L1 대기권 → L2 회랑 → L3 코어방) 로 만든다. 두 필드를 함께 지정하면 방어
// 배치가 이중 스폰되므로 **한쪽만** 쓴다.
import {
  INVASION_TOTAL_TICKS,
  MAINTENANCE_FULL,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
} from './sim/invasion/index.js';
import type { Invasion3Config, InvasionDensity } from './sim/invasion/index.js';
import type { CoreModuleConfig } from './sim/moduleEffects.js';
import type { ModuleInstance } from '../data/coreModules.js';
// M4 Phase F: 도발 스티커(F2) + 재생 오버레이(F3 UI). 서버 침공 관전(상대 리플레이 로드)은
// ADR-0050 으로 폐지됐지만, 재생 오버레이 자체는 **하네스 로컬 리플레이 재생**(cheatPanel.ts
// `playReplay`)이 그대로 재사용한다 — 자기가 방금 돈 런을 재생·해시 검증하는 디버그 기능이라
// 서버 제출과 무관하다(주석 근거: `beginSpectate` 아래 참조).
import { SpectateOverlay, isPlayableReplay, nextSpectateSpeed } from './ui/replaySpectate.js';
import type { SpectateSpeed } from './ui/replaySpectate.js';
import { StickerPicker } from './ui/stickerPicker.js';
import type { Replay } from './sim/replay.js';
// M5 Phase C: 사운드(C1)·정산 완성판(C2)·로컬라이즈(C3). 전부 render/UI 레이어(sim 무수정).
import { GameAudio } from './render/audio.js';
import { RunSoundObserver, DropObserver } from './render/soundScape.js';
import { BossWarnLoop, bossWarnSuppressed } from './render/bossWarn.js';
import { MusicDirector, type MusicZone } from './render/musicDirector.js';
import { setUiAudio } from './render/uiSound.js';
import { SettingsScreen } from './ui/pixi/settingsPanel.js';
import { t } from './i18n/index.js';
import { totalCombatPower } from './save/combatPower.js';
import type { ResultDrop } from './ui/resultOverlay.js';
import type { Item } from './items/types.js';

/**
 * 실물 아이템 → 정산 화면의 '획득 장비' 칩 1개.
 *
 * **두 경로가 공유한다**: 로컬 롤(오프라인)의 `settleRun` 산출물과, 서버 권위 모드의 배송
 * 산출물. 예전에는 전자만 있어 매핑이 `resultOverlay.show(...)` 안에 인라인으로 있었고,
 * 그래서 서버 경로에는 '획득 장비'가 아예 존재하지 않았다(사용자 신고 2026-08-09).
 * 같은 화면 항목을 두 벌로 적으면 다시 갈리므로 한 자리에 둔다.
 *
 * `item` 을 통째로 싣는 이유는 hover 툴팁이 어픽스·요구 레벨·전투력까지 읽기 때문이다
 * (사용자 요청 2026-07-26). 표시 전용이라 sim·세이브와 무관하다.
 */
function resultDropOf(it: Item): ResultDrop {
  return {
    rarity: it.rarity,
    slot: it.slot,
    ...(it.weaponType !== undefined ? { weaponType: it.weaponType } : {}),
    item: it,
  };
}

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
  /**
   * 일일 보상 모의 주입기(DEV 전용). 프로덕션에서는 `null` 이고 동적 import 가 통째로 제거된다.
   *
   * ⚠️ **꺼져 있으면 반드시 `{}` 를 내야 한다** — `{ gateway: undefined }` 를 내면
   * `resolveDailyRewardGateway` 의 `!== undefined` 검사를 통과해 **꺼진 모의가 실서버를
   * 조용히 가린다.** 이 리포에 정확히 그 형상의 전례가 있다(모의가 config 보다 먼저 적용).
   * 그래서 판단을 여기서 하지 않고 모의 모듈의 `harnessDailyRewardDeps()` 하나에 맡긴다.
   */
  let dailyRewardDeps: (() => DailyRewardNetDeps) | null = null;
  if (harnessActive) {
    const core = await import('./harness/core.js');
    core.setProfileStoreOverride(core.harnessProfileStore());
    const mock = await import('./harness/dailyRewardMock.js');
    dailyRewardDeps = () => mock.harnessDailyRewardDeps();
  }
  /** 모의가 없으면 `{}` — net 계층이 config 로 실경로를 해석한다(현행 동작과 동일). */
  const dailyDeps = (): DailyRewardNetDeps => dailyRewardDeps?.() ?? {};

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
  /**
   * ⚠️ **꺼진 채로 태어나야 한다.**
   *
   * 표시 여부의 단일 권위는 렌더 루프인데(아래 `arenaScreen` 블록), 그 루프는 이 줄에서
   * 한참 뒤 `gameApp.app.ticker.add(...)` 로야 붙는다. 그 사이에는 텍스처·프로필·인증 로드가
   * **await 로 줄줄이** 걸려 있어 실시간으로 수 초가 지나간다. `TilingSprite` 의 `visible`
   * 기본값은 `true` 라, 그 구간 내내 캔버스에 아레나 타일이 깔린 채 부팅 화면이 서 있었다
   * (사용자 신고 2026-08-04 — "F5 누르면 아직 아레나 타일 보여". 첫 프레임 플래시가 아니라
   * **로드가 끝날 때까지 계속** 보이는 것이 핵심이다).
   *
   * 첫 프레임에 켜야 하는 상태(런 재개 등)라면 루프가 그때 켜 준다 — 기본값을 끔으로 두는
   * 쪽이 항상 안전하다. Wang 지형(`AutotileBackground`)은 이미 생성자에서 `layer.visible`
   * 을 `false` 로 두고 있다(같은 이유).
   */
  background.visible = false;
  gameApp.stage.addChild(background);
  // Wang autotile terrain floor (render-only). Sits above the flat TilingSprite
  // fallback and below entities. Each run's planet tileset + seed is applied in
  // `startRun`; a planet with no bundled tileset keeps the TilingSprite backdrop.
  const autotile = new AutotileBackground();
  const invasionBackdrop = new InvasionBackdrop(textures, DESIGN_WIDTH, DESIGN_HEIGHT);
  invasionBackdrop.visible = false;
  gameApp.stage.addChild(autotile.layer);
  // 행성 환경 레이어 스택(카르곤 AAA 배경). 슬롯 컨테이너 4개만 여기서 stage 깊이에 끼우고,
  // 실제 레이어 등록은 planetEnvironment.ts 의 레지스트리 한 곳에서 한다 — "모듈은 있는데
  // 아무도 안 쓰는" 조용한 배선 결손이 구조적으로 불가능해진다.
  const env = new PlanetEnvironment();
  // far 는 지형 바닥(autotile) **뒤**여야 하므로 이미 붙은 autotile 아래 인덱스로 끼운다.
  gameApp.stage.addChildAt(env.slot('far'), gameApp.stage.getChildIndex(autotile.layer));
  gameApp.stage.addChild(env.slot('floor'));
  // 침공 3레이어 배경 — **지형·환경 위, 엔티티 아래**. 예전에는 flat TilingSprite 바로 위·
  // autotile 아래였고, 그 깊이의 근거는 "침공은 `autotile.configure(null, …)` 로 Wang 바닥을
  // 끄므로 순서 다툼이 없다"였다. 침공에도 Wang 지형을 켜면서 그 전제가 깨졌다 — Wang 타일은
  // 알파 255 불투명이라 예전 깊이에 두면 배경 3종과 전환 연출이 통째로 가려진다.
  // 그래서 이 레이어는 배경이 아니라 **페이즈 전환 베일**이 됐다(평상시 `view.alpha = 0`,
  // 전환 45틱 동안만 떠올라 타일셋 스왑의 하드 컷을 가린다 — `invasionBackdrop.ts` 머리말).
  // 엔티티 **아래**인 이유: 베일이 절정일 때도 함선·탄·적은 가려지면 안 된다.
  gameApp.stage.addChild(invasionBackdrop.view);
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
  // 침공 페이즈별 지형(L1 대기권 · L2 회랑 · L3 코어방). 행성 인덱스가 아니라 페이즈 코드로
  // 인덱싱한다 — 침공 런의 `config.planet` 은 항상 0(카르곤)이라 행성 축을 쓰면 화면이 틀린다.
  const invasionWangTiles: (WangTiles | null)[] = await Promise.all([
    loadInvasionWangTiles(PHASE_L1),
    loadInvasionWangTiles(PHASE_L2),
    loadInvasionWangTiles(PHASE_L3),
  ]);
  const entityRenderer = new EntityRenderer(textures);
  gameApp.stage.addChild(entityRenderer.layer);
  // 전경 대기(엔티티 위) → 화면 그레이딩(최상단). 레이더·HUD 는 이 뒤에 붙어 그레이딩 위에
  // 남는다 — 게임플레이 정보는 절대 톤 보정에 먹히지 않는다.
  gameApp.stage.addChild(env.slot('over'));
  gameApp.stage.addChild(env.slot('post'));

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

  /**
   * 이번 런의 조우 유형을 렌더러에 먹인다(ADR-0033 아트 배선). **render 직전에 반드시** 부른다.
   *
   * 왜 필요한가: 봉인 수호자는 신규 `EntityKind` 를 만들지 않고 보물 격실 포탈과 **같은 kind**
   * 를 쓴다(`src/sim/encounter.ts`: `KIND_CODE` 는 append-only 해시 계약). 그래서 렌더가 포탈
   * 아트와 봉인석 아트를 가르는 유일한 근거가 `encounterRuntime.type` 이다. 스냅샷에 실어
   * 보내려면 sim 파일을 고쳐야 하므로(이 레인은 render-only) 여기서 imperative 로 넘긴다 —
   * 레벨업 링(`pulseLevelUp`)과 같은 규율이다. 조우 미발생·침공 런은 0 이라 무영향.
   *
   * 호출 지점이 둘(정규 렌더 루프·하네스 renderOnce)이라 한 함수로 묶어 둔다 — 한쪽만 배선하는
   * 것이 이 저장소의 반복 결함이다.
   */
  function syncEncounterArt(): void {
    entityRenderer.setEncounterType(world === null ? 0 : encounterTypeOf(world));
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
  // ⚠️ 이관·의뢰 회수는 **세션이 생긴 뒤**에 돌린다(`bootWithAuth`). 로그인 필수로 바뀌면서
  // `getUserId()` 가 익명 계정을 만들어 주지 않으므로, 부팅 즉시 부르면 전부 throw → catch →
  // 조용한 no-op 이 되고 로그인 후에는 아무도 다시 부르지 않는다.
  // 행성 인기 배율표 폴링 시작(ADR-0038). 즉시 1회 + 30분 간격. 미설정·실패는 전 행성 1.0
  // 폴백이라 오프라인 단일플레이가 그대로다(출격 경로는 이 결과를 기다리지 않는다).
  startPlanetMultiplierPolling();
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
    // 계보·수호 게이트웨이 팩토리 등록(ADR-0007 서버 권위). 규율은 위 방어체와 동일하되
    // **거동이 다르다**: 등록 전에는 계보 화면이 no-op 이 아니라 조작을 **잠근다**(계보 소비는
    // 되돌릴 수 없어 낙관적 진행이 불가능하다 — net/lineage.ts 헤더). 그래서 설정이 있는데
    // SDK 로드가 실패하면 사용자에게 오프라인으로 보이는 것이 맞다.
    void import('./net/guardianGateway.js')
      .then((m) => {
        setLineageGatewayFactory((config) => new m.SupabaseGuardianGateway(config));
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
  // 일일 보상 모달의 호스트. 다른 메타 화면과 **같은 stage** 에 붙어야 위로 그려진다.
  // 미등록 상태에서 show 를 부르면 모달 모듈이 던진다 — 조용히 no-op 하면 그날 통지가
  // 통째로 사라지고 아무도 모르기 때문이다(그쪽 모듈 주석의 근거).
  setDailyRewardModalHost(gameApp.stage);
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
  // ⚠️ 여기 있던 **메타 화면 전환 커튼**(AC-5.1 / ADR-0031, 슬라이드 와이프)은 모듈째 제거했다
  // (사용자 지시 2026-08-04: "화면 전환 효과 없애줘"). 커튼은 swap 을 은닉하지 않는 순수 장식
  // 와이프였고(teardown + 새 화면 show 가 같은 프레임에 동기 완결이라 swap 은 원래 원자적이다),
  // 화면이 바뀔 때마다 판이 한 장 쓸고 지나가는 것이 전환을 읽히게 하기보다 거슬렸다.
  // 되살릴 일이 생기면 `src/render/` 의 삭제 커밋을 git 이력에서 꺼내면 된다 — 배선 지점은
  // 셋뿐이었다(여기 mount · clearToMenu 트리거 · 렌더 루프 진행/raise).
  // 카툰나무풍 롤아웃 #6: DOM `ControlTower` 대신 Pixi 캔버스 관제탑으로 교체(show/hide/
  // visible + 콜백·옵션 타입 동일). 다른 캔버스 화면과 같은 블록에서 만들어야
  // entityRenderer·radar 레이어보다 **뒤에** stage 에 붙어 위로 그려진다(z 순서).
  const controlTower = new ControlTowerScreen(gameApp.stage);
  // 스토리 시스템 Phase C2/C3: 기록 보관소(서사 열람 시설) + 세계관 인트로 슬라이드. 다른 캔버스
  // 화면과 같은 블록에서 만들어야 entityRenderer·radar 레이어보다 뒤에 붙어 위로 그려진다(z 순서).
  const recordsArchive = new RecordsArchiveScreen(gameApp.stage);
  const introSlides = new IntroSlidesScreen(gameApp.stage);
  // 의뢰서 시스템 Phase E: 지시 수신소. 다른 캔버스 화면과 같은 블록에서 만들어야
  // entityRenderer·radar 레이어보다 **뒤에** stage 에 붙어 위로 그려진다(z 순서).
  const commissionDesk = new CommissionDeskScreen(profile, gameApp.stage);
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
  // M4 Phase F: 도발 스티커 선택(F2) + 재생 컨트롤 오버레이(F3 UI, 하네스 로컬 재생이 재사용).
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
  // 보스 예고 루프(사용자 지시 2026-08-05). 런 경계마다 soundObserver 와 함께 리셋한다 —
  // 기준선을 안 버리면 다음 런 첫 프레임에 밀린 만큼 몰아서 운다.
  const bossWarn = new BossWarnLoop(audio);
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
  /**
   * 마지막으로 **끝난** 런의 리플레이(DEV 하네스 리플레이 재생용). `recorder` 는 다음 런
   * 시작에서 즉시 갈리므로 종료 시점의 것을 따로 잡아 둬야 "방금 돌린 침공을 되돌려 본다"가
   * 성립한다. 읽는 곳은 하네스 호스트 훅(`getLastReplay`)뿐이다.
   */
  let lastFinishedReplay: Replay | null = null;
  /**
   * 그 런이 끝난 시점의 월드 해시(hex 8자리). {@link lastFinishedReplay} 와 **짝**이며
   * 하네스 `verifyReplay` 의 기준선이다 — 리플레이 자체는 해시를 담지 않으므로 이 값이
   * 없으면 재실행 결과를 대조할 대상이 없다(검증이 아니라 해시 출력이 된다).
   */
  let lastFinishedHash: string | null = null;
  let currentSeed = 0;
  let settled = false;
  let lastOutcome: SettlementOutcome | null = null;
  let prevSnap: WorldSnapshot = emptySnap;
  let currSnap: WorldSnapshot = emptySnap;
  let accumulator = 0;
  let frameCount = 0;
  /**
   * 직전 프레임의 추격 **대피소 확보 수**(-1 = 기준선 없음 — 런 밖이거나 다른 모드). 확보 알림은
   * 이 값이 **올라간 프레임**에만 뜬다. 런이 바뀌면 -1 로 되돌려 새 런 첫 프레임에서 오발하지
   * 않게 한다(2026-08-05 재설계 전에는 세그먼트 인덱스였다 — `shelterArrivalMessage` 주석).
   */
  let lastChaseSegment = -1;
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

  // --- 의뢰서 시스템(Phase E) 런 상태 ---
  // 현재 런이 의뢰 런이면 `consume_commission` 이 발급한 `commission_runs.run_id`. `endRun`
  // 이 이 값으로 `verify-commission` 을 제출한다 — `w.config.commission.commissionId` 는
  // 종이(카탈로그) id 이지 이 값이 아니다(별도 축). `startCommissionRun` 이 세우고
  // `submitCommissionReplay` 가 제출 직전에 지운다(재진입 방지 — 그 함수가 유일한 소비자다).
  let commissionRunId: string | null = null;
  /**
   * 그 런의 **봉인된 종이**. 확정 경험치(`commissionXpReward`)는 서버가 `verified` 를 낸 **뒤에**
   * 지급하는데, 그 시점에는 월드도 지시 수신소도 이미 사라져 payload 를 되찾을 곳이 없다.
   * `commissionRunId` 와 **같은 자리에서 세우고 같은 자리에서 지운다** — 둘이 갈리면 "런 id 는
   * 있는데 종이가 없다"가 되어 경험치만 조용히 증발한다.
   */
  let commissionPayload: CommissionPayload | null = null;

  // --- 리플레이 재생 상태(F3 UI) ---
  // ⚠️ **서버 침공 관전(상대 리플레이를 서버에서 받아 보는 기능)은 ADR-0050 으로 폐지됐다** —
  // "방어자는 자신이 어떻게 졌는지 볼 수 없다"(ADR-0050 §결과). 이 상태·`beginSpectate`가 아직
  // 남아 있는 이유는 **하네스 로컬 재생**(cheatPanel.ts `playReplay` — 방금 돈 자기 런을 재생·
  // 해시 검증하는 디버그 기능)이 같은 렌더 경로를 그대로 쓰기 때문이다. spectateReplay !== null
  // 이면 현재 화면은 재생 중이다 → ticker 가 리플레이 입력을 주입하고, 정산/레벨업 오버레이/
  // 제출 경로를 모두 건너뛴다(월드는 markTainted 됨).
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

  /**
   * 이번 PvE 런의 **드랍 원장 런 id**(ADR-0050 §3 단계 1). `begin_pve_run` 이 발급하며 서버가
   * 그때 `started_at` 을 찍는다 — 그 시각이 드랍 개수 캡의 분모다(클라가 못 만지는 유일한 시계).
   *
   * ⚠️ `WorldConfig.runId` 와 **다른 것이다.** 그쪽은 촉매 소모 영수증 id 이고
   * (`run/runConfig.ts:63-66`) `settle_pve_run` 이 그 id 로 영수증을 조회해 자원 배율을 연다.
   * 여기에 드랍 런 id 를 넣으면 영수증이 없는 행을 조회하게 되어 **촉매 배율이 조용히 죽는다.**
   * 그래서 촉매 런은 pve_runs 행을 둘 갖는다(begin 행 · consume 행) — 의도된 설계다
   * (`20260808000000_pve_run_registration.sql` §consume_catalysts 를 고치지 않는다).
   *
   * `null` = 미설정·오프라인·캡 초과 → 정산이 **로컬 롤**로 강등한다(오프라인 플레이 보존).
   * sim 은 이 값을 읽지 않는다 — 순수 메타라 `WorldConfig` 에 넣지 않고 런 상태로만 든다.
   */
  let dropRunId: string | null = null;

  /**
   * 드랍 런 등록의 세대 토큰. `startRun` 이 올린다 — 늦게 도착한 `begin_pve_run` 응답이
   * **다음 런의 id 를 덮어쓰는 것**을 막는 유일한 장치다(그러면 그 런의 드랍이 지난 런에 적힌다).
   */
  let dropRunToken = 0;

  /**
   * **런 시작 시점의 의뢰서 재고 id 집합** — 이번 런에 발령된 의뢰서를 가려내는 기준선
   * (사용자 요청 2026-08-09).
   *
   * 발령은 서버 `pve_runs` AFTER 트리거(`issue_commission_for_run`)라 정산 응답에 안 실리고,
   * 발령 원장(`commission_issues`)은 RLS 정책이 0개라 클라가 **읽을 수 없다**(상한 타이밍
   * 노출 방지 — 20260803000000 §2 주석). 남는 길은 읽을 수 있는 `commission_inventory` 의
   * 전후 차집합뿐이다.
   *
   * `null` = 기준선 없음(오프라인·조회 실패·아직 도착 전) → **차집합을 계산하지 않는다.**
   * 기준선 없이 빼면 재고 전체가 이번 런 발령분이 되어 화면이 정면으로 거짓을 말한다.
   * `dropRunToken` 과 같은 세대 가드를 쓴다 — 늦게 온 응답이 다음 런의 기준선이 되면 안 된다.
   */
  let commissionIdsAtRunStart: ReadonlySet<string> | null = null;

  /** 화면 안 판정용 뷰 반폭(월드 단위). entityRenderer 가 월드↔디자인px 를 1:1 로 그려(줌 없음). */
  const VIEW_HALF_WIDTH = DESIGN_WIDTH / 2;

  /** 화면 이름 → BGM 존(AC2·AC3·AC5). `result` 는 정산 스팅어가 음악을 소유하므로 null(존 미변경). */
  function zoneForScreen(name: string): MusicZone | null {
    switch (name) {
      case 'run':
        return currentRunKind === 'invasion' ? 'invasion' : 'combatPvE';
      case 'spectate':
        return 'invasion'; // 하네스 로컬 재생(F3 UI 재사용)도 같은 존을 쓴다.
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
    // 런 중 침공 정보판은 런에서만 뜬다. DOM HUD 는 화면 전환으로 자동으로 사라지지 않으므로
    // (스크린 개념이 캔버스 쪽에만 있다) 여기서 명시적으로 내린다 — 안 그러면 정산·성계 지도
    // 위에 직전 런의 행성/촉매가 그대로 남는다.
    if (name !== 'run') hud.setRunInfo(null);
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
      case 'commission':
        openCommissionDesk();
        break;
      // inventory/research/refinery/defense 는 각 오버레이가 자체 콜백으로 기지 복귀하므로
      // 언어 전환 즉시 반영은 다음 진입 때 이뤄진다(안전한 기본 동작).
      default:
        break;
    }
  }

  /** Clear the live run + all menu overlays (called before every screen swap). */
  function clearToMenu(): void {
    // 일일 보상 모달은 기지 위 오버레이라 화면이 바뀌면 함께 내려야 한다. 안 내리면 다른
    // 화면 위에 통지가 그대로 앉는다 — `openBaseMap` 도 이 함수를 지나므로 여기 한 곳이면
    // 진입 경로 전부가 덮인다(모달 표시는 그 뒤 `maybeOpenDailyReward` 가 다시 결정한다).
    hideDailyRewardModal();
    // (여기 있던 전환 커튼 트리거는 제거했다 — 위 mount 자리의 주석 참조.)
    world = null;
    recorder = null;
    prevSnap = emptySnap;
    currSnap = emptySnap;
    accumulator = 0;
    // 런의 **월드 표현**도 여기서 함께 내린다. `world = null` 만으로는 아무것도 안 걷힌다 —
    // 지형·환경·그림자는 world 가 아니라 각자의 배선이 수명을 쥐고 있고, 그 배선을 푸는 곳이
    // 지금까지 런 시작(`startRun`/`startInvasionRun`)과 관전 진입뿐이었다. 그래서 런을 마치고
    // 메뉴로 나가면 Wang 타일 714장과 환경 레이어 5장이 **불투명 메뉴 뒤에서 매 프레임 계속
    // 갱신·렌더되고**, 사라진 엔티티의 접지 그림자가 바닥에 남았다(하네스 실측).
    //
    // (평면 배경·Wang 지형의 **표시 여부**는 여기서 손대지 않는다 — 렌더 루프가 화면 이름에서
    //  매 프레임 도출하는 단일 권위로 옮겼다. 여기서 하는 일은 지형 **설정**을 비우는 것이다.)
    //
    // 이 파일이 같은 종류의 결함을 이미 두 번 기록해 뒀다(아래 레벨업·조우 오버레이 주석) —
    // "런 전용인데 화면 전환에서 안 걷히는 것"이다. 관전 진입 경로가 쓰는 것과 **같은 3종 세트**를
    // 여기서도 부른다.
    autotile.configure(null, 0);
    env.disable();
    entityRenderer.setEnvPlanet(null);
    // 의뢰 런 상태 방어적 리셋 — 정상 경로는 `submitCommissionReplay` 가 이미 소비·정리했겠지만
    // (예: 하네스 goto 로 정산 없이 벗어난 경우) 다음 무의뢰 런으로 새는 것을 막는다.
    commissionRunId = null;
    commissionPayload = null;
    // 접지 그림자·스프라이트 캐시 회수. 그림자는 스프라이트의 자식이 아니라 형제라 부모
    // destroy 로 걷히지 않는다 — 명시 회수 경로 넷 중 하나가 이것이다.
    entityRenderer.reset();
    clearInvasionBackdrop();
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
    commissionDesk.hide();
    spectateOverlay.hide();
    stickerPicker.hide();
    spectateReplay = null; // 재생 종료(화면 전환 시 항상 해제)
    titleScreen.hide();
    // 레벨업 오버레이는 런 종료(정산) 경로에서만 숨겨 왔다 — 런을 정산 없이 벗어나면
    // (하네스 goto 등) 메뉴 화면 위에 남는다. 런 전용 UI 이므로 화면 전환에서도 숨긴다.
    if (powerupOverlay.visible) powerupOverlay.hide();
    // 조우 프롬프트도 런 전용 UI 다. 렌더 루프가 매 프레임 재도출하므로 보통은 저절로
    // 사라지지만, 화면 전환과 다음 프레임 사이에 프롬프트가 남는 한 프레임을 없앤다.
    encounterOverlay.hide();
    // 런 이탈 버튼도 런 전용 UI 다. **끄는 것을 여기 하나로 몰아 둔 것이 핵심 안전장치**다 —
    // 켜는 곳은 시험 침공 한 곳뿐이고, 모든 런 진입점이 첫 줄에서 clearToMenu 를 부르므로
    // "정식 런에 이탈 버튼이 남는" 경로가 구조적으로 없다(진입점마다 끄게 두면 하나 빠뜨리는
    // 순간 정산을 건너뛰고 빠져나가는 길이 열린다).
    hud.setExitRun(null);
    shownLevel = 0;
  }

  /**
   * 다음 타이틀 표시 때 1회 보여줄 안내(로그인 시작 실패). 표시하면서 비운다 — 남겨 두면
   * 사용자가 화면을 오간 뒤에도 낡은 실패 문구가 계속 붙는다.
   */
  let titleNotice: string | undefined;

  /**
   * Title screen — first launch forces the tutorial; afterwards it enters base.
   *
   * `needsSignIn` 이면 같은 자리의 버튼이 "Google 로 계속하기"가 되고, 누르면 페이지가 구글로
   * 떠난다(돌아오면 부팅이 처음부터 다시 돈다). 리다이렉트가 **시작조차 못 한 경우**에만
   * 이 함수가 다시 불려 안내를 띄운다.
   */
  function openTitle(needsSignIn = false): void {
    clearToMenu();
    setScreen('title');
    const notice = titleNotice;
    titleNotice = undefined;
    titleScreen.show({
      firstRun: !profile.tutorialDone,
      needsSignIn,
      notice,
      onStart: () => {
        // The start click is the FTUE input (the 60s / 4min clock starts here).
        ftue.markInput();
        if (!profile.tutorialDone) startTutorial();
        else openBaseMap();
      },
      onSignIn: () => {
        void signInWithGoogle().then((failure) => {
          // null = 리다이렉트가 시작됐다. 이 페이지는 곧 사라지므로 아무것도 하지 않는다.
          if (failure === null) return;
          titleNotice = t('title.signInFailed');
          openTitle(true);
        });
      },
      /**
       * 게스트 — 구글과 달리 **페이지를 안 떠난다.** 세션이 그 자리에서 생기므로 부팅을 다시
       * 돌려야 하는데, `bootWithAuth()` 를 그냥 다시 부르면 이미 그려진 타이틀·프로필 객체가
       * 남은 채 두 번째 부팅이 겹친다. 새로고침이 그 전부를 빠뜨림 없이 없앤다 —
       * `handleSignOut` 이 같은 이유로 같은 선택을 했다.
       */
      onGuestSignIn: () => {
        void signInAsGuest().then((failure) => {
          if (failure !== null) {
            titleNotice = t('title.guestFailed');
            openTitle(true);
            return;
          }
          if (typeof location !== 'undefined') location.reload();
        });
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

  /**
   * 연속 접속일의 **클라 사본**(표시 전용). 정본은 서버 봉인 컬럼 `profiles.daily_streak` 이고
   * 여기 값은 수령 응답으로만 갱신된다 — 클라가 스스로 세면 그것이 곧 램프 무력화다.
   * 0 = "아직 받아 오지 못했다"이며 칩은 그 상태를 `-/30` 으로 그린다(0일차와 구별한다).
   */
  let dailyStreak = 0;
  /** 마지막 수령 응답. 헤더 칩의 재열람이 **같은 모달**을 다시 여는 근거다. */
  let lastDailyClaim: Awaited<ReturnType<typeof claimDailyRewardOnServer>> extends infer O
    ? O extends { status: 'ok'; claim: infer C }
      ? C | null
      : never
    : never = null;

  /**
   * 서버 문자열 → 축 유니온. 모르는 값은 `null` 이다.
   *
   * 좁히지 않고 캐스팅하면 슬라이스 2 가 축을 늘렸는데 클라가 낡은 번들일 때 `daily.axis.<모르는 축>`
   * 키 조회가 빈 문자열이 되어 **이름 없는 보상**이 표시된다. 그때는 차라리 폴백 라벨이 낫다.
   */
  function narrowDailyAxis(axis: string): DailyRewardAxis | null {
    return (DAILY_REWARD_AXES as readonly string[]).includes(axis)
      ? (axis as DailyRewardAxis)
      : null;
  }

  /** 서버 문자열 → 등급 유니온. 위와 같은 이유로 캐스팅하지 않는다(`item.rarity.<모르는 값>`). */
  function narrowRarity(rarity: string | null): Rarity | null {
    if (rarity === 'normal' || rarity === 'magic' || rarity === 'rare' || rarity === 'unique') {
      return rarity;
    }
    return null;
  }

  /**
   * 수령 응답 → 모달 데이터.
   *
   * ⚠️ **예고(`tomorrow`)에는 굴림 값을 넣지 않는다**(AC-21). 서버가 `next` 에 종류·등급·계급만
   * 실어 주므로 여기서 더 넣을 것이 없고, 모달 레이아웃도 예고 자리의 어픽스·사용 횟수를
   * 버리도록 돼 있다 — 두 겹이다.
   */
  function toDailyRewardModalData(claim: {
    streak: number;
    result: {
      axis: string;
      credits: number;
      minerals: number;
      rarity: string | null;
      grade: number | null;
      count: number | null;
      step: { index: number; total: number } | null;
    } | null;
    next: { axis: string; rarity?: string; grade?: number } | null;
  }): DailyRewardModalData {
    const axis = narrowDailyAxis(claim.result?.axis ?? '') ?? 'currency';
    // ⚠️ **주 보상의 등급·계급·개수를 함께 싣는다**(슬라이스 2). 안 실으면 여섯 축이 전부
    //    *"<축 이름> · 크레딧 N"* 으로 보인다 — 그 크레딧은 곁들이와 예산 보정분이라 축과
    //    무관하게 늘 있고, 결국 화면이 "오늘 무엇을 받았는가"를 말하지 못한다.
    const r = claim.result;
    const today: DailyRewardModalSubject = {
      axis,
      ...(r !== null ? { credits: r.credits, minerals: r.minerals } : {}),
      ...(r !== null && narrowRarity(r.rarity) !== null ? { rarity: narrowRarity(r.rarity)! } : {}),
      ...(r !== null && r.grade !== null
        ? { grade: Math.min(4, Math.max(1, r.grade)) as CommissionGrade }
        : {}),
      ...(r !== null && r.count !== null && r.count > 1 ? { count: r.count } : {}),
    };
    const nextAxis = claim.next === null ? null : narrowDailyAxis(claim.next.axis);
    const step = claim.result?.step ?? null;
    return {
      streak: claim.streak,
      today,
      sideCredits: DAILY_SIDE_CREDITS,
      ...(nextAxis !== null ? { tomorrow: { axis: nextAxis } satisfies DailyRewardModalSubject } : {}),
      ...(step !== null ? { step } : {}),
    };
  }

  /**
   * 일일 보상 — 그날 첫 기지 진입에 수령하고 통지한다 (ADR-0048 · AC-18).
   *
   * ## 왜 여기 한 곳인가
   * 리포 교훈이 정본이다: *"레이어 표시는 진입 경로가 아니라 화면 이름 단일 권위."*
   * `openBaseMap()` 이 부팅 직행·런 종료 복귀·타이틀 진입·건물에서 뒤로·언어 전환
   * rerender·하네스 refresh 를 **전부 모으는 단일 지점**이라(호출부 18곳), 여기 하나만
   * 걸면 경로를 놓칠 자리가 없다. 경로별 처방은 실패해 재신고를 받은 전례가 있다.
   *
   * ## 세 가지 가드
   * ① **순수 판정** `shouldOpenDailyReward(마지막 표시 시드, 오늘 시드)` — 재진입 두 경로
   *    (`rerenderCurrentScreen` 언어 전환 · `harnessRefreshScreen`)에서 모달이 재발하지 않는다.
   * ② **비동기 창** — `openBaseMap` 은 동기이고 수령은 서버 왕복이다. 그 사이 격납고를
   *    누르면 `baseMap.hide()` 뒤에 응답이 도착해 **기지 없는 배경 위에 모달이 앉는다.**
   *    그래서 응답 도착 시점에 `currentScreenName === 'base'` 를 **다시** 확인한다.
   * ③ **표시 기록은 응답 뒤에** — 요청 전에 기록하면 실패한 날도 "봤다"가 되어 그날
   *    보상 예고를 영영 못 본다(수령 자체는 다음 진입에 다시 시도되므로 지급은 무사하다).
   *
   * 절대 throw 하지 않는다. 미설정·오프라인·EF 미배포면 조용히 아무 일도 없다.
   */
  function maybeOpenDailyReward(): void {
    const nowSeed = dailyDateSeed(Date.now());
    const wantModal = shouldOpenDailyReward(loadDailySeenSeed(), nowSeed);
    // 모달이 필요 없어도 **연속일을 한 번은 받아 와야** 헤더 칩이 값을 갖는다. 수령 RPC 는
    // 멱등이라(같은 `date_seed` 재호출은 지급 없이 기존 행을 돌려준다) 그 프라이밍에 그대로
    // 쓸 수 있다. `dailyStreak > 0` 이면 이미 받아 온 것이므로 왕복을 아낀다 — 안 그러면
    // 기지를 오갈 때마다(호출부 18곳) RPC 가 나간다.
    if (!wantModal && dailyStreak > 0) return;
    void (async () => {
      const outcome = await claimDailyRewardOnServer(profile, dailyDeps());
      if (outcome.status !== 'ok') return;
      // 수령은 프로필을 제자리에서 고친다(재대입 없음). 배송함 반영분까지 함께 굳힌다.
      saveProfile(profile);
      dailyStreak = outcome.claim.streak;
      lastDailyClaim = outcome.claim;
      if (currentScreenName !== 'base') return; // 가드 ②
      // 칩의 연속일이 방금 오른 값으로 다시 그려진다. 모달보다 **먼저** 세운다 —
      // 순서를 뒤집으면 `show` 가 만드는 새 컨테이너가 모달 위에 얹힌다.
      baseMap.show(profile, baseMapHandlers(), dailyRewardChipOptions());
      if (!wantModal) return;
      saveDailySeenSeed(nowSeed); // 가드 ③
      // 그날 첫 통지 — **개봉 연출을 튼다**(칩 재열람은 아래에서 끄고 부른다).
      //
      // 개봉음은 `playSample` 을 **직접** 부른다. `audio.play()` 를 쓰면 샘플이 없을 때 절차
      // 합성으로 떨어지는데, 이 리포는 절차 합성 SFX 가 전원 거부된 전례가 있다 — 파일이
      // 없으면 무음이 옳다(연출은 시각이 주다).
      showDailyRewardModal(toDailyRewardModalData(outcome.claim), undefined, {
        reveal: true,
        onOpenSound: () => {
          audio.playSample('dailyReward');
        },
      });
    })();
  }

  /**
   * 헤더 **연속 접속** 칩의 표시 옵션 (AC-20).
   *
   * `onDailyReward` 가 있어야 칩이 선다("갈 곳이 없으면 입구를 만들지 않는다" — baseMap 규약).
   * 그래서 아직 한 번도 수령 응답을 못 받았으면(`lastDailyClaim === null`) 칩을 세우지 않는다:
   * 눌러도 띄울 것이 없는 버튼을 두면 그것이 곧 죽은 입구다.
   */
  function dailyRewardChipOptions(): Parameters<typeof baseMap.show>[2] {
    if (lastDailyClaim === null) return {};
    const claim = lastDailyClaim;
    return {
      dailyStreak,
      dailyCycle: DAILY_STREAK_CYCLE,
      dailyLabel: t('daily.chip', { n: dailyStreak, max: DAILY_STREAK_CYCLE }),
      // 자동 모달과 **같은 모달**을 다시 연다(ADR-0048 §화면). 재열람이므로 표시 기록을
      // 건드리지 않는다 — 그날 첫 진입 판정은 이미 끝났다.
      onDailyReward: () => showDailyRewardModal(toDailyRewardModalData(claim)),
    };
  }

  /** Base map hub — the meta home. Buildings gate by unlock (plan D1/E2). */
  function openBaseMap(): void {
    clearToMenu();
    setScreen('base');
    baseMap.show(profile, baseMapHandlers(), dailyRewardChipOptions());
    maybeOpenDailyReward();
  }

  /** `openBaseMap` 과 일일 보상 재표시가 **같은 핸들러 묶음**을 쓰게 하는 자리. 두 곳에
   *  각각 적으면 건물 하나를 추가할 때 한쪽만 고쳐져 그 버튼이 조용히 죽는다. */
  function baseMapHandlers(): Parameters<typeof baseMap.show>[1] {
    return {
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
      onCommission: () => {
        baseMap.hide();
        openCommissionDesk();
      },
      onStarMap: () => openStarMap(),
    };
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
   * 지시 수신소(의뢰서 시스템 Phase E) — 보유 의뢰서 목록을 보고 그 자리에서 출격한다.
   * `onLaunch` 는 화면이 이미 자기 자신을 닫은 **뒤** 호출된다(성계 지도 self-hide 규약과 동일).
   */
  function openCommissionDesk(): void {
    clearToMenu();
    setScreen('commission');
    commissionDesk.show(profile, {
      onClose: () => openBaseMap(),
      onLaunch: (runId, payload) => startCommissionRun(runId, payload),
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
        // ⚠️ 서버 침공 관전은 ADR-0050 으로 폐지됐다 — 리플레이를 저장하지도 재실행하지도
        //    않으므로 재생할 원본이 없다. · 와 함께
        //     의 버튼·콜백까지 전부 제거했다(no-op prop 을 남기지 않는다).
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

  // 서버 침공 관전(startSpectate — invasionId 로 상대 리플레이를 서버에서 받아 재생)은
  // ADR-0050 으로 폐지됐다. 아래 `beginSpectate` 는 하네스 로컬 재생(cheatPanel.ts
  // `playReplay`) 전용 진입점으로 남는다.

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
    bossWarn.reset();
    dropObserver.reset();
    // 관전 아레나 배경(기본 배경, autotile 없음).
    const planet = world.config.planet ?? 0;
    background.texture = planetBackground(planet);
    autotile.configure(null, seed);
    env.disable();
    // 환경 레이어가 꺼진 화면에선 접지 그림자도 꺼진다 — 그림자만 남으면 없는 광원을 주장한다.
    entityRenderer.setEnvPlanet(null);
    clearInvasionBackdrop();
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
   * 침공 런 시작 — 레이어 배경을 페이드 없이 즉시 확정하고 전용 배경으로 갈아탄다.
   *
   * ⚠️ 예전에는 여기서 **행성 배경을 레이어마다 갈라 쓰는 폴백**이었다
   * (`INVASION_BACKDROP_PLANET = [2, 1, 3]`). `src/render/invasionBackdrop.ts` 는 M7a L10
   * 에서 이미 만들어졌는데 **main.ts 에 붙은 적이 없어**, 전용 배경 3종도 레이어 전환
   * 크로스페이드도 통째로 죽어 있었다(그 모듈을 import 하는 곳이 테스트 하나뿐이었다).
   * 그래서 `assets/bg_invasion_l*.png` 를 넣어도 화면에 나오지 않았다 — 자산이 로드되는
   * 것과 표시되는 것은 다른 문제다.
   */
  function beginInvasionBackdrop(phase: number, tick: number): void {
    invasionBackdrop.begin(phase, tick);
    invasionBackdrop.visible = true;
    // (flat 배경의 표시 여부는 렌더 루프의 단일 권위가 정한다 — `arenaScreen && !autotile.active`.
    //  예전에는 침공만 `false` 고정이라 침공 타일셋 로드가 실패하면 바닥이 통째로 비었는데,
    //  그 규칙 통일이 이제 한 곳에만 산다.)
  }

  /**
   * 침공 페이즈의 지형·환경을 건다. 런 개시와 페이즈 전환(베일 절정) **양쪽이 같은 함수**를
   * 탄다 — 두 경로가 갈리면 "시작은 맞는데 전환하면 틀린" 결함이 생긴다(이 리포의 단골).
   */
  function applyInvasionPhaseScenery(phase: number, seed: number): void {
    autotile.configure(invasionWangTiles[phase] ?? null, seed);
    // 합성 행성 인덱스 — 침공 config.planet(항상 0=카르곤)을 그대로 넘기면 화산 화면이 나온다.
    env.configure({ planet: invasionEnvPlanet(phase), seed, renderer: gameApp.app.renderer });
    // 접지 그림자는 **같은 인덱스**를 받아야 한다 — 배경과 그림자가 다른 광원을 읽으면 화면에
    // 태양이 둘이 된다(데칼↔지형광에서 이미 겪은 실패). `env.configure` 바로 옆이 그 계약의 자리다.
    entityRenderer.setEnvPlanet(invasionEnvPlanet(phase));
  }

  /** 침공이 아닌 런으로 돌아갈 때 전용 배경을 내린다. */
  function clearInvasionBackdrop(): void {
    invasionBackdrop.visible = false;
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
    // 공식 Math.round(db*100) 고정 — 서버는 더 이상 이 값으로 재실행 대조를 하지 않지만
    // (ADR-0050), 결정론 계측이 같은 정비도 입력에 같은 sim 결과를 전제한다.
    const maintenance = maintenanceToCenti(runMaintenanceDb);
    // 코어 모듈 효력(M7b · ADR-0018). 서버 권위 스냅샷이 준 {instances,matchup} 을 그대로
    // 싣는다 — 재실행 대조는 더 이상 없다(ADR-0050). 미장착이면 필드 자체를 두지 않는다
    // (조건부 접기 → 거동·해시 바이트 불변).
    const invasion3: Invasion3Config = {
      layers: normalizeInvasionLayers(runLayoutRaw),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      ...(maintenance !== undefined ? { maintenance } : {}),
      ...(runModules !== null ? { modules: runModules } : {}),
      // 기본 수비대 레벨(밸런스). **데이터 층이 아니라 여기서** 건다 — `garrisonRef` 의 기본값으로
      // 두면 침공 config 를 직접 만드는 테스트 전부가 이 밸런스 값 위에서 돌아, Lv1 관측자를
      // 쓰는 배선 테스트가 무더기로 "관찰 창 안에 진행 못 함"으로 빨개진다(실제로 겪었다).
      //
      // ⚠️ 하네스 경로(`startHarnessInvasionRun`)에도 같은 기본값이 있다. 두 침공 진입점이
      // 다른 바닥을 쓰면 "하네스에서는 되는데 실제 런에서는 안 된다"가 된다.
      garrisonLevel: INVASION_GARRISON_LEVEL_DEFAULT,
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
    // 레이어별 지형·환경(L1 대기권 → L2 회랑 → L3 코어방). 페이즈 전환은 렌더 루프가
    // 베일 절정에서 갈아 끼운다(`invasionBackdrop.sync` 는 멱등이라 매 프레임 불러도 무해하다).
    applyInvasionPhaseScenery(PHASE_L1, seed);
    beginInvasionBackdrop(PHASE_L1, 0);
    currentSeed = seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞. 렌더러가 엔티티 id 로 스프라이트를 캐시하고
    // 텍스처를 생성 시점에 묶으므로, 비우지 않으면 바로 위 `applyShipSprite` 가 갈아끼운 기체가
    // 화면에 반영되지 않고 직전 런의 그림이 남는다.
    entityRenderer.reset();
    world = createWorld(seed, config);
    // recorder 에는 **createWorld 에 넣은 그 config** 를 준다(`world.config` 아님 — 아래 주석).
    recorder = new ReplayRecorder(seed, config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    bossWarn.reset();
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = target;
    harnessInvasionRun = false; // 정식 침공: 정산·제출 경로를 탄다
    currentRunKind = 'invasion'; // 정식 침공 런 → invasion 존(AC3).
    hud.setRunInfo(null); // 침공은 행성/촉매 축이 없다 — 정보판을 세우지 않는다.
    setScreen('run');
  }

  /**
   * DEV 하네스 침공 런(M7a L8). 대상 기지 없이 **배치만** 넘겨 3레이어 런을 세운다.
   *
   * ADR-0008 오염 격리: `invasionTarget` 을 세우지 않고 `harnessInvasionRun` 만 세운다 →
   * endRun 이 PvE 정산도 서버 제출도 하지 않는다. 리플레이 recorder 는 정식 런과 똑같이
   * 붙여서(같은 record 경로) 재현·해시 검증이 가능하게 한다.
   */
  /**
   * 활성 기체의 레벨만 바꾼 **프로필 사본**. 저장본과 그 안의 배열은 건드리지 않는다.
   *
   * 하네스 침공 탭의 레벨 슬라이더 전용이다. 프로필을 직접 변형하면 슬라이더를 한 번 돌린 것이
   * 이후 실제 런·격납고 표시·저장까지 따라가 조용히 오염된다 — 하네스가 "오염"이라고 표시하는
   * 것은 그 런의 결과이지 계정 상태가 아니어야 한다.
   */
  function withPilotLevel(p: Profile, level: number): Profile {
    const idx = p.ships[p.activeShipIndex] !== undefined ? p.activeShipIndex : 0;
    const ship = p.ships[idx];
    if (ship === undefined) return p;
    const ships = p.ships.slice();
    ships[idx] = { ...ship, level };
    return { ...p, ships };
  }

  function startHarnessInvasionRun(opts: {
    seed: number;
    layers: unknown;
    maintenance: number;
    timeLimitTicks: number;
    density?: Partial<InvasionDensity>;
    defenseHpBp?: number;
    defenseDamageBp?: number;
    pilotLevel?: number;
    garrisonLevel?: number;
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
      // 미지정이면 필드를 두지 않는다 — sim 이 기본값으로 접는다(조건부 접기).
      ...(opts.density !== undefined ? { density: opts.density } : {}),
      ...(opts.defenseHpBp !== undefined ? { defenseHpBp: opts.defenseHpBp } : {}),
      ...(opts.defenseDamageBp !== undefined ? { defenseDamageBp: opts.defenseDamageBp } : {}),
      // 하네스는 슬라이더 값을 넘긴다. 안 넘기면 실 침공과 같은 밸런스 기본값을 쓴다.
      garrisonLevel: opts.garrisonLevel ?? INVASION_GARRISON_LEVEL_DEFAULT,
    };
    // 조종사 레벨 강제(하네스 전용). **프로필을 변형하지 않고 사본으로** 넘긴다 — 저장본을
    // 건드리면 하네스에서 슬라이더를 한 번 돌린 것이 이후 실제 런·격납고 표시까지 오염시킨다.
    // 침공에서 레벨 축이 실제로 살아 있는지(runConfig 의 봉인 해제)가 이 경로로 검증된다.
    const runProfile = opts.pilotLevel === undefined ? profile : withPilotLevel(profile, opts.pilotLevel);
    // 정식 침공과 **같은 조립**을 탄다(단일 정본). 하네스 런만 다른 config 를 갖게 되면
    // "하네스에서는 되는데 실제 런에서는 안 되는" 결함이 생긴다.
    const config = buildRunConfig(runProfile, { planet: 0, stage: 1, invasion3 });
    applyShipSprite(textures, config.shipType ?? 0);
    // 정식 침공과 같은 지형·환경 경로(단일 정본) — 하네스에서만 다른 화면이 나오면
    // "하네스에서는 되는데 실제 런에서는 안 되는" 결함이 그대로 숨는다.
    applyInvasionPhaseScenery(PHASE_L1, opts.seed);
    beginInvasionBackdrop(PHASE_L1, 0);
    currentSeed = opts.seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞(정식 침공·PvE 와 같은 규약).
    entityRenderer.reset();
    world = createWorld(opts.seed, config);
    // recorder 에는 **createWorld 에 넣은 그 config** 를 준다(`world.config` 아님 — 아래 주석).
    recorder = new ReplayRecorder(opts.seed, config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    bossWarn.reset();
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    invasionTarget = null;
    harnessInvasionRun = true;
    currentRunKind = 'invasion'; // 하네스 침공도 침공 런 → invasion 존(AC3).
    hud.setRunInfo(null); // 정식 침공과 동일 — 행성/촉매 축 없음.
    // 이탈 버튼(사용자 요청 2026-08-05). **이 런에만** 뜬다 — 오염 런이라 정산도 리플레이 제출도
    // 타지 않으므로 중도에 나가도 잃는 것이 없고, 반대로 정식 런에 이 버튼이 있으면 정산을
    // 건너뛰는 구멍이 된다. 끄는 일은 clearToMenu 가 전담한다(그 주석이 근거).
    //
    // 돌아가는 곳은 기지 맵이 아니라 **방어 사령부**다: 시험 침공은 배치를 고치던 중에 눌러
    // 들어온 것이라, 나갈 때 필요한 것은 "기지"가 아니라 "고치던 그 화면"이다. 사령부는 저장본
    // 에서 상태를 새로 만들므로(show 규약) 저장하지 않은 초안이 남아 있다는 착각도 생기지 않는다.
    hud.setExitRun(t('hud.exitTest'), () => {
      clearToMenu();
      setScreen('defense');
      openDefenseCommand();
    });
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
      registerDropRun(sel.planet);
      return;
    }
    void consumeAndLaunch(seed, sel, cats);
  }

  /**
   * 런 시작을 서버 원장에 등록한다(ADR-0050 §3 단계 1). **출격을 막지 않는다** —
   * `startRun` **뒤에** fire-and-forget 으로 부르므로 "출격이 서버를 기다리지 않는다"는
   * 기존 계약(무촉매 오프라인 런 보존)이 그대로다. 런은 분 단위라 정산 전에 도착한다.
   *
   * ⚠️ 늦게 온 응답이 **다음 런의 id 를 덮어쓰면** 그 런의 드랍이 지난 런에 적힌다. 토큰으로
   * 세대를 확인해 막는다 — `startRun` 이 토큰을 올리므로 런이 바뀌면 옛 응답은 버려진다.
   */
  function registerDropRun(planet: number): void {
    const token = dropRunToken;
    void beginPveRunOnServer(planet).then((res) => {
      if (token !== dropRunToken) return; // 이미 다음 런이 시작됐다 — 이 응답은 남의 것이다.
      dropRunId = res.status === 'ok' ? res.runId : null;
    });
    // ⭐ 의뢰서 발령 감지의 **기준선**(사용자 요청 2026-08-09). 발령은 서버 `pve_runs` AFTER
    // 트리거라 정산 응답에 안 실린다 — 클라가 아는 유일한 길은 런 **시작 시** 재고를 찍어 두고
    // 정산 뒤 다시 읽어 차집합을 내는 것이다.
    //
    // ⚠️ 여기서 찍는 이유가 있다: 정산 직전에 찍으면 그 조회가 정산 임계 경로에 끼어들어
    // 결과 화면이 네트워크를 기다린다. 런은 분 단위라 여기서 보낸 조회는 여유롭게 끝난다.
    // 실패하면 `null` 로 남고, 그러면 아래 차집합은 **아예 계산하지 않는다** — 기준선 없는
    // 차집합은 "재고 전체가 이번 런 발령분"이 되어 화면이 거짓을 말한다.
    commissionIdsAtRunStart = null;
    void fetchCommissionInventoryOnline().then((rows) => {
      if (token !== dropRunToken || rows === null) return;
      commissionIdsAtRunStart = new Set(rows.map((r) => r.commissionId));
    });
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
      // 소모가 확정된 순간 주입 선택을 비운다(사용자 신고 2026-08-05). 성계 지도 화면 객체는
      // 런 사이에 재사용되므로, 안 비우면 다음 성계 지도에 지난 주입이 그대로 남고 그대로
      // 출격하면 **고르지도 않은 촉매가 한 번 더 소모된다**.
      planetSelect.clearInjectedCatalysts();
      startRun(seed, { ...sel, catalysts: cats, runId: outcome.runId });
      // 촉매 런도 드랍 원장은 **별도 행**에 등록한다 — `outcome.runId` 는 촉매 영수증 id 라
      // 드랍 키로 쓰면 `settle_pve_run` 의 영수증 조회와 충돌한다(위 `dropRunId` 주석).
      registerDropRun(sel.planet);
      return;
    }
    // unconfigured(영구 오프라인)·failed(거부/일시 오프라인) 모두 2선택 모달로 처리한다.
    catalystSortieModal.show({
      onRetry: () => void consumeAndLaunch(seed, sel, cats),
      // 촉매·runId 를 뺀 무촉매 sel 로 시작(오프라인 폴백 보존). 명시 재조립으로 잔여 필드 누락 방지.
      // 여기서도 주입을 비운다 — 아이템은 미소모지만 **런이 실제로 떠났다**. 남겨 두면 다음
      // 성계 지도에 지난 선택이 살아 있어, 그때는 소모에 성공해 모르는 사이에 빠져나간다.
      onSkip: () => {
        planetSelect.clearInjectedCatalysts();
        startRun(seed, {
          planet: sel.planet,
          stage: sel.stage,
          ...(sel.maxSegments !== undefined ? { maxSegments: sel.maxSegments } : {}),
        });
        registerDropRun(sel.planet);
      },
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
    // 튜토리얼도 실제로 아이템을 주는 PvE 런이라 드랍 원장에 등록한다. 빼면 그 전리품만
    // 원장 밖에서 생겨, 뒤따르는 `save` 증가분 봉인(단계 1 후속)이 그것을 위조로 보고 되돌린다.
    registerDropRun(TUTORIAL_PLANET);
    tutorialActive = true; // startRun cleared it; mark this run as the tutorial.
    ftue.markCombat();
    tutorialOverlay.show();
  }

  /** Assemble the run config from the selection + active loadout, then start. */
  function startRun(seed: number, sel: LaunchSelection): void {
    pendingRunSeed = null; // 이번 시드 소진 — 다음 성계 지도는 새 시드를 굴린다
    // 새 런: 드랍 원장 등록을 초기화하고 세대를 올린다. 토큰을 올려야 지난 런의 늦은
    // `begin_pve_run` 응답이 이 런의 id 로 들어앉지 않는다(ADR-0050 §3 단계 1).
    dropRunId = null;
    dropRunToken++;
    tutorialActive = false; // normal run unless startTutorial re-flags it
    invasionTarget = null; // PvE 런: 침공 컨텍스트 해제(endRun 이 정산 경로로 분기)
    harnessInvasionRun = false;
    currentRunKind = 'pve'; // PvE 런 → combatPvE 존(AC3).
    clearInvasionBackdrop(); // PvE 는 행성 배경 — 침공 전용 레이어를 내린다
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
      // 행성 인기 배율 스탬프(ADR-0038) — **PvE 출격 경로에만** 있다. 침공(정식·하네스)·예비역
      // 소집은 각자의 buildRunConfig 호출부에서 이 옵션을 넘기지 않으므로 미지정 → 해시 폴드
      // 미실행 → 침공 골든 바이트 불변(verify-invasion EF 재배포 불필요).
      // 캐시는 동기 리더라 출격이 서버를 기다리지 않는다(무촉매 오프라인 런 보존).
      planetMult: { centi: multCentiFor(sel.planet), epoch: currentMultipliers().epoch },
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
    // 행성 환경 레이어(시차 원경·데칼·용암 발광·대기·그레이딩). 각 레이어가 자기 담당 행성인지
    // 스스로 판정하므로, 카르곤이 아니면 전부 꺼져 화면이 한 픽셀도 바뀌지 않는다.
    env.configure({ planet: sel.planet, seed, renderer: gameApp.app.renderer });
    // 접지 그림자 광원 — `env.configure` 와 같은 인덱스(위 applyInvasionPhaseScenery 와 같은 계약).
    entityRenderer.setEnvPlanet(sel.planet);
    // 직전 런이 침공이었으면 전용 배경이 남아 PvE 아레나를 덮는다 — 반드시 내린다.
    clearInvasionBackdrop();
    currentSeed = seed;
    // 스프라이트 캐시 리셋(B-1) — `createWorld` 앞. 위 `applyShipSprite` 가 `textures.player` 를
    // 갈아끼워도, 이전 런의 플레이어 스프라이트(같은 엔티티 id)가 캐시에 남아 있으면 그 런 내내
    // 옛 기체 그림이 그대로 뜬다(세션 중 기체 교체 5종 전부 재현된 결함).
    entityRenderer.reset();
    world = createWorld(seed, config);
    /**
     * ⚠️ recorder 에는 **`createWorld` 에 넣은 그 config** 를 준다 — `world.config` 가 아니다.
     *
     * `createWorld` 는 받은 config 를 얕게 복사한 뒤(`world.ts` `const cfg = { ...config }`)
     * 그 사본에 **로드아웃·촉매 파생을 적용해서** `state.config` 로 삼는다
     * (`cfg.playerSpeed = Math.round(cfg.playerSpeed * lo.moveSpeedMult)` 등). 게다가 런 중
     * 파워업이 같은 사본을 또 바꾼다(`sim/powerups.ts` 이동 속도 +12%/+10%).
     *
     * 그래서 `world.config` 를 리플레이에 실으면 재실행이 **파생을 두 번 적용**하고 파워업
     * 결과까지 시작값으로 물고 출발한다 — 제출된 리플레이가 실제로 플레이한 런이 아니게 된다.
     * `buildClientResult` 도 서버 `verify-invasion` 도 그 리플레이를 다시 돌려 승패를 정하므로,
     * 둘은 서로 일치하면서 **둘 다 실제 플레이와 다른** 런을 판정하게 된다(공격자에게 유리한
     * 방향으로 기운다). 로드아웃 배율이 전부 1 이고 파워업을 안 먹은 런에서는 두 값이 같아
     * 지금까지 드러나지 않았다.
     *
     * 원본 config 는 `buildRunConfig` 가 매 런 새로 만들고 sim 은 사본만 건드리므로, 이 참조는
     * 런 시작 시점 값 그대로 남는다.
     */
    recorder = new ReplayRecorder(seed, config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    bossWarn.reset();
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    // 런 중 침공 정보판(우측 가운데, 사용자 요청 2026-07-28). 행성·단계는 이번 출격 선택에서,
    // 촉매 효과는 **실제 런에 스탬프된 배열**(`config.catalysts`)에서 접는다 — sel 이 아니라
    // config 를 읽는 이유는 무촉매/consume 실패 폴백에서 둘이 갈릴 수 있어서다(표시가 곧 계약).
    hud.setRunInfo(runInfoFor(sel.planet, sel.stage, config.catalysts ?? []));
    setScreen('run');
  }

  /**
   * 의뢰 런 조립(의뢰서 시스템 Phase E) — 지시 수신소가 `consume_commission` 을 이미 성공시킨
   * 뒤에만 호출된다(`runId` 는 그 응답). 서버 원장 `payload`(이미 굳은 종이)에서 `WorldConfig`
   * 를 만들어 런을 시작한다.
   *
   * ⚠️ **여기서 config 를 손보지 않는다** — `buildRunConfig` 단일 정본에 `commission` 옵션만
   * 실어 넘긴다(`tests/shipIntegration.test.ts` grep 게이트). 촉매 픽커를 안 띄우므로 촉매는
   * 항상 미지정이고, 행성 인기 배율도 넘기지 않는다 — 둘 다 의뢰 런의 계약이다(계획 D13,
   * `buildRunConfig` 가 `commission` 이 있으면 어차피 인기 배율 스탬프를 재차 막는다).
   */
  function startCommissionRun(runId: string, payload: CommissionPayload): void {
    const first = payload.segments[0];
    // `buildRunConfig` 가 빈 `segments` 를 던지므로 도달하지 않아야 정상이다 — 방어적 조기 반환.
    if (first === undefined) return;
    const seed = nextSeed();
    pendingRunSeed = null;
    tutorialActive = false;
    invasionTarget = null;
    harnessInvasionRun = false;
    currentRunKind = 'pve';
    clearInvasionBackdrop();
    shownLevel = 0;
    echoToastShown = false;
    // `endRun` 이 이 값으로 `verify-commission` 을 제출한다(계약 §7). `consume_commission`
    // 이 이미 성공한 뒤에만 이 함수가 불리므로(지시 수신소 self-hide 규약) runId 는 항상 유효하다.
    commissionRunId = runId;
    // 확정 경험치는 검증이 끝난 **뒤에** 지급되므로 종이를 여기서 붙잡아 둔다(월드도 화면도
    // 그때는 이미 사라져 있다). runId 와 같은 자리에서 세우고 같은 자리에서 지운다.
    commissionPayload = payload;
    const config = buildRunConfig(profile, {
      planet: first.planet,
      stage: first.stage,
      commission: commissionRunConfigFromPayload(payload),
    });
    applyShipSprite(textures, config.shipType ?? 0);
    background.texture = planetBackground(first.planet);
    const tiles = wangTiles[first.planet] ?? null;
    autotile.configure(tiles, seed);
    env.configure({ planet: first.planet, seed, renderer: gameApp.app.renderer });
    entityRenderer.setEnvPlanet(first.planet);
    clearInvasionBackdrop();
    currentSeed = seed;
    entityRenderer.reset();
    world = createWorld(seed, config);
    recorder = new ReplayRecorder(seed, config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    ceremony.reset();
    soundObserver.reset();
    bossWarn.reset();
    dropObserver.reset();
    lastOutcome = null;
    resultOverlay.hide();
    // 의뢰 런은 촉매 픽커가 없다 — 정보판 촉매 칸은 항상 빈 목록.
    hud.setRunInfo(runInfoFor(first.planet, first.stage, []));
    setScreen('run');
    // 런 시작 직후 신호(계약 §5-3, 계획 pre-mortem ④). **실패해도 클라는 아무것도 하지 않는다**
    // — 복구를 지시하지 못하고, 신호 부재 자체가 회수 조건이다(cron 만 회수한다, D8).
    void markCommissionActiveOnServer(runId);
  }

  /**
   * 런 중 정보판 상태를 만든다(순수 조립 — i18n·라벨 유도만).
   *
   * 예전에는 여기서 축별 배율 줄을 접었다. ADR-0052 가 축 모델을 없애면서 접을 값이 사라졌고,
   * 런 중에 실제로 알아야 하는 것은 둘로 줄었다 — **어느 카드 3장을 걸었나**(슬롯 스트립이
   * 말한다) 와 **무슨 공명이 섰나**. 공명 판정은 `resolveResonance` 하나만 부른다(픽커·sim·EF 와
   * 같은 정본 — 화면이 따로 세면 갈린다).
   */
  function runInfoFor(planet: number, stage: number, catalysts: readonly number[]): RunInfoState {
    const ids = normalizeCatalystArray(catalysts);
    const reso = resolveResonance(ids);
    return {
      planetName: planetById(planet).name,
      stageLabel: t('runinfo.stage', { n: stage }),
      catalystLabel:
        ids.length > 0 ? t('runinfo.catalysts', { n: ids.length }) : t('runinfo.noCatalysts'),
      resonanceHead: t('catalyst.resonance.head'),
      resonanceLabel:
        reso === null
          ? t('catalyst.resonance.none')
          : `${resonanceName(reso)} (${resonanceTierLabel(reso.tier)})`,
      catalysts: catalystSlotsFor(ids),
    };
  }

  /**
   * 런 중 **촉매 3칸 스트립**의 상태(헌장 §귀속 규율 1 — 발동할 때마다 그 칸이 번쩍인다).
   * 칸 수는 항상 `SLOT_CAP` 이고 빈 칸도 자리를 지킨다 — 픽커에서 본 배치가 그대로 이어져야
   * "몇 번째 칸이 번쩍였나"가 곧 "어느 카드인가"가 된다.
   */
  function catalystSlotsFor(catalysts: readonly number[]): readonly CatalystSlotState[] {
    return normalizeCatalystArray(catalysts).flatMap((id) => {
      const def = catalystById(id);
      if (def === undefined) return [];
      const url = uiAssetUrl(`${catalystIconKey(def)}.png`);
      return [{ id, name: catalystName(def), ...(url === undefined ? {} : { iconUrl: url }) }];
    });
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
    // 의뢰 구간 전환이면 **다른 월드**가 돌아온다. 반드시 `world` 에 다시 대입한다.
    const next = stepRun(w, input);
    world = next;
    if (next !== w) {
      // ⚠️ **전환됐을 때만** 리셋한다. 무조건 부르면 프리즈된 틱마다 스프라이트 캐시가 날아간다.
      //  - `entityRenderer.reset()`: 새 월드가 `nextEntityId` 를 1 로 되돌리므로, 안 부르면
      //    2구간의 적이 1구간 스프라이트를 그대로 물려받는다(렌더러가 엔티티 id 로 캐시한다).
      //  - 보간 스냅샷: 이전 무대의 좌표에서 새 무대 좌표로 **선을 그으며** 날아가는 프레임이
      //    생기지 않도록 두 스냅샷을 새 월드로 붙인다.
      entityRenderer.reset();
      prevSnap = snapshotWorld(next);
      currSnap = prevSnap;
      harness?.observe(next);
      return;
    }
    prevSnap = currSnap;
    currSnap = snapshotWorld(next);
    // 촉매 귀속 3종의 배선 지점(ADR-0052 §귀속 규율). **여기가 유일한 자리**다 — 렌더 루프에서
    // 읽으면 한 프레임에 sim 이 여러 틱 돈 경우 중간 틱의 통지가 통째로 사라지고(통지는 매 틱
    // 비워진다), 0 틱인 프레임에서는 같은 통지를 두 번 소비한다. `stepOnce` 는 **틱당 정확히
    // 한 번** 도는 유일한 경로라 두 결함이 구조적으로 없다.
    drainCatalystFx(currSnap.catalystFx);
    harness?.observe(next);
  }

  /**
   * 이번 틱의 촉매 통지를 **귀속 3종**으로 흘린다(헌장 §귀속 규율).
   *
   *  1. HUD 슬롯 번쩍임 — `hud.flashCatalystSlot(id)`. 이펙트가 무엇이든 어느 카드인지가
   *     화면 한 곳에서 항상 읽힌다.
   *  2. 전용 사운드 — 발동/자해가 갈린다(`catalystFxSound`). 나머지 종류는 무음이다.
   *  3. 자기 피해 전용 색 — 자해 통지가 오면 다음 플레이어 피격 연출이 촉매 색으로 갈린다.
   *
   * 무촉매 런은 `events` 가 `undefined` 라 첫 줄에서 끝난다.
   */
  function drainCatalystFx(events: WorldSnapshot['catalystFx']): void {
    if (events === undefined) return;
    for (const ev of events) {
      if (catalystFxFlashesSlot(ev.kind)) hud.flashCatalystSlot(ev.id);
      const sound = catalystFxSound(ev.kind);
      // ⚠️ 절차 합성 폴백이 걸리지 않는 이름만 온다(`render/catalystFx.ts` 매핑 주석).
      if (sound !== null) audio.play(sound);
      if (ev.kind === FX_SELF_HARM) entityRenderer.markCatalystSelfHarm();
    }
  }

  /**
   * 의뢰 확정 지급물 배송 1회분(`applied_at IS NULL` 인 발급 행 → 세이브).
   *
   * ## 왜 제출 직후와 부팅 **둘 다**에서 부르는가
   * 제출 직후만 부르면 그 순간 앱이 죽거나 오프라인이면 물건이 영영 안 온다. 부팅만 부르면
   * 방금 이긴 런의 보상이 다음 실행까지 안 보인다. 두 자리 모두에서 **같은 함수**를 부르므로
   * 경로가 갈릴 여지가 없고, 원장이 정본이라 두 번 불러도 중복 배송이 없다
   * (`hasItemId` 전수 검사 — src/save/itemPresence.ts).
   *
   * 절대 throw 하지 않는다. 오프라인·미설정이면 완전 no-op 이다.
   */
  async function runCommissionGrantDelivery(): Promise<void> {
    const report = await deliverCommissionGrants(profile, {
      fetchGrants: () => fetchCommissionGrantsOnline(),
      saveProfile: (p) => saveProfile(p),
      pushProfile: (p) => pushProfileToServer(p),
      // 재-pull. `pullServerProfileInto` 는 서버가 더 진행됐으면 **로컬을 갈아 끼운다** —
      // 그때 방금 심은 아이템이 사라지고, 그것을 배송 루틴이 존재 확인 실패로 잡아 표시를
      // 미룬다. 여기서 그 함수를 쓰는 이유가 바로 그 사건을 재현하는 것이다.
      repullProfile: async (p) => ((await pullServerProfileInto(p)) === 'unavailable' ? null : p),
      markApplied: (grantId) => markCommissionGrantAppliedOnline(grantId),
    });
    if (report.delivered > 0) {
      saveProfile(profile);
    }
    if (report.held > 0) {
      console.warn(
        `[commission] 확정 지급물 ${report.held}건이 인벤·창고 만석으로 보류됐다 — 자리를 비우면 다음 부팅에 들어온다`,
      );
    }
  }

  /**
   * 서버 드랍 배송 1회분(`applied_at IS NULL` 인 원장 행 → 세이브) — ADR-0050 §3 단계 1.
   *
   * 의뢰 배송(`runCommissionGrantDelivery`)과 **같은 형상**이다. 두 배송이 같은 순서 계약
   * (저장 → push → 재-pull 확인 → 표시)을 쓰므로 규율이 한 벌이다.
   *
   * 절대 throw 하지 않는다. 오프라인·미설정이면 완전 no-op 이다.
   *
   * 리포트를 **돌려준다** — 정산 화면이 `deliveredItems` 를 읽어 '획득 장비'를 채운다. 서버
   * 권위 모드에서는 여기가 클라가 무엇을 받았는지 아는 유일한 자리다(`itemGrantDelivery.ts`
   * `ItemGrantDeliveryReport` 주석).
   */
  async function runItemGrantDelivery(): Promise<ItemGrantDeliveryReport> {
    const report = await deliverItemGrants(profile, {
      fetchGrants: () => fetchPendingItemGrantsOnServer(),
      saveProfile: (p) => saveProfile(p),
      pushProfile: (p) => pushProfileToServer(p),
      // 재-pull. `pullServerProfileInto` 는 서버가 더 진행됐으면 **로컬을 갈아 끼운다** —
      // 그때 방금 심은 아이템이 사라지고, 그것을 배송 루틴이 존재 확인 실패로 잡아 표시를
      // 미룬다. 여기서 그 함수를 쓰는 이유가 바로 그 사건을 재현하는 것이다.
      repullProfile: async (p) => ((await pullServerProfileInto(p)) === 'unavailable' ? null : p),
      markApplied: (grantId) => markItemGrantAppliedOnServer(grantId),
    });
    if (report.delivered > 0) saveProfile(profile);
    if (report.held > 0) {
      console.warn(
        `[drops] 전리품 ${report.held}건이 인벤·창고 만석으로 보류됐다 — 자리를 비우면 다음 부팅에 들어온다`,
      );
    }
    if (report.unresolved > 0) {
      console.warn(`[drops] 원장 ${report.unresolved}건을 해석하지 못했다(등급·시드 형식 위반)`);
    }
    return report;
  }

  /**
   * 이번 런에 **발령된 의뢰서**를 정산 화면에 싣는다(사용자 요청 2026-08-09).
   *
   * ## 왜 차집합인가 — 다른 길이 없다
   * 발령은 `settle_pve_run` 이 만든 `pve_runs` 행의 AFTER 트리거가 한다. 그래서
   *  ① 정산 RPC 응답에 발령 여부가 **안 실린다**(`SettlePveResult` 는 잔액 + settled 뿐),
   *  ② 발령 원장 `commission_issues` 는 **RLS 정책이 0개**라 클라가 못 읽는다(의도 —
   *     `skip_reason` 노출은 "언제 상한에 걸리는가"를 알려주는 재료다).
   * 읽을 수 있는 것은 `commission_inventory`(본인 select 정책 있음)뿐이라, 런 시작 스냅샷과의
   * 차집합이 유일한 관측면이다.
   *
   * ⚠️ **기준선이 없으면 아무것도 말하지 않는다.** 오프라인·조회 실패로 스냅샷이 없을 때
   * 재고를 통째로 "이번 런 발령분"이라고 적으면 화면이 정면으로 거짓이 된다 — 이 리포가
   * 반복해 대가를 치른 「모르는 것을 아는 것처럼 적는」 형태다. 침묵이 맞다.
   *
   * ⚠️ 발령은 승리+보스처치 런의 30%(base)라 **대부분의 런에서 0건**이다. 0건이면 줄을 안
   * 그린다(조건부 스탬프 규율) — "발령 없음"을 매 런 적으면 그것이 잡음이다.
   *
   * 절대 throw 하지 않는다.
   */
  async function reportCommissionIssue(): Promise<void> {
    const before = commissionIdsAtRunStart;
    if (before === null) return; // 기준선 없음 — 위 ⚠️. 조회 왕복 자체를 아낀다.
    const token = dropRunToken;
    const rows = await fetchCommissionInventoryOnline();
    if (token !== dropRunToken) return; // 이미 다음 런이 떠났다 — 이 결과는 남의 것이다.
    // 판정은 순수 함수가 소유한다(`commissionIssueDiff.ts`) — 기준선 없이 빼는 사고를
    // 단위 테스트가 짚을 수 있어야 하는데, 이 클로저 안에 적으면 영영 못 짚는다.
    const fresh = newlyIssuedCommissions(before, rows);
    if (fresh.length === 0) return;
    resultOverlay.updateCommissionGains(fresh.map((r) => commissionGradeLabel(r.payload.grade)));
  }

  /**
   * 런 드랍 발급 → 배송(ADR-0050 §3 단계 1 「개수만 계약」).
   *
   * ## 왜 발급 응답을 바로 쓰지 않고 원장을 다시 읽는가
   * `grant_run_drops` 는 발급 결과를 반환값에 담아 준다. 그런데 그 응답을 받기 전에 앱이 죽으면
   * **원장에는 행이 있고 세이브에는 없다.** 그래서 발급 후 `fetchPendingItemGrants` 로 다시 읽어
   * 배송한다 — 정산 직후 경로와 부팅 재개 경로가 **같은 함수**를 타므로 둘이 갈릴 여지가 없다
   * (의뢰 배송이 세운 규율과 같다). 비용은 조회 1회이고, 얻는 것은 유실 0 이다.
   *
   * 절대 throw 하지 않는다.
   */
  async function deliverRunDrops(
    runId: string,
    lootCount: number,
    src: { planet: number; stage: number; levelCap: number },
  ): Promise<void> {
    const res = await grantRunDropsOnServer(
      runId,
      lootCount,
      src.planet,
      src.stage,
      src.levelCap,
    );
    if (res.status === 'ok' && res.clamped) {
      // 캡이 깎았다. 정직한 플레이는 여기 닿지 않는다 — 닿았다면 캡 상수를 실측으로 다시 볼 신호다.
      console.warn(
        `[drops] 개연성 캡이 전리품 주장을 깎았다: 주장 ${res.claimed} → 지급 ${res.granted}`,
      );
    }
    // 발급이 실패했어도 배송은 시도한다 — 지난 런의 미배송 행이 남아 있을 수 있다.
    const report = await runItemGrantDelivery();

    // ⭐ 배송 결과를 정산 화면의 '획득 장비'로 갈아끼운다(사용자 신고 2026-08-09).
    //
    // 이 모드에서 `settleRun` 은 전리품을 굴리지 않아 `itemsGained` 가 **항상 빈 배열**이다.
    // 그런데 화면은 그 배열만 읽고 있었다 — 그래서 온라인 계정으로 장비를 주운 런의 정산이
    // 언제나 "이번 런에는 새 장비가 없습니다 / 전투력 +0" 이었다. 서버가 굴린 실물을 아는
    // 자리는 배송뿐이므로, 배송이 끝난 **여기서** 화면에 실어 준다.
    //
    // ⚠️ **이 런의 발급분으로 좁힌다.** 배송은 `applied_at IS NULL` 인 행을 전부 훑으므로
    // 지난 런의 보류분(만석·표시 실패)이 섞여 들어올 수 있고, 그것을 이번 런 전리품으로
    // 적으면 화면이 또 거짓을 말한다. 발급 응답의 `grants` 가 이 런의 id 집합이다.
    // 발급이 실패했거나(`status !== 'ok'`) 멱등 재호출로 0건이면 좁힐 근거가 없으므로
    // 화면을 건드리지 않는다 — "모르는 것"을 "없는 것"으로 적지 않기 위해서다.
    const ids = res.status === 'ok' ? new Set(res.grants.map((g) => g.grantId)) : null;
    if (ids !== null && ids.size > 0) {
      const items = report.deliveredItems.filter((d) => ids.has(d.grantId)).map((d) => d.item);
      resultOverlay.updateDrops(items.map(resultDropOf), totalCombatPower(items));
    }
  }

  /**
   * 끝난 의뢰 런의 리플레이를 `verify-commission` 에 제출하고, 판정을 정산 화면에 반영한다
   * (의뢰서 시스템 Phase E · 서버 계약 §7·§5-4).
   *
   * ## 이 함수가 없으면 시스템이 닫히지 않는다
   * 출격(`consume_commission`)과 런 시작 신호(`mark_commission_active`)만 있고 제출이 없으면
   * **확정 지급물도 재화도 영영 나오지 않는다.** 화면상 런은 멀쩡히 끝나므로 증상이 "보상이
   * 안 들어온다" 하나뿐이다 — 이 리포가 반복해서 겪은 *"저장은 되는데 런에 안 닿는다"* 형태다.
   *
   * ## 규율
   * - **`commissionRunId` 를 먼저 소비한다**(재진입 방지). 이 함수가 그 값의 유일한 소비자다.
   * - **오염 런은 제출하지 않는다**(ADR-0008). 하네스·치트 개입 런은 판정 대상이 아니다.
   * - 제출 리플레이는 `recorder.toReplay()` — `world.config`(파생 사본)가 아니다. 그 혼동이
   *   실제로 "실제 플레이가 아닌 런"을 판정하게 만든 전례가 있다(PR#191).
   * - **`queued`(전송 실패)는 재시도한다** — 대기 큐에 남아 다음 부팅/제출 때 같은 `run_id` 로
   *   다시 간다. ⚠️ 런 **시작** 실패 규율과 정반대다(그쪽은 신호를 안 보내는 것이 곧 회수
   *   조건이라 클라가 아무것도 하지 않는다).
   * - 재화는 서버가 돌려준 잔액을 **그대로 미러에 세팅**한다(가산이 아니다 — 원장이 정본).
   */
  async function submitCommissionReplay(w: WorldState): Promise<void> {
    const runId = commissionRunId;
    const paper = commissionPayload;
    commissionRunId = null;
    commissionPayload = null;
    if (runId === null) return;
    // 오염 런은 판정 대상이 아니다. 소비된 의뢰서는 회수되지 않고 cron 이 종결한다(계약 §6-1).
    if (w.tainted) return;
    const replay = lastFinishedReplay;
    if (replay === null) return;
    resultOverlay.updateCommission({ status: 'pending' });
    const res = await submitCommissionRun(runId, replay);
    if (res.status === 'verified') {
      // 서버 원장이 정본 — 가산하지 않고 잔액을 그대로 받는다.
      profile.credits = res.creditsLeft;
      profile.minerals = res.mineralsLeft;
      // 확정 경험치(종이에 적힌 값) — **서버가 승인한 뒤에만** 지급한다. 재화와 달리 XP 는
      // 서버 원장이 없어(프로필 blob 축) 잔액을 받아올 수 없으므로 여기서 가산한다. 위조
      // 표면은 늘지 않는다: 이 경로는 `verified` 안쪽이고 값은 봉인된 payload 의 순수 파생이다.
      //
      // ⚠️ 런 안에서 번 XP 는 이미 `settleRun` 이 넣었다 — 이것은 그 **위에 얹는 확정분**이다.
      // 정예 소집령은 런 내 성장이 통째로 꺼져 있어(ADR-0043) 이 경로가 유일한 XP 공급원이다.
      let grantedXp = 0;
      let xpLevels = 0;
      if (paper !== null) {
        grantedXp = commissionXpReward(paper);
        xpLevels = grantXp(activeShip(profile), grantedXp);
        profile.skillPoints += xpLevels;
      }
      saveProfile(profile);
      resultOverlay.updateCommission({
        status: 'verified',
        grantedCredits: res.grantedCredits,
        grantedMinerals: res.grantedMinerals,
        grantedXp,
        xpLevels,
      });
      // 확정 지급물(유니크·설계도) 배송. **`res.grants` 는 "배송할 것이 생겼다"는 신호로만
      // 쓴다** — 그 배열에는 `grant_id` 가 없어(settle_commission 이 kind/slot_index/item_payload
      // 만 담는다) 아이템 id·어픽스 시드·배송 표시를 걸 축이 없다. 실제 값은 원장을 다시 읽어
      // 얻는다(commissionGrantDelivery.ts 머리 참조). 비어 있으면 왕복을 아낀다.
      if (res.grants.length > 0) void runCommissionGrantDelivery();
      return;
    }
    if (res.status === 'rejected') {
      resultOverlay.updateCommission({
        status: 'rejected',
        ...(res.reason !== undefined ? { reason: res.reason } : {}),
      });
      return;
    }
    resultOverlay.updateCommission({ status: res.status });
  }

  /** Settle a finished run into the profile once, then show the result screen. */
  function endRun(w: WorldState): void {
    // 끝난 런의 리플레이 + **그 시점 월드 해시**를 짝으로 잡아 둔다(DEV 하네스 재생·재현
    // 대조용). 정식 침공 분기(finishInvasionRun)도 이 함수를 거쳐 들어오므로 여기 한 자리면
    // PvE·침공·하네스 침공이 모두 덮인다. 순수 보관이라 정산·제출 경로와 무관하고, 오염 런도
    // **재생만** 가능하다(제출은 별개 가드).
    if (recorder !== null) {
      lastFinishedReplay = recorder.toReplay();
      lastFinishedHash = hashWorld(w).toString(16).padStart(8, '0');
    }
    // 침공 런은 PvE 정산이 아니라 서버 제출로 분기한다(서버 권위). finishInvasionRun 이
    // settled 를 즉시 세워 프레임당 재진입을 막는다.
    if (invasionTarget !== null) {
      void finishInvasionRun(w);
      return;
    }
    // 이번 런에서 파생·적립한 촉매 드랍(결과 오버레이 표시용). 오염/하네스 침공 런은
    // 정산 블록에 들어가지 않으므로 0·빈 배열로 남는다(격리면 안에서만 적립·표시).
    // 총량과 내역을 **둘 다** 남긴다 — 총량은 정산 수치 줄, 내역은 아이콘 칩 줄이 쓴다.
    let catalystDropTotal = 0;
    let catalystDropList: readonly { readonly id: number; readonly qty: number }[] = [];
    /**
     * 서버 권위 모드에서 **서버에 주장한 전리품 개수**(압류·소멸을 이미 뺀 값). 0 보다 크면
     * 정산 화면의 "회수 N점"이 이 값으로 서고 '획득 장비'는 배송을 기다린다.
     *
     * 로컬 롤(오프라인)·오염 런·발급 실패는 0 으로 남는다 — 전자는 `itemsGained` 가 실물을
     * 이미 들고 있고, 후자 둘은 애초에 전리품이 없다.
     */
    let claimedServerDrops = 0;
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
        // ⭐ 서버 권위 드랍(ADR-0050 §3 단계 1) — 이 런이 원장에 등록됐으면 전리품을 **여기서
        // 굴리지 않는다.** 클라는 아래에서 주운 **개수만** 주장하고, 서버가 자기 시드로 굴려
        // 원장에 적은 것을 배송 경로가 받아 온다(「개수만 계약」).
        // ⭐ **강등은 「미설정」에만 남는다**(2026-08-08 사용자 판정 · ADR-0050 §3 단계 1
        // save 봉인과 한 쌍이다).
        //
        // 종전에는 `dropRunId === null` 이기만 하면 로컬 롤로 강등했다. 그런데 그 산출물은
        // `it-{seed}`(`src/items/roll.ts:168`)라 **원장에 없고**, save 증가분 봉인
        // (`20260808040000_save_item_seal.sql`)이 그것을 들어낸다. 즉 온라인 계정에서
        // 강등을 남겨 두면 **클라가 심고 서버가 지우는** 상태가 되어, 정직한 플레이어가
        // *"분명 주웠는데 사라졌다"* 를 겪고 원인이 화면에 안 나온다 — 이 리포가 반복해
        // 대가를 치른 「조용히 갈리는 두 자리」 패턴이다.
        //
        // ⇒ 설정된 계정(`isNetConfigured()`)에서 등록이 없으면(네트워크 실패·축 D 캡 초과)
        //    **전리품 0** 으로 둔다. 캡 초과분이 조용히 심어지던 구멍도 함께 닫힌다.
        // ⛔ **미설정 경로의 로컬 롤은 지우지 마라** — 그것이 데모/하네스가 로그인 없이
        //    플레이되는 근거다(계획서의 ⛔"강등을 없애지 마라"는 이쪽을 가리킨다).
        const serverDrops = dropRunId !== null || isNetConfigured();
        // ⚠️ **XP 적립 전에** 읽는다. 전리품은 런 도중에 떨어진 것이라 기준 레벨은 런을 시작할
        // 때의 레벨이어야 한다 — 적립 후에 읽으면 이 런에서 오른 레벨만큼 상한이 함께 올라가,
        // 방금 레벨업한 런에서만 더 무거운 장비가 나오는 비대칭이 생긴다.
        // (`settleRun` 이 로컬 롤 경로에서 같은 이유로 같은 시점에 읽는다 — settlement.ts:153-156.)
        const dropLevelCap = activeShip(profile).level;
        // 촉매 정산 채널(ADR-0052). 순수 리더 — 무촉매 런은 undefined 다(아래 스프레드 참조).
        const catalystSettlement = catalystSettlementOf(w);
        // 촉매별 기여 명세(헌장 §귀속 규율 2). 같은 규율의 두 번째 순수 리더 — 무촉매 런과
        // 적립이 한 번도 없던 런은 undefined 다.
        const catalystContributions = catalystContributionsOf(w);
        // 드랍 축 **실측** 배율(2026-08-08 2차 지시 — 설계도·의뢰서도 드랍 축을 탄다).
        // 세 번째 순수 리더이고 같은 규율이다: 무촉매 런·드랍 축 미발동 런은 undefined.
        // sim 이 축 상한(공명 포함)으로 이미 클램프해 내보내므로 여기서 다시 자르지 않는다 —
        // 두 곳에서 자르면 어느 쪽이 물었는지 알 수 없어진다.
        const catalystLootMult = catalystLootMultOf(w);
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
          // 행성 인기 배율 관통(ADR-0038): 정산이 XP 30% 하한을 **감쇠×배율 합성**에 다시 거는
          // 데 쓴다. 침공·오프라인 런은 config 에 필드가 없어 undefined → 중립(구 경로 산술 동일).
          // ⚠️ 2026-08-08 까지는 소비처가 하나 더 있었다(특산 설계도 동반 확률 역수 보정).
          // 설계도가 런 단위 3% 게이트로 바뀌며 그 보정이 사라져 **지금은 XP 축 하나**다.
          ...(w.config.planetMultCenti !== undefined
            ? { planetMultCenti: w.config.planetMultCenti }
            : {}),
          // 의뢰 런 표식(계약 §10 A-8) — 정산이 **최고 클리어 단계를 갱신하지 않게** 하는
          // 유일한 신호다. 술어 정본은 `config.commission`(런타임 파생 금지).
          commission: w.config.commission !== undefined,
          // 촉매 정산 채널(ADR-0052 · id 5·18·21 의 선결). 순수 리더가 **원시 number[] 복사본**
          // 만 내놓고, 무촉매 런은 `undefined` 라 스프레드가 필드를 아예 안 싣는다 → 무촉매 런의
          // 정산 입력은 종전과 바이트 동일하다. 값의 의미는 `catalystSlots.ts` 배정표 소유.
          ...(catalystSettlement !== undefined ? { catalystSettlement } : {}),
          // 촉매별 기여 명세(헌장 §귀속 규율 2 — 발동 횟수 / 번 액수 / 놓친 액수). 위와 같은
          // 스프레드 규율이라 무촉매 런의 정산 입력은 종전과 바이트 동일하다.
          ...(catalystContributions !== undefined ? { catalystContributions } : {}),
          // 드랍 축 실측 배율 → 설계도 3% 게이트의 스케일. 같은 스프레드 규율이라 무촉매 런의
          // 정산 입력은 종전과 바이트 동일하다.
          ...(catalystLootMult !== undefined ? { catalystLootMult } : {}),
        }, { serverDrops });
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
        if (lastOutcome.commission) {
          // 의뢰 런은 **클라 `settlePveRunCurrency` 경로를 타지 않는다**(계약 §10 A-8b · 계획 D5).
          // 의뢰 보상은 종이에 적힌 확정분이라 서버 원장이 리플레이 검증 후 지급한다 — 클라가
          // 자원→크레딧 환산을 올리면 같은 런이 두 축으로 지급된다.
          //
          // ⚠️ **사연 보상만은 반드시 별도로 지급한다**(D11). `applyStoryProgress` 가 claim 원장을
          // 이미 소진했으므로, 여기서 안 부르면 챕터 보상 크레딧이 **영영 증발**한다(1회성이라
          // 재시도할 claim 자체가 남지 않는다). 오프라인이면 아래 로컬 미러 폴백과 같은 취급.
          if (storyReward > 0) {
            if (isNetConfigured()) {
              void grantCurrencyToServer(storyReward, 0, 'story').then((r) => {
                if (r.status === 'applied') {
                  profile.credits = r.creditsLeft;
                  profile.minerals = r.mineralsLeft;
                }
              });
            } else {
              profile.credits += storyReward;
            }
          }
          // ⚠️ 실제 RPC 형태(의뢰 정산·확정 보상 수령)는 **서버 레인 계약**이 확정한다.
          // PA 레인은 여기까지 — "PvE 정산에 타지 않는다"는 분기와 사연 보상 배선만 진다.
        } else if (isNetConfigured()) {
          void settlePveRunCurrency(profile, {
            summary: {
              victory: w.victory,
              // 의뢰서 발령 자격의 두 번째 주장(서버 2단계 `victory and bossKilled`).
              // ⚠️ 이 줄이 **없어서** 발령률이 0% 였다 — 서버가 읽는 키를 클라가 한 번도 안
              // 보냈고, NULL 이 `claimed_victory not null` 을 위반해 앵커까지 지워졌다(무증상).
              // 술어 정본은 sim 리더다(`bossKilledOf` — 여기서 다시 조립하면 정본이 둘이 된다).
              bossKilled: bossKilledOf(w),
              planet: w.config.planet ?? 0,
              stage: w.config.stage ?? 1,
              finalTick: w.tick,
              resources: creditsGained,
              minerals: 0,
              kills: w.kills,
              // 텔레메트리(ADR-0051) — 기체·레벨·XP·드랍 수. `settle_pve_run` 이 p_summary 를
              // 그대로 `pve_runs.summary` 에 적재하므로 이 네 필드는 서버 SQL 무수정으로
              // 일별 롤업(20260808050000)까지 흐른다. shipType 미지정 런은 0(스트라이커) 취급
              // (world.ts 의 조건부 폴드 규율과 동일선상).
              shipType: w.config.shipType ?? 0,
              playerLevel: w.level,
              xpTotal: w.xpTotal,
              dropCount: w.loot.length,
              // 촉매 소모 영수증 런 id 관통(ADR-0029): consume 성공 시 buildRunConfig 가
              // config.runId 로 스탬프한 값을 그대로 실어, 서버 settle_pve_run 이 이 id 로 pending
              // 영수증(자원 배율)을 조회해 캡을 상향한다. 무촉매 런은 undefined → 기존 base 경로.
              ...(w.config.runId !== undefined ? { runId: w.config.runId } : {}),
              // 행성 인기 배율 epoch 관통(ADR-0038): **배율값이 아니라 epoch 만** 보낸다.
              // 서버 settle_pve_run 이 그 epoch 의 자기 스냅샷에서 배율을 읽어 자원 지급 상한을
              // 재산정한다 — 클라 주장 배율은 위조 표면이라 애초에 전송하지 않는다(촉매
              // resource_mult 영수증과 같은 규율, 추가 RPC 0). 오프라인 런은 undefined.
              ...(w.config.planetMultEpoch !== undefined
                ? { epoch: w.config.planetMultEpoch }
                : {}),
              // 촉매 드랍 축 실측 배율 → 의뢰서 발령 확률의 스케일(게이트 4b). **centi 정수**로
              // 보낸다 — 서버 산술이 정수라야 TS 짝 `scaleGateChanceCp` 와 반올림까지 같아진다.
              // ⚠️ 바로 위 epoch 과 정반대 판단(값을 직접 보낸다)인 근거는 PveSettleSummary 주석.
              // 무촉매·드랍 축 미발동 런은 undefined → 필드 미전송 → 서버가 100 으로 접는다.
              ...(catalystLootMult !== undefined
                ? { catalystLootMultCenti: Math.round(catalystLootMult * 100) }
                : {}),
            },
            storyRewardCredits: storyReward,
          }).then(() => reportCommissionIssue());
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
          // 촉매 드랍축 4종(id 21·33·38·45)의 배율. ⚠️ **주입 목록이 아니라 귀속 원장**에서
          // 나온다 — 카드를 꽂았다는 사실만으로 서는 배율은 헌장 §상한 근거 규율이 금지한
          // 무조건 배율이고, 구 모델이 정확히 그 실수를 했다(인계 §5-3).
          // 무촉매 런은 `catalystContributions` 가 undefined 라 **필드를 아예 안 싣는다** →
          // 입력 객체 형상까지 종전과 동일하다(드랍 결과는 물론 비트 동일).
          ...(catalystContributions !== undefined
            ? { catalystDropMult: catalystDropMultFromContributions(catalystContributions) }
            : {}),
        });
        catalystDropTotal = catalystDrops.reduce((n, d) => n + d.qty, 0);
        catalystDropList = catalystDrops;
        void grantCatalystDrops(catalystDrops);
        // PvE 런 결과(정산된 메타: 아이템·XP·진행도 — 재화는 서버 컬럼 정본이라 미러만)를 서버
        // save 에 반영. 미설정이면 no-op, 실패 시 로컬 대기 슬롯에 남아 재시도(오프라인 우선).
        // ADR-0026: 리플레이 업로드(recordPveRun/pve_runs)는 폐기했다 — 재화가 서버 권위라
        // 사후 샘플링 재검증이 불필요해졌다(ReplayRecorder 는 침공 제출용으로만 살아있다).
        void recordPveRunResult(profile);
        // ⭐ 서버 드랍 발급 + 배송(ADR-0050 §3 단계 1). 클라는 **주운 개수만** 주장하고
        // 서버가 개연성 캡으로 깎은 뒤 자기 시드로 굴린다. `recordPveRunResult` **뒤**여야
        // 한다 — 배송이 자기 순서 계약(저장 → push → 재-pull → 표시)을 도는 동안 그 앞의
        // push 가 끼어들면 재-pull 확인이 흔들린다.
        // 실패해도 원장 행은 서버에 남으므로 **다음 부팅의 배송 재개**가 줍는다.
        if (serverDrops && dropRunId !== null) {
          // `id 18 mercantile` 압류와 도박 강 '청산' 소멸을 **서버 권위 경로에도 실제로
          // 적용**한다. 이 모드에서 settleRun 은 전리품을 굴리지 않으므로(itemsGained 가 빈
          // 배열) 정산이 뺄 아이템이 없다 — 둘이 일어나는 유일한 자리가 여기, 클라가 주장하는
          // **개수**다. 이걸 안 깎으면 결과 화면은 "N점 압류"라고 적는데 서버는 전량을
          // 배송한다(이 리포가 반복해 대가를 치른 「화면과 실제가 조용히 갈리는 두 자리」).
          //
          // ## ✅ 이 클라측 감산은 안전하다 — 2026-08-08 코드 검토 결론(재조사 금지)
          // 배선 레인이 *"서버 레인이 알지 못하는 클라측 감산"* 이라 검토 대상으로 남긴
          // 자리다. 세 축을 실제로 읽고 확인했다:
          //  ① **서버 검증은 천장뿐이다.** `grant_run_drops` 는
          //     `v_grant := least(claimed, 시간개연성, CAP_DROPS_PER_RUN)`
          //     (`supabase/migrations/20260808010000_item_grants_ledger.sql`)로 **줄이기만**
          //     한다. 주장을 낮추면 결과는 같거나 더 작다 — 낮춘 주장이 더 많은 지급을 만드는
          //     경로가 원리적으로 없다.
          //  ② **원장·영수증과 갈릴 수 없다.** `item_grants` 행은 `v_grant` 개수만큼 **그
          //     자리에서** 만들어지므로 "클라가 받았어야 할 수"라는 별도 서버 기대값이 존재하지
          //     않는다. 영수증의 `claimed` 는 클라가 보낸 값 그대로라, 이미 깎아서 보낸 수가
          //     그대로 실린다(정직한 플레이면 `clamped` 는 계속 false 다).
          //  ③ **화면과 실지급이 같은 수를 쓴다.** 결과 화면의 `debtSeized` 와 여기 `seized` 는
          //     **같은 `lastOutcome.catalystDebt.seized`** 한 값에서 나온다(두 번 계산하지
          //     않는다). 서버 모드의 "획득 N점"은 `itemsGained.length` = 0 이라 압류분을 이중
          //     계상하지도 않는다.
          // 결론: 고칠 것이 없다. **깎는 쪽을 늘릴 때는 반드시 이 세 축을 다시 확인해라** —
          // 특히 ①이 깨지는(주장을 하한으로도 쓰는) 서버 변경이 오면 이 감산이 손해가 된다.
          const seized = lastOutcome?.catalystDebt?.seized ?? 0;
          const voided = lastOutcome?.sealedVoided ?? 0;
          // 화면과 발급이 **같은 수**를 쓴다(위 축 ③과 같은 규율) — 정산의 "회수 N점"도 이
          // 값이다. 두 자리에서 따로 계산하면 압류·소멸이 한쪽에만 반영돼 또 갈린다.
          claimedServerDrops = Math.max(0, w.loot.length - seized - voided);
          void deliverRunDrops(dropRunId, claimedServerDrops, {
            planet: w.config.planet ?? 0,
            stage: w.config.stage ?? 1,
            levelCap: dropLevelCap,
          });
        }
      }
    }
    tutorialOverlay.hide();
    if (powerupOverlay.visible) powerupOverlay.hide();
    shownLevel = 0; // 정산 화면 진입: 오버레이 표시 상태 초기화
    harnessInvasionRun = false; // 하네스 침공 런 종료(다음 런은 정식 경로)
    clearInvasionBackdrop(); // 정산 화면은 침공 배경을 쓰지 않는다
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
        // ⚠️ **누적 틱 기준**이다. 의뢰 다구간 런은 `w.tick` 이 구간마다 0 으로 돌아가므로
        // 그대로 쓰면 **마지막 구간의 시간만** 보인다(5구간 의뢰가 30초로 표시되고, 런 중
        // HUD 타이머는 구간이 넘어갈 때마다 0 으로 되감긴다).
        // 무의뢰 런은 `commissionRuntime` 이 없어 `w.tick` 그대로다(표시 바이트 불변).
        timeSec: (w.commissionRuntime?.totalTicks ?? w.tick) / 60,
        // 승리 문구가 격파한 보스 이름을 이 값에서 파생한다(카르곤 고정 결함 — 2026-07-27).
        planet: w.config.planet ?? 0,
        ...(o !== null
          ? {
              settlement: {
                // ⭐ 회수 점수는 **두 모드가 서로 다른 자리에서 온다.**
                //  - 로컬 롤(오프라인) → `itemsGained` 가 곧 실물이라 그 길이가 정답이다.
                //  - 서버 권위 → `itemsGained` 는 **항상 빈 배열**이다(settleRun 이 굴리지
                //    않는다). 그래서 서버에 주장한 개수(`claimedServerDrops`)를 쓴다 —
                //    `SettleRunOptions.serverDrops` 주석이 처음부터 그렇게 쓰라고 적어 둔
                //    값이고, 화면이 그걸 안 읽어서 "회수 0점"이 뜨고 있었다(2026-08-09).
                itemsGained: claimedServerDrops > 0 ? claimedServerDrops : o.itemsGained.length,
                levelsGained: o.levelsGained,
                skillPointsGained: o.skillPointsGained,
                creditsGained: o.creditsGained,
                overflow: o.overflow,
                // 이번 런에 얻은 촉매 총량 + 내역(ADR-0029) — 있을 때만 정산 항목으로 노출.
                // 내역이 있으면 정산이 개별 아이콘 칩으로 편다(사용자 요청 2026-07-28).
                ...(catalystDropTotal > 0
                  ? { catalystDrops: catalystDropTotal, catalystDropList }
                  : {}),
                // `id 18 mercantile` — 상환분과 압류분을 **갈라서** 넘긴다(ADR-0052 명세 `신호:`).
                // 부채가 없으면 `catalystDebt` 자체가 없어 두 칸 다 안 실린다.
                ...(o.catalystDebt !== undefined && o.catalystDebt.repaid > 0
                  ? { debtRepaid: o.catalystDebt.repaid }
                  : {}),
                ...(o.catalystDebt !== undefined && o.catalystDebt.seized > 0
                  ? { debtSeized: o.catalystDebt.seized }
                  : {}),
                // M5 C2: 획득 전투력 합계 + 등급별 장비 칩 목록(정산 완성판).
                //
                // 서버 권위 모드에서는 이 둘이 **여기서 채워질 수 없다** — 무엇이 나왔는지는
                // 서버만 알고, 클라는 배송 왕복이 끝나야 안다. 그래서 빈 채로 열고
                // `dropsPending` 을 세워 화면이 "수령 중…"이라고 말하게 한 뒤,
                // `deliverRunDrops` 가 `updateDrops()` 로 실물을 갈아끼운다.
                combatPower: totalCombatPower(o.itemsGained),
                drops: o.itemsGained.map(resultDropOf),
                ...(claimedServerDrops > 0 ? { dropsPending: true } : {}),
                // 설계도 획득(사용자 요청 2026-08-09). 정산이 이미 손에 쥔 목록인데 화면에
                // 닿는 경로가 없어 `grantBlueprintDrops` 로 **서버로만 흘러가고** 있었다 —
                // 얻었는지 알려면 관제탑 → 방어 사령부까지 들어가 보유량을 세야 했다.
                // 표시명은 여기서 한 번만 해석한다(`catalogName` 이 유일한 정본).
                ...(o.blueprintsGained.length > 0
                  ? {
                      blueprintGains: o.blueprintsGained.map((b) => ({
                        name: catalogName(b.kind, b.catalogId),
                        count: b.count,
                      })),
                    }
                  : {}),
              },
            }
          : {}),
      },
      // '다시 출격' = 다음 런으로 바로 간다 → 성계 지도(행성·단계·촉매 선택). 예전에는 기지
      // 지도로 돌아가 다시 성계 지도를 열어야 했다(사용자 신고 2026-07-27) — 버튼 문구가
      // 약속하는 동작과 실제 이동이 어긋나 있었다. 정비하러 갈 길은 옆 '격납고' 버튼과
      // 성계 지도의 '뒤로'(→ 기지)가 그대로 제공한다.
      () => openStarMap(),
      () => {
        resultOverlay.hide();
        inventory.show(profile, () => openBaseMap());
      },
    );
    // 의뢰 런이면 리플레이를 제출한다(계약 §7).
    // ⚠️ **`show()` 뒤여야 한다.** `submitCommissionReplay` 는 첫 `await` 전에 동기로
    //    `updateCommission({status:'pending'})` 을 부르는데, 그 메서드는 오버레이가 안 보이면
    //    즉시 return 한다(멱등 가드). `show()` 앞에서 부르면 그 시점 오버레이는 아직
    //    `startCommissionRun` 의 `hide()` 상태라 **"확인 중…" 이 영영 안 뜨고** 검증 왕복 수 초
    //    동안 화면이 비었다가 갑자기 항목이 생긴다.
    void submitCommissionReplay(w);
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

  /**
   * 서버 프로필을 받아오는 동안 띄우는 최소 오버레이.
   *
   * Pixi 화면 상태 기계(`setScreen`)를 건드리지 않으려고 **DOM** 으로 만든다 — 부팅 도중은
   * 아직 어떤 화면도 열리지 않은 구간이라 화면 스택에 끼워 넣으면 규약이 지저분해진다.
   * 없으면 사용자는 까만 화면만 보고 기다린다(대개 수백 ms 지만, 토큰 갱신이 끼면 더 길다).
   */
  function showBootOverlay(): () => void {
    if (typeof document === 'undefined') return () => {};
    const el = document.createElement('div');
    el.textContent = t('title.loading');
    el.setAttribute(
      'style',
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'color:#ebdcbe;font-family:sans-serif;font-size:18px;letter-spacing:1px;' +
        'background:#05060a;z-index:10;pointer-events:none;',
    );
    document.body.appendChild(el);
    return () => el.remove();
  }

  /**
   * 로그아웃 — 세션 해제 → 로컬 계정 데이터 삭제 → **페이지 새로고침**.
   *
   * ## 왜 새로고침인가
   * 메모리에는 이 계정으로 만든 상태가 넓게 퍼져 있다 — `profile` 객체를 캡처한 화면 수십 개,
   * 열린 월드, 인기 배율 폴링 타이머, 각 화면의 캐시. 그걸 하나씩 되돌리는 코드는 만드는 순간
   * 낡기 시작하고, **빠뜨린 하나가 곧 다음 계정으로 새는 데이터**다. 새로고침은 그 전부를
   * 한 번에, 빠뜨림 없이 없앤다. 로그아웃은 드문 조작이라 비용도 문제가 안 된다.
   *
   * 순서가 중요하다: 세션을 먼저 끊어야 새로고침 후 부팅이 "미로그인"으로 판정한다.
   */
  /**
   * 설정 '계정' 행에서 누른 로그인. 성공하면 브라우저가 구글로 떠나므로 뒤 코드는 안 돈다.
   *
   * 타이틀의 로그인과 실패 처리가 다르다 — 여기서는 화면을 옮기지 않고 팝업에 안내만 띄운다.
   * 설정은 어느 화면 위에서든 열 수 있어서, 실패했다고 타이틀로 끌고 가면 플레이 중이던
   * 화면이 날아간다.
   */
  function handleSignIn(): void {
    void signInWithGoogle().then((failure) => {
      if (failure === null) return;
      settings.setAccountNotice(t('title.signInFailed'));
    });
  }

  function handleSignOut(): void {
    void (async () => {
      await signOut();
      clearAccountScope(accountStore());
      if (typeof location !== 'undefined') location.reload();
    })();
  }

  /**
   * 부팅 — 로그인 게이트 → 계정 스코프 정리 → 서버 프로필 pull → 인트로/타이틀.
   *
   * ## 왜 pull 을 기다리는가
   * `openIntroOrTitle` 은 `profile.introSeen`·`profile.tutorialDone` 으로 분기한다. 계정이
   * 바뀌어 로컬을 비운 직후(= 기기 이관)에는 둘 다 false 라, 먼저 그리면 **이미 다 본 유저에게
   * 인트로 4컷과 튜토리얼이 다시 뜬다**. 재화도 0 으로 잠깐 보인다. 로그인 필수 게임에서
   * 기기 이관은 주 사용 사례이므로 짧은 대기를 택했다.
   *
   * ## 실패해도 진행한다
   * pull 이 실패하면(오프라인 등) 로컬 상태 그대로 진입한다 — 세션 끊김을 오프라인으로
   * 강등하는 규율과 같다. 못 보낸 것들은 대기 큐에 남아 다음 기회에 재전송된다.
   */
  async function bootWithAuth(): Promise<void> {
    if (!isLoginConfigured()) {
      openIntroOrTitle();
      return;
    }
    const dismiss = showBootOverlay();
    try {
      const user = await getSignedInUser();
      if (user === null) {
        settings.setAccount({ signedIn: false, onSignIn: handleSignIn });
        // **미로그인이면 타이틀 버튼 자리에 Google 버튼이 선다** — DEV 여부와 무관하다.
        //
        // 처음에는 DEV 에서 게이트를 통째로 끄고 그냥 들여보냈는데, 그러면 그 하나뿐인 버튼이
        // "기지로 진입"이 되어 **로그인 버튼이 화면에서 사라진다**(사용자 신고). 로컬에서 실제
        // 왕복을 시험할 수 없으니 DEV 우회의 목적 자체가 무너진다.
        //
        // 하네스는 `?harness=1` 이라는 **명시적 스위치**로 빠져나간다. 프로필 I/O 를 격리
        // 슬롯으로 돌리는 그 스위치가 이미 "지금은 테스트 중"이라는 선언이므로, 로그인
        // 우회도 여기에 얹는 것이 맞다 — DEV 전체를 뚫는 것보다 훨씬 좁다.
        if (!harnessActive) {
          openTitle(true);
          return;
        }
        openIntroOrTitle();
        return;
      }
      // 계정이 바뀌었으면 로컬 계정 데이터를 버리고 **메모리의 profile 도** 기본값으로
      // 되돌린다. 저장소만 비우면 이미 로드된 이전 계정 프로필이 그대로 살아 서버로 올라간다.
      if (reconcileAccountScope(accountStore(), user.id)) {
        // 새 계정 = 세이브 없는 조종사다 → 기본 장비가 실린 신규 프로필(맨몸 스키마 기본값이
        // 아니다 — `defaultProfile` 주석의 구분 참조).
        //
        // 게스트는 그 자리에 **중반 진행 프리셋**이 들어간다(사용자 결정, 2026-08-09). 계정
        // 없이 잠깐 보는 사람에게 초반 몇 분이 게임의 전부로 보이지 않게 하려는 것이다.
        // 아래 `pullServerProfileInto` 가 서버 행을 찾으면 그쪽이 이긴다 — 즉 **이 프리셋은
        // 서버에 아직 아무것도 없는 첫 부팅에서만** 출발점이 되고, 이어서 하는 게스트는
        // 자기 진행을 그대로 받는다.
        Object.assign(profile, user.isGuest ? guestPresetProfile() : newPlayerProfile());
      }
      // 설정 팝업의 '계정' 행(이메일 + 로그아웃). 미로그인·미설정이면 행 자체가 안 그려진다.
      settings.setAccount({
        signedIn: true,
        email: user.email,
        isGuest: user.isGuest,
        onSignOut: handleSignOut,
      });
      await pullServerProfileInto(profile);
      saveProfile(profile);
      // 게스트라면 서버가 정본인 축(촉매·설계도·방어체·배치·순위·의뢰서)을 시드한다.
      //
      // **순서가 계약이다**: 시드 RPC 는 `profiles` 행이 있어야 돈다(그 테이블들이 전부 FK 로
      // 물고 있다). 그래서 세이브를 **먼저 올리고 성공을 확인한 뒤**에 부른다 — 아래
      // `migrateLocalProfileToServer` 는 진행도 가드가 있어 이 자리에 못 쓴다(비교 대상이
      // 없는 신규 계정에서 무엇이 올라갈지 보장하지 않는다).
      //
      // 실패는 삼킨다. 시드는 편의지 전제가 아니고, 서버가 1회성을 지키므로 다음 부팅에서
      // 다시 시도해도 지급이 늘지 않는다.
      if (user.isGuest) {
        void pushProfileToServer(profile).then((pushed) => {
          if (pushed) void seedGuestAccount();
        });
      }
      // 세션이 생긴 지금이 이관·회수의 자리다(부팅 즉시 부르면 세션이 없어 전부 no-op 이었다).
      void migrateLocalProfileToServer(profile);
      void flushPendingCommissionSubmissions();
      // 미배송 확정 지급물 회수 — 제출 직후에 앱이 죽었거나 오프라인이었던 런의 물건이
      // 여기서 들어온다(유실 0). 원장이 정본이라 중복 배송은 구조적으로 없다.
      void runCommissionGrantDelivery();
      // 서버 드랍 원장도 같은 이유로 부팅에서 재개한다(ADR-0050 §3 단계 1) — 정산 직후에
      // 앱이 죽었거나 오프라인이었던 런의 전리품이 여기서 들어온다. 발급은 이미 서버에
      // 적혀 있으므로 배송만 다시 돌면 되고, `hasItemId` 로 멱등이라 중복이 없다.
      void runItemGrantDelivery();
      // 일일 보상 배송함도 같은 이유로 부팅에서 재시도한다 — 세이브 반영 뒤 `mark_applied`
      // 전에 죽으면 그 행은 `applied_at IS NULL` 로 남고, 반영이 `hasItemId` 로 멱등이라
      // 다시 반영해도 아이템이 늘지 않는다(유실 0 · 중복 0).
      void flushPendingDailyRewardDeliveries(profile, dailyDeps()).then((changed) => {
        if (changed) saveProfile(profile);
      });
      openIntroOrTitle();
    } finally {
      dismiss();
    }
  }

  // 부팅 — 첫 실행이면 세계관 인트로를 먼저 1회, 그 뒤 타이틀(첫 실행은 튜토리얼 강제 → 기지 맵).
  void bootWithAuth();

  gameApp.app.ticker.add((ticker) => {
    // 설정은 모든 화면 위에 떠 있는 크롬 UI 다 — 다른 캔버스 화면이 show() 에서 자기를 맨
    // 앞으로 올리므로 매 프레임 되돌린다(이미 마지막 자식이면 no-op).
    settings.raise();

    let frame = ticker.deltaMS / 1000;
    if (frame > 0.25) frame = 0.25; // clamp to avoid spiral-of-death after stalls

    // 타이틀 연출(패럴랙스·티끌·광선·3D 함선)은 여기서만 진행한다. 화면이 숨겨져 있으면
    // 내부에서 즉시 반환하므로 런 중 비용은 0 이다 — 특히 3D 는 이 호출이 유일한 렌더 지점이라
    // 타이틀 밖에서는 GPU 를 아예 쓰지 않는다.
    titleScreen.update(frame);

    // 기지 허브 연출(배경 패럴랙스·티끌·광선·타일 호버·출격 CTA 맥동)도 같은 규약이다 —
    // 화면이 숨겨져 있으면 내부에서 즉시 반환하므로 런 중 비용은 0 이다.
    baseMap.update(frame);

    // 격납고 시네마틱 연출(배경 패럴랙스·창 안 티끌·램프 맥동·패널 광택 호흡)도 같은 규약이다 —
    // 화면이 숨겨져 있으면 내부에서 즉시 반환하므로 격납고 밖에서는 비용이 0 이다.
    inventory.update(frame);

    // 연구소 시네마틱 연출도 같은 규약이다(2026-08-02 AAA 전환) — 연구소는 격납고 하위가 아니라
    // main.ts 가 직접 여는 최상위 화면이라, 여기서 dt 를 흘리지 않으면 배경·패널 연출이 통째로
    // 멈춘다. 숨겨져 있으면 내부에서 즉시 반환하므로 연구소 밖 비용은 0 이다.
    researchLab.update(frame);
    // 정제소도 같은 부류다(2026-08-02 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt 공급원이다.
    refinery.update(frame);
    // 방어 사령부도 같은 부류다(2026-08-02 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt
    // 공급원이다. 빠뜨리면 배경·석재 패널 연출이 통째로 멈춘다(연구소에서 실제로 겪었다).
    defenseCommand.update(frame);
    // 관제탑도 같은 부류다(2026-08-03 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt
    // 공급원이다. 빠뜨리면 배경·석재 패널 연출이 통째로 멈춘다(연구소에서 실제로 겪었다).
    controlTower.update(frame);
    // 기록 보관소도 같은 부류다(2026-08-03 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt
    // 공급원이다. 빠뜨리면 배경·석재 패널 연출이 통째로 멈춘다(연구소에서 실제로 겪었다).
    recordsArchive.update(frame);
    // 지시 수신소도 같은 부류다(2026-08-03 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt
    // 공급원이다. 빠뜨리면 배경·석재 패널 연출이 통째로 멈춘다(연구소에서 실제로 겪었다).
    commissionDesk.update(frame);
    // 성계 지도도 같은 부류다(2026-08-03 AAA 전환) — 최상위 화면이라 여기 배선이 유일한 dt
    // 공급원이다. 빠뜨리면 배경·석재 패널·전장 창 연출이 통째로 멈춘다(연구소에서 실제로 겪었다).
    planetSelect.update(frame);
    // 코어 모듈 화면도 같은 부류다(2026-08-03 AAA 전환). 사령부에서 suspend/resume 으로 오가는
    // 하위 화면이지만 dt 공급원은 여기뿐이다 — 빠뜨리면 배경·석재 패널 연출이 통째로 멈춘다.
    modulesScreen.update(frame);

    /**
     * 아레나 바닥(평면 배경 + Wang 지형)의 표시 여부 — **여기가 단일 권위다.**
     *
     * ## 왜 화면 이름에서 매 프레임 도출하는가
     * 예전에는 진입 경로마다(`startRun`·침공·관전·`clearToMenu`) 각자 `background.visible` 을
     * 대입했다. 그 방식은 **경로를 하나 빠뜨리면 조용히 새는** 구조라, 실제로 메뉴 화면에
     * 아레나 타일이 비치는 신고가 두 번 나왔다(2026-08-04). 경로를 하나 더 고쳐도 다음 경로가
     * 또 남는다 — HUD 가 이미 같은 이유로 화면 이름 게이트로 옮겨 온 자리다(바로 아래
     * `hud.setVisible`). 규칙이 하나면 갈릴 수 없다.
     *
     * `result`(정산)를 포함하는 이유: 런이 끝나도 world 를 살려 두므로 정산 화면 뒤는 여전히
     * 그 런의 아레나다(`shouldEnterSettlement` 참조). 여기서 빼면 정산 뒤 바닥이 검게 빠진다.
     *
     * 평면 배경은 **Wang 지형이 없는 행성의 폴백**이라 `!autotile.active` 조건이 그대로 남는다.
     */
    const arenaScreen =
      currentScreenName === 'run' ||
      currentScreenName === 'spectate' ||
      currentScreenName === 'result';
    background.visible = arenaScreen && !autotile.active;
    // Wang 지형은 `configure()` 가 이미 `layer.visible = tiles !== null` 을 쥐고 있다 —
    // 그 의미(타일셋이 없으면 안 켠다)를 보존한 채 화면 게이트만 곱한다.
    autotile.layer.visible = arenaScreen && autotile.active;

    // ⚠️ `let` 이다 — 아래 스텝 블록에서 의뢰 구간 전환이 일어나면 `world` 가 **새 객체**로
    // 갈리므로, 스텝이 끝난 직후 재조회한다(계약 §6-2). 안 하면 프레임 나머지(HUD·오버레이·
    // 정산 판정·렌더 관측)가 통째로 죽은 월드를 읽는다.
    let w = world;
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
        // ⚠️ **루프 안에서 재조회한다.** 직전 반복이 구간을 전환했으면 `w` 는 죽은 월드고,
        // 그 월드의 플레이어 좌표로 조준을 샘플링하면 새 무대의 첫 입력이 엉뚱한 각을 문다.
        const lw = world;
        if (lw === null) break;
        const player = lw.entities[0];
        const input = controller.sample(player?.x ?? 0, player?.y ?? 0);
        stepOnce(input);
        accumulator -= DT;
        // 새 유니크 loot가 나타나면 세리머니 발동(렌더 전용, 같은 loot는 한 번만).
        ceremony.notice(currSnap);
      }
    } else if (w === null || runOver) {
      accumulator = 0; // menus / settled run: sim is inert (일시정지 런은 유지)
    }

    // ⚠️ **월드 재조회(계약 §6-2).** 위 캐치업 루프 안에서 의뢰 구간이 전환됐으면 `world` 는
    // 새 객체다. 이 한 줄이 없으면 아래 프레임 나머지가 전부 죽은 월드를 읽는데 — 그중
    // `settleIfRunOver()` 는 정산이라, 마지막 구간의 전리품·XP 가 통째로 사라진다.
    // `tests/commissionWorldRebind.test.ts` 가 이 재조회를 소스 수준에서 잠근다.
    w = world;

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

    // 침공 레이어 전환 → 배경 크로스페이드(렌더 전용, sim 무영향). 페이즈는 sim 권위라
    // 여기서는 관찰만 한다. `sync` 는 멱등이라 매 프레임 불러도 되고, 그래서 "페이즈 비교를
    // 잊어 전환이 조용히 사라지는" 결함이 구조적으로 불가능하다(invasionBackdrop.ts 머리말).
    const inv3 = w?.invasion3;
    if (inv3 !== undefined && w !== null) {
      invasionBackdrop.sync(inv3.phase, w.tick);
      // 지형 타일셋 교체는 **베일이 가장 불투명한 순간**에만 일어난다(1회 통지). 페이즈 변화
      // 순간에 갈면 교체가 맨눈에 보이고, 매 프레임 갈면 뷰포트 전체가 매 프레임 재타일된다.
      const swapPhase = invasionBackdrop.takeTerrainSwap();
      if (swapPhase >= 0) applyInvasionPhaseScenery(swapPhase, currentSeed);
    }

    // 레벨업 링(AC-4.6) — 런 레벨이 오르면 렌더러에 링을 예약(soundObserver 의 levelUp 과 동일 신호,
    // render-only). 스냅샷엔 level 이 없어 렌더가 스스로 감지 못 하므로 여기서 imperative 로 넘긴다.
    // 첫 관측(prevRingLevel<0)은 기준선만 세우고 링을 내지 않는다. 다음 render 가 플레이어 위치에 방출.
    if (w !== null) {
      if (prevRingLevel >= 0 && w.level > prevRingLevel) entityRenderer.pulseLevelUp();
      prevRingLevel = w.level;
    }

    // --- Render ---
    const alpha = accumulator / DT;
    syncEncounterArt();
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
    // 실제 보이는 design 사각형 = 화면(logical px) 네 모서리를 stage 역변환한 것.
    // DPR·비율·레터박스와 무관하게 창 전체를 덮게 하여 가장자리 빈 곳을 없앤다.
    const scr = gameApp.app.renderer.screen;
    const vTL = gameApp.stage.toLocal({ x: scr.x, y: scr.y });
    const vBR = gameApp.stage.toLocal({ x: scr.x + scr.width, y: scr.y + scr.height });
    if (autotile.active) {
      // Wang floor scrolls by panning its layer + re-tiling on boundary crossings.
      autotile.update(camX, camY, vTL.x, vTL.y, vBR.x, vBR.y);
    } else {
      const tileW = background.texture.width;
      const tileH = background.texture.height;
      background.tilePosition.set(-camX % tileW, -camY % tileH);
    }
    // 침공 전용 배경도 같은 카메라로 흘린다(자체 모듈로 규율 — f32 UV swim 방지).
    // 침공이 아니면 레이어가 `visible = false` 라 이 호출은 화면에 영향이 없다.
    if (invasionBackdrop.visible) invasionBackdrop.scroll(camX, camY);

    // 행성 환경 레이어 갱신. 비활성(비카르곤·런 아님)이면 활성 목록이 비어 있어 무비용이다.
    // 틱은 보간값을 넘긴다 — 애니메이션 위상이 sim 틱의 순수 함수라 리플레이가 재현된다.
    env.resize(vBR.x - vTL.x, vBR.y - vTL.y);
    env.update({
      camX,
      camY,
      viewMinX: vTL.x,
      viewMinY: vTL.y,
      viewMaxX: vBR.x,
      viewMaxY: vBR.y,
      tick: prevSnap.tick + (currSnap.tick - prevSnap.tick) * alpha,
      dt: frame,
    });

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
        // 카드 등장음(사용자 요청 2026-08-05). **오버레이가 실제로 뜨는 그 프레임**에만 울린다 —
        // `levelUp`(레벨 수치 상승)과 다른 사건이다: 프리즈가 걸려 화면이 멈추고 선택을 요구하는
        // 순간이 카드 등장이고, 그 둘은 같은 프레임이 아닐 수 있다(픽 소비 전 재표시 경로).
        audio.play('card');
        // `id 18 mercantile` — *"3택 한 칸이 붉은 차용증으로 바뀐다"*(ADR-0052 §신호).
        // 칸 번호는 sim 이 부채를 매길 때 쓰는 **같은 상수**에서 온다(`mercantileDebtOffer`).
        // 미소지 런·접힌 3택은 `-1` 이라 `debt` 를 아예 안 넘긴다(종전 호출과 동일).
        const debtIndex = mercantileDebtOffer(w.config.catalysts, w.powerupChoices.length);
        powerupOverlay.show(
          [...w.powerupChoices],
          readBuildStatus(w),
          (offerIndex) => {
            controller.queuePowerupPick(offerIndex);
          },
          debtIndex >= 0
            ? {
                offerIndex: debtIndex,
                perPick: MERCANTILE_DEBT_PER_PICK,
                total: mercantileDebtOf(w),
              }
            : undefined,
        );
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
    // HUD 는 **실제 런 화면에서만** 보인다. 정산(`result`)은 런이 끝난 뒤에도 world 를 살려 두므로
    // (shouldEnterSettlement 참조) 아래 `w !== null` 갱신이 계속 돌고, 게이트가 없으면 보스 예고
    // 진행 바가 결과 화면 위에 그대로 남는다(사용자 신고 2026-07-28). 화면 이름으로 게이트해
    // 메뉴 복귀 시 stale HUD 가 남는 경로까지 한 번에 막는다.
    hud.setVisible(currentScreenName === 'run' || currentScreenName === 'spectate');
    // 침공 진행 패널(사용자 요청 2026-07-29) — 읽기 전용 파생이라 sim 무영향. 침공 런이 아니면
    // `invasionHudState` 가 null 을 돌려주고 패널이 감춰진다(런이 없을 때도 동일).
    const invHud = w !== null ? invasionHudState(w) : null;
    hud.setInvasion(invHud);
    // 런 목표·주의 2줄(사용자 요청 2026-08-04) — 침공 패널과 같은 읽기 전용 파생이라 sim 무영향.
    // 이미 구한 `bossProgress`·`invasionHudState` 를 그대로 넘겨 같은 순회를 두 번 돌지 않는다.
    const eta = w !== null ? bossProgress(w) : undefined;
    hud.setObjective(w !== null ? runObjective(w, eta, invHud) : null);
    // 대피소 도달 알림(추격 모드). 도달하면 구간이 조용히 올라갈 뿐이라 화면에서는 아무 일도
    // 일어나지 않았다(사용자 신고 2026-08-04). 렌더러가 대피소 자리에 방어막 링을 터뜨리고,
    // 여기서는 **무엇이 일어났는지**를 글로 한 번 말한다. 표시 전용 — sim 무영향.
    if (w !== null && currentScreenName === 'run') {
      const secured = chaseSheltersSecured(w);
      const msg = shelterArrivalMessage(
        w.config.planetMode ?? PLANET_MODE.vampire,
        lastChaseSegment,
        secured,
        chaseShelterTotal(w),
      );
      if (msg !== null) hud.showLore([msg]);
      lastChaseSegment = secured;
    } else {
      lastChaseSegment = -1; // 런 밖에서는 기준선을 버린다(다음 런 첫 확보 오발 방지).
    }
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
      // 보스전이 **열린** 순간(엔티티 존재가 아니다 — SoundFrame.bossEngaged 주석). 추격은
      // 포식자가 처음부터 boss 로 서 있고 취약화(aux0=1)가 곧 보스전 개시다.
      const bossEngaged =
        bossEnt !== undefined && (w.config.planetMode !== PLANET_MODE.chase || bossEnt.aux0 === 1);
      // 보스 예고 루프(사용자 지시 2026-08-05) — 다가올수록 빨라지고, 열리는 순간 끊긴다.
      // ⚠️ 억제 조건은 `bossWarnSuppressed` 가 소유한다. 이 블록은 `w !== null` 하나만 두르고
      // 있어 **런이 끝난 뒤 결과 화면에서도 계속 돈다** — 보스를 잡으면 frac 이 1 로 남고
      // bossEngaged 는 거짓이 되므로 그대로 두면 최고 속도로 영원히 운다(사용자 신고 2026-08-05).
      // `runOver` 는 여기서 다시 읽는다 — 위쪽 상수는 스텝 **전**의 월드에서 뽑은 값이라
      // 이번 프레임에 끝난 런을 놓친다(§6-2 재조회 규약).
      bossWarn.tick(
        eta?.frac,
        bossEngaged,
        frame,
        bossWarnSuppressed({
          runOver: w.gameOver || w.victory,
          onRunScreen: currentScreenName === 'run',
          spectating,
        }),
      );
      soundObserver.observe(
        {
          kills: w.kills,
          level: w.level,
          playerHp: p?.hp ?? 0,
          resources: w.resources,
          bossEngaged,
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
              // 머리글은 **이 런의 행성**에서 파생한다(하드코딩 금지 — 사용자 신고 2026-07-27).
              name: bossHudName(w.config.planet),
            }
          : undefined;
      hud.update({
        hp: p?.hp ?? 0,
        maxHp: p?.maxHp ?? 0,
        xp: w.xp,
        // 분모는 **판정과 같은 함수**로 뽑는다(`checkLevelUp` 도 `xpToNextForRun`). 여기서
        // `xpToNext` 를 직접 부르면 침공 런 분모가 11배로 부푼다 — 그 함수 주석 참조.
        xpNeed: xpToNextForRun(w),
        level: w.level,
        // ⚠️ **누적 틱 기준**이다. 의뢰 다구간 런은 `w.tick` 이 구간마다 0 으로 돌아가므로
        // 그대로 쓰면 **마지막 구간의 시간만** 보인다(5구간 의뢰가 30초로 표시되고, 런 중
        // HUD 타이머는 구간이 넘어갈 때마다 0 으로 되감긴다).
        // 무의뢰 런은 `commissionRuntime` 이 없어 `w.tick` 그대로다(표시 바이트 불변).
        timeSec: (w.commissionRuntime?.totalTicks ?? w.tick) / 60,
        combo: w.combo,
        multiplier: comboMultiplier(w.combo),
        // 회수 개수(PR#366 서버 권위 드랍 후속). `w.loot` 는 push 전용이라 길이가 곧 런 전체
        // 회수 개수다(수거·보스·승리틱 엘리트 전부 여기로 쌓인다) — 새 카운터를 두지 않는다.
        lootCount: w.loot.length,
        boss,
        supplyActive,
        // 보스 등장 예고 게이지(사용자 요청 2026-07-26) — 읽기 전용 파생이라 sim 무영향.
        // 침공 런은 undefined 를 돌려주고 HUD 가 게이지를 감춘다.
        bossEta: bossProgress(w),
        // 오염도(톡사르). 스냅샷의 render-only 필드 그대로 — 오염 런이 아니면 undefined 라
        // HUD 가 게이지를 감춘다.
        contamination: currSnap.contamination,
        // 액티브 쿨다운 2칸(AC-18) — `bossEta` 와 같은 읽기 전용 월드 파생이라 스냅샷 경유가
        // 불필요하다. 미장착 런은 빈 배열이 나가고 HUD 가 칸을 감춘다.
        actives: hudActives(w),
        // 누적 부채(id 18 mercantile — 설계 명세 §신호 2). `bossEta`·`actives` 와 같은 읽기 전용
        // 월드 파생이라 스냅샷 경유가 불필요하다. 미소지 런은 슬롯이 0 이라 HUD 가 줄을 감춘다.
        debt: mercantileDebtOf(w),
      });

      // 디버그 텔레메트리(우하단 보라색 monospace — `#hud`) 는 **하네스에서만** 그린다
      // (사용자 지시 2026-08-09). 이 줄은 Phase 1 부터 있었는데 DEV 게이트가 없어 **배포본에서도
      // 플레이어에게 그대로 보이고 있었다** — seed·tick·엔티티 수·상태 해시·FPS 가 게임 화면에
      // 얹힌다.
      //
      // 지우지 않고 하네스 뒤로 옮기는 이유: 이 정보(특히 `hash`)는 결정론 디버깅에 실제로
      // 쓰인다. 같은 시드로 두 번 돌렸을 때 어느 틱에서 해시가 갈리는지를 눈으로 보는 유일한
      // 자리다. 그래서 리포의 "지금은 테스트 중" 스위치인 `?harness=1` 뒤에 둔다 — 치트 패널·
      // 프로필 격리와 같은 문이다.
      //
      // `hashWorld(w)` 를 게이트 **안에서** 부르는 것도 의도다. 매 프레임 월드 전체를 접는
      // 연산이라 표시하지도 않을 값을 위해 돌릴 이유가 없다.
      if (harnessActive) {
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
      }
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
        case 'commission':
          planetSelect.hide();
          clearToMenu();
          openCommissionDesk();
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
        case 'commission':
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
        syncEncounterArt();
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
      // --- 리플레이(DEV 하네스) ---
      // 라이브는 recorder 에서 그대로 뽑는다 — 하네스 침공 런도 정식 런과 같은 record 경로를
      // 타므로(startHarnessInvasionRun 이 ReplayRecorder 를 붙인다) 재현·검증에 바로 쓸 수 있다.
      // 리플레이와 그 끝의 해시를 **한 호출에서 함께** 낸다. 따로 뽑으면 그 사이에 ticker 가
      // 한 틱 더 밀어 멀쩡한 런이 "해시 불일치"로 뜬다(실시간 탭에서 실제로 재현됐다).
      getLiveRun: () =>
        recorder === null || world === null
          ? null
          : { replay: recorder.toReplay(), hash: hashWorld(world).toString(16).padStart(8, '0') },
      getLastRun: () =>
        lastFinishedReplay === null || lastFinishedHash === null
          ? null
          : { replay: lastFinishedReplay, hash: lastFinishedHash },
      // 서버 침공 관전(F3, 상대 리플레이 로드)은 ADR-0050 으로 폐지됐다 — 이 `playReplay`
      // 는 그 남은 렌더 경로(`beginSpectate`/`SpectateOverlay`)를 재사용하는 **하네스 로컬
      // 재생 전용** 진입점이다. 재생 월드는 진입 즉시 markTainted 하므로 정산·제출 대상에서
      // 빠진다(ADR-0008).
      playReplay: (replay, name) => {
        if (!isPlayableReplay(replay)) return false;
        // 관전 진입은 `clearToMenu` 로 world·recorder 를 버린다 — 진행 중이던 런은 endRun 을
        // 거치지 않으므로 여기서 잡아 두지 않으면 통째로 사라진다(잘못 누르면 복구 불가).
        if (recorder !== null && world !== null) {
          lastFinishedReplay = recorder.toReplay();
          lastFinishedHash = hashWorld(world).toString(16).padStart(8, '0');
        }
        beginSpectate(replay, name);
        return true;
      },
    };

    harness = core.createHarness(host);

    (window as unknown as { __pb: unknown }).__pb = {
      gameApp,
      controller,
      entityRenderer,
      autotile,
      // 플레이어 비주얼 항목 스위치(치트 패널 '기체' 탭과 같은 상태). 스크립트에서 항목을
      // 하나씩 켜고 화면 델타를 재려면 여기 노출돼 있어야 한다 — 치트 패널 안에만 있으면
      // "체크박스는 있는데 화면은 안 바뀐다"를 자동으로 확인할 방법이 없다.
      playerVisual: { get: playerVisualFlags, set: setPlayerVisualFlags, reset: resetPlayerVisualFlags },
      // 행성 환경 레이어 스택. 레이어를 한 장씩만 켜 놓고 스크린샷을 찍어야 그 레이어가 실제로
      // 무엇을 그리는지 대조할 수 있다(전부 켠 화면만 보면 어느 레이어의 기여인지 못 가린다).
      env,
      // 그래픽 설정·티어 컨트롤러. **배경 스크린샷 검증에 필수**다 — 하네스를 일시정지·스텝으로
      // 쓰면 FPS 계측이 10 근처로 잡혀 티어가 자동으로 'low' 로 강등되고 발광 게이트가 통째로
      // 꺼진다. 그 화면을 보고 "발광이 안 나온다"고 판정한 전례가 있어(카르곤 AAA 레인), 캡처
      // 직전 `quality: 'high'` 로 고정할 수단을 노출한다. 프로덕션 미포함(DEV 블록).
      graphicsSettings,
      graphicsTierController,
      // 적 비주얼 관측창(`src/render/entity/enemyVisual.ts` 가 모듈 최상위에서 채운다).
      // **이 한 줄이 필요한 이유**: 여기 `__pb = {...}` 통짜 대입이 모듈 평가분을 덮으므로,
      // 그 모듈이 `globalThis.__pbEnemy` 에 스스로 붙여도 `__pb` 안에서는 안 보인다. 비평가가
      // 그걸 몰라 Vite dev 의 동적 import 로 우회했는데, **그 우회는 프로덕션 빌드에서 안 된다** —
      // 검증 도구가 dev 서버에만 존재하는 상태였다.
      enemy: (globalThis as unknown as { __pbEnemy?: unknown }).__pbEnemy,
      hud,
      powerupOverlay,
      // 조우 프롬프트 — 조우 롤이 ≈2% 라 자연 발생을 기다릴 수 없다. 하네스에서 이 참조로
      // 프롬프트를 직접 띄워 문구·버튼을 눈으로 확인한다(조우 런타임 주입은 sim 쪽 몫).
      encounterOverlay,
      resultOverlay,
      planetSelect,
      inventory,
      // 연구소 — 팝업 둘(전체 스킬·액티브)은 클릭으로만 열려서 좌표 합성 없이는 스크린샷 검증을
      // 할 수 없다. 이 참조로 화면을 직접 몬다(2026-08-02 AAA 전환 검증 절차).
      researchLab,
      // 정제소 — 공정은 장비를 **클릭해야** 열리고, 고착은 굴린 뒤에만 가능하다. 좌표 합성
      // 없이 상세 패널의 각 상태(미선택 · 선택 · 고착 · 위험 게이지)를 찍으려면 이 참조로
      // 화면을 직접 몰아야 한다(2026-08-02 AAA 전환 검증 절차).
      refinery,
      // 관제탑은 서버 왕복 화면이라 로그인 없이는 안내 상태만 뜬다 — 채워진 화면을
      // 검증하려면 이 참조로 뷰를 직접 띄운다(카툰나무풍 롤아웃 #6 검증 절차).
      controlTower,
      // 타이틀 — 불꽃 세기·노즐 정렬은 화면으로만 판정할 수 있는데, 타이틀은 부팅 직후 한 번
      // 지나가는 화면이라 다시 띄울 수단이 없으면 캡처를 반복할 수 없다. `openTitle(false)` 로
      // 언제든 다시 세우고 `titleScreen.update(0)` 로 프레임을 손으로 돌린다.
      titleScreen,
      openTitle,
      // 기록 보관소(서사 열람) + 인트로 슬라이드 — 검증 시 이 참조로 직접 show 한다.
      recordsArchive,
      introSlides,
      openArchive,
      // 지시 수신소는 보유 목록이 **서버 원장**에서 오므로 로그인 없이는 항상 비어 있다 —
      // 찬 화면을 검증하려면 이 참조로 `inventory`·`online` 을 직접 시딩해야 한다
      // (2026-08-03 AAA 전환 검증 절차).
      commissionDesk,
      openCommissionDesk,
      // 코어 모듈 화면도 로그인해야 채워진다(미로그인이면 "쉬고 있는 상태") — 검증 시 이 참조로
      // 상태를 직접 넣고 refresh() 를 부른다(AAA 전환 후 값 갱신 진입점은 render 가 아니라 refresh).
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
        // `stepRun` 을 쓰는 이유는 의뢰 전환 때문만이 아니다 — `stepWorld` 직접 호출은 이 파일에서
        // 금지돼 있고(eslint), 여기만 예외로 두면 하네스 경로에서만 구간이 안 넘어간다.
        const nextW = stepRun(w, merged);
        world = nextW;
        if (nextW !== w) {
          // `stepOnce` 의 전환 분기와 **같은 계약**을 쓴다(두 스냅샷을 새 월드로 붙인다).
          // 여기서 `prevSnap` 에 구 월드 스냅샷을 남겨도 아래가 alpha=1 로 그려 화면상 무해하지만,
          // 그 우연에 기대면 보간 alpha 가 1 이 아니게 되는 순간 두 경로가 조용히 갈린다.
          entityRenderer.reset();
          prevSnap = snapshotWorld(nextW);
          currSnap = prevSnap;
        } else {
          prevSnap = currSnap;
          currSnap = snapshotWorld(nextW);
        }
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

    // 방어체 강화 모의 원장(DEV). 방어 사령부의 강화는 서버 권위라 로그인 없이는 한 줄도
    // 돌지 않는다 — 인메모리 게이트웨이를 전역 대체로 끼우면 오프라인에서도 레벨업·승급·
    // 리롤·등급 승급·제작 흐름을 그대로 밟을 수 있다. 끄면 즉시 원래 경로로 돌아온다.
    const defenseMockMod = await import('./harness/defenseMock.js');
    const defenseMock = defenseMockMod.createDefenseMock(0xdef3);
    let defenseMockOn = false;
    const defenseControl = {
      enabled: () => defenseMockOn,
      setEnabled: (on: boolean) => {
        defenseMockOn = on;
        setDefenseUnitsGatewayOverride(on ? defenseMock.gateway : null);
        harnessRefreshScreen(); // 사령부가 열려 있으면 새 원장으로 다시 그린다
      },
      currency: () => defenseMock.state(),
      setCurrency: (next: Partial<{ credits: number; minerals: number; blueprints: number }>) => {
        defenseMock.setCurrency(next);
      },
      seedUnits: (count: number) => {
        defenseMock.seedUnits(count);
        harnessRefreshScreen();
      },
      reset: () => {
        defenseMock.reset();
        harnessRefreshScreen();
      },
      unitCount: () => defenseMock.unitCount(),
    };

    // DEV 치트 패널(개발 도구): 하네스를 구동하는 우하단 접이식 오버레이(백틱 ` 토글).
    // 동적 import라 프로덕션 번들에서 완전히 제거된다(import.meta.env.DEV 정적 false).
    const cheatPanel = await import('./harness/cheatPanel.js');
    const panel = cheatPanel.createCheatPanel({
      harness,
      catalyst: catalystControl,
      defense: defenseControl,
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
        'commission',
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
