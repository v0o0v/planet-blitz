<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# render/effects — 전투 이펙트

## 목적

전투 순간의 피드백을 만드는 이펙트 모음(ADR-0031 "규율 있는 하이브리드 글로우"의 combat 레지스터).
전부 렌더 전용이며 품질 티어 게이트를 통과해야 실행된다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `explosion.ts` | 파편 버스트 사망 폭발 |
| `bulletTrail.ts` | 탄 트레일 — 가산 스트릭 짧은 꼬리 |
| `muzzleFlash.ts` | 발사 순간 총구 섬광 |
| `damageNumber.ts` | 데미지 숫자 팝업 |
| `grazeSpark.ts` | 그레이징(스침) 스파크 — 보상은 없고 회피 감각 연출만 |
| `pickupPop.ts` | 젬·전리품 수집 팝 + 레벨업 링 |
| `glow.ts` | 발광체 글로우 — 가산 헤일로 + High 티어에서 타이트 블룸 |
| `shaderEffects.ts` | 이벤트 셰이더 이펙트 컨트롤러 3종(`../shaders/` 필터를 구동) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **가산(additive) 광채는 앞/뒤 합성 순서가 수치와 한 몸이다** — 순서를 바꾸면 같은 알파에서
  전혀 다른 밝기가 나온다.
- 이펙트 총량은 예산으로 잡혀 있다. 정보 요소(HP 바·이름표)를 이 레이어에 얹으면 예산 단언이
  그것까지 세어 엉뚱하게 실패한다.
- 티어 게이팅은 `../qualityTier.ts` 한 곳에서만 한다 — 각 이펙트가 자기 판단으로 켜고 끄지 않는다.

### 테스트 요구사항

`tests/combatFeedbackWiring.test.ts` · `combatExtrasWiring.test.ts` · `bulletTrail.test.ts` 등
배선 테스트. 실제 룩은 하네스 갤러리(`src/harness/gallery/`)에서 변형군을 나란히 놓고 본다.

### 공통 패턴

- 풀링된 파티클 + 수명 기반 갱신. 모듈 스코프 배열을 쓰는 파일이 있으므로 **파일 간 상태 누수**에
  주의한다(vitest `isolate:false` 를 안 쓰는 이유가 이것이다).

## 의존성

### 내부

`src/render/qualityTier.ts` · `src/render/shaders/**`

### 외부

`pixi.js` · `pixi-filters`

<!-- MANUAL: -->
