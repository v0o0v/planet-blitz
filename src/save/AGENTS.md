<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# save — 프로필·정산

## 목적

플레이어의 **영구 메타 상태**와 그것을 갱신하는 정산 로직. 시뮬 바깥이라 시계·스토리지를 써도
되지만 **RNG 는 쓰지 않는다**(아이템 id 는 드랍 시드 파생).

재화(크레딧·광물)의 정본은 서버 컬럼이고 여기 있는 값은 **표시 미러**다(ADR-0027).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `profile.ts` | (1115줄) 로컬 프로필 저장소. `saveVersion` 스탬프, 저장소는 주입 가능(`KeyValueStore`) — 테스트는 인메모리. **손상된 저장소는 던지지 않고 기본 프로필로 복구** |
| `settlement.ts` | 런 정산 — 경험치·전리품·재화 반영 |
| `progressionPath.ts` | **표준 진행 경로**(ADR-0035·0036) — 경제 밸런싱의 설계 테이블. `RUN_SECONDS_PAR = 95` 등 |
| `combatPower.ts` | 전투력 점수 산식(퇴역 스냅샷·소멸 포인트 기준) |
| `guardianLifecycle.ts` | 수호 기체 생애주기 — 퇴역·소멸·계보 투자·방어 배치(ADR-0007·0024) |
| `itemPresence.ts` | 세이브에 특정 `Item.id` 가 있는가 — **배송 멱등의 유일한 판정자** |
| `storyProgress.ts` | 사연 챕터 해금 순수 판정 |
| `dailySeen.ts` | 일일 보상 모달을 마지막으로 띄운 날의 로컬 기록 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **스키마를 바꾸면 `saveVersion` 과 마이그레이션 경로를 함께 본다.** 기존 세이브가 깨지면
  플레이어의 진행이 사라진다.
- **재화를 로컬에서 늘리지 마라.** 변동은 서버 RPC(`src/net/gateway.ts`)로만 반영하고 여기에는
  결과를 미러한다.
- 신설 컬럼·필드에는 백필이 필요하고, **소스가 이미 GC 된 경우가 있다**(7일) — 그때의 값은
  엄밀한 하한일 뿐임을 명시한다.
- `defaultProfile()` 은 테스트 기준선 픽스처다(제품 기본값이 아니다).

### 테스트 요구사항

`tests/save.test.ts` · `saveProfileStoreGuard.test.ts` · `commissionSettlement.test.ts` ·
`progressionPath.test.ts`(**main 에서 이미 빨간 12건 중 하나**) · `guardianLifecycle.test.ts`.

### 공통 패턴

- 순수 함수 + 주입된 저장소. DOM·localStorage 직접 접근은 `profile.ts` 한 곳으로 모은다.

## 의존성

### 내부

`src/items/**` · `src/net/**`(미러 반영) · `data/economy.ts` · `data/lineage.ts`

### 외부

없음.

<!-- MANUAL: -->
