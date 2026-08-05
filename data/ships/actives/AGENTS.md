<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# data/ships/actives — 액티브 스킬 데이터

## 목적

기체 타입 7종 × **액티브 스킬 6종**의 데이터 정의(ADR-0041) — 계열 배속(3계열 × 2개), 해금 게이트,
쿨다운, 수치. **효과 함수는 여기 없다** — `src/sim/activeHandlers/` 에 있다.

액티브 스킬은 발동형이고 비용은 **쿨다운뿐**이다(자원·충전·HP 대가 없음). 열린 것 중 최대 2개를
출격 전에 장착한다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `index.ts` | **레지스트리 단일 정본** |
| `types.ts` | 레지스트리 스키마 |
| `striker.ts` · `bruiser.ts` · `arccaster.ts` · `phantom.ts` · `hatchling.ts` · `mallow.ts` · `bubble.ts` | 타입별 6종 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- 해금 게이트는 그 **계열의 base 누적 투자**(저티어 8 / 고티어 40)다. 계열 투자량이 늘수록
  장착 여부와 무관하게 그 계열 스킬 2종의 위력·쿨다운이 연속으로 개선되고, 이는 별도 저장 없이
  `skillInvest` 에서 파생한다.
- 할 수 있는 일은 **즉발 공격 · 이동기 · 짧은 자기버프** 3결뿐이다(설치물·소환·룰 변경 금지).
- 새 스킬을 추가하면 `src/sim/activeHandlers/<기체>.ts` 의 효과 함수와 아이콘 매핑이 함께 필요하다.

### 테스트 요구사항

`tests/activeSkills.test.ts` · `activeSkillWiring.test.ts` · `activeSkillUi.test.ts` ·
`activeSkillIcons.test.ts` · `activeSkillPowerScope.test.ts`.

### 공통 패턴

- 7파일이 같은 구조를 지킨다. 스키마는 `types.ts` 하나가 강제한다.

## 의존성

### 내부

`src/sim/activeHandlers/**` · `src/items/activeSkills.ts` · `data/inputBits.ts`

### 외부

없음.

<!-- MANUAL: -->
