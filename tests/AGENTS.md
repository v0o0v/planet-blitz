<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# tests — vitest 스위트

## 목적

**309개 테스트 파일.** 환경은 `node`(브라우저 전역 없음 — 캔버스·localStorage 는 스텁·주입으로
대체한다). 소스 파일과 1:1 짝을 이루는 것이 기본 관용구다(`src/ui/runFlow.ts` ↔
`tests/runFlow.test.ts`).

## 두 개의 레인

| 레인 | 명령 | 내용 |
|---|---|---|
| 기본 | `pnpm test` | 계측·골든 9파일을 **제외**한 전부 (약 113초) |
| sim | `pnpm test:sim` | `vite.config.ts` 의 `SIM_LANE_FILES` 9개만 — 계측 4 · 결정론/골든 3 · 완주 e2e 2 (수 분) |

sim 레인을 돌려야 하는 때: **`src/sim/**` · 밸런스 수치 · `src/bench/**` 를 건드렸을 때.**
그 외에는 돌리지 않는다(계측이라 느리고, main 기준으로 이미 깨진 골든이 있어 오인하기 쉽다).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `fixtures/encounter-baseline.json` · `fixtures/striker-prem8.json` | 골든 fixture. `scripts/recordEncounterBaseline.ts`·`recordStrikerBaseline.ts` 로 갱신한다 |
| `support/retireAtCap.ts` | 공용 테스트 헬퍼 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **`envDir` 이 `tests` 로 잡혀 있다**(`vite.config.ts`). 그렇게 하지 않으면 vitest 가
  `.env.local` 을 집어 머신마다 스위트 색이 달라진다 — 실제로 겪은 결함이다.
- **main 에서 이미 12건이 빨갛다**: `invasionE2E` · `invasionIntegration` · `drops` ·
  `progressionPath` · `enemyVisual`. 피격 피해 2배(`PLAYER_DAMAGE_TAKEN_MULT`)로 무입력
  스크립트 파일럿이 런을 완주하지 못하는 것이 원인이고, 밸런스 일괄 튜닝까지 **일부러 안 고친다**.
  내 탓인지는 `git stash` 후 같은 명령으로 실패 목록을 대조해 가린다.
- **테스트가 계약을 잘못 못박은 이력이 있다**(초록 테스트가 "메뉴에 아레나를 켜 둬라"를 계약으로
  고정하고 있었다). 초록이 곧 옳음은 아니다 — 뮤테이션(값을 일부러 틀리게 바꿔 빨개지는지)으로
  검증 항진을 잡는다.
- `pool: 'threads'` 다. `isolate: false` 는 재봤고 **안 쓴다** — 모듈 스코프 상태가 파일 경계를
  넘어 살아남아 터진다(근거는 `vite.config.ts` 주석에 실측과 함께).

### 테스트 요구사항(작성 규칙)

- 새 소스에는 짝 테스트를 만든다. 순수 함수로 뽑을 수 있으면 뽑아서 잠근다 —
  `ff`(빨리감기)로는 렌더 에지를 만들 수 없다.
- 자산·데이터 존재 검사(`*AssetPresence.test.ts`)는 파일시스템을 훑으므로 `--changed` 가 놓친다.
  자산을 추가·삭제했으면 **직접 지정**해 함께 돌린다.
- 테스트를 추가한 뒤에는 `tsc --noEmit` 을 다시 돌린다(타입 오류가 vitest 만으로는 안 잡힌다).
- `pnpm verify` 를 파이프에 물리지 마라 — exit code 가 `tail` 것이 되어 거짓 그린이 된다.

### 공통 패턴

- fake gateway 주입(`src/net`), 인메모리 저장소 주입(`src/save`), 캔버스 스텁(`src/render`·`src/ui`).
- 결정론 검증은 "같은 시드·입력을 두 번 돌려 틱별 해시 비교".

## 의존성

### 내부

`src/**` · `data/**` · `assets/**`(존재 검사)

### 외부

`vitest`

<!-- MANUAL: -->
