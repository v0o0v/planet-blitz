/**
 * 환경 레이어 공용 색 유틸 — 특히 **전경 신호색과의 색상각 분리**를 계산으로 만든다.
 *
 * ## 왜 이 파일이 생겼나
 * 카르곤은 배경 용암 팔레트가 적탄과 색상각 2.4° 였던 결함을 고치며 허용 구간
 * `[10°, 18.4°]` 를 얻었다. 그런데 그 두 숫자는 **입력이 아니라 파생값**이다 —
 * `FOREGROUND_SIGNAL_COLORS` 의 hot-red(355.4°)와 앰버(28.5°) 사이의 빈 골짜기에서
 * 역산됐다. 이걸 행성별 테마 테이블의 필드로 만들면, 행성마다 적탄 색이 다른데 사람이
 * 손으로 숫자를 다시 적게 되고 **그 순간 다시 갈라진다**(이 리포가 `UPPER_THRESHOLD`
 * 0.5 vs 0.57 로 이미 겪은 실패의 정확한 재현).
 *
 * 그래서 여기서는 **창을 계산**하고, 테마는 자기 팔레트가 그 창 안에 있는지 **검증만**
 * 받는다. 적탄 색이 바뀌면 전 행성의 판정이 자동으로 재평가된다.
 *
 * ## 왜 구간이 하나가 아니라 리스트인가
 * 카르곤(주황 계열)은 마침 안전 골짜기 하나에만 살 수 있어 구간 하나로 표현됐다. 하지만
 * 색상환은 원이고 위험색이 6개라 골짜기는 원래 여러 개다. 톡사르(자홍 적탄)처럼 팔레트가
 * 다른 골짜기에 사는 행성이 들어오면 "구간 하나" 표현이 즉시 깨진다.
 *
 * 렌더 전용(ADR-0005): sim 을 import 하지 않고 해시에 기여하지 않는다.
 */

/** 색상각(도, [0,360))의 정본. 무채색(R=G=B)은 0 을 돌려준다. */
export function hueOf(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** HSV 채도 [0,1]. */
export function saturationOf(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

/** Rec.709 상대휘도 [0,1]. */
export function relLuminanceOf(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 두 **각도**(도) 사이의 원형 거리 [0,180]. */
export function hueAngleDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 두 **색** 사이의 원형 색상각 거리 [0,180]. */
export function hueDistance(a: number, b: number): number {
  return hueAngleDistance(hueOf(a), hueOf(b));
}

/**
 * 안전 색상 구간. `start` 에서 시계방향으로 `span` 도까지이며, **원을 감쌀 수 있다**
 * (예: `{start: 345, span: 30}` 은 345°→15°). 그래서 `end` 를 저장하지 않는다 —
 * `start + span` 이 360 을 넘는 걸 잊고 비교하는 것이 이 자료형의 유일한 함정이라
 * 표현 자체에서 제거했다.
 */
export interface HueWindow {
  readonly start: number;
  readonly span: number;
}

/** 각도가 구간 안인가(원 감싸기 처리 포함). */
export function hueInWindow(hue: number, w: HueWindow): boolean {
  const rel = (((hue - w.start) % 360) + 360) % 360;
  return rel <= w.span;
}

/** 각도가 구간 **리스트 중 하나라도**에 드는가. */
export function hueInAnyWindow(hue: number, ws: readonly HueWindow[]): boolean {
  for (const w of ws) if (hueInWindow(hue, w)) return true;
  return false;
}

/**
 * 위험색들로부터 최소 `gap` 도 떨어진 **안전 색상 구간 전부**를 계산한다.
 *
 * 배경이 살 수 있는 곳은 위험색 사이의 빈 골짜기다. 인접한 두 위험색 각도 `h[i]`,
 * `h[i+1]` 사이에서 안전한 곳은 `[h[i]+gap, h[i+1]-gap]` 이고, 그 폭이 0 이하면
 * 골짜기가 없는 것이다(두 위험색이 `2·gap` 안에 붙어 있다).
 *
 * 무채색(채도 0)은 색상각이 정의되지 않으므로 위험색에서 제외한다 — 흰 코어 탄처럼
 * 색상각으로 분리할 수 없는 것은 이 축이 아니라 크기·속도·형태로 분리해야 한다.
 *
 * 반환은 `start` 오름차순이고, 안전 구간이 하나도 없으면 빈 배열이다(그 경우 색상각만으로는
 * 분리가 불가능하다는 뜻이며, 호출부가 조용히 통과시키면 안 된다).
 */
export function computeSafeHueWindows(
  hostile: readonly number[],
  gap: number,
  minSaturation = 0.15,
): HueWindow[] {
  const hues = hostile
    .filter((c) => saturationOf(c) >= minSaturation)
    .map(hueOf)
    .sort((a, b) => a - b);
  if (hues.length === 0) return [{ start: 0, span: 360 }];
  if (gap * 2 * hues.length >= 360) return [];

  const out: HueWindow[] = [];
  for (let i = 0; i < hues.length; i++) {
    const a = hues[i] ?? 0;
    const b = hues[(i + 1) % hues.length] ?? 0;
    // 마지막 구간은 원을 감싼다(가장 큰 각도 → 가장 작은 각도).
    const arc = i === hues.length - 1 ? b + 360 - a : b - a;
    const span = arc - 2 * gap;
    if (span > 0) out.push({ start: (a + gap) % 360, span });
  }
  return out.sort((p, q) => p.start - q.start);
}

/**
 * 팔레트 전체가 안전 구간 안에 있는가. 위반한 색과 가장 가까운 위험색까지의 거리를 함께 낸다
 * (고칠 때 필요한 정보는 "위반했다"가 아니라 "무엇에 얼마나 가까운가"다).
 */
export function paletteHueViolations(
  palette: readonly number[],
  hostile: readonly number[],
  gap: number,
): { color: number; hue: number; nearestHostile: number; distance: number }[] {
  const out: { color: number; hue: number; nearestHostile: number; distance: number }[] = [];
  for (const c of palette) {
    // 무채색은 색상각 축으로 판정하지 않는다(정의되지 않는다).
    if (saturationOf(c) < 0.15) continue;
    let nearest = hostile[0] ?? 0;
    let best = Infinity;
    for (const h of hostile) {
      if (saturationOf(h) < 0.15) continue;
      const d = hueDistance(c, h);
      if (d < best) { best = d; nearest = h; }
    }
    if (best < gap) out.push({ color: c, hue: hueOf(c), nearestHostile: nearest, distance: best });
  }
  return out;
}
