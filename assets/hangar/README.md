# 격납고 화면 시네마틱 자산

격납고(`src/ui/pixi/hangar.ts`)의 배경 아트다. **이 폴더의 `.webp` 가 진실**이고, 아래는
재생성이 필요할 때를 위한 기록이다.

## 파일

| 파일 | 크기 | 역할 |
| --- | --- | --- |
| `hangar_backdrop.webp` | 1376×768 RGB | 오스카 유적 정비 도크 홀. 풀블리드 배경. |

목록 정본은 `src/ui/pixi/hangarTextures.ts` 의 `HANGAR_ASSET_NAMES` 이고,
`tests/hangarAssetPresence.test.ts` 가 목록 ↔ 실물을 **양방향**으로 대조한다.

## 배경이 "우측 도크 · 좌측 어둠" 인 이유 — 창 위치에 맞춘 설계다

기지 화면은 카드 8장이 배경 **위에 떠 있는** 구성이라 배경이 넓게 보였다. 격납고는 다르다:
패널 4장이 화면의 약 97% 를 덮는 **조작 화면**이라, 기지식 구성을 그대로 옮기면 아무리 잘
그린 배경도 보일 자리가 없다.

그래서 배경을 패널 **뒤**가 아니라 패널 **안**으로 들여왔다 — 기체 쇼케이스 패널을 불투명
채움이 아니라 **배경이 비치는 도크 창**(`variant: 'window'`)으로 뚫는다. 배경은 그 창 자리에
볼거리를 몰아 두도록 생성했다:

| 화면 영역 | 디자인 좌표 | 원본 좌표(커버 배율 1.406) | 원화 내용 |
| --- | --- | --- | --- |
| 헤더 밴드 | y 0..104 | y 0..74 | 아치 상단 + 성운 |
| **쇼케이스 창** | x 952..1888 · y 112..608 | x 682..1347 · y 79..432 | 정비 도크 · 크레인 · 금색 램프 |
| 패널이 덮는 자리 | 좌측 · 하단 | — | 의도적으로 어두운 석재(실측 L 34 이하) |

⚠️ 레이아웃 좌표(`hangar.ts` 의 패널 상수)를 바꾸면 이 대응이 어긋난다. 창이 옮겨가면 배경도
다시 설계해야 한다 — 톤매핑으로는 못 푼다(**없는 디테일은 만들 수 없다**, 기지 배경에서 확인).

실측(WebP 기준): 창 영역 L 평균 66.7(p05 31.7 / p95 109.5) · 헤더 밴드 L 평균 58.9 ·
헤더 좌측 절반 L 평균 34.2.

## 재생성 절차

1. **생성** — `meshy_text_to_image` `ai_model: "nano-banana-pro"` `aspect_ratio: "16:9"`
   (9 크레딧). 출력은 1376×768 PNG.
2. **JPEG 확인** — Meshy 가 확장자는 `.png` 인데 실제로 JPEG(`FF D8`)를 내려줄 때가 있다.
3. **WebP 변환** — `quality=86, method=6`. 그레이드 패스는 없다(단일 장이라 장간 통일 문제가
   원리적으로 없다 — 기지의 7장 감마 그레이드는 그 문제를 푸는 절차였다).

프롬프트 규칙:
- 길이 상한 **600자**(Meshy MCP 검증). 모델 인자는 `ai_model`(`model` 아님).
- `painterly digital concept art` 를 쓰고 **`hand-painted` 는 금지**(캔버스 천에 그린 유화를
  찍은 사진이 나온다). `no canvas texture / no frame / no border / no text` 명시.
- **"RIGHT HALF: 도크 / LEFT HALF and LOWER THIRD: 어두운 석재"** 를 못 박아라. 이 화면에서
  구도는 취향이 아니라 **레이아웃 계약**이다.
- 팔레트 문장 고정: `muted golden-ochre stone, deep teal and magenta, warm gold lamplight`.

실제로 쓴 프롬프트(1회 성공, 재시도 0):

> Painterly digital concept art: interior of an ancient stone starship maintenance hangar.
> Arched stone vault across the top opens to a teal and magenta nebula. RIGHT HALF: a large
> empty repair dock, angled berth cradle, crane arms, cabling, warm gold lamps pooling light.
> LEFT HALF and whole LOWER THIRD: plain very dark unlit stone wall and floor, almost no
> detail. Massive stone pillar at horizontal center. Muted golden-ochre stone, deep teal and
> magenta, warm gold lamplight, dark silhouettes, dramatic depth. No canvas texture, no frame,
> no border, no text, no characters, no ships.

## 용량

WebP **≈49KB**. `tests/hangarAssetPresence.test.ts` 의 상한은 160KB 다.
