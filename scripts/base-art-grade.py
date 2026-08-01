"""기지 타일 아트 크롭 + 그레이드 + WebP 인코딩 (`assets/base/`).

## 왜 한 스크립트인가
크롭·그레이드·인코딩을 나누면 초점과 감마의 기준이 갈린다. 특히 크롭 종횡비는 카드 치수에서
파생하므로(`AR` 참조) 따로 두면 카드를 바꿀 때 한쪽만 고쳐진다.

## 왜 감마만 쓰는가
`out = 255 * (v/255)^g` 는 0 과 255 를 보존하므로 **클리핑이 원리적으로 없다** — 곱연산
게인처럼 하이라이트를 태우지 않는다. 감마는 상단 하늘 띠 평균이 목표에 닿도록 풀어서 구한다
(휘도 1회 + R·B 채널 각 1회).

생성형으로 뽑은 원화는 그냥 두면 하늘 띠가 L 34~79(Δ45) · R−B −19~+5(Δ24) 로 흩어져
"잘 그린 그림 7장"이 된다. 그레이드 후 L 60~65(Δ4.5) · R−B −7.4~−8.8(Δ1.3) 로 묶인다.

⚠️ **한계**: 감마는 색상축을 크게 옮기지 못한다. 원화가 애초에 중성(R−B ≈ 0)인 장은 따뜻한
대역으로 못 끌고 온다 — 그런 장은 재생성이 답이다(관제탑·격납고가 그랬다).

## 의존성
리포의 `scripts/*.mjs` 는 의존성 0 규약이지만, 이 단계는 이미지 디코드·리샘플·WebP 인코딩이
필요해 Python + Pillow + numpy 를 쓴다(`assets/title/README.md` 의 WebP 단계와 같은 예외).

## 사용
    python scripts/base-art-grade.py <원본디렉터리>

원본은 `<원본디렉터리>/bld_<key>.png` 이름이어야 한다(`key` 는 아래 `FOCUS` 의 키).
"""

import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "assets", "base")

# 밴드 종횡비 — `baseMap.TILE_W / (TILE_H * cinematicTile.BAND_RATIO)`.
# ⚠️ 카드 치수나 BAND_RATIO 를 바꾸면 여기도 같이 고치고 전 장을 재출력해야 한다.
AR = 424 / (352 * 0.71)
OW = 848

# 건물별 세로 초점(0=위, 1=아래). 높은 건물은 위를, 넓은 건물은 가운데를 남긴다.
# 정사각 원본을 1.6:1 로 자르므로 초점을 안 주면 탑의 꼭대기와 기단이 함께 날아간다.
FOCUS = {
    "hangar": 0.50,
    "research": 0.40,
    "refinery": 0.42,
    "defense": 0.50,
    "control": 0.16,
    "archive": 0.26,
    "commission": 0.42,
    "launch": 0.44,
}

# 출격 카드만 건물이 아니라 이름 규약이 다르다(`baseTextures.BASE_LAUNCH_NAME`).
ASSET_NAME = {k: ("base_launch.webp" if k == "launch" else f"base_bld_{k}.webp") for k in FOCUS}

TARGET_L = 62.0   # 하늘 띠 목표 휘도
TARGET_RB = -8.0  # 하늘 띠 목표 R−B(색온도)
STRIP = 0.12      # 하늘 띠로 볼 상단 비율
GAMMA_CLAMP = (0.62, 1.62)


def solve_gamma(mean_now: float, mean_target: float) -> float:
    """(m/255)^g == t/255 를 만족하는 g. 0·255 를 보존하므로 클리핑이 없다."""
    m = min(max(mean_now, 1.0), 254.0) / 255.0
    t = min(max(mean_target, 1.0), 254.0) / 255.0
    return float(np.clip(np.log(t) / np.log(m), *GAMMA_CLAMP))


def main(src_dir: str) -> None:
    total = 0
    for key, focus in FOCUS.items():
        im = Image.open(os.path.join(src_dir, f"bld_{key}.png")).convert("RGB")
        w, h = im.size
        wh = int(round(w / AR))
        y0 = max(0, min(h - wh, int(round((h - wh) * focus))))
        im = im.crop((0, y0, w, y0 + wh)).resize((OW, int(round(OW / AR))), Image.LANCZOS)

        a = np.asarray(im, dtype=np.float64) / 255.0
        sh = max(1, int(a.shape[0] * STRIP))

        def strip_mean(arr: np.ndarray, rows: int = sh) -> np.ndarray:
            return arr[:rows].reshape(-1, 3).mean(axis=0) * 255.0

        before = strip_mean(a)
        lum_before = 0.2126 * before[0] + 0.7152 * before[1] + 0.0722 * before[2]

        # ① 노출 — 하늘 띠 휘도를 목표로.
        a = np.power(a, solve_gamma(lum_before, TARGET_L))

        # ② 색온도 — R 과 B 를 반대로 밀어 R−B 만 목표로 옮긴다(평균 휘도는 거의 보존).
        m = strip_mean(a)
        shift = (TARGET_RB - (m[0] - m[2])) / 2.0
        a[..., 0] = np.power(a[..., 0], solve_gamma(m[0], m[0] + shift))
        a[..., 2] = np.power(a[..., 2], solve_gamma(m[2], m[2] - shift))

        after = strip_mean(a)
        lum_after = 0.2126 * after[0] + 0.7152 * after[1] + 0.0722 * after[2]

        path = os.path.join(OUT, ASSET_NAME[key])
        Image.fromarray(np.clip(a * 255.0, 0, 255).astype(np.uint8), "RGB").save(
            path, quality=86, method=6
        )
        size = os.path.getsize(path)
        total += size
        print(
            f"{key:11s} L {lum_before:5.1f} -> {lum_after:5.1f}   "
            f"R-B {before[0] - before[2]:+6.1f} -> {after[0] - after[2]:+6.1f}   "
            f"{size / 1024:.0f}KB"
        )
    print(f"{'tiles':11s} {total / 1024:.0f}KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
