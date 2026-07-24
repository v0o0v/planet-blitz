# Deep Interview Spec: 장비 요구 레벨 게이트 (구현)

## Metadata
- Rounds: 4 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: ~18%
- Type: brownfield
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- 선행: grill-with-docs 세션(상위 설계 확정) + ADR-0030 + CONTEXT.md "요구 레벨"

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Goal Clarity | 0.83 | 0.35 | 0.29 |
| Constraint Clarity | 0.76 | 0.25 | 0.19 |
| Success Criteria | 0.73 | 0.25 | 0.18 |
| Context Clarity | 0.90 | 0.15 | 0.14 |
| **Total Clarity** | | | **~0.80** |
| **Ambiguity** | | | **~0.18** |

## Topology
| Component | Status | Description | Coverage |
|---|---|---|---|
| A 요구 레벨 산식 | active | `requiredLevel(item)` 순수 파생 | 산식 구조·유니크 처리 확정, 수치는 튜닝 이월 |
| B 착용 게이트 UX | active | 표시·차단·프리뷰 상호작용 | 상호작용 모델·표시 표면 확정 |
| C 엣지·마이그레이션·상호작용 | active | 로드/수호/하네스 방어 동작 | 로드 검사 없음·수호 무영향 확정 |

## Goal
장비에 **요구 레벨(reqLevel)** 을 부여해 활성 기체 레벨이 미달이면 착용을 막는다. reqLevel 은 아이템에서 **순수 파생**한다 — 노말·매직·레어는 전투력 점수와 **분리된 독립 상수 테이블**(등급 바닥 + 어픽스 개수 × 가산), 유니크는 `UniqueDef` 의 **개별 저작 reqLevel**(전투형 高·유틸형 低). 게이트는 **클라 착용 액션에서만** 강제하고 로드/마이그레이션 검사는 하지 않는다. sim·상태 해시·세이브 스키마는 불변이다. 저레벨·신규 세대 기체가 럭키 드랍이나 창고 엔드게임 장비로 과도하게 강해지는 것(①)과 퇴역 후 재성장 루프가 껍데기가 되는 것(②)을 막는다.

## Constraints
- `requiredLevel(item)` 은 순수 함수(RNG·시간·sim 무관), 서버가 언제든 재도출 가능.
- 게이트는 클라 메타의 **equip 액션**에서만 검사 — sim 은 부적격 아이템을 보지 않으므로 상태 해시·기존 fixture·세이브 스키마 **불변**.
- reqLevel 은 `itemCombatPower` 와 **분리된 상수**를 쓴다 — 수호 스냅샷·소멸 포인트 재튜닝이 요구 레벨을 흔들지 않게(커플링 차단).
- 로드/마이그레이션 시 이미 장착된 초과 아이템을 검사·강제 해제하지 않는다.
- 밸런스 수치(테이블 상수·유니크별 req)는 출시 전 일괄 튜닝(placeholder + `TODO(밸런스)`). — defer-balance-tuning 방침.
- 유니크의 req 는 `data/uniques.ts` 저작 데이터에 산다(전투형/유틸형 성격 반영).

## Non-Goals
- 드랍 시점 어픽스 강도 스케일 — ADR-0022 "완전 병렬" 보존, req 게이트가 ① 이미 해결.
- 서버측 로드아웃 req 검증 — PvE 는 3중 캡(ADR-0026·0027), PvP 는 ADR-0028(공격측 로드아웃 권위)에 이월.
- 코어 모듈·방어체 등 타 파워 축 게이트 — 자기 게이트(희귀도·사용횟수·자원·승급) 보유.
- 소프트 효율 스케일(하드 게이트 채택).
- 수호 기체·예비역 소집 게이트 — 동결 빌드·재장착 UI 없음 → 게이트 무발동.

## Acceptance Criteria
- [ ] `requiredLevel(item)` 순수 함수: normal/magic/rare = 상수 테이블(바닥 + 어픽스×가산), unique = `UniqueDef.reqLevel` 저작 값. 같은 아이템 → 같은 값(결정론 테스트).
- [ ] 어픽스 리롤(`rerollAffixes`, count 보존) 후에도 req 불변.
- [ ] 결과 범위: 노말 = 1(항상 착용), 매직·레어는 테이블대로, 최대 req ≤ 100(클램프).
- [ ] 인벤토리 장착행·48칸 그리드·96칸 창고·비교 프리뷰·챔피언 선택에 각 아이템 req 표시, 미달 시 빨간색.
- [ ] 기체 레벨 < req 아이템은 장착 컨트롤 **비활성** + 툴팁 "기체 Lv{n} 필요", 클릭/드래그 **무동작**(에러·토스트 없음).
- [ ] 미달 아이템도 **툴팁·비교 프리뷰는 정상 노출**(목표 제시).
- [ ] 로드 시 이미 장착된 초과 아이템은 **해제되지 않음**(로드 검사 없음).
- [ ] sim 상태 해시·기존 결정론 fixture **불변**(equip-time 게이트).
- [ ] i18n: 요구 레벨 라벨·레벨 부족 문구(ko/en).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|---|---|---|
| grill "itemCombatPower 재사용"이 최선 | 그 함수가 수호 스냅샷·소멸에도 쓰여 커플링 발생 | reqLevel 을 **독립 상수 테이블**로 분리 |
| 모든 유니크 = 엔드게임 파워 → 높은 req | Contrarian: 유물 증폭기·도박사의 칩 등 유틸 유니크는 레벨링 중 가치 최대인데 늦게 열림(역설) | 유니크 **개별 저작 req**(전투형 高·유틸형 低), normal~rare 만 산식 |
| 로드 시 초과 장착분 처리(force-unequip?) | 레벨은 기체별 단조 증가라 정상 경로엔 초과 장착이 안 생김 + 미출시라 실 세이브 없음 | **로드 검사 없음** — equip-time 만 강제 |
| 수호 기체도 게이트 대상인가 | 동결 빌드 사용·재장착 UI 없음 | **무영향**(게이트 미발동) |
| 착용 제한 = 하드 월이라 강하게 차단해야 | 보고·비교까지 막으면 목표 제시가 사라짐 | 차단은 **착용만**, 툴팁·프리뷰는 허용 |

## Technical Context
- **신규 모듈** `src/items/requiredLevel.ts` (순수): 등급별 상수 테이블(바닥+가산) + 유니크 저작 참조. `combatPower.ts` 와 분리.
- `data/uniques.ts` `UniqueDef` 에 `reqLevel: number` 필드 추가(15종 저작 — 전투형 ~65-75, 유틸형 ~15-30).
- placeholder 테이블(`TODO(밸런스)`): 노말 바닥 1(+0) · 매직 바닥 10(+2/affix) · 레어 바닥 32(+3/affix) · 유니크 = 저작. 클램프 [1,100], 반올림.
- `src/ui/inventory.ts`: 장착 시도에 `activeShip().level >= requiredLevel(item)` 가드, 미달 시 컨트롤 비활성 + 툴팁. 미달 아이템 프리뷰/비교는 유지.
- `src/ui/pixi/slotGrid.ts` 등 아이템 표시 컴포넌트: req 라벨(미달 빨강).
- `src/i18n/catalog.ts`: `item.reqLevel`, `item.levelLocked` 등 키(ko/en).
- 테스트: `tests/requiredLevel.test.ts`(결정론·경계값·리롤 불변·유니크 저작), 착용 가드 UI 테스트. 결정론 fixture 회귀 없음 확인.
- 참조 문서: docs/adr/0030-equipment-required-level-gate.md, docs/player-power-reference.md.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|---|---|---|---|
| reqLevel | core domain | value(int 1..100) | derived from Item; compared to shipLevel |
| Item | core domain | slot, rarity, affixes, weaponType?, uniqueId? | has reqLevel |
| Rarity | supporting | normal/magic/rare/unique | selects reqLevel 산식(테이블 vs 저작) |
| Affix | supporting | id, stat, value | affix count → reqLevel(테이블) |
| UniqueDef | core domain | id, slot, bit, weaponType?, **reqLevel(신규)** | authored reqLevel |
| shipLevel | core domain | 1..100(활성 기체) | gates equip when < reqLevel |
| equipSlot | supporting | 8칸(main..module0/1) | equip action에서 게이트 |
| guardian | external | frozen build, locked gear | 게이트 무영향(재장착 없음) |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability |
|---|---|---|---|---|---|
| 1 | 8 | 8 | - | - | N/A |
| 2 | 8 | 0 | 0 | 8 | 100% |
| 3 | 8 | 0 | 0 | 8 | 100% |
| 4 | 8 | 0 | 0 | 8 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (Round 0 + 4 rounds)</summary>

### Round 0 — 토폴로지
**Q:** 구현 스펙을 3개 상위 컴포넌트(산식·게이트 UX·엣지/마이그레이션)로 읽음. 맞나?
**A:** 3개 맞음.

### Round 1 — A 산식 구조
**Q:** reqLevel 을 itemCombatPower 에 직접 묶을까, 독립 상수로 분리할까? (커플링: combatPower 는 수호 스냅샷·소멸에도 쓰임)
**A:** 독립 산식 테이블.
**Ambiguity:** ~68%

### Round 2 — B 상호작용 모델
**Q:** 레벨 미달 장비 착용 시도 시 상호작용? (보기·비교 vs 끼기 분리)
**A:** 비활성 + 이유 툴팁 + 프리뷰 허용.
**Ambiguity:** ~54%

### Round 3 — C 로드 방어
**Q:** 이미 장착된 아이템이 레벨 초과로 로드될 때? (수호=무영향, 하네스=레벨 올림은 기결)
**A:** 검사 안 함(equip-time 만).
**Ambiguity:** ~32%

### Round 4 — A 유니크 처리 (Contrarian)
**Q:** 유니크 req 처리? (유틸형 유니크가 레벨링 끝나야 열리는 역설)
**A:** 유니크만 개별 저작 req.
**Ambiguity:** ~18% (임계 통과)

</details>
