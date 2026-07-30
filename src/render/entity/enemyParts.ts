/**
 * 적 기체 장식의 **기하 조립기** — 전부 절차적 `Graphics` 다(신규 자산 0, GL 불필요, node 안전).
 *
 * ## 설계 원칙 ① 기하는 정적, 애니메이션은 변환으로만
 * 화면에 적이 20~40 마리 있고 개체당 비용이 그대로 곱해진다. `Graphics` 를 매 프레임 `clear()`
 * 후 다시 그리면 개체 수만큼 지오메트리 재빌드가 돌아 프레임 예산(+1.5ms)이 즉시 무너진다.
 * 그래서 여기 조립기들은 **상태가 바뀔 때만 한 번** 불리고, 매 프레임 움직이는 것은
 * `position` · `rotation` · `scale` · `alpha` 네 값뿐이다.
 *
 * ## 설계 원칙 ② **UI 어휘 금지**(§2-5) — 1차 반려의 본체
 * 십자선·조준 레티클·락온 브래킷·선택 링은 **HUD 의 어휘**다. 월드 실체에 붙이면 화면이 게임이
 * 아니라 디버그 오버레이로 읽힌다. 1차 구현이 여섯 항목을 전부 "스프라이트 둘레에 기하 도형"
 * 으로 풀어 정확히 그 판정을 받았다. 삭제된 것과 그 대체는 이렇다:
 *
 * | 삭제된 도형 | 왜 UI 로 읽혔나 | 대체 |
 * |---|---|---|
 * | 스폰 링의 0/90/180/270° 눈금 4개 | 십자선 레티클 | 눈금 없는 부드러운 falloff 헤일로 |
 * | 스폰 기둥 + 흰 중심 스트라이프 | 레티클 수직선 | **본체 스케일·알파 물질화**(몸으로) |
 * | 재조준 4모서리 괄호 | 락온 브래킷 | **본체 스쿼시 + 가산 명멸**(몸으로) |
 * | 조준선 + 끝 브래킷 | HUD 조준 마커 | **총구 장전 발광**(몸 앞 1.2r 이내) |
 * | 몸통 밖 완전한 원 1줄 | RTS 선택 링 | **광원 방향 반쪽 림라이트** |
 *
 * 남긴 기하 표식은 둘뿐이고 둘 다 "형태로 못 주는 정보" 다 — 엘리트 계급장(접두사는 형태가
 * 없다)과 보스 룬(등급 서사). 둘 다 비평가가 통과시킨 부분이다.
 *
 * ## 설계 원칙 ③ 가독성·밝기 계약(§2-2·§2-4)
 * - **적 실루엣을 덮거나 어둡게 만드는 도형이 없다.** 발광은 전부 가산이고, 유일한 어두운
 *   도형인 연기는 몸통 **반경 밖**에만 산다(경계까지 코드로 강제 — {@link SMOKE_INNER}).
 * - **가산 총량이 예산이다.** bright(L≥96) 면적 상한이 3레인 합산 7% 라, 여기 알파는
 *   "개별로 합리적" 이 아니라 **"20기가 동시에 켜져도 합이 예산 안"** 을 기준으로 잡혀 있다.
 * - **시안(`#39d0ff` 계열)은 아군 전용**이라 이 파일에 상수로 없다. 색은 호출측이 넘긴다.
 *
 * ## 설계 원칙 ④ **기준량은 텍스처 반치수가 아니라 아트 알파 경계다**(4차 CRIT)
 * 1~3차가 같은 원인으로 세 번 반려됐다. `radius = sprite.width / 2` 는 **텍스처** 반치수이고,
 * 텍스처에는 투명 여백이 들어 있다. 그래서 "0.86r 이면 몸 안" 같은 추론이 전부 틀렸다 —
 * 비평가가 출하 자산의 알파를 반경별 360° 스윕한 실측:
 *
 * | 반경(반치수 배율) | `boss.png` | `enemy_charger` | `enemy_mortar` |
 * |---|---|---|---|
 * | 0.60 | 100% | 100% | 73.3% |
 * | 0.70 | 97.8% | 84.4% | 49.4% |
 * | 0.86 (구 `RUNE_INSET`) | **58.9%** | 34.4% | 18.6% |
 * | 1.12 (구 `ELITE_AURA_R`) | **0%** | **0%** | 0% |
 *
 * 즉 **실제 아트는 반치수의 0.70~0.84 까지만 찬다.** 게다가 `boss.png` 는 128×128 **정사각**이라
 * 3차가 도입한 축별 배치(`halfW`/`halfH` 분리)는 출하 자산에 **무연산**이었다.
 *
 * 그래서 이 파일은 이제 텍스처 알파를 직접 읽어 **실심 반경**({@link ArtExtent.solidR})을 구하고,
 * 몸에 앉아야 하는 기하는 전부 그 값에서 파생시킨다. 측정 불가 환경(node 테스트·GL 텍스처)에서는
 * {@link ART_EXTENT_FALLBACK} 로 접는다 — 폴백은 실측 하한(0.70)보다 **더 보수적**이다.
 */

import { Container, Graphics, type Texture } from 'pixi.js';

// ---------------------------------------------------------------------------
// 아트 알파 경계 측정 — 순수 스윕 + Pixi 어댑터
// ---------------------------------------------------------------------------

/** 이 알파(0..255) 이상이면 "몸 픽셀" 로 센다. 안티에일리어싱 꼬리를 몸으로 세지 않는 하한. */
export const ART_ALPHA_MIN = 24;
/** 반경 하나가 "실심" 으로 인정되는 360° 몸 위 비율. */
export const ART_COVER_MIN = 0.9;
/** 360° 스윕 표본 수. 180 = 2° 격자. */
export const ART_SWEEP_STEPS = 180;

/**
 * 정규 좌표 알파 표본기. 입력은 **텍스처 반치수로 정규화된** 좌표(중심 0, 경계 ±1)이고
 * 출력은 알파 0..255 다. 순수 함수라 테스트가 합성 아트를 그대로 넣을 수 있다 —
 * 4차 이전의 가드가 텍스처 알파를 **한 번도 안 본** 채 "경계 상자 안" 만 재던 것이 반려 사유였다.
 */
export type AlphaField = (nx: number, ny: number) => number;

/** 아트 알파 경계. 전부 **텍스처 반치수 배율**이다. */
export interface ArtExtent {
  /** 360° 스윕 몸 위 비율이 {@link ART_COVER_MIN} 이상인 최대 반경. */
  readonly solidR: number;
  /** 알파가 닿는 가로 최대. */
  readonly halfW: number;
  /** 알파가 닿는 세로 최대. */
  readonly halfH: number;
  /** 실제로 픽셀을 읽었는가(false = 폴백). */
  readonly measured: boolean;
}

/**
 * 측정 불가 환경의 폴백. 출하 자산 실측 실심 반경 하한이 0.70 이라 **그보다 보수적인 0.60** 을
 * 쓴다 — 폴백이 몸 밖으로 나가는 쪽으로 틀리면 4차 반려 사유가 그대로 재발한다.
 */
export const ART_EXTENT_FALLBACK: ArtExtent = {
  solidR: 0.6,
  halfW: 1,
  halfH: 1,
  measured: false,
};

/** 실심 반경 탐색 격자·하한. */
const SOLID_STEP = 0.02;
const SOLID_FLOOR = 0.3;

/**
 * 반경 `r`(반치수 배율)에서 360° 스윕한 **몸 위 비율** [0,1].
 *
 * 이것이 4차 가드의 계량기다. 경계 상자는 "이 상자 안" 만 말해 주지만, 실제로 알아야 하는 것은
 * **그 궤도의 모든 각도에서 몸 픽셀 위인가** 이고, 그 질문은 회전 불변이다 — 즉 이 지표를
 * 통과한 배치는 스프라이트가 돌아도 몸 위에 남는다.
 */
export function artCoverAt(field: AlphaField, r: number, steps: number = ART_SWEEP_STEPS): number {
  if (!(r >= 0) || steps <= 0) return 0;
  let hit = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i * Math.PI * 2) / steps;
    if (field(Math.cos(a) * r, Math.sin(a) * r) >= ART_ALPHA_MIN) hit += 1;
  }
  return hit / steps;
}

/** 알파 필드에서 아트 경계를 잰다. 픽셀이 하나도 없으면 폴백. */
export function measureArtExtent(field: AlphaField, grid = 64): ArtExtent {
  let halfW = 0;
  let halfH = 0;
  let any = false;
  for (let iy = 0; iy < grid; iy++) {
    const ny = -1 + (2 * iy) / (grid - 1);
    for (let ix = 0; ix < grid; ix++) {
      const nx = -1 + (2 * ix) / (grid - 1);
      if (field(nx, ny) < ART_ALPHA_MIN) continue;
      any = true;
      if (Math.abs(nx) > halfW) halfW = Math.abs(nx);
      if (Math.abs(ny) > halfH) halfH = Math.abs(ny);
    }
  }
  if (!any) return ART_EXTENT_FALLBACK;
  let solidR = 0;
  for (let r = 1; r >= SOLID_FLOOR; r -= SOLID_STEP) {
    if (artCoverAt(field, r) >= ART_COVER_MIN) {
      solidR = r;
      break;
    }
  }
  if (solidR <= 0) return ART_EXTENT_FALLBACK;
  return { solidR, halfW, halfH, measured: true };
}

/** 텍스처당 1회만 재고 캐시한다(개체 20~40 마리가 같은 텍스처를 공유한다). */
const extentCache = new Map<string, ArtExtent>();

/** 캐시 키 — 아틀라스 프레임까지 포함해야 같은 소스의 다른 프레임을 섞지 않는다. */
function extentKey(tex: Texture): string {
  const f = tex.frame;
  return `${tex.source.uid}:${f.x},${f.y},${f.width},${f.height}`;
}

/**
 * 텍스처의 알파 표본기. **읽을 수 없으면 `null`** — GL 전용 소스·node 테스트·오염된 캔버스가
 * 전부 여기로 떨어진다. 던지지 않고 조용히 폴백하는 것이 옳다: 알파를 못 읽는다고 적이 안
 * 보이면 안 된다.
 */
export function textureAlphaField(tex: Texture): AlphaField | null {
  if (typeof document === 'undefined') return null;
  const res = (tex.source as unknown as { resource?: unknown }).resource;
  if (res === null || res === undefined) return null;
  const w = Math.round(tex.frame.width);
  const h = Math.round(tex.frame.height);
  if (!(w > 0 && h > 0)) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    if (g2 === null) return null;
    g2.drawImage(res as CanvasImageSource, tex.frame.x, tex.frame.y, w, h, 0, 0, w, h);
    const data = g2.getImageData(0, 0, w, h).data;
    return (nx: number, ny: number): number => {
      const px = Math.round((nx + 1) * 0.5 * (w - 1));
      const py = Math.round((ny + 1) * 0.5 * (h - 1));
      if (px < 0 || py < 0 || px >= w || py >= h) return 0;
      return data[(py * w + px) * 4 + 3] ?? 0;
    };
  } catch {
    return null;
  }
}

/** 텍스처의 아트 경계(캐시·폴백 포함). */
export function textureArtExtent(tex: Texture): ArtExtent {
  const key = extentKey(tex);
  const hit = extentCache.get(key);
  if (hit !== undefined) return hit;
  const field = textureAlphaField(tex);
  const out = field === null ? ART_EXTENT_FALLBACK : measureArtExtent(field);
  extentCache.set(key, out);
  return out;
}

/** **테스트 전용** 캐시 비우기. */
export function clearArtExtentCache(): void {
  extentCache.clear();
}

/**
 * 연기 원반의 **안쪽 경계**(반경 배수). 원반 중심이 아니라 **가장자리**가 이 값 밖에 있어야
 * 한다 — 1차 주석은 "몸통 밖" 이라 적었지만 중심에만 참이었고 원반은 0.85r 까지 몸통을
 * 파고들었다. 이제 조립기가 중심을 `경계 + 자기 반지름` 으로 잡아 코드가 주석을 지킨다.
 */
const SMOKE_INNER = 1.0;

/**
 * (삭제됨) `buildThreatAura` · `buildEliteAura` · `buildBossAura` — 동심 링 오라.
 *
 * 3차에서 1.45r → 1.12r 로 좁혔는데 **원을 없앤 게 아니라 줄인 것**이었다. 4차 실측으로 그
 * 1.12r 궤도는 `boss.png`·`enemy_charger` 둘 다 **몸 위 0%**, 1.04r 도 5.6% — 즉 3링 전체가
 * 허공이었고 1× 게임플레이 스케일에서 화면에서 가장 UI 스럽게 읽히는 단일 요소였다.
 *
 * 대체는 조립기가 아니라 **기법**이다: `enemyVisual.ts` 가 등급색으로 틴트한 본체 텍스처
 * 가산 사본을 오프셋 0 으로 몇 % 부풀려 겹친다(`enemyRim`·`enemyBodyGlow` 가 수치로 성공시킨
 * 바로 그 기법). 텍스처 사본은 정의상 실루엣을 따라가므로 **몸 밖 허공에 링이 생길 수 없다.**
 */

/**
 * (삭제됨) `buildRimLight` — 고정 반경 `arc()` stroke 로 만든 "반쪽 림라이트".
 *
 * 2차에서 완전한 원(선택 링)을 반으로 자른 것이었고, 3차 비평에서 **여전히 림라이트가 아니라는**
 * 판정을 받았다: 원호는 **실루엣을 따라가지 않는다.** 4× 확대에서 몸 경계에서 떨어진 구간과
 * 몸을 가로지르는 구간이 동시에 생기고, 보스 스케일에서는 굵은 띠가 몸 아래 빈 공간을 가로질렀다.
 *
 * 대체는 조립기가 아니라 **기법**이다 — `enemyVisual.ts` 가 본체 텍스처의 가산 사본을 광원
 * 쪽으로 몇 px 밀어 붙인다(레인 A `playerRim` 과 같은 패턴, 그리고 이 레인의 `enemyBodyGlow` 가
 * 수치로 성공시킨 바로 그 기법). 텍스처 사본은 원리적으로 실루엣을 따라간다.
 */

/**
 * 엘리트 휘장 — 몸통에 겹쳐 붙는 갈매기표 계급장. **비평가가 통과시킨 유일한 기하 표식**이다:
 * 접두사(분열/가속/자기장/…)는 형태로 줄 수 있는 정보가 아니라 표식이 정당하다.
 *
 * 4차: 세로 위치를 텍스처 반치수(`0.72r`)가 아니라 **아트 실심 반경**에서 파생시킨다. 텍스처
 * 반치수의 0.72 는 `enemy_mortar` 같은 여백 큰 자산에서 이미 몸 밖이었다.
 */
export function buildEliteInsignia(radius: number, color: number, extent: ArtExtent): Container {
  const c = new Container();
  const g = new Graphics();
  const w = radius * extent.solidR * 0.6;
  const h = radius * extent.solidR * 0.26;
  // 두 겹이 전부 실심 반경 안에 들어오도록 위쪽 끝을 실심 반경의 0.9 로 잡는다.
  const top = radius * extent.solidR * 0.9;
  for (let i = 0; i < 2; i++) {
    const y = -top + i * h * 1.4 + h;
    g.moveTo(-w, y + h)
      .lineTo(0, y)
      .lineTo(w, y + h)
      .stroke({ color, width: Math.max(1.5, radius * 0.09), alpha: 0.9 });
  }
  c.addChild(g);
  return c;
}

/**
 * 룬 반치수 = 실심 반경의 이 배율. 궤도({@link runeInset})와 합이 정확히 실심 반경이 되도록
 * 나뉘어 있어, 룬의 **바깥 끝**이 실심 경계에 닿고 넘지 않는다.
 */
export const RUNE_SIZE = 0.16;

/**
 * 룬 궤도(반치수 배율) — 아트 실심 반경에서 파생.
 *
 * `1.9` 는 테두리 stroke 의 바깥 몫이다. 처음 `1.2`(선 굵기 절반의 산술값)로 잡았더니 알파
 * 스윕 가드가 **네 필드 중 셋에서 빨개졌다** — 마름모 꼭짓점의 join 이 산술값보다 멀리 나가기
 * 때문이다(실측: 예상 0.494 vs 실제 0.503). 그래서 join 을 `round` 로 묶고 여유를 넉넉히 둔다.
 * **모델링으로 맞추지 말고 실측 가드가 통과할 만큼 안쪽으로 들여라.**
 */
export function runeInset(extent: ArtExtent): number {
  return extent.solidR * (1 - RUNE_SIZE * 1.9);
}

/** 룬 반치수(반치수 배율). */
export function runeHalfSize(extent: ArtExtent): number {
  return extent.solidR * RUNE_SIZE;
}

/**
 * 보스 휘장 — 본체에 **새겨진** 룬 넷.
 *
 * ## 1~3차가 같은 원인으로 세 번 틀렸다
 * `1.45r` → `1.08r` → 축별 `0.86` 로 세 번 조였는데도 룬이 허공에 남았다. 4차 실측이 원인을
 * 확정했다 — **기준량이 텍스처 반치수였다.** `boss.png` 의 0.86×반치수 축 위 알파는
 * 오른쪽 0 · 왼쪽 0 · 위 0 · 아래 255 이고, 360° 몸 위 비율은 58.9% 였다. 게다가 `boss.png` 는
 * 128×128 **정사각**이라 3차가 도입한 축별 배치는 출하 자산에 아무 효과가 없었다.
 * 그래서 이제 궤도가 {@link ArtExtent.solidR}(알파 스윕 실심 반경)에서 나온다.
 *
 * ## 회전 문제도 여기서 사라진다
 * 3차는 `insignia.rotation = t*0.12` 로 컨테이너를 계속 돌려, 축별 배치의 이점이 **회전이 0 인
 * 순간에만** 성립했다(주기의 41% 를 빈 공간에서 보냈다). 실심 반경은 **360° 스윕**으로 정의되니
 * 궤도 전체가 몸 위이고, 그래서 회전 불변이다. 호출측은 회전 대신 알파 맥동을 쓴다.
 *
 * ## 형태 — 불투명 정사각형이 아니다
 * 3차 룬은 질감 없는 불투명 살몬색 정사각형이라 "룬" 으로 읽히지 않고 디버그 오버레이로 보였다.
 * 이제 **테두리 마름모 + 중심 점**이고 알파를 내려 몸 위에 새겨진 것으로 읽힌다.
 *
 * @param halfW  본체 표시 반치수(가로, px).
 * @param halfH  본체 표시 반치수(세로, px).
 * @param color  등급 강조색.
 * @param extent 이 본체 텍스처의 아트 알파 경계.
 */
export function buildBossInsignia(
  halfW: number,
  halfH: number,
  color: number,
  extent: ArtExtent,
): Container {
  const c = new Container();
  const g = new Graphics();
  const orbit = runeInset(extent);
  const s = runeHalfSize(extent) * Math.min(halfW, halfH);
  const spots: readonly (readonly [number, number])[] = [
    [halfW * orbit, 0],
    [-halfW * orbit, 0],
    [0, halfH * orbit],
    [0, -halfH * orbit],
  ];
  const lw = Math.max(1, s * 0.34);
  for (const [x, y] of spots) {
    g.poly([x, y - s, x + s, y, x, y + s, x - s, y]).stroke({
      color,
      width: lw,
      alpha: 0.62,
      join: 'round',
    });
    g.circle(x, y, s * 0.3).fill({ color, alpha: 0.5 });
  }
  c.addChild(g);
  return c;
}

/**
 * 스폰 헤일로(가산) — **눈금 없는** 부드러운 falloff 하나. 1차의 0/90/180/270° 눈금 4개가
 * 십자선 레티클로 읽혀 §2-5 위반이었다. 수축은 호출측이 스케일로 준다.
 */
export function buildSpawnHalo(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 5; i >= 1; i--) {
    const t = i / 5;
    g.circle(0, 0, radius * (0.5 + 0.9 * t)).fill({ color, alpha: 0.035 });
  }
  return g;
}

/**
 * 총구 장전 발광(가산) — `standoff` 사격 대역 자세. 1차의 "몸에서 뻗는 직선 + 끝 브래킷" 은
 * HUD 조준 마커였다(§2-5). 이제 **몸 앞 1.2r 안**에만 산다: 포구에 에너지가 고이는 것이지
 * 화면에 선을 긋는 것이 아니다. 호출측이 컨테이너를 `e.angle`(플레이어 방향)로 돌린다.
 */
export function buildMuzzleCharge(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  // 포구 쪽으로 치우친 소프트 로브 — 중심이 몸 앞 0.8r, 최대 도달 1.2r.
  for (let i = 4; i >= 1; i--) {
    const t = i / 4;
    g.circle(radius * 0.8, 0, radius * 0.42 * t).fill({ color, alpha: 0.14 });
  }
  c.addChild(g);
  return c;
}

/**
 * 돌진 스미어(가산) — `chargeStraight` 커밋 자세. 1차는 진행 방향으로 **3.4r 쐐기**를 그려
 * "적보다 장식이 먼저 눈에 드는" 상태였다(§2-2 가 플레이어에게 쓴 금지의 적 버전).
 * 이제 **뒤로 흐르는 속도 잔상**이다 — 앞을 가리키는 표식이 아니라 몸의 2차 운동이라
 * 위협의 위치를 몸이 계속 소유한다.
 */
export function buildDashSmear(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  const reach = radius * 1.8;
  // 뒤로 갈수록 얇아지는 꼬리(삼각형 두 겹).
  g.poly([-radius * 0.2, -radius * 0.5, -reach, 0, -radius * 0.2, radius * 0.5]).fill({
    color,
    alpha: 0.1,
  });
  g.poly([-radius * 0.2, -radius * 0.22, -reach * 0.6, 0, -radius * 0.2, radius * 0.22]).fill({
    color,
    alpha: 0.12,
  });
  c.addChild(g);
  return c;
}

/**
 * 지원 오라(가산) — `seekWounded` 가 멈춰 아군을 붙이고 있을 때. 1차의 "호 두 개 + 살 여섯"
 * 은 계기판처럼 읽혔다. 부드러운 발광 덩어리로 바꿔 "이 개체가 에너지를 뿜고 있다" 만 남긴다.
 */
export function buildMendAura(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 4; i >= 1; i--) {
    g.circle(0, 0, radius * (0.7 + 0.55 * (i / 4))).fill({ color, alpha: 0.05 });
  }
  return g;
}

/**
 * 고정 포대 가동 발광(가산) — `stationary` 종의 상시 표현. **발사 예고가 아니다**(그 시점은
 * 관측 불가능하다 — `enemyPosture.ts` 헤더). 느리게 도는 비대칭 열점 셋이라 "가동 중인 설비"
 * 로만 읽히고 예고로 오독되지 않는다.
 */
export function buildRootedHeat(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const x = Math.cos(a) * radius * 0.85;
    const y = Math.sin(a) * radius * 0.85;
    for (let k = 3; k >= 1; k--) {
      g.circle(x, y, radius * 0.26 * (k / 3)).fill({ color, alpha: 0.07 });
    }
  }
  return g;
}

/**
 * 손상 불티(가산) — 몸통 가장자리에 붙는 점 무리. 1차는 반경 `0.07r`(잡몹 r=54 → **3.8px**)
 * 이라 카르곤 용암 발광 위에서 **화면 델타가 노이즈 바닥 밑**이었다(계약 §4-2 = 화면에 없는 것).
 * 점을 키우고 소프트 코어를 얹어 실측 가능한 크기로 올린다.
 */
export function buildSparks(
  radius: number,
  color: number,
  count: number,
  extent: ArtExtent,
): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 0; i < count; i++) {
    // 황금각 배치 — count 가 달라져도 뭉치지 않는다.
    const a = i * 2.399963;
    // 4차: 기준량이 텍스처 반치수가 아니라 **아트 실심 반경**이다. 여백 큰 자산(`enemy_mortar`)에서
    // 0.94×반치수는 몸에서 한참 떨어진 허공이었다 — 불티는 몸 가장자리에서 튀어야 한다.
    const r = radius * extent.solidR * (0.72 + 0.3 * ((i * 0.37) % 1));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    g.circle(x, y, radius * 0.2).fill({ color, alpha: 0.3 });
    g.circle(x, y, radius * 0.1).fill({ color: 0xffe6c0, alpha: 0.75 });
  }
  return g;
}

/** 화염(가산) — 대파 이상에서 몸통 위로 솟는 불꽃 혀. 위쪽으로만 뻗어 아래 실루엣을 남긴다. */
export function buildFlame(radius: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const h = radius * 1.25;
  g.poly([-radius * 0.5, 0, 0, -h, radius * 0.5, 0]).fill({ color: 0xff6a1e, alpha: 0.5 });
  g.poly([-radius * 0.26, 0, 0, -h * 0.62, radius * 0.26, 0]).fill({
    color: 0xffd58a,
    alpha: 0.6,
  });
  return g;
}

/**
 * 연기 뭉치 — **유일하게 어두운 도형**이라 규칙이 엄격하다: 가산이 아니고, 원반의 **가장자리
 * 까지** 몸통 반경 밖({@link SMOKE_INNER})이며, 알파 상한이 낮다. 호출측이 진행 방향
 * **반대쪽**으로 돌려 꼬리로 만든다.
 */
export function buildSmoke(radius: number): Graphics {
  const g = new Graphics();
  let edge = SMOKE_INNER; // 지금까지 채워진 바깥 경계(반경 배수)
  for (let i = 0; i < 3; i++) {
    const rr = radius * (0.3 + i * 0.11);
    // 중심 = 지금 경계 + 자기 반지름 → 원반 전체가 경계 밖에 선다(주석이 코드로 강제된다).
    const cx = radius * edge + rr;
    g.circle(cx, 0, rr).fill({ color: 0x2a2620, alpha: 0.22 - i * 0.06 });
    edge = (cx + rr) / radius;
  }
  return g;
}

/** 사망 파편 하나의 정적 도형(가산). */
export function buildShard(len: number, wide: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  g.poly([-len / 2, 0, 0, -wide, len / 2, 0, 0, wide]).fill({ color, alpha: 0.95 });
  return g;
}

/** 사망 충격파 링(가산). 호출측이 스케일을 키우며 알파를 떨어뜨린다. */
export function buildShockRing(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  g.circle(0, 0, radius).stroke({ color, width: Math.max(2, radius * 0.16), alpha: 0.8 });
  return g;
}
