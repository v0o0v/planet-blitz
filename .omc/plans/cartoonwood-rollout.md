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
| 3 | 정제소 (Refinery) | `src/ui/pixi/refinery.ts` | **완료** (2026-07-20) | 장비 6열 슬롯 그리드 + 어픽스 칩 행(잠금 토글 아이콘). 배너 제목은 사용자 지시로 "정제소"만(`refine.title` 에서 "— 어픽스 리롤" 제거). 컬러 이모지(🎰)는 Pixi 에서 두부로 떨어져 `stripEmoji` 로 제거. |
| 4 | 행성 선택 (PlanetSelect) | `src/ui/pixi/planetSelect.ts` | **완료** (2026-07-20) | 행성 카드 4장 + 티어 패널 + 변칙 패널(시드 제안 시만) + 출격/기지로/장비 정비. 카드 골격은 기지 맵 타일과 겹쳐 `card.ts`(`makePanelCard`·`panelDim`)로 승격하고 기지 맵도 그 부품으로 옮겼다. `stripEmoji` 는 `text.ts` 로 공용화(▶ ◀ 는 보존 — 둘 다 Extended_Pictographic 이라 정제소판 정규식이면 지워졌다). |
| 5 | 정산 (ResultOverlay) | `src/ui/resultOverlay.ts` | **다음** | 런 종료 보상 — 슬롯 그리드·등급색 재사용. |
| 6 | 관제탑 (ControlTower) | `src/ui/controlTower.ts` | 침공 결과 뷰 포함 — 표 형태 콘텐츠 많음. |
| 7 | 카드 상점 (CardsView) | `src/ui/cardsView.ts` | 서버 권위 구매 경로 주의(CORS/거부 코드 매핑 기존 작업 참조). |
| 8 | 설정 (SettingsPanel) | `src/ui/settingsPanel.ts` | 소형 — 마지막. |

- **보류**: DefenseCommand(방어 사령부)는 실화면 편집 대공사(PR #57~59) 직후라 안정화 기간을 두고 마지막에 별도 판단.
- 인런 오버레이(HUD·파워업·튜토리얼)는 이번 롤아웃 범위 밖(게임플레이 가독성 언어 별도 검토 필요).

## 남은 문서 작업

- ADR "메타 UI DOM→Pixi 이관" **작성 완료** → `docs/adr/0014-meta-ui-dom-to-pixi.md`(2026-07-20,
  행성 선택 #4 와 같은 PR). 레이어 분리 · DOM 클래스 존치와 제거 조건 · 공용 부품 경계(둘 이상
  소비자일 때 승격) · `panelContent()` 로 여백을 코드 강제한 이유 · 검증 절차를 담았다.

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
- **i18n 문자열의 컬러 이모지는 Pixi 캔버스에서 흑백 두부 글리프로 떨어진다**(DOM 에서는
  OS 컬러 이모지로 예쁘게 떴던 것). 정제소 리롤 버튼의 🎰 가 그랬다 → `stripEmoji()` 로
  라벨에서 걷어낸다(카탈로그는 DOM 판과 공유하므로 건드리지 않는다). ⟳ 같은 기호 문자
  (Extended_Pictographic 아님)는 정상 렌더되므로 남긴다.
- **패널 모서리 확대 크롭 방법**: 캔버스에 CSS `transform: scale()` 을 걸면 이 환경에서
  좌표가 어긋난다. `position:fixed` + `width/height` ×N + 음수 `left/top` 으로 키우는
  편이 정확하다. 배율 환산은 `fitToWindow` 와 같은 식(`min(w/1920,h/1080)`, ≥1 이면 floor).
- **`▶`·`◀` 도 `Extended_Pictographic` 이다**(U+25B6/U+25C0). 정제소(#3)가 쓰던
  `stripEmoji`(모든 Extended_Pictographic 제거)를 그대로 성계 지도에 쓰면 "▶ 출격"의 삼각형이
  사라진다. 이 기호들은 폰트 폴백이 흑백 글리프를 제대로 갖고 있어 두부가 되지 않으므로
  **보존 목록**이 필요하다 → 공용 `src/ui/pixi/text.ts` 의 `KEEP` 집합.
- **chrome-devtools MCP 가 다른 세션에 점유**되면(`browser is already running for …chrome-profile`)
  스크린샷 경로가 통째로 막힌다. 대안: `chrome.exe --headless=new --remote-debugging-port=9333`
  로 별도 프로필 브라우저를 띄우고 CDP(`Page.navigate`/`Runtime.evaluate`/`Page.captureScreenshot`)를
  Node 내장 `WebSocket` 으로 직접 두드린다(러너: 세션 scratchpad `shot.mjs`). `chrome --screenshot`
  one-shot 은 캔버스가 비어 찍히니 쓰지 말 것.
- **모서리 확대 크롭은 CDP `Page.captureScreenshot` 의 `clip`(x,y,w,h,scale)이 정답**이다 —
  CSS 로 캔버스를 키우는 방법(이전 세션의 `position:fixed` + 음수 offset)보다 정확하고 부수효과가 없다.
- 캔버스 클릭 검증은 **좌표 대신 표시 객체를 찾아** 누르는 편이 안정적이다(레이아웃 상수가 바뀌어도
  안 깨진다): stage 를 순회해 라벨 `Text` 를 찾고 `getBounds()` 중심을 client 좌표로 환산해 dispatch.
  단 `t.visible` 은 **자기 자신만** 보므로 숨은 화면의 텍스트도 잡힌다 — 화면 잔상 판정에는 쓸 수 없다.
- 성계 지도의 변칙 제안은 **시드가 정한다**. 제안이 뜬 화면을 검증하려면 `__pb.openStarMap()` 을
  제안이 나올 때까지 반복 호출한다(페이지를 다시 띄우는 것보다 빠르다).
- 하네스에 리롤용 장비를 채울 때는 치트 패널 **메뉴 → 장비 지급**을 슬롯별로 반복한다
  (같은 슬롯에 또 지급하면 기존 장착분이 인벤토리로 밀려나 쌓인다). `preset('maxed')` 는
  재화만 주고 인벤토리는 비어 있다.

## 좌표

- 파일럿 산출물: `src/ui/pixi/` + `assets/ui_*.png` (앵커 `pb-cartoon-wood-ui`)
- 세트 정본: pixellab-forge `skills/cartoon-wood-ui/SKILL.md` (v0.2.2+) · README "UI 세트 레지스트리"
- 파일럿 계획·교훈: `.omc/plans/hangar-cartoon-ui-pilot.md`, `.omc/handoffs/hangar-cartoon-ui.md`
