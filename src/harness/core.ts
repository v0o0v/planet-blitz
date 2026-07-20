/**
 * 하네스 코어 (개발 도구, DEV 전용 — ADR-0008).
 *
 * The harness is the dev-build control + inspection surface for a run: screen
 * jumps, headless fast-forward, realtime speed control, pause/step, a structured
 * state dump, and a notable-event ring buffer. It is exposed as `window.__pb.harness`
 * and is NEVER bundled into production — `main.ts` only imports this module inside
 * an `import.meta.env.DEV` guard (dynamic import, so it is tree-shaken out).
 *
 * Isolation contract (ADR-0008):
 *  - 하네스 프로필: when the harness owns the save, all profile I/O is redirected
 *    to a separate localStorage slot ({@link harnessProfileStore}) so the real
 *    save is never touched.
 *  - 오염 런: any state-mutation cheat during a live run calls `markTainted(world)`
 *    (via {@link HarnessHost.markTaintedIfLive}); a tainted run does not settle and
 *    its replay is not submitted. Autopilot input and fast-forward stepping go
 *    through the normal record path and are NOT tainting.
 *
 * M7a(L8): 침공 3레이어 런 진입 훅({@link Harness.startInvasion})과 레이어 점프
 * ({@link Harness.jumpInvasionLayer})를 포함한다. 침공은 PvE 와 달리 **방어 배치**가 무대라
 * 배치 프리셋(`def3-*`)을 런 시작 **전에** 걸어야 비오염 검증이 된다.
 *
 * The harness does not step the sim itself — it drives the exact same per-tick
 * advance closure (`stepOnce`) the real ticker uses, so a fast-forwarded or
 * single-stepped run stays bit-identical to a played one (the replay reproduces).
 */

import type { InputFrame, WorldState } from '../sim/world.js';
import { emptyInput } from '../sim/world.js';
import { hashWorld } from '../sim/replay.js';
import { autopilotInput } from '../sim/autopilot.js';
import type { EntityKind } from '../sim/entities.js';
import type { KeyValueStore } from '../save/profile.js';
import { setProfileStoreOverride } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { buildInvasionPreset, buildPreset, isInvasionPreset } from './presets.js';
import type { PresetKind } from './presets.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_TOTAL_TICKS,
  clearLayerEntities,
  enterInvasionLayer,
  enterLayerFrame,
  makeInvasionContext,
} from '../sim/invasion/index.js';
import type { InvasionLayers, InvasionPhase } from '../sim/invasion/index.js';
import { MAINTENANCE_FULL } from '../sim/invasion/guardian.js';
import { EventRing, diffWorldEvents, emptyWorldEventSummary } from './events.js';
import type { HarnessEvent, WorldEventSummary } from './events.js';

/** The screens the harness can jump to (mirrors main.ts's open* functions). */
export type HarnessScreen =
  | 'title'
  | 'base'
  | 'starMap'
  | 'inventory'
  | 'research'
  | 'refinery'
  | 'defense'
  | 'controlTower';

/** Options for {@link Harness.startRun}. */
export interface HarnessRunOpts {
  /** Run seed (defaults to the host's next seed). */
  seed?: number;
  /** Planet index (default 0). */
  planet?: number;
  /** Difficulty tier index (default 0). */
  tier?: number;
  /** Accept the seed-offered anomaly (default false). */
  anomaly?: boolean;
  /** Cap of pre-boss segments (tutorial short run); absent = full run. */
  maxSegments?: number;
}

/**
 * Options for {@link Harness.startInvasion} (M7a L8 — 3레이어 침공 진입 훅).
 *
 * 침공은 PvE 와 입력이 완전히 다르다(행성·티어 대신 **방어 배치**가 무대다). 그래서
 * {@link HarnessRunOpts} 를 확장하지 않고 별도 옵션을 둔다.
 */
export interface HarnessInvasionOpts {
  /** 방어 배치. 미지정이면 `preset`, 그것도 없으면 마지막으로 건 배치 프리셋을 쓴다. */
  layers?: InvasionLayers;
  /** 배치 프리셋으로 무대를 꾸민다(`layers` 가 있으면 무시). */
  preset?: PresetKind;
  /** 런 시드(미지정 = 호스트의 다음 시드). */
  seed?: number;
  /** 방어 정비도(centi-percent 0..10000). 미지정 = 완전 정비. */
  maintenance?: number;
  /** 총 제한 시간(틱). 미지정 = {@link INVASION_TOTAL_TICKS}. */
  timeLimitTicks?: number;
  /** 시작 직후 점프할 레이어(1=L1 · 2=L2 · 3=L3). 미지정이면 L1 부터. */
  layer?: 1 | 2 | 3;
}

/** 하네스가 호스트에 넘기는, 기본값이 모두 해소된 침공 런 설정. */
export interface HarnessInvasionResolved {
  seed: number;
  layers: InvasionLayers;
  maintenance: number;
  timeLimitTicks: number;
}

/** 침공 런타임 요약(스냅샷 · 치트 패널 표시용). 침공이 아니면 null. */
export interface HarnessInvasionState {
  /** 0=L1 · 1=L2 · 2=L3. */
  phase: number;
  phaseEnterTick: number;
  scrollX: number;
  scrollY: number;
  /** 전멸 가속 배율(centi-percent, 100~200). */
  accelCp: number;
  /** 적립된 레이어 클리어 폭탄. */
  bombs: number;
}

/** Structured state dump returned by {@link Harness.snapshot}. */
export interface HarnessSnapshot {
  /** Current screen / overlay state (last reported by the host). */
  screen: string;
  tick: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  /** Current wave segment (1-based); 0 when no run is live. */
  segment: number;
  boss: { hp: number; maxHp: number; phase: number } | null;
  kills: number;
  combo: number;
  /** Live entity counts keyed by kind. */
  entityCounts: Record<string, number>;
  /** hashWorld hex (8 chars); empty when no run is live. */
  hash: string;
  seed: number;
  tainted: boolean;
  /** 침공 3레이어 런타임 요약(침공 런이 아니면 null). */
  invasion: HarnessInvasionState | null;
  profileSummary: { credits: number; minerals: number; shipLevel: number };
}

/**
 * The seam between the harness and `main.ts`. `main` implements this with its own
 * loop closures + screen functions, so the harness can drive the real game without
 * the harness importing PixiJS or owning any menu state.
 */
export interface HarnessHost {
  getWorld(): WorldState | null;
  getCurrentSeed(): number;
  /**
   * Advance the live world by exactly one tick with `input`, going through the
   * SAME record + snapshot path the real ticker uses (so the replay stays valid).
   * No-op when no run is live.
   */
  stepOnce(input: InputFrame): void;
  /** Sample the player's live input for one tick (keyboard/mouse — normal path). */
  sampleInput(): InputFrame;
  /** Render exactly one frame from the current snapshots. */
  renderOnce(): void;
  /** Realtime accumulator scale for the main ticker (1 = normal). */
  setSpeedFactor(mult: number): void;
  /** Freeze / unfreeze the ticker-driven sim stepping. */
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  /** Jump to a menu screen (programmatic — reuses main's open* functions). */
  goto(screen: HarnessScreen): void;
  /** Start a run directly from resolved options. */
  startRun(opts: Required<Pick<HarnessRunOpts, 'planet' | 'tier' | 'anomaly'>> & {
    seed: number;
    maxSegments?: number;
  }): void;
  /**
   * 3레이어 침공 런을 직접 시작한다(M7a L8).
   *
   * **ADR-0008 오염 격리**: 호스트 구현은 이 런을 정산·래더 제출 경로에 태우면 안 된다 —
   * 하네스 침공은 대상 기지가 없는 개발용 무대이므로, 결과를 서버에 제출하면 존재하지 않는
   * 방어자에 대한 침공 기록이 생긴다. 리플레이 recorder 는 붙여도 된다(재현 검증용).
   */
  startInvasion(opts: HarnessInvasionResolved): void;
  /** A fresh run seed (honours ?seed pinning). */
  nextSeed(): number;
  /** Redirect all default profile I/O to the 하네스 프로필 slot (idempotent). */
  activateHarnessProfile(): void;
  /** Overwrite the live profile in place + persist it (to the active slot). */
  applyProfile(profile: Profile): void;
  /** Re-render the current screen from the (possibly changed) profile. */
  refreshScreen(): void;
  getProfileSummary(): { credits: number; minerals: number; shipLevel: number };
  /** Mark the live run tainted (오염 런) — no-op if no run is in progress. */
  markTaintedIfLive(): void;
  /** Whether the live run is tainted (false when no run/flag unsupported). */
  isTainted(): boolean;
  /** The current screen name for snapshots. */
  currentScreen(): string;
}

/** The public `window.__pb.harness` API surface. */
export interface Harness {
  /** Jump to a menu screen. */
  goto(screen: HarnessScreen): void;
  /** Start a run directly (resolves defaults from opts). */
  startRun(opts?: HarnessRunOpts): void;
  /**
   * 3레이어 침공 런을 시작한다(비오염 — `layer` 점프를 요청하면 그 점프만 오염이다).
   * 배치는 `opts.layers` > `opts.preset` > 마지막으로 건 배치 프리셋 > `def3-empty` 순으로
   * 해소된다.
   */
  startInvasion(opts?: HarnessInvasionOpts): void;
  /**
   * 라이브 침공 런을 지정 레이어로 밀어 올린다(1→2→3 전진만 가능 — 되돌리려면 다시 시작).
   * 무대 꾸미기이므로 **오염 런**으로 표시된다(ADR-0008). 침공 런이 아니거나 이미 그
   * 레이어를 지났으면 false.
   */
  jumpInvasionLayer(layer: 1 | 2 | 3): boolean;
  /**
   * Headless fast-forward: synchronously step `ticks` sim ticks with autopilot
   * (default) or neutral input, then render one frame. Inputs go through the
   * normal record path so the replay stays reproducible. NOT tainting.
   */
  ff(ticks: number, opts?: { autopilot?: boolean }): void;
  /** Realtime accelerated playback: scale the main ticker (1 | 4 | 16). */
  setSpeed(mult: 1 | 4 | 16): void;
  /** Freeze the ticker-driven sim. */
  pause(): void;
  /** Resume the ticker-driven sim. */
  resume(): void;
  /** Single-step `n` ticks through the normal (live-input) path. NOT tainting. */
  step(n?: number): void;
  /**
   * 프리셋 주입. 프로필 프리셋(`fresh`/`maxed`)은 하네스 프로필 슬롯을 통째로 바꾸고,
   * 3레이어 배치 프리셋(`def3-*`)은 **다음 침공 런의 방어 배치**로 예약된다. 어느 쪽이든
   * 라이브 런이 있으면 그 런을 오염시킨다 — 그래서 **런 시작 전에** 걸어야 비오염이다.
   */
  preset(kind: PresetKind): void;
  /** 현재 예약된 3레이어 배치(프리셋 미적용이면 `def3-empty` 정규형). */
  invasionLayers(): InvasionLayers;
  /** Structured state dump. */
  snapshot(): HarnessSnapshot;
  /** The last 200 notable events (oldest first). */
  events(): HarnessEvent[];
  /**
   * Apply a state-mutation cheat to the live world and mark the run tainted
   * (오염 런). The building block worker-3's 치트 패널 uses for HP/spawn edits.
   * No-op when no run is live.
   */
  cheat(mutate: (world: WorldState) => void): void;
  /** Report a screen change (fires a `screenChange` event). Used by main.ts. */
  observeScreen(screen: string): void;
  /** Per-tick observation hook — main.ts calls this from `stepOnce`. */
  observe(world: WorldState): void;
}

/**
 * A localStorage wrapper that appends `:harness` to every key, so profile I/O
 * lands in the isolated 하네스 프로필 slot and never overwrites the real save.
 * Returns null when localStorage is unavailable (sandboxed contexts).
 */
export function harnessProfileStore(): KeyValueStore | null {
  let ls: Storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    ls = localStorage;
  } catch {
    return null;
  }
  const suffix = ':harness';
  return {
    getItem: (key) => ls.getItem(key + suffix),
    setItem: (key, value) => {
      ls.setItem(key + suffix, value);
    },
    removeItem: (key) => {
      ls.removeItem(key + suffix);
    },
  };
}

/** Count live entities by kind (dead entities are compacted out each tick). */
function countEntities(world: WorldState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of world.entities) {
    const k = e.kind as EntityKind;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Find the boss entity's fight state, or null when no boss is present. */
function bossState(world: WorldState): { hp: number; maxHp: number; phase: number } | null {
  for (const e of world.entities) {
    if (e.kind === 'boss') return { hp: e.hp, maxHp: e.maxHp, phase: e.phase };
  }
  return null;
}

/** Extract the flat per-tick summary the event differ compares. */
function summarize(world: WorldState): WorldEventSummary {
  const boss = bossState(world);
  let uniqueLootCount = 0;
  for (const r of world.loot) if (r.rarity === 3) uniqueLootCount++;
  return {
    level: world.level,
    bossPresent: boss !== null,
    bossPhase: boss?.phase ?? -1,
    uniqueLootCount,
    gameOver: world.gameOver,
    victory: world.victory,
  };
}

/** 침공 런타임 요약 추출(침공 런이 아니면 null). */
function invasionStateOf(world: WorldState): HarnessInvasionState | null {
  const rt = world.invasion3;
  if (rt === undefined) return null;
  return {
    phase: rt.phase,
    phaseEnterTick: rt.phaseEnterTick,
    scrollX: rt.scrollX,
    scrollY: rt.scrollY,
    accelCp: rt.accelCp,
    bombs: world.invasion3Bombs,
  };
}

/**
 * Build the harness. `main.ts` supplies the {@link HarnessHost} (its loop
 * closures + screen functions); this factory returns the object attached to
 * `window.__pb.harness`.
 */
export function createHarness(host: HarnessHost): Harness {
  const events = new EventRing(200);
  let prevSummary = emptyWorldEventSummary();
  // 마지막으로 건 3레이어 배치 프리셋. 침공 런의 방어 측 입력이며, 런 시작 전에 걸면
  // 비오염이다(런 중에 걸면 preset() 이 markTaintedIfLive 로 오염시킨다).
  let pendingLayers: InvasionLayers = buildInvasionPreset('def3-empty');

  /**
   * 라이브 침공 런을 지정 페이즈까지 밀어 올린다. 페이즈 머신의 전이 절차를 그대로 밟되
   * (잔여 정리 → 좌표 원점 이동 → 진입 훅) **클리어 보너스는 주지 않는다** — 점프는
   * "클리어"가 아니라 무대 꾸미기이고, 보너스를 주면 손으로 뚫은 런과 상태가 갈린다.
   */
  function jumpLayer(layer: 1 | 2 | 3): boolean {
    const world = host.getWorld();
    if (world === null) return false;
    const config = world.config.invasion3;
    const runtime = world.invasion3;
    if (config === undefined || runtime === undefined) return false;
    const target = (layer - 1) as InvasionPhase;
    if (runtime.phase >= target) return false;
    // 상태 변형이므로 오염(ADR-0008). 치트 패널의 세그먼트/보스전 점프와 같은 규율.
    host.markTaintedIfLive();
    while (runtime.phase < target) {
      clearLayerEntities(world);
      runtime.phase = (runtime.phase + 1) as InvasionPhase;
      runtime.phaseEnterTick = world.tick;
      runtime.accelCp = INVASION_ACCEL_BASE_CP;
      enterLayerFrame(world, config, runtime);
      enterInvasionLayer(world, makeInvasionContext(config, runtime));
    }
    return true;
  }

  return {
    goto(screen) {
      host.goto(screen);
    },

    startRun(opts = {}) {
      const seed = opts.seed ?? host.nextSeed();
      host.startRun({
        seed,
        planet: opts.planet ?? 0,
        tier: opts.tier ?? 0,
        anomaly: opts.anomaly ?? false,
        ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
      });
      // A fresh run resets the event baseline.
      prevSummary = emptyWorldEventSummary();
    },

    startInvasion(opts = {}) {
      const layers =
        opts.layers !== undefined
          ? opts.layers
          : opts.preset !== undefined && isInvasionPreset(opts.preset)
            ? buildInvasionPreset(opts.preset)
            : pendingLayers;
      host.startInvasion({
        seed: opts.seed ?? host.nextSeed(),
        layers,
        maintenance: opts.maintenance ?? MAINTENANCE_FULL,
        timeLimitTicks: opts.timeLimitTicks ?? INVASION_TOTAL_TICKS,
      });
      prevSummary = emptyWorldEventSummary();
      // 레이어 점프는 런이 생긴 뒤에만 가능하다(무대 꾸미기 → 오염).
      if (opts.layer !== undefined) jumpLayer(opts.layer);
    },

    jumpInvasionLayer(layer) {
      return jumpLayer(layer);
    },

    invasionLayers() {
      return pendingLayers;
    },

    ff(ticks, opts = {}) {
      const world = host.getWorld();
      if (world === null) return;
      const useAutopilot = opts.autopilot ?? true;
      for (let i = 0; i < ticks; i++) {
        if (world.gameOver || world.victory) break;
        const input = useAutopilot ? autopilotInput(world) : emptyInput();
        host.stepOnce(input); // records + snapshots + observe (via host)
      }
      host.renderOnce();
    },

    setSpeed(mult) {
      host.setSpeedFactor(mult);
    },

    pause() {
      host.setPaused(true);
    },

    resume() {
      host.setPaused(false);
    },

    step(n = 1) {
      const world = host.getWorld();
      if (world === null) return;
      for (let i = 0; i < n; i++) {
        if (world.gameOver || world.victory) break;
        host.stepOnce(host.sampleInput());
      }
      host.renderOnce();
    },

    preset(kind) {
      // 3레이어 배치 프리셋: 프로필이 아니라 **다음 침공 런의 방어 배치**를 예약한다.
      // 라이브 런이 있으면 그 런을 오염시킨다 — 이미 도는 런의 배치는 바꿀 수 없는데
      // 프리셋만 갈아 두면 "무엇을 검증했는지"가 어긋나기 때문이다(런 시작 전에 걸 것).
      if (isInvasionPreset(kind)) {
        host.markTaintedIfLive();
        pendingLayers = buildInvasionPreset(kind);
        return;
      }
      // Injecting a preset always uses the isolated 하네스 프로필 slot so the real
      // save is never overwritten (activation is idempotent). If a run is live,
      // mutating the account behind it taints that run.
      host.activateHarnessProfile();
      host.markTaintedIfLive();
      host.applyProfile(buildPreset(kind));
      host.refreshScreen();
    },

    snapshot() {
      const world = host.getWorld();
      const summary = host.getProfileSummary();
      if (world === null) {
        return {
          screen: host.currentScreen(),
          tick: 0,
          hp: 0,
          maxHp: 0,
          level: 1,
          xp: 0,
          segment: 0,
          boss: null,
          kills: 0,
          combo: 0,
          entityCounts: {},
          hash: '',
          seed: host.getCurrentSeed(),
          tainted: false,
          invasion: null,
          profileSummary: summary,
        };
      }
      const player = world.entities[0];
      return {
        screen: host.currentScreen(),
        tick: world.tick,
        hp: player?.hp ?? 0,
        maxHp: player?.maxHp ?? 0,
        level: world.level,
        xp: world.xp,
        segment: world.wave.segmentIndex + 1,
        boss: bossState(world),
        kills: world.kills,
        combo: world.combo,
        entityCounts: countEntities(world),
        hash: hashWorld(world).toString(16).padStart(8, '0'),
        seed: host.getCurrentSeed(),
        tainted: host.isTainted(),
        invasion: invasionStateOf(world),
        profileSummary: summary,
      };
    },

    events() {
      return events.list();
    },

    cheat(mutate) {
      const world = host.getWorld();
      if (world === null) return;
      host.markTaintedIfLive();
      mutate(world);
    },

    observeScreen(screen) {
      events.push({ tick: host.getWorld()?.tick ?? 0, type: 'screenChange', detail: screen });
    },

    observe(world) {
      const curr = summarize(world);
      events.pushAll(diffWorldEvents(prevSummary, curr, world.tick));
      prevSummary = curr;
    },
  };
}

export { setProfileStoreOverride };
