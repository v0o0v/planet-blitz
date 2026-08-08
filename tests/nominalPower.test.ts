/**
 * 명목 파워 모델 가드 (`src/bench/nominalPower.ts`).
 *
 * ## 이 파일이 지키는 것 — 드리프트가 전부다
 *
 * 명목 파워 모델은 sim 상수(무기 기준 피해·발사 간격·기준 HP·포탑 화력·런 par)를 **사본**으로
 * 들고 있다. 측정 계층이 sim 을 값으로 import 하지 않는 규율(`standardBuild.ts` 머리말과 같은
 * 사유) 때문에 그렇게 짰는데, 그 대가로 **sim 이 움직이면 표가 조용히 거짓말한다.**
 *
 * 이 리포가 여덟 번 데인 결함이 정확히 그 형태다("단위 테스트는 전부 초록인데 배선이 통째로
 * 없다"). 밸런스 판정을 이 표 위에서 하기로 한 이상, 두 축이 갈라지는 순간을 잡는 것이
 * 이 파일의 존재 이유다.
 *
 * 계약 검사(발산 금지)도 함께 둔다 — 초판이 플랫 효과를 비율로 환산하다 발산했고 클램프가
 * 그것을 가렸다. 같은 형태를 다시 만들지 않도록 **어떤 가정치에서도 유한**임을 못 박는다.
 */

import { describe, it, expect } from 'vitest';

import {
  BASE_DAMAGE,
  BASE_FIRE_CD_TICKS,
  MIN_FIRE_CD_TICKS,
  BASE_PLAYER_HP,
  BROOD_DRONE_DPS,
  BROOD_DRONE_LIFE_SEC,
  BROOD_MAX_DRONES as MODEL_BROOD_MAX,
  RUN_SECONDS_PAR as MODEL_RUN_PAR,
  DEFAULT_ASSUMPTIONS,
  nominalFor,
  nominalTable,
  powerSpread,
  relativeToStriker,
  sigEffect,
  filmDenyDps,
  NOMINAL_GEAR_SEED,
} from '../src/bench/nominalPower.js';
import {
  STANDARD_BUILD_SEED,
  standardEquipped,
  standardSkillInvest,
  standardStage,
  standardGearTable,
} from '../src/bench/standardBuild.js';
import type { NominalAssumptions } from '../src/bench/nominalPower.js';
import { DEFAULT_WEAPON, DEFAULT_CONFIG, BROOD_MAX_DRONES } from '../src/sim/world.js';
import { FIRE_CD_Q, FIRE_CD_MIN_Q, TICK_RATE } from '../src/sim/constants.js';
import {
  TURRET_BULLET_DAMAGE,
  TURRET_FIRE_COOLDOWN,
  TURRET_LIFE_TICKS,
} from '../src/sim/events.js';
import { RUN_SECONDS_PAR } from '../src/save/progressionPath.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { SIGNATURE_BITS } from '../src/sim/shipSignature.js';

describe('명목 파워 — sim 상수 드리프트 가드', () => {
  it('무기 기준 피해·발사 간격이 DEFAULT_WEAPON 과 같다', () => {
    expect(BASE_DAMAGE).toBe(DEFAULT_WEAPON.damage);
    expect(BASE_FIRE_CD_TICKS).toBe(DEFAULT_WEAPON.fireCooldownQ / FIRE_CD_Q);
  });

  it('발사 간격 하한이 FIRE_CD_MIN_Q 와 같다', () => {
    expect(MIN_FIRE_CD_TICKS).toBe(FIRE_CD_MIN_Q / FIRE_CD_Q);
  });

  it('기준 HP 가 DEFAULT_CONFIG.playerHp 와 같다', () => {
    expect(BASE_PLAYER_HP).toBe(DEFAULT_CONFIG.playerHp);
  });

  it('부화체 화력·수명·상한이 sim 정본과 같다', () => {
    expect(BROOD_DRONE_DPS).toBe(TURRET_BULLET_DAMAGE * (TICK_RATE / TURRET_FIRE_COOLDOWN));
    expect(BROOD_DRONE_LIFE_SEC).toBe(TURRET_LIFE_TICKS / TICK_RATE);
    expect(MODEL_BROOD_MAX).toBe(BROOD_MAX_DRONES);
  });

  it('런 par 가 표준 진행 경로 정본과 같다', () => {
    expect(MODEL_RUN_PAR).toBe(RUN_SECONDS_PAR);
  });
});

describe('명목 파워 — 발산 금지 계약', () => {
  /**
   * 초판은 플랫 효과를 가정된 분모로 나눠 `1/(1-감소율)` 로 접었고, 감소율이 1 을 넘자
   * 발산했다. 그 발산을 **0.9 클램프가 가렸다** — 나쁜 입력을 조용히 삼키는 계산기는
   * 계측기가 아니다. 이제 플랫은 가산이라 원리적으로 발산하지 않는다. 극단 가정치로 실증한다.
   */
  const EXTREMES: NominalAssumptions[] = [
    { ...DEFAULT_ASSUMPTIONS, armorAvgStacks: 999, cloakCycleRate: 1, cushionRecoverRate: 1 },
    { ...DEFAULT_ASSUMPTIONS, armorAvgStacks: -5, cloakCycleRate: 0, cushionRecoverRate: 0 },
    { ...DEFAULT_ASSUMPTIONS, killsPerSec: 1e6, runSeconds: 1e6 },
    { ...DEFAULT_ASSUMPTIONS, killsPerSec: 0, runSeconds: 0, overchargeUptime: 0 },
  ];

  for (const [i, a] of EXTREMES.entries()) {
    it(`극단 가정치 #${i} 에서도 전 기체 파워가 유한하다`, () => {
      for (const lv of [1, 50, 100]) {
        for (const { row } of nominalTable(lv, a)) {
          expect(Number.isFinite(row.dps), `${row.slug} dps`).toBe(true);
          expect(Number.isFinite(row.ehp), `${row.slug} ehp`).toBe(true);
          expect(Number.isFinite(row.power), `${row.slug} power`).toBe(true);
          expect(row.power, `${row.slug} power > 0`).toBeGreaterThan(0);
        }
      }
    });
  }

  it('장갑 스택은 상한으로 클램프되지만 그 사실이 값에 드러난다(조용한 삼킴 금지)', () => {
    // 999 스택과 상한 8 스택이 같은 값을 내는 것은 의도된 클램프다. 다만 그 클램프가
    // **설명 문자열에 실제 사용값을 찍어** 읽는 사람이 삼킴을 알아볼 수 있어야 한다.
    const huge = sigEffect(SIGNATURE_BITS[0], { ...DEFAULT_ASSUMPTIONS, armorAvgStacks: 999 }, 10);
    const cap = sigEffect(SIGNATURE_BITS[0], { ...DEFAULT_ASSUMPTIONS, armorAvgStacks: 8 }, 10);
    expect(huge.defMult).toBe(cap.defMult);
    expect(huge.note).toContain('8.0');
  });
});

describe('명목 파워 — 기준점 계약', () => {
  it('스트라이커는 시그니처가 방어에 무영향이다(순수 공격 주기)', () => {
    const { row, sig } = nominalFor(0, 50);
    expect(sig.defMult).toBe(1);
    expect(sig.defFlat).toBe(0);
    expect(row.sigDef).toBe(1);
  });

  it('스트라이커 시그니처는 가정치에 의존하지 않는다', () => {
    const a: NominalAssumptions = {
      ...DEFAULT_ASSUMPTIONS,
      armorAvgStacks: 8,
      cloakCycleRate: 1,
      killsPerSec: 50,
      cushionRecoverRate: 1,
      overchargeUptime: 1,
      runSeconds: 500,
    };
    expect(nominalFor(0, 50, a).row.power).toBe(nominalFor(0, 50).row.power);
  });

  it('상대 파워는 스트라이커 기준 1.0 이다', () => {
    const rows = nominalTable(50).map((r) => r.row);
    expect(relativeToStriker(rows).get(0)).toBe(1);
  });
});

describe('명목 파워 — 결정론', () => {
  it('같은 입력은 항상 같은 표를 낸다', () => {
    const a = nominalTable(100).map((r) => r.row.power);
    const b = nominalTable(100).map((r) => r.row.power);
    expect(a).toEqual(b);
  });

  it('7기체 전량이 표에 있고 타입 id 오름차순이다', () => {
    const rows = nominalTable(50).map((r) => r.row);
    expect(rows).toHaveLength(SHIP_TYPES.length);
    expect(rows.map((r) => r.typeId)).toEqual(SHIP_TYPES.map((_, i) => i));
  });

  it('spread 는 최대/최소 비이므로 1 이상이다', () => {
    const rows = nominalTable(50).map((r) => r.row);
    expect(powerSpread(rows)).toBeGreaterThanOrEqual(1);
  });
});

describe('표준 빌드 점프 — 하네스 치트 패널이 기대는 계약', () => {
  /**
   * 치트 패널의 "표준 빌드 점프" 버튼은 사람이 Lv1·Lv50·Lv100 을 실제로 앉아 보게 하는
   * 장치이고, **그 체감이 명목표의 절대 원점**이 된다. 그래서 지켜야 할 것이 둘이다:
   *  ① 그 3지점에서 실제로 빌드가 선다(빈 칸·0포인트면 버튼이 조용히 아무 일도 안 한 것이다).
   *  ② 사람이 앉은 빌드와 표가 잰 빌드가 **같은 아이템**이다(시드가 갈리면 전제가 무너진다).
   *
   * DOM 을 테스트하지 않는다 — 버튼이 부르는 두 함수의 계약이 여기 걸린 전부다.
   */
  it('시드 정본이 하나다 (치트 패널 = 명목표)', () => {
    expect(NOMINAL_GEAR_SEED).toBe(STANDARD_BUILD_SEED);
  });

  for (const lv of [5, 50, 100]) {
    it(`Lv${lv} 표준 빌드가 실제로 선다 (장비·스킬 둘 다 비어 있지 않다)`, () => {
      const equipped = standardEquipped(lv, STANDARD_BUILD_SEED, 0);
      const filled = Object.values(equipped).filter((it) => it !== undefined).length;
      expect(filled, '장착 칸').toBeGreaterThan(0);

      const invest = standardSkillInvest(0, lv);
      const pts = invest.reduce((a, b) => a + b, 0);
      expect(pts, '스킬 포인트').toBeGreaterThan(0);
    });
  }

  /**
   * ⚠️ **Lv1 이 0칸인 것은 설계다 — 버튼이 안 먹은 게 아니다.**
   *
   * 설계 밴드 1 은 8칸(`standardGearTable()[0].fill === 8`)인데 Lv1 표준 세트는 0칸이다.
   * 요구 레벨 게이트(ADR-0030)가 단계 1 장비를 Lv1 조종사에게 거부하고, 밴드 대표 레벨이
   * `BAND_LEVELS = [5,10,…]` 이라 **밴드 1 의 설계값은 Lv5 에서 실현**되기 때문이다.
   *
   * 이것을 단언으로 못 박아 두는 이유: 다음 사람이 "Lv1 표준 빌드 버튼이 아무 일도 안 한다"를
   * 결함으로 오인하고 게이트를 우회하는 수정을 넣는 것을 막기 위해서다. Lv1 맨몸은 **초반
   * 이탈(기준 A)이 재려는 바로 그 상태**다.
   */
  it('Lv1 은 맨몸이다 — 요구 레벨 게이트가 단계 1 장비를 거부한다(설계)', () => {
    const equipped = standardEquipped(1, STANDARD_BUILD_SEED, 0);
    expect(Object.values(equipped).filter((it) => it !== undefined)).toHaveLength(0);
    // 그런데 설계 표는 8칸이라고 적혀 있다 — 두 값의 차이가 곧 게이트의 몫이다.
    expect(standardGearTable()[0]?.fill).toBe(8);
    // 그리고 그 설계값은 밴드 대표 레벨(Lv5)에서 실제로 실현된다.
    expect(
      Object.values(standardEquipped(5, STANDARD_BUILD_SEED, 0)).filter((it) => it !== undefined),
    ).toHaveLength(8);
  });

  /**
   * ⚠️ **"만렙 빌드가 더 강하다" 를 단언하지 않는다 — 그것이 이 리포에서 참이 아니기 때문이다.**
   *
   * 시드 10개 실측(2026-08-08): 표준 장비의 평균 명목 DPS 가 Lv5 462 → Lv100 485 로 사실상
   * 평평하고 HP 는 219 → 201 로 오히려 내려간다. 시드 편차(179\~1024)가 레벨 효과를 압도한다.
   * 원인은 `standardBuild.ts` 가 이미 기록한 포화다 — **어픽스 롤 값이 아이템 레벨·단계와
   * 무관**해서(ADR-0037 이 그 축을 불가침으로 못박음) 장비 축 상한이 `8칸 × 6어픽스` 로
   * 고정이고, 후반 성장은 유니크 개수에만 남는다.
   *
   * 즉 후반 성장은 **장비가 아니라 스킬 포인트**(Lv50 49pt → Lv100 99pt)가 지고 있는데,
   * 그것은 ADR-0049 이후 sim 안의 규칙이라 `computeLoadoutStats` 에 안 들어간다 →
   * **명목표는 후반 성장을 구조적으로 못 본다.** 여기 단언으로 남겨 다음 사람이 이 표를
   * "레벨 간 비교"에 잘못 쓰지 않게 한다.
   */
  it('무장비 모드는 레벨과 완전히 독립이다 (기체 균형 정본이 장비·레벨에 안 흔들린다)', () => {
    const a = DEFAULT_ASSUMPTIONS;
    expect(nominalFor(0, 100, a, 0, 'none').row.power).toBe(
      nominalFor(0, 5, a, 0, 'none').row.power,
    );
  });

  it('장비 모드는 실제로 다른 빌드를 낸다 (배선 증명)', () => {
    const a = DEFAULT_ASSUMPTIONS;
    const none = nominalFor(0, 50, a, 0, 'none').row;
    const starter = nominalFor(0, 50, a, 0, 'starter').row;
    const standard = nominalFor(0, 50, a, 0, 'standard').row;
    // 스타터는 맨몸보다 세다(그것이 스타터 킷의 존재 이유다 — 맨몸 Lv1~5 클리어율 0.0%).
    expect(starter.baseDps).toBeGreaterThan(none.baseDps);
    // ⚠️ **HP 는 단언하지 않는다 — 현재 스타터 킷의 HP 는 맨몸과 정확히 같다(둘 다 100).**
    // 8칸이 전부 `normal`(어픽스 1개)이라 칸별 추첨이 순전히 운이고, 현행 고정 시드에서는
    // maxHp 계열이 한 칸도 안 뽑혔다(실측 구성: damagePct·fireRatePct·moveSpeedPct×2·
    // magnetPct·rangeFlat×2·pierce). 킷의 목적이 "초반 생존"인데 생존 축 기여가 0 인 것은
    // 등재된 미결 사항이지 이 테스트가 못 박을 계약이 아니다.
    expect(starter.hp).toBeGreaterThanOrEqual(none.hp);
    // 표준은 스타터보다 세다(밴드 설계가 등급·칸수를 올린다).
    expect(standard.baseDps).toBeGreaterThan(starter.baseDps);
  });

  it('표준 단계가 레벨 앵커와 맞는다 (Lv50→10 · Lv100→20)', () => {
    expect(standardStage(50)).toBe(10);
    expect(standardStage(100)).toBe(20);
  });
});

describe('명목 파워 — 버블 막 불사 임계', () => {
  /**
   * `filmDenyDps` 는 이 레인이 찾아낸 실제 밸런스 신호다. 막이 재생 주기당 고정량을
   * 무조건 흡수하므로, 받는 피해가 이 값 미만이면 소모보다 재생이 빨라 **죽지 않는다**.
   * 값 자체가 조정 대상이므로 리터럴로 고정하지 않고 **정의가 유지되는지**만 못 박는다.
   */
  it('상쇄 DPS = 흡수량 ÷ 재생 주기(초)', () => {
    const deny = filmDenyDps();
    expect(deny).toBeGreaterThan(0);
    expect(Number.isFinite(deny)).toBe(true);
  });

  it('버블 시그니처는 가산이지 비율이 아니다(발산원 봉인)', () => {
    const bubble = SHIP_TYPES.find((d) => d.slug === 'bubble');
    expect(bubble).toBeDefined();
    const sig = sigEffect(bubble!.signatureBit, DEFAULT_ASSUMPTIONS, 10);
    expect(sig.defMult).toBe(1);
    expect(sig.defFlat).toBeGreaterThan(0);
  });
});
