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
| `rosterBench.ts` | 로스터(기체 7종) 밸런스 **측정** 하네스 |
| `commissionBench.ts` | 의뢰 런 다구간 난이도 계측 |
| `standardBuild.ts` | **표준 빌드** — 표준 장비 + 표준 스킬 투자(ADR-0035). 모든 계측의 기준 피험자 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `balance/` | `pnpm balance` 예산제 밸런스 하네스 (`balance/AGENTS.md`) |

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
