# 타이틀 키아트 레이어

타이틀 화면(`src/ui/pixi/titleScreen.ts`)의 패럴랙스 배경 자산이다. **이 폴더의 `.webp` 가
진실**이고, 아래 절차는 재생성이 필요할 때를 위한 기록이다.

## 레이어 구성 (뒤 → 앞)

| 파일 | 크기 | 역할 |
| --- | --- | --- |
| `title_sky.webp` | 1376×768 RGB | 성운 하늘. 아치 창 뒤에서 가장 느리게 흐른다. |
| `title_planet.webp` | 1024×1024 RGBA | 봉인된 아카이브 행성. 창 안에서 하늘보다 조금 빠르게 흐른다. |
| `title_frame.webp` | 1376×768 RGBA | **아치 전경판.** 개구부(18.4%)만 투명하고 나머지는 불투명 — 이 한 장이 창틀이자 근경이다. |
| `title_logo.webp` | 1536×1024 RGBA | `PLANET BLITZ` 워드마크. 아치 아래 어두운 영역에 놓는다. |

3D 함선은 이 폴더가 아니라 `assets/models/ship_title.glb` 다(원장은 `assets/models/manifest.json`).

## 왜 배경 모델이 두 개인가

`gpt-image-2` 는 **16:9 를 못 낸다**(`1:1`/`3:2`/`2:3` 뿐). 그래서 화면을 채우는 배경
(마스터·하늘)은 `nano-banana-pro` 16:9 로, 종횡비가 자유로운 로고·함선 컨셉은
`gpt-image-2` 로 만들었다. 두 모델의 붓이 달라 **톤 정합은 별도로 관리**해야 한다.

두 모델 다 알파 채널을 못 내므로, 투명은 전부 `scripts/title-art-prep.mjs` 가 만든다.

## 재생성 절차

1. **마스터 키아트** — `nano-banana-pro`, `aspect_ratio: "16:9"`. 실제 출력은 1376×768 이라
   1920×1080 화면에서는 **1.4배 업스케일**된다(페인터리 화풍이라 하늘·성운은 견디지만
   근경 가장자리는 물러진다는 점을 감안할 것).
2. **아치 전경판** — 마스터에서 직접 뽑는다:

   ```
   node scripts/title-art-prep.mjs window <master.png> title_frame.png --inset 3 --feather 3
   ```

   ⚠️ **AI 로 실루엣 마스크를 따로 생성해 마스터에 씌우는 방식은 폐기했다.** 모델이 프레임을
   미묘하게 다시 그려서(마스크 콘텐츠 종횡비 1.662 vs 마스터 1.792) 아치 가장자리가 수십 px
   어긋난다. `window` 는 마스터 자신의 픽셀로 개구부를 판정하므로 정의상 정합한다.
3. **행성·로고** — 순검정 배경 위에 생성한 뒤 배경을 flood fill 로 제거한다:

   ```
   node scripts/title-art-prep.mjs keyblack <src.png> <out.png>
   ```
4. **WebP 인코딩** — `scripts/` 는 의존성 0 규약이라 PNG 까지만 만든다. 마지막 한 단계는 별도다:

   ```
   python -c "from PIL import Image; Image.open('in.png').save('out.webp', quality=88, method=6, exact=True)"
   ```

   RGBA 는 `exact=True` 를 반드시 준다 — 없으면 완전 투명 픽셀의 RGB 가 재작성돼 가장자리에
   헤일로가 생긴다.

## 용량

PNG 합계 6.3MB → WebP 합계 **440KB**(14배). 타이틀은 앱의 첫 화면이라 여기가 첫 페인트
예산을 직접 먹는다. 레이어를 늘릴 때 이 숫자를 다시 재라.
