# "카툰나무풍" UI 세트 확산 롤아웃

2026-07-19 격납고 파일럿 통과(사용자 플레이 판정 승인, PR #62~#65). 남은 메타 화면을
한 세션에 하나씩 카툰나무풍으로 이관한다. 각 세션은 **pixellab-forge `cartoon-wood-ui`
스킬("카툰나무풍")을 먼저 발동**해 킷 자산·9-slice 파라미터·함정 체크리스트를 따른다.

## 공통 규칙 (모든 화면 세션)

1. 공용 모듈 `src/ui/pixi/` (nineSlicePanel·PixiButton·slotGrid·PixiTooltip·titleBar) 재사용 — 새 부품이 필요할 때만 추가하고 공용으로 설계.
2. 기존 DOM 클래스는 삭제하지 않고 유지(회귀 대비), 공개 인터페이스(show/hide/visible) 동일하게 맞춰 main.ts 호출부 무변경 교체.
3. 목업 승인 게이트: 실 자산 합성 1920×1080 목업 → 로컬 http 서버 → 사용자 브라우저 승인 후 구현. **실화면을 바로 띄워 승인받는 편이 더 강한 게이트라, 사용자가 "UI 입히고 화면 보여줘"라고 하면 목업 단계를 건너뛰고 구현 → 실화면 승인으로 간다**(#1·#2 에서 이렇게 진행).
4. **패널 콘텐츠는 반드시 `panelContent(w,h)` 상자 안에만 배치**(프레임 46 + 여백 14 = 60px). 프레임 오프셋을 화면마다 재유도하지 않는다 — 제목이 테두리에 붙는 결함이 2회 재발해 규칙을 코드로 강제했다(`src/ui/pixi/nineSlicePanel.ts`, 세트 정본 SKILL.md §4).
5. 완료 전 스킬의 "목업-구현 정합 체크리스트" 8항목 수행(1920×1080 스크린샷 대조 · 프레임 침범 0 · **테두리에 붙은 콘텐츠 0(모서리 확대 크롭)** · 반토막 0 · dpr>1 리사이즈 · DOM 겹침 · Text resolution 2 · 사용자 플레이 판정).
6. 새 캔버스 화면은 `main.ts` `clearToMenu()` 에 `hide()` 를 추가한다 — DOM 오버레이와 달리 다음 화면이 덮어주지 않는다.
7. 브랜치 `feat/cartoonwood-<화면>` → PR → 머지. 병렬 세션이면 워크트리 분리.

## 화면 순서 (한 세션 = 한 화면)

| # | 화면 | 파일 | 상태 | 메모 |
|---|---|---|---|---|
| 1 | 기지 맵 (BaseMap) | `src/ui/pixi/baseMap.ts` | **완료** (PR #67, 2026-07-19) | 건물 5종 3+2 나무 패널 타일. ADR 은 미작성 — 아래 "남은 문서 작업" 참조. |
| 2 | 연구소 (ResearchLab) | `src/ui/pixi/researchLab.ts` | **완료** (2026-07-19) | 계열 3패널 + 파생 스탯 패널. 노드는 칩 9-slice 카드 2열 10행, 설명은 hover 툴팁(카드에 넣으면 한 화면에 안 들어감). 캡스톤은 해금 시 노란 버튼 / 잠금 시 나무 버튼. |
| 3 | 정제소 (Refinery) | `src/ui/refinery.ts` | **다음** | 재화 변환 UI — 칩·버튼 중심이라 이관 난도 낮음. |
| 4 | 행성 선택 (PlanetSelect) | `src/ui/planetSelect.ts` | 출격 전 화면. 행성 카드 패널화. |
| 5 | 정산 (ResultOverlay) | `src/ui/resultOverlay.ts` | 런 종료 보상 — 슬롯 그리드·등급색 재사용. |
| 6 | 관제탑 (ControlTower) | `src/ui/controlTower.ts` | 침공 결과 뷰 포함 — 표 형태 콘텐츠 많음. |
| 7 | 카드 상점 (CardsView) | `src/ui/cardsView.ts` | 서버 권위 구매 경로 주의(CORS/거부 코드 매핑 기존 작업 참조). |
| 8 | 설정 (SettingsPanel) | `src/ui/settingsPanel.ts` | 소형 — 마지막. |

- **보류**: DefenseCommand(방어 사령부)는 실화면 편집 대공사(PR #57~59) 직후라 안정화 기간을 두고 마지막에 별도 판단.
- 인런 오버레이(HUD·파워업·튜토리얼)는 이번 롤아웃 범위 밖(게임플레이 가독성 언어 별도 검토 필요).

## 남은 문서 작업

- ADR "메타 UI DOM→Pixi 이관"(plan hangar-cartoon-ui-pilot §6) 미작성. 화면 3~4개를 더 이관해
  패턴이 굳은 뒤 한 번에 쓰는 편이 낫다 — 정제소(#3) 완료 시점에 작성 판단.

## 진행 중 배운 것 (다음 세션이 반복하지 말 것)

- **패널 제목이 테두리에 붙는 결함이 2회 재발**했다(격납고 파일럿, 연구소). `border`(46) 침범만
  피하는 계산으로는 안 잡힌다 → `panelContent()` 상자로 강제. 검증 시 **패널 모서리를 확대 크롭**해
  확인한다(1920×1080 전체 스크린샷으로는 놓친다).
- 노란 버튼(`ui_btn_yellow`)에 기본 흰 라벨은 묻힌다 → `PixiButton` `labelColor: COLOR.darkLabel`.
  라벨 색을 지정하면 다크 드롭섀도는 자동으로 꺼진다(획 촘촘한 한글이 그림자와 뭉침).
- 하네스로 캔버스 클릭을 검증할 때는 **pointermove → down → up 순서 + 클릭 사이 rAF 한 프레임**을
  넣어야 한다. render() 가 매 클릭마다 표시 객체를 새로 만들어서, 프레임을 안 넘기면 첫 클릭만 먹는다.
- `mcp__Claude_Browser__computer` 스크린샷은 이 프로젝트에서 타임아웃한다 →
  chrome-devtools MCP(`new_page` + `take_screenshot filePath`)로 찍고 Read 로 본다.

## 좌표

- 파일럿 산출물: `src/ui/pixi/` + `assets/ui_*.png` (앵커 `pb-cartoon-wood-ui`)
- 세트 정본: pixellab-forge `skills/cartoon-wood-ui/SKILL.md` (v0.2.2+) · README "UI 세트 레지스트리"
- 파일럿 계획·교훈: `.omc/plans/hangar-cartoon-ui-pilot.md`, `.omc/handoffs/hangar-cartoon-ui.md`
