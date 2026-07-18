# 하네스 씬 탭 개편 — 구현 계획 (autopilot, 2026-07-19)

기반: `.omc/autopilot/spec.md`. 대상: `src/harness/cheatPanel.ts` 단일 파일.

## 단계
1. **상태**: `activeTab: 'run'|'boss'|'fx'|'result'|'menus'|'guardian'|'inspect'` 클로저 추가(기본 'run'). 구 접이식 상태(openIntervene/openInspector/openGuardian) 제거.
2. **STYLE**: 탭 바(`.pb-c-tabs`/`.pb-c-tab`/`.on`) 스타일 추가.
3. **render() 재구성**:
   - 공통: h3 + 오염 배지 + 재생 미니바(배속/일시정지/틱 스텝/ff — 기존 관전 도구 압축) + 탭 바 + 탭 콘텐츠 + 힌트.
   - 탭별 빌더 함수 7개 — 기존 액션 함수(stageRun/sceneXxx/toggleInvincible/grantXxx/…) 재사용, 로직 무수정.
4. **검증**: tsc·eslint·vitest → 브라우저(탭 전환·씬 진입·탭 보존) → code-reviewer → PR → 머지.

## 리스크
- render 재작성 중 기존 버튼 누락 → 탭별 체크리스트로 전수 이관 확인(스펙 표 기준).
- 250ms 재렌더와 탭 상태 → 클로저 보존 패턴(기존 seedStr과 동일)으로 해소.
