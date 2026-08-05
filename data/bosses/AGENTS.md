<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# data/bosses — 보스 정의

## 목적

**행성 보스**(시설 관리자 — 각 행성 런의 종점)와 **의뢰 보스**(어느 행성에도 상주하지 않고 의뢰
경로에서만 만난다)의 패턴·페이즈 정의.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `berdan-queen.ts` | 베르단 — 군체 여왕 |
| `niflheim-flagship.ts` | 니플헤임 — 유령 함대 기함 |
| `arke-obelisk.ts` | 아르케 — 고대 수호자 오벨리스크 |
| `toxar-blight.ts` | 톡사르 — 부패의 모체 |
| `kras-colossus.ts` | 크라스 — 공성 거병 콜로서스 |
| `commission-chain`(`commission-salvage-maw.ts`) | 잔해 포식자 — **연쇄 원정** 전용. 여러 모드를 거쳐 온 누적 손상을 정체성으로 삼는다 |
| `commission-elite`(`commission-warlord-crown.ts`) | 정예 군주 — **정예 소집령** 전용. 파워업 0 을 묻는다 |
| `commission-bounty`(`commission-runner-wraith.ts`) | 도주자 — **현상금 표적** 전용. 도주가 정체성 |

카르곤 보스(용암 요새 전차)는 M1 원형이라 `data/boss.ts` 에 있다.

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- 의뢰 보스의 **카탈로그 단일 정본은 `data/commissionBosses.ts`** 다 — 여기 파일을 추가하면 거기에 등록한다.
- 각 의뢰 보스는 **자기 주문의 규칙을 정면으로 묻도록** 저작한다(위 표의 "정체성" 열).
- **과열 창**(패턴 시전 직후 5초 피해 2배)은 보스 공통 문법이다.
- 3D 연출은 자산이 아니라 `src/render/three3d/bossActor.ts` 의 페이즈별 연출로 만든다.
  모델은 `assets/models/boss_*.glb`.
- 보스 등장은 **예고 루프**(`src/render/bossWarn.ts`)로 알린다 — 등장음 한 방이 아니다.

### 테스트 요구사항

`tests/bossProgress.test.ts` · `tests/bossWarn.test.ts` · `tests/bossLabels.test.ts` ·
`tests/commissionBossRender.test.ts`.
보스 처치가 런 완주 조건이므로 `tests/fullRun.test.ts`(sim 레인)도 본다.

### 공통 패턴

- 페이즈 배열 + 패턴 컴포넌트 조합. 새 거동이 필요하면 `src/sim/patterns/` 에 컴포넌트를 넣는다.

## 의존성

### 내부

`src/sim/boss.ts` · `src/sim/patterns/**` · `data/commissionBosses.ts` · `assets/models/**`

### 외부

없음.

<!-- MANUAL: -->
