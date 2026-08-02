/**
 * 시네마틱 석재 패널 — 격납고 화면 AAA 전환 Lane B
 * (`.omc/plans/hangar-aaa-2026-08-02.md` §3 Lane B).
 *
 * ## 왜 나무 nine-slice(`ui_panel.png`)를 은퇴시키는가
 * 격납고 4패널은 화면의 **약 97%** 를 덮는다. 그 면적 전부가 나무 프레임 + 평평한 남보라
 * 채움(`nineSlicePanel.ts` `COLOR.panelFill` #1c182e)이면, 배경 키아트를 아무리 잘 그려도
 * 화면은 "웹 대시보드"로 읽힌다. 여기서는 면 자체가 **석재 슬래브**가 되고, 기체 쇼케이스
 * 칸만 배경이 비치는 **도크 창**으로 뚫린다(계약 §1).
 *
 * ## 출처 — 여기 상수·헬퍼의 근거는 대부분 `cinematicTile.ts` 헤더에 있다
 * 그 파일은 기지 화면이 쓰고 있어 **수정 금지**(계약 §2)라 필요한 부분만 복제했다:
 * 방향성 베벨 3단({@link bevelLightPath}) · 2단 접지 그림자({@link CONTACT}/{@link DIFFUSE}) ·
 * 미세 그레인의 **알파 비대칭** · "램프는 띠를 겹치지 말고 구워라"(계약 §0-4) ·
 * 그림자는 NineSlice(892×496 과 936×424 는 비율이 다르다) · 금박 스톱은 `cinematicChrome.ts`
 * 의 각인 제목과 같은 값(화면 안에 금색이 두 종류면 그 자체가 아마추어 신호다).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ## AAA 비평 1차 판정(AA)에서 받은 6건과 그 처방 — **여기가 이 파일의 핵심 기록이다**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ### C1 (CRIT) 화면의 52.1% 가 단일 평면 재질이었다
 * 실측: 블러 후 L 범위 < 2.0 인 "맨 석재" 타일이 슬래브 **2026개** vs 기지 캡션 띠 14개 —
 * 같은 재질을 **145배 면적**으로 늘려 썼다. 고주파 |HF| 슬래브 **1.55** / 기지 기둥 6.38 /
 * 창 키아트 17.15. 화면의 과반을 덮는 표면이 화면에서 가장 정보가 없었다.
 *
 * → 처방은 **그레인 증폭이 아니다**(그건 M4 의 다른 축이다). {@link stoneLandmarks} 가
 *   **저주파 비반복 랜드마크**를 얹는다: 수평 이음선 2~3줄(**패널마다 y 가 다르다** — 같으면
 *   타일링으로 읽힌다) · 모서리 리벳 클러스터 2곳 · 각인 번호판 1개. 시드는 패널 치수와
 *   화면 좌표에서 뽑으므로 4패널이 구조적으로 서로 다르다. 게이트는 **개수 하한**이지
 *   균일도 상한이 아니다(계약 §6-1).
 *
 * ### C2 (CRIT) 창이 개구부가 아니라 `border: 1px solid gold` 였다
 * 실측: 창 내부 AO 회복이 좌 16px / 상 **0**(오히려 1.163 으로 밝았다) / 하 96px 로 3면이
 * 전부 달랐고, 립은 사방 L 74~75 짜리 1px 선이었다. 두께를 가진 개구부라면 어느 면이든
 * **일정한 reveal 폭**과 그에 비례한 AO 가 나온다.
 *
 * → 창 안쪽에 폭 {@link REVEAL_W}px 의 **석재 단면(reveal)** 을 두른다. 위/왼쪽 사면은
 *   어둡고 아래/오른쪽은 밝다 — **슬래브 베벨과 정확히 반대 방향**이다(볼록 vs 오목). 그
 *   사면 끝에서 AO 가 시작한다.
 *
 * ✅ **C2 는 종료됐다**(2차 실측: reveal 실재 — 좌 AO 0.333 · 우 0.276 · 상단 사면 스파이크
 *    1.560). 그리고 비평가가 1차 처방의 **"네 면 회복 거리 24px 통일"을 스스로 철회했다**:
 *    M6(패널별 방향광)과 모순이기 때문이다. **방향광이 있으면 4면 AO 는 달라야 옳다.**
 *    현재 좌 34 / 우 44 / 상 ~8 / 하 26px 비대칭은 **결함이 아니다** — 통일을 쫓지 마라.
 *    (하단이 32px 대역인 것은 M8 스크림이고, 그건 승인된 값이다.)
 *
 * ### M4 그레인 목표가 8-bit sRGB 로 유도됐는데 "±3L" 로 라벨돼 있었다
 * 실측: 맨 석재 면 8-bit **46.0** / L\* **19.26**. 그레인 span(8-bit) 중앙값 6.00 = 헤더
 * 목표 ±3 **정확히 달성**. 그런데 같은 그레인을 L\* 로 재면 span ≈ **2.5 L\*** — 지각
 * 진폭이 목표의 40% 였다. **목표는 맞고 단위가 틀렸다.**
 *
 * → 알파를 올리면 얼룩이 되므로 **면의 동작점을 올린다**: {@link SLAB_TOP}/{@link SLAB_BOTTOM}
 *   을 L\* 19 → **28** 대역으로(아래 검산). 그리고 그레인 진폭을 **8-bit 로 명시**하고
 *   ({@link GRAIN_HALF_SPAN_8BIT}) 알파 비대칭은 상수로 적지 않고 **새 동작점에서 파생**한다 —
 *   비대칭의 근거가 `(255−s)/s` 라서, 동작점이 바뀌면 값도 따라와야 원칙이 보존된다.
 *
 * ### M5 방향성 베벨인데 **광원이 없었다**
 * 실측: 상단 립 x40~840 을 40px 간격으로 → `75 75 75 … 74 75 73`, 모서리 제외 **std ≈ 0.5**.
 * 좌측 립도 74~75 로 상단과 같은 값. 광원이 무한 원거리 45°에 있다는 뜻이고, 그건 조명이
 * 아니라 CSS `border-top`/`border-left` 관습이다.
 *
 * → 립 알파를 {@link CinematicPanelOpts.lightOrigin} 로부터의 방향으로 변조한다. 띠를 겹쳐
 *   근사하지 않기 위해 **`FillGradient` 스트로크**를 쓴다(Pixi 가 내부에서 텍스처로 굽는다 —
 *   계약 §0-4 규율 그대로). 홈·그늘은 상수 그대로다(비평 통과분: 립 75 → 홈 41 → 면 50).
 *
 * ### M6 4개 슬래브가 화면 어디에 있든 똑같이 조명됐다 (시그니처 변경 — 리드 승인)
 * 실측: 940px 떨어진 세 슬래브의 좌측 세로 L 프로파일이 사실상 동일 곡선이었다.
 * → `screenX`/`screenY`/`lightOrigin` 을 받아 **램프 축·빛웅덩이 위치·립 변조·감쇠**를 전부
 *   여기서 파생시킨다. 셋 다 기본값이 있어 미지정 호출도 예외 없이 동작한다.
 *
 * ### M8 창 하단 스크림이 화면에서 가장 잘 그려진 구간을 96px 지웠다
 * 실측 하단 AO 비율 `0px 0.441 / 32px 0.862 / 96px 0.995` — 회복까지 96px. 그 자리가 바로
 * 따뜻한 바닥 램프 보케가 있는 구간이었다. 게다가 스크림의 근거였던 "그 위에 슬롯 라벨이
 * 얹힌다"가 **사실이 아니었다**(실화면에서 슬롯은 좌·우 가장자리에 있다).
 * → {@link SCRIM_H} 96 → **32**. 되찾은 구간은 별도 레인의 도크 크래들이 쓴다.
 *
 * ⚠️ 창 배경의 DOF 보케와 웜/쿨 보색 구성은 **이 화면에서 유일하게 진짜 회화다(|HF| 17.15)**.
 * 창 안을 더 누르는 방향의 처방은 전부 기각됐다 — 여기서 창을 덮는 요소를 늘리지 마라.
 *
 * ## figure-ground 는 테두리가 아니라 면의 밝기가 만든다 (동작점 검산)
 * 기지 1차 판정 CRIT-1: 카드가 배경보다 어두우면 물체가 아니라 **배경에 뚫린 구멍**이 된다.
 * Rec.601 검산 — {@link SLAB_TOP} rgb(103,77,56) **82.4** · {@link SLAB_BOTTOM} rgb(75,55,39)
 * **59.1** → 면 평균 **70.8**(실화면 렌더 계수 0.93 을 곱하면 측정 ≈66 = **L\* 28**, M4 가
 * 요구한 26~30 대역 안). 세로 Δ 23.3(8-bit) / 10.1 L\*.
 *
 * ⚠️ **면을 밝히면 그 위 글자 대비가 내려간다.** 콘텐츠 상자 안 가장 밝은 지점에서 검산하면
 * 크림계(#f0e6d2)는 **5.42:1** 로 통과하지만 옛 부제색(#b8ac97)은 **3.00:1** 로 AA 미달이다.
 * 배경을 도로 어둡게 하면 C1·M4 가 되돌아오므로 **전경을 올려야** 한다 — 리드 쪽 본문색은
 * **#dcd3c0 이상**(검산 4.51:1)을 쓸 것. 이 파일이 그리는 금박 각인 제목은 26px 700 굵기
 * 디스플레이 타입이라 대비 3.47:1(어두운 스톱)~8.14:1(밝은 스톱)로 large-text 3.0 을 넘는다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   shadow   구운 접지 그림자 2단(NineSlice) — 패널 바깥으로 번진다
 *            ⚠️ window 는 **링만** 굽는다(안쪽을 파냄) — 창은 물체가 아니라 구멍이다.
 *   clip     ← 둥근 사각 마스크
 *     body     석재 램프(slab) — 축이 lightOrigin 파생이라 패널마다 다르다
 *     pool     빛웅덩이(screen, slab) — 광원 쪽 모서리에 붙는다
 *     marks    저주파 랜드마크(slab): **세로 리브 2** · 이음선 · 파편 · 리벳 · 번호판 (C1-R)
 *     reveal   석재 단면 사면(window) — 위/왼쪽 어둡고 아래/오른쪽 밝다 (C2, 통과)
 *     ao       안쪽 가장자리 AO(window) — 4면 비대칭은 정상이다(방향광의 결과)
 *     streak   유리 반사 한 줄(window) — AO 대역 **바깥**에 둔다
 *     scrim    바닥 스크림 32px(window) (M8)
 *     grain    미세 그레인 (slab=전면 · window=스크림 구간만)
 *     band     각인 제목 띠 바탕
 *   groove   제목 띠 아래 홈 + 금박 입술
 *   edge     방향성 베벨(그늘 → 홈) + lip(립, lightOrigin 으로 변조) (M5)
 *   title    금박 각인 제목 + 표식
 * ```
 *
 * ## 패널 바깥으로 밝은 픽셀을 한 개도 그리지 않는다
 * 베벨 스트로크는 전부 **안쪽 정렬로 인셋**한다(Pixi 의 열린 경로 스트로크는 중심 정렬이라
 * 선 두께의 절반을 인셋해야 한다). 패널 밖으로 나가는 것은 **검은** 그림자 2단뿐이다.
 *
 * ## 콘텐츠 상자를 코드로 강제하는 이유
 * "제목이 테두리에 붙는다"는 지적이 이 리포에서 **2회 재발**했다(`nineSlicePanel.ts`
 * `PANEL_INNER_PAD` 헤더). 침범이 아니라 "숨 쉴 틈"의 문제라 프레임 두께만으로는 못 막는다.
 *
 * ## 구운 텍스처 캐시와 새 변수
 * ⚠️ 조명·밝기·치수에 의존하는 것은 **하나도 캐시하지 않는다** — 램프·립·랜드마크는 전부
 * 패널별 `Graphics`(`FillGradient` 포함)로 그린다. 모듈 캐시에 남는 것은 조명과 무관한
 * 기하·알파 텍스처(그레인·그림자·AO·스크림·반사·방사)뿐이라 첫 패널의 굽기가 나머지에
 * 재사용돼도 M6 이 무효가 되지 않는다. 그림자만 `hollow` 를 키에 포함한다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 */

import {
  CanvasSource,
  Container,
  FillGradient,
  Graphics,
  NineSliceSprite,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js';
import { UI_FONT } from './theme.js';
import { stripEmoji } from './text.js';

// --- 재질 상수 -------------------------------------------------------------------

/**
 * 석재 램프의 양 끝 색(광원 쪽 → 반대쪽). 헤더 "동작점 검산" 참고 — 면 평균 L\* 28 로
 * M4 가 요구한 26~30 대역 안이고, **눌린 배경보다 확실히 밝다**.
 * 따뜻한 갈색이어야 한다: 배경과 색온도가 갈리면 아무리 밝아도 "붙여 놓은 패널"이 된다.
 */
const SLAB_TOP = { r: 0x7a, g: 0x5b, b: 0x42 } as const;
const SLAB_BOTTOM = { r: 0x59, g: 0x41, b: 0x2e } as const;
/**
 * 굽기 전 면 평균 채널값(Rec.601 검산 83.7). {@link bodyScale} 로 행별 감쇠가 곱해져 실제
 * 면 평균은 ≈80 이 되고, **렌더 이득 0.798** 을 곱하면 화면에서 64 = **L\* 27** 이다.
 *
 * ## 렌더 이득 0.798 은 추정이 아니라 두 번 교차검증된 값이다 (M4-R)
 * 2차 독립 실측이 내 계산값과 어긋난 게 아니라 **일정한 비율로 눌려 있었다**:
 *  - 면 평균: 계산 70.8 → 실측 56.5(L\* 23.73) = **×0.798**
 *  - 그레인 span: 계산 9.40 → 실측 **7.62** = **×0.81**
 * 서로 독립인 두 양이 같은 계수로 눌렸으므로 이건 레터박스 축소·AA 의 전역 이득이다.
 * 그래서 이번에는 **목표를 화면값으로 잡고 역산**했다: 화면 L\* 27 → 8-bit 63.8 →
 * 계산값 63.8/0.798 = **80**.
 */
const SLAB_MEAN_8BIT = 84;
/**
 * 그레인 알파를 파생시킬 때 쓰는 **유효** 동작점 = 굽기 전 평균 × 행 감쇠 중앙값(0.955,
 * {@link BODY_SCALE_MIN}+{@link BODY_SCALE_SPAN}/2). 상수로 따로 적으면 램프를 조정할 때
 * 그레인 비대칭이 조용히 어긋난다.
 */
const GRAIN_BASE_8BIT = Math.round(SLAB_MEAN_8BIT * 0.955);

/**
 * 그레인 진폭 — **단위는 8-bit sRGB 다**.
 *
 * ## M4-R: 중앙값 보고가 국소 결함을 가렸다(계약 §6-2)
 * 2차 실측: L\* span **중앙값 3.398 · 최소 2.812 · 4 L\* 미만 타일 76.9%**. 내가 1차에
 * 보고한 4.08 은 이론 극단값이었고, 실제 분포의 중앙에 못 미쳤다. 이번 게이트는 **두 개**다:
 * `타일 span 최소 ≥ 3.5` **그리고** `span < 4 인 타일 비율 ≤ 20%`. 중앙값은 보고하지 않는다.
 *
 * ⚠️ 아래 기울기를 적을 때 `dL/d8bit` 를 슬래시로 쓰면 `*` 뒤에서 **블록 주석이 조기
 * 종료된다**(이 리포가 이미 한 번 밟은 함정). "8-bit 1 당 L\* 변화"로 풀어 쓴다.
 *
 * 검산(화면 기준 **8-bit 1 당 L\* 변화 ≈ 0.44** — L\*(57)=23.97 · L\*(64)=27.11 ·
 * L\*(70)=29.73 에서 기울기 0.45 · 0.448 · 0.437 로 일정): 계산 span 14.6 → 화면 11.8 →
 * **≈5.2 L\***.
 * 1차 실측 분포의 최소/중앙 비가 0.828 이었으므로 최소 ≈ 4.3 L\* 로 두 게이트 모두 통과한다.
 */
const GRAIN_HALF_SPAN_8BIT = 7.3;
/**
 * 흰 점과 검은 점의 알파가 다른 이유는 **합성이 비대칭**이기 때문이다: 바탕 s 위에 흰색을
 * 알파 a 로 얹으면 `s + (255−s)a`, 검은색은 `s(1−a)`. 그래서 같은 진폭을 내려면 비율이
 * 정확히 `(255−s)/s` 만큼 갈린다. **상수로 적지 않고 파생시키는 이유**가 여기 있다 —
 * 동작점(M4)이 바뀌면 값이 따라와야 원칙이 보존된다. 현 값: up 0.0255 · down 0.0662.
 */
const GRAIN_UP = GRAIN_HALF_SPAN_8BIT / (255 - GRAIN_BASE_8BIT);
const GRAIN_DOWN = GRAIN_HALF_SPAN_8BIT / GRAIN_BASE_8BIT;

/**
 * 방향성 베벨 3단(출처: `cinematicTile.ts` `BEVEL_LIGHT`). 립 **안쪽**의 어두운 홈은
 * `theme.ts` `iconContrastRingBands` 의 실측 결론("밝은 링이 아니라 어두운 홈")을 베벨과
 * 양립시키는 자리다. 비평 통과분이라 홈·그늘의 값과 구조는 건드리지 않았고, M5 로 바뀐 것은
 * **립 알파의 길이 방향 변조**뿐이다.
 */
const BEVEL_LIGHT = 0xd9b070;
const BEVEL_DARK = 0x120b06;
const BEVEL_DARK_ALPHA = 0.7;
const BEVEL_RECESS = 0x0d0805;
const BEVEL_RECESS_ALPHA = 0.5;
/**
 * 립 알파의 양 끝(광원에 가까운 쪽 → 먼 쪽). M5 게이트는 **하한 두 개**다: 길이 방향
 * span ≥ 8(8-bit) · 상단 립과 좌측 립의 평균 차 ≥ 4.
 *
 * ⚠️ 폭을 0.68/0.34 에서 0.72/0.26 으로 **벌린 이유**: 광원이 화면 위 중앙이라 오른쪽 두
 * 패널은 상단 립과 좌측 립이 **둘 다 광원 쪽**이 되어 기하학적 차이가 작다. 첫 시도에서
 * 쇼케이스 3.9 · 인벤토리 3.8 로 하한 4 를 아슬하게 못 넘었다(왼쪽 두 장은 18.1/14.7 로
 * 통과). 각도를 왜곡하는 대신 **알파 폭을 1.35배로 벌려** 같은 기하 차이가 더 크게 나오게
 * 했다 — 조명 모형은 그대로 두고 대비만 키우는 쪽이 정직하다.
 *
 * 밝은 끝이 타 버리지 않는 근거: 1px 선은 스크린샷에서 안티앨리어싱으로 눌려 실측/계산비가
 * ≈0.57 이다(옛 상수 α0.55 → 계산 131 · 실측 **75**). 새 밝은 끝은 감쇠 후 0.72×0.77≈0.554
 * 로 **옛 값과 사실상 같고**(계산 132 → 실측 ≈75), 어두운 끝만 실측 ≈53 으로 내려간다.
 * 즉 비평이 통과시킨 75 는 이제 상수가 아니라 **최댓값**이다.
 *
 * ## ⚠️ 립 span 의 **검증 표본 정의** — 이 정의로만 재라 (M5-R, 계약 §6-5)
 * 1차에 내가 보고한 span 38.6/25.2/31.4/21.3 은 **둥근 모서리의 감쇠를 포함한 min–max** 였다.
 * 모서리는 기하 때문에 항상 어두워지므로 **조명의 지표가 아니다.** 같은 립을 정의만 바꿔
 * 재면 결론이 뒤집힌다(독립 측정에서 상단 립 5.93/16.33/6.28/5.07 — 3패널 미달).
 *
 * **정본 정의**: 가장자리 4px 이내에서 최대 밝기 행/열을 립으로 확정한 뒤,
 * **모서리 반경 + 6px 을 양끝에서 제외한 직선 구간만**, **p1–p99** 로 span 을 잰다.
 * 상단 립과 좌측 립을 따로 재고 둘 다 하한 8(8-bit)을 넘어야 하며, 두 평균의 차가 ≥4 여야
 * 한다. 다음 라운드에 다른 정의로 재서 분쟁하지 마라 — 정의가 결론을 만든다.
 */
const LIP_ALPHA_NEAR = 0.72;
const LIP_ALPHA_FAR = 0.12;
/**
 * **입사각 계수**(M5-R 의 나머지 절반) — 위치가 아니라 **면의 법선**으로 갈리는 항이다.
 *
 * 그라디언트 하나만으로는 "축을 따라 어디에 있는가"밖에 못 담는다. 그런데 상단 립의 법선은
 * 위(0,−1)이고 좌측 립의 법선은 왼쪽(−1,0)이라, **같은 위치라도 받는 빛의 양이 다르다.**
 * 이 항이 없으면 광원이 거의 바로 위에 있는 패널에서 두 변이 수렴한다 — 인벤토리 |상단−좌측|
 * 이 **2.07** 로 하한 4 에 걸린 게 정확히 그 경우였다(다른 셋은 19.3/9.5/15.7 로 통과).
 * "위쪽 립은 여전히 상수다"라는 지적의 근본도 여기다.
 *
 * `k = FLOOR + SPAN × (max(0, −n·방향) / 둘 중 큰 값) ^ EXP` — 밝은 쪽 변은 항상 1 이라
 * 비평이 통과시킨 립 최댓값 75 가 보존되고, 등지는 변만 {@link LIP_NORMAL_FLOOR} 까지
 * 내려간다.
 *
 * ⚠️ **지수 3 은 장식이 아니라 두 하한을 동시에 만족시키는 유일한 형태다.** 선형(EXP=1)이면
 * 두 요구가 정면으로 충돌한다: 스탯 좌측 변은 광원을 완전히 등져(비 0.000) 계수가 바닥까지
 * 내려가는데 **span ≥ 8** 을 지키려면 바닥이 ≥0.72 여야 하고, 인벤토리 좌측 변은 비 0.590
 * 이라 **평균차 ≥ 4** 를 내려면 계수가 ≤0.83 이어야 한다. 선형은 0 → 0.59 사이에서 그만큼
 * 빨리 못 떨어진다(0.893 → 평균차 1.61 로 미달). 지수를 올리면 비 0 은 그대로 바닥에 두고
 * 중간 비만 끌어내릴 수 있다(0.590³ = 0.205 → 계수 0.793 → 평균차 5.7).
 * 좁은 베벨 면의 반사는 원래 cos 의 고차항이라 물리적으로도 부자연스럽지 않다.
 * 바닥을 0 이 아니라 **0.74** 로 둔 이유는 **span 하한 8 을 함께 지켜야** 하기 때문이다 —
 * 등지는 변을 물리대로 0 까지 떨어뜨리면 그 변의 span 이 8 밑으로 무너진다(0 이면 2.95,
 * 바닥 0.65 로도 스탯 좌측이 **7.33** 으로 미달했다). 두 하한이 서로 반대 방향으로 당기는
 * 자리라 바닥은 실측으로 정했고, 대신 {@link LIP_ALPHA_FAR} 를 0.26 → 0.12 로 내려 전체
 * 폭을 1.30배로 벌어 상쇄했다.
 */
const LIP_NORMAL_FLOOR = 0.74;
const LIP_NORMAL_SPAN = 0.26;
const LIP_NORMAL_EXP = 3;
/** 립·빛웅덩이·면의 거리 감쇠(M6). 광원에서 먼 패널은 통째로 어둡게 조명된다. */
const ATTEN_RANGE = 2400;
const ATTEN_FLOOR = 0.62;

/**
 * 석재 램프 축의 **가로 성분 감쇠**(N2). 0.55 → **0.22**.
 *
 * 2차 실측: 좌우 대칭 배치인 창고 L\* **21.58** vs 인벤토리 **27.52** — **5.94 차이**. 그런데
 * 램프 위치의 독립 증거인 인방 상단 띠는 좌우 대칭이었다(87.2 / 87.8). 즉 **비대칭을
 * 정당화할 광원이 화면에 없다.**
 *
 * 원인은 램프의 *평균*이 아니다 — 두 패널은 같은 두 끝점 색을 쓰므로 면 평균은 구조적으로
 * 같다. 문제는 **가로 성분이 크면 x 방향으로 밝기가 크게 변한다**는 것이고, 두 패널의
 * 랜드마크·빛웅덩이 배치가 달라 "맨 석재 타일"이 서로 다른 x 대역에서 뽑히면 그 차이가 그대로
 * 평균차로 나온다. 그래서 **가로 성분을 줄여 x-표본 편향이 밝기로 번역되는 계수를 낮췄다**:
 * 전폭에 걸친 가로 밝기 범위가 0.55 에서 3.9 L\* 였던 것이 0.22 에서 **≈2.0 L\*** 가 된다.
 *
 * ⚠️ **행 간 차이는 없애면 안 된다**(그건 거리 차라 정당하고, 없애면 M6 이 되돌아간다).
 * 그래서 가로를 줄인 만큼 {@link bodyScale} 로 **행별 감쇠를 면에 직접** 넣었다.
 */
const RAMP_SKEW = 0.22;
/**
 * 면 밝기의 행별 감쇠 폭(M6 의 정당한 절반). 광원에서 먼 아래 행이 실제로 어둡다.
 * 상단 행 atten≈0.767 → 0.966 · 하단 행 atten≈0.621 → 0.945.
 */
const BODY_SCALE_MIN = 0.945;
const BODY_SCALE_SPAN = 0.055;
/**
 * 빛웅덩이(N2). 알파 0.08 → **0.055**, 가로 오프셋 0.34 → **0.16**. 좌우 대칭 패널에서
 * 웅덩이 중심의 절대 x 가 크게 벌어지면(예전 0.679w vs 0.327w) 표본 편향이 커진다.
 */
const POOL_ALPHA = 0.055;
const POOL_OFFSET_X = 0.16;
const POOL_OFFSET_Y = 0.4;

/** 각인 금박 스톱 — `cinematicChrome.ts` 의 각인 제목·타이틀 로고와 **같은 값**. */
const GOLD_LIT = 0xf6d98a;
const GOLD_DARK = 0xb8862f;
/** 제목 각인의 어두운 아웃라인·드롭. 순흑이 아니라 깊은 웜 브라운(검은 외곽선 0px 규율). */
const TITLE_OUTLINE = 0x140d06;
/** 홈 아래 입술(빛을 받는 콘텐츠 면의 윗모서리). */
const GROOVE_LIP = 0xc9a04a;

/** 패널 모서리 반경(짧은 변 기준). 너무 둥글면 장난감이 된다 — 석재의 절제된 반경. */
const RADIUS_RATIO = 0.045;
const RADIUS_MIN = 10;
const RADIUS_MAX = 22;

/**
 * 콘텐츠 좌우·하단 여백. `nineSlicePanel` 의 60(=46 나무 살 + 14)을 그대로 쓰면 892 폭 중
 * 120 을 버려 정보 밀도가 목적인 화면(계약 §0-bis-3)에서 손해가 크다. 석재 슬래브에는
 * 물리적인 살이 없으므로 여백은 순수하게 **숨 쉴 틈**으로만 잡는다.
 */
const EDGE_PAD = 24;
/** 제목 띠와 콘텐츠 사이의 숨 쉴 틈. 0 이면 첫 행이 홈에 얹힌 것처럼 보인다. */
const CONTENT_GAP = 16;

/**
 * 제목 띠 높이 — **패널 높이에 비례시키지 않는다.** 격납고 4패널은 496/424 두 높이로 가로
 * 두 줄 격자를 이룬다. 비례로 잡으면 좌우 패널의 제목 기준선이 어긋나 격자가 무너진다.
 */
const TITLE_SIZE = 26;
const TITLE_BAND_H = Math.round(TITLE_SIZE * 2.0);
const TITLE_BAND_MAX_RATIO = 0.28;
const TITLE_MARK_W = 3;
const TITLE_MARK_GAP = 14;
/**
 * 제목 띠 바탕을 살짝 파낸다(뒤로 물러난 선반). 0.22 → 0.28 로 올린 것은 M4 로 면이 밝아진
 * 만큼 금박 각인의 대비가 내려가기 때문이다(검산: GOLD_DARK 스톱 3.21 → **3.47:1**).
 */
const BAND_RECESS_ALPHA = 0.28;

// --- 창(window) 상수 — C2/M8 ------------------------------------------------------

/** 석재 단면(reveal) 폭. 개구부가 **두께**를 갖게 하는 유일한 단서다(C2). */
const REVEAL_W = 6;
/** 위/왼쪽 사면(그늘) · 아래/오른쪽 사면(빛). 슬래브 베벨과 **반대 방향** = 오목. */
const REVEAL_DARK = 0x2a1f16;
const REVEAL_LIGHT = 0x8a6a4c;
const REVEAL_DARK_ALPHA = 0.88;
const REVEAL_LIGHT_ALPHA = 0.8;
/** 베벨 스트로크가 차지하는 바깥 1px. reveal 은 그 안쪽부터 시작한다. */
const EDGE_INSET = 1;
/**
 * 창 안쪽 AO 의 굽기 깊이. 나인슬라이스라 **텍스처상으로는** 네 면이 같지만, 실화면 회복
 * 거리는 방향광·스크림 때문에 면마다 다르게 나온다 — 그리고 **그게 옳다**(위 C2 절 참고,
 * 비평가가 "통일" 처방을 철회했다). 여기 값을 바꿔 4면을 억지로 맞추려 하지 마라.
 */
const AO_DEPTH = 24;
const AO_ALPHA = 0.55;
/** 유리 반사 한 줄. 두 줄이 되는 순간 창이 아니라 플라스틱 판이 된다. */
const STREAK_ALPHA = 0.12;
const STREAK_TINT = 0xf2e6cc;
const STREAK_RATIO = 0.1;
/**
 * 바닥 스크림 높이 — **고정 32px**(M8). 96px 짜리 비율 스크림은 창에서 가장 잘 그려진
 * 구간(따뜻한 바닥 램프 보케)을 지웠고, 근거였던 "그 위에 슬롯 라벨이 얹힌다"도 사실이
 * 아니었다. 밝은 바닥이 하단 립과 붙어 밝은 띠가 되는 문제는 별도 레인의 도크 크래들
 * 실루엣이 막는다. 하단만 회복 거리가 32px 인 것은 이 처방이 승인한 예외다.
 */
const SCRIM_H = 32;
const SCRIM_MAX_ALPHA = 0.55;

// --- 랜드마크 상수 — C1 ------------------------------------------------------------

/** 리벳 — 어두운 그림자 원반 + 몸통 + 캐치라이트 3장으로 볼록하게. */
const RIVET_R = 4.5;
const RIVET_FILL = 0x7c6046;

/** dt 상한 — 탭 복귀로 프레임이 크게 튀어도 연출이 순간이동하지 않게. */
const MAX_DT = 1 / 15;
/** 유리 반사의 아주 느린 숨. 진폭이 크면 조작 화면에서 시선을 뺏는다. */
const BREATH_PERIOD = 11;
const BREATH_AMP = 0.1;

// --- 그림자 굽기 명세(출처: cinematicTile.ts CONTACT/DIFFUSE) ----------------------

interface ShadowBake {
  readonly spread: number;
  readonly blur: number;
  readonly border: number;
  readonly offset: number;
  readonly alpha: number;
}

/** 접촉층 — 패널이 바닥에 **닿은** 자리. 좁고 짙어야 접지로 읽힌다. */
const CONTACT: ShadowBake = { spread: 12, blur: 4, border: 34, offset: 2, alpha: 0.85 };
/** 확산층 — 부피감. 넓고 옅게. 아래로 최대 `spread + offset` = 59px 번진다. */
const DIFFUSE: ShadowBake = { spread: 48, blur: 22, border: 70, offset: 11, alpha: 0.45 };

const SHADOW_CORE = 96;
/** 구운 사각의 모서리 반경 — {@link RADIUS_MAX} 와 맞춘다(격납고 4패널은 전부 상한에 걸린다). */
const SHADOW_RADIUS = RADIUS_MAX;

// --- 공개 계약 -------------------------------------------------------------------

/** 화면(디자인 스페이스) 램프 위치의 기본값 — 헤더 밴드 중앙 상단(배경 원화의 램프 대역). */
const DEFAULT_LIGHT = { x: 960, y: 60 } as const;

export interface CinematicPanelOpts {
  width: number;
  height: number;
  /** 'slab' = 불투명 석재(스탯·창고·인벤토리). 'window' = 배경이 비치는 유리창(쇼케이스). */
  variant: 'slab' | 'window';
  /** 각인 제목(없으면 헤더 띠를 그리지 않는다). */
  title?: string;
  /**
   * 화면(디자인 스페이스) 기준 이 패널의 좌상단. 조명이 화면 좌표에 묶이려면 필요하다(M6).
   * 미지정이면 0 — 예외는 나지 않지만 같은 치수의 패널끼리 조명이 같아진다.
   */
  screenX?: number;
  screenY?: number;
  /** 화면 램프 위치(디자인 좌표). 기본 {@link DEFAULT_LIGHT}. */
  lightOrigin?: { x: number; y: number };
}

export interface CinematicPanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
}

export interface CinematicPanel {
  readonly container: Container;
  /** 콘텐츠를 놓아도 되는 패널 로컬 상자. 헤더 띠가 있으면 그 아래부터다. */
  readonly box: CinematicPanelBox;
  /** 제목 띠 바로 아래 y(패널 로컬). 제목이 없으면 0. */
  readonly headerBottom: number;
  update(dt: number): void;
  destroy(): void;
}

// --- 구운 텍스처(모듈 1회, 모든 패널이 공유) ---------------------------------------
//
// ⚠️ 여기 있는 것은 **전부 조명·밝기·치수와 무관한 기하/알파 텍스처**다. 조명에 의존하는
//    것(램프·립·랜드마크)은 캐시하지 않고 패널별 Graphics 로 그린다 — 안 그러면 첫 패널의
//    굽기가 나머지에 재사용돼 M6 이 조용히 무효가 된다.

/** 캔버스 2D 컨텍스트 하나. 없으면 `null`(vitest 등) — 호출부는 그래도 화면을 세운다. */
function bakeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function fromCanvas(ctx: CanvasRenderingContext2D): Texture | null {
  try {
    const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
    tex.source.scaleMode = 'linear';
    return tex;
  } catch {
    return null;
  }
}

/** 석재 램프의 축 위치 `t`(0=광원 쪽, 1=반대쪽)에서의 채널값. */
function slabChannel(k: 'r' | 'g' | 'b', t: number): number {
  return Math.max(0, Math.min(255, Math.round(SLAB_TOP[k] + (SLAB_BOTTOM[k] - SLAB_TOP[k]) * t)));
}

let bodyCache: Texture | null | undefined;

/**
 * 슬래브 바탕 램프(1×256, 불투명) — **`FillGradient` 가 실패했을 때만 쓰는 세로 폴백**이다.
 * 폭 1px 이면 충분하다(세로로만 변한다). 띠를 겹쳐 근사하지 않는 이유는 계약 §0-4.
 */
function slabGradientTexture(): Texture | null {
  if (bodyCache !== undefined) return bodyCache;
  const h = 256;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    bodyCache = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    ctx.fillStyle = `rgb(${slabChannel('r', t)}, ${slabChannel('g', t)}, ${slabChannel('b', t)})`;
    ctx.fillRect(0, i, 1, 1);
  }
  bodyCache = fromCanvas(ctx);
  return bodyCache;
}

let scrimCache: Texture | null | undefined;

/**
 * 창 바닥 스크림(1×192). 위 0 → 아래 {@link SCRIM_MAX_ALPHA}. 지수 1.7 — 선형이면 위쪽이
 * 너무 빨리 덮인다. 색은 순흑이 아니라 깊은 웜 브라운이라 따뜻한 키아트 위에서 색온도가
 * 갈리지 않는다.
 */
function scrimTexture(): Texture | null {
  if (scrimCache !== undefined) return scrimCache;
  const h = 192;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    scrimCache = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    ctx.fillStyle = `rgba(11, 8, 5, ${(t ** 1.7 * SCRIM_MAX_ALPHA).toFixed(4)})`;
    ctx.fillRect(0, i, 1, 1);
  }
  scrimCache = fromCanvas(ctx);
  return scrimCache;
}

let streakCache: Texture | null | undefined;

/** 유리 반사 한 줄(1×64). 흰색으로 굽고 쓰는 쪽에서 `tint` 로 색을 준다. */
function streakTexture(): Texture | null {
  if (streakCache !== undefined) return streakCache;
  const h = 64;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    streakCache = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const a = Math.max(0, 1 - Math.abs(i - 5) / 30) ** 1.6;
    ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(4)})`;
    ctx.fillRect(0, i, 1, 1);
  }
  streakCache = fromCanvas(ctx);
  return streakCache;
}

let glowCache: Texture | null | undefined;

/** 중심이 흰색이고 가장자리로 사라지는 방사 텍스처(빛웅덩이). 지수 2.4 폴오프 · 16 스톱. */
function radialGlowTexture(): Texture | null {
  if (glowCache !== undefined) return glowCache;
  const size = 128;
  const ctx = bakeCanvas(size, size);
  if (ctx === null) {
    glowCache = null;
    return null;
  }
  const r = size / 2;
  try {
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    const stops = 16;
    for (let i = 0; i <= stops; i++) {
      const p = i / stops;
      grad.addColorStop(p, `rgba(255, 255, 255, ${(1 - p) ** 2.4})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  } catch {
    glowCache = null;
    return null;
  }
  glowCache = fromCanvas(ctx);
  return glowCache;
}

let grainCache: Texture | null | undefined;

/**
 * 미세 그레인(64² 타일, 알파만 있는 흑백 점). 난수는 xorshift 로 **결정적**이다 — 굽기가
 * 매번 같아야 스크린샷 회귀 비교가 성립한다. 보간은 `nearest` — `linear` 로 늘리면 그레인이
 * 뭉개져 그냥 얼룩이 된다. (둘 다 비평 통과분이라 유지한다. 바뀐 것은 알파 크기뿐 — M4.)
 */
function grainTexture(): Texture | null {
  if (grainCache !== undefined) return grainCache;
  const size = 64;
  const ctx = bakeCanvas(size, size);
  if (ctx === null) {
    grainCache = null;
    return null;
  }
  let tex: Texture | null;
  try {
    const img = ctx.createImageData(size, size);
    let seed = 0x9e3779b9;
    for (let i = 0; i < size * size; i++) {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      const n = (seed / 0xffffffff) * 2 - 1; // -1..1
      const up = n > 0;
      const o = i * 4;
      const v = up ? 255 : 0;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = Math.round(Math.abs(n) * (up ? GRAIN_UP : GRAIN_DOWN) * 255);
    }
    ctx.putImageData(img, 0, 0);
    tex = fromCanvas(ctx);
  } catch {
    tex = null;
  }
  if (tex !== null) tex.source.scaleMode = 'nearest';
  grainCache = tex;
  return tex;
}

const shadowCache = new Map<string, Texture | null>();

/**
 * 접지 그림자 실루엣(나인슬라이스용). 그림자는 패널과 **같은 모양**이어야 물체로 읽힌다 —
 * 방사 그라디언트를 늘린 타원은 모서리에 닿지 못해 화면에서 사라진다.
 *
 * ## ⚠️ `hollow` — window 는 물체가 아니라 **구멍**이다 (실화면 1차 판정 CRIT)
 * 채워진 실루엣은 `slab` 에서는 그 위에 불투명 body 램프가 덮여 **절대 드러나지 않는다**.
 * 그런데 `window` 는 내부를 채우지 않으므로 **그림자 실루엣이 곧 창 내용물이 된다** —
 * 확산층 α0.45 와 접촉층 α0.85 가 곱으로 합성되어 투과율 (1−0.45)(1−0.85) ≈ **0.08**.
 * 실측이 정확히 그 값이었다: 창 안 L p50 **73.8 → 8.0**(−66L).
 *
 * 그래서 `hollow` 는 안쪽 사각을 `destination-out` 으로 **지워 링만 남긴다**. 캐시 키에
 * `hollow` 가 **반드시** 들어가야 한다 — 안 넣으면 먼저 만들어진 쪽이 이긴다.
 */
function softShadowTexture(bake: ShadowBake, hollow: boolean): Texture | null {
  const key = `${bake.spread}:${bake.blur}:${hollow ? 'ring' : 'solid'}`;
  const hit = shadowCache.get(key);
  if (hit !== undefined) return hit;
  const size = SHADOW_CORE + bake.spread * 2;
  const ctx = bakeCanvas(size, size);
  if (ctx === null || typeof ctx.filter !== 'string' || typeof ctx.roundRect !== 'function') {
    shadowCache.set(key, null);
    return null;
  }
  ctx.filter = `blur(${bake.blur}px)`;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(bake.spread, bake.spread, SHADOW_CORE, SHADOW_CORE, SHADOW_RADIUS);
  ctx.fill();
  if (hollow) {
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.roundRect(bake.spread, bake.spread, SHADOW_CORE, SHADOW_CORE, SHADOW_RADIUS);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  const tex = fromCanvas(ctx);
  shadowCache.set(key, tex);
  return tex;
}

let aoCache: Texture | null | undefined;

/**
 * 창 안쪽 가장자리 AO(나인슬라이스용). 캔버스를 검게 채운 뒤 `destination-out` 으로 흐린
 * 둥근 사각을 **파낸다** — 중앙은 알파 0(배경이 그대로 비친다)이고 가장자리로 갈수록
 * 어두워진다. 밝은 링을 두르지 않고 어두운 홈으로만 대비를 만드는 규율(계약 §0-bis-2)의
 * 창 버전이다.
 *
 * 나인슬라이스라 **굽기 자체는 네 면이 같다**. 화면에서 면마다 회복 거리가 다르게 나오는
 * 것은 그 위에 얹힌 방향광·반사 줄·스크림 때문이고, 2차 판정에서 **그 비대칭이 정상으로
 * 확정됐다**(방향광이 있는데 4면이 같으면 그게 이상하다).
 */
function innerAoTexture(): Texture | null {
  if (aoCache !== undefined) return aoCache;
  const size = 160;
  const ctx = bakeCanvas(size, size);
  if (ctx === null || typeof ctx.filter !== 'string' || typeof ctx.roundRect !== 'function') {
    aoCache = null;
    return null;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.filter = `blur(${AO_DEPTH * 0.45}px)`;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(AO_DEPTH, AO_DEPTH, size - AO_DEPTH * 2, size - AO_DEPTH * 2, SHADOW_RADIUS);
  ctx.fill();
  aoCache = fromCanvas(ctx);
  return aoCache;
}

/** AO 나인슬라이스 경계 — 깊이 + 모서리 반경. 텍스처 절반(80)보다 작아야 한다. */
const AO_BORDER = AO_DEPTH + SHADOW_RADIUS;

// --- 조명(M5·M6) -------------------------------------------------------------------

interface PanelLight {
  /** 패널 중심에서 램프를 향하는 단위 벡터. */
  readonly ux: number;
  readonly uy: number;
  /** 램프까지의 거리(디자인 px)와 그로부터 나온 세기 감쇠(0..1). */
  readonly dist: number;
  readonly atten: number;
}

/**
 * 이 패널이 **화면 어디에 있는지**로부터 조명을 푼다(M6). 실측이 지적한 것은 940px 떨어진
 * 세 슬래브의 가장자리 L 프로파일이 사실상 같은 곡선이었다는 점이고, 원인은 조명이 패널
 * 로컬 좌표에만 묶여 있었기 때문이다. 여기서 나오는 값 하나가 램프 축·빛웅덩이 위치·립
 * 변조·전체 세기를 **전부** 결정한다.
 */
function panelLight(o: CinematicPanelOpts, w: number, h: number): PanelLight {
  const lo = o.lightOrigin ?? DEFAULT_LIGHT;
  const cx = (o.screenX ?? 0) + w / 2;
  const cy = (o.screenY ?? 0) + h / 2;
  const dx = lo.x - cx;
  const dy = lo.y - cy;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < 1) return { ux: 0, uy: -1, dist: 0, atten: 1 };
  const atten = Math.max(ATTEN_FLOOR, Math.min(1, 1 - dist / ATTEN_RANGE));
  return { ux: dx / dist, uy: dy / dist, dist, atten };
}

/**
 * 조명 방향을 그라디언트 축으로 바꾼다 — **패널 로컬 픽셀 좌표**로, `textureSpace: 'global'`
 * 과 함께 쓴다.
 *
 * ## 왜 정규 좌표(`'local'`)를 버렸는가 (M5-R)
 * 정규 좌표는 Pixi 가 도형의 **바운딩 박스로 스트레치**해서 해석한다. 892×496 처럼 정사각이
 * 아닌 상자에서는 내가 지정한 각도와 화면에 나오는 각도가 달라지고, 그래서 "상단 립에 변화가
 * 있어야 하는데 사실상 상수"라는 실측(스탯 상단 span 5.93)이 나왔다 — **의도한 축과 그려진
 * 축이 달랐다.** 픽셀 좌표는 그 변환이 없어 예측이 곧 결과다.
 *
 * 축의 양 끝은 패널을 정확히 덮도록 잡는다: 중심에서 방향 `u` 로 `R = (|ux|w + |uy|h)/2`
 * 만큼 나간 점이 밝은 끝, 반대쪽이 어두운 끝이다(축이 어느 각도든 네 모서리를 포함한다).
 *
 * `skew` 로 가로 성분을 눌러 램프가 지나치게 대각선이 되는 것을 막는다 — 석재는 중력(세로)이
 * 읽혀야 하고, 가로 성분은 "이 패널이 광원의 어느 쪽에 있는가"를 알려 줄 만큼만 있으면 된다.
 */
function lightAxis(
  l: PanelLight,
  w: number,
  h: number,
  skew: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rx = l.ux * skew;
  const ry = l.uy;
  const n = Math.hypot(rx, ry) || 1;
  const ax = rx / n;
  const ay = ry / n;
  const r = (Math.abs(ax) * w + Math.abs(ay) * h) / 2;
  return {
    start: { x: w / 2 + ax * r, y: h / 2 + ay * r },
    end: { x: w / 2 - ax * r, y: h / 2 - ay * r },
  };
}

/**
 * 면 밝기의 행별 감쇠(M6 의 정당한 절반 — 거리 차). 가로 성분을 {@link RAMP_SKEW} 로 줄여
 * N2 를 푸는 대신, 위/아래 행의 차이는 **여기서** 유지한다. 안 그러면 N2 를 고치면서 M6 을
 * 통째로 되돌리게 된다.
 */
function bodyScale(l: PanelLight): number {
  const norm = Math.max(0, Math.min(1, (l.atten - ATTEN_FLOOR) / (1 - ATTEN_FLOOR)));
  return BODY_SCALE_MIN + BODY_SCALE_SPAN * norm;
}

/** 램프 끝점 색에 행별 감쇠를 곱해 정수색으로. */
function scaledHex(c: { r: number; g: number; b: number }, s: number): number {
  const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v * s)));
  return (q(c.r) << 16) | (q(c.g) << 8) | q(c.b);
}

// --- 결정적 난수(C1) ----------------------------------------------------------------

/**
 * 패널 치수 + 화면 좌표에서 뽑는 시드. **패널마다 랜드마크 배치가 달라야** 한다 — 같으면
 * 4장이 같은 텍스처를 늘려 쓴 것으로 읽혀 C1 이 그대로 되돌아온다. `Math.random()` 을 쓰지
 * 않는 이유는 그레인과 같다(스크린샷 회귀 비교가 세션마다 흔들린다).
 */
function seedFrom(...vals: number[]): number {
  let s = 0x811c9dc5;
  for (const v of vals) {
    s ^= Math.round(v) >>> 0;
    s = Math.imul(s, 0x01000193) >>> 0;
  }
  return s === 0 ? 0x9e3779b9 : s >>> 0;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

// --- 순수 헬퍼(출처: cinematicTile.ts bevelLightPath/bevelDarkPath) -----------------

/**
 * 둥근 사각의 **위/왼쪽 반**(볼록면에서 빛을 받는 쪽) 경로. 좌하 모서리 호의 중점에서
 * 시작해 우상 호의 중점에서 끝난다 — **대각선에서 갈라야** 이음매가 모서리 한가운데에 놓여
 * 눈에 띄지 않는다. `inset` 은 스트로크가 패널 밖으로 새지 않게 하는 값.
 */
function bevelLightPath(g: Graphics, w: number, h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const q = Math.PI / 2;
  g.arc(x0 + r, y1 - r, r, q * 1.5, Math.PI)
    .lineTo(x0, y0 + r)
    .arc(x0 + r, y0 + r, r, Math.PI, q * 3)
    .lineTo(x1 - r, y0)
    .arc(x1 - r, y0 + r, r, q * 3, q * 3.5);
}

/**
 * {@link bevelLightPath} 의 **좌측 절반** — 좌하 호 중점에서 좌상 호의 **중점(225°)** 까지.
 * 립을 두 갈래로 나누는 이유는 {@link LIP_NORMAL_FLOOR} 헤더에 있다(법선이 다르면 받는 빛이
 * 다르다). 가르는 자리를 모서리 호의 한가운데로 잡는 것은 명암 경계를 숨기는 같은 규율이다.
 */
function bevelLipLeftPath(g: Graphics, _w: number, h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const q = Math.PI / 2;
  g.arc(inset + r, h - inset - r, r, q * 1.5, Math.PI)
    .lineTo(inset, inset + r)
    .arc(inset + r, inset + r, r, Math.PI, q * 2.5);
}

/** {@link bevelLightPath} 의 **상단 절반** — 좌상 호 중점(225°)에서 우상 호 중점까지. */
function bevelLipTopPath(g: Graphics, w: number, _h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const q = Math.PI / 2;
  g.arc(inset + r, inset + r, r, q * 2.5, q * 3)
    .lineTo(w - inset - r, inset)
    .arc(w - inset - r, inset + r, r, q * 3, q * 3.5);
}

/** 둥근 사각의 **아래/오른쪽 반**. {@link bevelLightPath} 와 정확히 상보다. */
function bevelDarkPath(g: Graphics, w: number, h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const q = Math.PI / 2;
  g.arc(x1 - r, y0 + r, r, q * 3.5, q * 4)
    .lineTo(x1, y1 - r)
    .arc(x1 - r, y1 - r, r, 0, q)
    .lineTo(x0 + r, y1)
    .arc(x0 + r, y1 - r, r, q, q * 1.5);
}

function rgbaCss(hex: number, alpha: number): string {
  return `rgba(${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}, ${alpha.toFixed(4)})`;
}

/**
 * 저주파 랜드마크(C1). **면적당 개수가 하한 게이트**이므로 개수를 세기 쉽게 한곳에 모았다:
 * 수평 이음선 2~3줄 + 리벳 클러스터 2곳(각 3개) + 각인 번호판 1개 = 매크로 **5~6개**
 * (리벳을 개별로 세면 9~10개). 전부 저주파라 그레인(고주파)과 축이 겹치지 않는다.
 *
 * 이음선 y 는 시드에서 뽑되 콘텐츠 상자 안쪽에서만 움직인다 — 화면 밖으로 나가거나 제목 띠를
 * 자르면 안 되고, 무엇보다 **패널끼리 y 가 겹치면 타일링으로 읽혀 처방이 무효가 된다.**
 */
function stoneLandmarks(
  g: Graphics,
  w: number,
  h: number,
  bandH: number,
  rng: () => number,
): void {
  // ① 세로 석재 리브는 **사용자 판단으로 제거됐다**(2026-08-02).
  //
  // AAA 비평 C1-R-ⓐ 는 "끊기지 않는 가로 맨석재 최장 구간 ≤ 450px" 을 요구했고, 세로 리브
  // 2줄이 그것을 실제로 달성한 유일한 수단이었다(775 → 321px). 그런데 실화면에서 리브가
  // **스탯 표와 슬롯 그리드를 세로로 관통해 괘선처럼 읽혔고**, 사용자가 그것을 보고 삭제를
  // 지시했다. 자리를 옮기는 대신 없애는 쪽을 택한 것이다.
  //
  // ⚠️ **그 지표가 미달이라는 이유로 되살리지 마라.** 판정 기준은 스크린샷이고 수치는 대리
  // 지표다(계약 §6-6). 같은 종류의 대체 표식을 임의로 넣는 것도 같은 이유로 금지다 — 사용자가
  // 지운 것과 같은 것이 다시 생긴다. 되살릴 일이 생기면 이 블록의 상수(`RIB_*`)가 그대로 있다.

  // ② 수평 이음선(전폭 2~3줄)과 ③ 짧은 코스 파편도 **사용자 판단으로 제거됐다**(2026-08-02,
  //    세로 리브·번호판과 같은 지시). 이음선은 콘텐츠 상자 바깥 여백 대역에만 앉혀 본문 줄과
  //    교차하지 않게 해 두었지만, 실화면에서는 여전히 슬롯 그리드 사이와 스탯 표 오른쪽을
  //    가로지르는 선으로 읽혔다.
  //
  //    이로써 C1(면 분절) 계열 처방은 전부 걷혔다 — 남은 것은 **재질과 조명**뿐이다:
  //    석재 세로 램프(M4) · 방향성 베벨 3단(M5) · 패널별 조명(M6·N2) · 미세 그레인 · 2단
  //    접지 그림자. 면을 깨는 장치가 없어도 그 다섯이 슬래브를 평면 색판이 아니게 만든다.
  //
  //    ⚠️ "최장 가로 맨석재 구간" 지표가 미달이라는 이유로 **다른 형태의 표식을 새로 넣지
  //    마라.** 사용자가 지운 것과 같은 종류가 다시 생긴다(계약 §6-6 — 판정 기준은 스크린샷).

  // ② 리벳 클러스터 2곳. 콘텐츠 상자({@link EDGE_PAD}=24) 바깥의 12px 대역에 앉힌다.
  const corners: { x: number; y: number; dy: number }[] = [
    { x: 12, y: bandH + 20, dy: 1 },
    { x: w - 12, y: bandH + 20, dy: 1 },
    { x: 12, y: h - 20, dy: -1 },
    { x: w - 12, y: h - 20, dy: -1 },
  ];
  const first = Math.floor(rng() * 4) % 4;
  const second = (first + 1 + Math.floor(rng() * 3)) % 4;
  for (const idx of [first, second]) {
    const c = corners[idx];
    if (c === undefined) continue;
    for (let k = 0; k < 3; k++) {
      const y = c.y + c.dy * k * (RIVET_R * 3.4);
      if (y < bandH + 8 || y > h - 8) continue;
      g.circle(c.x + 0.9, y + 0.9, RIVET_R).fill({ color: 0x120b06, alpha: 0.45 });
      g.circle(c.x, y, RIVET_R).fill({ color: RIVET_FILL, alpha: 0.55 });
      g.circle(c.x - 0.7, y - 0.7, RIVET_R * 0.5).fill({ color: BEVEL_LIGHT, alpha: 0.24 });
    }
  }
}

/**
 * 각인 번호판 — 제목 띠 **오른쪽 끝**에 앉힌다. 콘텐츠 상자를 침범하지 않는 유일한 자리이고
 * (제목은 왼쪽 정렬이라 충돌하지 않는다), 실제 격납고 설비의 명판 관습과도 맞는다.
 * 눈금 개수를 시드에서 뽑아 패널마다 다르게 한다.
 */
/**
 * 각인 제목 스택. 뒤 → 앞으로 ①1px 다크 드롭 ②금 그라디언트 + 다크 아웃라인. 굵기만 올리면
 * 그냥 굵은 본문이고, 그림자만 얹으면 떠 있는 글자다 — 둘이 같이 있어야 각인으로 읽힌다.
 *
 * ⚠️ **자간 0.** 한국어 2~4음절에 트래킹을 주면 디자인이 아니라 띄어쓰기 버그로 읽힌다.
 * 폭 측정(`Text.width`)은 **하지 않는다** — vitest 에서 던지는 API 라 애초에 의존하지 않는
 * 배치(왼쪽 정렬)를 골랐다.
 */
function engravedTitle(text: string): Container {
  const root = new Container();
  const base = {
    fontFamily: UI_FONT,
    fontSize: TITLE_SIZE,
    fontWeight: '700' as const,
    letterSpacing: 0,
  };
  const stroke = { color: TITLE_OUTLINE, width: 4, join: 'round' as const };

  try {
    const drop = new Text({ resolution: 2, text, style: { ...base, fill: TITLE_OUTLINE, stroke } });
    drop.anchor.set(0, 0.5);
    drop.position.set(0, 1);
    root.addChild(drop);
  } catch {
    /* 드롭이 없어도 아래 face 만으로 글자는 읽힌다. */
  }

  let fill: FillGradient | number = GOLD_LIT;
  try {
    fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: GOLD_LIT },
        { offset: 1, color: GOLD_DARK },
      ],
    });
  } catch {
    fill = GOLD_LIT;
  }

  try {
    const face = new Text({ resolution: 2, text, style: { ...base, fill, stroke } });
    face.anchor.set(0, 0.5);
    root.addChild(face);
  } catch {
    /* 캔버스가 아예 없는 환경 — 제목 없이도 패널은 서야 한다(계약 §0-7). */
  }
  return root;
}

// --- 본체 ------------------------------------------------------------------------

/**
 * 패널 한 장. 반환 `container` 는 (0,0) 기준 width×height 를 차지하고, **그림자만 바깥으로**
 * 번진다(아래로 최대 {@link DIFFUSE}`.spread + .offset` = 59px). 위치는 리드가
 * `.position.set()` 으로 잡는다.
 *
 * ⚠️ 계약 §1: 행 간격 20 은 이 번짐보다 작다. 리드가 **위 행부터 순서대로** 붙여 아래 행
 * 패널이 위 행 그림자를 덮게 해야 한다 — 여기서 그림자를 줄이면 접지가 다시 사라진다.
 */
export function makeCinematicPanel(o: CinematicPanelOpts): CinematicPanel {
  const w = Math.max(1, Math.round(o.width));
  const h = Math.max(1, Math.round(o.height));
  const isWindow = o.variant === 'window';
  const radius = Math.max(
    RADIUS_MIN,
    Math.min(RADIUS_MAX, Math.round(Math.min(w, h) * RADIUS_RATIO)),
  );
  const light = panelLight(o, w, h);

  const rawTitle = typeof o.title === 'string' ? stripEmoji(o.title).trim() : '';
  const hasTitle = rawTitle.length > 0;
  const bandH = hasTitle ? Math.round(Math.min(TITLE_BAND_H, h * TITLE_BAND_MAX_RATIO)) : 0;

  // 콘텐츠 상자를 **먼저** 확정한다 — 랜드마크(C1-R-ⓑ)가 "글자와 만날 수 없는 여백 대역"에
  // 앉으려면 그 경계를 알아야 하기 때문이다. 제목이 있으면 띠 아래 + 숨 쉴 틈부터 시작한다
  // (헤더의 "2회 재발" 참고).
  const headerBottom = hasTitle ? bandH : 0;
  const boxY = hasTitle ? bandH + CONTENT_GAP : EDGE_PAD;
  const boxW = Math.max(0, w - EDGE_PAD * 2);
  const boxH = Math.max(0, h - boxY - EDGE_PAD);
  const box: CinematicPanelBox = {
    x: EDGE_PAD,
    y: boxY,
    w: boxW,
    h: boxH,
    right: EDGE_PAD + boxW,
    bottom: boxY + boxH,
  };

  const root = new Container();

  // --- 접지 그림자 2단(확산 → 접촉) -----------------------------------------------
  // 확산층을 먼저(뒤에) 깔고 접촉층을 그 위에 얹어야 테두리 바로 밑이 가장 짙어진다.
  // ⚠️ `window` 는 **링만** 굽는다 — 채워진 실루엣이 곧 창 내용물이 되어 배경을 순흑으로
  //    덮는다(softShadowTexture `hollow` 헤더의 −66L 실측).
  for (const bake of [DIFFUSE, CONTACT]) {
    const tex = softShadowTexture(bake, isWindow);
    if (tex === null) continue;
    const ns = new NineSliceSprite({
      texture: tex,
      leftWidth: bake.border,
      topHeight: bake.border,
      rightWidth: bake.border,
      bottomHeight: bake.border,
    });
    ns.width = w + bake.spread * 2;
    ns.height = h + bake.spread * 2;
    ns.position.set(-bake.spread, -bake.spread + bake.offset);
    ns.alpha = bake.alpha;
    root.addChild(ns);
  }

  // --- 패널 내용물(둥근 모서리 클리핑) ---------------------------------------------
  // 마스크는 우리 서브트리(`clip`)에만 걸린다 — 리드가 `container` 에 붙이는 콘텐츠는 영향을
  // 받지 않는다. 마스크 Graphics 는 히트 테스트에서 빠지므로 클릭 경로도 건드리지 않는다.
  const clip = new Container();
  const clipMask = new Graphics();
  clipMask.roundRect(0, 0, w, h, radius).fill({ color: 0xffffff });
  root.addChild(clip);
  root.addChild(clipMask);
  clip.mask = clipMask;

  if (!isWindow) {
    // 바탕 — 따뜻한 석재 램프. 축이 lightOrigin 파생이라 **패널마다 다르다**(M6).
    // `FillGradient` 는 Pixi 가 내부에서 텍스처로 굽는다 — 띠를 겹치지 않으므로 계약 §0-4
    // 규율을 만족하고, 패널별로 만들기 때문에 캐시 오염(첫 패널이 이기는 문제)도 없다.
    let ramped = false;
    const scale = bodyScale(light);
    try {
      const axis = lightAxis(light, w, h, RAMP_SKEW);
      const grad = new FillGradient({
        type: 'linear',
        start: axis.start,
        end: axis.end,
        colorStops: [
          { offset: 0, color: scaledHex(SLAB_TOP, scale) },
          { offset: 1, color: scaledHex(SLAB_BOTTOM, scale) },
        ],
        textureSpace: 'global',
      });
      const body = new Graphics();
      body.rect(0, 0, w, h).fill(grad);
      clip.addChild(body);
      ramped = true;
    } catch {
      ramped = false;
    }
    if (!ramped) {
      const tex = slabGradientTexture();
      if (tex !== null) {
        const fallback = new Sprite(tex);
        fallback.width = w;
        fallback.height = h;
        clip.addChild(fallback);
      } else {
        const flat = new Graphics();
        flat.rect(0, 0, w, h).fill({ color: scaledHex(SLAB_TOP, scale * 0.9) });
        clip.addChild(flat);
      }
    }

    // 빛웅덩이 — 광원을 **향한 쪽 모서리**에 붙는다(M6). `tint` 는 곱연산이라 밝힐 수 없으므로
    // (계약 §0-5) `screen` 으로 얹는다. 알파가 낮아 램프를 지우지 않는다.
    const glowTex = radialGlowTexture();
    if (glowTex !== null) {
      const pool = new Sprite(glowTex);
      pool.anchor.set(0.5);
      pool.tint = 0xffe6b8;
      pool.blendMode = 'screen';
      pool.alpha = POOL_ALPHA * light.atten;
      pool.position.set((0.5 + light.ux * POOL_OFFSET_X) * w, (0.5 + light.uy * POOL_OFFSET_Y) * h);
      pool.width = w * 1.25;
      pool.height = h * 0.9;
      clip.addChild(pool);
    }

    // 저주파 랜드마크(C1) — 그레인 **아래**에 둔다. 그레인이 위를 덮어야 이음선·리벳이
    // 슬래브와 같은 재질로 읽힌다(따로 얹은 벡터 도형처럼 보이면 안 된다).
    const rng = makeRng(seedFrom(w, h, o.screenX ?? 0, o.screenY ?? 0, hasTitle ? 1 : 0));
    const marks = new Graphics();
    stoneLandmarks(marks, w, h, bandH, rng);
    // 각인 번호판도 **사용자 판단으로 제거됐다**(2026-08-02, 리브와 같은 지시). 제목 띠
    // 오른쪽 끝의 눈금 표식이 "부품을 얹은 것"으로 읽혔다. 함수(`designationPlate`)는 남겨
    // 두었으니 되살리려면 이 한 줄이다.
    clip.addChild(marks);
  } else {
    // 창 — **채우지 않는다.** 배경 키아트가 그대로 비친다. 창 안을 더 누르는 처방은
    // 비평에서 전부 기각됐다(|HF| 17.15 = 이 화면에서 유일하게 진짜 회화인 구간).

    // ① 석재 단면(reveal) — 개구부에 **두께**를 준다(C2). 위/왼쪽이 어둡고 아래/오른쪽이
    //    밝다 = 슬래브 베벨과 **반대 방향**(볼록 vs 오목). 이게 없으면 창은 1px 금색
    //    테두리를 두른 사각 구멍, 즉 `border: 1px solid gold` 로 읽힌다.
    const rv = new Graphics();
    bevelLightPath(rv, w, h, radius, EDGE_INSET + REVEAL_W / 2);
    rv.stroke({ color: REVEAL_DARK, width: REVEAL_W, alpha: REVEAL_DARK_ALPHA });
    bevelDarkPath(rv, w, h, radius, EDGE_INSET + REVEAL_W / 2);
    rv.stroke({ color: REVEAL_LIGHT, width: REVEAL_W, alpha: REVEAL_LIGHT_ALPHA });
    clip.addChild(rv);

    // ② 안쪽 AO — **사면 끝에서** 시작하고 회복 거리는 네 면 모두 AO_DEPTH 로 같다(C2).
    const aoTex = innerAoTexture();
    if (aoTex !== null) {
      const inset = EDGE_INSET + REVEAL_W;
      const ao = new NineSliceSprite({
        texture: aoTex,
        leftWidth: AO_BORDER,
        topHeight: AO_BORDER,
        rightWidth: AO_BORDER,
        bottomHeight: AO_BORDER,
      });
      ao.width = Math.max(1, w - inset * 2);
      ao.height = Math.max(1, h - inset * 2);
      ao.position.set(inset, inset);
      ao.alpha = AO_ALPHA;
      clip.addChild(ao);
    }
  }

  // --- 유리 반사 한 줄(window) ------------------------------------------------------
  // ⚠️ AO 대역 **바깥**에 둔다. 예전에는 창 맨 위에 있어서 상단 AO 를 지웠고(실측 1.163 —
  // 대조군보다 오히려 밝았다) 그게 C2 의 "3면이 전부 다르다"의 절반이었다.
  let streak: Sprite | null = null;
  if (isWindow) {
    const streakTex = streakTexture();
    if (streakTex !== null) {
      streak = new Sprite(streakTex);
      streak.tint = STREAK_TINT;
      streak.blendMode = 'screen';
      streak.alpha = STREAK_ALPHA;
      streak.position.set(EDGE_INSET + REVEAL_W, EDGE_INSET + REVEAL_W + AO_DEPTH + bandH);
      streak.width = Math.max(1, w - (EDGE_INSET + REVEAL_W) * 2);
      streak.height = Math.max(16, Math.round(h * STREAK_RATIO));
      clip.addChild(streak);
    }
  }

  // --- 바닥 스크림(window) — 96 → 32px (M8) ------------------------------------------
  if (isWindow) {
    const scrimTex = scrimTexture();
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, h - SCRIM_H);
      scrim.width = w;
      scrim.height = SCRIM_H;
      clip.addChild(scrim);
    }
  }

  // --- 미세 그레인 -------------------------------------------------------------------
  // slab 은 면 전체, window 는 **스크림 구간만**. 창의 투명한 부분에 그레인을 깔면 배경
  // 키아트가 통째로 지저분해지고, 무엇보다 창이 유리가 아니라 먼지 낀 아크릴이 된다.
  const grainTex = grainTexture();
  if (grainTex !== null) {
    const top = isWindow ? h - SCRIM_H : 0;
    const grain = new TilingSprite({ texture: grainTex, width: w, height: h - top });
    grain.position.set(0, top);
    clip.addChild(grain);
  }

  // --- 각인 제목 띠 -------------------------------------------------------------------
  let titleNode: Container | null = null;
  if (hasTitle) {
    // 띠 바탕은 뒤로 물러난 선반이다 — 순흑 채움이 아니라 톤 다운(불투명 채움 0px 규율).
    const band = new Graphics();
    band.rect(0, 0, w, bandH).fill({ color: 0x0f0a06, alpha: BAND_RECESS_ALPHA });
    clip.addChild(band);

    // 홈과 그 아래 입술. 광원이 위에 있으므로 **물러난 띠의 아래 모서리에서 다시 앞으로
    // 나오는 면**이 빛을 받는다 → 어두운 홈(띠 바닥) 다음에 금박 입술(콘텐츠 면 윗모서리).
    // 순서를 뒤집으면 띠가 앞으로 튀어나온 것처럼 보인다.
    const groove = new Graphics();
    groove.rect(0, bandH - 1, w, 1).fill({ color: 0x0b0704, alpha: 0.7 });
    groove.rect(0, bandH, w, 1).fill({ color: GROOVE_LIP, alpha: 0.28 });
    root.addChild(groove);

    // 왼쪽 금색 표식 — 텍스트 폭을 재지 않는 장식이라 캔버스 없는 환경에서도 안전하다.
    const mark = new Graphics();
    const markH = Math.round(bandH * 0.42);
    mark
      .rect(EDGE_PAD, Math.round((bandH - markH) / 2), TITLE_MARK_W, markH)
      .fill({ color: GOLD_DARK, alpha: 0.9 });
    root.addChild(mark);

    titleNode = engravedTitle(rawTitle);
    titleNode.position.set(EDGE_PAD + TITLE_MARK_W + TITLE_MARK_GAP, Math.round(bandH / 2));
    root.addChild(titleNode);
  }

  // --- 테두리: 방향성 베벨 -------------------------------------------------------------
  // ① 아래/오른쪽 그늘 → ② 위/왼쪽 립 **안쪽**의 어두운 홈 → ③ 위/왼쪽 립.
  // 셋 다 안쪽으로 인셋해 패널 **바깥에는 아무것도 없다**. ①②는 비평 통과분이라 상수 그대로고,
  // ③만 lightOrigin 으로 변조한다(M5) — 상수 스트로크는 "광원이 무한 원거리 45°" 라는
  // 물리적으로 불가능한 조명이고, 그건 조명이 아니라 CSS `border-top` 관습이다.
  const edge = new Graphics();
  bevelDarkPath(edge, w, h, radius, 1);
  edge.stroke({ color: BEVEL_DARK, width: 2, alpha: BEVEL_DARK_ALPHA });
  bevelLightPath(edge, w, h, radius, 1.5);
  edge.stroke({ color: BEVEL_RECESS, width: 1, alpha: BEVEL_RECESS_ALPHA });
  root.addChild(edge);

  // 립은 **두 갈래**다(M5-R): 위치에 따른 변조는 그라디언트가, 면의 방향에 따른 변조는
  // 입사각 계수가 맡는다. 축은 **감쇠를 걸지 않은 실제 조명 방향**(skew 1)을 쓰고 좌표는
  // 픽셀이라, 상단 변·좌측 변 둘 다 실제로 변조된다(정규 좌표에서는 바운딩 박스 스트레치
  // 때문에 한쪽이 상수가 됐다).
  const nTop = Math.max(0, -light.uy);
  const nLeft = Math.max(0, -light.ux);
  const nMax = Math.max(nTop, nLeft, 1e-6);
  const facet = (n: number): number =>
    LIP_NORMAL_FLOOR + LIP_NORMAL_SPAN * (n / nMax) ** LIP_NORMAL_EXP;
  const kTop = facet(nTop);
  const kLeft = facet(nLeft);
  const lipAxis = lightAxis(light, w, h, 1);
  for (const [k, path] of [
    [kLeft, bevelLipLeftPath],
    [kTop, bevelLipTopPath],
  ] as const) {
    const lip = new Graphics();
    path(lip, w, h, radius, 0.5);
    const gain = light.atten * k;
    let ok = false;
    try {
      const grad = new FillGradient({
        type: 'linear',
        start: lipAxis.start,
        end: lipAxis.end,
        colorStops: [
          { offset: 0, color: rgbaCss(BEVEL_LIGHT, LIP_ALPHA_NEAR * gain) },
          { offset: 1, color: rgbaCss(BEVEL_LIGHT, LIP_ALPHA_FAR * gain) },
        ],
        textureSpace: 'global',
      });
      lip.stroke({ fill: grad, width: 1 });
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      // 폴백은 두 알파의 중간값 — 그라디언트가 불가능한 환경에서도 립이 사라지면 안 되고,
      // 입사각 계수는 폴백에서도 살아 있어야 방향이 읽힌다.
      lip.stroke({
        color: BEVEL_LIGHT,
        width: 1,
        alpha: ((LIP_ALPHA_NEAR + LIP_ALPHA_FAR) / 2) * gain,
      });
    }
    root.addChild(lip);
  }

  // --- 연출 ---------------------------------------------------------------------------
  // 조작 화면이라 움직이는 것은 유리 반사의 아주 느린 숨 하나뿐이다(±10%). slab 은 정지 —
  // 정비 도구에서 면이 출렁이면 클릭이 흔들리는 느낌을 준다.
  let time = 0;
  const update = (dt: number): void => {
    if (streak === null) return;
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    time += step;
    const breath = Math.sin((time / BREATH_PERIOD) * Math.PI * 2);
    streak.alpha = STREAK_ALPHA * (1 + BREATH_AMP * breath);
  };

  const destroy = (): void => {
    // 구운 텍스처는 **모듈 캐시**라 절대 파괴하지 않는다(4패널이 공유하고, 재진입 시 다시
    // 쓴다). `destroy({children:true})` 는 기본적으로 텍스처를 건드리지 않는다.
    try {
      root.destroy({ children: true });
    } catch {
      /* 이미 파괴된 트리 — 재진입에서 두 번 불려도 화면이 죽으면 안 된다. */
    }
  };

  return { container: root, box, headerBottom, update, destroy };
}
