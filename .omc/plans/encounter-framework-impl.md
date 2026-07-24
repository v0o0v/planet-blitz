# 구현 계획: 조우 프레임워크 + 중반 격전

- **상태: pending approval** (컨센서스 1회전 REJECT→정제 완료, Architect+Critic 발견 전부 반영)
- 입력 명세: [.omc/specs/deep-interview-encounter-framework.md](../specs/deep-interview-encounter-framework.md)
- 설계 근거: ADR-0031·ADR-0032·CONTEXT.md glossary
- 모드: RALPLAN-DR **deliberate**(고위험 — 해시 계약 변경 + 라이브 EF 재배포)
- ⚠️ 자동 실행 금지: 실행은 별도 명시 승인 필요(팀/ralph/autopilot 자동 호출 안 함).

## Requirements Summary
조우(런 중 opt-in 희귀 이벤트 프레임워크, 에코 일반화)와 중반 격전(매 런 확정 par 연장 비트)을 기존 결정론 sim·해시·정산 위에 얹는다. **프레임워크 코어·보상·인라인 조우는 검증된 에코 선례 재사용**이지만, **보물 격실 detour는 신규 제어흐름(freeze-warp-restore 서브씬)임을 명시적으로 인정**하고 단일 분기로 격리한다. 수직 슬라이스(프레임워크 코어 + 보물 격실) 먼저 end-to-end 검증.

## RALPLAN-DR 요약

### Principles (정제됨)
1. **결정론 불변식 우선** — 보상 주는 상태는 전부 sim·시드·해시. 조우-absent 런은 바이트 불변(조건부 폴드, echo 선례).
2. **재사용 우선 — 단, 신규 흐름은 정직하게 격리.** 입력(special 비트)·보상(spawnLoot/LootRecord/resources/catalystMods.drop)·인라인 조우는 재사용. **detour는 진짜 신규 제어흐름**이므로 "재사용"으로 위장하지 않고 stepWorld 최상단 단일 분기(레벨업 프리즈 선례)로 격리한다.
3. **수직 슬라이스로 리스크 선차단** — 프레임워크 미검증 상태 다중 배선 금지.
4. **해시 컷오버 안전** — PvE baseline 변경(중반 격전)은 골든 재생성 + verify-pve-sample 재배포; **invasion baseline은 불변임을 회귀 테스트로 단언**.
5. **밸런스/모드변형 분리 — 단 공간 충돌은 구조 문제.** 수치·6모드 변형은 다운스트림. 그러나 워프 detour의 모드별 공간 충돌은 구조라, v1은 뱀서류(비-스크롤/비-수축/비-추격) 모드로 게이트한다.

### Decision Drivers (top 3)
1. 라이브 게임 해시 계약을 조우-absent·invasion에서 바이트 불변으로 유지.
2. 서버(EF) 재검증 가능성 — 시드+입력 재실행 재현.
3. 첫 구현 재작업 최소화(수직 슬라이스 + detour 단일 분기).

### Viable Options
- **옵션 A (채택): 에코 패턴 확장(코어·보상·인라인 재사용) + detour 단일 분기 격리 + 수직 슬라이스.**
  - 장점: 코어는 검증된 선례 재사용, detour는 레벨업 프리즈 선례로 7충돌 일괄 흡수, 결정론 유지.
  - 단점: detour가 신규 서브 파이프라인임을 인정(Principle 2 정직화). stepDetour 테스트 표면 신설.
- **옵션 B: 조우 전용 씬/보상 파이프라인 신설** — 해시·정산·검증 표면 대폭 확대 → **기각**(Principle 1·2).
- **옵션 C: 4종 병렬 동시 구현** — 프레임워크 미검증 상태 4곳 배선, 재작업 위험 → **기각**(Principle 3).
- **하이브리드(옵션 A 내부 채택): "코어=재사용, detour=격리된 단일 분기"** — 이것이 실질 채택안. B의 "관심사 분리" 장점을 detour에만 국소 적용해 리스크를 낮춘다.

## Acceptance Criteria (정제됨 — Critic 조건 반영)
- [ ] **AC1 조우-absent 불변**: `fork('encounter')` 도입 후 조우 미발생 PvE 런의 per-tick 해시가 도입 전과 **바이트 diff 0**(vitest 골든).
- [ ] **AC2 invasion 불변(MAJ-2)**: 중반 격전 세그먼트 삽입 후 invasion per-tick 해시가 삽입 전과 **바이트 diff 0**. 회귀 테스트로 `SEGMENTS[0]`과 보스 슬롯(`boss:true`) 불변을 단언. (invasion은 `updateWaves` 미실행이므로 baseline 불변 — verify-invasion 재배포는 무해 검증일 뿐 "강제" 아님.)
- [ ] **AC3 PvE baseline 변경 흡수**: 중반 격전은 매 런 등장이라 PvE 비-invasion baseline 해시가 바뀐다 → 골든 재생성 + CHANGELOG 문서화 + verify-pve-sample 재배포.
- [ ] **AC4 결정론 재현**: 조우 발생 + 중반 격전 런이 시드+입력 재실행으로 바이트 재현(vitest + verify-pve-sample 부팅 스모크).
- [ ] **AC5 opt-in**: `SPECIAL_ENCOUNTER_*`(비트 3+) 진입/거부 동작, 거부/무시 런이 조우 미발생 런과 동일 결과.
- [ ] **AC6 detour 메인 월드 동결(MAJ-4)**: detour 중 **메인 월드 상태가 `tick` 외 바이트 불변**(적 좌표·웨이브 진행·보스·탄 전부 동결). 이는 stepDetour 단일 분기의 직접 검증이다. ("무피격" 같은 약한 판정 금지.)
- [ ] **AC7 전투력 불개입(CRIT-2)**: 방내(detour) 적 처치는 **런 전투력 경로에 무개입** — `state.kills++` 불변, gem 미드랍, xp/combo/level 불변, 해츨링 `aux0` 카운터 불변. 방내 보상은 loot(rarity 강제 LootRecord)·크레딧 등 **정산 경제로만**.
- [ ] **AC8 detour 사망/이탈**: 방내 사망=런 실패(전리품 보존), 타이머 만료 자동 이젝트, 조기 이탈 복귀 시 원좌표 복원.
- [ ] **AC9 중반 격전 게이트(MAJ-3)**: 진행 게이트=리더 처치를 **마커 엔티티 생존 스캔으로 파생**(신규 WaveRuntime 폴드 필드 0). 창발 보존.
- [ ] **AC10**: 전 vitest 그린 + EF 재배포 부팅 스모크.

## Implementation Steps

### Phase A — 수직 슬라이스: 프레임워크 코어 + 보물 격실

1. **입력 확장** [src/sim/world.ts:289](../../src/sim/world.ts): `SPECIAL_ENCOUNTER_ENTER`/`_DECLINE`/`_ALTAR_PICK` 비트를 **비트 3+**에 배치(powerup 비트 0-2와 무충돌) + `packEncounterAltar(index)` 헬퍼(`packPowerupPick` L293 선례). append-only.
2. **조우 데이터** `data/encounters.ts`(신규): 유형 카탈로그(id·bucket·weight·spawn 파라미터), 가중치 placeholder(밸런스).
3. **조우 런타임/롤** `src/sim/encounter.ts`(신규, [echo.ts:72](../../src/sim/echo.ts) 선례): `EncounterRuntime`(state·type·spawnTick·entityId·**inDetour·savedX·savedY·detourTimer·detourEndTick**), `rollEncounter(worldRng)`(`fork('encounter')` 순차 롤: 등장→유형 가중→틱), `stepEncounter`. **v1 detour 모드 게이트(Principle 5·R2)**: 워프 detour(보물 격실)는 `scrollRuntime`·`shrinkRuntime` 미존재 + chase/contamination 아닌 모드(뱀서류)에서만 롤/발동. 인라인·오버레이 조우는 전 PvE 모드 허용.
4. **엔티티** [src/sim/entities.ts:440](../../src/sim/entities.ts): `spawnEncounterPortal`·세트피스 로트/수호자 스폰(spawnEcho/spawnLoot 선례), 신규 EntityKind(KIND_CODE append-only, replay.ts:136).
5. **해시 폴드** [src/sim/replay.ts:494](../../src/sim/replay.ts) `hashWorld`: `encounterRuntime` 존재 시에만 조건부 꼬리 폴드(echoRuntime 선례). 정수 필드만.
6. **world 배선** [world.ts:900](../../src/sim/world.ts) createWorld: `if (cfg.invasion3 === undefined && 뱀서류게이트) encounterRuntime = rollEncounter(worldRng)`.
7. **detour 단일 분기(CRIT-1·R1)** [world.ts:1022](../../src/sim/world.ts) 레벨업 프리즈 선례와 동형으로 `stepWorld` 최상단에:
   ```
   if (state.pendingLevelUp) { ...기존... return; }   // 레벨업 우선(Minor: 프리즈 상호작용)
   if (state.encounterRuntime?.inDetour) { stepDetour(state, input); state.tick++; return; }
   ```
   `stepDetour`는 자체 최소 파이프라인만 소유(stepPlayer + 세트피스 적만 + stepProjectiles + resolveCollisions + compact + 타이머/이탈/복귀 판정). 이로써 updateWaves·메인 stepEnemies·clampToWindow·shrinkOutOfBounds·advanceScroll/Shrink·stepBoss(hover)·applySingularityPull·updateChasePredator·autoAttack가 **전부 자연 생략**된다. 메인 엔티티는 `state.entities`에 프리즈된 채 남아 hashWorld가 계속 접으므로 결정론·AC6 동시 충족.
8. **detour 보상·처치 격리(CRIT-2)**: `stepDetour`의 세트피스 처치는 **전용 경로** — `spawnLoot`(rarity 강제)만 남기고 `state.kills++`·gem 스폰·xp/combo 경로를 타지 않는다. 방내 크레딧/파편은 `state.resources`/파편 플래그(정산 경제). → AC7.
9. **검증**: vitest(AC1·AC4·AC5·AC6·AC7·AC8), verify-pve-sample EF 소스 갱신.

### Phase B — 경량 조우 4종 (수직 슬라이스 통과 후)
10. 오스카 제단(3택 `SPECIAL_ENCOUNTER_ALTAR_PICK` 입력 + `catalystMods.drop` 부스트) · 봉인 수호자(`summonEnemy` 라이브 오버레이 — 이건 detour 아님, 메인 런 위 오버레이) · 기록 파편우(인라인 파편 스폰) · 유령 보급선단(convoy, spawnSupply 선례). **인라인/오버레이라 detour 단일 분기 불필요, echo처럼 전 PvE 모드 무해.** 각 유형별 단위 테스트.

### Phase C — 중반 격전
11. [data/waves.ts:181](../../data/waves.ts) SEGMENTS **중반(index≥1, SEGMENTS[0]·보스 슬롯 불변)** 전용 격전 세그먼트 삽입 + [waves.ts:161](../../src/sim/waves.ts) `updateWaves` cleared 분기에 **리더 처치 게이트(마커 엔티티 생존 스캔 파생, MAJ-3)** 추가. 서지=특별 카드, 리더=`summonEnemy`(waves.ts:293, RNG 미소비) + 마커. **신규 WaveRuntime 폴드 필드 금지.** PvE baseline 변경 → 골든 재생성.

### Phase D — 통합 검증·배포
12. 전 vitest 그린 → PvE 골든 재생성 + **invasion 골든 바이트 diff 0 회귀 단언(AC2)** → verify-pve-sample 재배포(spb 래퍼·detached 클린 워크트리 번들·배포 후 번들 커밋=origin/main 최신 대조) → 하네스 플레이테스트 1회(오염 런).

## Risks and Mitigations (정제됨 — MAJ-1 반영)
| Risk | Mitigation |
|---|---|
| 해시 계약 변경으로 기존 골든/리플레이 무효 | 조우=조건부 폴드(absent 불변 AC1); 중반격전 PvE baseline은 골든 재생성+CHANGELOG(AC3); invasion baseline 불변 단언(AC2); 리플레이 TTL 48h 컷오버 창(ADR-0029 선례) |
| **적 재추적 이주(MAJ-1)** — 워프 시 전 적이 detour로 몰려옴(적은 탄과 달리 컬링 안 됨, patterns/index.ts:51-68) | stepDetour 단일 분기가 메인 stepEnemies를 생략 → 메인 적 프리즈(AC6). 자연 컬링에 의존하지 않음 |
| **모드별 좌표계 워프 붕괴(MAJ-1)** — clampToWindow/shrinkOutOfBounds/chase가 워프 되돌림 | v1 워프 detour를 뱀서류로 게이트(R2, step 3) + 단일 분기가 해당 스텝 생략. scroll/shrink/chase 변형은 다운스트림 |
| **방내 xp 누수(CRIT-2)** — gem→xp→레벨업 전투력 상승 | stepDetour 전용 처치 경로: gem 미드랍·kills++ 억제·xp/combo 불변(AC7) |
| detour in-flight 탄 잔존 | 워프 거리 > PROJECTILE_CULL_RADIUS라 메인 탄 자연 소멸(탄 한정 성립, world.ts:275); 적은 프리즈로 처리 |
| 3중 캡이 조우 잭팟 오탐 | 개연성 캡에 조우 완료 플래그 반영, 런당 상한 재조정(밸런스). ⚠️ **`src/sim/settlement.ts` 이 워크트리에 부재 — 캡 로직 위치 구현 시 재확인**(Critic Open) |
| EF 재배포 절차(토큰·번들 소스) | spb 래퍼(DPAPI), detached 클린 워크트리 번들, 배포 후 origin/main 대조(메모리 교훈) |

## Verification Steps
1. `pnpm test` 전체 그린 — 신규 해시 골든·결정론·detour 동결·처치 격리·리더 게이트·invasion 불변 테스트.
2. AC1(조우-absent diff 0)·AC2(invasion diff 0)·AC6(detour 중 메인 월드 동결) 골든/불변 단언.
3. verify-pve-sample/verify-invasion EF 부팅 스모크.
4. 하네스 조우 강제 시드 → 보물 격실 진입/이탈/사망 경로 육안(오염 런).

## (deliberate) Pre-mortem — 실패 시나리오 (정제됨)
1. **조우 미발생 해시가 바이트 불변 아님** — fork 위치가 다른 스트림 전진. → fork 부모 미전진(echo 선례) + AC1 골든 diff 0을 CI 게이트.
2. **detour 중 메인 시뮬 전진(적/보스/특이점/무기/모드좌표계가 계속 돎)** — 열거식 게이트 누락. → **stepDetour 최상단 단일 분기(CRIT-1 fix)**로 원천 차단 + AC6(메인 월드 tick 외 바이트 동결) 단언. 열거에 의존하지 않음.
3. **방내 처치가 xp/레벨업으로 새 전투력 상승(CRIT-2)** — "불산입"을 세그먼트 게이트만으로 해석. → stepDetour 전용 처치 경로(gem 미드랍·kills 불변) + AC7 통합 테스트("detour 전후 xp/level/combo 불변").
4. **EF 재배포 번들이 구 소스** — 배포 시점 origin/main 뒤처짐(1회차 무효 선례). → 번들 소스 커밋 기록 + 배포 직후 origin/main 대조 절차 강제.

## (deliberate) Expanded Test Plan
- **Unit**: rollEncounter 시드 결정론, packEncounter 비트(≥3), stepDetour 워프/복귀/타이머, detour 전용 처치(gem 미드랍·kills 불변), rarity 강제 LootRecord, 리더 마커 스캔 게이트.
- **Integration**: 조우 발생 런 정산 3중 캡, detour 사망=런실패+전리품 보존, **detour 전후 xp/level/combo 바이트 불변(AC7)**, **detour 중 메인 엔티티 좌표 바이트 동결(AC6)**, 중반격전 par 연장.
- **E2E(하네스/verify)**: verify-pve-sample 재실행 바이트 재현, **invasion 골든 바이트 diff 0(AC2)**, 하네스 조우 강제 플레이.
- **Observability**: 조우 완료/사망/이탈 카운터(비-해시 관측, hitsTaken 선례), EF 부팅 스모크 로그.

## ADR
- **Decision**: 조우를 에코 조건부-폴드 패턴으로 일반화하고 보상·입력·진행을 전면 재사용하되, **보물 격실 detour만 신규 제어흐름으로 인정해 stepWorld 최상단 단일 분기(레벨업 프리즈 동형)로 격리**한다. v1 워프 detour는 뱀서류 모드 한정. 중반 격전은 SEGMENTS 중반 삽입 + 리더 마커 스캔 게이트(신규 폴드 0).
- **Drivers**: 조우-absent·invasion 해시 바이트 불변 / 서버 재검증 유지 / 재작업 최소.
- **Alternatives considered**: (B) 조우 전용 씬·보상 파이프라인 — 해시·검증 표면 확대로 기각. (C) 4종 병렬 — 미검증 배선 재작업 위험으로 기각. (A-원안) 산발 inDetour 게이트 — 7충돌 과소열거로 컨센서스 REJECT, 단일 분기로 정정.
- **Why chosen**: 코어는 검증된 재사용으로 저위험을 확보하고, 유일한 신규 흐름(detour)을 단일 분기로 격리해 7개 충돌점·xp 누수·모드 좌표계 붕괴를 구조적으로 차단.
- **Consequences**: stepDetour 신규 서브 파이프라인·테스트 표면; PvE baseline 골든 재생성 + verify-pve-sample 재배포; invasion baseline 불변(회귀 단언); v1 detour는 뱀서류 한정(모드 변형 다운스트림).
- **Follow-ups**: scroll/shrink/chase/contamination detour 변형(모드별); 밸런스 수치(등장률·타이머·등급·par·가중치·3중 캡 계수); settlement 캡 로직 위치 확인.

## Changelog — 컨센서스 반영 (Architect + Critic REJECT → 정제)
- **CRIT-1(게이트 과소열거)** → step 7 detour를 stepWorld 최상단 단일 분기로 전환(레벨업 프리즈 선례), pre-mortem #2 재작성, AC6 신설.
- **CRIT-2(xp 누수)** → step 8 detour 전용 처치 경로(gem 미드랍·kills 불변), AC7 신설, pre-mortem #3 신설, 리스크 표 추가.
- **MAJ-1(리스크 누락)** → 리스크 표에 적 재추적 이주·모드 좌표계 붕괴·xp 누수 3건 추가.
- **MAJ-2(invasion 불변 미단언)** → AC2 신설, verify-invasion "강제"→"불변 검증"으로 재분류, step 12 회귀 단언.
- **MAJ-3(리더 게이트 신규 폴드 위험)** → step 11·AC9를 마커 엔티티 스캔 파생으로 명세, 신규 WaveRuntime 필드 금지.
- **MAJ-4(무피격 AC 약함)** → AC6를 "메인 월드 tick 외 바이트 동결"로 강화.
- **Minor** → 레벨업>detour 프리즈 우선순위(step 7), special 비트 ≥3(step 1), 옵션 하이브리드 명시, settlement.ts 부재 caveat(리스크 표·ADR follow-up).
- **범위 정정** → 조우-absent·invasion 불변 vs 중반격전 PvE baseline 변경을 AC1/AC2/AC3로 분리 명세.

> 주: 컨센서스 1회전(Architect→Critic)에서 REJECT를 받아 위 5개 업그레이드 조건을 전부 반영했다. 재리뷰 패스는 pending-approval(사람 게이트) 앞에서 비용 대비 가치가 낮아 생략했고, 각 조건→수정 매핑을 위 Changelog로 명시해 검증 가능하게 남긴다.
