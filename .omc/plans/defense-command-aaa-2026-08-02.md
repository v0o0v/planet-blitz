# 방어 사령부 AAA 시네마틱 전환 — 레인 계약 (2026-08-02)

타이틀·인트로·기지·격납고와 하위 화면 셋(촉매 보관함 PR#247 · 예비역 로스터 PR#248 ·
챔피언 선택 PR#249) · 연구소(PR#250) · 정제소(PR#251, main `f9e2313`)에 이어
**방어 사령부**(`src/ui/pixi/defenseCommand.ts`)를 전환한다.

⚠️ **규약이 형제들과 다르다.** `main.ts:421` 이 `defenseCommand.show(profile, {onClose,
onTestInvade, onOpenModules})` 로 열고, 코어 모듈 화면으로 갈 때만 **suspend/resume** 을 쓴다
(`show()` 로 되돌리면 미저장 배치 편집이 날아간다 — 기존 결함 이력). 이 쌍은 한 줄도 안 건드린다.

⚠️ **비평 서브에이전트는 사용자가 요청할 때만 돌린다**(칩 특별 지시). 구현 → 하네스 실화면
스크린샷 → **사용자에게 제시**. 판정 기준은 스크린샷이고 사용자가 최종 판정자다.

## 0. 절대 규칙 (정제소 §0 · 연구소 · 챔피언 선택 · 격납고 승계)

1. **순수 render/UI 레이어(ADR-0005)** — sim 을 읽지도 쓰지도 않는다. 시간축은 벽시계.
2. **품질 티어를 런타임 수렴 상태로 판단하지 마라**(`getActiveTier()` 단독 사용 금지).
3. **띠를 겹쳐 그라디언트를 근사하지 마라.** 램프는 폭 1px 캔버스에 픽셀로 굽고 `linear` 로
   늘린다. ⚠️ `titleScreen.ts` 광선 스윕(`slabs = 7`)에 이 결함이 아직 남아 있다 — 복사 금지.
4. **Pixi v8**: `Sprite` 에 자식 금지(형제 + 변환 미러). `tint` 는 곱연산. 컬러 이모지 금지
   (`★ ✕ ▶ ◀` 는 보존 목록).
5. 자산은 **덧붙임이지 전제가 아니다**. **이 레인은 새 자산을 만들지 않는다.**
6. 캔버스 없는 환경(vitest)에서 `Text.width`·`document.createElement`·`ColorMatrixFilter`·
   `FillGradient`(**`new Text` 시점**에 던진다)가 전부 던진다. 관용구는
   `typeof document === 'undefined' || typeof document.createElement !== 'function'`.
   ⚠️ **캔버스 굽기 함수에만** 붙인다 — DOM 조회(`hudEl`)에 붙이면 HUD 숨김이 죽는다.
7. `npx tsc --noEmit` 0 · `npx eslint src tests --max-warnings 0`.

## 0-bis. 사용자가 **제거하기로 확정한 것** — 되살리지 마라

세로 석재 리브 · 가로 수평 이음선/코스 파편 · 각인 번호판 · 헤더 각인 석재 인방 ·
함선 도크 크래들. 남기는 것은 **재질과 조명뿐**이다(석재 세로 램프 · 방향성 베벨 3단 ·
패널별 조명 · 미세 그레인 · 2단 접지 그림자 · 리벳). **면 위에 "부품"처럼 얹히는 표식은 넣지
않는다.** 그 화면의 결정을 돕지 않는 진입점도 넣지 않는다.

---

## 1. 이 화면 고유의 판단 다섯

### ① 창을 뚫는가 → **뚫는다.** 배치 프리뷰가 이 화면의 피사체다

형제 화면 다섯의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였고,
그래서 촉매 보관함·예비역 로스터·연구소·정제소는 뚫었다 뺐다(초점 피사체 부재). 챔피언 선택만
뚫었다 — **행을 바꾸면 피사체가 바뀌기** 때문이다.

방어 사령부는 챔피언 선택 쪽이다. 좌측 프리뷰는 목업이 아니라 **`createWorld(invasion3)` 실제
정지 렌더**(`src/render/defensePreview.ts`)이고, 슬롯을 꽂거나 탭을 바꾸면 **그림이 실제로
바뀐다**. 창에 세울 진짜 피사체가 이미 있다.

→ 프리뷰 패널은 `variant: 'window'`, 배경은 `windows: [프리뷰 뷰포트]`.
⚠️ **`window` 변종에 채워진 그림자를 깔면 창이 −66L 로 검게 죽는다** — `cinematicPanel.ts` 가
이미 링으로 파낸 텍스처를 쓰므로 그대로 쓰고 위에 아무것도 덮지 않는다.
⚠️ 프리뷰 노드는 **루트 맨 앞**이어야 한다(`previewChildIndex`). 예전에 인덱스 1(액자 아래)로
내렸다가 프리뷰 기여분이 **4.6%** 로 묻혀 사실상 빈 상자였다 — 그 계약을 그대로 유지한다.

### ② **모든 탭이 같은 패널 기하를 쓴다** — 탭을 바꿔도 석재가 안 움직인다

탭마다 패널 배치가 달라지면 전환할 때 화면이 통째로 튀고, 재렌더 규율상 탭 전환마다 배경과
슬래브를 다시 구워야 한다. 그래서 **왼쪽 1100 · 오른쪽 728** 한 벌을 모든 탭이 공유한다:

| 탭 | 왼쪽 1100 | 오른쪽 728 |
| --- | --- | --- |
| L1 / L2 / L3 | 배치 프리뷰 (**window**) | 배치 슬롯 (slab) |
| 보관함 | 보유 방어체 (slab) | 설계도 · 제작 (slab) |

패널 4장을 **한 번에 세워 두고 visible 만 토글**한다(크롬 재건 없음). 슬롯 목록 제목이 레이어별로
달라지면 제목이 패널에 구워지므로 재건이 필요해진다 → 제목은 세 레이어 공통 **`배치 슬롯`**
이다(어느 레이어인지는 탭 바가 이미 말한다).

### ③ **[코어 모듈] 탭을 없앤다** — 탭 하나 전체가 버튼 하나였다

`모듈` 탭의 내용은 안내문 한 문단 + 버튼 하나가 전부였다. 1856×788 슬래브 한 장이 그것을 위해
존재했다 — 이 화면 최악의 빈 자리이고, 형제 화면 다섯이 전부 잡아 고친 형태 그대로다.

코어 모듈은 **L3 코어방 코어의 소모성 인스턴스**다. 그래서 L3 슬롯 패널 맨 위의 **코어 블록**
(코어 내구도 + `[모듈 관리]`)으로 옮긴다. 진입점은 보존되고(main.ts 의 `onOpenModules` 계약
그대로 · suspend/resume 그대로) 탭은 5 → **4** 가 된다.

사문화된 문구 키(`def3.cmd.tab.mod` · `mod.head` · `mod.note` · `back`)는 **카탈로그에 남긴다** —
`tests/i18n.test.ts:283` 이 `def3.cmd.back` 을 "빌려 쓰던 원 문구" 대조 표본으로 이름을 박아
쓰고 있어, 지우면 무관한 단언이 흔들린다. 화면은 더 이상 참조하지 않는다.

### ④ 하단 [기지로 돌아가기] 버튼은 **없앤다**

헤더 ✕ 와 같은 일(close)을 두 번 제공하고 있었다. 형제 화면 다섯은 전부 헤더 ✕ 하나만 쓴다.
하단 띠에는 **저장 · 되돌리기 · 시험 침공**만 남고, 왼쪽 절반은 `미저장 변경`/토스트가 쓴다 —
버튼을 오른쪽에 몰고 상태 문구를 왼쪽에 두면 그 띠에 빈 자리가 없다.

### ⑤ 빈 목록·오프라인도 **빈 패널로 두지 않는다**

정제소 §6-bis-2 의 처방을 승계한다: 설비를 그대로 그리고 **빈 자리 옆에서** 무엇을 할지 말한다.

- **보유 방어체 없음/오프라인** → 패널을 **파낸 보관 챔버**(`recessedWell`)로 그리고 그 안에
  안내를 앉힌다. "빈 패널 면"이 아니라 "비어 있는 보관 챔버"가 된다.
- **설계도 없음** → 같은 처방.
- 슬롯 목록은 원래 비지 않는다(슬롯은 항상 존재한다).

## 2. 레이아웃 (디자인 스페이스 1920×1080)

여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 형제 화면과 **같은 값**이다.

| 요소 | x | y | w | h |
| --- | --- | --- | --- | --- |
| 헤더 밴드(배경 노출) | 0 | 0 | 1920 | 104 |
| 탭 4칸 | 32 | 112 | 1856 | 56 |
| 왼쪽 패널 | 32 | 184 | 1100 | 788 |
| 오른쪽 패널 | 1160 | 184 | 728 | 788 |
| 하단 액션 띠 | 32 | 988 | 1856 | 64 |

전부 파생이다 — `TAB_Y = HEADER_H + 8` · `PANEL_Y = TAB_Y + TAB_H + 16` ·
`FOOT_Y = 1080 − 28 − 64` · `PANEL_H = FOOT_Y − 16 − PANEL_Y` ·
`RIGHT_W = 1920 − 32 − RIGHT_X`. 우변 `1160 + 728 = 1888 = 1920 − 32` ✓

헤더 컨트롤(전부 y 26 · h 52) — **정제소와 같은 x**:

| 컨트롤 | x | w |
| --- | --- | --- |
| (각인 제목 = 중앙 960, 대역 ±280) | — | — |
| 광물 칩 | 1424 | 190 |
| 크레딧 칩 | 1628 | 190 |
| 닫기 ✕ | 1832 | 56 |

- 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**. 헤더 좌측은 비워 둔다(테스트로 잠근다).
- 제목 대역 680..1240 과 첫 칩 1424 사이 184 — 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가
  못 잡으므로 `TITLE_BAND_HALF_W` 로 대역을 못 박는다(연구소에서 제목이 실제로 겹쳤다).

### 패널 안(패널 로컬, 제목 띠 있는 슬래브: box = x24 · y68 · w W−48 · h H−92)

- 왼쪽 box = 1052×696 → **프리뷰 뷰포트 = 화면 좌표 (56, 252, 1052, 696)**.
- 오른쪽 box = 680×696.
- L3 만 상자 맨 위에 **코어 블록** `h 96` + `gap 16` → 스크롤 영역은 그 아래 584.
- 슬롯 행 폭 680, `[배치]`·`[비우기]` 각 104 → 글자 폭 `680 − 208 − 40 = 432`.
- 마스크 높이는 `clampToRows` 로 행 경계에 떨군다(반토막 행 금지 — 기존 계약 유지).

### 하단 액션 띠

`[저장 260] [되돌리기 200] [시험 침공 240]` 을 **오른쪽 끝(1888)에 몰고** 간격 16.
왼쪽에는 `미저장 변경` 경고 / 저장·강화 토스트가 앉는다. 띠 안에 빈 자리가 없다.

### 팝업 — 높이를 **내용에서 역산**한다

`makeModal`(나무)은 고치지 않는다(다른 화면 다섯이 쓴다). 화면 파일 안에 시네마틱 팝업을
만들고 `modal.ts` 헤더 실측 규칙 3종을 승계한다: ①암막 불투명 ②암막이 이벤트를 먹음
③패널 안쪽 탭은 전파 차단.

| 팝업 | 폭 | 높이 | 역산식 |
| --- | --- | --- | --- |
| 방어체 고르기 | 1180 | `pickModalHeight(n)` | `68 + n·102 − 10 + 24`, n ∈ [3, 7] |
| 강화 | 900 | 514 | 머리 34 + 어픽스 챔버 64 + 등급 26 + 4행(56/gap12) 260 |
| 시험 침공 확인 | 900 | 278 | 본문 110 + 버튼 56 |

`68 = TITLE_BAND_H(52) + CONTENT_GAP(16)`, `24 = EDGE_PAD`. 세 팝업 다 **버려지는 세로가 0**
이고 단위 테스트가 등호로 잠근다.
암막 알파는 **0.97** 에서 시작하되 **실화면으로 확인**한다(예비역 0.92 · 챔피언 0.96 ·
연구소 0.98 — 뒤 화면 밝기에 따라 다르다).

## 3. 크롬 교체 대응표

| 현재 | 교체 후 |
| --- | --- |
| `makeBanner(ui_banner.png)` | `makeHangarTitle` |
| `makeCurrencyChip(ui_chip.png)` | `makeHangarChip(tone)` — 광물 `teal` · 크레딧 `gold` |
| `nineSlicePanel(ui_panel.png)` | `makeCinematicPanel({variant:'slab' \| 'window'})` |
| `makeIconButton(ui_icon_close.png)` | `cinematicButtonTexture('stone')` 주입 버튼 `✕` |
| `PixiButton(ui_btn_wood/yellow.png)` | `cinematicButtonTexture(tone)` **주입**(`cap: 32`) |
| `makeTabBar(ui_btn_*.png)` | 화면 안 시네마틱 탭 4칸(활성 `gold` · 비활성 `stone` 0.72) |
| `listRowBg` 행 바탕 | 석재 행 판 `rowPlate`(정제소 경유 복제) |
| `makeModal(ui_panel.png)` | 화면 안 시네마틱 팝업(§2) |
| 배경 `COLOR.bg` 단색 | `HangarBackdrop({windows: [프리뷰], headerH: 104})` |
| `모듈` 탭 | **삭제** → L3 코어 블록의 `[모듈 관리]`(§1-③) |
| 하단 [기지로 돌아가기] | **삭제**(§1-④) |

버튼 톤 배정: 저장 `gold`(주 동작) · 되돌리기 `stone` · 시험 침공 `blue` · 배치 `blue` ·
비우기 `stone` · 제작 `gold` · 강화 `gold` · 퇴로 없는 확인 `red`.

형제 화면의 값(`SLAB_BODY_FILL 0xe4dac7` · `ROW_FACE 0x3b3327` · `ROW_GROOVE 0x17130d` ·
`rowPlate`/`rowRamp`/`recessedWell` · 여백 어휘 · 헤더 104 · `HEAD_Y 26`/`HEAD_H 52` ·
패널 상자 복제 상수 `EDGE_PAD 24`/`TITLE_BAND_H 52`/`CONTENT_GAP 16`)은 **복제하고 헤더에
출처를 밝힌다** — 그 파일들은 공용 모듈이 아니라 화면이다.

## 4. 재렌더 규율

현재 구현은 `render()` 가 루트를 통째로 지우고 다시 그린다(프리뷰 노드만 예외). 그대로 두면
슬롯 클릭 한 번, 탭 전환 한 번마다 **배경과 석재 패널 4장이 다시 구워진다**.

- `buildChrome()` — 배경 · 패널 4장 · 헤더 · 탭 바 · 하단 버튼 그릇은 **한 번만**.
  자산 도착 시 1회 재건. **탭 전환으로는 재건하지 않는다**(§1-② 가 그것을 가능하게 한다).
- `syncValues()` — 재화 칩 · 상태 문구 · 하단 버튼 활성 · 탭 활성 표시.
- `renderSlots()` / `renderUnits()` / `renderBlueprints()` — 각자 host 안에서만.
- `renderModal()` — 팝업 host 안에서만.
- `update(dt)`: **`main.ts` 가 매 프레임 부른다**(`defenseCommand.update(frame)` 를
  `refinery.update(frame)` 바로 옆에 배선). 숨겨져 있으면 즉시 반환.
  ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널 연출이 통째로 멈춘 적이 있다.

## 5. 기능 불변식 — 깨면 즉시 불합격

1. **suspend/resume 쌍을 유지한다.** 코어 모듈 진입은 `suspend()` → `onOpenModules(() =>
   this.resume())`. `show()` 로 되돌리면 미저장 배치 편집이 날아간다.
2. **슬롯 배열은 밀집화 금지** — `withSlot` 은 길이를 바꾸지 않는다. 인덱스가 좌표 계약이다.
3. `pickGuardianId` 의 다중집합 폴백(연속 퇴역 시 `hp:performanceCP` 키가 필연 충돌 →
   슬롯 2 를 영영 못 채웠던 결함)을 한 줄도 건드리지 않는다.
4. `testInvadeAction` — 미저장 편집이 있으면 **먼저 묻는다**(확인 없이 넘기면 돌아왔을 때
   무엇을 잃었는지조차 모른다).
5. `busy` 해제는 **finally** — suspend 중 완료돼도 잠금이 남지 않는다.
6. 저장은 로컬 즉시(`saveProfile` → `commitDraft`) → 서버 업로드 fire-and-forget.
   `saveProfile(profile, store ?? undefined)`. **명시적 null 금지.**
7. 프리뷰 노드는 **떼기만 하고 절대 destroy 하지 않는다**(이 화면이 만든 것이 아니다).
   그리고 **루트 맨 앞**에 둔다(`previewChildIndex`).
8. 팝업이 뜨면 프리뷰를 `stop()` 한다.
9. **휠 스크롤은 클립 Container 에**(마스크 Graphics 는 히트 테스트 제외). **행 클릭은 행
   Container 에**, 행 위 버튼은 `stopRowPropagation`.
10. ⚠️ 진입 시 런 HUD 숨김 · 닫을 때 **원래 값 복원**(`hudPrevVisibility`). 기존 구현은 무조건
    `visibility = ''` 로 되살렸다. `hudEl()` 에 캔버스 가드를 붙이지 않는다.
11. `export` 된 순수 모델(`createCommandState`·`setTab`·`isDirty`·`revertDraft`·`commitDraft`·
    `placeRef`·`clearSlot`·`setTemplateId`·`setCoreHp`·`slotRef`·`slotCount`·`slotCatalogKind`·
    `refEquals`·`isRefPlaced`·`eligibleUnits`·`tabForSlot`·`tabPhase`·`unitAffixLine`·
    `pickGuardianId`·`guardianFallbackKey`·`placeGuardian`·`testInvadeAction`·`previewChildIndex`)
    의 **이름과 의미를 바꾸지 않는다** — `tests/defenseCommandPixi.test.ts` ·
    `tests/m7bIntegration.test.ts` 가 직접 쓴다.
12. `DEF_TAB_*` 은 `DEF_TAB_MOD` 만 사라지고 `DEF_TAB_COUNT` 가 4 가 된다. `DEF_TAB_INV` 는
    **3 그대로**(탭 순서가 안 바뀐다).

## 6. 완료 기준

- **하네스 실화면 스크린샷**으로 확인 후 **사용자에게 제시**(비평은 사용자 요청 시에만).
  `npx vite --port <빈 포트> --strictPort` → `?harness=1` → `pb.graphics quality:high` →
  `__pb.harness.preset('maxed')` → `__pb.harness.goto('defense')`.
  ⚠️ 다른 워크트리가 5189/5231/5247 을 쓰면 **엉뚱한 워크트리가 서빙된다** — 빈 포트를 골라라.
  ⚠️ `Page.captureScreenshot` 은 창이 뒤에 있으면 **오래된 프레임을 조용히 준다** —
  `Page.bringToFront` 후 rAF 실측 fps ≥ 30 을 확인하고 찍는다.
  ⚠️ 보관함·강화는 **서버 로그인 상태에서만** 채워진다 — 오프라인이면 "쉬고 있는 상태"가
  보인다. 그 화면도 §1-⑤ 처방이 적용됐는지 같이 본다.
- 레이아웃 불변식 단위 테스트(`tests/defenseCommandAaaLayout.test.ts`): 패널 겹침 · 헤더 침범 ·
  화면 이탈 · 톱니 예약 밴드 · 제목 대역 · **빈 자리 금지**(패널 바닥 등호 · 탭 줄 등호 ·
  하단 띠 등호 · 팝업 높이 등호) · **패널 상자 기하 복제본 드리프트**(실제
  `makeCinematicPanel(...).box` 와 대조). + **뮤테이션으로 유효성 확인**.
- **새 자산 없음** → 자산 결손 가드 추가 불요.
- **테스트 추가 후 `tsc` 재실행 필수**(vitest 그린인데 빌드가 깨지는 함정 이력).
- `pnpm test` 전체 · `npx tsc --noEmit` · `npx eslint src tests --max-warnings 0`.
- 전체 스위트 기존 적색은 **수와 파일이 같은지** 대조. 2026-08-02 main `f9e2313` 기준 적색 =
  **8파일 58건**(commissionBandMeasure 6 · denoFixture 1 · encounterHashInvariance 10 ·
  fullRun 3 · invasionBalance 8 · planetPopularity 1 · planetTierCompletion 2 ·
  shipHashBaseline 27). ⚠️ `vitest | tail`·`| grep` 은 **거짓 초록**이다 —
  python 으로 ANSI 를 벗긴 뒤 집계한다.

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
- in-app Browser pane 은 hidden 이라 스크린샷이 안 나온다 — **Chrome DevTools MCP**.
  잠겨 있으면 별도 `--user-data-dir` + `--remote-debugging-port` 로 Chrome 을 띄우고
  Node 24 네이티브 `WebSocket` 으로 CDP 에 직접 붙는다
  (참고 스크립트 `C:\Users\v0o0v\AppData\Local\Temp\haru-shots\cdp-refinery.mjs`).
- ⚠️ `preset('maxed')` 는 **장착분만** 채운다. 필요한 상태는 직접 만든다.
- ⚠️ **미커밋 산출물에 `git checkout -- <file>` 을 쓰지 마라.** 뮤테이션 검증은 **커밋한 뒤에.**
- 서브에이전트 트랜스크립트는 **만료된다.** 파일 헤더에 **왜**를 남겨라.
