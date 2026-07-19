# "카툰나무풍" UI 세트 확산 롤아웃

2026-07-19 격납고 파일럿 통과(사용자 플레이 판정 승인, PR #62~#65). 남은 메타 화면을
한 세션에 하나씩 카툰나무풍으로 이관한다. 각 세션은 **pixellab-forge `cartoon-wood-ui`
스킬("카툰나무풍")을 먼저 발동**해 킷 자산·9-slice 파라미터·함정 체크리스트를 따른다.

## 공통 규칙 (모든 화면 세션)

1. 공용 모듈 `src/ui/pixi/` (nineSlicePanel·PixiButton·slotGrid·PixiTooltip·titleBar) 재사용 — 새 부품이 필요할 때만 추가하고 공용으로 설계.
2. 기존 DOM 클래스는 삭제하지 않고 유지(회귀 대비), 공개 인터페이스(show/hide/visible) 동일하게 맞춰 main.ts 호출부 무변경 교체.
3. 목업 승인 게이트: 실 자산 합성 1920×1080 목업 → 로컬 http 서버 → 사용자 브라우저 승인 후 구현.
4. 완료 전 스킬의 "목업-구현 정합 체크리스트" 7항목 수행(1920×1080 스크린샷 대조 · 프레임 침범 0 · 반토막 0 · dpr>1 리사이즈 · DOM 겹침 · Text resolution 2 · 사용자 플레이 판정).
5. 브랜치 `feat/cartoonwood-<화면>` → PR → 머지. 병렬 세션이면 워크트리 분리.

## 화면 순서 (한 세션 = 한 화면)

| # | 화면 | 파일 | 메모 |
|---|---|---|---|
| 1 | 기지 맵 (BaseMap) | `src/ui/baseMap.ts` | 허브 — 첫인상 효과 최대. 건물 버튼들을 나무 패널+아이콘으로. **이 세션에서 ADR "메타 UI DOM→Pixi 이관"도 작성**(plan hangar-cartoon-ui-pilot §6). |
| 2 | 연구소 (ResearchLab) | `src/ui/researchLab.ts` | 연구 트리 노드·진행바. 노드 아이콘은 캐시 `node_*` 재사용 검토. |
| 3 | 정제소 (Refinery) | `src/ui/refinery.ts` | 재화 변환 UI — 칩·버튼 중심이라 이관 난도 낮음. |
| 4 | 행성 선택 (PlanetSelect) | `src/ui/planetSelect.ts` | 출격 전 화면. 행성 카드 패널화. |
| 5 | 정산 (ResultOverlay) | `src/ui/resultOverlay.ts` | 런 종료 보상 — 슬롯 그리드·등급색 재사용. |
| 6 | 관제탑 (ControlTower) | `src/ui/controlTower.ts` | 침공 결과 뷰 포함 — 표 형태 콘텐츠 많음. |
| 7 | 카드 상점 (CardsView) | `src/ui/cardsView.ts` | 서버 권위 구매 경로 주의(CORS/거부 코드 매핑 기존 작업 참조). |
| 8 | 설정 (SettingsPanel) | `src/ui/settingsPanel.ts` | 소형 — 마지막. |

- **보류**: DefenseCommand(방어 사령부)는 실화면 편집 대공사(PR #57~59) 직후라 안정화 기간을 두고 마지막에 별도 판단.
- 인런 오버레이(HUD·파워업·튜토리얼)는 이번 롤아웃 범위 밖(게임플레이 가독성 언어 별도 검토 필요).

## 좌표

- 파일럿 산출물: `src/ui/pixi/` + `assets/ui_*.png` (앵커 `pb-cartoon-wood-ui`)
- 세트 정본: pixellab-forge `skills/cartoon-wood-ui/SKILL.md` (v0.2.2+) · README "UI 세트 레지스트리"
- 파일럿 계획·교훈: `.omc/plans/hangar-cartoon-ui-pilot.md`, `.omc/handoffs/hangar-cartoon-ui.md`
