<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# render/entity — 엔티티 AAA 비주얼

## 목적

플레이어 기체·적·해저드의 **표현 계층**. 위협도 계층, 손상 상태, 예비 동작(telegraph), 스폰 인,
사망 연출, 군집 가독성 같은 "읽히는 전투"를 만든다. 계약은 `.omc/plans/entity-aaa-contract.md`.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `index.ts` | **AAA 비주얼 모듈을 프로덕션 그래프에 붙이는 유일한 지점**(등록 허브) |
| `adorner.ts` | 엔티티 장식자 심(seam) — 공유 파일을 건드리지 않고 장식을 얹는 확장점 |
| `playerVisual.ts` | (2185줄) 플레이어 비행체 비주얼 |
| `playerVisualFlags.ts` | 플레이어 비주얼 항목별 on/off 스위치 |
| `enemyVisual.ts` | (1313줄) 적 기체 비주얼 |
| `enemyParts.ts` | 적 장식의 기하 조립기 — **전부 절차적 `Graphics`**(신규 자산 0, GL 불필요, node 안전) |
| `enemyPosture.ts` | 적 자세 추론 — 순수 모듈, Pixi 를 import 하지 않는다 |
| `enemyHpBar.ts` | 적 머리 위 HP 바(사용자 요청 2026-08-04) |
| `hazardHost.ts` | 해저드 렌더 진입점 — 장판 그리기와 재질 확장점을 한곳에 모은다 |
| `hazardShape.ts` | 해저드 재질의 **순수 기하**(Pixi 없이 계산되는 부분) |
| `hazardField.ts` · `hazardTexture.ts` | 장판 재질 / 절차적으로 굽고 전 장판이 나눠 쓰는 공유 텍스처 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **`index.ts` 를 거치지 않은 모듈은 프로덕션 화면에 안 뜬다.** 새 비주얼을 만들었는데 안 보이면
  등록 허브부터 확인한다.
- 순수 기하(`hazardShape.ts`)와 Pixi 조립(`hazardField.ts`)의 분리를 유지한다 — 그래야 node
  환경에서 단위 테스트가 가능하다.
- `enemyVisual.ts` 는 모듈 스코프 상태(`debris` 등)를 들고 있다. 파일 경계를 넘어 살아남으면
  destroy 된 노드를 굴려 터진다 — 정리 경로를 반드시 같이 손본다.
- HP 바 같은 **정보 요소는 effectLayer 에 붙이지 않는다**(이펙트 예산 단언이 그것까지 센다).

### 테스트 요구사항

`tests/enemyVisual.test.ts`(**main 에서 이미 빨간 12건 중 하나**) · `spriteAnimation.test.ts` ·
`hazard*.test.ts`. 실제 룩은 하네스에서 확인한다.

### 공통 패턴

- 자산 없이 절차적 `Graphics` 로 만드는 것을 기본으로 한다 — 신규 자산 비용 0, node 테스트 가능.

## 의존성

### 내부

`src/sim/snapshot.ts`(읽기) · `src/render/qualityTier.ts` · `src/render/effects/**`

### 외부

`pixi.js`

<!-- MANUAL: -->
