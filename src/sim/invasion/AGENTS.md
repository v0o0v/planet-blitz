<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# sim/invasion — 침공 3레이어 런타임

## 목적

비동기 PvP(침공) 1회가 통과하는 **세 구간의 시뮬 런타임**(ADR-0017). 레이어 1(행성 외곽, 아래→위
강제 종스크롤) → 레이어 2(기지 회랑, 좌→우 강제 횡스크롤) → 레이어 3(코어 방, 고정 화면).
세 레이어는 **끊김 없는 한 번의 런**으로 HP·자원이 승계되고, 중간 사망은 침공 실패다.

여기 있는 코드는 서버 Edge Function(`verify-invasion`)에 그대로 번들되어 **리플레이 재계산의
정본**이 된다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `types.ts` | **배치(layout) 스키마 정본.** DB 정본은 `supabase/migrations/20260721000000_m7a_invasion_3layer.sql` |
| `constants.ts` | 침공 상수 정본 |
| `index.ts` | 네임스페이스 배럴 |
| `phase.ts` | 페이즈 머신 L1 → L2 → L3 |
| `step.ts` | 레이어별 스텝 디스패치 |
| `scroll.ts` | 강제 스크롤 카메라 수학. **전멸 가속**(구간 전멸 시 최대 ×2 가속)이 여기 |
| `formation.ts` | L1 편대 스폰 — 웨이브 슬롯에 꽂힌 편대를 낳는다 |
| `facility.ts` | (1086줄) L2 설비 — 방향 제한 방어포·주기 온오프 해저드·드론 스포너 |
| `hazardCycle.ts` | 주기 온오프 해저드 상태머신(순수 정수 함수) |
| `movingWall.ts` | 압축 프레스(이동 벽) |
| `wallIndex.ts` | 활성 벽 broad-phase 인덱스(침공 전용) |
| `coreRoom.ts` | L3 코어 방 — 코어·기물·보스 슬롯 |
| `guardian.ts` · `guardianBridge.ts` | 정비도(풍화) 산술 + 수호 기체 스폰 / L3 브리지 |
| `affix.ts` | 방어체 어픽스 → sim 보정 |
| `normalize.ts` | 공유 정규화 + **위조 대조** — 클라 제출 배치를 서버가 같은 함수로 정규화해 비교 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **여기를 고치면 `verify-invasion` 재배포가 반드시 따라온다.** 배포본과 로컬 번들의 해시를
  `spb functions download` 로 대조하는 것이 유일하게 확실한 판정이다(README "서버 배포").
- 배치 스키마를 바꾸면 **TS 정본(`types.ts`)·SQL 검증(`invasion_layers_valid`)·클라 편집기
  (`src/ui/pixi/defenseCommand.ts`)** 세 자리가 함께 움직여야 한다.
- 스폰 위치·순서는 난이도 그 자체다 — 과거에 "속도가 아니라 낳는 자리"가 난이도 붕괴의 원인이었다.

### 테스트 요구사항

- `tests/invasion*.test.ts` 계열. 단 `invasionE2E`·`invasionIntegration` 은 **main 기준으로 이미
  빨갛다**(피격 피해 2배로 스크립트 파일럿이 L3 전에 죽는다) — 내 탓인지 stash 로 가린다.
- `tests/invasionBalance.test.ts` 는 sim 레인(`pnpm test:sim`)이다.
- 서버측 거부 경로는 `scripts/deno-verify/verifyInvasion.ts` 가 위조·조작 케이스로 확인한다.

### 공통 패턴

- 레이어별 상태는 `InvasionRuntime` 한 곳에 모으고 `step.ts` 가 디스패치한다.
- 해저드·벽처럼 **주기적인 것은 틱 카운트에서 순수 정수로 파생**한다(타이머 상태를 들고 있지 않는다).

## 의존성

### 내부

`src/sim/**`(월드·엔티티·충돌) · `data/invasion/**`(편대·설비·기물·맵 템플릿 카탈로그) ·
`data/guardian.ts`

### 외부

없음(sim 규율).

<!-- MANUAL: -->
