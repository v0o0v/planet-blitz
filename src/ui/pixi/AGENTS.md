<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# ui/pixi — Pixi 메타 화면

## 목적

기지·격납고·성계 지도·관제탑 등 **모든 메타 화면의 현행 구현**(ADR-0014 DOM → Pixi 이관).
비주얼 언어는 두 세대가 겹쳐 있다 — 초기의 **카툰나무풍** 킷과, 2026-08 의 **AAA 시네마틱 전환**
(풀블리드 키아트 + 석재 크롬 + 패럴랙스)이다. 각 화면의 계약은 `.omc/plans/*-aaa-*.md` 에 있다.

## 주요 파일

### 화면

| 파일 | 설명 |
|---|---|
| `titleScreen.ts` | 타이틀 — 풀블리드 키아트 + 패럴랙스 + 3D 함선 |
| `introSlides.ts` | 세계관 인트로 4컷 |
| `baseMap.ts` · `baseBackdrop.ts` | 기지 허브 화면 + 배경(패럴랙스·공기·국소 톤매핑) |
| `hangar.ts` · `hangarBackdrop.ts` · `hangarChrome.ts` · `shipDock.ts` | 격납고(장비 관리) — 밀도가 높아 카드가 아니라 **창을 뚫는** 구성 |
| `planetSelect.ts` | (2141줄) 성계 지도 — 정규 PvE 출격구. 전장 정찰 창 포함 |
| `commissionDesk.ts` · `commissionDeskView.ts` | 지시 수신소 — **두 번째 PvE 출격구**(의뢰서). View 는 Pixi 미포함 순수 계층 |
| `controlTower.ts` | (2935줄) 관제탑 — 침공 사령 |
| `defenseCommand.ts` | (2762줄) 방어 사령부 — 침공 3레이어 배치 편집 |
| `championSelect.ts` · `shipLabels.ts` | 기체(챔피언) 선택 |
| `guardianRoster.ts` · `lineageHall.ts` | 예비역 수호기 로스터 / 계보 전당 |
| `researchLab.ts` · `refinery.ts` · `modulesView.ts` | 연구소(스킬) / 정제소(정련 공정) / 코어 모듈 |
| `catalystArchive.ts` · `catalystPicker.ts` · `catalystShopView.ts` · `catalystSortieModal.ts` | 촉매 보관함·상점·주입 픽커·실패 폴백 |
| `dailyRewardModal.ts` · `dailyRewardReveal.ts` | 일일 보상 팝업 / **개봉 연출 타임라인(순수)** |
| `recordsArchive.ts` · `storyUnlock.ts` · `loreLabels.ts` | 기록 보관소(서사 열람) · 사연 해금 판정 · 서사 문구 |
| `resultOverlay.ts` · `settingsPanel.ts` · `helpModal.ts` | 정산 / 설정 / 화면 도움말 |
| `googleSignInButton.ts` | Google 공식 로그인 버튼(브랜딩 가이드라인 준수) |

### 공용 부품

| 파일 | 설명 |
|---|---|
| `theme.ts` | 카툰 UI 공용 테마 상수 |
| `button.ts` · `card.ts` · `modal.ts` · `tabs.ts` · `tooltip.ts` · `listRow.ts` · `slotGrid.ts` · `scrollArea.ts` | 공용 부품 |
| `nineSlicePanel.ts` · `cinematicPanel.ts` · `cinematicTile.ts` · `cinematicChrome.ts` · `gutterRibs.ts` | 9-slice 나무 패널 / 시네마틱 석재 패널·타일·크롬·콜로네이드 |
| `scrim.ts` · `glowTexture.ts` · `tactile.ts` · `text.ts` | 하단 암막 / 방사형 발광 / 촉각 스프링 곡선 / 라벨 텍스트 정리 |
| `uiTextures.ts` · `baseTextures.ts` · `hangarTextures.ts` · `titleTextures.ts` · `introTextures.ts` | 자산 로더 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **44px 칸에 한글 이름은 안 들어간다.** 칩·라벨은 폭을 실측하고, 넘치면 줄이지 말고 배치를 바꾼다.
- **테두리 번쩍임의 원인은 서브픽셀 부유**다 — 좌표를 정수로 스냅한다.
- 스크롤 영역은 `scrollArea.ts` 를 쓴다. 자체 마스크를 새로 짜지 않는다.
- 화면 계약(`.omc/plans/*-aaa-*.md`)에 지표가 적혀 있지만, **지표를 달성해도 사용자가 화면을 보고
  뒤집은 이력**이 있다. 지표는 하한이지 목적이 아니다.
- 자산 배율을 확인한다(64px 원본을 280px 로 늘리면 그대로 뭉갠다).

### 테스트 요구사항

- `tests/*Layout.test.ts` 계열이 좌표·겹침 일부를 잡지만 **캔버스 스텁이라 진짜 겹침은 놓친다**.
- pane 이 비표시면 0프레임이라 아무것도 안 그려진다 — `ticker.update()` 로 손으로 돌린다.
- 최종 확인은 하네스로 실화면(`.claude/skills/harness/SKILL.md`).

### 공통 패턴

- **표시 판정은 `*View.ts` 로 분리**(Pixi 미포함, node 테스트 가능) → 화면 파일은 배선만.
- 텍스처 로더는 화면별로 분리하고, 로드 실패에도 화면이 뜨게 폴백한다.

## 의존성

### 내부

`src/ui/**`(순수 파생) · `src/save/**` · `src/net/**` · `src/i18n/**` · `assets/**`

### 외부

`pixi.js`

<!-- MANUAL: -->
