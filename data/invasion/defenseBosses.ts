/**
 * 침공 L3 — 방어 보스 레지스트리 (M7a · L5-core-room).
 *
 * ## 왜 data/boss.ts 를 재사용하지 않고 복제했는가
 * `data/boss.ts` 는 **PvE 정본**이다(행성별 보스 1기, `planetContent(planet).boss` 로 조회).
 * 방어 보스는 ①행성이 아니라 **방어자의 배치(catalogId)** 로 선택되고, ②레벨·승급·등급으로
 * 스탯이 결정론 파생되며, ③풍화(정비도)의 영향을 받는다 — 조회 키도 스탯 해석도 다르다.
 * PvE 정본에 분기를 얹으면 PvE 해시 계약에 위험이 번지므로, **판별 유니온 문법만 복제**하고
 * 레지스트리를 분리한다. `data/boss.ts` 는 한 줄도 수정하지 않는다.
 *
 * ## 복제 범위와 의도적 차이
 * `BossAttack` 8종 중 `summon` 은 제외했다 — 행성 로스터(`planetContent(...).roster`)에 결속돼
 * 있어 방어 배치에서 의미가 없다(방어 측 잡몹 소환은 L1 편대·L2 스포너의 몫이다).
 * `lavaLine` 은 용암 고유 이름 대신 해저드 subtype 을 데이터로 받는 `hazardLine` 으로 일반화했다.
 *
 * ## 결정론(ADR-0005)
 * 전부 리터럴 상수 + 정수 산술이다. RNG·wall-clock 을 읽지 않는다. 레벨·승급·등급 스케일은
 * basis-point 정수(10000 = ×1.00)로만 표현해 f64 누적을 배제한다(data/guardian.ts scaleStat 규율).
 *
 * ## 배열 인덱스 = 계약
 * {@link DEFENSE_BOSSES} 의 배열 인덱스가 곧 `InvasionRef.catalogId` 다. **append-only** —
 * 기존 항목의 순서를 바꾸면 이미 저장된 방어 배치가 다른 보스를 가리킨다(M7c 풀 카탈로그는
 * 뒤에만 추가한다).
 */

import { HAZARD_LAVA, HAZARD_SLOW } from '../../src/sim/patterns/types.js';

// ---------------------------------------------------------------------------
// 공격 문법 (data/boss.ts BossAttack 판별 유니온 복제)
// ---------------------------------------------------------------------------

/** 방어 보스 1회 캐스트. `kind` 로 판별하는 태그드 유니온(data/boss.ts 문법 복제). */
export type DefenseBossAttack =
  /** 균등 방사 링. */
  | {
      readonly kind: 'ring';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
    }
  /** 캐스트마다 기준각이 `turn` 만큼 도는 나선. */
  | {
      readonly kind: 'spiral';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
      /** 캐스트당 기준각 전진(라디안). */
      readonly turn: number;
    }
  /** 플레이어를 조준한 부채꼴 창격(`arc`=0 이면 단일 직선). */
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
   * 플레이어 y 를 가로지르는 예고 해저드 기둥 열(구 `lavaLine` 일반화).
   * `subtype` 은 src/sim/patterns/types.ts 의 HAZARD_* 코드다.
   */
  | {
      readonly kind: 'hazardLine';
      readonly subtype: number;
      readonly pillars: number;
      readonly windup: number;
      readonly activeTicks: number;
      readonly radius: number;
      readonly damage: number;
    }
  /** 플레이어 주변 감속 장판(HAZARD_SLOW) 융기. */
  | {
      readonly kind: 'slowField';
      readonly zones: number;
      readonly windup: number;
      readonly activeTicks: number;
      readonly radius: number;
      readonly damage: number;
    }
  /** `sides`각형 각 변마다 `perSide` 발 부채꼴 + 기준각 회전. */
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

/** 방어 보스 1페이즈(data/boss.ts BossPhaseDef 복제). */
export interface DefenseBossPhaseDef {
  /** 페이즈 내 캐스트 간격(틱). 정비도로 스케일된다. */
  readonly patternCooldown: number;
  /**
   * 과열 창이 다시 **열리기까지의** 최소 간격(틱). 과열 창 자체는
   * {@link DEFENSE_BOSS_OVERHEAT_TICKS} 이므로, 이 값은 그보다 커야 "열림/닫힘" 리듬이 생긴다.
   */
  readonly overheatInterval: number;
  /** 라운드로빈 순서로 캐스트한다. 인덱스 0 = 페이즈 시그니처(과열 창을 여는 캐스트). */
  readonly attacks: readonly DefenseBossAttack[];
}

/** 방어 보스 1종. */
export interface DefenseBossDef {
  /** 안정 식별자. i18n 키 = `def3.boss.<id>.name` / `.desc`(L9 카탈로그 규약). */
  readonly id: string;
  /** 기본 내구도(레벨 1·승급 0·노말 기준). */
  readonly hp: number;
  /** 히트박스 반지름. */
  readonly radius: number;
  /** 접촉(램) 피해. */
  readonly contactDamage: number;
  /** 이동 속도(유닛/초). */
  readonly moveSpeed: number;
  /** 정확히 3페이즈(P1 시그니처 / P2 변주 / P3 발악). */
  readonly phases: readonly [DefenseBossPhaseDef, DefenseBossPhaseDef, DefenseBossPhaseDef];
}

// ---------------------------------------------------------------------------
// 전투 리듬 상수 (src/sim/boss.ts 규율 복제)
// ---------------------------------------------------------------------------

/** 페이즈 전이 연출 길이(틱). 이 동안 정지·무발사, 진입 시 적탄 전소거. */
export const DEFENSE_BOSS_TRANSITION_TICKS = 120;
/** 과열 창(틱). 이 동안 받는 피해 2배. */
export const DEFENSE_BOSS_OVERHEAT_TICKS = 300;
/** 페이즈 전이 HP 임계(basis-point). P0→P1 = 70%, P1→P2 = 35%. */
export const DEFENSE_BOSS_PHASE1_BP = 7000;
/** 위 참조. */
export const DEFENSE_BOSS_PHASE2_BP = 3500;

// ---------------------------------------------------------------------------
// 레지스트리 (배열 인덱스 = catalogId, append-only)
// ---------------------------------------------------------------------------

/**
 * ① 강철 골리앗 — M7a 임시 카탈로그의 유일 방어 보스.
 * 성격: 느리고 단단한 요새형. P1 은 읽히는 링, P2 는 지형(예고 기둥)으로 공간을 좁히고,
 * P3 은 회전 다각형 + 나선으로 밀도를 올린다.
 */
export const STEEL_GOLIATH: DefenseBossDef = {
  id: 'steelGoliath',
  hp: 6000,
  radius: 132,
  contactDamage: 26,
  moveSpeed: 110,
  phases: [
    {
      patternCooldown: 96,
      overheatInterval: 600,
      attacks: [
        { kind: 'ring', count: 18, speed: 560, damage: 8, bulletRadius: 7, bulletLife: 140 },
        {
          kind: 'aimedBurst',
          count: 5,
          arc: 0.6,
          speed: 900,
          damage: 9,
          bulletRadius: 6,
          bulletLife: 120,
        },
      ],
    },
    {
      patternCooldown: 84,
      overheatInterval: 570,
      attacks: [
        { kind: 'ring', count: 24, speed: 640, damage: 9, bulletRadius: 7, bulletLife: 150 },
        {
          kind: 'hazardLine',
          subtype: HAZARD_LAVA,
          pillars: 6,
          windup: 48,
          activeTicks: 100,
          radius: 104,
          damage: 10,
        },
        {
          kind: 'spiral',
          count: 12,
          speed: 700,
          damage: 9,
          bulletRadius: 6,
          bulletLife: 150,
          turn: 0.5,
        },
      ],
    },
    {
      patternCooldown: 60,
      overheatInterval: 540,
      attacks: [
        {
          kind: 'polygonSpin',
          sides: 5,
          perSide: 3,
          spread: 0.36,
          speed: 760,
          damage: 10,
          bulletRadius: 6,
          bulletLife: 160,
          turn: 0.44,
        },
        { kind: 'ring', count: 28, speed: 780, damage: 10, bulletRadius: 7, bulletLife: 160 },
        {
          kind: 'slowField',
          zones: 3,
          windup: 36,
          activeTicks: 150,
          radius: 220,
          damage: 3,
        },
        {
          kind: 'spiral',
          count: 14,
          speed: 760,
          damage: 10,
          bulletRadius: 6,
          bulletLife: 160,
          turn: -0.52,
        },
      ],
    },
  ],
};

/**
 * 방어 보스 카탈로그. **배열 인덱스 = catalogId(계약, append-only)**.
 * M7c 풀 카탈로그(보스 3종)는 이 배열 뒤에만 추가한다.
 */
export const DEFENSE_BOSSES: readonly DefenseBossDef[] = [STEEL_GOLIATH];

/** 등록된 방어 보스 수. */
export const DEFENSE_BOSS_COUNT = DEFENSE_BOSSES.length;

/** 기본 수비대가 빈 보스 슬롯에 충원하는 catalogId(결정 #22 — 강철 골리앗 lv1 노말). */
export const DEFAULT_DEFENSE_BOSS_ID = 0;

/**
 * catalogId → 정의. 범위 밖은 0번으로 폴백한다(정규화를 통과한 데이터라도 카탈로그가 줄어드는
 * 상황에서 undefined 스펙 조회로 인한 무행동 엔티티가 생기지 않게 — spawnDefenseTurret 선례).
 */
export function defenseBossDef(catalogId: number): DefenseBossDef {
  const d = DEFENSE_BOSSES[catalogId];
  return d !== undefined ? d : DEFENSE_BOSSES[DEFAULT_DEFENSE_BOSS_ID]!;
}

// ---------------------------------------------------------------------------
// 강화 3축 → 스탯 스케일 (정수 basis-point)
// ---------------------------------------------------------------------------

/** 레벨 1단계당 전투력 가산(bp). lv1 = +0. */
export const DEFENSE_BOSS_LEVEL_BP = 800;
/** 승급 1단계당 전투력 가산(bp). */
export const DEFENSE_BOSS_ASCENSION_BP = 2500;
/** 등급 1단계당 전투력 가산(bp). 0=normal … 3=unique. */
export const DEFENSE_BOSS_RARITY_BP = 1500;

/**
 * 강화 3축 → 전투력 배율(basis-point, 10000 = ×1.00). 전부 정수 덧셈이라 플랫폼 무관.
 * HP·피해에만 적용하고 기하(반지름·탄속·사거리)는 건드리지 않는다 — 판정 f64 산술을
 * 강화 축이 흔들지 않게 하는 규율(data/guardian.ts resolveGuardianStats 와 동일 철학).
 */
export function defenseBossPowerBp(level: number, ascension: number, rarity: number): number {
  const lv = level < 1 ? 1 : Math.trunc(level);
  const asc = ascension < 0 ? 0 : Math.trunc(ascension);
  const rar = rarity < 0 ? 0 : Math.trunc(rarity);
  return (
    10000 +
    (lv - 1) * DEFENSE_BOSS_LEVEL_BP +
    asc * DEFENSE_BOSS_ASCENSION_BP +
    rar * DEFENSE_BOSS_RARITY_BP
  );
}

/**
 * 정수 스칼라 × basis-point 배율(결정론 — 단일 나눗셈 + Math.round). 최소 1 보장.
 * data/guardian.ts scaleStat 과 같은 산술 규율이라 Node·Deno 에서 비트 동일하다.
 */
export function scaleByBp(base: number, bp: number): number {
  const v = Math.round((base * bp) / 10000);
  return v < 1 ? 1 : v;
}

/** 감속 장판 subtype 재수출(코어방 스텝이 슬로우필드 실행에 쓴다). */
export const DEFENSE_BOSS_SLOW_SUBTYPE = HAZARD_SLOW;
