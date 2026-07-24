# Deep Interview Spec: 촉매 시스템 (변칙 경보 대체)

## Metadata
- Interview ID: di-catalyst-2026-07-24
- Rounds: 11 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: 17%
- Type: brownfield
- Generated: 2026-07-24
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- 선행 문서: [ADR-0029](../../docs/adr/0029-catalyst-replaces-anomaly-alerts.md), [CONTEXT.md](../../CONTEXT.md)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.88 | 0.35 | 0.308 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.85 | 0.25 | 0.213 |
| Context Clarity | 0.72 | 0.15 | 0.108 |
| **Total Clarity** | | | **0.829** |
| **Ambiguity** | | | **0.171** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 카탈로그 설계 | active | 공용 30종 + 특산 18종의 효과 축·개별 정의 | R1(보상 구조)·R4(48종 출시 요건)·R7(축 목록)·R8(파워 축 정합)·R11(특산 템플릿) |
| sim 통합 | active | anomaly.ts 폐기, config 촉매 배열, 효과 함수, 스택 수학, 해시 폴드 | R5(수용 기준 5종)·R9(선형 가산+상한) |
| 서버 경제 | active | 원장 스키마, 시작 시 소모 RPC, 분해 RPC, 정산 배율 연동 | R3(실패 폴백)·R6(분해 추가)·R10(분해 왕복 검증) |
| UI/UX | active | 주입 패널, 픽커 팝업, 관리 화면, 분해 | R6(범위=분해까지)·R10(하네스 실증 기준) |
| 해금·온보딩 | active | 노출 시점, 드랍 시작 조건, 학습 흐름 | R2(게이트 없음)·R10(fresh 프로필 실증) |

## Goal

성계 지도의 시드 랜덤 **변칙 경보**를 폐지하고, PvE 런 드랍으로 얻어 출격 전 주입하는 소모품 **촉매**로 대체한다. 촉매는 난이도 페널티와 보상 부스트를 한 몸으로 가지며, 플레이어가 "오늘 무엇을 키울지"를 능동 선택하는 파밍 조향 장치가 된다. 카탈로그는 공용 30종 + 행성당 특산 3종(6행성 = 18종) 총 48종 전량이 출시 요건이다.

## Constraints

### 그릴 세션 확정분 (ADR-0029)
- 런 1회 소모형 — 성계 지도 출격 전 주입
- 종류당 고정 효과 (랜덤 롤 없음)
- 다중 주입 + 같은 종류 중복 스택 허용
- 전 촉매 페널티+보상 동봉 (순수 버프 없음)
- PvE 런 드랍(엘리트·보스)이 획득 주축
- 무등급 플랫 — 희소성은 드랍 가중치로 표현
- 보유 정본은 서버 원장, **런 시작 시 소모**
- PvE 침략 전용 — 침공·래더·리플레이 검증 불개입
- 특산 촉매는 **출신 행성 런에만** 주입 가능

### 본 인터뷰 확정분
- **보상 구조**: 페널티는 촉매마다 고유·구체적, 보상은 공통 축 중 하나에 +X% (POE 맵 mod 문법)
- **보상 공통축 6종**: 드랍량 · 희귀도 · 경험치 · 자원(크레딧·희귀 광물) · 촉매 드랍률 · **파워**(기체 스탯 강화·스킬 +N)
- **파워 축 4제약**: ① 런 한정(영구 성장 불침범, 파워업과 같은 지위) ② 강화 대상은 기존 스탯 어휘(공격력·연사·이속·HP·실드 등) 재사용 ③ "모든 스킬 +N" 류 프리미엄 효과는 등급이 아니라 **드랍 가중치 극저 종류**로 표현(무등급 원칙 유지) ④ 페널티 동봉 예외 없음
- **스택 수학**: **선형 가산** — 효과는 "장당 +X%"로 정의, N장 = N·X% (페널티·보상 동일 규칙). 곱연산·로그 감쇠 기각
- **슬롯 상한**: 총 주입 수에 **하드 캡 상수 존재**(값은 밸런스 미정). 서버도 동일 상수로 검증 — 무상한이면 개연성 캡·UI·해시 입력이 비유계
- **48종 전량이 출시 요건** — 효과 다양성 자체가 셀링 포인트 (축소 웨이브 출시 명시적 기각, R4 Contrarian 통과)
- **특산 3슬롯 템플릿**(전 행성 동일 구조): ① 모드 격화형(그 행성 모드 규칙을 비틂) ② 테마 자원형(특산 광물·간판 보상 격화) ③ 보스 격화형(시설 관리자 강화 + 보스 드랍·설계도 확률↑)
- **소모 RPC 실패 폴백**: [재시도] / [촉매 빼고 출격] 2선택. 아이템 미소모 보존, 무촉매 런은 종전대로 오프라인 시작 가능. 낙관적 로컬 진행 기각(무한 촉매 런 악용)
- **해금 게이트 없음**: 1단계부터 드랍, 첫 획득이 곧 튜토리얼(획득 연출 + 주입 패널 뱃지)
- **UI 범위**: 주입 패널 + 픽커 팝업 + **전용 관리 화면 + 촉매 분해**(자원 환산). 분해 환산율은 밸런스 미정
- 밸런스 수치(효과 계수·드랍률·상한값·분해 환산율)는 **출시 전 일괄 튜닝** — 본 스펙은 구조만 확정

## Non-Goals

- 침공(PvP)·래더·리플레이 검증 계약 변경 — 촉매는 PvE 전용
- 촉매 어픽스·등급·리롤 — 무등급 플랫 유지
- 촉매 상점·합성 — 획득은 PvE 드랍 주축 (보조 경로는 출시 후 확장 여지)
- 구 변칙 3종(중력 폭풍·군체 대발생·암흑 성운) 효과 승계 — 백지 설계
- 행성 모드의 타 행성 이식 — 특산도 출신 행성 전용 (ADR-0021 예외 없음)
- 밸런스 수치 확정 — 출시 전 일괄 패스

## Acceptance Criteria

### sim 통합 (R5)
- [ ] 같은 시드 + 같은 촉매 배열 → 동일 `hash`; 촉매 배열이 다르면(순서 무관 정규화 후) hash 분기
- [ ] `anomaly.ts`·변칙 UI·변칙 i18n 키 제거 후 전체 vitest 그린 (무회귀)
- [ ] 48종 각각 "적용 전후 sim 관측치가 명세 방향으로 변한다" 단위 테스트 (수치 아닌 부호 검증)
- [ ] 같은 종류 N장 스택 시 선형 가산 규칙대로 효과가 커진다
- [ ] **정규 경로 통합 테스트 1본**: 주입 → 소모 영수증 → 런 → 정산 배율까지 한 줄로 연결 (이 프로젝트 8회 재발한 "배선 누락" 결함 전용 방어선)

### 카탈로그·UI·경제·해금 (R10)
- [ ] 48종 전량이 데이터 파일에 정의(페널티·보상축·드랍 가중치·특산 소속) + 종당 아이콘 + ko/en i18n
- [ ] 성계 지도 주입→출격, 픽커 48종 열람·수량 확인, 관리 화면 분해가 하네스 브라우저 검증으로 실증
- [ ] 분해 실행 → 원장 차감·자원 지급 → 클라 표시 갱신 왕복 1본 통합 테스트
- [ ] 특산 강제: 출신 행성이 아닌 행성 선택 시 픽커에서 주입 불가(비활성+사유), 서버 소모 RPC도 행성-특산 불일치 거부
- [ ] 신규 프로필(하네스 fresh)로 1단계 런 촉매 드랍 → 즉시 주입 가능 (해금 게이트 부재 실증)
- [ ] 소모 RPC 실패 시 [재시도]/[촉매 빼고 출격] 폴백 동작, 실패 경로에서 아이템 미소모 확인

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 보상도 촉매마다 고유 설계 | 30종 개별 밸런싱·합산 규칙 복잡도 | 페널티만 고유, 보상은 공통 축 6종에 +X% |
| 48종은 어림수 목표치 | R4 Contrarian: "16종이면 무엇이 사라지나?" | 다양성 자체가 셀링 포인트 — 48종 전량 출시 요건으로 승격 |
| UI는 최소형이면 충분 | R6 Simplifier: "주입+픽커가 전부여도 되나?" | 반대로 확장 — 관리 화면 + 분해까지 출시 범위 |
| 보상축은 경제 지표만 | 자유 입력: "기체 약점 보완" 요구 | 파워 축 신설, 단 런 한정·기존 스탯 어휘·무등급 유지·페널티 동봉 |
| 스택은 곱연산이 자연스럽다 | 깊은 스택에서 페널티-보상 균형 발산 | 선형 가산 + 하드 캡 상수 |
| 시작 시 소모면 서버 장애 시 출격 불가 | 코어 루프가 서버 장애에 인질 | 무촉매 출격 폴백 — PvE 오프라인 시작 보존 |
| 신규 유저에게 복잡하니 해금 필요 | 선택적 시스템은 자기 게이팅 | 게이트 없음, 첫 획득이 튜토리얼 |

## Technical Context (brownfield)

### 제거 대상
- [src/sim/anomaly.ts](../../src/sim/anomaly.ts) — 전체 폐기. 순수 함수 5종(`enemyBulletSpeedMult`·`maxEnemiesMult`·`enemyHpMult`·`dropRateMult`·`uniqueChanceMult`)과 `rollAnomaly`
- [src/sim/world.ts](../../src/sim/world.ts) — `anomalyRng` fork(L854), `state.anomaly`(L597), 적탄 배속 적용(L2515), 드랍 롤 인자(L3223·L3254)
- [src/run/runConfig.ts](../../src/run/runConfig.ts) — `anomalyAccepted` 필드(L49·L131) → 촉매 배열로 교체
- [src/ui/pixi/planetSelect.ts](../../src/ui/pixi/planetSelect.ts) — 변칙 패널(`makeAnomalyPanel` L489~, `setAnomaly` L232, 라벨 테이블 L33~) → 주입 패널로 교체
- [src/ui/planetSelect.ts](../../src/ui/planetSelect.ts) (DOM 판), [src/i18n/catalog.ts](../../src/i18n/catalog.ts) `anomaly.*` 키, [src/sim/replay.ts](../../src/sim/replay.ts) 해시 폴드, [src/sim/drops.ts](../../src/sim/drops.ts)·[src/sim/waves.ts](../../src/sim/waves.ts) 인자, [src/harness/core.ts](../../src/harness/core.ts)·[cheatPanel.ts](../../src/harness/cheatPanel.ts) `anomaly` 파라미터

### 재사용 패턴
- 서버 원장 권위·RPC 문법: [ADR-0027](../../docs/adr/0027-server-ledger-authority.md), 치팅 방어 재설계(PR#119)
- 팝업 UI 문법: 카드 화면 팝업(표 셋 이상은 팝업 분리), `panelContent()` 여백 강제, `stripEmoji`
- 하네스 검증: `?harness=1` + `startRun`/`ff`/`snapshot`, fresh 프리셋
- 밸런스 유보 원칙: [defer-balance-tuning](../../CONTEXT.md) — 구조만 확정, 수치는 출시 전 일괄

### 문서 후속
- CONTEXT.md **분해** 정의가 현재 "장비 전용" — 촉매 분해를 포함하도록 확장 필요
- GDD(AC10)·beginner-guide·player-power-reference의 변칙 경보 서술 갱신

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 촉매 | core domain | id, 페널티, 보상축, 보상량, 드랍 가중치, 소속(공용/특산) | 런에 주입된다; 서버 원장이 수량을 소유 |
| 공용 촉매 | core domain | 30종, 전 행성 드랍 | 모든 PvE 런에 주입 가능 |
| 특산 촉매 | core domain | 18종(6행성×3슬롯), 출신 행성 | 출신 행성 런에만 주입 가능 |
| 특산 3슬롯 | supporting | 모드 격화형 / 테마 자원형 / 보스 격화형 | 모든 행성이 같은 템플릿 공유 |
| 페널티 | supporting | 촉매별 고유·구체적 | 촉매가 하나씩 가진다 |
| 보상 공통축 | supporting | 드랍량·희귀도·경험치·자원·촉매·파워 6종 | 촉매가 하나를 지목해 +X% |
| 파워 축 | supporting | 런 한정, 기존 스탯 어휘, 스킬 +N | 보상 공통축의 6번째; 파워업과 같은 지위 |
| 주입 | supporting | 촉매 ID 배열(중복 허용), 슬롯 상한 | 성계 지도에서 런 config로 |
| 소모 영수증 | supporting | 서버 발급, 적용 촉매 목록 | 런 시작 시 발급 → 정산에 동봉 |
| 슬롯 상한 | supporting | 하드 캡 상수(밸런스 미정) | sim·서버·UI가 공유 |
| 촉매 분해 | supporting | 자원 환산 | 관리 화면에서 실행, 원장 차감 |
| 주입 패널 | supporting | 성계 지도 하단(구 변칙 패널 자리) | 픽커 팝업을 연다 |
| 픽커 팝업 | supporting | 48종 그리드, 수량 뱃지, 주입/해제 | 특산 불일치는 비활성 렌더 |
| 관리 화면 | supporting | 정렬·필터·상세·분해 | 격납고 계열 |
| 서버 원장 | external system | 촉매 수량 정본 | 시작 시 차감, 분해 시 차감·자원 지급 |
| 정산 요약 | external system | 영수증 동봉 → 보상 배율 재계산 | 3중 캡 안에서 지급 |
| 행성 모드 | core domain | 6종 | 특산 모드 격화형이 비트는 대상 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|-------|-------------|-----|---------|--------|-----------|
| 1 | 9 | 9 | - | - | N/A |
| 2 | 10 | 1 | 0 | 9 | 100% |
| 3 | 11 | 1 | 0 | 10 | 100% |
| 4 | 11 | 0 | 0 | 11 | 100% |
| 5 | 11 | 0 | 0 | 11 | 100% |
| 6 | 13 | 2 | 0 | 11 | 100% |
| 7 | 15 | 2 | 0 | 13 | 87% |
| 8 | 15 | 0 | 0 | 15 | 100% |
| 9 | 16 | 1 | 0 | 15 | 100% |
| 10 | 16 | 0 | 0 | 16 | 100% |
| 11 | 17 | 1 | 0 | 16 | 100% |

3라운드 연속 완전 수렴 — 도메인 모델 안정.

## Interview Transcript

<details>
<summary>Full Q&A (Round 0 + 11 rounds)</summary>

### Round 0 — 토폴로지 확인
**Q:** 5개 최상위 컴포넌트(카탈로그·sim·서버·UI·해금)가 맞나?
**A:** 맞다 — 5개 전부 다룸

### Round 1 — 카탈로그 / Goal
**Q:** 공용 30종의 페널티-보상 결합 구조는?
**A:** 페널티 고유 + 보상 공통축
**Ambiguity:** 55%

### Round 2 — 해금 / Goal
**Q:** 해금·온보딩 방식은?
**A:** 게이트 없음 — 첫 획득이 튜토리얼
**Ambiguity:** 50%

### Round 3 — 서버 / Constraints
**Q:** 소모 RPC 실패 시 출격 흐름은?
**A:** 재시도 / 무촉매 출격 폴백
**Ambiguity:** 47%

### Round 4 — 카탈로그 / Constraints (CONTRARIAN)
**Q:** 48종은 출시 요건인가 목표 규모인가?
**A:** 48종 전량 출시 요건
**Ambiguity:** 45%

### Round 5 — sim / Criteria
**Q:** sim 수용 기준 5개로 충분한가?
**A:** 충분 — 5개 확정
**Ambiguity:** 38%

### Round 6 — UI / Goal (SIMPLIFIER)
**Q:** 출시 시점 UI 범위는?
**A:** 분해까지 포함
**Ambiguity:** 36%

### Round 7 — 카탈로그 / Goal
**Q:** 보상 공통축 목록은?
**A:** 경제 5축 전부 + 기체 특성 강화(약점 보완) + 좋은 촉매의 모든 스킬 +N
**Ambiguity:** 33%

### Round 8 — 카탈로그 / Goal
**Q:** 파워 축의 4이해(런 한정·스탯 어휘·초희귀 종류·페널티 동봉)가 맞나?
**A:** 맞다 — 4이해 확정
**Ambiguity:** 31%

### Round 9 — sim / Constraints
**Q:** 스택 합산 구조와 슬롯 상한은?
**A:** 선형 가산 + 상한 상수
**Ambiguity:** 28%

### Round 10 — UI+카탈로그 / Criteria
**Q:** 나머지 컴포넌트 수용 기준 5개 확정?
**A:** 확정
**Ambiguity:** 23%

### Round 11 — 카탈로그 / Goal
**Q:** 특산 3종 설계 템플릿은?
**A:** 3슬롯 템플릿(모드 격화·테마 자원·보스 격화)
**Ambiguity:** 17% ✅

</details>
