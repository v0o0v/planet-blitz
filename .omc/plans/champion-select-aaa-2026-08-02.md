# 챔피언 선택 화면 AAA 시네마틱 전환 — 레인 계약 (2026-08-02)

타이틀·인트로·기지·격납고·촉매 보관함·예비역 로스터(PR#236·#238·#240·#245·#246·#247·#248)에
이어 격납고 하위 화면 셋 중 **마지막**인 챔피언 선택(`src/ui/pixi/championSelect.ts`)을 전환한다.

**시각 정체성 = 시네마틱 전환**(사용자 확정). 나무 nine-slice(`ui_panel.png`)·나무 판때기 버튼
(`ui_btn_*.png`)·나무 배너(`ui_banner.png`)는 이 화면에서 **은퇴**한다. 붓: 페인터리 디지털
페인팅, 금빛 고대 석재, 청록·자홍 성운, 짙은 실루엣, 따뜻한 금색 램프광.

## 0. 절대 규칙 (격납고 §0 · 촉매 보관함 · 예비역 로스터 §0 승계)

1. **순수 render/UI 레이어(ADR-0005 · ADR-0014)** — sim 을 읽지도 쓰지도 않는다. 시간축은 벽시계.
2. **품질 티어를 런타임 수렴 상태로 판단하지 마라**(`getActiveTier()` 단독 사용 금지).
3. **띠를 겹쳐 그라디언트를 근사하지 마라.** 램프는 폭 1px 캔버스에 픽셀로 굽고 `linear` 로
   늘린다. ⚠️ `titleScreen.ts` 광선 스윕(`slabs = 7`)에 이 결함이 아직 남아 있다 — 복사 금지.
4. **Pixi v8**: `Sprite` 에 자식 금지(형제 + 변환 미러). `tint` 는 곱연산. 컬러 이모지 금지.
5. 자산은 **덧붙임이지 전제가 아니다** — 텍스처가 `undefined` 여도 화면이 서야 한다.
6. 캔버스 없는 환경(vitest)에서 `Text.width`·`document.createElement`·`ColorMatrixFilter`·
   `FillGradient` 가 던진다. 관용구는
   `typeof document === 'undefined' || typeof document.createElement !== 'function'`.
   ⚠️ **캔버스 굽기 함수에만** 붙인다 — `hudEl()` 에 붙이면 HUD 숨김이 죽는다(실제로 밟았다).
7. `npx tsc --noEmit` 0 · `npx eslint src --max-warnings 0`.

## 0-bis. 사용자가 **제거하기로 확정한 것** — 되살리지 마라

세로 석재 리브 · 가로 수평 이음선/코스 파편 · 각인 번호판 · 헤더 각인 석재 인방 ·
**함선 도크 크래들**(`cradle: false`). 남기는 것은 재질과 조명뿐이다 — **면 위에 "부품"처럼
얹히는 표식은 넣지 않는다.**

---

## 1. 이 화면 고유의 판단 셋

### ① 기체 여러 대를 어떻게 배치하는가 → **중앙 히어로 창 + 좌측 목록**

이 세션에서 가장 큰 시각적 기회이자 유일하게 판단이 갈리는 자리였다. 셋을 놓고 골랐다:

- ~~카드 나열(`cinematicTile`)~~ — 7종을 카드로 깔면 각 카드의 함선이 128px 이하가 되어
  `shipDock` 의 접지·언더라이트·림이 원리적으로 안 읽힌다(그 처방은 실루엣 바닥선 파생이라
  스프라이트가 작아지면 몇 픽셀로 뭉갠다). 게다가 격납고 쇼케이스와 언어가 갈린다.
- ~~창 여러 개~~ — 창을 여럿 뚫으면 배경 원화가 조각나 회화가 아니라 벽지가 된다.
- **중앙 히어로 창 + 목록** ← 채택.

**여기서는 창을 뚫는 것이 정당하다.** 촉매 보관함·예비역 로스터에서는 창을 뚫었다 뺐는데
(창 안에 초점 피사체가 없었다), 이 화면은 **행을 바꾸면 창 안의 피사체가 바뀐다** — 창이
"배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"라는 조건을 유일하게 만족한다.
그래서 `windows: [히어로 창]` 이고 `shipDock` 이 그 안에 선다.

### ② 확인 흐름의 가독성이 연출보다 우선이다

퇴역 = **되돌릴 수 없는 세대 교체**다. 확인 팝업 본문(무엇을 잃는지)·만렙 게이트 사유는
크림색 큰 글자로, 암막은 뒤 화면 글자가 안 읽힐 만큼(`alpha 0.92`) 짙게. 팝업 위에 배경
연출을 얹지 않는다. 게이트가 닫혀 있으면 **확정 버튼을 죽이고 사유를 상시 노출**한다(죽은
버튼만 있으면 사용자는 고장으로 읽는다 — 기존 구현의 결론을 그대로 승계).

### ③ 함선 픽셀아트는 재생성하지 않는다(사용자 확정)

기체 정체성·파밍 시각 언어다. `shipDock` 이 **조명·접지·프레이밍으로만** 페인터리 배경에
앉힌다. 격납고 실측 목표: `under/flanking 0.55~0.65`(곱연산 비) · 하단 33% R/B ≥ 0.75 ·
상단 33% R/B 0.47±0.03.

## 2. 레이아웃 (디자인 스페이스 1920×1080)

여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 형제 화면과 **같은 값**이다.

| 요소 | x | y | w | h |
| --- | --- | --- | --- | --- |
| 헤더 밴드(배경 노출) | 0 | 0 | 1920 | 104 |
| 로스터 패널(slab) | 32 | 112 | 560 | 940 |
| 히어로 창(**window**, 제목 없음) | 620 | 112 | 620 | 580 |
| 시그니처·섀시 패널(slab) | 1268 | 112 | 620 | 580 |
| 스킬 계열 패널(slab) | 620 | 712 | 1268 | 340 |

- 히어로 창에는 **제목 띠를 두지 않는다.** 기체 이름·역할은 창 **안** 하단에 얹는다 — 창은
  이 화면의 주인공이고, 제목 띠를 얹으면 창이 다시 "패널"이 된다.
- 스킬 계열은 우측 열 **전폭**을 쓴다(카드 3장 나란히, 각 ≈396px). 세로로 쌓으면 카드가 572px
  폭에 108px 높이가 되어 띠 세 줄로 읽힌다.
- 확정 버튼·현재 기체·게이트 사유는 **로스터 패널 바닥**에 둔다(목록 옆 = 고르는 자리 옆).
- 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드** — 컨트롤을 두지 않는다.
- 헤더 컨트롤은 전부 같은 세로 띠(y 26..78)를 쓰고 **가로로만** 배치한다(격납고 겹침 이력).

### 패널 콘텐츠 상자 기하는 **복제하고 테스트로 잠근다**

`cinematicPanel.ts` 의 `EDGE_PAD 24` · `CONTENT_GAP 16` · 제목 띠 52 는 이 파일이 목록 창
높이(`ROSTER_LIST_AVAIL`, 스크롤 산술의 전제)를 **모듈 상수로** 계산하는 데 필요하다. 값을
베끼되 `tests/championSelectLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조해
드리프트를 잠근다 — 베낀 값이 조용히 어긋나면 목록 마지막 행이 영영 안 보이는데 예외도
로그도 없다.

## 3. 크롬 교체 대응표

| 현재 | 교체 후 |
| --- | --- |
| `makeBanner(ui_banner.png)` | `makeHangarTitle` |
| `nineSlicePanel(ui_panel.png)` | `makeCinematicPanel({variant:'slab'\|'window'})` |
| `makeIconButton(ui_icon_close.png)` | `cinematicButtonTexture('stone')` 주입 버튼 `✕` |
| `PixiButton(ui_btn_yellow/red/wood.png)` | `cinematicButtonTexture(tone)` **주입**(`cap: 32`) |
| `listRowBg` | 석재 행 판(예비역 로스터 `rowPlate` 복제) |
| `makeModal(ui_panel.png)` | **시네마틱 확인 팝업**(암막 0.92 + 슬래브 패널) |
| 쇼케이스 `Sprite` 한 장 | `makeShipDock({cradle:false})` |

⚠️ `PixiButton`·`makeModal` 을 **수정하지 않는다** — 다른 화면 5~6곳이 쓴다. 팝업은 이 파일
안에서 만든다(`modal.ts` 헤더의 실측 규칙 3종은 그대로 승계: 암막 불투명 · 암막이 이벤트를
먹음 · 패널 안쪽 탭은 전파 차단).

파일럿 파일 팝업(`makePilotFileModal`)은 **그대로 둔다** — 그 모듈은 스토리 화면 계열이 함께
쓰고, 이 칩의 범위는 챔피언 선택 화면 자체다. 별도 레인 사안으로 남긴다.

## 4. 재렌더 규율

`render()` 로 루트를 통째로 다시 그리면 선택이 바뀔 때마다 배경과 석재 패널 4장이 다시 구워진다.

- `buildChrome()` — 배경·패널 4장·헤더·정적 위젯은 **한 번만**(자산 로드 시 1회 재건).
- `renderList()` — 행만 `listHost` 안에서 갈아끼운다.
- 선택 변경은 `rowSelect` 로 **두 행만** 토글하고, 히어로 도크만 다시 만들고(함선 텍스처가
  바뀐다), 나머지는 `.text` 만 갈아끼운다.
- 팝업은 `modalHost` 에서만 나고 진다.

`update(dt)`: 격납고가 **자기 가시성 가드보다 먼저** `champion.update(dt)` 를 부른다(이 화면이
떠 있는 동안 격납고 root 는 `suspend()` 로 숨겨져 있어 가드 뒤에 두면 연출이 통째로 멈춘다).

## 5. 기능 불변식 — 깨면 즉시 불합격

1. **확정 = `applyChampionChoice` 한 번**(퇴역 + 세대 교체 + 저장). 만렙 게이트에 막히면
   `null` 이 오고 **저장하지 않는다**(무조건 `saveProfile` 하면 거부가 성공처럼 보인다).
2. `store` 가 null 이면 `?? undefined` 로 넘긴다 — 명시적 null 은 "저장하지 마라"다.
3. **확인 팝업 없이 퇴역되지 않는다.**
4. 게이트가 닫혀 있으면 확정 버튼 비활성 + 사유 상시 노출(`champion.retire.needMaxLevel`,
   `tShipKey` 가 아니라 `t` — 폴백 경로에서 params 가 치환되지 않는다).
5. 로스터는 `selectableShipTypes()` 전량(ADR-0019 해금 게이트 없음).
6. **휠 스크롤은 클립 Container 에**(`makeScrollArea`). 마스크 Graphics 는 히트 테스트 제외.
7. **행 클릭은 행 Container 에.**
8. 격납고와는 `show()`/`onClose`, 격납고가 `suspend()`/`resume()`.
9. ⚠️ 진입 시 런 HUD 숨김 · 닫을 때 **원래 값 복원**(`hudPrevVisibility`) —
   `tests/pixiScreenPersistence.test.ts` 가 이 계약을 잠근다. `hudEl()` 에 캔버스 가드를
   붙이면 그 테스트가 깨진다.
10. 공개 표면 유지: `applyChampionChoice` · `formatBp` · `rosterSize` · `rosterStackHeight` ·
    `ROSTER_ROW_H` · `ROSTER_ROW_GAP` · `ROSTER_LIST_AVAIL`(기존 테스트가 쓴다).

## 6. 완료 기준

- **하네스 실화면 스크린샷**(품질 티어 `high` 고정 · 탭 포그라운드 · 커서 프레임 밖).
  `npx vite --port 5189 --strictPort` → `?harness=1` →
  `localStorage.setItem('pb.graphics', JSON.stringify({quality:'high'}))` →
  `__pb.harness.preset('maxed')`(만렙이라야 기체 교체 버튼이 열린다) ·
  `__pb.harness.goto('inventory')` → 기체 교체 버튼.
  ⚠️ in-app Browser pane 은 hidden 이라 스크린샷이 안 나온다 — **Chrome DevTools MCP**.
- **엄격한 비평 서브에이전트**가 실화면을 픽셀 실측해 AAA 판정. 기본 입장은 불합격.
- 레이아웃 불변식 단위 테스트 + 패널 상자 기하 드리프트 가드.
- **새 자산 없음** → `hangarAssetPresence` 가 그대로 유효(추가 가드 불요).
- **테스트 추가 후 `tsc` 재실행 필수**(vitest 그린인데 빌드가 깨지는 함정 이력).
- `pnpm test` 전체 · `npx tsc --noEmit` · `npx eslint src --max-warnings 0`.
- 전체 스위트 기존 적색은 **수와 파일이 같은지** `origin/main` 기준선과 대조.
  2026-08-02 기준 main 적색 = **8파일 58건**(commissionBandMeasure 6 · denoFixture 1 ·
  encounterHashInvariance 10 · fullRun 3 · invasionBalance 8 · planetPopularity 1 ·
  planetTierCompletion 2 · shipHashBaseline 27).

## 7. 지표 운용 규율 (승계)

1. 대리 지표를 **"균일해야 할 것의 상한"** 으로 주면 그림이 지워진다. **하한(보존)으로만 안전.**
2. **평균은 결함을 가린다.** 게이트는 `타일 최소` + `임계 미만 픽셀 비율`로.
3. 대비는 **곱연산(AO)** 으로. **절대 델타는 곱연산 편차의 지표가 아니다.**
4. **표본 정의가 다르면 반대 결론이 나온다** → 정의 비의존 속성을 보고하게 하라.
5. **판정 기준은 스크린샷이고 수치는 대리 지표다.**
6. **처방을 내리기 전에 그 지표가 올바른 축을 재고 있는지 먼저 검토한다.**

## 8. 측정 도구

- 캔버스를 JS 로 직접 읽으면 전부 0 이 나온다. 실측은 **스크린샷 PNG**로.
- 좌표 변환: `shot_x = design_x × 0.9115`, `shot_y = design_y × 0.9115 + 19`
  (캡처 1750×1022, 상단 레터박스 19px).
- 서브에이전트 트랜스크립트는 **만료된다.** 파일 헤더에 **왜**를 남겨라.
