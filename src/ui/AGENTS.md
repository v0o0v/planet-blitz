<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# ui — HUD·메타 화면

## 목적

런 중 HUD 와 메타 화면(기지·인벤·성계 지도 등)의 로직. **두 세대가 공존한다** — 초기 DOM 오버레이와,
ADR-0014 로 이관된 Pixi 판(`pixi/`)이다. 실사용 화면 대부분은 Pixi 쪽이고 DOM 판 일부는 레거시다
(예: `planetSelect.ts` 는 레거시, 실사용은 `pixi/planetSelect.ts`).

이 디렉터리의 루트 파일 상당수는 **Pixi·DOM 을 모르는 순수 파생 함수**다 — 그래서 node vitest 로
잠글 수 있다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `hud.ts` | (1037줄) 런 중 HUD 오버레이 |
| `runFlow.ts` | 런 종료 → 정산 진입 게이트(순수). `settled` 플래그로 재진입 레이스를 막는다 |
| `runObjective.ts` | 런 중 **목표·주의 2줄** 파생(순수) |
| `invasionProgress.ts` · `bossLabels.ts` · `enemyLabels.ts` | 침공 진행 HUD 파생 / 보스 표시명 / **행성 로스터 표시 정본**(전장 정찰 패널이 읽는다) |
| `itemNames.ts` · `affixText.ts` · `itemCompare.ts` · `dropTip.ts` | 장비 표시 이름 단일 정본 / 어픽스 문자열 / 장착품 비교 / 정산 hover 상세 |
| `equipIcons.ts` · `powerupIcons.ts` · `uiIcons.ts` | 아이콘 매핑(ADR-0015 **인스턴스가 아니라 속성 축**) 과 공용 픽셀아트 아이콘 |
| `buildStatus.ts` · `powerupOverlay.ts` | 레벨업 3택 보조 로직(순수) / DOM 오버레이 |
| `catalystLabels.ts` · `modulesView.ts` | 촉매 효과 라벨 / 코어 모듈 표시 헬퍼(순수) |
| `encounterOverlay.ts` | 조우 프롬프트 — 조우 프레임워크의 **입력 배선 절반** |
| `controlTower.ts` | (1170줄) 관제탑 로직(화면은 `pixi/controlTower.ts`) |
| `replaySpectate.ts` · `stickerPicker.ts` | 침공 리플레이 관전 / 도발 스티커 선택 |
| `inventory.ts` · `researchLab.ts` · `resultOverlay.ts` · `settingsPanel.ts` · `baseMap.ts` · `tutorial.ts` · `planetSelect.ts` | DOM 세대 화면들(일부는 Pixi 판으로 대체됨) |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `pixi/` | Pixi 메타 화면 전체(현행 세대) (`pixi/AGENTS.md`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **문구는 `src/i18n/catalog.ts` 를 거친다.** 용어 정본표가 `KO` 선언부 주석에 있으니 문구를
  쓰기 전에 거기부터 본다. `CONTEXT.md` 의 금지어를 피한다.
- **레이어 표시는 진입 경로가 아니라 화면 이름이 단일 권위**다 — 경로로 처방했다가 재신고를 받은
  이력이 있다.
- 새 로직은 Pixi 를 import 하지 않는 순수 파생 함수로 뽑고, 화면 파일은 배선만 한다.
- DOM 판을 고치기 전에 그 화면이 아직 쓰이는지 확인한다(대부분 Pixi 판이 실사용).

### 테스트 요구사항

순수 파생은 짝 테스트로 잠근다(`tests/runObjective.test.ts` · `itemCompareNames.test.ts` · `dropTip.test.ts` 등).
**레이아웃 겹침은 테스트가 못 잡는다** — 실화면에서 확인한다.

### 공통 패턴

- "표시 판정"과 "그리기"의 분리. `*View.ts` 관용구(`pixi/catalystShopView.ts`·
  `pixi/commissionDeskView.ts`)를 따른다.

## 의존성

### 내부

`src/sim/snapshot.ts` · `src/save/**` · `src/items/**` · `src/i18n/**` · `data/**`

### 외부

`pixi.js`(Pixi 세대만)

<!-- MANUAL: -->
