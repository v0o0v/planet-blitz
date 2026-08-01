# 기지 화면 AAA 시네마틱 전환 — 레인 계약 (2026-08-02)

사용자 판정: 타이틀·인트로를 시네마틱 키아트로 올린 뒤 **기지 화면이 상대적으로 아마추어**로
보인다. 기지 화면을 AAA 품질로 올리고, 결과를 본 뒤 다른 화면으로 롤아웃한다.

**시각 정체성 = A. 시네마틱 전환**(사용자 확정). 나무 프레임(`ui_panel.png` nine-slice)은
기지 화면에서 **은퇴**한다. 타이틀(`titleScreen.ts`)·인트로(`introSlides.ts`)와 같은 붓:
페인터리 디지털 페인팅, 금빛 고대 석재, 청록·자홍 성운, 짙은 실루엣, 따뜻한 금색 램프광.

## 0. 절대 규칙

1. **순수 render/UI 레이어(ADR-0005)** — sim 을 읽지도 쓰지도 않는다. 시간축은 벽시계.
2. **자기 파일만 만진다.** 아래 소유권 표를 넘지 마라. `baseMap.ts` 는 **리드 전용**이다.
3. **품질 티어를 런타임 수렴 상태로 판단하지 마라.** 기지는 부팅 직후 화면일 수 있다 —
   `graphicsTierController.getActiveTier()` 단독 사용 금지. 게이트가 필요하면
   `titleScreen.resolveTitleTier(settings.quality, autoTier)` 와 같은 방식으로 **설정
   오버라이드를 직접** 읽어라.
4. **띠를 겹쳐 그라디언트를 근사하지 마라.** 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
   (실제 사용자 신고). 세로 램프는 `scrim.ts` 의 `verticalScrimTexture` 를 쓴다. 다른 방향·형태의
   램프가 필요하면 같은 방식(캔버스에 픽셀로 굽고 `linear`)으로 만들어라.
5. **Pixi v8**: `Sprite` 에 자식을 넣지 않는다(형제 + 변환 미러). 컬러 이모지 금지
   (`text.ts` `stripEmoji`). `tint` 는 곱연산이라 밝히려면 가산 오버레이를 써야 한다.
6. 자산은 **덧붙임이지 전제가 아니다** — 텍스처가 `undefined` 여도 화면이 서야 한다.
   그 방어가 결손을 조용하게 만들므로 자산 결손 가드 테스트를 리드가 따로 건다.
7. `pnpm lint --max-warnings 0` · `npx tsc --noEmit` 이 **레인 종료 조건**이다.
   테스트를 추가했으면 **`tsc` 를 반드시 다시 돌려라**(이 리포는 vitest 그린인데 빌드가
   깨지는 함정을 반복해서 밟았다).

## 1. 자산 계약 (리드가 공급 — 이미 생성 중)

`assets/base/` (WebP):

| basename | 크기 | 내용 |
| --- | --- | --- |
| `base_backdrop.webp` | 1376×768 RGB | 오스카 유적 안의 격납고 홀. 뒤쪽 아치가 성운으로 열려 있고 좌우 벽에 금색 램프광. **중앙은 의도적으로 비어 있다**(타일이 앉을 자리). |
| `base_bld_hangar.webp` | 1024² RGB | 격납고 |
| `base_bld_research.webp` | 1024² RGB | 연구소 |
| `base_bld_refinery.webp` | 1024² RGB | 정제소 |
| `base_bld_defense.webp` | 1024² RGB | 방어 사령부 |
| `base_bld_control.webp` | 1024² RGB | 관제탑 |
| `base_bld_archive.webp` | 1024² RGB | 기록 보관소 |
| `base_bld_commission.webp` | 1024² RGB | 지시 수신소 |

**로더는 Lane A 소유의 `baseTextures.ts` 하나뿐**이다. Lane B 는 텍스처를 인자로 받는다
(직접 로드하지 않는다) — 로더가 둘이면 같은 자산을 두 번 디코드한다.

## 2. 소유권

| 레인 | 소유 파일 | 금지 |
| --- | --- | --- |
| A 배경 | `src/ui/pixi/baseTextures.ts`(신규) · `src/ui/pixi/baseBackdrop.ts`(신규) | 그 외 전부 |
| B 타일 | `src/ui/pixi/cinematicTile.ts`(신규) | 그 외 전부 |
| C 크롬 | `src/ui/pixi/cinematicChrome.ts`(신규) | 그 외 전부 |
| 리드 | `baseMap.ts` · `assets/base/*` · 테스트 · 통합 | — |

세 레인은 **서로의 파일을 import 하지 않는다**(리드가 조립한다). 공용으로 쓸 수 있는 것:
`theme.ts` · `scrim.ts` · `text.ts` · `render/app.ts`(DESIGN_WIDTH/HEIGHT) · `i18n`.

## 3. 인터페이스 계약 (리드가 이 시그니처로 조립한다 — 바꾸지 마라)

### Lane A

```ts
// baseTextures.ts
export const BASE_ASSET_NAMES: readonly string[];        // backdrop + 건물 7종 basename
export function baseBuildingAssetName(key: string): string;   // 'base_bld_<key>.webp'
export const BASE_BACKDROP_NAME = 'base_backdrop.webp';
export type BaseTextures = Partial<Record<string, Texture>>;
export function loadBaseTextures(): Promise<BaseTextures>;

// baseBackdrop.ts
export class BaseBackdrop {
  constructor(tex: Texture | undefined);   // undefined 면 절차적 폴백(단색+비네트)
  readonly view: Container;                // 리드가 root 맨 뒤에 붙인다
  /** 마우스 시차·드리프트·티끌·광선. dt 는 벽시계 초. */
  update(dt: number): void;
  /** 타일 격자가 앉을 중앙 영역을 눌러 주는 베일까지 이 안에서 그린다. */
  destroy(): void;
}
```

`baseBackdrop` 이 책임지는 것: 풀블리드 커버 + 오버스캔 · 마우스 패럴랙스(타이틀
`MOUSE_RANGE`/`MOUSE_LERP` 규약 참고, 값은 더 절제) · 자동 드리프트 · 먼지 티끌 · 아주 가끔
지나는 광선 · **중앙 베일**(타일 대비 확보) · 하단 비네트.

### Lane B

```ts
// cinematicTile.ts
export interface CinematicTileOpts {
  width: number; height: number;
  art: Texture | undefined;          // 건물 일러스트(1024², 없으면 accent 폴백)
  accent: number;                    // 잠금/폴백 강조색
  title: string; desc: string;
  locked: boolean; lockReason: string | null;
  onClick?: () => void;
}
export interface CinematicTile {
  readonly container: Container;
  /** 호버 글로우·미세 부유 등 연출. dt 는 벽시계 초. */
  update(dt: number): void;
}
export function makeCinematicTile(o: CinematicTileOpts): CinematicTile;
```

Lane B 가 책임지는 것: **나무 nine-slice 를 쓰지 않는** 시네마틱 타일 —
일러스트 밴드(상단 ~60%, 아래로 페이드) · 금박 얇은 테두리 + 안쪽 어두운 홈 · 바닥 접지
그림자 · 호버 시 리프트 + 림라이트 + 글로우 · 잠금 시 탈채도 + 자물쇠 + 사유 문구.
텍스트는 `title`/`desc` 를 그대로 그린다(i18n 은 리드가 이미 푼 값을 넘긴다).
`width`/`height` 는 리드가 정한다 — 내부에서 하드코딩하지 마라.

### Lane C

```ts
// cinematicChrome.ts
export function makeScreenTitle(text: string, sub: string): Container;   // 앵커 (0.5, 0) 기준 중앙 정렬
export function makeCinematicChip(w: number, h: number, value: string, icon: Texture | undefined, tone: 'gold' | 'teal'): Container;
export interface HeroButton { readonly container: Container; update(dt: number): void; }
export function makeHeroButton(w: number, h: number, label: string, onClick: () => void): HeroButton;
```

Lane C 가 책임지는 것: 나무 배너를 대체하는 **각인된 금박 제목 처리**(부제 포함) ·
유리+금테 재화 칩 · 화면의 주인공인 **출격 CTA**(맥동 글로우·호버·프레스). 전부 절차적
(Graphics/Text)이어야 한다 — 새 자산을 요구하지 마라.

## 4. 완료 기준 (레인)

- `npx tsc --noEmit` 0 · `corepack pnpm lint` 0.
- 자기 모듈이 **텍스처 없이도** 예외 없이 컨테이너를 돌려준다(폴백 경로).
- 헤더 주석에 **왜 그렇게 했는지**를 남긴다(이 리포 규약 — 무엇이 아니라 왜).
- 리드에게 돌려줄 최종 텍스트: 만든 파일 목록 + 리드가 알아야 할 제약 3줄 이내.

## 5. 완료 기준 (레인 종료 후 리드)

- 하네스 실화면 스크린샷으로 확인. 품질 티어 `high` 고정 · 탭 포그라운드 확인.
- **엄격한 비평 서브에이전트**가 AAA 판정. 불합격이면 지적 사항을 레인에 되돌려 반복한다.
- 자산 결손 가드(양방향 + 용량 예산) · `renderWiring` · 전체 vitest · `tsc` · `eslint`.
