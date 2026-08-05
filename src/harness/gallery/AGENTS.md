<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# harness/gallery — 프로토타입 갤러리

## 목적

이펙트 **변형군을 한 화면에 나란히 놓고 고르는 DEV 전용 씬**(그래픽 이펙트 Phase 1, ADR-0031).
"이 폭발이 나은가 저게 나은가"를 말이 아니라 화면으로 결정하기 위한 도구다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `galleryScene.ts` | 갤러리 씬 본체 |
| `index.ts` | 변형 레지스트리 — **새 변형군은 여기에 등록한다** |
| `types.ts` | 변형 계약 |
| `explosionVariants.ts` | 파티클 폭발 변형군 |
| `glowVariants.ts` | 글로우·블룸 룩 변형군 |
| `shockwaveVariants.ts` | 충격파 링 변형군 |
| `dissolveVariants.ts` | 사망 디졸브 변형군 |
| `ceremonyVariants.ts` | 보상 세리머니 변형군 |
| `transitionVariants.ts` | 메타 화면 전환 변형군 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- 채택된 변형은 `src/render/effects/**` 로 옮기고, 갤러리에는 비교 이력을 남긴다.
- **시각 판정 전에 품질 티어를 high 로 고정한다** — 안 하면 꺼진 이펙트를 보고 고르게 된다.
- DEV 전용이므로 프로덕션 코드가 이 디렉터리를 정적 import 하면 안 된다.

### 테스트 요구사항

레지스트리 존재·계약 준수만 잠근다. 룩 자체는 사람이 본다.

### 공통 패턴

- 변형은 `types.ts` 의 계약을 구현하는 순수 데이터 + 팩토리 쌍이다.

## 의존성

### 내부

`src/render/effects/**` · `src/render/shaders/**` · `src/render/qualityTier.ts`

### 외부

`pixi.js`

<!-- MANUAL: -->
