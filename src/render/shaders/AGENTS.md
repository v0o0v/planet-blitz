<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# render/shaders — WebGL 필터

## 목적

Pixi 필터 4종 + 진행도 순수함수. 대부분 **손으로 짠 GLSL** 이고, 블룸만 `pixi-filters` 의
tree-shaken 래퍼다(ADR-0031).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `index.ts` | 셰이더 인프라 — **graceful 팩토리 허브**. WebGL 이 없거나 컴파일이 실패하면 null 을 돌려 호출부가 이펙트를 건너뛴다 |
| `bloom.ts` | `AdvancedBloomFilter` 래퍼(High 티어 전용) |
| `dissolve.ts` | 사망 디졸브 — 디더 알파 |
| `shimmer.ts` | 히트 시머 — 변위 |
| `shockwave.ts` | 충격파 링 — 반경 변위 |
| `progress.ts` | 셰이더 진행도 순수 함수(유닛 테스트 참조 구현) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **반드시 `index.ts` 의 graceful 팩토리를 거친다.** 필터를 직접 new 하면 WebGL 미지원 환경
  (node 테스트·저사양)에서 터진다.
- 시간에 따라 변하는 이펙트는 **한 프레임만 보고 맞추지 마라** — 위상마다 오차가 흔들려
  `time=0`(사용자가 보는 첫 프레임)에서 최대가 되는 결함 이력이 있다.
- 필터는 비싸다. 티어 게이트(`../qualityTier.ts`) 뒤에 둔다.

### 테스트 요구사항

`tests/shader*.test.ts` — 순수 진행도 함수와 팩토리 폴백을 잠근다. GLSL 자체는 하네스 갤러리에서
눈으로 본다.

### 공통 패턴

- GLSL 은 문자열 상수로 두고 uniform 갱신만 TS 에서 한다.

## 의존성

### 외부

`pixi.js` · `pixi-filters`(블룸만)

<!-- MANUAL: -->
