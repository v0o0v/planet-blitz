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
| 5 | 정산 (ResultOverlay) | `src/ui/pixi/resultOverlay.ts` | **완료** (2026-07-20) | 승/패 배너 + 기록 패널(7행) + 전리품 패널(2열 × 3행 + 획득 장비 슬롯 그리드 8열·hover 툴팁). 다른 메타 화면과 달리 배경은 **반투명 암막**(런 직후라 얼어붙은 아레나가 비친다 — DOM 판과 동일). `makeBanner` 에 `titleColor` 추가(승리 골드/패배 살구 — 배너가 결과를 말한다), `makeSlotCell` 의 아이템 타입을 `SlotCellItem`(등급+슬롯)로 넓혀 표시 전용 `ResultDrop` 을 그대로 얹었다. 실화면 판정에서 사용자 지시 2건: **기록에서 시드 행 제거**(Pixi 판만 — DOM 판은 롤백 대비로 유지), **승리 제목의 느낌표 제거**(`result.win.title`, en/ko 공통 → i18n 테스트 기대값도 갱신). |
| 6 | 관제탑 (ControlTower) | `src/ui/pixi/controlTower.ts` | **완료** (2026-07-20) | 앞선 다섯 화면과 골격이 다르다 — **열 보드 + 팝업**이다. 실화면 판정에서 사용자가 구조를 다시 잡았다: 보드에는 **지금 행동할 것**만(침공 대상 제안 · 기지 정찰 · 복수전(24h 창 있을 때만 3열)), **훑어보는 것은 팝업**으로 뺐다 — 순위표(하단 좌), 전투 기록(하단 우), 침공 알림(우상단, 내용 있을 때만). 위에는 높이를 재서 자라는 상태 패널(결과 배너·검증 중·배치전 진행바·상대 카드 정찰 공개). 순위표 팝업 = 내 순위 고정 + 이름 검색 + 페이징, 전투 기록 팝업 = 공/수 필터 · 최신/오래된순 · 검색 · 페이징 · 행별 관전. 제목은 "관제탑"만, 부제 뒷문장·하단 안내문 삭제(사용자 지시). `hexColor` 를 `theme.ts` 로 승격(성계 지도와 공유 — 소비자 2곳). |
| 7 | 카드 상점 (CardsView) | `src/ui/pixi/cardsView.ts` | **완료** (2026-07-20) | 앞선 화면과 달리 **DOM 판이 독립 화면이 아니었다** — `src/ui/cardsView.ts` 는 순수 표시 헬퍼뿐이고 실제 UI 는 방어 사령부(보류 화면) 우측의 접이식 섹션이었다. 사용자 판정으로 **방어 사령부에서 진입하는 독립 캔버스 화면**으로 뺐고(기지 맵 타일 추가 없음), 방어 사령부에는 **장착 슬롯 요약 + "카드 관리 열기" 버튼**만 남겼다(보관함·상점·합성 DOM 은 제거, 슬롯·장착/해제는 존치). 3열 보드 = 카드 슬롯 · 보관함(게이지·합성 바·행 스크롤) · 일일 상점. 구매 거부 코드 매핑(`buyErrorText`)·상점 슬롯 중복 차단·20장 상한·잔여 1회 경고는 DOM 판 순수 함수를 그대로 import 해 재사용. |
| 8 | 설정 (SettingsPanel) | `src/ui/pixi/settingsPanel.ts` | **완료** (2026-07-20) | 화면이 아니라 **크롬 UI** 다 — `clearToMenu()` 에 없고 런 중에도 떠 있다. 사용자 판정으로 톱니까지 전부 Pixi(z 순서는 렌더 루프의 `settings.raise()` 로 매 프레임 되돌린다), 볼륨은 **Pixi 드래그 핸들 직접 구현**(트랙 클릭 점프 + `pointerdown`→`globalpointermove`→`window pointerup`), 팝업은 좌상단 톱니 아래(암막 없음 — 투명 catcher 로 바깥 클릭 닫기 + ESC). 사운드 행 라벨은 미사용이던 `settings.sound` 를 써서 "사운드: 켜짐/꺼짐"으로(DOM 판의 "음소거: 켜짐"은 어느 쪽이 켜진 건지 헷갈렸다). |
| — | 타이틀 (TitleScreen) | `src/ui/pixi/titleScreen.ts` | **완료** (2026-07-20, #8 과 같은 PR) | 롤아웃 표에 없던 화면. 설정이 캔버스로 들어가자 **불투명 DOM 타이틀이 톱니를 통째로 덮어** 첫 실행 언어 전환이 막혔다 → 사용자 판정으로 함께 이관. 로고·부제·시작 버튼·(첫 실행) 안내 한 줄뿐이라 소형. |

- **보류**: DefenseCommand(방어 사령부)는 실화면 편집 대공사(PR #57~59) 직후라 안정화 기간을 두고 마지막에 별도 판단.
  **설정 이관 후 추가된 사유**: 아직 DOM 이라 캔버스 안 설정 톱니를 덮는다(좌측 패널이 좌상단을 가린다) — 이관되면 해소된다.
- 인런 오버레이(HUD·파워업·튜토리얼)는 이번 롤아웃 범위 밖(게임플레이 가독성 언어 별도 검토 필요).
  파워업·스티커 모달도 설정 톱니를 덮지만, 둘 다 **즉시 결정하는 모달**이라 그 순간 설정을 열 이유가 없어 그대로 둔다.

## 다음 단계 — DOM 클래스 일괄 삭제 (ADR-0014 제거 조건)

8화면이 전부 이관되고 사용자 플레이 판정을 통과했다(2026-07-20). ADR-0014 의 제거 조건 중
남은 것은 **한 마일스톤 동안 롤백 없이 지나가는 관찰 기간**이다. 그 기간이 지나면:

1. 미참조 DOM 화면 클래스를 일괄 삭제한다 — `src/ui/{baseMap,researchLab,refinery,planetSelect,resultOverlay,controlTower,cardsView,settingsPanel}.ts` 와 `src/ui/tutorial.ts` 의 `TitleScreen`(같은 파일의 `TutorialOverlay`·`FtueTracker` 는 **인런 UI 라 남긴다**).
2. 타입·순수 함수는 DOM 파일이 아닌 적절한 위치로 옮겨 남긴다 — `LaunchSelection`(planetSelect), `BaseMapCallbacks`(baseMap), `ControlTowerShowOpts`·`InvasionResultView`(controlTower), 카드 구매 거부 매핑 등 Pixi 판이 import 해 쓰는 것들.
3. DefenseCommand 는 아직 유일한 DOM 화면이므로 **삭제 대상이 아니다**.

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
- **정산(#5)은 "런이 끝나도 `world` 가 살아 있는" 유일한 화면**이다. 그래서 다른 캔버스 화면에는
  없는 문제가 둘 있다. ① DEV 텔레메트리 줄(`index.html` 의 `#hud` — seed/tick/hash/FPS)이 매
  프레임 갱신되며 캔버스 위로 그려진다(DOM 판에서는 z-index 30 오버레이가 덮어 줬다) → `#pb-hud`
  와 함께 숨긴다. ② 배경을 불투명하게 덮으면 방금 끝난 전장이 사라진다 → 세트 배경색 대신
  **반투명 암막**(0x05060f α0.9)을 깐다.
- **하네스로 정산 화면을 띄우는 법**(딥링크 없음): `goto('menu')` → `preset('maxed')` →
  `startRun({planet,tier,anomaly})` → `ff(1800,{autopilot:true})` 를 종료까지 반복 → rAF 몇 프레임.
  **`preset` 은 런이 없을 때 호출하면 오염 표시가 안 붙는다**(`markTaintedIfLive` 가 no-op) —
  런 시작 **전에** 걸어야 정산 블록이 나온다. 맨몸(`fresh`)은 autopilot 이 12초 만에 죽고
  드랍이 0이라 전리품 레이아웃을 못 본다. 드랍을 20개 이상 만들어 보려면 실런 대신
  `__pb.resultOverlay.show(합성 ResultState, ()=>{}, ()=>{})` 로 뷰만 직접 띄운다.
- **모서리 확대 크롭은 Pixi stage 를 직접 확대**해도 된다(chrome-devtools MCP 는 CDP `clip` 을
  못 넘긴다): `stage.scale.set(k); stage.position.set(-x0*k, -y0*k)` 로 디자인 좌표 (x0,y0)를
  화면 원점에 붙인 뒤 스크린샷, 끝나면 원래 값 복원. 스크린샷 전용이라 좌표계가 깨져도 무해하다.
- **행 위에 얹힌 텍스트가 클릭을 삼킨다**(관제탑 #6 실측 결함). Pixi 는 위에 있는 자식부터
  히트 테스트하고, 맞은 객체가 비상호작용이면 **형제로 내려가지 않고 상호작용 조상까지 올라간다**
  → 목록 행의 바탕 Graphics 에만 `pointertap` 을 걸면 이름·값 텍스트 위를 누를 때 먹지 않는다
  (여백을 눌러야만 선택된다). **행 Container 자체를 static 으로** 만들고, 행 안의 버튼처럼
  다른 동작을 하는 자식은 `e.stopPropagation()` 으로 끊는다. 비활성 버튼은 eventMode 'none'
  이라 그 리스너도 죽고 클릭이 행 선택으로 자연스럽게 넘어간다.
- **내용에 맞춰 자라는 패널의 아래 여백은 위와 대칭이어야 한다.** 줄 높이를 더해 어림하면
  아래만 좁아 보인다(모서리 확대에서 잡혔다) → 콘텐츠 Container 의 `getLocalBounds()` 로
  실제 바닥을 재고 `h = 바닥 + box.y` 로 잡는다(box.y = border + pad = 60).
- **정찰 격자(15×9)처럼 가로로 긴 콘텐츠는 열 '폭'이 곧 크기**다 — 높이는 남아돌아도 폭이
  좁으면 칸이 작아진다. 칸 크기를 폭·높이 양쪽에서 뽑아 작은 쪽을 쓰면 열이 좁아져도 상자를
  넘지 않는다(`min(cellFromW, cellFromH, 상한)`).
- **좁은 열에서는 버튼을 문구 옆이 아니라 아래에 둔다.** 옆에 붙이면 문구 폭이 100px 남짓으로
  눌려 `scale.x` 축소가 걸리고 읽을 수 없게 된다. 문구는 가로 폭 전체로 흘리고 버튼을 그 아래
  오른쪽에 세운 뒤 **행 높이를 재서** 목록에 돌려주면 마스크 클램프도 그대로 성립한다.
- **표가 셋 이상인 화면은 한 판에 다 못 담는다** — 관제탑(#6)에서 사용자가 직접 구조를 다시
  잡았다: 보드에는 "지금 행동할 것"만 두고(대상 목록·정찰·복수전), "훑어보는 것"(순위표·알림·
  전투 기록)은 **팝업**으로 뺀다. 한 화면에 다 늘어놓으면 열이 좁아져 어느 표도 제대로 못 본다.
  팝업 데이터는 **열 때 로드**한다(화면 진입이 무거워지지 않는다).
- **Pixi 에는 텍스트 입력이 없다.** 검색이 필요하면 캔버스 위에 DOM `<input>` 을 절대 배치한다
  — 디자인 좌표를 `stage.worldTransform`(레터박스 스케일·오프셋) + 캔버스 `getBoundingClientRect()`
  로 환산하고 `window resize` 에 재배치한다. **한 글자마다 화면을 다시 그려도 엘리먼트는 재생성하지
  않는다**(재생성하면 포커스와 한글 IME 조합이 끊긴다) → 같은 key 면 위치만 갱신하는 mount.
- 팝업은 암막(scrim)에 `pointertap` 으로 닫기를 걸고, **패널 자신에도 `stopPropagation` 을 걸어야**
  안쪽 클릭에 창이 닫히지 않는다. ESC 는 `window keydown` 으로 받되 `visible && modal !== null`
  일 때만 처리한다.
- **표 마지막 행이 페이지 이동 줄과 겹친다** — 행 수를 상자 바닥에서 역산하고(`PAGER_H` 만큼
  빼고 나눈다), 상한 안내 같은 부가 문구는 새 줄을 쓰지 말고 페이저 줄 왼쪽에 얹는다.
- 전투 기록(공격·방어 양방향)은 **서버 RPC 없이도 된다** — `invasions` RLS(`invasions_select_participant`)가
  내가 참여한 행만 열어 주므로 클라이언트 select 로 모으고, 상대 이름은 `get_ladder_top(200)` +
  시드 기지 메타로 해석한다(침공 대상은 모두 순위표에서 오므로 사실상 전부 해석된다).
- 관제탑은 **로그인해야 채워지는 화면**이다(env 가 설정돼 있어도 미로그인이면 RPC 가 401 →
  전 패널이 안내 상태). 채워진 화면을 검증하려면 `__pb.controlTower` 로 인스턴스를 잡아
  `targets`/`ladder`/`incoming` 등을 직접 넣고 `render()` 를 부른다(하네스 훅에 노출해 뒀다).
  진행 중인 비동기 로드가 덮어쓰지 않게 `loadToken` 을 먼저 올린다.
- **마스크로 쓰인 Graphics 는 히트 테스트에서 제외된다**(`isMask`) — `mask.on('wheel')` 로 걸어 둔
  목록 스크롤은 **한 번도 동작한 적이 없었다**(정제소 #3·관제탑 #6·카드 #7 실측). 휠은 **클립
  Container** 에 걸고 `hitArea = new Rectangle(0,0,w,h)` 를 준다 — 행 사이 빈 자리에서도 잡히고,
  행 위에서는 행 → 클립으로 버블링되어 함께 성립한다(세 화면 모두 고쳤다). 검증할 때 **첫 wheel
  이벤트는 흡수**되므로(포인터 타깃이 아직 안 잡힌다) 두 번 보내야 한다.
- **캔버스 화면을 다른 캔버스 콘텐츠 위에 띄우려면 stage 맨 앞으로 올려야 한다.** 방어 프리뷰는
  방어 사령부 **진입 시점에** stage 에 붙으므로 앞서 만든 화면보다 뒤에 붙어 **위에** 그려진다 —
  카드 화면 배경이 불투명해도 아레나가 패널을 뚫고 보였다. `show()` 에서
  `stage.setChildIndex(root, stage.children.length - 1)`.
- **DOM 오버레이 화면에서 캔버스 화면으로 잠깐 넘어갈 때는 `hide()/show()` 가 아니라 suspend/resume**
  이다. `DefenseCommand.show()` 는 저장된 배치로 에디터 상태를 되감으므로, 카드 화면에 다녀오면
  미저장 편집이 날아간다. `suspend()` 는 `display:none` 만, `resume()` 은 다시 켜고 진행 중이던
  로드를 **다시 건다**(감춘 동안 `visible === false` 라 비동기 로드가 조용히 버려져 "불러오는 중"
  표시가 고착됐다 — 실측).
- **하네스 확대 크롭은 `gameApp.app.stage` 가 아니라 그 안의 디자인 컨테이너 스케일을 곱해야 한다.**
  `gameApp.stage`(디자인 스페이스, 레터박스 스케일 f≈0.73)가 `app.stage` 의 자식이라
  `app.stage.position = (-x0*k, -y0*k)` 로 잡으면 실제로는 `x0/f` 지점이 잡힌다 →
  `position.set(-x0*k*f, -y0*k*f)`. 원복은 `resize` 이벤트로는 안 되고 scale/position 을 직접 되돌린다.
- **캔버스로 옮긴 UI 는 DOM 오버레이 아래로 내려간다.** 설정(#8)은 DOM 시절 `z-index:60` 으로
  모든 오버레이(최대 33) 위였는데, 캔버스로 들어가는 순간 **남아 있는 DOM 화면이 전부 그 위**가
  된다(캔버스는 DOM 요소 하나이므로 z-index 로 뒤집을 수 없다). 불투명 배경의 DOM 화면
  (타이틀)은 톱니를 통째로 지웠다 → 그 화면도 함께 이관하는 것이 유일한 해법이다. **모든
  화면 위에 떠야 하는 크롬 UI 를 캔버스로 옮길 때는 "아직 DOM 인 화면 목록"을 먼저 뽑아라.**
- **모든 화면 위에 떠 있어야 하는 크롬 UI 는 매 프레임 stage 맨 앞으로 되돌린다.** 화면들이
  `show()` 에서 `setChildIndex(root, children.length-1)` 로 자기를 올리므로 한 번 올려 두는
  것으로는 안 된다 → 렌더 루프에서 `raise()`(이미 마지막이면 no-op). 화면 전환마다 훅을 거는
  것보다 싸고, 새 화면이 추가돼도 잊어버릴 곳이 없다.
- **텍스처 로드 후 다시 그리는 부품은 리스너를 재등록하기 쉽다.** `loadUiTextures().then()` 에서
  다시 부르는 build 함수 안에 `on('pointertap')` 을 두면 리스너가 2개가 되어 **클릭 한 번에
  토글이 두 번** 일어난다(설정 톱니가 열렸다 즉시 닫혔다 — 실측). 상호작용(eventMode·hitArea·
  리스너)은 생성자에서 한 번만 걸고, build 함수는 **시각 요소만** 다시 만든다.
- **밝은 화면 위에 뜨는 팝업은 `fillAlpha: 1` 이 필요하다.** `nineSlicePanel` 기본값 0.96 은
  뒤가 어두운 전체 화면에서는 안 보이지만, 기지 맵 같은 밝은 화면 위에 띄우면 **뒤 카드의
  글자가 그대로 읽힌다**(모서리 확대에서 잡혔다).
- **Pixi 에는 슬라이더도 없다.** 트랙+손잡이를 직접 그리고 `pointerdown`(트랙 아무 데나 눌러
  점프) → `globalpointermove`(드래그) → **`window` 의 `pointerup`**(캔버스 밖에서 손을 떼도
  풀리도록) 으로 잡는다. 재렌더 때마다 리스너를 새로 달지 않도록 **적용 함수만 필드에 갈아
  끼우고** 리스너는 생성자에 둔다. 트랙 채움은 테두리 두께만큼 **안쪽에** 그려야 채운 구간만
  굵어 보이지 않는다.
- **DOM DEV 텔레메트리(`#hud`)는 캔버스 UI 를 덮는다.** 좌상단(8,8)에 3줄로 그려지는데 설정
  톱니가 그 자리로 왔다 → 우상단은 레이더, 좌하단은 런 HUD(`#pb-hud`)가 쓰므로 **우하단**
  (치트 버튼 옆)으로 보냈다.
- **레벨업 오버레이는 런 종료 경로에서만 숨겨졌다** — 정산 없이 런을 벗어나면(하네스 `goto`)
  메뉴 화면 위에 남아 검증 스크린샷을 오염시킨다. 런 전용 UI 이므로 `clearToMenu()` 에서도
  숨긴다(#8 에서 한 줄 추가).
- **하네스 클릭 검증에서 라벨을 찾을 때는 조상의 `visible` 까지 봐야 한다.** `t.visible` 은
  자기 자신만 보므로 **숨은 팝업 안의 텍스트도 잡힌다** — 그 좌표를 누르면 엉뚱한 곳을 누른다.
  또 `▶` 는 `stripEmoji` 가 보존하므로 라벨은 `'▶ 튜토리얼 시작'` 처럼 **기호까지 포함**해 찾는다.
- 하네스에 리롤용 장비를 채울 때는 치트 패널 **메뉴 → 장비 지급**을 슬롯별로 반복한다
  (같은 슬롯에 또 지급하면 기존 장착분이 인벤토리로 밀려나 쌓인다). `preset('maxed')` 는
  재화만 주고 인벤토리는 비어 있다.

## 좌표

- 파일럿 산출물: `src/ui/pixi/` + `assets/ui_*.png` (앵커 `pb-cartoon-wood-ui`)
- 세트 정본: pixellab-forge `skills/cartoon-wood-ui/SKILL.md` (v0.2.2+) · README "UI 세트 레지스트리"
- 파일럿 계획·교훈: `.omc/plans/hangar-cartoon-ui-pilot.md`, `.omc/handoffs/hangar-cartoon-ui.md`
