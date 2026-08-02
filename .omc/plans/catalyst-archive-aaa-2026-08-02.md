# 촉매 보관함 AAA 시네마틱 전환 — 레인 계약 초안 (2026-08-02)

타이틀·인트로·기지·격납고(PR#236·#238·#240·#245 + `feat/hangar-aaa`)에 이어 격납고 **하위 화면
셋**(촉매 보관함 · 예비역 로스터 · 챔피언 선택)에 같은 붓을 롤아웃한다. 이 문서는 그중
**촉매 보관함**(`src/ui/pixi/catalystArchive.ts`) 담당 레인의 계약이다.

**시각 정체성 = 시네마틱 전환**(사용자 확정). 나무 nine-slice(`ui_panel.png`)와 나무 판때기
버튼(`ui_btn_*.png`)은 이 화면에서 **은퇴**한다. 붓: 페인터리 디지털 페인팅, 금빛 고대 석재,
청록·자홍 성운, 짙은 실루엣, 따뜻한 금색 램프광.

---

## ⚠️ 이 문서의 상태 — 착수 전 대기 중

**격납고 레인(`feat/hangar-aaa`)이 아직 머지되지 않았다.** 2026-08-02 16:30 기준:

- `feat/hangar-aaa` 브랜치는 커밋 0개(`main` 과 동일 해시).
- 재사용 대상 모듈 5종(`cinematicPanel.ts` 1300줄 · `hangarChrome.ts` 1243줄 ·
  `hangarBackdrop.ts` 861줄 · `hangarTextures.ts` 73줄 · `shipDock.ts`) + `assets/hangar/` +
  격납고 계약 문서가 전부 **다른 워크트리의 untracked/미커밋 작업물**이고, 그 시점에도 **편집이
  진행 중**이었다(mtime 16:15~16:24).

사용자 판단(2026-08-02): **격납고 PR 머지를 기다린 뒤 그 위에서 분기해 재개한다.** 근거는
형제 화면 셋이 같은 모듈을 공유해야 시각 언어가 갈리지 않고 충돌이 0이 되기 때문이다.
미커밋 스냅샷 복사(3,477줄)는 대형 충돌이 확정적이라 기각했다.

따라서 **§4 이하의 모듈 인터페이스 항목은 머지 시점에 실물로 대조해 확정한다.** §1~§3 과
§5(고유 과제)·§6(기능 불변식)은 격납고와 무관하게 이미 유효하다.

### 재개 절차

1. `git fetch origin && git rebase origin/main` (격납고 머지분 흡수).
2. `cinematicPanel.ts` · `hangarChrome.ts` · `hangarBackdrop.ts` · `hangarTextures.ts` 의
   **실제 export 시그니처**를 읽고 §4 를 실물로 갱신한다(계약 문서의 시그니처는 격납고 레인
   진행 중 이미 한 번 변경됐다 — `screenX`/`screenY`/`lightOrigin` 추가).
3. `assets/hangar/README.md` 를 읽고 배경 자산이 레이아웃과 맺는 계약을 확인한다.
4. `hangar.ts` 의 최종 조립 방식을 조립 예시로 삼는다.

---

## 0. 절대 규칙 (격납고 계약 §0 을 그대로 승계)

1. **순수 render/UI 레이어(ADR-0005 · ADR-0014)** — sim 을 읽지도 쓰지도 않는다. 시간축은 벽시계.
2. **품질 티어를 런타임 수렴 상태로 판단하지 마라** — `graphicsTierController.getActiveTier()`
   단독 사용 금지.
3. **띠를 겹쳐 그라디언트를 근사하지 마라.** 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
   (실제 사용자 신고). 램프는 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
   ⚠️ `titleScreen.ts` 의 광선 스윕(`slabs = 7`)에는 이 결함이 **아직 남아 있다** — 복사 금지.
4. **Pixi v8**: `Sprite` 에 자식 금지(형제 + 변환 미러). `tint` 는 곱연산이라 밝히려면 가산/
   `screen` 오버레이. 컬러 이모지 금지(`text.ts` `stripEmoji`, `▶ ◀` 는 보존).
5. 자산은 **덧붙임이지 전제가 아니다** — 텍스처가 `undefined` 여도 화면이 서야 한다.
6. 캔버스 없는 환경(vitest)에서 `Text.width`·`document.createElement`·`new ColorMatrixFilter()`·
   `FillGradient`(생성이 아니라 **`new Text` 시점**에 던진다)가 전부 던진다. 리포 관용구는
   `typeof document === 'undefined' || typeof document.createElement !== 'function'`.
   ⚠️ 이 가드를 **캔버스 굽기 함수에만** 붙여라 — `hudEl()` 같은 DOM 조회에 붙이면 HUD 숨김이
   통째로 죽는다(실제로 밟았다).
7. `npx tsc --noEmit` 0 · `npx eslint src --max-warnings 0` 이 레인 종료 조건.

## 0-bis. 사용자가 **제거하기로 확정한 것** — 되살리지 마라

격납고에서 AAA 비평이 요구해 실제로 구현했다가 **사용자가 화면을 보고 삭제를 지시한 것**들이다.
지표 미달을 이유로 되살리지 마라 — **판정 기준은 스크린샷이고 수치는 대리 지표다.**

- **세로 석재 리브**(패널을 세로로 가르는 선) — 표의 괘선으로 읽혔다.
- **가로 수평 이음선**(전폭 2~3줄) 및 짧은 코스 파편 — 그리드 사이를 가로지르는 선으로 읽혔다.
- **각인 번호판**(제목 띠 우측의 눈금 표식).
- **헤더 각인 석재 인방** — 헤더는 배경이 그대로 보이는 띠로 둔다.
- **함선 도크 크래들**(받침) — `shipDock.ts` 의 `cradle: false`.

남기는 것: 재질과 조명(석재 세로 램프 · 방향성 베벨 3단 · 패널별 조명 · 미세 그레인 · 2단 접지
그림자 · 리벳). 즉 **면 위에 "부품"처럼 얹히는 표식은 넣지 않는다.**

---

## 1. 이 화면의 밀도 — 격납고와 정반대다 (실측)

격납고가 배경을 **패널 안으로 들여와야** 했던 이유는 4패널이 화면의 **약 97%** 를 덮어 배경이
보일 자리가 없었기 때문이다. 촉매 보관함은 그 반대다.

| 항목 | 현재 값 | 화면 대비 |
| --- | --- | --- |
| 화면(디자인 스페이스) | 1920 × 1080 = 2,073,600 | 100% |
| 본문 패널 | (460, 140) 1000 × 820 = 820,000 | **39.6%** |
| 상단 배너 | 560 × 72 @ y=10 | 1.9% |
| 재화 칩 3개 + 닫기 | 190×52 ×3, 56×56 | 1.6% |
| **덮이지 않은 배경** | — | **약 57%** |

**결론: 이 화면은 창을 뚫을 필요가 없다.** 기지의 "배경 위에 뜬 카드" 언어가 여기서는 그대로
성립한다 — 배경이 이미 절반 이상 노출돼 있다. 격납고의 `variant: 'window'` 는 이 화면의
기본형이 아니다.

⚠️ **그래서 이 화면의 진짜 과제는 반대 방향이다**: 배경이 넓게 보이는 만큼, 그 위에 얹힌
**48행 목록의 가독성이 배경 때문에 떨어지지 않게** 눌러야 한다. 격납고 계약 §0-bis-3 의
"정보 밀도가 이 화면의 목적이다. 배경·연출이 가독성을 낮추면 그 처방이 틀린 것이다"가
여기서도 그대로, 오히려 더 강하게 적용된다.

### 확정 판단 (재개 시 이 전제로 만든다)

- **본문 패널 = `variant: 'slab'`.** 불투명 석재. 배경(눌린 상태)보다 밝아야 물체로 선다 —
  figure-ground 는 테두리가 아니라 **면의 밝기**가 만든다.
- **창은 뚫지 않는다.** 패널 밖 57%가 이 화면의 키아트 노출분이다.
- **헤더는 배경이 그대로 보이는 띠**(§0-bis — 각인 석재 인방 금지). 제목 새김과 재화 칩이
  얹히므로 **글자 대비 4.5:1 이 성립할 만큼**만 누르고, 완전히 눌러 검게 만들지 않는다.
- 패널 폭은 **넓히는 방향으로 재검토**한다. 현재 행 설명의 `wordWrapWidth` 가
  `BOX.w - textX - ROW_CTRL_W - 32` 로 이미 빡빡하다(§6-2). 폭을 줄이는 처방은 금지.

## 2. 레이아웃 (재개 시 확정 — 초안)

디자인 스페이스 1920×1080. 아래는 초안이며, 격납고의 최종 헤더 높이·여백 어휘와 맞춘 뒤
확정한다(형제 화면끼리 헤더 밴드 높이가 다르면 화면 전환에서 튄다).

| 요소 | x | y | w | h | 비고 |
| --- | --- | --- | --- | --- | --- |
| 헤더 밴드(배경 노출) | 0 | 0 | 1920 | 104 | 격납고와 **같은 값**을 쓴다 |
| 본문 패널(slab) | (확정 대기) | 124 | (확정 대기) | (확정 대기) | 폭은 현재 1000 이상 |
| 힌트 줄 | 중앙 | 1058 | — | — | 패널 바닥 아래 |

- 좌우 여백·거터·행 간격은 격납고 최종값(32 / 28 / 20 / 28)을 승계한다.
- 패널 접지 그림자는 아래로 최대 48px 번진다 — 힌트 줄과 겹치지 않게 배치한다.

## 3. 크롬 교체 대응표

| 현재 | 교체 후 | 근거 |
| --- | --- | --- |
| `makeBanner(ui_banner.png)` | `makeHangarTitle` 계열 각인 제목 | 나무 배너 은퇴 |
| `nineSlicePanel(ui_panel.png)` | `makeCinematicPanel({variant:'slab'})` | 나무 nine-slice 은퇴 |
| `makeCurrencyChip(ui_chip.png)` ×3 | 유리+금테 재화 칩 | 크레딧·광물·**촉매 잔재** 3개 |
| `PixiButton(ui_btn_wood/yellow.png)` | `cinematicButtonTexture(tone)` **주입** | 버튼 로직 재사용 |
| `listRowBg` | (재검토) 석재 어휘 행 바탕 | §0-bis 괘선 금지에 유의 |
| `makeIconButton(ui_icon_close.png)` | 유지 검토 | 아이콘 자산은 은퇴 대상 아님 |

⚠️ **`PixiButton` · `makeSlotCell` 을 수정하지 말고 텍스처만 주입한다** — 그 컴포넌트들은 다른
화면 6곳이 쓰고 있다. `PixiButton({cap: 32})` 로 넘긴다.

⚠️ **행 바탕에 §0-bis 의 "괘선"이 재발하기 쉬운 자리다.** 48행이 세로로 쌓이므로 행 사이
구분선을 그으면 정확히 사용자가 삭제를 지시한 "표의 괘선"이 된다. 행 구분은 선이 아니라
**면의 밝기 차·접지 그림자**로 만든다.

## 4. 재사용 모듈 인터페이스 (⚠️ 머지 후 실물로 갱신 — 아래는 격납고 계약 문서 기준의 기대값)

```ts
// cinematicPanel.ts — 석재 슬래브 패널
makeCinematicPanel({ width, height, variant: 'slab' | 'window', title?,
                     screenX?, screenY?, lightOrigin? }): CinematicPanel
//   .container / .box{x,y,w,h,right,bottom} / .headerBottom / update(dt) / destroy()

// hangarChrome.ts — 크롬
makeHangarTitle(text): Container
makeHangarChip(w, h, value, icon, tone: 'gold'|'teal'): Container
cinematicButtonTexture(tone: 'stone'|'gold'|'red'|'blue'): Texture | undefined
chromeFallbackColor(tone) / chromeLabelColor(tone): number
cinematicSlotTexture(highlight, variant): Texture | undefined
makeSlotContactShadow(...)

// hangarBackdrop.ts — 배경
new HangarBackdrop(tex, { windows: HangarWindowRect[], headerH }): { view, update(dt), destroy() }

// hangarTextures.ts
HANGAR_BACKDROP_NAME / HANGAR_ASSET_NAMES / hangarAssetUrl / loadHangarTextures
```

**미해결 질문(머지 시 판단)**: 이 화면이 격납고 배경 자산(`hangar_backdrop.webp`)을 그대로 쓸
것인가, 전용 배경을 새로 만들 것인가. 하위 화면이 상위와 같은 방을 보여주면 "같은 공간의 다른
설비"로 읽혀 자연스럽지만, 세 하위 화면이 전부 같으면 단조롭다. **자산을 추가하면 양방향 결손
가드 + 용량 예산이 필수**다(`tests/hangarAssetPresence.test.ts` 형태).

## 5. 이 화면 고유 과제

1. **서버 재조회 화면이다.** `refreshInventory()` 가 `fetchCatalystInventoryOnline` +
   `fetchCatalystResidueOnline` 을 돈다. 조회 실패 = 오프라인 세션이고 **버튼을 전량 잠그고
   안내 문구를 낸다**. 이 경로를 깨뜨리면 안 된다.
2. **재렌더 규율(계획 §5 HIGH-3)** — `render()` 는 루트 자식을 전부 파괴·재생성하고 48행을
   전량 addChild 한다(가상화 없음). `Text` 가 `resolution: 2` 라 인스턴스마다 텍스처 업로드가
   난다. **스테퍼는 `rowRefs` 로 해당 행의 `Text.text` 와 버튼 활성만 갈아끼우고 `render()` 를
   부르지 않는다.** ⚠️ 시네마틱 패널·배경을 얹으면 `render()` 비용이 더 커지므로 이 규율이
   **더** 중요해진다. 새로 얹는 장식도 스테퍼 경로에서 재생성되면 안 된다.
3. **`update(dt)` 배선.** `cinematicPanel`·`HangarBackdrop` 은 벽시계 `dt` 를 받는 애니메이션
   객체다. 현재 `CatalystArchiveScreen` 에는 틱 루프가 **없다**(정적 화면). 격납고가 어떻게
   하위 화면에 dt 를 흘리는지 확인해 배선하고, `hide()` 에서 반드시 `destroy()` 한다.
4. **하위 화면 규약**: 격납고와는 `show()`/`onClose`. 격납고가 `suspend()`/`resume()` 로 자리를
   주고받는다. `show()` 로 되돌리면 미저장 편집이 날아간다.
5. **`raise()`** — `stage.setChildIndex(root, children.length - 1)`. 배경을 root 맨 뒤에 붙여도
   이 규율이 유지돼야 한다.

## 6. 기능 불변식 — 깨면 즉시 불합격

1. **등급 색은 파밍 시각 언어다.** `RARITY_COLOR_NUM` / `SLOT_RARITY_COLOR_NUM` 값을 바꾸지
   마라. `theme.ts` 헤더에 ΔE 실측 근거가 있다.
2. **행 세로 예산은 순수 모듈이 정본이다.** `catalystShopView.ts` 의 `ROW_H`(136) ·
   `ROW_CTRL_W`(220) · `INFO_Y` · `INFO_LINE_H` · `NOTE_LINE_H` · `noteLayout()` 을 화면이
   가져다 쓴다. **설명과 하단 문구의 세로 예산은 같은 산술 하나에서 파생돼야 한다** — 서로
   모르는 상수로 따로 박으면 한쪽 줄 수가 늘 때 조용히 겹친다(실제로 겹쳤다). 폭을 바꾸면
   줄 수가 바뀌므로 **패널 폭 변경은 이 예산 재검증을 동반한다**.
3. **하단 문구는 실측 높이로 하단 정렬**(`placeNote`). 캔버스 없는 환경에서 `Text.height` 가
   던지면 `NOTE_FALLBACK_Y` 로 안전 폴백.
4. **휠 스크롤은 클립 Container 에**(`makeScrollArea`). 마스크 Graphics 에 걸면 영영 안 불린다.
5. **목록 행 클릭은 행 컨테이너에.** 마스크 Graphics 는 히트 테스트에서 빠진다.
6. **분해·구매 동시 클릭 가드**(`busy`)를 유지한다. 과분해는 되돌릴 수 없다.
7. **필터 탭 3종**(전체·공용·특산)과 전 카탈로그 48행 진열을 유지한다. 보유분만 그리면
   신규 플레이어에게 `signature` 탭이 통째로 빈 목록이 된다.
8. **거부 사유 매핑**(`buyRejectKey`·`salvageRejectKey`)의 default 분기는 **구매** 실패다.
   ⚠️ 하네스 인메모리 모의 게이트웨이는 서버 `note` 를 내지 않아 **화면 검증이 이 분기를 그냥
   통과시킨다**(PR#215 에서 실제로 통과했다). 검증을 통과했다고 이 경로가 확인된 게 아니다.

## 7. 완료 기준 (협상 대상 아님)

- **하네스 실화면 스크린샷**으로 확인. 품질 티어 `high` 고정 · 탭 포그라운드 확인 · 커서를
  프레임 밖으로.
  - `npx vite --port 5189 --strictPort` → `http://localhost:5189/?harness=1`
  - `localStorage.setItem('pb.graphics', JSON.stringify({quality:'high'}))`
  - `__pb.harness.preset('maxed')` · `__pb.harness.goto('inventory')` → 촉매 버튼 클릭
  - in-app Browser pane 은 hidden 이라 스크린샷이 안 나온다 — **Chrome DevTools MCP** 를 써라.
- **엄격한 비평 서브에이전트**가 실화면 스크린샷을 픽셀 단위로 실측해 AAA 판정. 기본 입장은 불합격.
- 자산을 추가했으면 **양방향 결손 가드** + 용량 예산.
- **테스트 추가 후 `tsc` 재실행 필수** — 이 리포는 vitest 그린인데 빌드가 깨지는 함정을 반복해
  밟았다(node-shims 미선언).
- `pnpm test` 전체 · `npx tsc --noEmit` · `npx eslint src --max-warnings 0`.
- 전체 스위트의 기존 적색은 **수와 파일이 같은지** 기준선과 대조해 회귀가 아님을 증명한다.
  2026-08-02 기준 `origin/main` 적색은 **8파일 58건**: commissionBandMeasure 6 · denoFixture 1 ·
  encounterHashInvariance 10 · fullRun 3 · invasionBalance 8 · planetPopularity 1 ·
  planetTierCompletion 2 · shipHashBaseline 27.
  ⚠️ 격납고 머지 후 기준선이 **바뀔 수 있다** — 재개 시 기준선을 다시 뜬다
  (`git worktree add` 로 따로 만들어 돌린다, 각 18~20분).

## 8. 지표 운용 규율 (기지 7라운드 · 격납고 1라운드에서 산 교훈 — 승계)

1. 대리 지표를 **"균일해야 할 것의 상한"** 으로 주면 그림이 지워진다. **하한(보존)으로만 안전.**
2. **평균은 결함을 가린다.** 게이트는 `타일 최소` + `임계 미만 픽셀 비율`로.
3. **가정한 상수를 잰 픽셀로 착각**하면 지표가 참인 채로 틀린다 → 대비는 **곱연산(AO)** 으로.
4. **절대 델타는 곱연산 편차의 지표가 아니다**(`Δ = bg × (1−ratio)`).
5. **표본 정의가 다르면 반대 결론이 나온다** → 수 대신 **정의 비의존 속성**을 보고하게 하라.
6. **판정 기준은 스크린샷이고 수치는 대리 지표다.** 수치를 맞추다 화면이 나빠지면 수치를 버려라.
7. **처방을 레인에 내리기 전에 그 지표가 올바른 축을 재고 있는지 먼저 검토한다.**

## 9. 측정 도구

- **캔버스를 JS 로 직접 읽으면 전부 0 이 나온다**(합성 결과를 못 읽는다). 실측은 **스크린샷 PNG**로.
- 좌표 변환: `shot_x = design_x × 0.9115`, `shot_y = design_y × 0.9115 + 19`
  (캡처 1750×1022, 상단 레터박스 19px).
- 측정 스크립트 예시: `C:\Users\v0o0v\AppData\Local\Temp\haru-shots\measure.py`.
- 서브에이전트 트랜스크립트는 **만료된다.** 파일 헤더에 **왜**를 남겨라.
