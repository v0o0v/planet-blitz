<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# sim — 결정론 시뮬 코어

## 목적

**60Hz 고정 타임스텝 상태 머신.** `stepWorld(state, inputFrame)` 는 결정론적 전이다 — 같은
[시드 + 입력 프레임 열]이면 클라이언트와 서버 Edge Function 이 **틱별로 비트 단위 동일한 상태**를
낸다(ADR-0005). 이것이 침공 리플레이 검증(부정행위 차단)의 토대다.

플랫폼 독립이며, ESLint 가 다음을 error 로 막는다: `pixi.js`/`@pixi/*` import, `*/render/*`·
`*/ui/*`·`*/input/*` import, `Math.random`, `Date.now`, `performance.now`.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `world.ts` | (4208줄) 월드 상태 + `stepWorld`. **틱당 처리 순서가 상태 해시를 정한다** — 순서를 바꾸면 해시가 깨진다 |
| `constants.ts` | 코어 상수(leaf 모듈 — sim 의존 0, 순환 import 방지) |
| `rng.ts` | 시드 RNG(mulberry32) + 스트림 분리 `fork('drops')` 등. 서브시스템 간 난수 간섭 차단 |
| `math.ts` | 초월함수 격리 — `sin/cos/atan2` 를 기본연산 근사로 대체(엔진별 IEEE 차이 봉쇄) |
| `entities.ts` | 엔티티 단일 struct 모델 + 팩토리 (leaf) |
| `collision.ts` | 균일 공간 해시 broad-phase. 결정론 순회 순서 유지 |
| `los.ts` | 벽 기하 — 시야선(line-of-sight), 원 vs AABB |
| `bullets.ts` | 적탄 거동 카탈로그(직진·유도·곡사·분열) |
| `patterns/` | 적 패턴 엔진 — 이동 × 공격 컴포넌트 조합(데이터 주도, `types.ts`+`index.ts`) |
| `waves.ts` | 웨이브 디렉터 — 구간 예산표 + 시드 카드 추첨 |
| `boss.ts` · `bossProgress.ts` | 보스 전투 로직 / 보스 등장까지 남은 진행도 파생 |
| `elite.ts` | 엘리트 + 엘리트 어픽스 |
| `drops.ts` | 드랍 판정 — 드랍 시드(u32)+등급 코드만 내고 실물은 `items/roll.ts` 가 확정 |
| `powerups.ts` | 레벨업 3택 풀 |
| `status.ts` · `cloak.ts` | 상태이상 산술 / 팬텀 은신 술어(적 AI 가 읽는 단일 게이트) |
| `actives.ts` · `activeTypes.ts` | 액티브 스킬 발동 엔진 + 핸들러 계약(ADR-0041) |
| `capstones.ts` · `uniques.ts` · `shipSignature.ts` | 캡스톤·유니크 효과·시그니처 패시브의 게이트 상수와 순수 헬퍼 |
| `moduleEffects.ts` · `catalystMods.ts` | 코어 모듈 효력 / 촉매 배율 번들의 sim 반영 |
| `chunks.ts` · `scrollMode.ts` | 무한 스크롤 맵의 절차적 청크 배치 / PvE 강제 스크롤 런타임(ADR-0021·0034) |
| `planetMode.ts` | 행성 모드 selector — 공통 코어 위에 얹히는 모드 레이어의 분기점 |
| `encounter.ts` · `encounterDetour.ts` · `encounters/light.ts` | 조우 프레임워크(ADR-0033) — 런당 최대 1회 opt-in 희귀 이벤트. detour(보물 격실)와 경량 4종 |
| `echo.ts` | 에코 신호 — 시드 파생 ~3% 로 나오는 서사 이벤트(ADR-0023) |
| `commissionOrders.ts` · `commissionSegment.ts` · `commissionCarry.ts` | 의뢰 주문 4종 판정 / 구간 전환 층 / **승계 계약**(구간을 넘는 것과 버려지는 것) |
| `autopilot.ts` | 순수 결정론 입력 봇 — 벤치·회귀 런이 사람 없이 런을 진행하는 수단(ADR-0008). 조향 정본(`pilotSteer`) 소유. **출력 동결**(골든이 그 위에 산다) |
| `measurePilot.ts` | **측정 전용** 파일럿(ADR-0049 §0-A 결정 B) — 조향은 위와 공유하고 **대시·액티브 발동 + 벽 접근 정책**만 더한다. 호출부가 고르는 순수 입력 생성기라 `WorldConfig`·해시에 안 남는다 |
| `replay.ts` | 입력로그 기록·재생 + FNV-1a 상태 해시(float64 비트 단위) |
| `snapshot.ts` | 렌더용 직렬화 스냅샷 — sim → render 의 **유일한 통로** |
| `events.ts` | 근접 발동 기믹 오브젝트 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `invasion/` | 침공 3레이어 런타임(ADR-0017) (`invasion/AGENTS.md`) |
| `modes/` | 행성 모드 7종 + 중반 격전 (`modes/AGENTS.md`) |
| `activeHandlers/` | 기체 타입별 액티브 스킬 효과 함수 (`activeHandlers/AGENTS.md`) |
| `patterns/` | 적 패턴 컴포넌트 엔진(파일 2개 — `types.ts` 계약 + `index.ts` 실행기) |
| `encounters/` | 경량 조우 4종(`light.ts`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

1. **처리 순서를 바꾸지 마라.** `stepWorld` 의 틱당 순서(이동 → 스폰 → 적 → 보스 → 자동공격 →
   적분 → 해저드 → 충돌 → 사망 압축 → 콤보 → 레벨업 → 게임오버)가 상태 해시의 정의다.
2. **난수는 반드시 `state.*Rng`(fork 된 스트림)에서 뽑는다.** 새 서브시스템은 새 fork 를 만든다 —
   기존 스트림을 나눠 쓰면 무관한 기능의 드랍·웨이브가 통째로 바뀐다.
3. **필드를 추가하면 해시가 바뀐다.** 스냅샷·리플레이 골든이 함께 깨지므로 의도적일 때만 한다.
4. **`src/sim/**` 변경 = Edge Function(`verify-invasion`·`verify-commission`) 재배포 필수.**
   안 하면 서버가 옛 시뮬로 재계산해 제출이 전부 거부된다.
5. 소속 판정은 필드를 늘리지 말고 **센티넬 마커**(`ownerId` 에 박는 고정 상수) 관용구를 쓴다 —
   값은 append-only 이고 서로 겹치면 안 된다(`CONTEXT.md` "센티넬 마커").

### 테스트 요구사항

- 결정론 해시 테스트(같은 시드·입력을 두 번 돌려 틱별 해시 100% 일치)가 최종 안전망이다.
- **골든 3파일은 기본 스위트에 없다** — `pnpm test:sim` 으로 따로 돈다(약 4~7분). `src/sim/**` 을
  건드렸으면 **PR 올리기 전에 반드시 한 번** 돌려라. 기본 스위트는 골든 발산을 원리적으로 못 잡는다.
  - ⚠️ **`main` 은 전부 초록이다(ADR-0051 이후). 빨간 것이 보이면 그건 네 변경이다** —
    구 「main 에 이미 깨진 골든이 있으니 `git stash` 대조부터」 절차는 **폐지됐다.** 그 절차가
    필요했던 상시 실패 12건은 전부 봇 완주 e2e 였고 ADR-0051 이 게이트에서 내렸다.
  - 통계 계측은 이제 게이트가 아니라 **CLI** 다 — `pnpm bench:{curve,invasion,commission}`
    (`tests/` 글롭 밖의 `bench/` 라 구조적으로 자동 수집 불가). 그래서 파일 수가 9 → 3 이다.
  - ⚠️ **골든 재생성은 검증이 아니다.** 다시 뜬 골든으로 그 골든을 검사하면 항진이다 —
    근거는 재생성 **전에** 통과시킨 불변식이어야 한다.
- 크로스런타임 검증: `scripts/deno-verify/` 가 Node 와 Deno 에서 같은 해시가 나오는지 잰다.

### 공통 패턴

- **순수 함수 + 정수 산술.** 부동소수 비교는 피하고, 불가피하면 비트 단위로 해시한다.
- 데이터는 `/data` 카탈로그에서 읽고 sim 은 규칙만 갖는다(`drops.ts` 가 등급 코드를 숫자로
  복제해 둔 것처럼, sim 이 아이템 계층을 런타임 의존하지 않게 한다).
- 모드·조우·의뢰 같은 레이어는 **월드에 훅으로 얹고** 코어 루프를 갈아엎지 않는다.

## 의존성

### 내부

- `data/**` — 적·웨이브·보스·행성 로스터·액티브 스킬 카탈로그(타입/데이터만)
- 역방향으로 `src/render`·`src/ui`·`supabase/functions/**` 가 이 디렉터리를 읽는다

### 외부

없음. **의도적으로 0 이다** — 플랫폼 독립이 결정론의 전제다.

<!-- MANUAL: -->
