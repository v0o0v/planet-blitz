---
name: harness
description: Planet Blitz 하네스로 브라우저에서 런을 자동 진행·검증할 때 사용. 하네스, harness, 브라우저 검증, verify in browser, 런 자동 진행, screen jump, 스크린 점프, autopilot 검증 요청 시 발동. dev 빌드의 window.__pb.harness API를 in-app Browser pane(preview_start + javascript_tool)으로 구동한다.
---

# Planet Blitz 하네스 브라우저 검증

**하네스**는 dev 빌드 전용 게임 제어·검증 도구다(스크린 점프·런 fast-forward·상태 덤프). `?harness=1`로 활성화하면 격리된 **하네스 프로필**만 읽고 쓰며 본 세이브는 절대 건드리지 않는다. `window.__pb.harness` API를 `javascript_tool`로 호출해 결정론적으로 런을 몰아 검증한다.

관련 문서: `docs/adr/0008-dev-harness-tainted-runs.md`, `CONTEXT.md`(개발 도구 섹션).

## 1. dev 서버 기동 + 브라우저 오픈

`.claude/launch.json`에 `planet-blitz-dev`(vite, **포트 5180**)가 이미 등록돼 있다. in-app Browser pane 도구를 쓴다:

- `preview_start` 에 `name: "planet-blitz-dev"` 전달 → dev 서버 기동(이미 떠 있으면 재사용).
- `navigate` 로 하네스 URL 열기:

```
http://localhost:5180/?harness=1
```

URL 파라미터(조합 가능):
- `?harness=1` — 하네스 활성 + 하네스 프로필 슬롯 사용(필수).
- `&seed=<n>` — 런 시드 고정(결정론 재현용).
- `&screen=<title|base|starMap|inventory|research|refinery>` — 초기 스크린 딥링크.

> 포트가 5180임에 주의(`package.json`의 `vite --port 5180`). 5173 아님.

## 2. API — `window.__pb.harness`

`javascript_tool`(`action: javascript_exec`)로 호출한다. 반환값은 JSON 직렬화되므로 상태는 `JSON.stringify(...)`로 읽는다.

| 호출 | 설명 |
|---|---|
| `goto(screen)` | 스크린 점프 |
| `startRun({seed?, planet?, tier?, anomaly?, maxSegments?})` | 런 시작 |
| `ff(ticks, {autopilot?})` | 헤드리스 fast-forward(결정론 오토파일럿). 탭 rAF 스로틀돼도 동작 |
| `setSpeed(1\|4\|16)`, `pause()`, `resume()`, `step(n)` | 배속·정지·틱 스텝 |
| `snapshot()` | 구조화 상태 JSON(아래 필드 표) |
| `events()` | 주요 이벤트 링버퍼 |
| `preset('fresh'\|'maxed')` | 하네스 프로필 프리셋 주입 |

## 3. 검증 워크플로 (복붙 예시)

**스크린 점프 후 화면 확인** — `goto` 뒤 `read_page`로 UI 트리 검증:

```js
__pb.harness.goto('inventory')
```

**시드 런 → fast-forward → 스냅샷:**

```js
__pb.harness.startRun({ seed: 12345, planet: 0, tier: 0 }); __pb.harness.ff(3600); JSON.stringify(__pb.harness.snapshot())
```

**보스 세그먼트까지 진행 후 보스 이벤트 단언:**

```js
__pb.harness.startRun({ seed: 777 }); __pb.harness.ff(20000); JSON.stringify(__pb.harness.events().filter(e => e.type === 'bossSpawn' || e.type === 'bossPhase'))
```

**결정론 체크(같은 시드 2회 → 같은 hash):**

```js
__pb.harness.startRun({ seed: 42 }); __pb.harness.ff(3600); const a = __pb.harness.snapshot().hash; __pb.harness.startRun({ seed: 42 }); __pb.harness.ff(3600); JSON.stringify({ a, b: __pb.harness.snapshot().hash, equal: a === __pb.harness.snapshot().hash })
```

`ff`가 존재하는 이유: 백그라운드 탭은 rAF가 스로틀돼 게임 루프가 멈추므로, 실시간 대기 대신 `ff`로 결정론 오토파일럿을 헤드리스 진행시킨다.

## 4. 결과 읽는 법

`snapshot()` 필드:
- `screen` 현재 스크린, `tick` 현재 틱, `hp` 플레이어 HP, `level` 런 내 레벨, `wave` 웨이브/세그먼트 상태, `boss` 보스 상태(없으면 null/undefined).
- `kills` 처치 수, `seed` 런 시드, `hash` 결정론 상태 해시(재현 비교 기준), `profileSummary` 하네스 프로필 요약.
- `tainted` — **오염 런** 플래그.

`events()` 링버퍼 이벤트 종류: `levelup`, `uniqueDrop`, `bossSpawn`, `bossPhase`, `playerDeath`, `victory`, `screenChange`.

**오염 런(tainted) 의미:** 상태 변조 치트(예: HP/장비 직접 주입, `preset`)가 한 번이라도 일어나면 런이 오염되어 `tainted: true`가 되고 **정산되지 않으며 리플레이도 제출되지 않는다**. 반면 `ff`/오토파일럿/배속·정지·스텝은 정상 입력 생성이라 **오염이 아니다**(시드+입력로그가 온전해 재현이 성립). 정산 동작을 검증할 땐 tainting 치트를 쓰지 말 것.

## 5. 주의사항

- **DEV 전용:** `import.meta.env.DEV`에서만 번들됨. 프로덕션 빌드엔 코드 자체가 없다 — 프로덕션에서 절대 기대하지 말 것.
- **하네스 프로필 격리:** `?harness=1`은 별도 localStorage 슬롯을 쓴다. 본 세이브 테스트와 하네스 프로필 테스트를 섞지 말 것(치트가 본 프로필에 섞이면 이후 재현·버그 리포트 신뢰가 깨진다).
- **rAF 스로틀:** 백그라운드 탭에서 실시간 진행이 멈추는 것은 정상. 진행은 항상 `ff`로.
- **`__pb.harness`가 없으면:** URL에 `?harness=1`이 빠졌거나 dev 빌드가 아님. `window.__pb`(하위 hook)만 있고 `.harness`가 없으면 하네스 미활성 상태다.
