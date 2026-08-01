# 세계관 인트로 키아트

첫 실행 인트로 4컷(`src/ui/pixi/introSlides.ts`)의 풀블리드 배경이다. **이 폴더의 `.webp` 가
진실**이고, 아래 절차는 재생성이 필요할 때를 위한 기록이다.

## 파일

| 파일 | 크기 | 컷 |
| --- | --- | --- |
| `intro_collapse.webp` | 1376×768 RGB | 1 — 오스카 문명의 붕괴 |
| `intro_records.webp` | 1376×768 RGB | 2 — 기록만이 유일한 화폐 |
| `intro_archives.webp` | 1376×768 RGB | 3 — 봉인된 여섯 세계 |
| `intro_launch.webp` | 1376×768 RGB | 4 — 이제 당신이 출격할 차례 |

파일명은 **`intro_<슬라이드 id>.webp`** 다. id 정본은 `data/lore/index.ts` 의 `INTRO_SLIDES`
이고, 로더(`src/ui/pixi/introTextures.ts`)가 그 배열에서 목록을 파생한다 — 컷을 추가하면
`tests/introAssetPresence.test.ts` 가 아트 결손을 먼저 신고한다.

## 재생성 절차

1. **생성** — `nano-banana-pro`, `aspect_ratio: "16:9"`(9 크레딧/장). `gpt-image-2` 는 16:9 를
   못 낸다(`1:1`/`3:2`/`2:3` 뿐). 실제 출력은 1376×768 이라 1920×1080 화면에서 **1.4배
   업스케일**된다.
2. **알파가 필요 없다** — 인트로 키아트는 풀블리드 불투명이라 `title-art-prep` 의 `keyblack`·
   `window` 단계가 없다. 다운로드 → WebP 인코딩이 전부다.
3. **WebP 인코딩** — `scripts/` 는 의존성 0 규약이라 이 한 단계는 별도다:

   ```
   python -c "from PIL import Image; Image.open('in.png').convert('RGB').save('out.webp', quality=86, method=6)"
   ```

   불투명 RGB 라 `exact=True` 는 불필요하다(그 옵션은 완전 투명 픽셀의 RGB 보존용).

## 함정

- **Meshy 가 확장자는 `.png` 인데 실제로 JPEG(`FF D8`)를 내려줄 때가 있다.** 4컷 중 3컷이
  그랬다. Pillow 는 알아서 읽지만 리포의 `scripts/lib/png.mjs` 는 "not a PNG" 로 죽는다.
- 프롬프트에 **"hand-painted" 를 쓰지 마라** — 캔버스 천에 그린 유화를 찍은 사진이 나온다.
  `painterly digital concept art` 를 쓰고 `no canvas texture / no picture frame / no border /
  no text` 를 명시한다.
- 프롬프트 길이 상한은 **600자**다(Meshy MCP 검증).
- **구도 제약이 곧 가독성이다.** 문구가 하단 스크림 위에 얹히므로 프롬프트에 "주요 피사체는
  상단 2/3", "하단 1/3 은 어둡고 단순하게"를 반드시 넣는다. 안 넣으면 글자가 디테일 위에 얹혀
  스크림을 아무리 짙게 해도 읽히지 않는다.

## 팔레트

타이틀(`assets/title/`)과 **같은 붓**이어야 한다: 청록·자홍 성운, 금빛 고대 석재, 짙은 실루엣,
페인터리 디지털 페인팅. 프롬프트에 `muted gold, deep teal, magenta` 를 못 박아 맞췄다
(`meshy_image_to_image` 로 레퍼런스를 넣는 경로는 **항상 1024 정사각**만 내므로 16:9 에는
쓸 수 없다).

## 용량

WebP 합계 **269KB**(PNG 원본 3.1MB). 인트로는 첫 실행 사용자가 타이틀보다 **먼저** 보는
화면이라 여기가 첫 페인트 예산을 직접 먹는다. 컷을 늘릴 때 이 숫자를 다시 재라 —
`tests/introAssetPresence.test.ts` 의 상한은 500KB 다.
