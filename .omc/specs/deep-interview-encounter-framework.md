# Deep Interview Spec: 조우 프레임워크 + 중반 격전 구현 명세

## Metadata
- Interview ID: di-encounter-2026-07-24
- Rounds: 6
- Final Ambiguity Score: 13.2%
- Type: brownfield
- Generated: 2026-07-24
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- 선행 산출물: [CONTEXT.md](../../CONTEXT.md) glossary · [ADR-0031](../../docs/adr/0031-encounter-framework-generalizes-echo.md) · [ADR-0032](../../docs/adr/0032-mid-run-clash-extends-par.md) (PR #129, main 머지)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.87 | 0.25 | 0.218 |
| Success Criteria | 0.82 | 0.25 | 0.205 |
| Context Clarity | 0.87 | 0.15 | 0.131 |
| **Total Clarity** | | | **0.868** |
| **Ambiguity** | | | **0.132** |

## Topology
Round 0에서 4개 top-level 컴포넌트를 확정(전부 active, deferral 없음).

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 프레임워크 코어 | active | `encounterRuntime`·시드 롤·조건부 해시 폴드·opt-in 입력·유형 선택·정산 연동 | R1(입력)·R2(롤)·R4(보상) 확정 |
| 보물 격실 | active | 플래그십 detour: 정지·워프·위험 구배·타이머+조기이탈·복귀 | R3(공간 모델)·R4(보상) 확정. **수직 슬라이스 우선 구현 대상** |
| 경량 조우 4종 | active | 오스카 제단·봉인 수호자·기록 파편우·유령 보급선단 | 프레임워크+보상 재사용으로 구조 확정, 검증된 기계의 반복 |
| 중반 격전 | active | 매 런 확정 하이브리드 비트(정예 서지+강화 리더) | R5(전용 격전 세그먼트) 확정 |

## Goal
행성 격침(PvE 침략 런)에 **조우**(런 중 opt-in 희귀 이벤트 프레임워크, 에코 신호 일반화)와 **중반 격전**(매 런 확정 par 연장 비트)을 **기존 결정론 sim·해시·정산 파이프라인 위에 최소 신규 배선으로** 얹는다. 4개 컴포넌트 전부를 명세하되, 첫 구현은 **프레임워크 코어 + 보물 격실 수직 슬라이스**를 입력→롤→정지→워프→보상→정산→해시 골든→EF까지 끝까지 검증한다.

## Constraints
- **결정론(ADR-0005)**: 보상을 주는 모든 상태는 sim 안·시드 파생·해시 폴드. 서버(EF)가 시드+입력 재실행으로 재검증.
- **RNG 스트림 분리**: 조우 롤은 `worldRng.fork('encounter')` 단일 스트림에서만(부모 미전진). `'encounter'` 라벨은 리플레이/해시 계약 — 변경 금지.
- **조건부 해시 폴드**: `encounterRuntime`은 positive(조우 발생) 런에만 존재 → append-only 꼬리 폴드로 조우 미발생 런은 per-tick 해시 바이트 불변(echo/shrink/scroll 선례). **단 중반 격전은 매 런 등장이라 PvE 베이스라인 해시를 바꾼다 → 골든 재생성 + EF 재배포 불가피.**
- **입력 스키마 append-only**: opt-in 상호작용은 기존 `InputFrame.special` 비트필드 확장(신규 필드 추가 아님).
- **보상 = 경제·수집만**: 현재 런 전투력 불개입(파워업 모델·아이템 베제 0 유지). 밸런스 보류 방침 무충돌.
- **PvE 전용**: 조우·중반 격전은 침공(PvP)에 붙지 않는다(`config.invasion3 === undefined` 게이트, 에코 선례).
- **신규 보상 시스템 0**: 모든 보상은 기존 엔티티/필드 재사용(§Technical Context).
- **밸런스·모드별 변형은 범위 밖**: 수치(등장률·타이머·등급·par 목표·유형 가중치)와 6개 모드별 변형은 다운스트림.

## Non-Goals
- 밸런스 수치 튜닝(출시 전 일괄 패스).
- 6개 행성 모드별 조우/중반 격전 변형(뱀서류 첫 레퍼런스 후 다운스트림).
- 반전·미스터리형 조우(미믹·차원 균열 — 1차 카탈로그 제외).
- 침공(PvP)으로의 확장.
- 새 런-파워 보상 축.

## Acceptance Criteria
- [ ] **결정론/해시**: 조우 발생 런 + 중반 격전 런이 시드+입력 재실행으로 바이트 재현(vitest 해시 골든 + `verify-pve-sample` EF).
- [ ] **조우 미발생 불변**: 조우 롤이 `fork`라, 조우-absent 경로의 per-tick 해시가 프레임워크 도입 전과 바이트 동일(중반 격전 baseline 변경분은 골든 재생성으로 흡수·문서화).
- [ ] **opt-in 입력**: 진입/거부가 `special` 비트로 동작, 거부/무시 시 안전하게 런 지속.
- [ ] **보물 격실**: 포탈 진입 → 메인 런 정지(`inDetour`) → 먼 시드 포켓 워프 → 위험 구배 세트피스 → 타이머 안 수집 + 조기 이탈(가진 것 보존) → 복귀 시 원좌표 복원. 방내 사망 = 런 실패. 방내 처치는 메인 처치 할당 불산입.
- [ ] **보상 재현**: loot 다량·확정 고희귀(rarity 강제 `LootRecord`)·젬·크레딧·기록 파편·제단 부스트가 정산 요약에 반영되고 **3중 캡** 안에 유계(캡 계수는 밸런스 재조정 대상).
- [ ] **중반 격전**: SEGMENTS 중반 전용 격전 세그먼트가 매 런 등장, 진행 게이트=리더 처치, 창발 보존(강하면 빨리 넘김), par 웨이브 ~+30초.
- [ ] **수직 슬라이스 게이트**: 프레임워크 코어 + 보물 격실이 위 기준 전부 통과해야 나머지 3종+중반 격전 구현 착수.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| opt-in 진입에 새 입력 필드가 필요하다 | R1: 레벨업 3택이 이미 `special` 비트로 해소됨 | `special` 비트 확장(진입·개방·제단 인덱스 상위 비트 패킹, `packPowerupPick` 동형) |
| 조우 롤에 복잡한 다중 스트림이 필요하다 | R2: 에코가 단일 fork로 등장+틱을 뽑음 | `worldRng.fork('encounter')` 단일 순차 롤(등장→유형(가중)→틱), positive-only runtime |
| detour는 별도 씬/서브월드가 필요하다 | R3: 월드가 무한 좌표, 먼 엔티티는 자연 컬링 | 같은 월드 좌표 워프(savedX/Y·`inDetour` 게이트·시드 세트피스·복귀 복원) |
| 조우는 새 보상 배선을 요구한다 | R4(Contrarian): 보상이 전부 기존 엔티티 스폰이면? | 전부 기존 재사용(spawnLoot·rarity 강제 LootRecord·resources·파편 플래그·catalystMods.drop). 신규 시스템 0 |
| 중반 격전은 별도 상태 기계가 필요하다 | R5: 보스 세그먼트가 victory 게이트로 끝남 | 전용 격전 세그먼트(진행 게이트=리더 처치, 서지=특별 카드, 리더=summonEnemy) |
| 4종을 동시에 구현해야 빠르다 | R6(Simplifier): 프레임워크 미검증 상태 배선은 재작업 위험 | 수직 슬라이스 우선(프레임워크+보물 격실 end-to-end 검증 후 반복) |

## Technical Context
Brownfield 배선 지점(전부 기존 재사용):
- **입력**: `InputFrame.special`(비트필드) + `SPECIAL_POWERUP_PICK`/`packPowerupPick` 선례 → 신규 `SPECIAL_ENCOUNTER_*` 비트 append.
- **롤/런타임**: `echo.ts` `rollEcho`(`worldRng.fork`) → `encounterRuntime`(state 0/1/2 + type + spawnTick + entityId + detour 필드). `world.ts createWorld`의 `if (cfg.invasion3 === undefined) echoRuntime = rollEcho(...)` 지점 옆에 `rollEncounter`.
- **해시**: `hashWorld`의 조건부 꼬리 폴드(echoRuntime/shrinkRuntime/scrollRuntime 선례) → `encounterRuntime` 존재 시에만 폴드.
- **보상**: `spawnLoot` + `LootRecord{seed,rarity,planet,stage}`(rarity 강제) · `state.resources`(크레딧) · 기록 파편 플래그(에코 `echoStabilizedOf` 선례) · `catalystMods.drop`(제단 부스트 배율).
- **정산**: 기존 정산 요약 + **3중 캡**(지표 개연성·런당·시간당) 계수 재조정(ADR-0031 consequence).
- **중반 격전**: `data/waves.ts` `SEGMENTS`에 전용 격전 세그먼트 삽입 + `src/sim/waves.ts` `updateWaves`의 `cleared` 분기에 리더-처치 게이트 추가. 서지=특별 카드, 리더=`summonEnemy`(RNG 미소비 소환 선례).
- **검증**: vitest 해시 골든 재생성 + `verify-pve-sample`/`verify-invasion` EF 재배포(마이그레이션 절차, 이 프로젝트 반복 패턴).

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| EncounterRuntime | core domain | state, type, spawnTick, entityId, inDetour, savedX, savedY, timer | positive 런에만 존재, hashWorld에 조건부 폴드, Portal/Altar/Guardian 스폰 |
| Encounter (조우) | core domain | bucket(탐욕/도박/전투), reward class | opt-in, 시드 파생, EncounterRuntime이 관리 |
| TreasureVault (보물 격실) | core domain | 위험 구배(안전/위험 지대), 타이머, deep prize | Portal로 진입, 좌표 워프, LootRecord 스폰 |
| OscarAltar (오스카 제단) | core domain | 3택(a 즉시/b 부스트/c 봉인상자[바닥보장]) | special 비트 선택 입력, catalystMods.drop 배율 |
| SealedGuardian (봉인 수호자) | core domain | 강화 정예, 라이브 오버레이 | 봉인 개방 입력 → summonEnemy, 처치 시 LootRecord |
| MidClash (중반 격전) | core domain | 정예 서지 + 강화 리더(엘리트급), 전용 세그먼트 | SEGMENTS 삽입, 리더 처치 게이트, par +30초 |
| LootRecord | supporting (reused) | seed, rarity, planet, stage | 조우 보상의 담체(rarity 강제) |
| InputFrame.special | supporting (reused) | 비트필드 | opt-in 상호작용의 결정론 입력 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 6 | 6 | - | - | N/A |
| 2 | 6 | 0 | 0 | 6 | 100% |
| 3 | 6 | 0 | 0 | 6 | 100% |
| 4 | 6 | 0 | 0 | 6 | 100% |
| 5 | 6 | 0 | 0 | 6 | 100% |
| 6 | 6 | 0 | 0 | 6 | 100% |

도메인 모델이 1라운드부터 안정 — 그릴 세션에서 이미 개념이 수렴돼 있었기 때문(설계 결정 완료 상태에서 구현 축으로 진입).

## Interview Transcript
<details>
<summary>Full Q&A (6 rounds + Round 0)</summary>

### Round 0 | 토폴로지 확정
**Q:** 4개 top-level 컴포넌트(프레임워크 코어·보물 격실·경량 4종·중반 격전)가 맞나? 범위는?
**A:** 4개 전부 명세.

### Round 1 | 프레임워크 코어 / Context
**Q:** opt-in 상호작용을 결정론 입력으로 어떻게 표현?
**A:** special 비트 확장(추천).
**Ambiguity:** 28.8%

### Round 2 | 프레임워크 코어 / Context
**Q:** 등장/유형/시점 롤 구조?
**A:** 단일 fork 순차 롤(추천).
**Ambiguity:** 24.0%

### Round 3 | 보물 격실 / Context
**Q:** detour 공간을 무한 월드와 어떻게 공존?
**A:** 같은 월드 좌표 워프(추천).
**Ambiguity:** 23.2%

### Round 4 | 프레임워크·보물 격실 / Constraints·Context (🔴 Contrarian)
**Q:** 보상을 기존 엔티티 재사용으로만 풀까, 신규 배선 필요?
**A:** 전부 기존 재사용(추천).
**Ambiguity:** 19.8%

### Round 5 | 중반 격전 / Context
**Q:** 웨이브 디렉터에 어떻게 배선?
**A:** 전용 격전 세그먼트(추천).
**Ambiguity:** 19.7%

### Round 6 | 전체 / Success Criteria (🟢 Simplifier)
**Q:** 구현 순서·검증 슬라이스?
**A:** 수직 슬라이스 우선(추천).
**Ambiguity:** 13.2%
</details>
