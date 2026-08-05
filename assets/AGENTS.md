<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# assets — 게임 자산

## 목적

스프라이트·키아트·타일셋·3D 모델·오디오. 렌더 계층만 이것을 읽으며 **sim 해시에 영향이 0** 이다.

`src/render/textures.ts` 가 절차적 플레이스홀더를 먼저 만들고 실 PNG 가 로드되면 해당 슬롯만
교체한다 — 로딩 실패에도 게임이 죽지 않고, 존재하지 않는 PNG 슬롯은 자동으로 플레이스홀더를
유지한다(`import.meta.glob` 정적 수집).

## 구성

| 위치 | 내용 |
|---|---|
| `assets/*.png` | 픽셀아트 스프라이트 — 기체·적·보스·젬·이펙트·촉매/액티브/장비 아이콘. **PixelLab**(pixellab-forge)으로 생성 |
| `audio/` | BGM 6트랙 + 스팅어(`.mp3`/`.ogg` 쌍). **CC0 1.0** — 출처는 `CREDITS.md` |
| `audio/sfx/` | 효과음 9종 — 발사음 5·피격·카드·보스 예고·일일 보상. **CC0 실음원**(절차 합성은 사용자가 거부했다) |
| `tilesets/` | 행성 6종 + 침공 3레이어 타일셋(`.png` + `.json`) |
| `models/` | 보스 9종 + 타이틀 함선 `.glb` + `manifest.json` |
| `base/` · `hangar/` · `title/` · `intro/` | 시네마틱 키아트 `.webp`(각 디렉터리에 `README.md`) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **라이선스를 분리해 적는다.** 리포는 독점 저작물이지만 `assets/audio/**` BGM 6트랙은 CC0 다.
  다른 라이선스 자산이 들어오면 `LICENSE` 의 제3자 자산 절에 반드시 적는다 — 안 적으면 독점 고지가
  남의 자산까지 덮는 것처럼 읽힌다.
- **"번들에 있다"는 표시된다는 증명이 아니다.** 자산을 추가했으면 실화면에서 확인한다.
- 픽셀아트는 `scaleMode:'nearest'` + 정수 배율. 원본 해상도와 표시 크기의 비를 확인한다 —
  64px 을 280px 로 늘려 "구려 보인" 이력이 있다.
- 새 효과음은 **CC0 실음원**을 먼저 찾는다(절차 합성 금지).
- PixelLab 생성물은 세션 마감 때 `pixellab-forge` 라이브러리 리포에 동기화한다(전역 캐시는 git 이 아니다).
- 자산 준비는 `scripts/asset-prep.mjs`·`title-art-prep.mjs`·`tileset-gen.mjs`·`glb-prep.mjs` 로 한다.

### 테스트 요구사항

`tests/*AssetPresence.test.ts` 가 파일 존재를 잠근다. **파일시스템을 훑으므로 `--changed` 가
놓친다** — 자산을 추가·삭제했으면 직접 지정해 돌린다.

## 의존성

### 내부

`src/render/textures.ts`(로더) · `src/ui/pixi/*Textures.ts`(화면별 로더) · `scripts/**`(준비)

<!-- MANUAL: -->
