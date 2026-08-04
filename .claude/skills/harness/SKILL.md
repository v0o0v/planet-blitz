---
name: harness
description: Planet Blitz 하네스 게임 화면을 사용자 브라우저에 띄운다. 사용자가 치트 패널로 직접 플레이·테스트하는 것이 1차 용도. 하네스, harness, 하네스 띄워줘, 게임 띄워줘, 브라우저 검증, 런 자동 진행, 스크린 점프, autopilot 검증 요청 시 발동.
---

# Planet Blitz 하네스 실행

**하네스**는 dev 빌드 전용 게임 제어·테스트 도구다. 이 스킬의 1차 임무는 **dev 서버를 띄우고 사용자 기본 브라우저에 하네스 게임 화면을 열어주는 것** — 사용자가 치트 패널로 직접 게임을 돌려보며 테스트한다. `?harness=1`은 격리된 **하네스 프로필**만 읽고 쓰므로 **로컬** 본 세이브는 오염되지 않는다.

> ⚠️ **격리는 로컬에만 있다.** 서버 행은 uid 로만 갈리므로, 로그인한 하네스는 **그 계정의 서버
> 데이터를 진짜로 바꾼다**(`pushProfileToServer` 는 치트 상태를 가드 없이 밀어 넣는다).
> 로그인은 **전용 테스트 구글 계정으로만** 한다.

관련 문서: `docs/adr/0008-dev-harness-tainted-runs.md`, `CONTEXT.md`(개발 도구 섹션).

## 1차 용도: 사용자 브라우저에 게임 띄우기

> ⚠️ **포트가 떠 있다고 재사용하지 마라.** 이 리포는 워크트리가 수십 개고, 그 중 여럿이
> vite 를 띄운 채 방치돼 있다. 열린 포트에 그냥 붙으면 **남의 워크트리 코드를 자기 것인 줄
> 알고 검증하게 된다** — 실제로 그렇게 "고쳤는데 적용이 안 됐다"가 나왔다. 포트는 서버의
> 신원이 아니다.

1. **지금 워크트리를 서빙하는 포트가 있는지 확인한다.** 열린 vite 포트마다 아래를 돌린다.
   `200` 이면 이 워크트리, `403` 이면 **다른 워크트리**다(vite 의 `fs.allow` 가 자기 루트
   밖을 거부한다 — 포트·브랜치명보다 이 판정이 정확하다).
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://localhost:<포트>/@fs/<이 워크트리 절대경로>/src/main.ts"
   ```
   열린 포트 목록은 PowerShell 로:
   ```powershell
   Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 5170 -and $_.LocalPort -le 5200 } | Select-Object LocalPort
   ```

2. **`200` 이 없으면 새 포트로 띄운다**(있으면 그 포트를 그대로 쓴다). `.claude/launch.json` 에
   네 항목이 있다 — `planet-blitz-dev`(5180) / `-alt`(5185) / `-alt2`(5187) / `-alt3`(5189).
   **비어 있는 것을 고른다.** in-app Browser pane 의 `preview_start`(`name: "planet-blitz-dev-alt"` 등)
   또는 detached `npx vite --port <포트> --strictPort`.

3. **사용자 기본 브라우저로 열기** (PowerShell — 위에서 정한 포트로):
   ```powershell
   Start-Process "http://localhost:5185/?harness=1"
   ```

4. 사용자에게 안내: **백틱(\`) 키 또는 우하단 ⚙ 버튼**으로 치트 패널 토글.

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
- 상단 배지 2줄: **⚠ 오염 런**(치트 개입 시) / 정상 런 · 그리고 **접속 상태**(아래)

### 접속 배지 — 화면이 비었을 때 여기부터 읽어라

의뢰서·코어 모듈·침공·방어 사령부는 **서버 권위**라 로그인 없이는 전부 빈 채로 잠긴다.
화면상으로는 셋이 똑같이 "빈 목록"이라, 두 번째 배지가 원인을 대신 말해 준다.

| 배지 | 뜻 | 할 일 |
|---|---|---|
| `오프라인 — .env.local 없음` | 워크트리에 Supabase 설정이 없다 | 주 워크트리에서 `.env.local` 복사(새 워크트리는 post-checkout 훅이 자동으로 한다) |
| `미로그인 — ⚙ 설정에서 로그인` | 설정은 있는데 세션이 없다 | ⚙ 설정 팝업에서 **테스트 계정**으로 로그인 |
| `온라인 · <이메일>` | 서버 화면이 전부 살아 있다 | — |
| `⚠ 모의가 가림: …` | 모의 게이트웨이가 **실서버보다 먼저** 검사돼 가리고 있다 | 해당 토글을 끈다 |

- **로그인은 하네스에서도 된다.** `?harness=1` 은 로그인 게이트를 우회할 뿐 막지 않는다.
  OAuth 복귀 주소에 `harness=1` 이 되붙으므로 왕복 후에도 하네스·격리가 유지된다.
- 왕복이 `redirect_to is not allowed` 로 튕기면 Supabase Redirect URLs 에 그 포트가 없는 것이다.
- **하네스 침공은 NPC 시드 기지만 대상으로 잡는다** — 실유저 기지를 실제로 깎지 않기 위해서다.
  래더 대상이 0건으로 보이는 것이 정상일 수 있다(NPC 는 래더 하위에 있다).

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
- **하네스 프로필 격리는 로컬 전용**: 본 세이브 테스트와 섞지 말 것. 서버측은 uid 로만 갈리므로
  로그인은 전용 테스트 계정으로만 한다(위 경고 참조).
- **포트 재사용 금지**: 열린 vite 포트가 이 워크트리 것이라는 보장이 없다. `@fs` 판정을 먼저 하라.
- **`__pb.harness`가 없으면**: `?harness=1` 누락이거나 dev 빌드가 아님(단, DEV에선 파라미터 없어도 API는 노출되고 프로필 격리만 비활성).
