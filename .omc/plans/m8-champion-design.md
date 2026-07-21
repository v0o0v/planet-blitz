# M8 기체 챔피언화 — 구현 설계 정본

- 작성: 2026-07-21 (opus/high 아키텍트 정찰, 근거 전량 `파일:줄` 실측)
- 선행: M7c-content 완료
- 레인 문서(`.omc/plans/invasion-3layer-impl-lanes.md:401-417`)의 M8 절을 **대체**한다 — 그 절의 소유 파일 목록은 불충분하다(아래 §7 참조)

## 0. 레인 문서·인계 문서 정정 3건

1. **레인 문서 `:405-410` 의 M8 소유 파일 목록이 불충분하다.** `data/skills.ts`·`data/ships/`·`src/sim/shipSignature.ts`·`src/ui/pixi/hangar.ts` 4개만 적혀 있으나 실제로는 `src/save/profile.ts`·`src/items/loadout.ts`·`src/items/skills.ts`·`src/items/types.ts`·`src/sim/powerups.ts`·`src/sim/replay.ts`·`src/sim/world.ts`·`src/main.ts`·`src/ui/pixi/researchLab.ts`·`src/i18n/catalog.ts`·`scripts/deno-verify/**` 가 반드시 바뀐다. 원 목록으로 레인을 짜면 웨이브가 성립하지 않는다.
2. **레인 문서 `:428` 의 "탭 바 구현 0건 · 디자인 선행 필요 · 병렬화 불가 직렬 구간" 은 stale 이다.** M7b 가 `src/ui/pixi/tabs.ts` 에 `tabBarLayout(:65)`·`connectorSpans(:88)`·`makeTabBar(:116)` + 규격 상수(`TAB_H=58`·`TAB_GAP=8`·`TAB_SINK=10`)를 넣었다. M8 의 탭은 직렬 병목이 아니다.
3. **아트가 8방향 시트를 필요로 한다는 통념이 틀렸다.** `src/render/shipFacing.ts:53-65` 가 런타임 회전이라 기체당 **64×64 한 장**이면 된다.

## 1. ⚠️ `data/skills.ts` 인덱스는 **삼중** 해시 계약이다

| 경로 | 근거 | 파괴 시 증상 |
|---|---|---|
| 직접 폴드 | `src/sim/replay.ts:372-376` — `skillInvest` 를 길이 프리픽스 + 원소별 u32 로 접음 | 벡터 길이가 63에서 바뀌면 **모든 런** 해시 발산 |
| 파생 스탯 | `src/items/loadout.ts:213` → `cfg.loadout` → `replay.ts:334-355` | 노드 의미 변경 → 배율 변경 → 발산 |
| **sim 내부 RNG 슬라이스** | `src/sim/powerups.ts:295-303 investedInTree()` → `:313-316 powerupWeight` → `drawPowerupChoices` 가 **powerupRng 소비** | 슬라이스 레이아웃 변경 시 **레벨업 틱부터 RNG 스트림 발산**. 해시 폴드를 완벽히 보존해도 갈린다 |

세 번째가 가장 위험하다. `data/skills.ts:22-24` 주석이 경고하지만 그것이 **sim RNG 스트림까지** 닿는다는 점은 명시돼 있지 않다.

**따라서 "인덱스 재배치 금지"만으로 부족하다** — 슬라이스 레이아웃과 파워업 가중 결과까지 스트라이커에 대해 바이트 동일해야 한다.

## 2. 확장 형태 — append-only 가 아니라 **타입별 레지스트리 + 조건부 꼬리 폴드**

```
data/ships/types.ts     ShipTypeDef · ShipTreeDef · TreeAffinity
data/ships/striker.ts   data/skills.ts 의 기존 export 를 참조만 (리터럴 복사 금지)
data/ships/index.ts     SHIP_TYPES: readonly ShipTypeDef[]  — 인덱스 = typeId, append-only
```

```ts
export type TreeAffinity = 'offense' | 'defense' | 'utility';

export interface ShipTreeDef {
  readonly slug: string;           // 아이콘·i18n 키의 축
  readonly affinity: TreeAffinity; // 파워업 가중의 축 (트리 이름과 분리)
  readonly nodes: readonly SkillNode[];
}

export interface ShipTypeDef {
  readonly id: number;             // 인덱스 계약 — 재번호 금지
  readonly slug: string;
  readonly trees: readonly ShipTreeDef[];  // 길이 3
  readonly nodesPerTree: number;
  readonly capstoneGate: number;
  readonly signatureBit: number;   // uniqueMask 비트. 스트라이커 = -1(없음)
  readonly baseBp: { damageBp: number; fireRateBp: number; maxHpBp: number; moveSpeedBp: number };
}
```

### 핵심 규율 — **`data/skills.ts` 를 한 줄도 수정하지 않는다**
필요한 심볼(`SKILLS`/`SKILL_TREES`/`NODES_PER_TREE`/`CAPSTONE_GATE`)이 전부 이미 export 돼 있다. `data/ships/striker.ts` 는 import 해 조립만 한다.
리터럴을 새 파일로 **옮겨 적는 순간** 티어 행 하나의 순서 실수가 인덱스를 밀어 조용히 해시를 깨고, 그 실수는 타입 검사에 안 걸린다. 무수정이 가장 싼 불변 보장이다.

### 파워업 가중 일반화
현행 `PowerupDef.tree?: SkillTree`(`src/sim/powerups.ts:31`)는 `'firepower'|'survival'|'mobility'` 문자열 결속이라 **신규 타입은 전부 빌드 친화 가중을 잃는다.**
→ 태그를 트리 **이름** 에서 **affinity** 로 교체. 스트라이커 매핑(`firepower→offense`·`survival→defense`·`mobility→utility`)이 `SKILL_TREES.indexOf` 순서와 1:1 이라 **가중값 바이트 동일**. 파워업 풀 **인덱스는 불변**(`:42-43` — 인덱스가 pick 입력의 wire 값).

### 신규 StatKey 금지
추가하면 `zeroStatSums`(`src/items/skills.ts:32-52`)·`zeroSums`(`loadout.ts:138-157`)·`LoadoutConfig`·`replay.ts:336-355` 폴드 레이아웃이 함께 움직인다 = 해시 레이아웃 변경. 게다가 아이콘이 (stat, tierBand) 축이라(`uiTextures.ts:184`) 스탯 1종당 3장이 는다.
**기존 16종 StatKey 안에서만 트리를 짠다.** 차별화는 트리 이름·분포·시그니처·bp 보정이 담당.

## 3. 로스터 7종 (구현 반영, 2026-07-21)

정본 컨셉표: `.omc/plans/invasion-3layer-redesign.md:109-118`

> **이 표는 2026-07-21 커밋 `dd93cce`(로스터 5종 → 7종) 이후의 실코드 실측값이다.**
> 최초 초안은 5종(0~4)·`bion` 이었다. 사용자 지시로 ①`bion` → **`hatchling`** 개명(곤충 컨셉 반려, 귀여운 마스코트로 전환 — `id`·`signatureBit` 은 wire 계약이라 불변) ②`mallow`·`bubble` 2종 **append** 가 이루어졌다.
> 근거: `data/ships/index.ts:55-63`(`SHIP_TYPES`) · 각 `data/ships/<slug>.ts` 의 `signatureBit`/`baseBp` · `src/sim/shipSignature.ts:34-44`.

| id | slug | 역할 | 트리 3계열 (slug/affinity) | 시그니처 패시브 | 비트 | baseBp (dmg/fireRate/maxHp/move) |
|---|---|---|---|---|---|---|
| 0 | `striker` | 만능 기준점 | firepower/off · survival/def · mobility/util (**현행 그대로**) | **없음**(§11 참조) | −1 | 0 / 0 / 0 / 0 |
| 1 | `bruiser` | 맞으며 전진 | blade/off · morph/util · fortify/def | 피격 시 장갑 스택, 스택당 피해 감소 | 18 | +800 / −600 / +2500 / −500 |
| 2 | `arccaster` | 정지 포격 | chain/off · barrage/util · barrier/def | 일정 시간 정지 시 과충전, 이동 즉시 해제 | 19 | +1200 / −1000 / −1000 / −1200 |
| 3 | `phantom` | 은신 암살 | assassin/off · phase/util · disrupt/def | 무피격 지속 시 은신(적 조준 제외) + 해제 첫 타 배율 | 20 | +1500 / 0 / −2000 / +800 |
| 4 | `hatchling` | 동료 소환 | brood/off · nurture/util · shelter/def | 처치 적립, 임계 도달 시 병아리 드론 자동 출격 | 21 | −500 / +500 / +1000 / 0 |
| 5 | `mallow` | 완충 재생 | squish/off · mend/util · cushion/def | 피격 피해 일부를 **지연 피해**로 전환, 무피격 지속 시 회복 | 22 | −800 / −200 / +1800 / +600 |
| 6 | `bubble` | 거품 방막 | pop/off · drift/util · film/def | 주기적 피해 흡수막, 터질 때 주변을 밀어냄 | 23 | +300 / +700 / −1400 / +200 |

수치는 제안값(밸런스 패스 대상 — 5·6 은 특히 **미검증**). **확정된 것은 축과 부호뿐.**

### sim 배선 현황 — **브루저·아크캐스터 2종만 실동작**
`src/sim/world.ts` 가 실제로 게이트하는 시그니처는 `SIG_BRUISER_ARMOR`(`:1093`, `:2259`)·`SIG_ARC_OVERCHARGE`(`:1102`, `:1230`) **둘뿐**이다. 팬텀·해츨링·말로우·버블은 비트 상수 + 순수 정수 함수(`src/sim/shipSignature.ts`)까지만 있고 world 분기가 없다 — 아래 "신규 2종 우선 출시" 원칙에 따른 **의도된 미완**이며, 타입 선택·트리·baseBp·해시 폴드는 7종 전부 정상 동작한다.

### 신규 2종 우선 출시 = **브루저 + 아크 캐스터** (근거는 취향이 아니라 구현 위험)
- 두 시그니처 모두 **단일 정수 카운터** → `Entity.aux0` 하나로 충분. aux 는 이미 조건부 꼬리(`replay.ts:154-157`)라 스트라이커 해시 불변. 신규 Entity kind 도 신규 폴드도 불요.
- 아크 캐스터 과충전 빔은 `WEAPON_BEAM`(`loadout.ts:29`) 재사용.
- **팬텀 보류 이유**: 은신이 적 조준 대상군을 바꿔 `world.ts` 의 `nearestTarget`·적 AI 를 넓게 건드린다 — M8 최대 경합 파일이고 PvE 해시 파급 여지 최대.
- **해츨링(구 `bion`) 보류 이유**: 소환 경로가 침공 레인이 이미 겪은 함정(RNG 미소비 `summonEnemy` vs RNG 소비 `spawnEnemy`, 레인 문서 `:135`)을 그대로 재현. 소환 개체마다 아트도 는다.
- **말로우·버블 보류 이유**(2026-07-21 append 분): 둘 다 **시간축 상태**(지연 피해 큐 · 주기 재생성 방막)를 요구해 단일 `aux0` 카운터로 안 끝난다. 브루저·아크캐스터가 실전 검증될 때까지 순수 함수 단계에서 멈춘다.
- 부수 효과: 브루저(근접·저기동·고HP)와 아크캐스터(정지·원거리·저HP)는 플레이 축 양 극단 → 최소 코드로 "타입이 정말 다르다" 체감 최대.

## 4. 시그니처 패시브 — 신규 필드·신규 폴드 0

### 게이트 = `uniqueMask` 미사용 비트
`src/sim/capstones.ts:8-12` 가 이 기법을 명문화. 신규 `LoadoutConfig` 필드나 신규 `hashWorld` 폴드 없이 미사용 상위 비트를 쓰면 그 기능을 안 쓰는 런의 해시가 **바이트 불변**.

**비트 가용 현황(구현 후 실측, `src/sim/shipSignature.ts:11-17`):** 0~14 유니크 15종(`src/sim/uniques.ts`) · 15~17 캡스톤 3종(`capstones.ts`) · **18~23 시그니처 6종** · **24~30 미사용 7비트** · 31 은 영구 사용 금지(`1<<31` 이 음수라 마스크 연산 취약, `SIGNATURE_BIT_MAX=30`).

배정 — **7종 확정판**(`shipSignature.ts:34-44`). 최초 초안은 18~21 네 개였고, `bion`→`hatchling` 개명 시 **비트 값 21 은 wire 계약이라 그대로 두고 상수명만** `SIG_BION_SPORE` → `SIG_HATCHLING_BROOD` 로 바꿨다. 22·23 은 append 분이다.

| 상수 | 비트 | 타입 |
|---|---|---|
| `SIG_BRUISER_ARMOR` | 18 | 1 `bruiser` |
| `SIG_ARC_OVERCHARGE` | 19 | 2 `arccaster` |
| `SIG_PHANTOM_CLOAK` | 20 | 3 `phantom` |
| `SIG_HATCHLING_BROOD` | 21 | 4 `hatchling` (구 `SIG_BION_SPORE`) |
| `SIG_MALLOW_CUSHION` | 22 | 5 `mallow` |
| `SIG_BUBBLE_FILM` | 23 | 6 `bubble` |

상수 정본 소유자는 **`src/sim/shipSignature.ts`**(캡스톤 비트가 sim 에 살고 `loadout.ts` 가 import 하는 현행과 동형). 테스트·게이트는 하드코딩 목록 대신 `SIGNATURE_BITS`(`shipSignature.ts:50-57`) 배열을 순회한다 — 비트가 늘면 게이트가 자동으로 따라온다.

OR-in 은 `computeLoadoutStats` 안, 캡스톤 블록(`loadout.ts:217-221`) **바로 뒤**에 같은 문법으로:
```ts
const sig = SHIP_TYPES[typeId]?.signatureBit ?? -1;
if (sig >= 0) uniqueMask |= 1 << sig;   // 스트라이커는 -1 → 무연산
```

### 효과 산술 = 정수 bp, 단일 나눗셈
```ts
export function armorReducedDamage(damage: number, stacks: number): number {
  const bp = clampStacks(stacks) * ARMOR_PER_STACK_BP;   // 정수
  return damage - Math.round((damage * bp) / 10000);     // 나눗셈 1회
}
```
**금지**: `damage *= 0.975` 를 스택 수만큼 반복(f64 누적) · `Math.pow` · 중간 f64 보관.
스탯 보정(baseBp)은 `applyShipLineageBonus`(`loadout.ts:167-173`)와 **완전히 같은 문법** — 이미 검증된 결정론 경로이고 `:168` 의 `if (b === 0) return` 조기 반환이 스트라이커(전 축 0)를 자동 무연산으로 만든다.

### 해시 스트림 진입 경로
| 무엇 | 어디로 | 신규 폴드 |
|---|---|---|
| 시그니처 활성 | `uniqueMask` → `replay.ts:351` | 없음 |
| 스탯 보정 | `loadout.damageMult` 등 → `replay.ts:339-350` | 없음 |
| 런타임 스택 | `entities[0].aux0` → `replay.ts:154-157` 조건부 꼬리 | 없음 |
| 트리 투자 | `skillInvest` → `replay.ts:372-376` (길이 63 유지) | 없음 |
| **shipType 자체** | `hashWorld` 최후미 조건부 꼬리 | 1개(조건부) |

```ts
// hashWorld 최후미 — invasion3 if-블록이 완전히 닫힌 뒤, return 직전
const st = state.config.shipType ?? 0;
if (st !== 0) {
  h = hashU32(h, SHIP_HASH_VERSION >>> 0);
  h = hashU32(h, st >>> 0);
}
```
**구현 착지 위치(실측):** `src/sim/replay.ts:444-454`(`SHIP_HASH_VERSION = 1` 은 `:50`). 설계대로 invasion3 블록 **바깥**이며 `shipType !== 0` 조건부다.
스트라이커는 **한 폴드도 실행하지 않는다**. `replay.ts:392-394` 주석이 "신규 3레이어 필드는 이 블록 최후미에만 append" 라고 했으므로 M8 의 append 는 **invasion3 블록 바깥, 그 뒤**임을 레인 프롬프트에 못박을 것.

이 폴드는 엄밀히 잉여다(시그니처 비트로 타입이 유일 결정됨). 그럼에도 넣는 이유: EF 가 타입을 **추론이 아니라 명시**로 읽고, 훗날 시그니처 없는 타입이 추가돼도 추론이 조용히 깨지지 않는다. 스트라이커 비용이 0이라 보험료가 공짜.

## 5. 해시 불변 전략

### 다섯 겹 방어
1. **스트라이커 리터럴 무이동** — `data/skills.ts` 수정 0줄
2. **전 신규 경로의 스트라이커 조기 탈출** — `signatureBit<0` → OR 없음 / `baseBp` 전 축 0 → 조기 반환 / `shipType===0` → 폴드 없음
3. **`WorldConfig.shipType?: number` 를 optional 로** — 기존 config 조립이 미지정이면 그대로 스트라이커
4. **벡터 길이 63 고정(타입 0 한정)** — 노드 수는 타입별 자유, 타입 0 만 63 동결
5. **파워업 가중 1:1 매핑 증명**

### ⚠️⚠️ 최우선 권고 — **W0 골든 사전 녹화**
**리팩터를 시작하는 순간 "불변"의 기준이 사라진다.** 현재 저장소에 스트라이커 빌드의 per-tick 해시 배열 골든이 **없다** — `tests/determinism.test.ts` 와 `fixtures.json` 은 특정 시나리오만 덮고 스킬 투자 조합이 얇다.

W0 에서 **프로덕션 파일을 한 줄도 건드리기 전에** 녹화·커밋:
- `scripts/recordStrikerBaseline.ts` — 6시나리오(무투자 / 화력 캡스톤 / 생존 캡스톤 / 기동 캡스톤 / 3계열 혼합 / 만렙 근접) × 2행성, 각 3000틱, **per-tick 해시 배열 전량** + 각 런의 `drawPowerupChoices` 출력 인덱스 시퀀스
- `tests/fixtures/striker-prem8.json`
- `tests/shipHashBaseline.test.ts` — 재실행이 골든과 배열 전체 일치

**이것이 없으면 위 다섯 겹은 전부 주장일 뿐 증명이 아니다.**

## 6. 퇴역 / 개방 흐름

### 현행의 구조적 불일치 3건 (실측)
1. **`Ship` 에 타입 필드가 없다** — `src/save/profile.ts:62-71`, `defaultShip() :178-180`
2. **`retireActiveShip` 이 기체를 교체하지 않는다** — `src/save/guardianLifecycle.ts:72-97` 는 수호 스냅샷 + 계보 지급 + 장비 창고 회수까지만. 같은 `Ship` 이 그대로 활성으로 남는다. **"다음 기체 선택" 흐름은 UI 뿐 아니라 모델 자체가 없다.**
3. **`skillInvest` 가 계정 단위** — `profile.ts:100-103` 주석이 "Account-wide (research lab is a base building, not per-ship)" 라고 명시. 타입별 고유 트리(ADR-0019)와 정면 충돌.

### 결정 — `skillInvest` 를 **기체 단위**로 내린다
타입별이 아니라 기체별인 이유: 퇴역은 CONTEXT.md:86-87 상 **세대 리셋**이고, 세대를 관통하는 계정 성장은 이미 **계보**가 담당한다(`data/lineage.ts:4-13`). 타입별 보존이면 "스트라이커로 되돌아오면 옛 빌드 그대로" 가 되어 퇴역의 무게가 사라진다.

```ts
export interface Ship {
  readonly id: string;
  name: string;
  typeId: number;        // 신규 — SHIP_TYPES 인덱스, 기본 0
  level: number;
  xp: number;
  equipped: Partial<Record<EquipSlotId, Item>>;
  skillInvest: number[]; // 신규 — 길이 = SHIP_TYPES[typeId] 노드 수
}
```

**`Profile.skillInvest` 는 호환 미러로 남기지 말고 삭제한다.** 남기면 "연구소는 미러에 쓰는데 런은 기체 벡터를 읽는" 무배선 결함이 그대로 재현된다. 삭제하면 tsc 가 전 독자를 열거해 준다 — 확인된 독자: `profile.ts:22,420-429` · `guardianLifecycle.ts:55` · `main.ts:706,772,930` · `ui/researchLab.ts:220,246-248,281,306` · `ui/pixi/researchLab.ts:35`.

### 마이그레이션
- `SAVE_VERSION` 3 → **4** (`src/items/types.ts:18`)
- `migrateV3toV4`: 각 `ship` 에 `typeId=0`, `skillInvest=normalizeSkillInvest(profile.skillInvest, 0)` 주입 후 `profile.skillInvest` 제거. 기존 유저는 전원 스트라이커이며 투자가 활성 기체로 승계
- `normalizeSkillInvest(v, typeId)` — `profile.ts:420-429` 타입 파라미터화. 손상 세이브는 기존대로 0 복구
- **`normalizeShip` 의 범위 밖 `typeId` 는 `clamp` 가 아니라 `normalizeShipTypeId`(범위 밖 → **0**, 스트라이커)로 처리한다. 2026-07-21 확정.**
  ⚠️ 최초 초안은 "`[0, SHIP_TYPES.length-1]` 로 clamp" 였는데, 그러면 `999 → 4(BION)` 이 되어 **손상된 세이브값이 조용히 *다른 기체*를 준다.** 3자(코드 `clampInt` / 테스트 기대 `999→0` / L1 의 `normalizeShipTypeId`)가 갈려 실제로 테스트가 실패했다.
  채택 근거: ①손상값 복구는 "안전한 기본값"이어야지 "가장 가까운 유효값"이면 안 된다 ②조회층(`selectableShipTypes`)과 저장층이 같은 규칙을 쓰게 된다.
  어느 쪽이든 범위 밖 값이 런타임에 `undefined` 타입으로 흘러가면 loadout 전체가 조용히 중립이 되는 것은 막아야 한다.

**DB 마이그레이션 필요 여부 — 미확인.** `supabase/migrations/` 에서 `skillInvest` grep 0건이라 트리 벡터는 서버 테이블에 없어 보이고(리플레이 헤더로만 이동 — `verifyInvasionCore.ts:40`), 그렇다면 DB 변경 불요. **L3 레인의 첫 작업으로 `supabase/migrations/**` + `src/net/**` 를 실측 확인해 결론낼 것.**

### 흐름
- **첫 기체 자동 지급**: `defaultProfile()` 이 이미 `ships:[defaultShip()]` 를 준다(`profile.ts:191`). `typeId: 0` 한 줄 추가로 끝
- **퇴역 → 자유 선택**: `retireActiveShip(profile, preset, nextTypeId)` 로 시그니처 확장, 기존 동작 뒤에 신규 `Ship` push + `activeShipIndex` 이동
- **전체 개방**: `selectableShipTypes()` 는 `SHIP_TYPES` 전량 반환. **해금 게이트 부재를 테스트로 못박는다** — 레인이 선의로 레벨 조건을 붙이는 것을 막는 유일한 수단(ADR-0019 는 전체 개방을 명시적 사용자 선택으로 기록)

## 6-bis. 구현 중 확정된 사항 (W1 완료 시점, 2026-07-21)

W1(L0-baseline / L1-schema / L2-signature / L3-save) 착지 후 실측으로 확정된 것들. **W2·W3 레인은 이 절을 반드시 읽어라.**

### `Profile.skillInvest` 는 미러가 아니라 **별칭(alias)** 으로 구현됐다
L3 가 설계서 §10-3("연구소는 미러에 쓰는데 런은 기체 벡터를 읽는" 결함)을 **구조적으로 불가능**하게 만들었다 — 복사본이 아니라 **활성 기체 벡터와 같은 배열 인스턴스**를 가리킨다. 같은 메모리라 갈라질 수가 없다. 덕분에 W1·W2 동안 `main.ts`·`researchLab` 을 한 줄도 안 고치고도 거동이 정확하다.

⚠️ **대가로 생긴 규약 2개. 깨면 조용히 끊어진다.**
1. **재할당 금지.** `profile.skillInvest = X` 로 갈아끼우면 별칭이 즉시 끊긴다. 그래서 `respecSkills` 가 재할당이 아니라 `.fill(0)` 이다. 테스트로 못박혀 있다.
2. **`activeShipIndex` 가 움직이는 새 경로에는 반드시 `refreshSkillInvestAlias` 호출이 필요하다.**
   → **W3-L8(UI)이 기체 전환/챔피언 선택 화면을 만들면 정확히 이 함정을 밟는다.** 전환 후 별칭 갱신을 빠뜨리면 연구소가 옛 기체 벡터를 계속 편집한다.

이 구조는 **W3-L7 이 `Profile.skillInvest` 를 삭제하면 소멸하는 임시 장치**다.

### W3-L7 이 삭제해야 할 `Profile.skillInvest` 독자 — 전량 (L3 실측)
- `src/main.ts:706` · `:772` · `:930` — **3중복 조립.** `buildRunConfig(profile)` 단일 함수로 추출하며 `activeShip(profile).skillInvest` 로 전환
- `src/ui/researchLab.ts:220, 246, 247, 248, 281, 306`
- `src/ui/pixi/researchLab.ts:420, 534, 552, 606, 664, 665, 666, 755, 831, 935`
- `src/save/profile.ts:119-129`(필드 선언) · `:268-277`(`refreshSkillInvestAlias`) · `:258`·`:568`(별칭 초기화 2곳)
- `tests/shipHashBaseline.test.ts:213, 240`

**삭제 순서**: 위 UI·main 독자를 `activeShip(...).skillInvest` 로 옮긴 뒤 → 필드 + `refreshSkillInvestAlias` + 호출 3곳 제거.

⚠️ L3 의 통합 테스트는 `main.ts` 조립을 **재현**한 것이지 `buildRunConfig` 를 호출한 것이 아니다(그 함수가 아직 없었다). **L7 이 추출하는 순간 그 헬퍼를 지우고 실함수 호출로 바꿔야** §10-2 가 문자 그대로 닫힌다. 코드에 그 지시 주석이 남아 있다.

### DB 마이그레이션 = **불요. 확정.** (설계서 §6 의 "미확인" 종결)
- `supabase/migrations/**`·`src/net/**` 전량 grep 에서 `skillInvest`/`skill_invest` **0건**
- 서버 SQL 이 `profiles.save`(jsonb) **안쪽**을 읽는 곳은 전수 조사 결과 `save->>'credits'` 와 `save->>'minerals'` **둘뿐**(repair_defense·card economy·defense_units·core_modules·m7a RPC 등 12곳 전부)
- `profiles.save_version` 은 `integer not null default 0`(20260717000000:65), **CHECK 제약·서버측 분기 전무** → 4 를 그대로 받는다
- `serializeProfile`(profileSync.ts:41-43)이 Profile 을 통짜로 넣으므로 스키마 변경이 jsonb 안에 갇힌다
→ **신규 마이그레이션 SQL 0건.**

부수 사실: 서버 v3 blob 은 유저가 v4 클라로 한 번 저장하기 전까지 v3 로 남는다. 서버가 그 안을 안 읽으므로 무해하다.

### `migrateV3toV4` 의 다중 기체 처리 — **전원이 계정 벡터를 물려받는다. 채택 확정.**
L3 가 대안(활성 기체만 승계, 나머지 0)을 제시하며 판단을 요청했다. **현행(전원 승계)을 유지한다.**
근거: v3 에서 `skillInvest` 는 **계정 단위**였다(`profile.ts:100-103` 주석이 명시). 즉 v3 에서 기체를 바꿔도 같은 투자가 따라다녔으므로 **모든 기체가 실제로 그 투자를 갖고 있었다.** 전원 승계가 v3 semantics 의 충실한 이식이고, "활성만 승계"는 나머지 기체에 대해 **없던 손실을 만든다.** (실제 v3 세이브의 `ships` 는 항상 길이 1 이라 관측 가능한 차이도 없다.)

### `investSkill` 은 아직 스트라이커 정본을 쓴다 → **M8-L4 가 타입별로 일반화해야 한다**
`profile.ts:341-355` 의 노드 정의·캡스톤 게이트가 `SKILLS`/`capstoneUnlocked`(스트라이커 정본)를 참조한다. 타입 1~4 가 스텁인 동안은 도달 불가 경로지만, L6 이 실데이터를 채우면 **타입 1~4 의 투자가 스트라이커 트리 규칙으로 판정된다.**

## 7. 레인 분해 (파일 겹침 0)

### W0 — 단독, 선행 필수
**M8-L0-baseline** — 소유: `scripts/recordStrikerBaseline.ts` · `tests/fixtures/striker-prem8.json` · `tests/shipHashBaseline.test.ts`. 선행 없음. **프로덕션 파일 0개 수정.**

### W1 — 3레인 병렬
**M8-L1-schema** — `data/ships/types.ts` · `index.ts` · `striker.ts` · **신규 4종 스텁**(`bruiser`·`arccaster`·`phantom`·`bion`) · `tests/shipTypes.test.ts`. **`data/skills.ts` 를 열지 않는다.** 킥오프 합의: `signatureBit` 4값 · `zeroSkillInvest(typeId)` 시그니처 · `TreeAffinity` 3종

**M8-L2-signature-sim** — `src/sim/shipSignature.ts` · `tests/shipSignature.test.ts`. `SIG_*` 비트 상수 정본 + 순수 정수 함수(`armorReducedDamage`·`overchargeBp`·`cloakActive`·`sporeThreshold`). **world.ts 배선 없음**

**M8-L3-save** — `src/save/profile.ts` · `guardianLifecycle.ts` · `src/items/types.ts` · `tests/save.test.ts` · `tests/guardianLifecycle.test.ts`. **첫 작업은 코드가 아니라 `supabase/migrations/**` + `src/net/**` 실측**으로 DB 변경 필요 여부 결론

### W2 — 3레인 병렬
**M8-L4-derive** — `src/items/loadout.ts` · `skills.ts` · `tests/skills.test.ts` · `tests/capstones.test.ts`. 선행 L1·L2·L3

**M8-L5-sim** — `src/sim/world.ts` · `powerups.ts` · `replay.ts` · `tests/determinism.test.ts` · `weapons.test.ts` · `invasionHash.test.ts`. 선행 L1·L2. **world.ts·replay.ts 유일 소유자**

**M8-L6-content** — `data/ships/{bruiser,arccaster,phantom,bion}.ts` · `tests/shipContent.test.ts`. 선행 L1(**W1 종료 시 소유권 인계**). **신규 StatKey 금지**

### W3 — 2레인 병렬
**M8-L7-runwire** — `src/main.ts` · `src/harness/{core,cheatPanel,presets}.ts` · `tests/harness.test.ts` · `tests/shipIntegration.test.ts`. **`buildRunConfig(profile)` 단일 함수로 추출**(현재 `main.ts:706,772,930` 3중복)

**M8-L8-ui** — `src/ui/pixi/hangar.ts` · `championSelect.ts`(신규) · `researchLab.ts` 양판 · `uiTextures.ts` · `src/ui/buildStatus.ts` · `tests/researchLabLayout.test.ts` · `skillIcons.test.ts`

### W4 — 단독, 마지막
**M8-L9-i18n-art** — `src/i18n/catalog.ts` · `src/render/textures.ts` · `assets/**` 신규 · `tests/i18n.test.ts`. 선행 L6·L8. i18n 키는 **`SHIP_TYPES` 배열에서 파생**(하드코딩 목록 금지)

**교차 확인:** `data/skills.ts` 는 어느 레인도 소유하지 않는다(무수정이 목표). `data/ships/*.ts` 는 L1 창설 → L6 인계. `src/sim/*` 는 L2(신규)/L5(기존)로 분리. 겹침 0.

## 8. UI 함정 준수표 (전부 실측 근거)

| 함정 | 준수 | 근거 |
|---|---|---|
| DOM 혼용 | 전부 Pixi. 새 화면을 DOM 으로 만들지 않는다 | ADR-0014 |
| 목록 행 클릭 | 리스너를 **행 Container** 에. `src/ui/pixi/listRow.ts` 재사용 | 바탕 Graphics 면 위 텍스트가 클릭을 삼킴 |
| 휠 스크롤 | `makeScrollArea`(`scrollArea.ts:70`). 마스크 Graphics 는 히트 테스트 제외 → 클립 Container+hitArea | |
| 패널 여백 | `panelContent(w,h)`(`nineSlicePanel.ts:76`) 상자 안에만 배치 | 제목이 테두리에 붙는 결함 2회 재발분 |
| 자라는 패널 | 트리 미리보기 바닥은 `getLocalBounds()` 실측 후 높이 결정 | 위아래 여백 비대칭 방지 |
| 밝은 화면 위 팝업 | 퇴역 확인 모달은 `fillAlpha: 1` | |
| 상위→하위 | 격납고→챔피언 선택은 **`suspend()`/`resume()`** | `defenseCommand.ts:560-565`, 근거 주석 `modulesView.ts:19-20`. `show()` 면 미저장 장비 편집 소실 |
| 리스너 이중 등록 | 텍스처 로드 후 재호출되는 build **안에** `on('pointertap')` 금지. 격납고 `render()`(`hangar.ts:273-297`)의 wipe-then-rebuild 규약을 따르거나 리스너를 재빌드 밖에 1회 바인딩 | |
| 이모지 | 기체·트리 이름에 컬러 이모지 금지 | `src/ui/pixi/text.ts` stripEmoji |

쇼케이스 패널(`hangar.ts:455-553`)이 `ship_showcase_fighter.png` 를 고정 참조(`:477`) → `activeShip(profile).typeId` 로 `ship_showcase_<slug>.png` 를 고르되 **null 폴백은 기존 텍스처**(아트가 늦어도 화면이 비지 않게).

## 9. 아트

### 기존 규격 실측
| 항목 | 실측값 | 근거 |
|---|---|---|
| 인게임 플레이어 스프라이트 | **64×64 PNG, 단일 프레임, 방향 1개** | `assets/player.png` |
| 방향 처리 | 런타임 회전 — **8방향 시트 불요** | `src/render/shipFacing.ts:53-65` |
| 격납고 쇼케이스 | **128×128** | `assets/ship_showcase_fighter.png`, 사용처 `hangar.ts:477` |
| 스킬·캡스톤 아이콘 | 64×64 | `assets/skill_*.png` |
| 캡스톤 아이콘 명명 | `skill_capstone_<tree-slug>.png` | `uiTextures.ts:183` |
| 노드 아이콘 명명 | `skill_<statSlug>_<band>.png` — (스탯, 티어대) 축 | `uiTextures.ts:184`, ADR-0015 |

### 필요 목록 — 합계 **24장**
| 자산 | 수량 | 규격 | 비고 |
|---|---|---|---|
| 인게임 기체 스프라이트 | 4 | 64×64 | 타입당 1장, 단일 방향 |
| 격납고 쇼케이스 | 4 | 128×128 | `ship_showcase_<slug>.png` |
| 챔피언 선택 초상 | 0 | — | **쇼케이스 재사용**(4장 절감) |
| 계열 캡스톤 아이콘 | 12 | 64×64 | 4타입 × 3계열 |
| 로스터 행 엠블럼 | 4 | 64×64 | 목록 행 좌측 |
| 스킬 노드 아이콘 | 0 | — | 기존 StatKey 재사용 시 35장으로 충족 |

### 파일명 규약 — **확정(2026-07-21)**
현재 `src/render/textures.ts:859` 가 `tryLoad('player.png')` **단일 텍스처**로 플레이어를 로드한다. 타입별 분기가 없다.

- **인게임 스프라이트**: `ship_<slug>.png` (64×64). typeId ≥ 1 만 신규.
  **typeId 0(스트라이커)은 기존 `player.png` 를 그대로 쓴다** — 파일을 옮기거나 개명하지 않는다. 폴백 순서는 `ship_<slug>.png` → `player.png`.
- **격납고 쇼케이스**: `ship_showcase_<slug>.png` (128×128). 스트라이커는 기존 `ship_showcase_fighter.png` 유지.
- 둘 다 **미존재 시 조용히 폴백**해야 하고 예외를 던지면 안 된다(아트가 코드보다 늦게 도착한다).

### 아트 채택 현황 — **완료 (2026-07-21 마감 실측)**
- 위 "필요 목록 24장" 은 4종 기준의 **초안**이다. 실제 배치분은 **12장**: 인게임 `ship_<slug>.png` 6장(`bruiser`·`arccaster`·`phantom`·`hatchling`·`mallow`·`bubble`) + 쇼케이스 `ship_showcase_<slug>.png` 6장. 스트라이커는 기존 `player.png` / `ship_showcase_fighter.png` 를 그대로 쓴다(커밋 `dd93cce`·`7ae64b6`).
- **계열 캡스톤 아이콘 신규 0장** — 초안은 4타입 × 3계열 = 12장을 예상했으나, `buildShipTree`(`data/ships/authoring.ts:59,67`)가 `SkillNode.tree` 에 **affinity 의 레거시 트리명**(`firepower`/`survival`/`mobility`)을 넣으므로 `skillIconName`(`uiTextures.ts:224`)이 항상 기존 3장으로 해석된다. 로스터 행 엠블럼도 쇼케이스 재사용으로 대체됐다.
- **4번 기체 반려 → 해소.** 1차 배치의 곤충·생체 컨셉이 "벌레 말고 다른 컨셉. 너무 징그럽다. 귀여운 걸로" 로 반려돼 `bion` → `hatchling`(귀여운 마스코트)으로 개명·재생성됐고, 같은 지시로 `mallow`·`bubble` 이 추가됐다. 메커니즘(처치 적립 → 동료 자동 출격)은 불변이며 트리 slug 도 `brood`/`nurture`/`shelter` 로 함께 교체됐다.

### 파이프라인 지시
- 팔레트·화풍은 문서 스펙이 아니라 **기존 파일을 레퍼런스로 전달**: `assets/player.png` + `ship_showcase_fighter.png` + `skill_capstone_*.png`. (정확한 팔레트 값은 **미확인** — 색 샘플링 미수행. 손으로 적은 스펙보다 실파일 레퍼런스가 안전)
- ✅ **기체 스프라이트 기준 방향 = +X(오른쪽). 확정(2026-07-21 실측).**
  근거 3중: ①`src/render/entityRenderer.ts:380-382` 이 `shipFacing(...)` 결과를 `sprite.rotation` 에 **오프셋 없이 그대로** 대입한다(`:386` 의 일반 엔티티 경로도 `rotation = e.angle` 로 동일하게 무오프셋). ②`shipFacing`(`src/render/shipFacing.ts:61-64`)은 `atan2(dy, dx)` 를 반환하므로 각도 0 = dx>0 = 화면 오른쪽. ③`assets/player.png` 를 실제로 열어 확인 — 기수가 **오른쪽**을 향한 청록 전투기.
  → 신규 기체 4종 스프라이트는 전부 **오른쪽을 향하게** 그린다. `player.png` 를 방향 레퍼런스로 함께 전달할 것.
- 생성분은 전역 규칙에 따라 `D:\ClaudeCowork\pixellab-forge` 의 `library/` 로 동기화(캐시 `add` 만으로 끝내지 않는다)
- 신규 아이콘 basename 은 `SKILL_ICON_NAMES`(`uiTextures.ts:27`) 리터럴 목록에 **반드시 등재** — 누락 시 조용히 null 폴백이라 결함이 안 보인다

## 10. "단위 테스트 그린인데 배선이 통째로 없다" — M8 예측 지점 9건

공통 원칙: 테스트가 sim/데이터를 직접 조립하지 말고 **실제 앱이 쓰는 함수**를 타야 한다.

| # | 예측 결함 | 왜 단위 테스트로 안 잡히나 | 정규 경로 통합 테스트 |
|---|---|---|---|
| 1 | `signatureBit` 정의만 되고 `uniqueMask` 에 OR 안 됨 | L1·L2·L4·L5 테스트 전부 통과. 패시브만 영구 미발동 | `tests/shipIntegration.test.ts` — `Profile{typeId:1}` → **`buildRunConfig`** → `createWorld` → `stepWorld` N틱. `hasCapstone(...SIG_BRUISER_ARMOR)===true` **그리고** 동일 seed·입력의 typeId=0 런과 관측 결과가 실제로 다름 |
| 2 | `Ship.typeId` 가 저장되나 `WorldConfig.shipType` 에 도달 못 함 | `main.ts:706·772·930` 이 **3중복 조립 사이트**라 레인이 1~2곳만 고침 | L7 이 `buildRunConfig(profile)` 단일 함수로 추출 + 3 호출부가 전부 그것을 쓰는지 grep 게이트 |
| 3 | 연구소는 `profile.skillInvest` 에 쓰고 런은 `ship.skillInvest` 를 읽음 | 양쪽 단위 테스트가 각자 벡터로 그린 | `profile.skillInvest` **삭제**(미러 금지) → tsc 가 전 독자 열거 + "투자→persist→reload→buildRunConfig 반영" 왕복 |
| 4 | 파워업 affinity 리팩터가 스트라이커 추첨 **순서**를 바꿈 | `powerupWeight` 단위 테스트는 값만 보고 순서를 안 봄 | L0 골든의 `drawPowerupChoices` 인덱스 시퀀스 배열 전체 비교(6시나리오) |
| 5 | 챔피언 선택이 그려지나 선택이 저장 안 됨 | UI 렌더 테스트는 노드 존재만 확인 | 확정 콜백 → `profile.ships` 증가 · `activeShipIndex` 이동 · **store 에 실제 write** 발생 검증 |
| 6 | 신규 타입 i18n 키 누락 → 이름이 slug/공백 | 하드코딩 목록 기반 i18n 테스트는 새 키를 모름 | `tests/i18n.test.ts` 를 **`SHIP_TYPES` 파생**으로(`tests/i18n.test.ts:28-36` 선례) |
| 7 | 신규 캡스톤 아이콘이 `SKILL_ICON_NAMES` 에 없음 → 조용히 null | 렌더가 null 을 예외 없이 삼킴 | `tests/skillIcons.test.ts` 를 **전 SHIP_TYPES 순회**로 확장 |
| 8 | **EF/Deno 가 shipType 을 모름 → 비스트라이커 침공 전량 `defense-mismatch`** | 클라 단위 테스트 전부 그린. 서버 재실행만 갈림. **라이브 서비스 파손** | `scripts/deno-verify/scenarios.ts` 에 **비스트라이커 시나리오 추가**(현재 `:36` 이 `SKILL_NODE_COUNT` 를 스트라이커 전제로 import) + `tests/denoFixture.test.ts` Node↔Deno 비트 일치. **비스트라이커 출시 전 무조건 게이트** |
| 9 | 퇴역이 신규 기체를 만들지 않음 | 기존 `tests/guardianLifecycle.test.ts` 가 **현행 동작을 고정**하고 있어 그대로 그린 | 퇴역 후 `ships.length` 증가 · 새 기체 `typeId===nextTypeId` · `level===1` · `skillInvest` 전 0 · 구 기체가 수호로 전환 |

## 11. 트레이드오프 — 스트라이커 시그니처

레인 게이트("기존 스트라이커 빌드 해시 불변")를 문자 그대로 지키면 **스트라이커는 시그니처도 스탯 보정도 가질 수 없다**. 그런데 기획서 `:111` 은 스트라이커에게 "연속 처치 시 발사 속도 스택"을 주기로 했다 — 게이트와 기획이 충돌한다.

**반론(steelman):** 이 게임은 미출시다(기획서 `:5`). 보존할 유저 리플레이가 없다. 해시 불변이 지키는 것은 **테스트 fixture 뿐**이고 fixture 는 사용자 자산이 아니라 회귀 탐지기다. 이 저장소는 이미 같은 논리로 `INVASION_HASH_VERSION=2` 를 올리고 fixture 를 전량 재생성했다(레인 문서 `:29`).

**그럼에도 채택 = A(스트라이커 바이트 불변 유지).** 이유: fixture 를 재생성하는 순간, 5종 타입 도입이라는 대규모 리팩터가 진행되는 **바로 그 기간에** 회귀 탐지기를 스스로 끄는 셈이 된다. 탐지기가 가장 필요한 시점이다. 사용자 지시("기존 스트라이커 빌드 해시 불변이 회귀 가드")와도 정합한다.

**스트라이커 시그니처는 M8.5 독립 레인으로 분리** — 리팩터가 안정된 뒤 `SHIP_HASH_VERSION` bump + fixture 재생성을 **의도적·단독으로** 수행. 리팩터와 거동 변경을 같은 마일스톤에 넣지 않는 것이 이 게이트의 존재 이유다.

| 선택지 | 장점 | 단점 |
|---|---|---|
| **A. 스트라이커 불변 (채택)** | 5종 리팩터 내내 회귀 탐지기 생존. 위험 0. L0 골든이 전 레인 안전망 | 기본 타입만 시그니처 부재 — 신규 유저 첫인상 약화. 기획서 `:111` 과 일시적 불일치 |
| B. 즉시 fixture 재생성 | 5종 전부 대칭. 기획서와 즉시 정합 | 리팩터 중 회귀 탐지기 상실. 스트라이커 파손이 조용히 통과 |

### 그 밖의 채택
- **`skillInvest` 기체 단위** (vs 타입별 Record): ADR-0019 정합, 퇴역이 세대 리셋으로 유지, 계정 성장은 계보가 담당. 타입별 Record 는 퇴역의 무게가 사라지고 직렬화가 손상에 약함
- **파워업 태그 = affinity** (vs 트리 슬롯 인덱스): 신규 타입이 자동으로 빌드 친화 가중 획득 + 스트라이커 바이트 동일. 인덱스 방식은 의미가 사라져 밸런싱 판단 근거 상실
- **신규 StatKey 금지**: 아이콘 35장 재사용 + 해시 레이아웃 불변
