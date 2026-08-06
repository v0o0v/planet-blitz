<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# bench — 벤치·계측

## 목적

성능과 밸런스를 **재는** 코드. 튜닝하지 않는다 — 수치를 내고 판정만 한다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `bench.ts` | `?bench=1` 렌더 벤치 씬(탄 2,000 + 더미 적 200). `window.__bench.step()` 으로 프레임당 ms 를 잰다 |
| `simBench.ts` | 헤드리스 sim 처리량 벤치(렌더 없음) |
| `memProbe.ts` | 장시간 세션 메모리 누수 프로브 |
| `rosterBench.ts` | 로스터(기체 7종) 밸런스 **측정** 하네스 + 표준 빌드 곡선(`runCurveSweep`). 곡선 실행은 `bench/runCurve.ts` 로만 한다 |
| `commissionBench.ts` | 의뢰 런 다구간 난이도 계측 |
| `invasionBands.ts` | 침공 밴드 계측 하네스 + **시드 램프 미러**(`RAMP`·`seedBaseLayers`). 램프 정본은 마이그레이션 SQL 이고 드리프트 가드는 `tests/invasionBalance.test.ts` 에 있다 |
| `standardBuild.ts` | **표준 빌드** — 표준 장비 + 표준 스킬 투자(ADR-0035). 모든 계측의 기준 피험자 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `balance/` | `pnpm balance` 예산제 밸런스 하네스 (`balance/AGENTS.md`) |

## 실행 진입점은 리포 루트 `bench/` 다 (ADR-0051)

계측을 **돌리는** 스크립트는 `src/bench/**` 가 아니라 리포 루트 `bench/*.ts` 에 있다. 여기(`src/bench/**`)는
재사용 가능한 **하네스**만 두고, 진입점은 저쪽에 둔다 — `tests/` 글롭 밖이라 자동 수집이 구조적으로 불가능하다.

| CLI | 재는 것 |
|---|---|
| `bench/runCurve.ts` | 표준 빌드 곡선 — 런 길이 par · 완주 가능성 · 런당 XP/장비 유입 |
| `bench/invasionBands.ts` | 침공 밴드 클리어율 · 밴드 안 분산 · 로스터 간섭 |
| `bench/commissionBands.ts` | 의뢰 계급별 클리어율 · 구간틱 상한 초과 |

실행법은 각 파일 머리 주석에 있다(`vite-node` 는 PATH 에 없어 경로를 직접 준다).

⚠️ **사용법을 문서에 적기 전에 실제로 한 번 돌려라.** 곡선 진입점은 "`--curve` 로 쓸 수 있다"고
적혀 있었지만 `vite-node` 가 argv 에서 스크립트 경로를 지우는 탓에 **출력 0바이트 · 종료 코드 0**
으로 조용히 끝나고 있었다(2026-08-06 발견). 죽은 계측기가 빨갛게 죽지 않고 성공한 척한 사례다.

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **계측기 고장을 먼저 의심하라.** 이 프로젝트에서 "지표가 안 움직인다"의 원인이 **네 레인 연속으로
  계측기 자체의 결함**이었다. 값이 항상 0 이거나 정확히 같으면 구조적 무발사 신호다.
- 브라우저 탭이 백그라운드면 `requestAnimationFrame` 이 스로틀돼 FPS 가 왜곡된다 — **프레임당
  update+render ms 를 16.6ms 예산과 비교**해 판정한다.
- 좁은 프로브가 전 행성 런보다 싸고 정밀하다. 무엇을 재려는지부터 좁힌다.
- 일반화는 **교환 대조**로만 한다(한 축만 바꿔 두 번 재기).

### 테스트 요구사항

`tests/balanceHarness.test.ts` 는 **sim 레인**(`pnpm test:sim`)이다. `src/bench/**` 를 건드렸으면
그 레인을 돌린다.

### 공통 패턴

- 측정은 순수 함수로 뽑아 재집계가 가능하게 한다(원자료 보존 → 리포트는 언제든 다시 렌더).

## 의존성

### 내부

`src/sim/**` · `src/items/**` · `src/save/progressionPath.ts` · `data/**`

### 외부

`pixi.js`(`bench.ts` 만)

<!-- MANUAL: -->
