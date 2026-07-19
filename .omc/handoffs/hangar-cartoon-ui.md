# 격납고 카툰 UI 구현 핸드오프 (2026-07-19, 목업 v5 승인)

계획: `.omc/plans/hangar-cartoon-ui-pilot.md` (인터뷰 확정 10개 결정 포함 — 반드시 읽을 것).
승인 목업: `C:\Users\v0o0v\AppData\Local\Temp\haru-shots\hangar\hangar-mockup.png` (사용자 승인 완료 — 이 레이아웃 그대로).
목업 합성 스크립트(레이아웃 좌표·9-slice 파라미터의 소스): 세션 스크래치패드 `build_mockup.py` 참고 사본 아님 — 아래 사양이 정본.

## 자산 (assets/ 에 배치 완료, 로더는 src/render/textures.ts 의 assets/*.png glob 패턴과 동일 방식)

| 파일 | 크기 | 용도 | 9-slice 테두리 |
|---|---|---|---|
| ui_panel.png | 300×300 | 나무 패널 프레임 (중앙은 투명 — 어두운 내부(#1c182e 계열, alpha 245)를 코드로 깔 것) | 46px 사방 |
| ui_banner.png | 462×54 | 타이틀바(빨간 배너) | 좌우 캡 40px, hstretch(가로만) |
| ui_btn_red/blue/yellow/wood.png | ~140×48 | 무지 버튼 (텍스트는 코드로) | 좌우 캡 30px, hstretch |
| ui_chip.png | 187×44 | 재화 칩 | 좌우 캡 24px |
| ui_slot.png / ui_slot_hl.png | 84×84 | 아이템 슬롯 / 강조 슬롯 | 통짜 스케일 (9-slice 불필요) |
| ui_icon_*.png ×16 | 64×64 | close/coin/crystal/star/lock/salvage/expand/arrow_left/arrow_right/gear/upgrade/shield/rocket/check/search/trash | 통짜 |
| ship_showcase_fighter.png | 128×128 | 기체 쇼케이스 (×2 nearest 확대해 표시) | 통짜 |

렌더: 전부 `scaleMode='nearest'` (픽셀아트). Pixi `NineSliceSprite` 사용.

## 레이아웃 (1920×1080 디자인 스페이스, src/render/app.ts DESIGN_WIDTH/HEIGHT·레터박스 정수배 스케일 그대로)

- 배경: 단색 #181426 (별 장식 금지 — 사용자 피드백).
- 상단: 타이틀바(배너 760×72, 중앙, "격납고" 텍스트), 좌우에 재화 칩(크레딧 coin·광물 crystal) — 칩은 190×52, **아이콘 왼쪽 고정(x+14), 값은 남은 자리 가로·세로 중앙 정렬**. 우상단 close X 아이콘(56px) = 닫기 버튼.
- 좌상(24,88, 900×520): 기체 스탯 패널. 제목 "기체 스탯"(좌상단, 프레임에서 x+60/y+52 여백). 스탯 행: 이름(크림 #ebdcbe)+값(골드 #ffd678, x+440 정렬)+아래 1줄 설명(회갈 #aa9b87, 18px). 행 간격 50px. 원소 강도는 **한 줄에 하나씩**, 스탯과 같은 컬럼 정렬, 원소색(화염 #ff783c·냉기 #6ebeff, 0이면 숨김). 계보 기체 보너스·유니크 효과 목록도 조건부 표시(plan 결정 7).
- 우상(944,88, 952×520): 기체 쇼케이스 패널. 제목 = 기체명·계보. 중앙에 기체 일러스트 ×2. 장착 8슬롯(72px)을 **좌 4·우 4 컬럼**으로 배치(y 간격 100), **라벨은 슬롯 바깥쪽**(좌 컬럼은 슬롯 왼쪽 anchor rm, 우 컬럼은 오른쪽 anchor lm). 각 슬롯에서 기체 부위로 금색(255,214,120,150) 연결선 3px.
- 좌하(24,652, 900×404): 창고(96칸, 스크롤 마스크 컨테이너 — **스크롤바 시각 요소는 그리지 않음**, 휠 스크롤만). 제목 "창고 n / cap". **창고 확장 버튼(200×48, 파랑)은 패널 우상단**(프레임 침범 금지).
- 우하(944,652, 952×404): 인벤토리(48칸, 8열). 제목 "인벤토리 n / 48". **일괄 분해 버튼(빨강)은 패널 우상단**.
- 슬롯 셀 66~74px, 간격 8px. 등급 테두리: 기존 RARITY_COLOR 문법 유지(normal #b8c2d8 / magic #6aa0ff / rare #ffd24c / unique #ff8a3c) — 슬롯 위 rounded 테두리 3px.
- 툴팁: **어두운 바탕(#18142880%+) + 등급색 3px 프레임 + 바깥 다크 아웃라인** (나무 텍스처 스트레치 금지 — 사용자 피드백). 내용: 아이템명(등급색)·슬롯/등급·어픽스 목록·장착 장비 비교(기존 InventoryOverlay.showTip 동등).
- 폰트: Pixi Text, 한글 지원 시스템 폰트 스택("Malgun Gothic", sans-serif), 크기 목업 기준(제목 32, 행 26, 설명 18, 라벨 18). 텍스트에 2px 다크 섀도.

## 기능 동등성 (src/ui/inventory.ts InventoryOverlay 와 1:1 — 코드 참조)

- 장착/해제(모듈 2슬롯 규칙 포함), 인벤 가득 시 힌트, 일괄 분해(노말+매직 / 레어+유니크 — 버튼 1개면 분해 대상 선택 UI 유지 필요: 기존은 버튼 2개였음 → 패널 우상단에 2버튼 나란히 배치 허용), 창고 확장(비용 stashExpansionCost, MAX_STASH_EXPANSIONS), 스탯 미리보기 computeLoadoutStats, 툴팁+비교, 재화 표시, i18n(t()) 전부 유지. Profile 변이 + saveProfile 호출 패턴 동일.
- 스탯 상세(plan 결정 7): 기존 10개 스탯 행 + 1줄 설명 + 원소 강도(화염/냉기/번개, 0 숨김) + 계보 보너스 + 유니크 효과. 설명 문구는 i18n 카탈로그에 키 추가.

## 구조

- `src/ui/pixi/` 공용 모듈: `nineSlicePanel(팬널)`, `PixiButton`, `SlotGrid`, `PixiTooltip`, `TitleBar` — 격납고 외 화면 확산을 전제로 재사용 가능하게(디자인 스페이스 좌표계, 텍스처 주입식).
- 격납고 화면: `src/ui/pixi/hangar.ts` (가칭). 기존 InventoryOverlay 는 유지하되 진입점에서 Pixi 격납고로 교체(플래그/치환 방식은 호출부 보고 판단 — src에서 InventoryOverlay 사용처 검색).
- UI 텍스처 로드: textures.ts 패턴처럼 glob + Assets.load, 없으면 procedural 폴백(Graphics)으로 우아하게.

## 검증

- `npm test` (vitest 664+) 통과. 게임 로직 회귀 0.
- 신규 로직(장착/분해/확장 등)은 기존 sim/save 함수 재사용이므로 새 단위 테스트는 UI-독립 헬퍼(레이아웃 계산 등)에만.
