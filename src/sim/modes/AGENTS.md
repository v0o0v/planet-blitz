<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# sim/modes — 행성 모드

## 목적

행성마다 다른 **게임플레이 규칙 세트**(ADR-0021). 공통 아레나 서바이벌 코어(이동·자동공격·판정점·
파워업 3택·드랍은 전 행성 불변) 위에 얹히는 변형 레이어로, **카메라·강제 스크롤·지형·적 배치·
진행 게이트 같은 "환경"만** 바꾼다. 모든 모드는 최종적으로 보스 처치로 완주한다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `blockBreak.ts` | 블록격파 — 하→상 강제 종스크롤(−Y) 위에 파괴 가능 벽 코스 |
| `racing.ts` | 레이싱 — 좌→우 강제 횡스크롤(+X) 페이스메이커. 분리벽은 센티넬 마커 `RACING_WALL_MARK` |
| `chase.ts` | 추격·탈출 — 비-스크롤 자유추적. 무적 포식자 + 시야 제한 |
| `shrink.ts` | 수축 지대 — 유한 원형 아레나가 처치에 따라 좁아진다 |
| `contamination.ts` | 오염 확산 — 오염 지형 지속 피해, 노드 파괴로 억제(`CONTAMINATION_NODE_MARK`) |
| `objective.ts` | **목표 오브젝트 판정의 단일 정본** — 무대 진행·승리가 파괴에 걸린 `destructible` 들 |
| `midClash.ts` | 중반 격전(ADR-0032) — 모드가 아니라 **매 런 확정 등장하는 구조 비트**. 정예 서지 + 리더(`MID_CLASH_LEADER_MARK`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- 모드가 바꿔도 되는 것은 **환경**뿐이다. 아이템·스킬·드랍 같은 영구 축은 모드가 건드리지 않는다
  (파워업 3택 풀에 모드 문맥 선택지가 소수 섞이는 것까지가 한계).
- **진행 게이트는 모드마다 형태가 다르다**(처치 할당 / 스크롤 완료 / 코스 통과). 형태가 달라도
  "강하면 빨리 통과한다"는 창발 난이도 철학은 전 모드가 공유한다 — 고정 제한시간을 쓰지 않는다.
- `destructible` 은 여러 모드가 공유하는 개념이고 `ownerId` 는 스냅샷에 실리지 않는다.
  파괴 목표 판정은 `objective.ts` 한 곳에서만 한다 — **같은 술어를 여러 곳에 적어 화면과 규칙이
  갈린 결함 이력**이 있다.
- 새 모드를 추가하면 `src/sim/planetMode.ts` selector 와 `data/planets/**` 배정이 함께 움직인다.

### 테스트 요구사항

- 모드별 짝: `tests/blockBreakMode.test.ts` · `chaseMode.test.ts` · `racing*.test.ts` ·
  `shrink*.test.ts` · `contamination*.test.ts` · `midClash*.test.ts`.
- 모드는 sim 이므로 완주 e2e(`tests/fullRun.test.ts`, sim 레인)가 최종 확인이다.

### 공통 패턴

- 모드 상태는 월드에 붙는 작은 런타임 객체이고, 매 틱 순수 함수로 갱신된다.
- 지형·적을 절차적으로 얹을 때 **설계 코스 위에 절차 지형을 겹쳐 쓰지 않는다**(과거 결함).

## 의존성

### 내부

`src/sim/world.ts`·`entities.ts`·`scrollMode.ts`·`chunks.ts` · `data/planets/**`

### 외부

없음(sim 규율).

<!-- MANUAL: -->
