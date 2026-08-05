<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# harness — DEV 전용 하네스

## 목적

개발·테스트용 **게임 제어·검사 도구**(ADR-0008). 화면 점프, 헤드리스 빨리감기, 속도 조절,
일시정지·스텝, 구조화된 상태 덤프, 이벤트 링 버퍼, 치트 패널을 제공한다.
`window.__pb.harness` 로 노출되며 **프로덕션 번들에는 절대 안 들어간다** — `main.ts` 가
`import.meta.env.DEV` 가드 안에서 동적 import 하므로 tree-shake 된다.

실행 절차는 `.claude/skills/harness/SKILL.md`(dev 서버 → `?harness=1` 을 사용자 브라우저로).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `core.ts` | (935줄) 하네스 코어 — 화면 점프·빨리감기·침공 레이어 점프·상태 덤프 |
| `cheatPanel.ts` | (2443줄) 치트 패널 UI — 사용자가 직접 눌러 테스트하는 1차 표면 |
| `events.ts` | 이벤트 링 버퍼 + 상태 diffing |
| `presets.ts` | 하네스 프로필 프리셋 |
| `replayStore.ts` | 리플레이 보관·요약 |
| `invasionEdit.ts` | 침공 배치 세부 편집 |
| `catalystMock.ts` · `defenseMock.ts` · `lineageMock.ts` · `dailyRewardMock.ts` | 모의 게이트웨이 — 오프라인에서 서버 잠금 기능을 돌려보게 한다 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `gallery/` | 이펙트 변형군을 나란히 놓고 보는 프로토타입 갤러리 (`gallery/AGENTS.md`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **격리 계약 두 가지를 깨지 마라**(ADR-0008):
  1. **하네스 프로필** — 세이브 I/O 가 별도 localStorage 슬롯으로 redirect 되어 본 세이브를 안 건드린다.
  2. **오염 런** — 라이브 런 중 상태를 바꾸는 치트는 `markTainted(world)` 를 부른다. 오염된 런은
     정산되지 않고 리플레이도 제출되지 않는다. 오토파일럿 입력과 빨리감기는 정상 기록 경로라 **오염이 아니다**.
- **격리는 로컬에만 있다.** 서버 행은 uid 로만 갈리므로 로그인한 하네스는 그 계정의 서버 데이터를
  진짜로 바꾼다 — **전용 테스트 구글 계정으로만** 로그인한다.
- **모의 게이트웨이가 서버와 갈리면 그 자체가 결함**이다. 서버 계약이 바뀌면 모의도 같이 고친다.
- 모의 override 가 config 보다 먼저 걸려 실서버를 조용히 가린 이력이 있다 — 우선순위를 확인한다.

### 테스트 요구사항

`tests/harness*.test.ts` · `tests/autopilot.test.ts`. 실제 사용은 사용자가 브라우저에서 한다.

### 공통 패턴

- DEV 가드 뒤에서만 import 된다. 프로덕션 코드가 하네스를 정적 import 하면 번들에 실린다 — 금지.

## 의존성

### 내부

`src/sim/**` · `src/save/**` · `src/net/**`(모의로 대체) · `src/render/**`

### 외부

`pixi.js`(치트 패널 UI)

<!-- MANUAL: -->
