/**
 * 기본 장비(스타터 킷) — 신규 조종사와 **세대 교체 직후 기체**가 맨몸으로 출격하지 않게 한다.
 *
 * ## 왜 필요한가
 * `requiredLevel.ts` 의 드랍처 상한 주석이 실측으로 남긴 사실이 그대로 문제였다: **무장비
 * Lv1~5 는 단계1 클리어율이 0.0%**(96시드 × 3조건 = 288런 중 승리 0건)이고 표준 장비를
 * 입으면 66.7% 다. 그런데 `defaultShip()` 도 `retireActiveShip()` 의 신규 기체도 `equipped: {}`
 * 였다. 즉 게임을 처음 켠 사람과 만렙에서 퇴역한 사람이 둘 다 전패 구간을 지나야 했다.
 *
 * ## 등급이 `normal` 인 이유 (2026-08-08 개정 — 구값은 `magic`)
 * 스타터 킷은 **최저 등급**이어야 한다. 초반을 넘길 만큼만 주고 그 위는 파밍으로 벌게 하는
 * 것이 이 킷의 목적인데, `magic` 은 어픽스 2\~3개(개정 후)라 밴드 1 설계값에 근접해 버린다.
 *
 * ⚠️ **구 주석은 "`normal` 은 어픽스 0개라 입어도 스탯이 한 톨도 안 붙는다" 였고 그것이
 * 사실이었다.** 그래서 이 킷은 `magic` 을 쓸 수밖에 없었다 — 등급 선택이 아니라 **로러 결함
 * 회피**였던 셈이다. 2026-08-08 에 그 결함 자체를 고쳤다(`roll.ts` `affixCountFor`:
 * normal 0 → **1**, magic 1\~2 → 2\~3). 이제 최저 등급도 실제로 스탯이 붙으므로 킷을 원래
 * 있어야 할 자리로 내린다.
 *
 * `source.stage = 1` 은 유지한다 — `stageLevelCap(1) === 1` 이라 요구 레벨이 **1 로 클램프**
 * 되고(`requiredLevel.ts` §밴드 시작 기준) Lv1 기체가 즉시 착용할 수 있다.
 *
 * ## 결정론
 * 아이템은 정본 로러(`rollItem`)로만 만든다. 슬롯은 RNG 가 뽑으므로 **원하는 슬롯이 나올
 * 때까지 고정 시드 레인을 훑는다**(`src/bench/standardBuild.ts` 의 `rollForSlot` 과 같은 기법).
 * 시드가 상수라 같은 킷이 항상 바이트 동일하게 나온다. `id` 는 시드 파생 대신 슬롯별 고정
 * 문자열로 덮어쓴다 — `it-${seed}` 를 그대로 두면 두 모듈 칸이 같은 id 를 가질 수 있고,
 * 살베지·인벤토리 매칭이 `item.id` 로 도는 곳이 있다(`tests/save.test.ts` "matches salvage
 * targets by item.id").
 *
 * ⚠️ 이 모듈은 `src/bench/**` 를 import 하지 않는다. `standardBuild.ts` 는 계측 계층이고
 * `Lv < LEVEL_PER_STAGE` 에서 **빈 세트**를 돌려주므로 Lv1 신규 기체에는 애초에 쓸 수 없다.
 */

import { rollItem } from './roll.js';
import type { AffixRoll, EquipSlotId, Item, ItemSource, Rarity, SlotKind } from './types.js';

/** 스타터 장비의 드랍처. 단계 1 → `stageLevelCap` 이 요구 레벨을 1 로 낮춘다. */
const STARTER_SOURCE: ItemSource = { planet: 0, stage: 1 };

/** 스타터 장비 등급 = 드랍 등급의 **바닥**. 위 §등급 참조. */
const STARTER_RARITY: Rarity = 'normal';

/** 시드 레인 시작점(상수 — 결정론의 근원). */
const SEED_BASE = 0x57a2_0000;

/** 레인 하나가 훑는 시드 폭. 슬롯 7종 균등이라 평균 7회면 맞는다(4096 은 넉넉한 상한). */
const SEED_SPAN = 4096;

/** 기본 주무기 = 발칸(`WEAPON_VULCAN`). 무기 미장착 시 `loadout.ts` 가 쓰는 폴백과 같다. */
const STARTER_MAIN_WEAPON = 0;

/** 장착 칸 하나에 대한 저작 — 어느 종류를 어느 시드 레인에서 뽑고, 어떤 어픽스를 박을지. */
interface StarterSlotSpec {
  readonly equipSlot: EquipSlotId;
  readonly kind: SlotKind;
  /** 시드 레인 번호. 칸마다 달라야 아이템이 서로 달라진다(모듈 2칸 포함). */
  readonly lane: number;
  /** 이 칸에 **고정으로** 박는 어픽스. 위 §어픽스를 고정하는 이유 참조. */
  readonly affix: AffixRoll;
}

/**
 * 8칸 전부. 순서는 `EQUIP_SLOTS` 와 같다(모듈은 종류가 하나이고 칸이 둘이다).
 *
 * ## 어픽스를 고정하는 이유 (2026-08-08)
 *
 * 등급을 `normal` 로 내리면서 칸당 어픽스가 **1개**가 됐고, 그 1개를 가중 추첨에 맡겼더니
 * 실측 구성이 이랬다: damagePct · fireRatePct · **moveSpeedPct**(갑옷) · **magnetPct**(방패) ·
 * moveSpeedPct · rangeFlat · rangeFlat · pierce. 즉 **생존 축이 한 톨도 없고** 갑옷에
 * 이동속도, 방패에 자석이 붙었다.
 *
 * 이 킷의 존재 이유는 "무장비 Lv1\~5 는 단계1 클리어율 0.0%" 를 넘기게 해 주는 것이다.
 * 화력만 42% 올려 주고 생존은 0인 킷은 그 목적을 반만 수행하고, 게다가 **신규 유저가
 * 추첨 운에 따라 못 쓰는 킷을 받는다** — 결정론이라 "항상 같은 나쁜 킷"이기까지 하다.
 *
 * 그래서 스타터 킷만 어픽스를 칸 의미에 맞게 못 박는다. **드랍품은 그대로 랜덤이다** —
 * 고정되는 것은 이 킷 8칸뿐이고, 여기서 `rollItem` 을 쓰는 목적도 어픽스가 아니라
 * 슬롯·무기 타입·아이템 형태를 정본 경로로 얻는 것이다.
 *
 * 값은 전부 각 어픽스 정의의 **하한**이다(`data/affixes.ts`) — 최저 등급이므로 바닥값을 준다.
 */
const STARTER_SPECS: readonly StarterSlotSpec[] = [
  // 화력 — 최소한의 공격 축.
  { equipSlot: 'main', kind: 'main', lane: 0, affix: { id: 'sharp', stat: 'damagePct', value: 5 } },
  { equipSlot: 'sub', kind: 'sub', lane: 1, affix: { id: 'rapid', stat: 'fireRatePct', value: 6 } },
  // 생존 — 갑옷·방패가 실제로 체력을 준다(구 추첨은 여기 이동속도·자석을 박았다).
  {
    equipSlot: 'armor',
    kind: 'armor',
    lane: 2,
    affix: { id: 'of-vitality', stat: 'maxHpFlat', value: 10 },
  },
  {
    equipSlot: 'shield',
    kind: 'shield',
    lane: 3,
    affix: { id: 'of-warding', stat: 'maxHpPct', value: 4 },
  },
  // 기동·편의 — 초반 조작감과 수거.
  {
    equipSlot: 'engine',
    kind: 'engine',
    lane: 4,
    affix: { id: 'of-swiftness', stat: 'moveSpeedPct', value: 4 },
  },
  {
    equipSlot: 'core',
    kind: 'core',
    lane: 5,
    affix: { id: 'of-magnetism', stat: 'magnetPct', value: 8 },
  },
  {
    equipSlot: 'module0',
    kind: 'module',
    lane: 6,
    affix: { id: 'of-learning', stat: 'xpPct', value: 5 },
  },
  {
    equipSlot: 'module1',
    kind: 'module',
    lane: 7,
    affix: { id: 'ranging', stat: 'rangeFlat', value: 120 },
  },
];

/**
 * 레인 `lane` 을 훑어 `kind` 슬롯 아이템을 뽑는다. 시드가 상수라 결과도 상수다.
 * 레인이 고갈되면 **LOUD-FAIL** — 조용히 빈 칸을 남기면 "기본 장비가 붙었다"는 계약이 몰래
 * 깨진다(로러의 슬롯 분포가 바뀌었다는 신호이기도 하다).
 */
function rollStarterItem(spec: StarterSlotSpec): Item {
  for (let k = 0; k < SEED_SPAN; k++) {
    const seed = (SEED_BASE + spec.lane * SEED_SPAN + k) >>> 0;
    const it = rollItem(seed, STARTER_RARITY, STARTER_SOURCE);
    if (it.slot !== spec.kind) continue;
    return {
      ...it,
      // 칸별 고정 id — 시드 파생 id 는 칸 사이에서 겹칠 수 있다(§결정론 참조).
      id: `it-starter-${spec.equipSlot}`,
      // 어픽스는 추첨분을 **버리고** 칸 명세로 덮는다(§어픽스를 고정하는 이유).
      affixes: [spec.affix],
      // 주무기는 기본형(발칸)으로 고정한다. 첫 기체가 랜덤 무기로 시작하면 "기본 장비"가 아니다.
      ...(spec.kind === 'main' ? { weaponType: STARTER_MAIN_WEAPON } : {}),
    };
  }
  throw new Error(
    `starterKit: ${spec.kind} 슬롯을 시드 레인 ${spec.lane} 에서 못 뽑았다(span=${SEED_SPAN}). ` +
      'rollItem 의 슬롯 분포가 바뀌었는지 확인하라.',
  );
}

/**
 * 기본 장비 8칸 한 벌. **매번 새 객체**를 준다 — 공유하면 한 기체의 장비가 다른 기체로 샌다
 * (`zeroSkillInvest` 가 같은 이유로 새 배열을 주는 것과 같은 규율).
 */
export function starterEquipped(): Partial<Record<EquipSlotId, Item>> {
  const out: Partial<Record<EquipSlotId, Item>> = {};
  for (const spec of STARTER_SPECS) out[spec.equipSlot] = rollStarterItem(spec);
  return out;
}

/**
 * **빈 칸만** 기본 장비로 채운다. 이미 뭔가 입고 있는 칸은 절대 덮지 않는다 — 기존 유저
 * 마이그레이션이 이 함수를 쓰므로, 덮으면 파밍한 장비를 스타터로 바꿔치기하게 된다.
 *
 * @returns 실제로 채운 칸 수(0 이면 무변형).
 */
export function fillStarterEquipment(equipped: Partial<Record<EquipSlotId, Item>>): number {
  let filled = 0;
  for (const spec of STARTER_SPECS) {
    if (equipped[spec.equipSlot] !== undefined) continue;
    equipped[spec.equipSlot] = rollStarterItem(spec);
    filled += 1;
  }
  return filled;
}
