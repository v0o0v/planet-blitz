<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# render/three3d — 오프스크린 3D

## 목적

**three.js 로 오프스크린 렌더한 결과를 Pixi 텍스처로 굽는 층.** 게임 본체는 2D 탑다운이지만
보스와 타이틀 함선은 GLB 모델로 존재감을 만든다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `stage3d.ts` | 런타임 3D 레이어 — 오프스크린 three.js → Pixi 텍스처 아틀라스 |
| `bossActor.ts` | 보스 3D 액터 — **페이즈별로 다른 연출**을 재생한다. 행성 보스 6종이 이 한 클래스를 공유 |
| `titleShip.ts` | 타이틀 화면 3D 함선 — `Stage3D` 와 **별개의 전용 오프스크린 렌더러** |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **Pixi v8 에서 캔버스를 텍스처로 쓰려면 `CanvasSource` 여야 한다** — 아니면 경고 없이 빈
  텍스처가 되어 "아무것도 안 보이는데 에러도 없는" 상태가 된다.
- 모델은 `assets/models/*.glb`(+ `manifest.json`)에서 로드한다. 새 모델은 `scripts/glb-prep.mjs`
  로 준비하고 매니페스트에 등록한다.
- **모델 자체가 노즐·발광부를 갖고 있을 수 있다.** 화면의 빛이 빌보드인지 모델 부품인지부터
  확인한다 — 정렬이 아니라 기준점이 틀린 것이 원인이었던 이력이 있다.
- 보스 연출은 자산이 아니라 `bossActor` 의 연출 파라미터로 만든다.

### 테스트 요구사항

`tests/modelManifest.test.ts` · `tests/commissionBossRender.test.ts`. 실물 확인은 `boss3d.html`
단독 페이지 또는 하네스에서 한다.

### 공통 패턴

- three.js 씬은 한 번 만들고 재사용한다(매 프레임 생성 금지 — 장시간 세션 메모리 누수).

## 의존성

### 내부

`assets/models/**` · `src/render/qualityTier.ts`

### 외부

`three` · `pixi.js`

<!-- MANUAL: -->
