<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# render — PixiJS 렌더 계층

## 목적

**시뮬 스냅샷을 화면으로 옮기는 층.** 보간·레터박스·이펙트·환경 배경·오디오까지 포함하며,
sim 해시에 영향을 주지 않는다(자산 교체는 렌더 한정, 결정론 테스트로 확인됨). 여기서는
벽시계 시간·`Math.random` 을 써도 된다 — 결정론 규율은 `src/sim/**` 에만 걸린다.

게임은 **고정 1920×1080 디자인 공간**에서 저작되고 `app.ts` 가 레터박스로 맞춘다(업스케일 시
정수 배율로 픽셀아트를 지킨다).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `app.ts` | Pixi 부트스트랩 + 레터박스 스케일. `DESIGN_WIDTH/HEIGHT`, 렌더러 해상도 상한 |
| `entityRenderer.ts` | (2460줄) 스냅샷 → 스프라이트, 보간 포함. 렌더의 중심 |
| `textures.ts` | 절차적 플레이스홀더를 먼저 만들고 실 PNG 가 로드되면 슬롯만 교체 — **로딩 실패에도 게임이 죽지 않는다** |
| `autotile.ts` · `wallTexture.ts` | Wang 오토타일 지형 배경 / 엄폐 벽 타일링 |
| `radar.ts` | 우상단 플레이어 중심 레이더(ADR-0009 — 전체 지도가 아니다) |
| `hazardVisual.ts` | 해저드 시각 규칙 — 색 = 성질, 형태 = 상태 |
| `friendlyDisplay.ts` · `spriteAnimation.ts` | 아군·이익 오브젝트 표시 규약 / 루프 애니메이션 |
| `groundShadow.ts` | 접지 그림자 — 탑다운에서 공간감을 만드는 유일한 수단 |
| `shipFacing.ts` | 기체 스프라이트 각도(순수 함수, sim 비의존) |
| `screenShake.ts` | 트라우마 모델 화면 흔들림 |
| `ceremony.ts` | 유니크 드랍 세리머니 |
| `bossWarn.ts` | 보스 **예고 루프** — 등장 전부터 반복되다 등장하면 사라진다(끊기는 정적이 신호) |
| `defensePreview.ts` · `invasionBackdrop.ts` | 방어 배치 프리뷰(3레이어 정지 렌더) / 침공 배경·레이어 크로스페이드 |
| `graphicsSettings.ts` · `graphicsRuntime.ts` · `qualityTier.ts` | 품질 티어 시스템(ADR-0031) — 이펙트 게이팅의 단일 관문 |
| `audio.ts` · `soundScape.ts` · `musicDirector.ts` · `uiSound.ts` | 절차 합성 SFX / 런 사운드 관찰자 / BGM 존 디렉터 / 메타 UI 사운드 |
| `fpsMeter.ts` | 롤링 FPS 미터 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `effects/` | 전투 이펙트 8종 — 폭발·트레일·데미지 숫자·글로우 등 (`effects/AGENTS.md`) |
| `entity/` | 엔티티 AAA 비주얼(플레이어·적·해저드) (`entity/AGENTS.md`) |
| `env/` | 행성 환경 배경 레이어 5장 + 테마 (`env/AGENTS.md`) |
| `shaders/` | WebGL 필터(블룸·디졸브·시머·충격파) (`shaders/AGENTS.md`) |
| `three3d/` | 오프스크린 three.js → Pixi 텍스처(보스·타이틀 함선) (`three3d/AGENTS.md`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **시각 검증 전에 품질 티어를 high 로 고정한다.** 안 하면 꺼진 이펙트를 보고 판정하게 된다.
- 오디오는 **절차 합성 SFX 를 사용자가 전부 거부한 이력**이 있다 — 새 효과음은 CC0 실음원으로 간다
  (`assets/audio/`, 출처는 `CREDITS.md`).
- Pixi v8 규율: Sprite 에 자식을 붙이지 않는다(형제 + 변환 미러). 캔버스를 텍스처로 쓸 때는
  `CanvasSource` 여야 한다 — 아니면 **경고 없이 빈 텍스처**가 된다.
- 정보 요소(HP 바 등)를 `effectLayer` 에 붙이지 마라 — 이펙트 예산 단언이 그것까지 센다.
- 자산 스케일을 확인한다. "구려 보인다"의 절반은 64px 원본을 280px 로 늘린 것이었다.

### 테스트 요구사항

- 렌더 테스트도 node 환경 vitest 로 돈다(캔버스 스텁). **겹침·레이아웃은 못 잡는다** — 시각 회귀는
  하네스로 실제 화면을 봐야 한다. pane 이 비표시면 `ticker.update()` 로 프레임을 손으로 돌린다.
- 자산 존재 검사(`*AssetPresence.test.ts`)는 파일시스템을 훑으므로 `--changed` 가 놓친다 — 자산을
  추가·삭제했으면 직접 지정해 돌린다.

### 공통 패턴

- 순수 계산(기하·진행도·자세 추론)은 Pixi 를 import 하지 않는 별도 파일로 뽑아 잠근다.
- 무거운 필터·3D 는 티어 게이트 뒤에 두고, 실패하면 우아하게 폴백한다(shaders 의 graceful 팩토리).

## 의존성

### 내부

`src/sim/snapshot.ts`(읽기 전용) · `src/ui/**` · `assets/**`

### 외부

`pixi.js` · `pixi-filters` · `three`

<!-- MANUAL: -->
