/**
 * Boss content — Kargon "용암 요새 전차" (lava fortress tank), M1 boss (plan
 * task 15, spec R2).
 *
 * Data only: the boss is three phases, each cycling a small list of attacks
 * expressed with the same primitives the enemy pattern engine already emits
 * (radial bullets, spirals, lava-pillar hazards). Phase thresholds are HP
 * fractions (100→70% P1, 70→35% P2, 35→0% P3). The boss logic (src/sim/boss.ts)
 * executes these; adding bosses later means adding rows here.
 *
 * Balance note: HP / cadence / bullet counts are M1 prototype tuning (spec fixes
 * the *structure* — 3 phases, 5s overheat, phase-transition bullet clear — but
 * not these numbers). Expected to move during the fun-gate loop.
 */

import type { EnemyRole } from '../src/sim/patterns/types.js';

export type BossAttack =
  /** Even radial burst of `count` bullets. */
  | {
      readonly kind: 'ring';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
    }
  /** Radial burst whose base angle advances each cast, tracing a spiral. */
  | {
      readonly kind: 'spiral';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
      /** Base-angle advance per cast (radians). */
      readonly turn: number;
    }
  /** Line of telegraphed lava pillars across the arena at the player's y. */
  | {
      readonly kind: 'lavaLine';
      readonly pillars: number;
      readonly windup: number;
      readonly activeTicks: number;
      readonly radius: number;
      readonly damage: number;
    }
  /**
   * 여왕 보스 소환(plan E2): 무리개체를 보스 주변 링에 즉시 스폰. `role`은 현재
   * 행성 로스터에서 뽑을 잡몹 역할, `count`는 마리 수. 결정론(고정 각도, RNG 없음).
   */
  | {
      readonly kind: 'summon';
      readonly role: EnemyRole;
      readonly count: number;
    }
  /**
   * 과열 창(plan E2): 플레이어를 향해 조준된 좁은 부채꼴 고속 탄막(포위/창격). `arc`
   * 0이면 단일 직선 창, >0이면 그 각도폭에 `count`발을 부채꼴로 발사.
   */
  | {
      readonly kind: 'aimedBurst';
      readonly count: number;
      readonly arc: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
    }
  /**
   * 레이저 그물(plan B1, 유령 기함): 플레이어 영역을 가로지르는 격자형 고속 탄막.
   * `lines`개의 수직 열(아래로) + `lines`개의 수평 행(오른쪽으로)을 뷰포트 폭
   * (HAZARD_LINE_SPAN) 위에 균등 배치해 그물망을 만든다. 고정 간격·방향(RNG 미소비)
   * — 결정론. 세그먼트 탄 상한을 존중한다.
   */
  | {
      readonly kind: 'laserNet';
      readonly lines: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
    }
  /**
   * 감속 지대(plan B1, 유령 기함): 플레이어 주변에 서리 감속 장판(HAZARD_SLOW)을
   * `zones`개 융기시킨다. 장판에 닿으면 플레이어가 일정 시간 감속되고 소량 피해를
   * 받는다. 고정 배치(RNG 미소비) — 결정론.
   */
  | {
      readonly kind: 'slowField';
      readonly zones: number;
      readonly windup: number;
      readonly activeTicks: number;
      readonly radius: number;
      readonly damage: number;
    }
  /**
   * 기하학 회전 탄막(plan B2, 수호자 오벨리스크): `sides`각형의 각 변 방향으로 `perSide`
   * 발씩 부채꼴을 쏘고, 매 캐스트마다 기준각을 `turn`만큼 돌려 회전 다각형 탄막을
   * 그린다(spiral과 동일하게 boss.targetX에 기준각 누적). 결정론(위치·누산 각도만).
   */
  | {
      readonly kind: 'polygonSpin';
      readonly sides: number;
      readonly perSide: number;
      readonly spread: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
      readonly turn: number;
    };

export interface BossPhaseDef {
  /** Ticks between pattern casts within the phase. */
  readonly patternCooldown: number;
  /**
   * Minimum ticks between successive overheat-window *openings* in this phase.
   * The overheat window is 5s (BOSS_OVERHEAT_TICKS = 300); this must be strictly
   * larger so the window closes for `overheatInterval - 300` ticks between
   * openings — that closed gap is what makes the "5s vulnerable window" a
   * readable open/close rhythm rather than a permanent double-damage state.
   */
  readonly overheatInterval: number;
  /** Attacks cast in round-robin order. Index 0 is the phase's signature cast. */
  readonly attacks: readonly BossAttack[];
}

export interface BossDef {
  readonly id: string;
  readonly hp: number;
  readonly radius: number;
  readonly contactDamage: number;
  readonly moveSpeed: number;
  /** Exactly three phases (P1 signature, P2 variation, P3 desperation). */
  readonly phases: readonly [BossPhaseDef, BossPhaseDef, BossPhaseDef];
}

export const LAVA_FORTRESS: BossDef = {
  id: 'kargon-lava-fortress',
  // HP raised from 2200 → 3600 alongside the overheat-window fix. The old value
  // was tuned while the boss was overheated ~99.7% of the fight (permanent 2x
  // damage) — trivially easy. With the overheat window now a real 5s open / ~5s
  // closed rhythm (avg damage multiplier ~1.5x instead of ~2x), each phase lasts
  // long enough to actually exhibit a cool interval. Still M1 prototype tuning.
  hp: 3600,
  // 2x hitbox scale (plan D1): 64 -> 128. Move speed doubled for the 2x world.
  radius: 128,
  contactDamage: 20,
  moveSpeed: 140,
  phases: [
    // P1 — signature: slow, readable radial bursts. Overheat opens ~every 10s
    // after the signature ring: 5s hot, 5s cool.
    {
      patternCooldown: 96,
      overheatInterval: 600,
      attacks: [
        // 판정점(ADR-0010) 도입으로 회피 여유가 커진 만큼 링 밀도를 공격적으로 상향
        // (14→20, 18→26). 링 탄은 가속 직진 시그니처라 밖으로 갈수록 회피 창이 좁아진다.
        { kind: 'ring', count: 20, speed: 600, damage: 8, bulletRadius: 7, bulletLife: 140 },
        { kind: 'ring', count: 26, speed: 680, damage: 8, bulletRadius: 7, bulletLife: 140 },
      ],
    },
    // P2 — variation + terrain: rings interleaved with lava pillar lines.
    // Overheat opens ~every 9.5s: 5s hot, ~4.5s cool.
    {
      patternCooldown: 84,
      overheatInterval: 570,
      attacks: [
        // 링 20→28 상향. 나선은 분열 산탄 시그니처(탄마다 자탄 2발)라 밀도가 이미
        // 배가되므로 raw count는 10→12로 절제 상향한다.
        { kind: 'ring', count: 28, speed: 720, damage: 9, bulletRadius: 7, bulletLife: 150 },
        { kind: 'lavaLine', pillars: 7, windup: 48, activeTicks: 100, radius: 104, damage: 10 },
        { kind: 'spiral', count: 12, speed: 760, damage: 9, bulletRadius: 6, bulletLife: 150, turn: 0.5 },
      ],
    },
    // P3 — desperation: dense spirals, faster cadence. Overheat opens ~every 9s
    // (5s hot, ~4s cool) — slightly tighter so the desperation phase keeps a
    // punishing attack window without dragging the kill out.
    {
      patternCooldown: 60,
      overheatInterval: 540,
      attacks: [
        // 발악 페이즈: 링 24→32로 공격적 상향. 나선은 분열 배가를 감안해 14→16 절제 상향.
        { kind: 'spiral', count: 16, speed: 800, damage: 10, bulletRadius: 6, bulletLife: 160, turn: 0.62 },
        { kind: 'ring', count: 32, speed: 840, damage: 10, bulletRadius: 7, bulletLife: 160 },
        { kind: 'spiral', count: 16, speed: 800, damage: 10, bulletRadius: 6, bulletLife: 160, turn: -0.62 },
      ],
    },
  ],
};
