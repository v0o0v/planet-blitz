# 구현 계획: 장비 요구 레벨 게이트

> 상태: **pending approval** (consensus 완료 — Architect·Critic 반영)
> 입력 스펙: [.omc/specs/deep-interview-equipment-required-level.md](../specs/deep-interview-equipment-required-level.md)
> 근거: docs/adr/0030-equipment-required-level-gate.md(본 계획으로 산식 개정) · CONTEXT.md "요구 레벨" · docs/player-power-reference.md

## Requirements Summary

장비에 **요구 레벨**을 부여해 활성 기체 레벨 미달 시 착용을 막는다. reqLevel 은 아이템에서 순수 파생 — 노말·매직·레어는 독립 상수 테이블(등급 바닥 + 어픽스 개수 × 가산), 유니크는 `UniqueDef` 개별 저작값. 게이트는 클라 **착용 액션에서만** 강제하고 로드 검사는 없다. sim·상태 해시·세이브 스키마는 불변.

> ⚠️ **프로덕션 장착 UI 는 Pixi `HangarScreen`**([src/main.ts:253](../../src/main.ts))**이다. DOM `src/ui/inventory.ts` 는 죽은 경로(인스턴스화 0건).** 모든 게이트·표시 배선은 `src/ui/pixi/hangar.ts` + `src/ui/pixi/slotGrid.ts` 에 건다. (Architect C1 / Critic C1 — 이 리포 8회 재발 "테스트 그린인데 배선 없음" 결함군, `src/run/runConfig.ts:7-15`.)

## RALPLAN-DR (short)

### Principles
1. **결정론 불변** — sim·상태 해시·기존 fixture 를 한 바이트도 바꾸지 않는다(게이트는 equip-time 메타에서만).
2. **관심사 분리** — reqLevel 은 `itemCombatPower`(수호·소멸용)와 상수를 공유하지 않는다.
3. **순수·서버 재도출** — `requiredLevel(item)`·`canEquip(shipLevel,item)` 은 RNG·시간·sim 무관 순수 함수.
4. **단일 강제 정본** — 게이트 술어를 순수 모듈 1곳에 두고 **프로덕션 장착 경로가 그것을 호출**한다(UI 인라인 조건 금지). 배선 누락은 grep 게이트로 정적 차단.
5. **목표 제시 보존** — 차단은 착용만, 툴팁·비교 프리뷰는 유지.

### Decision Drivers (top 3)
1. 초기 레벨 과강화(①) + 재성장 루프 붕괴(②) 차단 — **프로덕션에서 실측 발동**해야 달성.
2. 결정론 회귀 위험 회피(리플레이 검증·fixture 보존).
3. 밸런스 수치는 출시 전 이월 — 구조만 확정, 수치는 튜닝 가능한 상수로.

### Viable Options
- **옵션 A (채택): 신규 순수 모듈 `src/items/requiredLevel.ts`(`requiredLevel`+`canEquip`) + `UniqueDef.reqLevel` 저작 + 프로덕션 Pixi equip-time 가드 + grep/통합 게이트.**
  - Pros: 결정론 불변, combatPower 커플링 없음, 로드 검사 0, 단일 강제 정본으로 배선 누락 구조 차단.
  - Cons: 유니크 15종 reqLevel 저작 + 표시 배관(makeSlotCell 파라미터) 필요.
- **옵션 B: `combatPower.ts` 에 `requiredLevel` 추가(전투력 점수 ÷ 계수 재사용).**
  - Pros: 신규 파일 0.
  - Cons: 수호·소멸 튜닝이 요구 레벨을 흔드는 커플링(deep-interview R1 기각). `RARITY_WEIGHT{5,15,40,90}`+`AFFIX_WEIGHT 8`은 독립 테이블과 다른 상수 체계라 수치도 어긋남.
- **옵션 C: 로드 시 초과 장착분 force-unequip + 마이그레이션.**
  - Pros: "장착=항상 적격" 불변식.
  - Cons: 로드 시 장비 뺏김 놀람, 마이그레이션 표면 증가, 하네스 저레벨 테스트 불가(deep-interview R3 기각).

## Acceptance Criteria (testable)
- [ ] **AC1** `requiredLevel(item)` 순수: normal/magic/rare = 테이블(바닥 + 어픽스수×가산), unique = `UniqueDef.reqLevel`. 같은 아이템 → 항상 같은 값(단위 테스트).
- [ ] **AC2** `canEquip(shipLevel, item)` 순수 술어 = `shipLevel >= requiredLevel(item)`. **프로덕션 장착 경로**([src/ui/pixi/hangar.ts:225](../../src/ui/pixi/hangar.ts) `equip()`)가 진입부에서 이 술어를 호출해 false 면 no-op(장착 안 됨, 에러·토스트 없음).
- [ ] **AC3** grep 게이트 테스트: `hangar.ts` 의 `equip()` 가 `canEquip`(또는 `requiredLevel`)를 참조함을 정적 단언(누락 시 fail). `tests/shipIntegration.test.ts` 의 grep 게이트 양식 미러.
- [ ] **AC4** 프로덕션 경로 통합 테스트: 저레벨 프로필 + 고 reqLevel 아이템으로 `canEquip`가 false, 장착 시도가 `ship.equipped` 를 바꾸지 않음을 단언.
- [ ] **AC5** 노말 = 1(항상 착용). 결과값 clamp [1,100], 반올림.
- [ ] **AC6** `rerollAffixes`(count 보존, [roll.ts:131](../../src/items/roll.ts)) 후 req 불변.
- [ ] **AC7** 유니크 15종 전부 `reqLevel` 저작값 존재를 단언(누락 시 테스트 **loud-fail** — rare 산식 폴백 금지, 유틸 유니크 과잉 게이트 방지).
- [ ] **AC8** `makeSlotCell`([slotGrid.ts:158](../../src/ui/pixi/slotGrid.ts))에 `reqLevel?`/`locked?` 인자 추가. 인벤토리 그리드([hangar.ts:889](../../src/ui/pixi/hangar.ts))·창고([hangar.ts:787](../../src/ui/pixi/hangar.ts))에서 미달 아이템 = dim + req 빨강 + `onClick` 미배선(무동작). 장착 중 셀([hangar.ts:701](../../src/ui/pixi/hangar.ts))은 grandfather(락 없음).
- [ ] **AC9** 미달 아이템도 툴팁·비교 프리뷰([hangar.ts:374](../../src/ui/pixi/hangar.ts) compare)는 정상 노출(req 만 빨강 표기). 목표 제시.
- [ ] **AC10** 로드 시 이미 장착된 초과 아이템은 해제되지 않음(로드 검사 코드 부재로 자동 충족) + 불변식 회귀 테스트(AC12).
- [ ] **AC11** `computeLoadoutStats` 미변경 → 기존 결정론 fixture(`tests/**`, `scripts/deno-verify/fixtures.json`) green 유지.
- [ ] **AC12** 불변식 회귀 테스트: `Ship.equipped` 기체별([profile.ts:86](../../src/save/profile.ts)) + 레벨 단조([profile.ts:843](../../src/save/profile.ts) `Math.max(1,…)`) + 활성 기체 교체 경로는 퇴역([guardianLifecycle.ts:131](../../src/save/guardianLifecycle.ts))뿐(항상 Lv1 빈 기체) ⇒ 정상 경로에서 초과 장착 미발생을 단언.
- [ ] **AC13** i18n ko/en 키 추가(`item.reqLevel`, `item.levelLocked`).
- [ ] **AC14** ADR-0030 산식 문단이 최종 결정(독립 상수 테이블 + 유니크 저작)과 일치.

## Implementation Steps

1. **신규 모듈 `src/items/requiredLevel.ts`** (순수, sim·loadout·combatPower 를 값 import 안 함 — types 만):
   - `REQ_TABLE`: `{ normal:{floor:1,per:0}, magic:{floor:10,per:2}, rare:{floor:32,per:3} }` — `// TODO(밸런스): 출시 전 튜닝`.
   - `export function requiredLevel(item: Item): number`: unique 면 `UNIQUE_REGISTRY.get(item.uniqueId)?.reqLevel` **필수**(없으면 개발 시 throw/console.error 로 loud-fail; rare 폴백 금지), 아니면 `table.floor + item.affixes.length * table.per`; `clampInt(round, 1, 100)`.
   - `export function canEquip(shipLevel: number, item: Item): boolean` = `shipLevel >= requiredLevel(item)`.
   - docstring 에 "EF 가 향후 서버 검증(ADR-0028) 시 유니크 reqLevel 재도출하려면 `data/uniques.js`(side-effect 등록) import 필요" 명시.
2. **`UniqueDef.reqLevel` 추가** ([src/items/uniques.ts:17](../../src/items/uniques.ts)): `readonly reqLevel: number`(필수 — 누락 컴파일 차단). `data/uniques.ts` 15종 저작 — 전투형(관통 자이로·과열 드럼·분열 코어·쌍둥이 항성·군집 벌통·수렴 프리즘·반응 장갑·위상 전환막·특이점 발생기 등) ~65-75, 유틸형(유물 증폭기·도박사의 칩·탐욕의 심장·위상 장갑·잔상 추진기·자율 드론 베이) ~15-30. `// TODO(밸런스)`.
3. **프로덕션 equip 가드** ([src/ui/pixi/hangar.ts:225](../../src/ui/pixi/hangar.ts) `equip()`): 진입부에 `if (!canEquip(activeShip(this.profile).level, item)) return;`. `activeShip` 는 이미 import([hangar.ts:24](../../src/ui/pixi/hangar.ts)); `requiredLevel`/`canEquip` import 추가.
4. **표시 배관** — `makeSlotCell`([slotGrid.ts:158](../../src/ui/pixi/slotGrid.ts))에 `reqLevel?`/`locked?` 파라미터 + dim/빨강/툴팁 렌더 추가. `hangar.ts` 호출부 배선: 인벤토리(889)·창고(787)는 `const locked = !canEquip(ship.level, item)` 전달, locked 면 `onClick` 미배선; 장착 중(701)은 locked=false. `card.ts`·`championSelect.ts`·`modulesView.ts`·`refinery.ts`·`resultOverlay.ts` 는 **대상 아님**(championSelect=기체 교체·표시전용, modulesView=코어 모듈 전용 제외, refinery/resultOverlay=비장착 표시).
5. **i18n** ([src/i18n/catalog.ts](../../src/i18n/catalog.ts)): `item.reqLevel`("요구 레벨 Lv{n}" / "Req. Lv{n}"), `item.levelLocked`("기체 Lv{n} 필요" / "Requires ship Lv{n}").
6. **하네스 프리셋** ([src/harness/presets.ts](../../src/harness/presets.ts) `buildPreset`): `'gearLocked'` 추가 — 저레벨 기체(예: Lv10) + `profile.inventory` 에 고 reqLevel rare/unique 다수(비장착). 검증 3단계·AC4 통합 테스트의 실행 기반.
7. **ADR-0030 개정** (docs/adr/0030-…): 산식 문단(itemCombatPower ÷ 계수)을 **독립 상수 테이블 + 유니크 저작**으로 supersede, Considered Options 에 독립 테이블 채택 반영, "src/ui/inventory.ts 게이트 없음" 서술을 "Pixi hangar.ts equip-time 게이트"로 정정. (AC14)
8. **테스트** `tests/requiredLevel.test.ts`: AC1·5·6·7(등급 경계·어픽스 스케일·clamp·리롤 불변·유니크 저작 loud-fail) + AC3 grep 게이트 + AC4 프로덕션 경로 통합 + AC12 불변식 회귀. 결정론 fixture 회귀 없음 재확인(`pnpm test`).

## Risks and Mitigations
- **R1 결정론 회귀** — reqLevel 이 sim/loadout 경로 유입. → 완화: 모듈이 sim/loadout/combatPower 를 값 import 안 함; 게이트는 UI equip 액션에만; `pnpm test` 로 기존 fixture green 확인(AC11).
- **R2 유니크 저작 누락/오게이트** — reqLevel 미저작 유니크가 잘못된 레벨로 열림. → 완화: `reqLevel` **필수 필드**(컴파일 차단) + AC7 loud-fail 테스트. rare 폴백 제거(유틸 유니크 과잉 게이트 방지).
- **R3 표시 표면 누락** — 미달 아이템이 회색만 뜨고 req/이유 불명. → 완화: 표시를 `makeSlotCell` 단일 함수로 중앙화(AC8), 대상 호출부(인벤토리·창고) 명시.
- **R4 밸런스 수치 방치** — placeholder 가 출시까지 남음. → 완화: 상수 `TODO(밸런스)` + defer-balance-tuning 큐 등재.
- **R5 (신규·치명) 게이트 오배선으로 프로덕션 미발동** — 가드가 죽은 DOM 경로에 붙어 하드 게이트가 우회됨(이 리포 시그니처 결함). → 완화: 가드를 프로덕션 `hangar.ts:225`에 배선 + **AC3 grep 게이트**(hangar.equip 이 canEquip 참조 단언) + **AC4 프로덕션 경로 통합 테스트**. 순수 모듈 테스트만으로는 못 잡으므로 필수.

## Verification Steps
1. `pnpm test` — 신규 `requiredLevel.test.ts`(AC1·3·4·5·6·7·12) green + 기존 결정론/loadout fixture 회귀 없음(AC11).
2. `pnpm lint` + `pnpm build` 통과.
3. 하네스 `'gearLocked'` 프리셋 → 인벤토리·창고 셀 dim·req 빨강·툴팁 확인, 미달 아이템 클릭 무동작; 프리셋 레벨 상향(또는 저-req 장비)으로 착용 가능 확인.
4. 착용 상태에서 미달 아이템 비교 프리뷰가 정상 노출(req 빨강)되는지 확인.
5. grep 확인: `HangarScreen.equip` 가 `canEquip` 참조(AC3 자동화의 수동 재확인).

## ADR

**Decision:** 장비 요구 레벨(reqLevel)을 아이템에서 순수 파생하되 **`itemCombatPower` 와 분리된 독립 상수 테이블**(노말/매직/레어 = 등급 바닥 + 어픽스×가산) + **유니크 개별 저작 reqLevel** 로 산출하고, 게이트는 **프로덕션 Pixi 장착 경로(`hangar.ts` equip)** 의 착용 시점에서 순수 술어 `canEquip` 로만 강제한다. 로드 검사·서버 검증은 하지 않는다.

**Drivers:** ①초기 과강화·②재성장 붕괴 차단(프로덕션 실발동 필수) · 결정론/세이브 스키마 불변 · combatPower 커플링 회피 · 밸런스 수치 이월.

**Alternatives considered:**
- itemCombatPower ÷ 계수 재사용 — 수호·소멸과 상수 커플링(기각, deep-interview R1).
- 유니크도 어픽스 산식 통일 — 유틸 유니크 과잉/전투 유니크 과소 게이트(기각).
- 로드 시 force-unequip + 마이그레이션 — 장비 뺏김 놀람·표면 증가(기각, R3).
- 소프트 효율 스케일 — 상태 해시 변동·툴팁 불일치(기각, grill).
- 지금 서버 검증 — PvE 3중 캡·PvP ADR-0028 이월로 불요(기각).

**Why chosen:** 독립 테이블은 스키마 불변·서버 재도출·stale 없음을 모두 만족하고 커플링을 끊는다. 유니크 저작은 유틸-유니크 역설을 해소한다. 프로덕션 경로 단일 술어 강제 + grep 게이트는 이 리포의 배선 누락 결함군을 구조적으로 차단한다.

**Consequences:** 신규 세대는 노말·매직으로 시작해 레벨을 올리며 레어·유니크를 순차 해금. 게이트는 클라 신뢰 기반(서버 불가시) — 진짜 무결성은 PvE 3중 캡·PvP ADR-0028 랜딩까지 유예(하드 UX 약속과 서버 미강제의 간극을 명시). 수호 기체·예비역 소집은 동결 빌드라 무영향.

**Follow-ups:** ADR-0028 랜딩 시 verify-invasion 에 로드아웃 reqLevel 재도출 검증 편입 · 밸런스 패스에서 테이블 상수·유니크 reqLevel 튜닝 · 향후 자유 기체 선택 UI 도입 시 "레벨 단조·재활성 경로 없음" 불변식 재검토.

## Changelog (consensus 반영)
- **C1(Architect·Critic):** equip 가드를 죽은 `inventory.ts` → 프로덕션 `hangar.ts:225` 로 재지정. `canEquip` 순수 술어 추출.
- **M1/R5:** grep 게이트(AC3) + 프로덕션 경로 통합 테스트(AC4) 추가 — 오배선을 검증이 잡도록.
- **M2:** ADR-0030 개정을 명시 단계(7)·AC14 로 추가(산식 모순 해소).
- **M3:** 유니크 rare 폴백 제거 → `reqLevel` 필수 필드 + AC7 loud-fail.
- **M4:** 표시 대상 `card.ts` → `slotGrid.ts makeSlotCell` 정정, `reqLevel?/locked?` 배관 명세, championSelect/modulesView/refinery/resultOverlay 제외 명시.
- **M5:** 하네스 `'gearLocked'` 프리셋 생성 단계(6) 추가.
- **불변식:** AC12 회귀 테스트로 "로드 검사 없음" 전제 명문화.
- **Minor:** "드래그" 문구 제거(Pixi hangar=클릭만), "96칸 창고"→가변(`stashCapacity`).
