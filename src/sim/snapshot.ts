/**
 * Serializable render snapshots of the simulation.
 *
 * The render layer must not reach into live sim internals (mutable entities,
 * RNG). Instead the sim produces a flat, immutable snapshot each tick; the
 * renderer keeps the previous and current snapshot and interpolates between
 * them to decouple the fixed 60 Hz sim from the variable display refresh rate.
 */

import type { WorldState } from './world.js';
import type { EntityKind } from './entities.js';
import { eliteAffix } from './elite.js';
import { windowCenterX, windowCenterY } from './invasion/scroll.js';
import { chaseVisionRadius } from './modes/chase.js';
import { shrinkSafeRadius } from './modes/shrink.js';
import { contaminationCellCount, CONTAMINATION_CRITICAL_CELLS } from './modes/contamination.js';
import { PLANET_MODE } from './planetMode.js';

export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  /** Wall half-height (targetX); 0 for non-walls. `radius` is the wall half-width. */
  aabbH: number;
  /** Enemy role / hazard subtype code (drives render colour); -1 if unused. */
  enemyType: number;
  hp: number;
  maxHp: number;
  /**
   * Hazard: in its damaging window (vs. telegraphing). Boss: overheated (taking
   * double damage). False otherwise.
   */
  active: boolean;
  /** Boss phase-transition animation in progress (screen-clear flash). */
  flash: boolean;
  /**
   * Elite affix code (0..3) for an elite enemy, else -1. Drives the nameplate /
   * outline (render only — never part of the hash). For `loot` entities the
   * rarity code lives in `enemyType`.
   */
  elite: number;
  /**
   * 해저드 전용(render-only): **영구 지형인가**(`life < 0`). `HAZARD_SLOW` 와 `HAZARD_TERRAIN` 이
   * 같은 코드(2)라 subtype 만으로는 "청크 배치 피해 지형"과 "보스 감속 지대"를 가를 수 없다 —
   * 앞은 아프고 뒤는 안 아프므로 화면에서 반드시 달라야 한다(`hazardVisual`).
   *
   * **선택 필드**인 이유: 테스트 여럿이 `EntitySnapshot` 을 객체 리터럴로 직접 만든다. 필수로
   * 두면 해저드와 무관한 파일까지 전부 고쳐야 하는데, 렌더는 부재를 기존 거동(감속)으로 다룬다.
   * 스냅샷은 해시 대상이 아니라 sim 계약은 불변이다.
   */
  permanent?: boolean;
  /**
   * 보스 전용(render-only): 현재 페이즈 인덱스 0/1/2(`src/sim/boss.ts` 의 `boss.phase`).
   *
   * `flash`(전환 중)·`active`(과열)만으로는 **어느 페이즈에 있는지** 알 수 없다 — 셋 다 다른
   * 연출을 요구하는데(3D 액터의 페이즈별 거동, `render/three3d/bossActor.ts`) 페이즈 번호만
   * 스냅샷에 없었다. `permanent` 와 같은 이유로 **선택 필드**다(테스트가 스냅샷 리터럴을 직접
   * 만든다). 부재는 0(1페이즈)으로 다룬다. 스냅샷은 해시 대상이 아니라 골든 불변이다.
   */
  bossPhase?: number;
  /**
   * 대피소 전용(render-only): **이미 지나간 세그먼트의 대피소인가**(`aux0 < segmentIndex`).
   *
   * `active`(= 이번 세그먼트 목표)만으로는 대피소가 두 상태밖에 못 산다 — "아직 안 온 곳"과
   * "이미 쓴 곳"이 똑같이 비활성으로 보여, 링을 한 바퀴 돌면 어느 쪽이 남은 길인지 화면에서
   * 사라졌다(사용자 신고 2026-08-04 "대피소로 가야 한다는 느낌이 설명이 안 된다"). 셋을 가르는
   * 판정은 sim 이 이미 아는 것(`aux0` vs `wave.segmentIndex`)이라 여기서 한 번만 편다 —
   * `active` 를 같은 자리에서 펴는 것과 같은 규율이다.
   *
   * `permanent`·`bossPhase` 와 같은 이유로 **선택 필드**다(테스트가 스냅샷 리터럴을 직접 만든다).
   * 부재는 false(미도달)로 다룬다. 스냅샷은 해시 대상이 아니라 sim 계약은 불변이다.
   */
  spent?: boolean;
}

/** A support heal beam, for render only. */
export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WorldSnapshot {
  tick: number;
  arenaWidth: number;
  arenaHeight: number;
  /**
   * Camera focus in world coordinates (= the player position). The sim holds no
   * camera state (sim/render separation, ADR-0005); it is derived here from the
   * player so the renderer can pan the world without reaching into sim internals.
   */
  cameraX: number;
  cameraY: number;
  /**
   * Active planet index (config.planet). Render-only — drives per-planet boss /
   * backdrop art selection. NEVER part of the state hash (hashing reads
   * WorldState, not this snapshot), so it is safe to expose here.
   */
  planet: number;
  /**
   * 시야 반경(월드 유닛, 추격 모드=Lane6). sim 이 정한 정수 상태 — 렌더가 이 값으로 플레이어
   * 주변 암흑/안개 오버레이를 그린다(렌더 세부는 art 후속). 0 = 무제한(그 외 전 모드). 렌더
   * 전용이라 hashWorld 와 무관하다(planet 필드 선례).
   */
  visionRadius: number;
  /**
   * 안전 반경(월드 유닛, 수축 모드=Lane7). sim 이 정한 정수 상태 — 렌더가 이 값으로 원점(0,0)
   * 기준 안전 반경 링/밖 어둠 오버레이를 그린다(렌더 세부는 art 후속). 0 = 무제한(그 외 전 모드).
   * 렌더 전용이라 hashWorld 와 무관하다(planet·visionRadius 필드 선례).
   */
  safeRadius: number;
  /**
   * 오염도(톡사르=오염 모드 Lane8). `cells` = 살아있는 오염 셀 수, `critical` = 실패 임계.
   * 그 외 모드는 undefined 고 HUD 가 게이지를 감춘다.
   *
   * 왜 스냅샷에 싣는가: 오염 실패는 화면 어디에도 표시가 없어 임계를 넘는 순간 예고 없이
   * gameOver 가 떴다(사용자 신고 2026-07-27 "일정 시간 넘으면 갑자기 실패"). 게이지가 보이면
   * 밀리는 중인지 만회하는 중인지 플레이 도중에 읽힌다. 렌더 전용이라 hashWorld 와 무관하다
   * (planet·visionRadius·safeRadius 필드 선례). 선택 필드인 이유는 EntitySnapshot.permanent 와
   * 같다 — 스냅샷 리터럴을 직접 만드는 테스트가 여럿이다.
   */
  contamination?: { cells: number; critical: number } | undefined;
  entities: EntitySnapshot[];
  beams: Beam[];
}

const SUPPORT_TYPE = 3;

/** Capture an immutable snapshot of the current world for rendering. */
export function snapshotWorld(state: WorldState): WorldSnapshot {
  const entities: EntitySnapshot[] = [];
  const beams: Beam[] = [];
  // Camera tracks the player (entity at index 0); origin if it is somehow absent.
  //
  // 강제 스크롤(침공 3레이어 또는 PvE 스크롤 모드=Lane3)만 예외다: 화면이 플레이어와
  // 무관하게 밀려나가고, 창 위치가 sim 권위 상태(state.invasion3 / state.scrollRuntime)로
  // 존재한다. 그때는 파생이 아니라 **sim 이 정한 창 중심**을 그대로 카메라로 쓴다. 그 외
  // 런(뱀서류)은 창 미존재 → 기존 플레이어 파생 그대로다.
  const player = state.entities[0];
  const scrollWin = state.invasion3 ?? state.scrollRuntime;
  const cameraX = scrollWin !== undefined ? windowCenterX(scrollWin) : (player?.x ?? 0);
  const cameraY = scrollWin !== undefined ? windowCenterY(scrollWin) : (player?.y ?? 0);
  for (const e of state.entities) {
    entities.push({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      angle: e.angle,
      radius: e.radius,
      aabbH: e.kind === 'wall' ? e.targetX : 0,
      enemyType: e.enemyType,
      hp: e.hp,
      maxHp: e.maxHp,
      active:
        e.kind === 'hazard'
          ? e.timer <= 0 && e.life !== 0 // life<0 permanent terrain hazard is active
          : e.kind === 'boss'
            ? e.iframes > 0
            : // 포탑 픽업은 phase 로 두 상태를 산다: 0 = 휴면 배치물, 1 = 자동 사격 중인 아군
              // 포탑(events.ts `isActiveTurret` 과 동일 판정). 렌더가 이름표·조준 회전·트리거
              // 링을 이 값으로 가른다. 스냅샷은 해시 대상이 아니라 sim 계약 불변이다.
              e.kind === 'turretPickup'
              ? e.phase === 1
              : // 대피소(추격 Lane6)는 **지금 세그먼트의 것만** 전진 게이트다(`chaseShelterReached`
                // 는 `aux0 === segmentIndex` 만 본다). 6개가 전부 같은 모습으로 서 있으면 어디로
                // 가야 하는지 화면에서 알 수 없었다(사용자 신고 2026-07-27) — 렌더·레이더가
                // 목표 대피소를 가르도록 sim 판정과 **같은 식**을 여기서 한 번만 편다.
                e.kind === 'shelter'
                ? e.aux0 === state.wave.segmentIndex
                : false,
      flash: e.kind === 'boss' && e.timer > 0,
      // 보스 페이즈(0/1/2). 보스가 아니면 의미가 없으므로 0 — 렌더는 kind 로 먼저 가른다.
      bossPhase: e.kind === 'boss' ? e.phase : 0,
      elite: eliteAffix(e),
      // 영구 지형 해저드(life < 0 = 청크 배치·만료 없음). 렌더가 감속 지대와 가르는 유일한 신호다.
      permanent: e.kind === 'hazard' && e.life < 0,
      // 이미 지나간 대피소(= 지난 세그먼트의 것). `active` 와 같은 식을 여기서 한 번만 편다.
      spent: e.kind === 'shelter' && e.aux0 < state.wave.segmentIndex,
    });
    if (e.kind === 'enemy' && e.enemyType === SUPPORT_TYPE && e.phase === 1) {
      beams.push({ x1: e.x, y1: e.y, x2: e.targetX, y2: e.targetY });
    }
  }
  return {
    tick: state.tick,
    arenaWidth: state.config.arenaWidth,
    arenaHeight: state.config.arenaHeight,
    cameraX,
    cameraY,
    planet: state.config.planet ?? 0,
    visionRadius: chaseVisionRadius(state.config.planetMode),
    safeRadius: shrinkSafeRadius(state),
    contamination:
      state.config.planetMode === PLANET_MODE.contamination
        ? { cells: contaminationCellCount(state), critical: CONTAMINATION_CRITICAL_CELLS }
        : undefined,
    entities,
    beams,
  };
}
