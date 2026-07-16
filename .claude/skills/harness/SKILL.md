---
name: harness
description: Planet Blitz 하네스 게임 화면을 사용자 브라우저에 띄운다. 사용자가 치트 패널로 직접 플레이·테스트하는 것이 1차 용도. 하네스, harness, 하네스 띄워줘, 게임 띄워줘, 브라우저 검증, 런 자동 진행, 스크린 점프, autopilot 검증 요청 시 발동.
---

# Planet Blitz 하네스 실행

**하네스**는 dev 빌드 전용 게임 제어·테스트 도구다. 이 스킬의 1차 임무는 **dev 서버를 띄우고 사용자 기본 브라우저에 하네스 게임 화면을 열어주는 것** — 사용자가 치트 패널로 직접 게임을 돌려보며 테스트한다. `?harness=1`은 격리된 **하네스 프로필**만 읽고 쓰므로 본 세이브는 절대 오염되지 않는다.

관련 문서: `docs/adr/0008-dev-harness-tainted-runs.md`, `CONTEXT.md`(개발 도구 섹션).

## 1차 용도: 사용자 브라우저에 게임 띄우기

1. **dev 서버 확인/기동** (vite, **포트 5180** — 5173 아님):
   - 이미 5180이 떠 있으면 재사용. 없으면 in-app Browser pane의 `preview_start`(`name: "planet-blitz-dev"`, `.claude/launch.json` 등록됨) 또는 detached `npm run dev`로 기동.
2. **사용자 기본 브라우저로 열기** (PowerShell):
   ```powershell
   Start-Process "http://localhost:5180/?harness=1"
   ```
3. 사용자에게 안내: **백틱(\`) 키 또는 우하단 ⚙ 버튼**으로 치트 패널 토글.

URL 파라미터(조합 가능):
- `?harness=1` — 하네스 활성 + 하네스 프로필 슬롯(필수)
- `&seed=<n>` — 런 시드 고정(결정론 재현)
- `&screen=<title|base|starMap|inventory|research|refinery>` — 초기 스크린 딥링크

### 치트 패널 기능(사용자 조작)

- **재생 제어**: 배속 1×/4×/16×, 일시정지/재개, 틱 스텝(+1/+10/+60), ff(틱 수 + 오토파일럿 토글)
- **점프**: 스크린 6종, 시드 런 런처(seed/planet/tier/변칙), 세그먼트+1·보스 점프
- **치트**: 무적, 풀 힐, 레벨업 +1, 크레딧/광물 지급, 장비 지급(슬롯·희귀도), 프리셋 fresh/maxed
- **스폰 제어**: 적탄 소거, 적 전멸, 정예 승격, 보스 소환
- **인스펙터**: 스냅샷·최근 이벤트·엔티티 목록 라이브 갱신
- 상단 배지: **⚠ 오염 런**(치트 개입 시) / 정상 런

## 2차 용도: 에이전트 자동 검증 (`window.__pb.harness`)

Claude가 코드 변경을 검증할 땐 in-app Browser pane에서 `javascript_tool`로 API를 호출한다. 백그라운드 탭은 rAF 스로틀로 실시간 진행이 멈추므로 **진행은 항상 `ff`**(헤드리스 스텝, 리플레이 유효).

| 호출 | 설명 |
|---|---|
| `goto(screen)` | 스크린 점프 |
| `startRun({seed?, planet?, tier?, anomaly?, maxSegments?})` | 런 시작 |
| `ff(ticks, {autopilot?})` | 헤드리스 fast-forward(결정론 오토파일럿) |
| `setSpeed(1\|4\|16)`, `pause()`, `resume()`, `step(n)` | 배속·정지·틱 스텝 |
| `snapshot()` | 구조화 상태 JSON |
| `events()` | 이벤트 링버퍼 |
| `preset('fresh'\|'maxed')` | 하네스 프로필 프리셋 |

예시 — 시드 런 → ff → 스냅샷:

```js
__pb.harness.startRun({ seed: 12345, planet: 0, tier: 0 }); __pb.harness.ff(3600); JSON.stringify(__pb.harness.snapshot())
```

예시 — 결정론 체크(같은 시드 2회 → 같은 hash):

```js
__pb.harness.startRun({ seed: 42 }); __pb.harness.ff(3600); const a = __pb.harness.snapshot().hash; __pb.harness.startRun({ seed: 42 }); __pb.harness.ff(3600); JSON.stringify({ a, b: __pb.harness.snapshot().hash, equal: a === __pb.harness.snapshot().hash })
```

`snapshot()` 필드: `screen`, `tick`, `hp`, `level`, `wave`, `boss`(없으면 null), `kills`, `seed`, `hash`(결정론 비교 기준), `profileSummary`, `tainted`.
`events()` 종류: `levelup`, `uniqueDrop`, `bossSpawn`, `bossPhase`, `playerDeath`, `victory`, `screenChange`.

## 주의사항

- **오염 런(tainted)**: 상태 변조 치트(HP/장비 주입, 라이브 런 중 `preset`, 점프류)가 한 번이라도 일어나면 `tainted: true` — 정산·리플레이 제출 제외. `ff`/오토파일럿/배속·정지·스텝은 정상 입력 생성이라 **비오염**. 정산 동작 검증 시 tainting 치트 금지.
- **DEV 전용**: 프로덕션 빌드엔 하네스 코드 자체가 없다.
- **하네스 프로필 격리**: 본 세이브 테스트와 섞지 말 것.
- **`__pb.harness`가 없으면**: `?harness=1` 누락이거나 dev 빌드가 아님(단, DEV에선 파라미터 없어도 API는 노출되고 프로필 격리만 비활성).
