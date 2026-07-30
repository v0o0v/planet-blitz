/**
 * 플레이어 비행체 **AAA 비주얼** — 레인 A(`.omc/plans/entity-aaa-contract.md` §3).
 *
 * 장식자 심({@link file://./adorner.ts})에 `'player'` kind 로 등록되는 두 장식자를 제공한다.
 *
 * ## 무엇을 만드는가
 * 계약 §3 레인 A 의 6항목(1~6)과, 3·4차에서 **"AAA 와 나란히 놓으면 헷갈리지 않는다"는 판정**을
 * 닫기 위해 추가된 항목(⓪·2b·5b·7·9·10)이다.
 *
 * | # | 항목 | 담당 | 자리 |
 * |---|---|---|---|
 * | ⓪ | **실루엣 감산 컨투어** | {@link PlayerBodyAdorner} | glowLayer 바로 위(**곱연산**) |
 * | 1 | 뱅킹/롤 | {@link PlayerBodyAdorner} | 스프라이트 변환(2차 스프링) |
 * | 2 | 엔진 추진 | {@link PlayerThrustAdorner} | belowLayer(가산) |
 * | 2b | **대시 색 이동**(청→밝은 시안 심) | {@link PlayerThrustAdorner} | 불꽃 안 자식 컨테이너 |
 * | 3 | 림라이트 | {@link PlayerBodyAdorner} | belowLayer(가산, 광원 쪽 오프셋) |
 * | 4 | 피격 반응 + 무적 표현 | {@link PlayerBodyAdorner} | 변환 임펄스 + aboveLayer 실드 셸 |
 * | 5 | 대시 잔상 | {@link PlayerThrustAdorner} | belowLayer(가산 고스트) |
 * | 5b | **대시 개시 링 충격파** | {@link PlayerThrustAdorner} | belowLayer(가산, 0.28s) |
 * | 6 | 아이들 부유 | {@link PlayerBodyAdorner} | 변환 + 엔진 열기 요동 |
 * | 7 | **손상 상태**(HP 누진 **그을림**) | {@link PlayerBodyAdorner} | aboveLayer(**곱연산** 오버레이) |
 * | 9 | **이방성 헤일로** | {@link playerHaloAniso} | entityRenderer 플레이어 경로 |
 * | 10 | **판면 방향광 + 스페큘러 스윕** | {@link PlayerBodyAdorner} | aboveLayer(실루엣 마스크 · 가산+곱연산) |
 *
 * ## 4차에서 **삭제한** 것 — 익단 증기(구 ⑧)
 * 3차의 익단 증기는 화면에 **없었다**: 자연 인스턴스 국소 델타 0.01, `alpha` 를 1.0 으로 강제해도
 * 임계 1 이상 달라지는 픽셀이 전 화면 **9개**뿐(최대 Δ 32). 원인은 알파가 아니라 **기하**다 —
 * 쐐기가 횡 ±29.8px · 후방 7~26px 인데 그 영역이 기체 스프라이트 불투명 픽셀 **아래**였고
 * 증기는 `belowLayer` 라 선체가 통째로 가렸다(9픽셀은 삐져나온 부분이다).
 *
 * `aboveLayer` 로 올리는 것은 선체를 가로지르므로 §2-2 위반이고, 쐐기 원점을 실루엣 밖으로 밀면
 * "익단에서 나는 증기"가 아니게 된다. 계약 §3 은 "부수 운동 한 겹"만 요구하고 그 역할은
 * 뱅킹(①)·부유(⑥)·열기 요동이 이미 한다. 그래서 고치지 않고 **지웠고**, 그 예산을 ⑩에 썼다.
 * 표시객체 2개와 프레임당 `syncVapor` 한 번이 함께 사라졌다.
 *
 * ## 공유 파일 접촉 (승인 범위)
 * 1·2차는 `entityRenderer.ts` 를 한 줄도 안 건드렸다. 3차는 **두 지점만** 건드린다 —
 * ⑨ 헤일로 이방성(`syncGlowHalo` 의 player 경로)과 대시 트라우마 훅. 둘 다 카메라·헤일로라
 * 장식자 심 밖이라서 구조적으로 이 파일에서 풀 수 없다. 튜닝값은 전부 여기 남아 있고
 * (`PLAYER_DASH_TRAUMA`·`playerHaloAniso`·`isDashSpeed`·`snapshotVelocity`) 공유 파일은
 * **호출만** 한다.
 *
 * ## 가독성이 예쁨을 이긴다 (계약 §2-2)
 * 이 게임은 탄막 슈터다. 그래서 이 파일의 모든 발광은 **belowLayer(스프라이트 아래·가산)** 에
 * 있고, 기수 **반대편**에 있고, 본체보다 어둡다. 실루엣을 덮는 것은 aboveLayer 의 실드 셸
 * 하나뿐인데 그것도 **획(stroke)뿐이고 선체 밖**이라 몸통을 한 픽셀도 가리지 않는다.
 *
 * 특히 **무적 프레임을 깜빡임으로 표현하지 않는다.** 깜빡임은 실루엣을 주기적으로 지워
 * 고밀도 탄막에서 자기 위치를 잃게 만든다 — 정확히 이 게임이 감당할 수 없는 실패다. 대신
 * 선체 밖에서 **선체로 닫혀 들어오는 에너지 실드 셸**로 표현한다. 반지름이 남은 시간의
 * 단조 함수라 "언제 풀리는지"가 화면에서 읽힌다(깜빡임에는 없는 정보다).
 *
 * ## sim 불가침 (계약 §2-1 · ADR-0005)
 * `src/sim/` 에서 **타입만** 가져온다. 속도·대시·피격은 전부 `prev`/`curr` 스냅샷 델타에서
 * **렌더가 다시 계산**한다(`shipFacing`·`turretAimAngle` 과 같은 패턴). sim 에 필드를 더하면
 * 골든·리플레이가 즉시 깨진다.
 *
 * ## 기체 타입 7종을 왜 공통 규칙으로 다루는가
 * 계약은 타입별 특성(엔진 개수·크기) 반응을 권했지만, **렌더가 기체 타입을 알 방법이 없다**:
 * - {@link EntitySnapshot} 에 `typeId` 가 없다. 넣으려면 `src/sim/snapshot.ts`(공유 파일)를
 *   고쳐야 하고, 그건 이 레인의 소유가 아니다.
 * - `texture.source.label` 은 번들러가 해시한 URL 이거나 인라인 base64 data URI 다
 *   (`assetsInlineLimit` 로 이 리포의 자산 상당수가 실제로 인라인된다) — 기체 슬러그가 남는다는
 *   보장이 없다. 거기에 의존하면 "코드에는 있는데 화면에는 없는" 결함이 된다.
 *
 * 그래서 노즐 배치·불꽃 치수는 전부 **표시 반치수(`sprite.width/2`)의 배율**로 파생한다.
 * 노즐은 중앙 1 + 외현 2 의 3구 구성이라 어느 기체 실루엣에도 어긋나지 않는다. 타입별
 * 반응이 필요하면 스냅샷에 `typeId` 를 싣는 공유 파일 변경이 선행되어야 한다(오케스트레이터 보고 항목).
 *
 * ## 티어·접근성 게이트 (계약 §2-3)
 * `AdornerContext` 는 `EffectGates` 만 주고 원본 설정을 주지 않으므로 두 감소 토글을 게이트에서
 * 되짚는다 — {@link reducedMotion}·{@link reducedGlow} 의 주석이 그 도출의 정본이다.
 */

import { Container, Graphics, Sprite } from 'pixi.js';

import type { EntitySnapshot } from '../../sim/snapshot.js';
import type { EnvLightSpec } from '../env/theme.js';
import { lightX, lightY } from '../env/theme.js';
import type { EffectGates, QualityTier } from '../qualityTier.js';
import { registerAdornerFactory, type AdornerContext, type EntityAdorner } from './adorner.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 — 전부 placeholder(defer-balance-tuning). 픽셀 절대값은 **표시 반치수의 배율**로만
// 쓴다: 기체 표시 크기가 48px 로 고정돼 보이더라도 `displaySize` 는 kind·radius 의 함수라
// 절대값을 박으면 크기가 바뀌는 순간 전부 어긋난다(접지 그림자 헤더의 같은 규율).
// ---------------------------------------------------------------------------

/** sim 틱레이트(Hz). 스냅샷 위치 델타를 초당 속도로 환산하는 데만 쓴다(값 재선언 — sim 무임포트). */
const SIM_HZ = 60;

/**
 * 순항 기준 속도(u/s). sim 기본 `playerSpeed`(720)에 파워업 여유를 얹은 렌더측 기준선이다.
 * 이 값에서 뱅킹·불꽃이 각각 최대치에 닿는다. sim 상수를 import 하지 않는 이유는 계약 §2-1 —
 * 값이 갈라져도 화면 세기만 달라질 뿐 결정론에는 아무 영향이 없다.
 */
const CRUISE_SPEED = 900;

/**
 * 대시 판정 임계(u/s). sim `dashSpeed` 는 2800 u/s 임펄스이고 순항 최고는 파워업을 다 먹어도
 * 1000 을 크게 넘지 않는다 — 그 사이의 넉넉한 골짜기에 임계를 둔다. 렌더 전용 근사라 한두
 * 프레임 오판은 무해하다.
 */
const DASH_SPEED = 1500;

/** 추적 속도 상한(u/s). 리스폰·순간이동이 만드는 위치 점프가 불꽃·잔상을 폭발시키지 않게 막는다. */
const MAX_TRACK_SPEED = 4000;

/** 속도 평활 시간상수(초). 불꽃 길이가 프레임마다 튀지 않게 한다(대시 판정은 평활 전 값을 쓴다). */
const SPEED_TAU = 0.09;

/** 스프링·감쇠 적분의 dt 상한(초). 탭 복귀의 큰 dt 에서 스프링이 발산하는 것을 막는다. */
const MAX_STEP_DT = 0.05;

// ── 1. 뱅킹/롤 ──────────────────────────────────────────────────────────────
/** 최대 롤에서의 추가 회전(라디안, ≈12.6°). 기수 방향은 `shipFacing` 이 정하고 그 위에 얹는다. */
const ROLL_ANGLE = 0.22;
/** 최대 롤에서의 세로(횡폭) 압축률. 롤 축은 기체 **길이 방향**이라 눌리는 것은 로컬 y 다. */
const BANK_SQUASH = 0.18;
/** 롤 스프링 강성. `ω=√k≈11 rad/s` — 방향 전환에 반 박자 늦게 따라붙는 체감. */
const ROLL_STIFFNESS = 120;
/**
 * 롤 스프링 감쇠. 임계감쇠(`2√k≈21.9`)보다 **낮게** 둬 오버슈트하게 한다 — 계약 §3 "2차 운동"의
 * 실체가 이 오버슈트다(임계감쇠면 그냥 지연된 1차 운동이라 여전히 뻣뻣하다).
 *
 * ⚠️ 값이 16 이었을 때 실측 오버슈트가 **1.8%** 였다. 이론값(3.4%)보다도 작았는데, 반음함
 * 오일러 적분이 dt=1/60 에서 수치 감쇠를 더하기 때문이다. 1.8% 는 화면에서 지연과 구분되지
 * 않는다 — 즉 "2차 운동을 넣었다"가 코드상 참이고 화면상 거짓이었다. 뮤테이션 검증이 이걸
 * 잡았다(감쇠를 임계 위로 올려도 테스트가 초록이었다). ζ≈0.46 인 10 으로 내려 실측 20% 대를 만든다.
 */
const ROLL_DAMPING = 10;

// ── 6. 아이들 부유 ──────────────────────────────────────────────────────────
/**
 * 부유 진폭(표시 반치수 배율). 크면 조준선이 흔들려 보이지만, 0.055 는 실측 4.59px(4.7%)로
 * 비평가가 "확인되나 약함"으로 봤다. 0.09 로 올려 정지 상태의 "살아 있음"을 읽히게 한다.
 */
const BOB_AMPLITUDE = 0.09;
/** 부유 각속도(rad/s). 호흡에 가까운 느린 주기. */
const BOB_RATE = 2.1;
/** 이 속도(u/s) 이상이면 부유가 완전히 꺼진다. 그 아래는 선형으로 살아난다. */
const IDLE_SPEED_CUTOFF = 120;

// ── 4. 피격 반응 ────────────────────────────────────────────────────────────
/** 피격 임펄스 크기(표시 반치수 배율). 기수 반대 방향으로 튄다. */
const HIT_KICK = 0.38;
/** 임펄스 복원 스프링 강성(빠르게 제자리로). */
const HIT_STIFFNESS = 300;
/** 임펄스 복원 감쇠. 임계(`2√300≈34.6`)의 절반 아래(ζ≈0.46)라 눈에 보이게 한 번 되튄다. */
const HIT_DAMPING = 16;
/** 임펄스의 횡 성분 비율. 매번 같은 방향으로 튀면 기계적으로 보인다(시드는 결정적). */
const HIT_LATERAL = 0.45;

/**
 * 무적 창 길이(초). sim `hitIframes` 40틱 ≈ 0.667s 의 렌더측 근사다. 스냅샷에 `iframes` 가
 * 없으므로(§2-1 — 넣으면 공유 파일 변경) HP 감소 시점에서 렌더가 창을 자체 계산한다.
 */
const SHIELD_WINDOW_S = 40 / SIM_HZ;
/** 실드 셸 시작 반지름(표시 반치수 배율). 선체 **밖**이라 실루엣을 덮지 않는다. */
const SHIELD_R_START = 1.62;
/**
 * 실드 셸 종료 반지름. 선체에 닿기 직전까지 **닫혀 들어온다** = 남은 시간이 읽힌다.
 *
 * 하한은 기하가 정한다: 셸의 가장 안쪽 요소가 {@link SHIELD_INNER_BAND} 이므로
 * `SHIELD_INNER_BAND × SHIELD_R_END > 1` 이어야 어떤 요소도 선체 위로 안 올라간다
 * (0.86 × 1.22 = 1.049). 이 부등식은 테스트가 잠근다.
 */
const SHIELD_R_END = 1.22;
/**
 * 셸 요소가 놓이는 가장 안쪽 반지름(단위 반지름 기준). 바깥 링·육각은 1.0 근처, 안쪽 육각이
 * 여기다 — 셸 전체가 얇은 띠 안에 모여 있어야 창 끝에서도 선체를 안 덮는다.
 */
const SHIELD_INNER_BAND = 0.86;
/** 실드 셸 최대 알파. 획뿐이라 이 값이어도 몸통 가독을 해치지 않는다. */
const SHIELD_ALPHA = 0.85;
/** 실드 셸 자전 각속도(rad/s). 깜빡임 대신 **회전**으로 "살아 있는 보호막"을 만든다. */
const SHIELD_SPIN = 2.4;
/** 실드 셸 색 — 아군 시안. 적탄 흰 코어와 헷갈리지 않는다(계약 §2-2). */
const SHIELD_COLOR = 0x39d0ff;
/**
 * 실드 셸 패싯(면) 개수. 육각 **셀 메시**를 만든다.
 *
 * 1차에는 링 위에 8개의 **방사 눈금**을 그렸는데, 비평가가 계약 §2-5(UI 어휘 금지)에 근접한다고
 * 지적했다 — 방사 눈금은 조준 레티클·게이지의 어휘라 디제틱 보호막이 아니라 HUD 로 읽힐 수 있다.
 * 육각 셀은 같은 "색 외 채널"(색약 대응)을 유지하면서 **재질**로 읽힌다.
 */
const SHIELD_FACETS = 6;

// ── 2. 엔진 추진 ────────────────────────────────────────────────────────────
/** 정지 시 불꽃 길이 배율(아이들 코어). 0 이 아니어야 "시동이 걸린 기체"로 읽힌다. */
const THRUST_IDLE = 0.34;
/** 순항 속도에서의 불꽃 길이 배율. */
const THRUST_CRUISE = 1;
/** 대시 시 곱해지는 배율. 폭발적 확장 — 대시가 화면에서 사건이 되게 한다. */
const THRUST_DASH_MULT = 2.2;
/** 불꽃 기준 길이(표시 반치수 배율, extent 1.0 기준). */
const THRUST_LENGTH = 1.15;
/** 불꽃 기준 반폭(표시 반치수 배율). */
const THRUST_HALF_WIDTH = 0.3;
/** 노즐이 기체 중심에서 뒤로 물러난 거리(표시 반치수 배율). 선체 뒤끝에 붙인다. */
const NOZZLE_BACK = 0.72;
/**
 * 외현 노즐의 횡 오프셋(표시 반치수 배율). 중앙 1 + 좌우 2 의 3구 공통 배치.
 *
 * 중앙 노즐 반폭이 {@link THRUST_HALF_WIDTH}(0.3), 외현 반폭이 그 {@link NOZZLE_SIDE_SCALE}
 * 배(0.156)라, 이 값이 작으면 세 불꽃이 중앙에서 겹쳐 **가산이 3중으로 쌓인다** — CRIT-1 의
 * 순백 포화에 실제로 기여한 항이다. 0.44 면 겹침 구간이 0.264~0.3 로 거의 사라진다.
 */
const NOZZLE_SIDE = 0.44;
/** 외현 노즐의 크기 배율(중앙 대비). */
const NOZZLE_SIDE_SCALE = 0.52;
/** 열기 요동 각속도(rad/s) 2종 — 서로소에 가까운 비율이라 눈에 띄는 반복 주기가 안 생긴다. */
const HEAT_RATE_A = 9.3;
const HEAT_RATE_B = 14.7;
/** 열기 요동 진폭(길이·폭). 정지 시 최대, 대시 시 최소(빠를수록 불꽃이 곧게 뻗는다). */
const HEAT_WOBBLE = 0.14;

/**
 * 불꽃 3층(외곽→중간→심). **색 상수가 아니라 이 배열이 정본**이고, 굽는 코드와 검증이 둘 다
 * 여기를 읽는다 — 그 이유가 이 레인에서 가장 비싸게 배운 교훈이다.
 *
 * ## 왜 상수 단언으로는 부족한가 (비평가 CRIT-1)
 * 1차 구현의 심 색은 `0xbfefff`(191,239,255)였고, 그 옆 주석은 "**순백이 아니다** — 적탄 흰
 * 코어와 같은 색으로 포화하면 탄막에서 둘이 섞인다"라고 스스로 금지하고 있었다. **상수는
 * 의도대로였는데 화면은 순백이었다.** 3층 가산이 3노즐로 중첩되면서 이미 클리핑된 G/B 위에
 * R 을 191·k → 255 까지 밀어올렸기 때문이다. 실측된 불꽃 최상위 픽셀은 `(255,251,250)` 이고,
 * 같은 컷의 적탄 흰 코어는 `(251.1,241.7,241.3)` — **RGB 4~5 차이**로 둘이 같은 색이었다.
 *
 * 즉 **코드 상수는 맞았는데 렌더 결과가 틀렸다.** 상수를 단언하는 테스트는 이걸 영영 못 잡는다.
 * 그래서 여기서는 층 목록을 데이터로 두고 {@link addLayers} 로 **합성 결과를 계산**한 다음,
 * 그 합성값의 채도·광도를 테스트가 잠근다(§검증은 합성에 걸어라).
 *
 * ## 색 선택 규칙: R 기여를 최소로
 * 가산 합성에서 채도를 죽이는 것은 **R 채널**이다(배경이 밝을수록 R 이 먼저 255 에 닿는다).
 * 그래서 세 층 모두 R 이 거의 0 인 시안-블루로 잡고, 알파 합도 1차의 절반 아래로 내렸다.
 * 합성 결과는 대략 `(18, 123, 176)` — R 기여가 18 뿐이라 어지간히 밝은 바닥 위에서도
 * 시안 정체가 남는다.
 */
const FLAME_LAYERS: readonly LightLayer[] = [
  /** 외곽 — 가장 넓고 어둡다. */
  { color: 0x004a9c, alpha: 0.24 },
  /** 중간. */
  { color: 0x00a6f0, alpha: 0.3 },
  /** 심 — "뜨겁다"를 담당하되 R 이 낮아 포화해도 시안으로 남는다. */
  { color: 0x46d6ff, alpha: 0.26 },
];

// ── 0. 실루엣 컨투어 (탄막 속 자기 위치 확보) ───────────────────────────────
/**
 * 변경 전 기준선(`.omc/research/entity-aaa-baseline-2026-07-30.md`)이 잡은 **가장 값비싼 결함**:
 * "보스 컷에서 플레이어를 찾는 데 시간이 걸린다 — 좌하단 적 군집에 시안 조각이 묻혀 있다."
 * 탄막 슈터에서 자기 기체를 못 찾는 것은 미관 문제가 아니라 **조작 불능**이다.
 *
 * ## 두 번 실패했다. 두 번 다 원인이 달랐다.
 *
 * **1차(MAJ-3) — 기하가 틀렸다.** 스프라이트를 16% 키운 복제 **한 장**을 아래에 깔았다. 이건
 * dilate 가 아니다 — 앵커(0.5,0.5) 기준 균일 스케일은 앵커에서 멀어지는 방향으로만 띠를 만들고
 * **앵커를 향한 가장자리에는 원리적으로 띠가 안 생긴다**. 둘레 36섹터 픽셀 분포가
 * `33,25,24,7,0,13,…` 로 약 1/4 이 통째로 비어 있었다.
 *
 * **2차(3차 반려 사유) — 합성이 틀렸다.** 기하는 8방향 오프셋으로 고쳐 섹터 결손 0·min 7 이
 * 됐는데, **외곽선만 토글한 두 컷이 7× 확대에서도 육안 구별 불가**였다. 기여 픽셀은 726~821px
 * 로 실재했다. 원인은 **가산 합성**이다: 이미 밝은 시안 헤일로 **위에** 깊은 청색을 *더하면*
 * 밝기가 조금 올라갈 뿐 **경계가 생기지 않는다**. 그리고 밝기를 올리는 순간 CRIT-2(기여가
 * 본체보다 밝다)에 걸린다 — 즉 **가산 안에서는 CRIT-2 와 "경계 생성"이 양립 불가**다.
 * 1차 알파 0.5 → 2차 0.07×8 로 내려 CRIT-2 를 풀었고, 그 대가로 경계가 사라진 것이다.
 *
 * ## 지금 방식 — **감산 컨투어**(`blendMode: 'multiply'`)
 * 해법은 알파가 아니라 **합성 모드**다. 실루엣 밖 한 겹을 **어둡게 곱한다**:
 *
 * - 곱연산은 빛을 **한 톨도 더하지 않는다**. §2-4 밝기 총량 예산에 기여가 **구조적으로 0** 이고
 *   (오히려 음수), §2-2 "이펙트가 본체보다 밝으면 안 된다"는 자동으로 성립한다.
 * - 밝은 바닥(헤일로 · 용암 · 폭발 · 적 군집) 위에서 **가장 강하게** 일한다 — 정확히 기체를
 *   잃던 그 상황이다. 어두운 바닥에서는 곱해도 티가 안 나지만 거기서는 **시안 헤일로가**
 *   자기 일을 한다(⑤ 이방성 헤일로가 그 축을 강화한다). 두 표현이 상보적이라 배경 밝기 전
 *   구간이 덮인다.
 * - 어두운 테두리는 게임 밖 어휘가 아니다 — 실루엣을 배경에서 떼어내는 **컨택트 섀도**이고,
 *   접지 그림자(`shadowLayer.blendMode = 'multiply'`)가 이 리포에서 이미 쓰는 어휘다.
 *
 * ## ⚠️ 왜 belowLayer 가 아니라 "glowLayer 바로 위"인가 (밟으면 통째로 안 보인다)
 * `AdornerContext.belowLayer` 는 `entityRenderer.glowLayer` 다. 그런데 **high 티어에서 그 레이어에
 * 블룸 필터가 붙는다**(`syncGlowBloom` → `glowLayer.filters = [bloom]`). 필터가 붙으면 레이어가
 * **투명한 렌더 텍스처**에 먼저 그려지는데, 곱연산의 피연산자(dst)가 그 투명 텍스처라
 * `src×0 = 0` — **감산 컨투어가 high 티어에서만 통째로 사라진다.** 하필 비평가가 재는 티어다.
 *
 * 그래서 컨투어는 `belowLayer.parent`(= 엔티티 루트 레이어)의 **glowLayer 바로 다음 자리**에
 * 넣는다. 필터가 없어 곱연산이 실제 화면 픽셀에 걸리고, spriteLayer 보다 아래라 **선체 내부는
 * 본체가 덮어** 몸통이 어두워지지 않는다(마스크 불필요). 부모가 없으면(단위 테스트) belowLayer
 * 로 폴백한다 — 배치 자체는 {@link contourInsertIndex} 가 순수 함수로 검증된다.
 */
const CONTOUR_DIRECTIONS = 8;
/** 컨투어 띠 폭 = 표시 반치수 × 이 값. 이게 곧 dilate 반경이다. */
const CONTOUR_OFFSET = 0.12;
/**
 * 컨투어 색 — **곱해지는 색**이라 값이 작을수록 어둡다. 순흑(0x000000)이 아니라 아주 어두운
 * 청색인 이유: R 을 G·B 보다 더 깎아 어두워지면서 **차가운 쪽으로 기울게** 한다. 그러면 띠가
 * "검은 테두리"(만화적 아웃라인)가 아니라 **그림자**로 읽힌다.
 */
const CONTOUR_COLOR = 0x081428;
/**
 * 복제 **한 장**의 알파. 곱연산에서 한 장의 감쇠 계수는 `1 − a(1 − c)` 이므로 0.20 에서 채널당
 * 약 0.81 배, 대표 겹침 {@link CONTOUR_TYPICAL_OVERLAP}=4 장이면 **0.42~0.48 배** — 바닥 밝기를
 * 절반 이하로 떨어뜨린다. 가산 시절 기여 광도(≈50)와 달리 이건 **밝기 총량을 늘리지 않는다**.
 */
const CONTOUR_ALPHA = 0.2;
/**
 * 컨투어 겹침의 대표값. 실루엣 밖 한 점은 그 방향 ±90° 안의 복제들만 덮으므로 8방향 중
 * 대략 4장이 겹친다 — 검증이 "화면에 실제로 나타나는 값"을 계산할 때 쓰는 층 수다.
 */
export const CONTOUR_TYPICAL_OVERLAP = 4;
/** 숨쉬기 진폭·각속도. 미세한 변조가 정지 화면에서도 눈을 끈다(깜빡임이 아니라 연속 변조다). */
const CONTOUR_BREATH = 0.16;
const CONTOUR_BREATH_RATE = 3;

// ── 3. 림라이트 ─────────────────────────────────────────────────────────────
/**
 * 림 색. 테마에는 광원 **방향**(`EnvLightSpec.angle`)만 있고 색이 없다 — 색 필드를 더하려면
 * `env/theme.ts`(공유 파일) 변경이 필요하다(오케스트레이터 보고 항목). 그때까지는 어느
 * 행성에서도 튀지 않는 차가운 화이트를 쓴다.
 */
const RIM_COLOR = 0xcfe6ff;
/**
 * 림 알파(가산). 림은 실루엣을 **세우는** 것이지 본체를 밝히는 것이 아니다. 1차의 0.42 는
 * 외곽선·불꽃과 겹치는 지점에서 기여 광도를 본체 상위 1%(211.6) 위로 밀어올렸다(CRIT-2).
 */
const RIM_ALPHA = 0.2;
/** 림 오프셋(표시 반치수 배율). 광원 **쪽**으로 밀어 그 방향 가장자리만 삐져나오게 한다. */
const RIM_OFFSET = 0.14;

// ── 5. 대시 잔상 ────────────────────────────────────────────────────────────
/** 티어별 고스트 개수. low 는 0(계약 §2-3 — low 에서 꺼지거나 현저히 축소). */
const GHOSTS_HIGH = 5;
const GHOSTS_MED = 3;
/** 고스트 갱신 간격(프레임). 매 프레임 찍으면 겹쳐서 한 덩어리가 된다. */
const GHOST_INTERVAL = 2;
/** 고스트 최초 알파. 본체보다 확실히 어두워야 한다(계약 §2-2 · CRIT-2 로 0.3 에서 내렸다). */
const GHOST_ALPHA = 0.18;
/** 고스트 감쇠 시간상수(초). */
const GHOST_TAU = 0.11;
/** 고스트 색(가산). 시안 계열이되 어둡게 — 잔상이 본체보다 밝으면 자기 위치를 잃는다. */
const GHOST_TINT = 0x2f8fd0;

// ── 5b. 대시를 **사건**으로 (3차 요구 ②) ────────────────────────────────────
/**
 * 2차까지 대시의 표현 축은 **불꽃 길이 하나뿐**이었다({@link THRUST_DASH_MULT} 2.2배). 축이
 * 하나면 "빨라졌다"가 아니라 "불꽃이 길어졌다"로 읽힌다 — Nova Drift·Returnal 의 부스트가
 * 사건으로 읽히는 이유는 **동시에 세 가지가 바뀌기 때문**이다: 길이 · **색온도**(청 → 백열) ·
 * **개시 순간의 링 충격파**. 여기서 그 두 축을 더한다.
 *
 * ⚠️ **백열로 가면 안 된다.** 2차에서 실측으로 확립한 분리(불꽃 채도 중앙값 195.9 vs 적탄 흰
 * 코어 10.0)를 깨는 순간 대시 중 자기 불꽃과 적탄이 같은 색이 된다. 그래서 "뜨거움"을 **채도를
 * 버려서**가 아니라 **휘도를 올려서** 만든다 — R 을 낮게 유지한 밝은 시안이 그 답이다.
 */
const DASH_CORE_COLOR = 0x7ce8ff;
/**
 * 대시 심 알파. 기본 불꽃 합성 `(18,123,176)` 위에 `(27.3,51,56.1)` 을 얹어
 * `(45.3,174,232.1)` 이 된다 — 채도 **205**(≥60 유지), 광도 **142.2**(본체 p99 211.6 미만).
 * 0.30 까지 올리면 rim 과 겹치는 지점에서 203.6 이 돼 여유가 사라진다.
 */
const DASH_CORE_ALPHA = 0.22;
/** 대시 심의 길이·폭 배율(기본 불꽃 심 대비). 짧고 굵다 = 노즐 목에서 하얗게 타는 코어. */
const DASH_CORE_SHRINK = 0.34;
const DASH_CORE_NARROW = 0.26;
/**
 * 대시 열기 상승·하강 시간상수(초). 상승이 훨씬 빨라야 **사건**으로 읽힌다(느리게 붙으면
 * 그냥 밝아지는 것이다). 하강은 여운이 남게 느리다.
 */
const DASH_HEAT_ATTACK = 0.02;
const DASH_HEAT_RELEASE = 0.16;

/** 대시 개시 링의 수명(초). 짧아야 "충격"이지 "장식"이 아니다. */
const DASH_RING_S = 0.28;
/** 링 반지름(표시 반치수 배율) 시작 → 끝. 기체를 스치듯 지나 밖으로 빠진다. */
const DASH_RING_R_START = 0.7;
const DASH_RING_R_END = 2.8;
/** 링 최대 알파(가산). 광도 50.4 — 불꽃·심과 겹쳐도 211.6 안이다. */
const DASH_RING_ALPHA = 0.3;
/** 링 획 두께(표시 반치수 배율, t=0 기준). 퍼지면서 얇아진다 = 에너지가 흩어진다. */
const DASH_RING_WIDTH = 0.1;
/** 링 색 — 아군 시안(§2-2). 확장하는 **충격파**이지 조준 링이 아니다(§2-5 — 고정 반지름 금지). */
const DASH_RING_COLOR = 0x39d0ff;

/**
 * 대시가 카메라에 주는 트라우마(§3 요구 ④). `TRAUMA_PLAYER_HIT`(0.4)보다 **작아야** 한다 —
 * 대시는 내가 하는 일이고 피격은 당하는 일이라, 같은 세기면 "잘못했다"는 신호가 섞인다.
 * `entityRenderer` 가 플레이어 경로에서 이 값을 쓴다(공유 파일 수정 승인 범위).
 */
export const PLAYER_DASH_TRAUMA = 0.16;

// ── 7. 손상 상태 (3차 요구 ③) ───────────────────────────────────────────────
/**
 * **HP 1 이든 만피든 똑같이 생겼었다.** 레인 B 에는 적 HP 누진 표현이 요구돼 있는데 정작
 * 플레이어에는 없었다 — Hades·Returnal 은 아바타 상태를 언제나 **몸으로** 보여준다(HUD 바를
 * 안 봐도 위험을 안다). 탄막 슈터에서는 그 가치가 더 크다: 시선이 HP 바에 갈 여유가 없다.
 *
 * ## 3차는 **화면에 없었다** — 가산 스프라이트의 텍스처 인자 (4차 CRIT-1)
 * 3차는 본체 텍스처 복제를 `blendMode:'add'` + `tint` 로 얹었다. HP=1 강제 + 맥동 첨두
 * (`alpha=0.2149`, 설계 상한 0.22 도달)에서 실측한 값이 이것이다:
 *
 * - 국소 델타 **1.98** · mean 0.02 · 최대 픽셀 Δ 42
 * - 선체 픽셀 n=1945 평균 색 이동 **ΔR +1.43 · ΔG +2.88 · ΔB +1.07**
 * - 7× 나란히 **구별 불가**(HP 15% 컷도 동일)
 *
 * 원인은 알파가 아니다. Pixi `Sprite` 의 가산 기여는 `src.rgb = texture.rgb × tint × alpha` 라
 * **텍스처 색이 곱으로 들어간다.** 플레이어 텍스처는 청록(R 낮음·G 높음)이므로 실제 가산량은
 * `(50,180,200)/255 × (156,58,20) × 0.215 ≈ (6.6, 8.8, 3.4)`(광도 ≈7.7)인데, 검증 모델이 쓴
 * `addLayers([{DAMAGE_COLOR, DAMAGE_ALPHA_MAX}])` 는 `(34.3,12.8,4.4)` 였다 — **크기가 5배
 * 틀리고 채널 우열이 뒤집힌다.** 주석은 "달아오른 금속(R 지배)"을 약속했는데 화면은 **G 가 더
 * 오르는 미세 밝힘**이었다(측정된 ΔG > ΔR 이 직접 증거다).
 *
 * 이건 {@link FLAME_LAYERS} 헤더가 정본으로 박아 둔 CRIT-1("상수는 맞았는데 렌더 결과가
 * 틀렸다")과 **같은 계열이 같은 파일 안에서 재발한 것**이다. 모델 쪽은 {@link spriteAddLight} 로
 * 고쳤고(텍스처 인자를 넣었다), 표현 쪽은 아래처럼 기법을 갈았다.
 *
 * ## 지금 방식 — **감산 그을림**(`blendMode:'multiply'`)
 * ⓪ 감산 컨투어가 쓴 해법을 그대로 쓴다. 손상은 "달아오름"이 아니라 **그을림**으로 표현한다:
 *
 * - 곱연산은 텍스처 인자가 **어두워지는 방향으로만** 작용한다(`out = dst·(1 − a(1 − tex·tint))` —
 *   청록 텍스처가 R 을 죽이던 그 인자가 여기서는 대비를 **더 벌린다**). 가산에서 5배 손실이던
 *   항이 감산에서는 이득이다.
 * - 밝기 총량 예산(§2-4) 기여가 **구조적으로 0** 이다. 3차의 가산 오버레이는 "안 보이는데
 *   예산은 먹는" 최악의 조합이었다.
 * - R 채널을 **가장 덜** 깎아(tint 의 R 이 가장 크다) 어두워지면서 **난색으로** 기운다 — 시안
 *   아군 색에서 멀어지므로 "정상 아님"이 즉시 읽힌다. 검게 탄 난색 선체다.
 *
 * 합격 게이트는 상수가 아니라 실측이다({@link damageDelta}·{@link damageWarmShift} 가 그 예측을
 * 코드에서 계산해 둔다): 선체 광도 하강 **25 이상** + ΔR < ΔG < ΔB(난색 잔존).
 *
 * ## 플레이어에게 금지된 것 — 연기
 * 적에게는 허용되는 손상 연기가 플레이어에게는 금지다. **자기 위치를 잃으면 조작 불능**이라
 * 실루엣을 흐리는 표현은 §2-2 위반이다. 그래서 여기서는 실루엣을 **그대로 둔 채 색만** 바꾼다.
 *
 * ## 정보라서 끄지 않는다
 * 실드 셸·컨투어와 같은 판단이다(비평가가 인정한 축): 티어·감소 토글로 **등급만 강등**하고
 * 완전히 끄지 않는다. 맥동(운동 축)만 내려가고 색(정보 축)은 남는다.
 */
const DAMAGE_START = 0.6;
/** 이 비율 아래가 "위독" — 맥동이 붙는다. */
const DAMAGE_CRITICAL = 0.3;
/**
 * 손상 그을림 최대 알파(**곱연산**). 3차의 0.22 는 가산이었고 화면 델타가 1.98 이었다 —
 * 여기서는 같은 자리에서 광도 하강 **33.9**(clean 컷 본체 149.8 기준)를 만든다.
 * {@link damageDelta} 가 그 값을 계산하고 테스트가 25 하한을 잠근다.
 */
const DAMAGE_ALPHA_MAX = 0.35;
/**
 * 손상 그을림 색 — **곱해지는 색**이라 값이 작을수록 어둡다(컨투어와 같은 규율). R(138) >
 * G(74) > B(48) 이라 R 을 가장 덜 깎아 **난색 그을림**이 남는다: 감쇠 계수 (0.839, 0.752, 0.716).
 */
const DAMAGE_SCORCH_COLOR = 0x8a4a30;
/** 위독 구간 맥동 깊이·각속도. 심장 박동에 가까운 속도라 긴박함이 붙는다. */
const DAMAGE_PULSE_DEPTH = 0.4;
const DAMAGE_PULSE_RATE = 5.5;
/** 발광 감소 시 곱해지는 배율. **0 이 아니다** — 손상도는 전투 정보다. */
const DAMAGE_REDUCED_GLOW = 0.6;

// ── 10. 판면 방향광 + 스페큘러 스윕 (4차 CRIT-3 — 남은 최대 격차) ────────────
/**
 * 비평가 4차: **"선체 자체가 빛에 반응하지 않는다."** 3차까지 이 레인이 더한 것은 전부 (a)
 * 부드러운 가산 발광 (b) 외곽 띠였다. 뱅킹(①)조차 납작한 단일 스프라이트의 squash+rotate 라
 * **음영이 변하지 않는다** — 실제 AAA 탑다운(Nova Drift·Returnal)이 뱅킹을 파는 방식은 변환이
 * 아니라 **표면 음영 변화**다. `playerRim`(③)이 그 축이어야 했는데 기여가 국소 **0.52**
 * (최대 픽셀 Δ 72)로 사실상 안 보였고, 원인은 CRIT-1 과 정확히 같은 텍스처 인자였다.
 *
 * ## 왜 rim 알파를 올리지 않았나
 * 올려도 안 보인다. rim 은 광원 쪽으로 밀린 실루엣 복제라 **실루엣 밖 초승달**만 남고, 그
 * 면적이 애초에 수십 픽셀이다(그래서 알파를 2배로 해도 국소 델타가 1 근처다). 그리고 가산
 * 텍스처 복제는 텍스처 색에 갇혀 "차가운 화이트 림"을 만들 수도 없다. **기법 자체가 이 일을
 * 할 수 없다** — 그래서 rim 은 3차 값 그대로 두고(회귀 0) 축을 여기로 옮겼다.
 *
 * ## 무엇을 만드는가 — 횡 방향 판면 램프
 * 선체를 기수 축에 평행한 **{@link SURFACE_STRIPS} 개의 띠**로 나누고, 각 띠의 밝기를 매 프레임
 * 다시 정한다. 띠 기하는 한 번만 굽고(§ 매 프레임 Graphics 재빌드 금지) **알파만** 흔든다.
 *
 * 밝기를 정하는 값은 하나다 — 기체 로컬 횡축 위의 **조명 계수** `L`({@link surfaceLight}):
 *
 * - `L` 의 정적 성분은 **테마 광원의 횡 성분**이다. 기체가 선회하면 같은 태양에 대해 판면이
 *   돌아가므로 **기수를 돌리는 것만으로 음영이 흐른다**(접지 그림자·rim 과 같은 태양을 증언한다).
 * - `L` 의 동적 성분은 **롤**이다({@link ROLL_LIGHT_GAIN}). 우선회로 롤하면 우현이 내려가고
 *   좌현이 하늘을 향하므로 밝은 쪽이 **좌현으로 넘어간다** — 부호가 `−roll` 인 이유다.
 *   기체가 기울 때 **표면 음영이 실제로 변한다**(비평가 요구의 문자 그대로).
 *
 * 밝은 쪽은 가산 스트립, 어두운 쪽은 **곱연산** 스트립이다. 둘 다 **실루엣 마스크** 안에만
 * 있으므로 선체 밖으로 한 픽셀도 새지 않는다(그래서 aboveLayer 인데 §2-2 를 안 깬다 —
 * 실루엣 **모양**은 마스크가 보존하고 바뀌는 것은 **표면**뿐이다).
 *
 * ## 왜 Graphics 인가 (CRIT-1 재발 방지)
 * 스트립은 텍스처 복제가 **아니라** `Graphics` 다. 그래서 가산 기여가 `color × alpha` 로 끝나고
 * 텍스처 인자가 곱해지지 않는다 — {@link partLight}('specular') 모델이 화면과 일치한다.
 *
 * ## 기체 타입 7종 공통 규칙
 * `EntitySnapshot` 에 `typeId` 가 없어(파일 헤더 §기체 타입) 기체별 판면 배치를 가를 수 없다.
 * 띠는 표시 반치수 배율의 균등 분할이라 어느 실루엣에서도 어긋나지 않는다. 기체별 음영이
 * 필요하면 스냅샷에 `typeId` 를 싣는 **공유 파일 변경이 선행**되어야 한다(오케스트레이터 보고 항목).
 *
 * ## 4차는 **화면에 없었다** — 기하가 자기 최강 요소를 잘라냈다 (5차 CRIT)
 * 4차 실측: 국소 델타 게이트 25 대비 **0.62**(노이즈 바닥 0.00). 그것도 조명 계수가 포화한
 * `L=1` 컷에서다. 스트립을 하나씩 끈 결과 **10개 중 실제로 그려지는 것이 2개**였고, 설계 첨두를
 * 지는 두 스트립이 **0픽셀**이었다:
 *
 * | 스트립 | 알파 | 화면 기여 |
 * |---|---|---|
 * | shade 0 | 0.44 (전 계통 최강) | **0 px** |
 * | shade 1 | 0.22 | 221 px |
 * | shade 2 | 0 (구조적 항상 0) | 0 px |
 * | spec 3 | 0.069 | 14 px |
 * | spec 4 | 0.21 (하이라이트 최강) | **0 px** |
 *
 * **원인은 알파가 아니라 기하였다** — {@link FLAME_LAYERS}·§7 헤더가 두 번 정본으로 박아 둔
 * "상수는 맞았는데 화면은 틀렸다" 계열의 **세 번째 재발**이다. 두 결함이 겹쳐 있었다:
 *
 * 1. **기준 길이가 축을 잘못 잡았다.** 스트립은 **횡축**(짧은 축)으로 깔리는데 배율 기준이
 *    `halfSpan = max(width,height)/2 = 48`(**기수 축** = 긴 축)이었다. 실측 마스크는 64×64 텍스처에
 *    `scale (1.5, 1.2997)` 이라 **횡 반치수가 41.6px**, 그중 불투명 실루엣은 **≈±26px** 이다.
 *    거기에 `SURFACE_SPAN = 1.15`(마스크가 자를 것을 전제한 "넉넉히")를 곱하니 램프 양 끝
 *    (`|y| 33.1~55.2`)이 **마스크 상자조차 넘었다**. 지금은 {@link surfaceLateralHalf} 가 **짧은
 *    축**을 기준으로 삼고, `SURFACE_SPAN` 은 "넉넉히"가 아니라 **불투명 실루엣이 바운딩 상자에서
 *    차지하는 비율**({@link PLAYER_OPAQUE_LATERAL_HALF} 기반)이 된다.
 * 2. **홀수 분할은 중앙 스트립이 영구 알파 0 이다.** `surfaceStripCenter(2) = 0` 이라 어떤 `L`
 *    에서도 `s = center × L = 0` 이다 — 표시객체 2개와 프레임당 알파 계산 2회가 구조적 낭비였다.
 *    그래서 분할을 **짝수**로 바꿨다(중심이 0 인 스트립이 존재할 수 없다).
 *
 * ## 증인 (계약 §4-2·§4-3)
 * 4차의 게이트는 `surfaceShadeDelta(...) > 25` 하나였는데, 그 함수가 재던 알파는 **화면 기여가
 * 0픽셀인 스트립**의 것이었다 — 즉 게이트가 화면이 아니라 **설계 진폭**에 걸려 있어 기하를 고쳐도
 * 안 고쳐도 초록인 **자기증명**이었다. 그래서 {@link surfaceStripInsidePx}·
 * {@link surfaceRampOuterEdgePx} 를 순수 함수로 두고 **모든 스트립**에 대해 "마스크 안에 남기는
 * 픽셀 폭 > 0" 과 "램프 끝이 실루엣 안" 을 잠근다. 기준 길이를 `max` 로 되돌리면 후자가 빨개진다.
 */
/**
 * 횡 분할 수. **짝수여야 한다** — 홀수면 중앙 스트립의 중심이 정확히 0 이라 어떤 `L` 에서도
 * 알파가 0 인 표시객체가 영구히 남는다(4차에 실제로 그랬다). 테스트가 짝수성을 알파로 잠근다.
 */
const SURFACE_STRIPS = 4;
/**
 * 분할 수의 **공개 사본**. 검증이 "모든 스트립"을 돌 때 개수를 다시 박으면 분할을 바꿔도 일부만
 * 검사하게 된다 — 5차 MAJ 가 잡은 자기증명과 같은 계열이라 상수를 하나만 둔다.
 */
export const SURFACE_STRIP_COUNT = SURFACE_STRIPS;
/**
 * 스트립이 덮는 **기수 축** 길이(기수 반치수 `halfSpan` 배율, 중심 기준 ±). 이 축은 마스크가
 * 자르는 것이 정상이라 넉넉히 잡는다(기수 방향으로는 램프가 없으므로 낭비도 없다).
 */
const SURFACE_EXTENT = 1.15;
/**
 * 스트립이 덮는 **횡 반폭**({@link surfaceLateralHalf} 배율). 4차의 1.15("마스크가 자를 것")가
 * CRIT 의 절반이었다 — 램프의 양 끝이 실루엣 밖으로 나가면 그 스트립은 알파가 아무리 커도
 * **0픽셀**이다.
 *
 * 지금 값은 실측에서 나온다: 불투명 실루엣 횡 반폭 {@link PLAYER_OPAQUE_LATERAL_HALF}(26px)를
 * 바운딩 상자 횡 반치수(41.6px)로 나눈 **0.625** 의 보수적 하한이다. 램프 전체가 실루엣 안에
 * 들어가므로 {@link SURFACE_STRIPS} 개 스트립이 **전부** 픽셀을 남긴다.
 */
const SURFACE_SPAN = 0.62;
/** 가산 하이라이트 색 — 차가운 화이트. Graphics 라 텍스처 색에 갇히지 않는다(rim 과의 차이). */
const SURFACE_SPEC_COLOR = 0xdfeeff;
/**
 * 한 스트립의 가산 최대 알파. `(223,238,255)×0.3 = (66.9,71.4,76.5)`, 광도 **71.3** — 개별 기여
 * 상한(clean 실측 149.8)의 절반이고, 스트립은 서로 겹치지 않으므로 이 값이 곧 최댓값이다.
 */
const SURFACE_SPEC_ALPHA = 0.3;
/** 하이라이트 감쇠 지수. 1 보다 크면 밝은 쪽에 **좁게 모여** 스페큘러(윤이 나는 면)로 읽힌다. */
const SURFACE_SPEC_POWER = 1.6;
/** 곱연산 그늘 색. 컨투어와 같은 차가운 어둠이라 두 표현이 한 광원을 증언한다. */
const SURFACE_SHADE_COLOR = 0x1b2440;
/** 한 스트립의 곱연산 최대 알파. 감쇠 계수 0.53~0.60 — 그늘진 판면이 절반 가까이 어두워진다. */
const SURFACE_SHADE_ALPHA = 0.55;
/**
 * 롤이 조명 계수에 더하는 이득. 1 보다 크면 **롤만으로도** 밝은 쪽이 판면을 넘어갈 수 있다 —
 * 광원이 정면/후방(횡 성분 0)인 행성에서도 뱅킹이 음영을 만들어야 하므로 필요하다.
 */
const ROLL_LIGHT_GAIN = 1.4;

// ── 9. 이방성 헤일로 (3차 요구 ⑤) ───────────────────────────────────────────
/**
 * 비평가의 판정: "이 기체를 찾게 해주는 것은 실제로 이 부드러운 원형 청색 blob 인데 **형태도
 * 방향도 없다**. 플레이어 표현의 남은 최대 격차는 여기다."
 *
 * 맞다. 헤일로는 프레임에서 **가장 큰 면적을 차지하면서 정보를 0 비트** 준다. 등방 원은
 * "여기 뭔가 있다"까지만 말한다. AAA 가 발광에서 뽑아내는 것은 그 이상이다 — 발광의 **형태가
 * 곧 운동**이다(Returnal 의 대시 잔광, Housemarque 계열 전반).
 *
 * 그래서 플레이어 헤일로를 **기수 축으로 늘이고 · 횡으로 좁히고 · 중심을 전방으로 민다.**
 * 셋을 합치면 원이 **물방울/추진 원뿔**이 되고, 그 자체가 방향 신호가 된다 — 지금 컨투어가
 * 못 하는 일(어두운 배경에서의 방향 제시)을 대신한다.
 *
 * 속도 0 에서도 {@link HALO_BASE_STRETCH} 만큼은 늘어난 채다. 정지 상태에서 헤일로가 원으로
 * 되돌아가면 "기수를 잃는" 순간이 생기는데, 정지야말로 기수를 확인하는 순간이다.
 *
 * ⚠️ 이 함수는 순수하고, 적용은 `entityRenderer.syncGlowHalo` 의 **플레이어 경로에서만** 한다
 * (공유 파일 수정 승인 범위). 다른 발광체(젬·전리품·보스)의 헤일로는 한 픽셀도 안 바뀐다.
 */
const HALO_BASE_STRETCH = 0.25;
const HALO_SPEED_STRETCH = 0.55;
const HALO_NARROW = 0.22;
/** 전방 편심(표시 반치수 배율, 최대 속도 기준). 늘이기만 하면 대칭이라 "후미가 짧다"가 안 나온다. */
const HALO_FORWARD_BIAS = 0.35;

// ---------------------------------------------------------------------------
// 순수 함수 — 전부 Pixi 없이 성립한다(테스트가 여기를 직접 잡는다).
// ---------------------------------------------------------------------------

/** [0,1] 클램프. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── 가산 합성 모델 — "상수가 아니라 결과"를 검증하기 위한 최소 모델 ─────────────

/** 가산으로 얹히는 한 층(색 + 알파). */
export interface LightLayer {
  readonly color: number;
  readonly alpha: number;
}

/** 가산 기여량(0..255 스케일, 클리핑 전). 배경에 **더해지는** 양이다. */
export interface AddedLight {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * 가산 층들이 배경에 더하는 총량. 알파 곱을 채널별로 누적할 뿐이지만, **이 한 줄이 있어야
 * 검증이 상수가 아니라 합성 결과에 걸린다**(CRIT-1 의 교훈 — 상수는 맞고 화면은 틀릴 수 있다).
 */
export function addLayers(layers: readonly LightLayer[], repeat = 1): AddedLight {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const l of layers) {
    r += ((l.color >> 16) & 0xff) * l.alpha * repeat;
    g += ((l.color >> 8) & 0xff) * l.alpha * repeat;
    b += (l.color & 0xff) * l.alpha * repeat;
  }
  return { r, g, b };
}

/**
 * 플레이어 텍스처의 불투명 픽셀 **평균 RGB**. 비평가 4차 실측치다(청록 — R 낮음·G 높음).
 *
 * ⚠️ 이 값이 있어야 스프라이트 기반 가산 부품의 모델이 화면과 일치한다({@link spriteAddLight}).
 * 값 자체는 기체 텍스처의 함수이므로 기체가 바뀌면 따라가지 못한다 — 그래서 이 상수에 의존하는
 * 단언은 전부 **부등식**(상한)이고, 등식으로 잠그지 않는다.
 */
export const PLAYER_TEX_MEAN = { r: 50, g: 180, b: 200 } as const;

/**
 * 플레이어 스프라이트의 **표시 치수 실측**(px). 마스크 텍스처 64×64 에 `scale (1.5, 1.2997)` 이
 * 걸린 결과다 — 즉 기수 축(x)이 96, **횡축(y)이 83.2** 로 두 축의 길이가 다르다.
 *
 * ⚠️ 이 값이 있어야 판면 스트립 기하를 **화면 좌표에서** 검증할 수 있다. 단위 테스트의 스프라이트는
 * 48×48 **정사각**이라 `min`/`max` 가 같아 5차 CRIT 의 축 혼동을 구조적으로 못 잡는다.
 */
export const PLAYER_SPRITE_DISPLAY = { width: 96, height: 83.2 } as const;

/**
 * 불투명 실루엣의 **횡 반폭 실측**(px). 바운딩 상자 횡 반치수(83.2/2 = 41.6)보다 훨씬 작다 —
 * 이 격차가 5차 CRIT 의 실체다(스트립이 상자 기준으로 깔려 실루엣 밖에 앉았다).
 *
 * {@link surfaceStripInsidePx} 의 판정 기준이 되며, 스트립 배치와 **독립적인 입력**이라
 * 기준 길이를 긴 축으로 되돌리면 검증이 실제로 빨개진다(자기증명 아님).
 */
export const PLAYER_OPAQUE_LATERAL_HALF = 26;

/**
 * **스프라이트** 기반 가산 부품이 화면에 얹는 양. Pixi 는 `src.rgb = texture.rgb × tint × alpha`
 * 이므로 텍스처 색이 곱으로 들어간다 — {@link addLayers}(자유 공간 `Graphics` 기여용)를 그대로
 * 쓰면 **크기가 5배 틀리고 채널 우열이 뒤집힌다**(4차 CRIT-1 의 직접 원인).
 *
 * 손상 오버레이가 이 함정에 걸려 "코드에는 R 지배 달아오름, 화면에는 G 가 더 오르는 미세 밝힘"이
 * 됐다. 그 항목은 감산으로 갈았고(§7 헤더), 남은 스프라이트 가산 부품(rim·ghost)은 여기를 쓴다.
 */
export function spriteAddLight(color: number, alpha: number, repeat = 1): AddedLight {
  const k = alpha * repeat;
  return {
    r: (PLAYER_TEX_MEAN.r / 255) * ((color >> 16) & 0xff) * k,
    g: (PLAYER_TEX_MEAN.g / 255) * ((color >> 8) & 0xff) * k,
    b: (PLAYER_TEX_MEAN.b / 255) * (color & 0xff) * k,
  };
}

/** 여러 기여의 합(같은 픽셀에 겹쳐 얹힐 때). */
export function sumLight(...parts: readonly AddedLight[]): AddedLight {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of parts) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  return { r, g, b };
}

/** ITU-R BT.601 광도. 비평가가 본체/기여 픽셀 밝기를 잰 것과 같은 축이다. */
export function luminance(l: AddedLight): number {
  return 0.299 * l.r + 0.587 * l.g + 0.114 * l.b;
}

/**
 * HSV 채도를 0..255 로. **적탄 흰 코어의 실측 채도 중앙값이 9** 였고 불꽃 상위 5% 의 44.8% 가
 * 30 미만이었다 — 그래서 합격선이 60 이다(둘이 확실히 갈려야 한다).
 */
export function saturation255(l: AddedLight): number {
  const max = Math.max(l.r, l.g, l.b);
  if (max <= 0) return 0;
  const min = Math.min(l.r, l.g, l.b);
  return ((max - min) / max) * 255;
}

// ── 감산 합성 모델 — 컨투어는 빛을 더하지 않고 **곱한다** ───────────────────

/**
 * 곱연산 층이 배경에 남기는 **감쇠 계수**(채널당 0..1). 1 = 무변화, 0 = 완전 흑.
 *
 * Pixi 의 `multiply` 는 프리멀티플라이드 알파에서
 * `out = src.rgb·dst.rgb + dst.rgb·(1−a)` 이고 `src.rgb = tint·a` 이므로
 * `out = dst · (1 − a(1 − tint))` 다 — 즉 **알파가 0 이면 정확히 항등원**이라 투명 영역이
 * 배경을 건드리지 않는다(마스크가 필요 없는 이유).
 */
export interface DarkFactor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** 같은 곱연산 층이 `repeat` 장 겹쳤을 때의 최종 감쇠 계수. */
export function multiplyFactor(color: number, alpha: number, repeat = 1): DarkFactor {
  const per = (ch: number): number => Math.pow(1 - alpha * (1 - ch / 255), repeat);
  return { r: per((color >> 16) & 0xff), g: per((color >> 8) & 0xff), b: per(color & 0xff) };
}

/**
 * 컨투어 띠가 실제로 화면에 만드는 감쇠 계수. **가산 기여는 정의상 0** 이고, 이 값이 1 보다
 * 얼마나 작은지가 곧 "경계가 보이는가"의 물리량이다.
 */
export function contourFactor(): DarkFactor {
  return multiplyFactor(CONTOUR_COLOR, CONTOUR_ALPHA, CONTOUR_TYPICAL_OVERLAP);
}

/**
 * 컨투어가 밝기 L 인 바닥에 만드는 **국소 광도 델타**(양수 = 어두워진 양). 비평가의 ①번 합격
 * 기준("국소 상위 1% 가 노이즈 바닥의 3배")을 코드에서 미리 계산해 두는 자리다 — 얼린 화면의
 * 노이즈 바닥은 §2-4 가 **0.10** 으로 못 박았다.
 */
export function contourDelta(backdropLuma: number): number {
  const f = contourFactor();
  return backdropLuma * (1 - (0.299 * f.r + 0.587 * f.g + 0.114 * f.b));
}

/**
 * 손상 그을림이 선체에 만드는 감쇠 계수. 텍스처 인자는 **일부러 빼고** 계산한다 — 곱연산에서
 * 텍스처 색은 감쇠를 더 강하게만 하므로(`tex/255 ≤ 1`) 이 값은 화면 효과의 **하한**이다.
 * 즉 이 모델로 통과하면 화면은 그보다 세다(느슨해지는 쪽으로 틀릴 수 없다 — 3차 CRIT-1 의 반대).
 *
 * @param alpha `damageAlpha` 가 낸 실제 프레임 알파.
 */
export function damageFactor(alpha: number): DarkFactor {
  return multiplyFactor(DAMAGE_SCORCH_COLOR, alpha);
}

/**
 * 손상 그을림이 광도 `bodyLuma` 인 선체 픽셀에서 만드는 **광도 하강량**. 4차 합격 게이트가
 * 상수가 아니라 이 실측 파생에 걸린다: clean 컷 실측(149.8)에서 **25 이상**.
 */
export function damageDelta(bodyLuma: number, alpha: number = DAMAGE_ALPHA_MAX): number {
  const f = damageFactor(alpha);
  return bodyLuma * (1 - (0.299 * f.r + 0.587 * f.g + 0.114 * f.b));
}

/**
 * 그을림이 남기는 **채널별 하강량**(양수 = 어두워진 양). ΔR < ΔG < ΔB 여야 난색이 남는다 —
 * 3차의 실패는 정확히 이 우열이 뒤집힌 것이었다(ΔG > ΔR).
 */
export function damageWarmShift(bodyLuma: number, alpha: number = DAMAGE_ALPHA_MAX): AddedLight {
  const f = damageFactor(alpha);
  return { r: bodyLuma * (1 - f.r), g: bodyLuma * (1 - f.g), b: bodyLuma * (1 - f.b) };
}

/**
 * 본체 밝기 기준선.
 *
 * ## ⚠️ 이 상수의 출처와 한계 (비평가 3차 경고 — 자기증명 제거)
 * **출처**: 변경 전(레인 장식자 0개) 컷의 플레이어 박스 160×160 픽셀 분포. `p99` = 선체 상위 1%,
 * `p95` = 상위 5%. 계약 §2-2 "이펙트가 본체보다 밝으면 안 된다"를 **국소 픽셀 단위로** 판정하는
 * 유일한 수치다(§2-4 는 화면 총량 조항이라 국소를 못 잡는다).
 *
 * **한계 — 이 값은 장면의 함수이고, 장면은 다른 레인이 바꾼다.** 통합 빌드에서 다시 재면
 * 같은 선체가 clean 컷 **149.8** · dense 컷 **218.7** 이었다. 즉 211.6 은 "그때 그 컷"의 값이지
 * 불변량이 아니다. 레인 B·C 가 배경·적을 바꾸면 이 상수는 장면을 따라가지 못하고, 그러면
 * **테스트가 자기가 박은 값으로 자기를 증명**하게 된다.
 *
 * **그래서 두 겹으로 판정한다:**
 * 1. 단위 테스트는 `part` 개별 기여를 **가장 엄한 실측치**({@link BODY_LUMA_P99_CLEAN} = 149.8)
 *    아래로 잠근다. 합산 스택만 211.6 을 쓰는데, 판정 장면인 dense 컷의 실측(218.7)이 그보다
 *    높으므로 **보수적인 방향**이다(느슨해지는 쪽으로 틀릴 수 없다).
 * 2. 화면 판정은 상수가 아니라 {@link fitsUnderBody} 에 **같은 프레임에서 실측한 본체 p99** 를
 *    넘겨서 한다 — 하네스/비평가 경로가 이걸 쓴다. 상수는 그 경로가 없을 때의 하한선일 뿐이다.
 */
export const BODY_LUMA_P99 = 211.6;
export const BODY_LUMA_P95 = 148.7;
/** 통합 빌드 clean 컷의 본체 실측 p99. 관측된 것 중 **가장 엄한** 값이라 개별 기여의 상한으로 쓴다. */
export const BODY_LUMA_P99_CLEAN = 149.8;
/** 통합 빌드 dense 컷(판정 장면)의 본체 실측 p99. {@link BODY_LUMA_P99} 가 보수적임의 근거. */
export const BODY_LUMA_P99_DENSE = 218.7;

/**
 * 기여가 **같은 프레임에서 실측한** 본체 p99 아래인가. 고정 상수 대신 이 함수에 측정값을 넣는
 * 것이 정본 판정이다(위 한계 항목 ②).
 */
export function fitsUnderBody(part: AddedLight, measuredBodyP99: number): boolean {
  return luminance(part) < measuredBodyP99;
}

/**
 * 이 레인이 화면에 더하는 가산 기여의 종류.
 *
 * **감산 부품은 여기 없다 — 기여가 구조적으로 0 이다**: 컨투어(⓪) · 손상 그을림(⑦) ·
 * 판면 그늘 스트립(⑩ 어두운 쪽). 각자 {@link contourDelta}·{@link damageDelta}·
 * {@link surfaceShadeDelta} 로 **감산 쪽 게이트**를 따로 진다.
 */
export type PlayerLightPart = 'flame' | 'rim' | 'ghost' | 'dashCore' | 'dashRing' | 'specular';

/**
 * 각 기여가 **화면에 실제로 얹는 양**. 상수 하나가 아니라 그 기여를 만드는 층·겹침을 전부
 * 반영한다 — 검증은 이 함수에만 걸고 색 상수에는 걸지 않는다(CRIT-1: 상수는 맞고 화면은 틀릴
 * 수 있다).
 *
 * **`Graphics` 기여는 {@link addLayers}, 스프라이트 기여는 {@link spriteAddLight}** 다 — 둘을
 * 섞어 쓴 것이 4차 CRIT-1 이었다(텍스처 인자 누락으로 5배 과대평가).
 *
 * - `flame` — Graphics. 3층이 한 노즐 안에서 전부 겹치는 최내곽 지점.
 * - `dashCore` — Graphics. 대시 심 **단독**(불꽃 위 합산은 {@link HEAVY_STACKS} 가 본다).
 * - `dashRing` — Graphics. 개시 링의 첨두(t=0).
 * - `specular` — Graphics. 판면 하이라이트 스트립의 첨두(스트립끼리는 겹치지 않는다).
 * - `rim` — **스프라이트**. 광원 쪽으로 밀린 텍스처 복제.
 * - `ghost` — **스프라이트**. 대시 중 잔상 두 장이 겹치는 지점(연속 두 샘플은 실제로 겹친다).
 */
export function partLight(part: PlayerLightPart): AddedLight {
  switch (part) {
    case 'flame':
      return addLayers(FLAME_LAYERS);
    case 'rim':
      return spriteAddLight(RIM_COLOR, RIM_ALPHA);
    case 'ghost':
      return spriteAddLight(GHOST_TINT, GHOST_ALPHA, 2);
    case 'dashCore':
      return addLayers([{ color: DASH_CORE_COLOR, alpha: DASH_CORE_ALPHA }]);
    case 'dashRing':
      return addLayers([{ color: DASH_RING_COLOR, alpha: DASH_RING_ALPHA }]);
    case 'specular':
      return addLayers([{ color: SURFACE_SPEC_COLOR, alpha: SURFACE_SPEC_ALPHA }]);
  }
}

/**
 * **한 픽셀에 실제로 동시에 얹힐 수 있는** 가산 조합들. 임의 조합의 전수 합이 아니다 —
 * 그러면 일어나지 않는 상황으로 스스로를 묶게 된다. 기하로 가능한 것만 넣는다:
 *
 * - 불꽃과 대시 심은 **같은 자리**다(심이 불꽃 안에 있다).
 * - 림은 선체 가장자리라 광원이 후방일 때 불꽃 뿌리와 겹친다.
 * - 고스트·링은 전부 기체 뒤/옆이라 불꽃과 겹칠 수 있다.
 * - 판면 하이라이트(`specular`)는 **실루엣 마스크 안**이라 자유 공간 발광과 겹치지 않는다.
 *   겹치는 것은 선체 위에 오는 것뿐인데 그건 림의 안쪽 끝이다 — 그 조합만 넣는다.
 * - 손상 그을림·판면 그늘은 **감산**이라 가산 합에 나타날 수 없다(그래서 여기 없다).
 */
export const HEAVY_STACKS: readonly (readonly PlayerLightPart[])[] = [
  ['flame', 'rim', 'dashCore'],
  ['flame', 'dashCore', 'ghost'],
  ['flame', 'dashCore', 'dashRing'],
  ['flame', 'rim', 'ghost'],
  ['rim', 'specular'],
];

/**
 * **`reducedMotion` 도출.** `AdornerContext` 는 `GraphicsSettings` 를 주지 않지만 게이트에서
 * 되짚을 수 있다: `effectGates` 표에서 `hitFlash` 는 **전 티어 on** 이고 오직 `reducedMotion`
 * 만 그것을 끈다. 따라서 `hitFlash === false` ⇔ `reducedMotion` 이다(qualityTier.ts 정본).
 */
export function reducedMotion(gates: EffectGates): boolean {
  return !gates.hitFlash;
}

/**
 * **`reducedGlow` 도출(보수적).** `halo` 는 `reducedGlow` 로도 꺼지고 low 티어에서도 꺼진다.
 * 둘을 가를 수는 없지만 **가를 필요가 없다** — 어느 쪽이든 가산 발광을 내려야 하는 상황이다.
 */
export function reducedGlow(gates: EffectGates): boolean {
  return !gates.halo;
}

/**
 * 스냅샷 델타에서 속도를 파생한다(u/s). sim 에 속도 필드를 더하지 않기 위한 유일한 경로다(§2-1).
 *
 * `prev` 는 **직전 sim 스냅샷**이라 sim-step 이 없는 렌더 프레임에서는 같은 델타가 반복된다 —
 * 그게 옳다(속도는 안 변했다). 0 으로 떨어지지 않으므로 불꽃이 프레임마다 깜빡이지 않는다.
 * 리스폰·순간이동의 거대 점프는 {@link MAX_TRACK_SPEED} 로 잘라 불꽃·잔상 폭주를 막는다.
 */
export function snapshotVelocity(e: EntitySnapshot, prev: EntitySnapshot): { vx: number; vy: number } {
  let vx = (e.x - prev.x) * SIM_HZ;
  let vy = (e.y - prev.y) * SIM_HZ;
  const sp = Math.hypot(vx, vy);
  if (sp > MAX_TRACK_SPEED) {
    const k = MAX_TRACK_SPEED / sp;
    vx *= k;
    vy *= k;
  }
  return { vx, vy };
}

/**
 * 기수(`facing`) 기준 **횡 속도 성분**. 화면 좌표계는 +y 가 아래라 기수를 +90° 돌린 우현
 * 단위벡터가 `(-sin, cos)` 이다. 양수 = 우현으로 미끄러지는 중.
 */
export function lateralSpeed(vx: number, vy: number, facing: number): number {
  return vx * -Math.sin(facing) + vy * Math.cos(facing);
}

/** 횡 속도 → 롤 목표치 [-1,1]. 순항 속도에서 최대 롤에 닿는다. */
export function bankTarget(lateral: number): number {
  const t = lateral / CRUISE_SPEED;
  return t < -1 ? -1 : t > 1 ? 1 : t;
}

/** 감쇠 스프링 1스텝(2차 운동). `dt` 는 {@link MAX_STEP_DT} 로 잘라 발산을 막는다. */
export function springStep(
  value: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): { value: number; vel: number } {
  const h = dt > MAX_STEP_DT ? MAX_STEP_DT : dt < 0 ? 0 : dt;
  const nextVel = vel + ((target - value) * stiffness - vel * damping) * h;
  return { value: value + nextVel * h, vel: nextVel };
}

/** 불꽃 길이 배율. 정지 아이들 코어 → 순항 연장 → 대시 폭발적 확장. */
export function thrustExtent(speed: number, dashing: boolean): number {
  const base = THRUST_IDLE + (THRUST_CRUISE - THRUST_IDLE) * clamp01(speed / CRUISE_SPEED);
  return dashing ? base * THRUST_DASH_MULT : base;
}

/** 부유 강도 [0,1]. 정지에서 1, {@link IDLE_SPEED_CUTOFF} 이상에서 0. */
export function idleness(speed: number): number {
  return 1 - clamp01(speed / IDLE_SPEED_CUTOFF);
}

/** 실드 셸 한 프레임의 상태(없으면 `null` = 무적 창 밖). */
export interface ShieldShellState {
  /** 표시 반치수 배율 반지름. 창이 흐를수록 **단조 감소**한다 = 남은 시간이 읽힌다. */
  readonly radius: number;
  /** 알파(0..1). 끝으로 갈수록 옅어져 툭 끊기지 않는다. */
  readonly alpha: number;
}

/**
 * 피격 후 경과 시간 → 실드 셸 상태. **깜빡임이 아니다** — 반지름이 시간의 단조 감소 함수라
 * 화면만 보고 무적이 얼마나 남았는지 읽을 수 있다(계약 §3 레인 A ④ "읽히는 표현").
 */
/**
 * 셸에서 **선체에 가장 가까운 요소**가 놓이는 반지름(표시 반치수 배율). 1 보다 커야 셸이
 * 실루엣을 한 픽셀도 덮지 않는다 — `shieldShell(t).radius` 는 셸의 **바깥** 반지름이라
 * 그것만 1 초과인지 봐서는 안쪽 요소가 몸통을 가로지르는 것을 놓친다(실제로 놓쳤다).
 */
export function shieldInnermostRadius(shell: ShieldShellState): number {
  return shell.radius * SHIELD_INNER_BAND;
}

export function shieldShell(elapsed: number): ShieldShellState | null {
  if (!(elapsed >= 0) || elapsed >= SHIELD_WINDOW_S) return null;
  const t = elapsed / SHIELD_WINDOW_S;
  return {
    radius: SHIELD_R_START + (SHIELD_R_END - SHIELD_R_START) * t,
    alpha: SHIELD_ALPHA * (1 - t * t),
  };
}

/**
 * 실드 셸의 티어 등급. **완전히 끄지는 않는다** — 이건 장식이 아니라 "지금 맞아도 안 아프다"는
 * 전투 정보이고, 계약 §2-2 는 가독성을 예쁨보다 위에 둔다. 대신 비용이 드는 축(자전·맥동)을
 * 티어·모션 감소로 내리고, 발광 감소에서는 알파를 낮춘다.
 */
export function shieldGate(gates: EffectGates, tier: QualityTier): 'plain' | 'full' {
  return tier === 'low' || reducedMotion(gates) ? 'plain' : 'full';
}

/**
 * 티어별 대시 고스트 개수. `trails` 게이트가 꺼졌거나 모션 감소·발광 감소면 0.
 *
 * ⚠️ `reducedGlow` 조건이 **빠져 있었다**(비평가 MAJ-2): `quality:high + reducedGlow` 에서
 * 림·불꽃은 0 인데 고스트 5개가 그대로 남았다. 고스트는 `blendMode:'add'` + 시안 tint 라
 * 명백한 발광축이고, 대시마다 5개가 동시에 명멸하므로 광과민 대응에서 가장 나쁜 형태다.
 */
/**
 * 추진 불꽃의 등급 (4차 MINOR — "low 티어에서 기체가 다시 커서가 된다").
 *
 * 3차는 불꽃 전체를 `reducedGlow`(= `!gates.halo`) 뒤에 뒀는데, **low 티어에서도 `halo` 가 꺼진다.**
 * 그래서 low 에서는 정지한 기체에 아이들 코어조차 없어 "시동이 걸린 기체"로 읽히지 않았다.
 *
 * ## ⚠️ 두 원인은 게이트에서 갈 수 없다 (한계를 명시한다)
 * `effectGates` 는 `halo` 를 **low 티어**와 **`reducedGlow` 설정** 양쪽에서 false 로 만든다
 * (`qualityTier.ts` 정본). 따라서 "low 인데 reducedGlow 는 아님"을 판별할 방법이 **없다** —
 * `ctx.tier === 'low'` 로 갈라도 low + reducedGlow 사용자는 같은 분기에 들어온다.
 *
 * 그래서 이 파일이 이미 쓰는 판단(실드 셸·손상: **정보는 끄지 않고 등급만 강등**하고 발광 감소에
 * 0.55~0.6 배)을 그대로 적용한다: low 에서는 불꽃을 **정지·감광 아이들 코어**로만 남긴다
 * (대시 확장·요동·심 없음, 알파 {@link FLAME_LOW_ALPHA}). 맥동하지 않는 상수 세기이므로
 * 광과민 위험이 가장 낮은 형태다.
 */
export function flameGate(gates: EffectGates, tier: QualityTier): 'off' | 'idle' | 'full' {
  if (!reducedGlow(gates)) return 'full';
  return tier === 'low' ? 'idle' : 'off';
}

/** low 티어 아이들 코어의 알파. 실드 셸·손상이 발광 감소에서 쓰는 강등 배율과 같은 대역이다. */
const FLAME_LOW_ALPHA = 0.5;

export function ghostBudget(gates: EffectGates, tier: QualityTier): number {
  if (!gates.trails || reducedMotion(gates) || reducedGlow(gates)) return 0;
  return tier === 'high' ? GHOSTS_HIGH : tier === 'med' ? GHOSTS_MED : 0;
}

/**
 * 림라이트 오프셋(px). 광원 **쪽**이다 — 접지 그림자({@link file://../groundShadow.ts})가
 * `-light` 로 가는 것과 정확히 반대 부호이며, 그래서 둘이 같은 태양을 증언한다.
 */
export function rimOffset(light: EnvLightSpec, halfSpan: number): { dx: number; dy: number } {
  const mag = halfSpan * RIM_OFFSET;
  return { dx: lightX(light) * mag, dy: lightY(light) * mag };
}

/**
 * 피격 임펄스 방향(단위벡터). 피해원(源)은 스냅샷에 없다 — 있으려면 sim 표면을 넓혀야 한다(§2-1).
 * 그래서 **기수 반대**(정면에서 맞았다는 근사)에 결정적 시드로 뽑은 횡 성분을 섞는다. 기체는
 * 자동 조준으로 늘 위협을 바라보므로 이 근사는 대개 실제 피해 방향과 일치하고, 어긋나도
 * "충격을 받아 밀렸다"는 읽기는 유지된다.
 */
export function hitImpulseDir(facing: number, seed: number): { dx: number; dy: number } {
  // 결정적 해시 → [-1,1]. Math.random 금지(재현 가능 계약).
  const h = (Math.imul(seed | 0, 2654435761) >>> 0) / 4294967296;
  const lat = (h * 2 - 1) * HIT_LATERAL;
  const bx = -Math.cos(facing);
  const by = -Math.sin(facing);
  const rx = -Math.sin(facing) * lat;
  const ry = Math.cos(facing) * lat;
  const dx = bx + rx;
  const dy = by + ry;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

// ── 대시 · 손상 · 증기 · 헤일로 파생 (3차 요구 ②③⑤⑥) ──────────────────────

/**
 * 이 속력(u/s)이 대시인가. `entityRenderer` 의 플레이어 경로가 트라우마 발화에 쓰는 것과
 * **같은 판정**이어야 화면 흔들림과 불꽃 확장이 같은 프레임에 붙는다(따로 두면 한 프레임씩
 * 어긋나 "왜 흔들리고 나서 빨라지지" 가 된다).
 */
export function isDashSpeed(speed: number): boolean {
  return speed >= DASH_SPEED;
}

/**
 * 대시 열기 한 스텝. 상승이 하강보다 8배 빨라 **켜지는 것은 사건, 꺼지는 것은 여운**이 된다.
 * 프레임률 무관(지수 수렴)이라 30/60/144Hz 에서 같은 벽시계 곡선을 그린다.
 */
export function dashHeatStep(heat: number, dashing: boolean, dt: number): number {
  const h = dt > MAX_STEP_DT ? MAX_STEP_DT : dt < 0 ? 0 : dt;
  const tau = dashing ? DASH_HEAT_ATTACK : DASH_HEAT_RELEASE;
  const k = 1 - Math.exp(-h / tau);
  return heat + ((dashing ? 1 : 0) - heat) * k;
}

/** 대시 개시 링 한 프레임의 상태(없으면 `null` = 링 수명 밖). */
export interface DashRingState {
  /** 표시 반치수 배율 반지름. 시간의 **단조 증가** 함수 = 밖으로 퍼지는 충격파다. */
  readonly radius: number;
  readonly alpha: number;
  /** 획 두께(표시 반치수 배율). 퍼질수록 얇아진다. */
  readonly width: number;
}

/**
 * 대시 개시 후 경과 → 링 상태. **고정 반지름 링은 조준 레티클의 어휘**(§2-5)라 금지고, 여기는
 * 반지름이 시간에 대해 단조 증가하며 0.28초에 사라지는 **충격파**다 — 정지 화면에 남지 않는다.
 */
export function dashRing(elapsed: number): DashRingState | null {
  if (!(elapsed >= 0) || elapsed >= DASH_RING_S) return null;
  const t = elapsed / DASH_RING_S;
  const ease = 1 - (1 - t) * (1 - t); // out-quad — 초반이 빠르다(충격의 첨두).
  return {
    radius: DASH_RING_R_START + (DASH_RING_R_END - DASH_RING_R_START) * ease,
    alpha: DASH_RING_ALPHA * (1 - t) * (1 - t),
    width: DASH_RING_WIDTH * (1 - 0.7 * t),
  };
}

/**
 * 손상 강도 [0,1]. `maxHp` 가 0/음수인 방어적 경우엔 0(표현 없음)이다.
 *
 * **누진이지 단계가 아니다** — 3단 티어로 자르면 경계에서 툭툭 바뀌어 "정보"가 아니라 "깜빡임"이
 * 된다. 연속 함수라 HP 가 줄어드는 동안 색이 **자란다**.
 */
export function damageIntensity(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) return 0;
  const ratio = clamp01(hp / maxHp);
  return clamp01((DAMAGE_START - ratio) / DAMAGE_START);
}

/** 위독(맥동이 붙는) 구간인가. */
export function isCriticalHp(hp: number, maxHp: number): boolean {
  return maxHp > 0 && hp / maxHp < DAMAGE_CRITICAL;
}

/**
 * 손상 오버레이 알파. `pulse01` 은 [0,1] 맥동 위상값이고 **위독 구간에서만** 반영된다.
 * `dim`(발광 감소)에서도 0 이 되지 않는다 — 손상도는 장식이 아니라 전투 정보다.
 */
export function damageAlpha(intensity: number, pulse01: number, dim: boolean): number {
  if (intensity <= 0) return 0;
  const base = DAMAGE_ALPHA_MAX * intensity;
  const pulsed = base * (1 - DAMAGE_PULSE_DEPTH + DAMAGE_PULSE_DEPTH * clamp01(pulse01));
  return pulsed * (dim ? DAMAGE_REDUCED_GLOW : 1);
}

// ── 10. 판면 방향광 파생 (4차 CRIT-3) ───────────────────────────────────────

/**
 * 스트립 `i` 의 **횡 방향 중심**(정규 −1..1). 균등 분할의 중심점이라 기체 타입과 무관하다
 * (파일 헤더 §기체 타입 공통 규칙).
 *
 * {@link SURFACE_STRIPS} 가 **짝수**라 이 값이 0 이 되는 `i` 가 없다 — 4차에는 홀수 분할의
 * 중앙 스트립이 `0` 을 받아 어떤 `L` 에서도 알파 0 인 표시객체로 남아 있었다.
 */
export function surfaceStripCenter(i: number): number {
  return -1 + (2 * i + 1) / SURFACE_STRIPS;
}

/**
 * 판면 스트립의 **횡 기준 길이**(px). 스트립은 기수 축이 아니라 **횡축**으로 깔리므로 기준은
 * 두 축 중 **짧은 쪽**이다.
 *
 * ⚠️ 4차는 여기가 `halfSpan = max(width,height)/2`(기수 축)였다 — 그래서 램프의 양 끝이 실루엣
 * 밖에 앉아 전 계통 최강 스트립 둘이 **0픽셀**이었다(§10 헤더 표). 이 함수를 `max` 로 되돌리면
 * {@link surfaceRampOuterEdgePx} 게이트가 빨개진다.
 */
export function surfaceLateralHalf(width: number, height: number): number {
  return Math.min(width, height) / 2 || 1;
}

/** 스트립 `i` 가 덮는 횡 구간(정규, {@link surfaceLateralHalf} 배율). */
export function surfaceStripBand(i: number): { readonly lo: number; readonly hi: number } {
  const half = SURFACE_SPAN / SURFACE_STRIPS;
  const c = surfaceStripCenter(i) * SURFACE_SPAN;
  return { lo: c - half, hi: c + half };
}

/**
 * 스트립 `i` 가 **실루엣 마스크 안에 남기는 횡 폭**(px). 0 이면 알파가 아무리 커도 화면 기여가
 * 0픽셀이다 — 4차 CRIT 을 재는 물리량이고, {@link surfaceShadeDelta} 같은 알파 게이트가
 * **혼자서는** 절대 잡지 못하는 축이다.
 *
 * `opaqueHalf` 는 스트립 배치와 **독립적으로 실측된** 불투명 실루엣 반폭이다(기본값
 * {@link PLAYER_OPAQUE_LATERAL_HALF}). 배치에서 파생하면 다시 자기증명이 된다.
 */
export function surfaceStripInsidePx(
  i: number,
  width: number,
  height: number,
  opaqueHalf: number = PLAYER_OPAQUE_LATERAL_HALF,
): number {
  const lateral = surfaceLateralHalf(width, height);
  const band = surfaceStripBand(i);
  const lo = Math.max(band.lo * lateral, -opaqueHalf);
  const hi = Math.min(band.hi * lateral, opaqueHalf);
  return hi > lo ? hi - lo : 0;
}

/**
 * 램프의 **가장 바깥 끝**이 놓이는 횡 좌표(px, 절대값). 이 값이 실측 불투명 반폭
 * ({@link PLAYER_OPAQUE_LATERAL_HALF})을 넘으면 최외곽 스트립의 일부(또는 전부)가 실루엣 밖으로
 * 나가 화면에서 잘린다 — 4차에는 55.2 대 26 이었다.
 */
export function surfaceRampOuterEdgePx(width: number, height: number): number {
  return surfaceStripBand(SURFACE_STRIPS - 1).hi * surfaceLateralHalf(width, height);
}

/**
 * 기체 로컬 횡축의 **조명 계수** `L` ∈ [−1,1]. 양수면 로컬 +y(우현) 쪽이 밝다.
 *
 * - `lightLateral` — 테마 광원 단위벡터의 **기수 기준 횡 성분**. 선회만으로 음영이 흐르게 한다.
 * - `roll` — 뱅킹 상태 [−1,1]. 우선회 롤(양수)이면 우현이 내려가고 좌현이 하늘을 보므로 밝은
 *   쪽이 좌현(−y)으로 넘어간다 → 부호가 **−**다.
 */
export function surfaceLight(lightLateral: number, roll: number): number {
  const v = lightLateral - ROLL_LIGHT_GAIN * roll;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** 한 스트립의 가산(하이라이트)·감산(그늘) 알파. 둘 중 하나는 항상 0 이다(같은 면은 둘일 수 없다). */
export interface SurfaceStripAlpha {
  readonly spec: number;
  readonly shade: number;
}

/**
 * 스트립 `i` 의 알파. `s = center × L` 이 양수면 빛을 보는 판면(가산), 음수면 등지는 판면(감산)이다.
 *
 * @param specOn 가산 하이라이트 허용(발광 감소·low 티어에서 false). **감산 그늘은 끄지 않는다** —
 *   빛이 아니라 그림자라 광과민 축이 아니고, 그게 low 티어에서 기체가 다시 커서로 보이지 않게
 *   하는 유일한 축이다(⓪ 컨투어와 같은 판단).
 */
export function surfaceStripAlpha(i: number, light: number, specOn: boolean): SurfaceStripAlpha {
  const s = surfaceStripCenter(i) * light;
  return {
    spec: specOn && s > 0 ? SURFACE_SPEC_ALPHA * Math.pow(s, SURFACE_SPEC_POWER) : 0,
    shade: s < 0 ? SURFACE_SHADE_ALPHA * -s : 0,
  };
}

/**
 * 판면 그늘이 광도 `bodyLuma` 인 선체 픽셀에 만드는 **최대 광도 하강량**(가장 그늘진 스트립).
 * 감산 부품의 게이트는 가산 예산이 아니라 이 값이 진다.
 *
 * ⚠️ **이 함수 혼자로는 게이트가 될 수 없다.** 알파 진폭만 재므로 그 스트립이 화면에 0픽셀이어도
 * 값이 그대로 나온다 — 4차에 정확히 그랬다(5차 MAJ: 자기증명). {@link surfaceStripInsidePx} 가
 * "그 스트립이 실제로 픽셀을 남기는가"를 함께 잠글 때만 이 값이 화면을 뜻한다.
 */
export function surfaceShadeDelta(bodyLuma: number, light = 1): number {
  // 스트립 0 은 중심이 가장 음수(−0.75)라 `light > 0` 에서 가장 깊게 그늘진다.
  const a = surfaceStripAlpha(0, Math.abs(light), false).shade;
  const f = multiplyFactor(SURFACE_SHADE_COLOR, a);
  return bodyLuma * (1 - (0.299 * f.r + 0.587 * f.g + 0.114 * f.b));
}

/** 플레이어 헤일로의 이방성 변환. `entityRenderer` 가 플레이어 경로에서만 적용한다. */
export interface HaloAniso {
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** 중심 편심(px, 월드). 전방으로 민다 = 후미가 짧아 보인다. */
  readonly ox: number;
  readonly oy: number;
}

/**
 * 속도·기수 → 헤일로 이방성. 속도 0 에서도 {@link HALO_BASE_STRETCH} 만큼 늘어난 채라
 * 정지 상태에서도 기수를 잃지 않는다(정지야말로 기수를 확인하는 순간이다).
 *
 * @param halfSpan 표시 반치수(px). 편심이 기체 크기에 비례해야 크기가 바뀌어도 안 어긋난다.
 */
export function playerHaloAniso(vx: number, vy: number, facing: number, halfSpan: number): HaloAniso {
  const t = clamp01(Math.hypot(vx, vy) / CRUISE_SPEED);
  const bias = halfSpan * HALO_FORWARD_BIAS * t;
  return {
    rotation: facing,
    scaleX: 1 + HALO_BASE_STRETCH + HALO_SPEED_STRETCH * t,
    scaleY: 1 - HALO_NARROW * t,
    ox: Math.cos(facing) * bias,
    oy: Math.sin(facing) * bias,
  };
}

/**
 * 감산 컨투어가 들어갈 부모 인덱스 = **glowLayer 바로 다음**. 그 이유는 컨투어 헤더의
 * "왜 belowLayer 가 아닌가" 절이 정본이다(high 티어 블룸 필터가 곱연산을 삼킨다).
 *
 * 부모에서 못 찾으면 `-1` — 호출측이 belowLayer 폴백으로 간다.
 */
export function contourInsertIndex(children: readonly unknown[], below: unknown): number {
  const i = children.indexOf(below);
  return i < 0 ? -1 : i + 1;
}

// ---------------------------------------------------------------------------
// 공유 운동 상태 — 두 장식자가 같은 프레임에 속도를 두 번 재계산하지 않게 한다.
// ---------------------------------------------------------------------------

/**
 * 한 프레임의 플레이어 운동 파생값. 두 장식자가 공유하되, **호출 순서에 의존하지 않는다** —
 * `frameTick` 가드로 그 프레임의 첫 호출자가 계산하고 나머지는 읽기만 한다(등록 순서가
 * 바뀌어도 값이 같다).
 */
class PlayerMotion {
  /** 평활 속력(u/s) — 불꽃 길이용. */
  speed = 0;
  /** 평활 전 속력(u/s) — 대시 판정용(평활하면 임펄스 첨두가 뭉개진다). */
  rawSpeed = 0;
  /** 이번 프레임 대시 중인가. */
  dashing = false;
  /** 기수 기준 횡 속도(u/s). */
  lateral = 0;
  private tick = -1;

  update(e: EntitySnapshot, prev: EntitySnapshot, facing: number, ctx: AdornerContext): void {
    if (this.tick === ctx.frameTick) return;
    this.tick = ctx.frameTick;
    const { vx, vy } = snapshotVelocity(e, prev);
    this.rawSpeed = Math.hypot(vx, vy);
    this.dashing = this.rawSpeed >= DASH_SPEED;
    this.lateral = lateralSpeed(vx, vy, facing);
    // 지수 평활(프레임률 무관). dt 가 크면 즉시 수렴하고 작으면 천천히 따라간다.
    const k = 1 - Math.exp(-(ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt) / SPEED_TAU);
    this.speed += (this.rawSpeed - this.speed) * k;
  }
}

// ---------------------------------------------------------------------------
// 1·3·4·6 — 본체 장식자
// ---------------------------------------------------------------------------

/**
 * 기체 **본체**의 2차 운동과 상태 표현: 뱅킹/롤 · 아이들 부유 · 피격 임펄스 · 무적 실드 셸 ·
 * 림라이트.
 *
 * 변환(위치·회전·스케일)은 렌더러가 매 프레임 먼저 확정하고 그 **뒤에** `onFrame` 이 불린다
 * (entityRenderer 엔티티 루프 주석이 정본). 그래서 여기서는 값을 **누적하지 않고** 매 프레임
 * 기준값 위에 다시 얹는다 — 누적하면 몇 초 만에 기체가 화면 밖으로 나간다.
 */
class PlayerBodyAdorner implements EntityAdorner {
  readonly name = 'playerBody';

  private readonly motion: PlayerMotion;
  private sprite: Sprite | null = null;
  /** 생성 시점의 스케일(setSize 결과). 압축은 항상 이 기준에 곱한다. */
  private baseScaleX = 1;
  private baseScaleY = 1;
  /** 표시 반치수(px, **긴 축** = 기수 축). 대부분의 배율 상수의 기준 길이. */
  private halfSpan = 1;
  /**
   * 표시 **횡** 반치수(px, 짧은 축). 판면 스트립은 횡축으로 깔리므로 기준이 다르다 —
   * {@link surfaceLateralHalf} 헤더가 그 이유(5차 CRIT)의 정본이다.
   */
  private lateralHalf = 1;

  private roll = 0;
  private rollVel = 0;
  private bobPhase = 0;
  private clock = 0;

  private kickX = 0;
  private kickY = 0;
  private kickVX = 0;
  private kickVY = 0;
  /** 직전 프레임의 HP. `prev.hp` 가 아니라 **자체 추적**이다 — 이유는 {@link onFrame} 주석. */
  private hp = 0;
  /** 무적 창 시작 이후 경과(초). 창 밖이면 `SHIELD_WINDOW_S` 이상. */
  private sinceHit = Number.POSITIVE_INFINITY;

  private shield: Container | null = null;
  private rim: Sprite | null = null;
  /**
   * 8방향 **감산** 컨투어 복제를 담는 형제 컨테이너(MAJ-3 — 단일 스케일 복제는 dilate 가
   * 아니었다 / 3차 — 가산은 경계를 못 만들었다). belowLayer 가 아니라 그 부모에 붙는다.
   */
  private contour: Container | null = null;
  /** 손상 상태 **감산 그을림** 오버레이(aboveLayer). HP 가 임계 위면 존재 자체가 없다. */
  private damage: Sprite | null = null;
  /** ⑩ 판면 음영 컨테이너(aboveLayer, 실루엣 마스크). 스트립 기하는 한 번 굽고 알파만 흔든다. */
  private surface: Container | null = null;
  private surfaceMask: Sprite | null = null;
  private readonly specStrips: Graphics[] = [];
  private readonly shadeStrips: Graphics[] = [];

  constructor(motion: PlayerMotion) {
    this.motion = motion;
  }

  onAttach(sprite: Sprite, e: EntitySnapshot): void {
    this.sprite = sprite;
    this.baseScaleX = sprite.scale.x;
    this.baseScaleY = sprite.scale.y;
    this.halfSpan = Math.max(sprite.width, sprite.height) / 2 || 1;
    this.lateralHalf = surfaceLateralHalf(sprite.width, sprite.height);
    this.hp = e.hp;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    const dt = ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt;
    this.clock += dt;
    // 렌더러가 이미 얹은 기수 각도. 롤은 이 위에 더한다(기수 결정은 shipFacing 의 몫).
    const facing = sprite.rotation;
    this.motion.update(e, prev, facing, ctx);

    // ── 4. 피격 감지 ────────────────────────────────────────────────────────
    // **`prev.hp` 가 아니라 자체 추적 HP 로** 판정한다. render 는 sim(60Hz)과 분리돼 매 rAF
    // 프레임 불리는데, sim-step 없는 프레임엔 prev/curr 가 그대로여서 `prev.hp > e.hp` 가
    // 같은 피해를 프레임마다 재발화한다(entityRenderer 의 데미지 숫자가 같은 함정을 밟았다 —
    // 리뷰 HIGH-1). 자체 추적은 직전 프레임에 이미 내려가 있어 재발화가 구조적으로 막힌다.
    if (this.hp > e.hp) {
      this.sinceHit = 0;
      const dir = hitImpulseDir(facing, e.id + Math.round(e.hp));
      const mag = this.halfSpan * HIT_KICK;
      this.kickX = dir.dx * mag;
      this.kickY = dir.dy * mag;
      this.kickVX = 0;
      this.kickVY = 0;
    }
    this.hp = e.hp;
    if (this.sinceHit < SHIELD_WINDOW_S) this.sinceHit += dt;

    const motionOn = !reducedMotion(ctx.gates);

    // ── 1. 뱅킹/롤 (감쇠 스프링 = 2차 운동) ────────────────────────────────
    const target = motionOn ? bankTarget(this.motion.lateral) : 0;
    const st = springStep(this.roll, this.rollVel, target, ROLL_STIFFNESS, ROLL_DAMPING, dt);
    this.roll = st.value;
    this.rollVel = st.vel;
    sprite.rotation = facing + this.roll * ROLL_ANGLE;
    // 롤 축은 기체 **길이 방향**이라 눌리는 것은 로컬 y(횡폭)다. 기준 스케일에 곱한다(누적 금지).
    sprite.scale.set(this.baseScaleX, this.baseScaleY * (1 - Math.abs(this.roll) * BANK_SQUASH));

    // ── 6. 아이들 부유 + 4. 피격 임펄스 감쇠 ───────────────────────────────
    let ox = 0;
    let oy = 0;
    if (motionOn) {
      this.bobPhase += dt * BOB_RATE;
      oy += Math.sin(this.bobPhase) * this.halfSpan * BOB_AMPLITUDE * idleness(this.motion.speed);
      const kx = springStep(this.kickX, this.kickVX, 0, HIT_STIFFNESS, HIT_DAMPING, dt);
      const ky = springStep(this.kickY, this.kickVY, 0, HIT_STIFFNESS, HIT_DAMPING, dt);
      this.kickX = kx.value;
      this.kickVX = kx.vel;
      this.kickY = ky.value;
      this.kickVY = ky.vel;
      ox += this.kickX;
      oy += this.kickY;
    } else {
      this.kickX = 0;
      this.kickY = 0;
      this.kickVX = 0;
      this.kickVY = 0;
    }
    sprite.position.set(sprite.x + ox, sprite.y + oy);

    // ── 0. 실루엣 감산 컨투어(8방향 dilate × multiply) ──────────────────────
    // 티어·감소 토글과 무관하게 **항상** 있다. 발광 감소에서도 안 내린다 — 이건 빛이 아니라
    // 그림자라 광과민 축이 아니고, 자기 위치 확보는 장식이 아니라 조작 가능성이다.
    let contour = this.contour;
    if (contour === null) {
      contour = new Container();
      contour.label = 'playerContour';
      for (let i = 0; i < CONTOUR_DIRECTIONS; i++) {
        const copy = new Sprite(sprite.texture);
        copy.anchor.set(0.5);
        // ⚠️ **가산이 아니라 곱연산**이다. 가산 컨투어는 밝은 헤일로 위에서 경계를 못 만들고
        // (2차 실측: 7× 확대 육안 구별 불가), 만들려고 알파를 올리면 CRIT-2 에 걸린다.
        copy.blendMode = 'multiply';
        copy.tint = CONTOUR_COLOR;
        contour.addChild(copy);
      }
      // glowLayer **바로 위**(필터 밖·스프라이트 아래). 이유는 컨투어 헤더 참조 — belowLayer 에
      // 넣으면 high 티어 블룸 필터가 곱연산을 삼켜 화면에서 통째로 사라진다.
      const parent = ctx.belowLayer.parent;
      const at = parent === null ? -1 : contourInsertIndex(parent.children, ctx.belowLayer);
      if (parent !== null && at >= 0) parent.addChildAt(contour, at);
      else ctx.belowLayer.addChild(contour); // 폴백(단위 테스트 등 부모 없는 레이어).
      this.contour = contour;
    }
    // 숨쉬기는 **운동 축**이라 reducedMotion 에서 정확히 0 이 된다(1차부터의 계약).
    const breath = motionOn ? 1 + Math.sin(this.clock * CONTOUR_BREATH_RATE) * CONTOUR_BREATH : 1;
    const band = this.halfSpan * CONTOUR_OFFSET;
    for (let i = 0; i < contour.children.length; i++) {
      const copy = contour.children[i];
      if (!(copy instanceof Sprite)) continue;
      if (copy.texture !== sprite.texture) copy.texture = sprite.texture;
      // 8방향 균등 오프셋 = 진짜 dilate. 앵커 기준 스케일과 달리 **어느 방향에도 같은 폭**의
      // 띠가 생겨 둘레 섹터 결손(MAJ-3 의 1/4 공백)이 구조적으로 불가능하다.
      const a = (i / CONTOUR_DIRECTIONS) * Math.PI * 2;
      copy.position.set(sprite.x + Math.cos(a) * band, sprite.y + Math.sin(a) * band);
      copy.rotation = sprite.rotation;
      // 크기는 본체와 **같다** — 키우지 않는다. 띠는 전적으로 오프셋이 만든다.
      copy.scale.set(sprite.scale.x, sprite.scale.y);
      copy.alpha = CONTOUR_ALPHA * breath;
    }

    // ── 7. 손상 상태(본체 텍스처의 **감산 그을림** 오버레이) ────────────────
    // ⚠️ 3차는 `blendMode:'add'` 였고 화면 델타가 **1.98**(7× 육안 구별 불가)이었다 — 가산
    // 스프라이트는 텍스처 색이 곱으로 들어가 청록 기체에서 R 이 죽는다(§7 헤더가 정본). 곱연산은
    // 그 인자가 대비를 **더 벌리는** 방향이라 같은 알파대에서 광도 하강 33.9 를 만든다.
    // `sprite.tint` 로 밀지 않는 이유는 그대로다 — tint 는 실루엣 전체를 균일하게 어둡게 만들어
    // 위장률을 해친다. 연기·흐림도 금지다(플레이어는 실루엣을 잃으면 조작 불능, §2-2).
    const dmg = damageIntensity(e.hp, e.maxHp);
    if (dmg <= 0) {
      if (this.damage !== null) this.destroyDamage();
    } else {
      let overlay = this.damage;
      if (overlay === null) {
        overlay = new Sprite(sprite.texture);
        overlay.label = 'playerDamage';
        overlay.anchor.set(0.5);
        overlay.blendMode = 'multiply';
        overlay.tint = DAMAGE_SCORCH_COLOR;
        // aboveLayer 다 — 선체 **위**에서 곱해야 하고, belowLayer 는 (a) 본체에 가려지고
        // (b) high 티어에서 블룸 필터가 곱연산을 삼킨다(⓪ 컨투어 헤더가 정본).
        // 실루엣을 덮지만 같은 텍스처·같은 변환이라 실루엣 **모양은 한 픽셀도** 안 바뀐다.
        ctx.aboveLayer.addChild(overlay);
        this.damage = overlay;
      }
      if (overlay.texture !== sprite.texture) overlay.texture = sprite.texture;
      overlay.position.set(sprite.x, sprite.y);
      overlay.rotation = sprite.rotation;
      overlay.scale.set(sprite.scale.x, sprite.scale.y);
      // 맥동은 **위독 구간 + 운동 허용**일 때만. 그 밖에서는 상수 세기(정보는 남고 운동만 꺼진다).
      const pulse =
        motionOn && ctx.tier !== 'low' && isCriticalHp(e.hp, e.maxHp)
          ? 0.5 + 0.5 * Math.sin(this.clock * DAMAGE_PULSE_RATE)
          : 1;
      overlay.alpha = damageAlpha(dmg, pulse, reducedGlow(ctx.gates));
    }

    // ── 10. 판면 방향광 + 스페큘러 스윕 ─────────────────────────────────────
    this.syncSurface(sprite, ctx, motionOn);

    // ── 3. 림라이트 ─────────────────────────────────────────────────────────
    // 테마가 없으면(=담당 배경이 없는 행성) 광원이 없는 것이므로 스스로 꺼진다(계약 §3 광원 일관성).
    if (ctx.theme !== null && !reducedGlow(ctx.gates)) {
      let rim = this.rim;
      if (rim === null) {
        rim = new Sprite(sprite.texture);
        rim.label = 'playerRim';
        rim.anchor.set(0.5);
        rim.blendMode = 'add';
        rim.tint = RIM_COLOR;
        rim.alpha = RIM_ALPHA;
        // 아래 레이어 — 광원 쪽으로 밀린 가산 복제가 **실루엣 밖으로만** 삐져나와 초승달
        // 하이라이트가 된다. 위에 두면 본체를 통째로 밝혀 실루엣이 흐려진다.
        ctx.belowLayer.addChild(rim);
        this.rim = rim;
      }
      if (rim.texture !== sprite.texture) rim.texture = sprite.texture;
      const off = rimOffset(ctx.theme.light, this.halfSpan);
      rim.position.set(sprite.x + off.dx, sprite.y + off.dy);
      rim.rotation = sprite.rotation;
      rim.scale.set(sprite.scale.x, sprite.scale.y);
    } else if (this.rim !== null) {
      this.destroyRim();
    }

    // ── 4. 무적 실드 셸 (깜빡임 금지) ───────────────────────────────────────
    const shell = shieldShell(this.sinceHit);
    if (shell === null) {
      if (this.shield !== null) this.destroyShield();
    } else {
      let shield = this.shield;
      if (shield === null) {
        shield = buildShieldShell();
        ctx.aboveLayer.addChild(shield);
        this.shield = shield;
      }
      const full = shieldGate(ctx.gates, ctx.tier) === 'full';
      shield.position.set(sprite.x, sprite.y);
      shield.scale.set(shell.radius * this.halfSpan);
      // 자전은 "살아 있는 막"의 신호다. 모션 감소·low 티어에서는 정지시킨다(정보는 반지름이 진다).
      shield.rotation = full ? this.clock * SHIELD_SPIN : 0;
      // 발광 감소에서는 알파를 낮추되 0 으로 만들지 않는다 — 무적 여부는 전투 정보다.
      shield.alpha = shell.alpha * (reducedGlow(ctx.gates) ? 0.55 : 1);
    }
  }

  /**
   * ── 10. 판면 방향광 + 스페큘러 스윕 ── 4차 CRIT-3. 상세 근거는 {@link SURFACE_STRIPS} 헤더.
   *
   * 여기서 하는 일은 **알파 {@link SURFACE_STRIPS}×2 개를 다시 정하는 것뿐**이다. 기하는 한 번만
   * 굽고(실드 셸·불꽃과 같은 규율) 마스크 스프라이트만 본체 변환을 미러한다.
   *
   * ⚠️ 마스크가 **필수**다. 스트립은 선체보다 크게 굽혀 있어(마스크가 자를 것을 전제) 마스크가
   * 빠지면 기체 위에 직사각형 띠가 그려진다 — 그건 §2-5 가 금지한 UI 어휘 그 자체다.
   */
  private syncSurface(sprite: Sprite, ctx: AdornerContext, motionOn: boolean): void {
    let surface = this.surface;
    if (surface === null) {
      surface = new Container();
      surface.label = 'playerSurface';
      const mask = new Sprite(sprite.texture);
      mask.anchor.set(0.5);
      this.surfaceMask = mask;
      surface.addChild(mask);
      for (let i = 0; i < SURFACE_STRIPS; i++) {
        const shade = buildSurfaceStrip(i, SURFACE_SHADE_COLOR, 'multiply');
        const spec = buildSurfaceStrip(i, SURFACE_SPEC_COLOR, 'add');
        this.shadeStrips.push(shade);
        this.specStrips.push(spec);
        surface.addChild(shade);
        surface.addChild(spec);
      }
      // 마스크는 자식으로 두고 그대로 `mask` 로 지정한다 — 마스크로 쓰이는 표시객체는 정상
      // 렌더 경로에서 빠지므로 화면에 두 번 그려지지 않는다.
      surface.mask = mask;
      ctx.aboveLayer.addChild(surface);
      this.surface = surface;
    }

    surface.position.set(sprite.x, sprite.y);
    surface.rotation = sprite.rotation;
    const mask = this.surfaceMask;
    if (mask !== null) {
      if (mask.texture !== sprite.texture) mask.texture = sprite.texture;
      // 컨테이너가 이미 회전을 물고 있으므로 마스크는 회전 0 이어야 본체와 겹친다.
      mask.scale.set(sprite.scale.x, sprite.scale.y);
    }

    // 조명 계수: 테마 광원의 **기수 기준 횡 성분** + 롤. `lateralSpeed` 를 광원 단위벡터에 그대로
    // 쓴다 — "기수 기준 횡 성분"이라는 같은 기하 연산이라서다(속도 전용 함수가 아니다).
    const lightLat =
      ctx.theme === null
        ? 0
        : lateralSpeed(lightX(ctx.theme.light), lightY(ctx.theme.light), sprite.rotation);
    // 모션 감소에서는 롤 목표가 0 이라 스윕이 정지하고 **광원 성분만** 남는다(정보는 남고 운동만 꺼진다).
    const roll = motionOn ? this.roll : 0;
    const light = surfaceLight(lightLat, roll);
    const specOn = !reducedGlow(ctx.gates);
    // ⚠️ **비등방 스케일이다.** x(기수 축)는 `halfSpan`, y(횡축·램프가 깔리는 축)는 `lateralHalf` 다.
    // 4차는 둘 다 `halfSpan` 이라 램프가 실루엣 밖에 앉았다(§10 헤더 CRIT).
    const sx = this.halfSpan;
    const sy = this.lateralHalf;
    for (let i = 0; i < SURFACE_STRIPS; i++) {
      const a = surfaceStripAlpha(i, light, specOn);
      const shade = this.shadeStrips[i];
      const spec = this.specStrips[i];
      if (shade !== undefined) {
        shade.alpha = a.shade;
        shade.visible = a.shade > 0;
        shade.scale.set(sx, sy);
      }
      if (spec !== undefined) {
        spec.alpha = a.spec;
        spec.visible = a.spec > 0;
        spec.scale.set(sx, sy);
      }
    }
  }

  dispose(): void {
    this.destroyRim();
    this.destroyShield();
    this.destroyContour();
    this.destroyDamage();
    this.destroySurface();
    // 스프라이트가 살아 있는 경로(리셋 등)에서는 기준 스케일을 되돌린다 — 압축된 채로 남으면
    // 다음 런에서 눌린 기체로 시작한다.
    const s = this.sprite;
    if (s !== null && !s.destroyed) s.scale.set(this.baseScaleX, this.baseScaleY);
    this.sprite = null;
  }

  /** 형제 컨테이너는 부모 `destroy` 로 회수되지 않는다 — 여기서 떼고 파괴한다(계약 §2-3). */
  private destroyRim(): void {
    const rim = this.rim;
    if (rim === null) return;
    this.rim = null;
    rim.parent?.removeChild(rim);
    if (!rim.destroyed) rim.destroy();
  }

  /**
   * ⚠️ 컨투어는 `belowLayer` 가 아니라 **그 부모**에 붙어 있다. `parent?.removeChild` 라
   * 어디에 붙었든 정확히 그 부모에서 떼진다 — 폴백 경로(belowLayer 직결)도 같은 코드로 회수된다.
   */
  private destroyContour(): void {
    const contour = this.contour;
    if (contour === null) return;
    this.contour = null;
    contour.parent?.removeChild(contour);
    if (!contour.destroyed) contour.destroy({ children: true });
  }

  private destroyDamage(): void {
    const dmg = this.damage;
    if (dmg === null) return;
    this.damage = null;
    dmg.parent?.removeChild(dmg);
    if (!dmg.destroyed) dmg.destroy();
  }

  /**
   * ⚠️ **스트립 배열을 비우는 것이 회수의 실질**이다. 컨테이너만 파괴하고 배열을 남기면 다음
   * `syncSurface` 가 `surface === null` 을 보고 새로 굽는데, `push` 가 **파괴된 옛 스트립 뒤에**
   * 쌓여 인덱스 0..4 가 죽은 객체를 가리킨다 — 알파를 그쪽에 써서 화면이 갱신되지 않는다.
   *
   * 마스크 지정은 따로 끊지 않는다: `destroy({children:true})` 가 마스크 스프라이트(자식)와
   * 효과를 함께 회수하고, 컨테이너 자신도 이미 부모에서 떨어져 있어 남는 참조가 없다.
   * (끊는 한 줄을 넣어 봤지만 **어떤 관측으로도 구별되지 않았다** — 뮤테이션이 살아남는 코드는
   * 검증되지 않는 코드이므로 두지 않는다.)
   */
  private destroySurface(): void {
    const surface = this.surface;
    if (surface === null) return;
    this.surface = null;
    this.surfaceMask = null;
    this.specStrips.length = 0;
    this.shadeStrips.length = 0;
    surface.parent?.removeChild(surface);
    if (!surface.destroyed) surface.destroy({ children: true });
  }

  private destroyShield(): void {
    const shield = this.shield;
    if (shield === null) return;
    this.shield = null;
    shield.parent?.removeChild(shield);
    if (!shield.destroyed) shield.destroy({ children: true });
  }
}

/**
 * 판면 스트립 하나를 **단위 치수**로 굽는다(알파는 매 프레임 호출측이 정한다). 기수 축(로컬 x)에
 * 평행한 띠라 기체 길이 방향으로 이어지고, 횡(로컬 y)으로만 밝기가 갈린다.
 *
 * 알파를 `1` 로 굽고 `Graphics.alpha` 로 흔드는 이유: `fill({alpha})` 는 기하에 구워지므로
 * 프레임마다 바꾸려면 **재빌드**가 필요하다(매 프레임 Graphics 재빌드 금지 규율).
 */
function buildSurfaceStrip(i: number, color: number, blend: 'add' | 'multiply'): Graphics {
  const g = new Graphics();
  g.label = blend === 'add' ? 'playerSurfaceSpec' : 'playerSurfaceShade';
  g.blendMode = blend;
  // ⚠️ 띠 구간은 {@link surfaceStripBand} 에서만 온다 — 여기서 다시 계산하면 굽는 기하와 검증하는
  // 기하가 갈라져 "코드는 맞고 화면은 틀렸다"가 또 열린다(§10 헤더의 세 번 재발한 계열).
  const band = surfaceStripBand(i);
  g.rect(-SURFACE_EXTENT, band.lo, SURFACE_EXTENT * 2, band.hi - band.lo).fill({ color, alpha: 1 });
  g.alpha = 0;
  g.visible = false;
  return g;
}

/**
 * 실드 셸을 **단위 반지름 1** 로 굽는다. 이후엔 컨테이너 스케일만 바꾼다 — 매 프레임
 * `Graphics` 를 다시 그리면 프레임 예산에서 가장 비싼 축을 매 프레임 태우게 된다
 * (`buildGroundShadow` 와 같은 규율).
 *
 * 채움이 없고 **획뿐**이라 선체를 한 픽셀도 가리지 않는다.
 */
function buildShieldShell(): Container {
  const c = new Container();
  c.label = 'playerShield';
  c.blendMode = 'add';
  const g = new Graphics();
  // ⚠️ **모든 요소는 반지름 SHIELD_INNER_BAND 이상**에 있어야 한다. 셸은 창 끝에
  // `SHIELD_R_END` 배까지 닫혀 들어오므로, 단위 반지름 r 인 요소의 최종 위치는
  // `r × SHIELD_R_END × 반치수` 다 — 이 곱이 1 미만이면 그 요소는 **선체 위로 올라간다**.
  // 육각 메시를 0.6 에 뒀다가 이 계산을 놓쳐 창 끝에서 몸통을 가로지르고 있었다("획뿐이라
  // 선체를 한 픽셀도 가리지 않는다"는 이 함수 자신의 계약 위반).
  g.circle(0, 0, 1).stroke({ color: SHIELD_COLOR, width: 0.055, alpha: 0.8 });
  // ⚠️ 여기 **두 번째 동심원이 있었다**(반지름 SHIELD_INNER_BAND, 획 0.025). 7× 확대에서 얇은
  // 시안 동심원 2겹이 육각 셀보다 먼저 눈에 들어 계기판으로 읽혔다(4차 MINOR · §2-5 UI 어휘).
  // 지운 뒤에도 **가장 안쪽 요소는 여전히 SHIELD_INNER_BAND 의 육각**이라 선체 불침범 부등식
  // (`SHIELD_INNER_BAND × SHIELD_R_END > 1`)은 그대로 성립한다 — 테스트가 그 부등식을 잠근다.
  // 패싯 셀 — 육각 메시 두 겹(바깥 육각 + 30° 돌린 안쪽 육각). 방사 눈금이 아니라 **셀 경계**라
  // 조준 레티클로 오독되지 않으면서(§2-5 UI 어휘 금지) 색 외 채널은 그대로 남는다(색약 대응).
  const hexagon = (radius: number, phase: number, alpha: number): void => {
    for (let i = 0; i < SHIELD_FACETS; i++) {
      const a0 = phase + (i / SHIELD_FACETS) * Math.PI * 2;
      const a1 = phase + ((i + 1) / SHIELD_FACETS) * Math.PI * 2;
      g.moveTo(Math.cos(a0) * radius, Math.sin(a0) * radius)
        .lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius)
        .stroke({ color: SHIELD_COLOR, width: 0.035, alpha });
    }
  };
  hexagon(0.97, 0, 0.7);
  hexagon(SHIELD_INNER_BAND, Math.PI / SHIELD_FACETS, 0.4);
  c.addChild(g);
  return c;
}

// ---------------------------------------------------------------------------
// 2·5 — 추진 장식자
// ---------------------------------------------------------------------------

/**
 * 엔진 추진 불꽃과 대시 잔상. 둘 다 **belowLayer(가산)** 이고 기수 **반대편**에 있어 본체
 * 실루엣을 침범하지 않는다.
 *
 * 본체 장식자가 위치·회전을 확정한 뒤에 도는 것이 이상적이라 팩토리가 그 순서로 돌려주지만,
 * 순서가 뒤집혀도 한 프레임 지연일 뿐 결함이 아니다(값은 다음 프레임에 따라잡는다).
 */
class PlayerThrustAdorner implements EntityAdorner {
  readonly name = 'playerThrust';

  private readonly motion: PlayerMotion;
  private halfSpan = 1;
  private clock = 0;

  private flame: Container | null = null;
  /** 불꽃 안의 대시 심(색 이동 축). {@link buildThrustFlame} 가 함께 굽고 여기서 알파만 흔든다. */
  private dashCore: Container | null = null;
  /** 대시 열기 [0,1]. 상승 빠름·하강 느림({@link dashHeatStep}). */
  private heat = 0;
  /** 대시 개시 링의 경과(초). 수명 밖이면 `DASH_RING_S` 이상. */
  private ringAge = Number.POSITIVE_INFINITY;
  /** 직전 프레임 대시 여부 — 링은 **상승 에지**에서만 한 번 터진다(매 프레임 재발화 금지). */
  private wasDashing = false;
  private ring: Container | null = null;

  private readonly ghosts: Sprite[] = [];
  private ghostAlpha: number[] = [];
  private ghostCursor = 0;
  private lastGhostTick = -1000;

  constructor(motion: PlayerMotion) {
    this.motion = motion;
  }

  onAttach(sprite: Sprite): void {
    this.halfSpan = Math.max(sprite.width, sprite.height) / 2 || 1;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    const dt = ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt;
    this.clock += dt;
    this.motion.update(e, prev, sprite.rotation, ctx);

    // 대시 열기·링 시계 — **불꽃 게이트 밖**에서 돈다. 발광 감소로 불꽃이 없어도 상태 기계는
    // 계속 흘러야 게이트가 켜지는 순간 값이 튀지 않는다.
    this.heat = reducedMotion(ctx.gates) ? 0 : dashHeatStep(this.heat, this.motion.dashing, dt);
    if (this.motion.dashing && !this.wasDashing) this.ringAge = 0;
    this.wasDashing = this.motion.dashing;
    if (this.ringAge < DASH_RING_S) this.ringAge += dt;

    this.syncFlame(sprite, ctx);
    this.syncDashRing(sprite, ctx);
    this.syncGhosts(sprite, ctx, dt);
  }

  /**
   * ── 2. 엔진 추진 ── 속도 반응형 불꽃. 발광축이라 `halo` 게이트 뒤에 두되, **low 티어에서는
   * 정지 아이들 코어만 남긴다**({@link flameGate} — 4차 MINOR "low 에서 기체가 다시 커서가 된다").
   */
  private syncFlame(sprite: Sprite, ctx: AdornerContext): void {
    const gate = flameGate(ctx.gates, ctx.tier);
    if (gate === 'off') {
      if (this.flame !== null) this.destroyFlame();
      return;
    }
    let flame = this.flame;
    if (flame === null) {
      flame = buildThrustFlame();
      this.dashCore = flame.getChildByLabel('playerDashCore') as Container | null;
      ctx.belowLayer.addChild(flame);
      this.flame = flame;
    }
    // ── 대시 색 이동 ── 길이(아래 extent)만으로는 "불꽃이 길어졌다"로 읽힌다. 채도를 유지한 채
    // 휘도를 올리는 밝은 시안 심이 붙어야 "뜨거워졌다"가 된다(§요구 ②).
    // low 아이들 코어에서는 대시 심을 켜지 않는다(감광 등급의 일부다).
    if (this.dashCore !== null) this.dashCore.alpha = gate === 'idle' ? 0 : this.heat;
    flame.alpha = gate === 'idle' ? FLAME_LOW_ALPHA : 1;
    const f = sprite.rotation;
    // 노즐은 기수 **반대편**. 여기가 본체 실루엣을 침범하지 않는 유일한 자리다.
    flame.position.set(
      sprite.x - Math.cos(f) * this.halfSpan * NOZZLE_BACK,
      sprite.y - Math.sin(f) * this.halfSpan * NOZZLE_BACK,
    );
    flame.rotation = f;
    // low 아이들 코어는 대시 확장도 받지 않는다 — 정지·저속에서 "시동이 걸린 기체"로 읽히게
    // 하는 것이 유일한 목적이고, 확장·요동은 그 목적에 필요하지 않다.
    const extent = thrustExtent(this.motion.speed, gate === 'idle' ? false : this.motion.dashing);
    // ── 6(부수). 엔진 열기 요동 ── 정지 시 최대, 대시 시 최소. 서로 다른 두 각속도의 합이라
    // 눈에 띄는 반복 주기가 생기지 않는다. 결정적(Math.random 없음).
    //
    // ⚠️ `motionOn` 게이트가 여기 **빠져 있었다**(비평가 MAJ-1): 외곽선 숨쉬기·부유는 정확히
    // 0 이 되는데 불꽃 요동만 reducedMotion 에서 0.2% 밖에 안 줄어 광과민 대응이 반쪽이었다.
    // 진폭이 아니라 **위상 전진**을 막아야 완전히 정지한다 — 진폭만 0 으로 두면 되지만, 여기서는
    // heat 자체를 0 으로 만들어 두 요동 항이 동시에 상수 1 이 된다.
    const heat =
      reducedMotion(ctx.gates) || gate === 'idle'
        ? 0
        : HEAT_WOBBLE * (0.35 + 0.65 * idleness(this.motion.speed)) * (this.motion.dashing ? 0.3 : 1);
    const wobbleL = 1 + Math.sin(this.clock * HEAT_RATE_A) * heat;
    const wobbleW = 1 + Math.sin(this.clock * HEAT_RATE_B + 1.7) * heat;
    flame.scale.set(this.halfSpan * extent * wobbleL, this.halfSpan * wobbleW);
  }

  /**
   * ── 2b. 대시 개시 링 ── 대시를 **사건**으로 만드는 두 번째 축(§요구 ②).
   *
   * 상승 에지에서만 한 번 터지고 0.28초에 사라진다. 반지름이 단조 증가하므로 고정 반지름
   * 링(=조준 레티클 어휘, §2-5)과 구조적으로 다르다. 가산 발광 축이라 `reducedGlow`·low 티어
   * 에서 완전히 꺼진다 — 이건 정보가 아니라 연출이다(실드 셸·손상과 다른 판단).
   */
  private syncDashRing(sprite: Sprite, ctx: AdornerContext): void {
    const state =
      reducedGlow(ctx.gates) || reducedMotion(ctx.gates) || ctx.tier === 'low'
        ? null
        : dashRing(this.ringAge);
    if (state === null) {
      if (this.ring !== null) this.destroyRing();
      return;
    }
    let ring = this.ring;
    if (ring === null) {
      ring = buildDashRing();
      ctx.belowLayer.addChild(ring);
      this.ring = ring;
    }
    ring.position.set(sprite.x, sprite.y);
    ring.scale.set(state.radius * this.halfSpan);
    // 획 두께는 단위 원에 구워져 있으므로 스케일에 딸려 커진다 — 얇아지는 몫만 알파로 준다.
    ring.alpha = state.alpha * (state.width / DASH_RING_WIDTH);
  }

  /** ── 5. 대시 잔상 ── 위치 이력 기반 감쇠 고스트. 티어 예산 안에서만. */
  private syncGhosts(sprite: Sprite, ctx: AdornerContext, dt: number): void {
    const budget = ghostBudget(ctx.gates, ctx.tier);
    if (budget === 0) {
      if (this.ghosts.length > 0) this.destroyGhosts();
      return;
    }
    if (this.ghosts.length > budget) this.destroyGhosts(); // 티어 강등 — 예산 초과분을 통째로 회수.

    if (this.motion.dashing && ctx.frameTick - this.lastGhostTick >= GHOST_INTERVAL) {
      this.lastGhostTick = ctx.frameTick;
      let g = this.ghosts[this.ghostCursor];
      if (g === undefined) {
        g = new Sprite(sprite.texture);
        g.label = 'playerGhost';
        g.anchor.set(0.5);
        g.blendMode = 'add';
        g.tint = GHOST_TINT;
        ctx.belowLayer.addChild(g);
        this.ghosts[this.ghostCursor] = g;
        this.ghostAlpha[this.ghostCursor] = 0;
      }
      if (g.texture !== sprite.texture) g.texture = sprite.texture;
      g.position.set(sprite.x, sprite.y);
      g.rotation = sprite.rotation;
      g.scale.set(sprite.scale.x, sprite.scale.y);
      this.ghostAlpha[this.ghostCursor] = GHOST_ALPHA;
      this.ghostCursor = (this.ghostCursor + 1) % budget;
    }

    // 감쇠(프레임률 무관). 다 꺼진 고스트는 alpha 0 으로 남겨 둔다 — 대시가 반복되므로 매번
    // 생성·파괴하면 GC 를 태운다(BulletTrail 풀링과 같은 규율).
    const decay = Math.exp(-dt / GHOST_TAU);
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      if (g === undefined) continue;
      const a = (this.ghostAlpha[i] ?? 0) * decay;
      this.ghostAlpha[i] = a < 0.004 ? 0 : a;
      g.alpha = this.ghostAlpha[i] ?? 0;
      g.visible = g.alpha > 0;
    }
  }

  dispose(): void {
    this.destroyFlame();
    this.destroyRing();
    this.destroyGhosts();
  }

  private destroyFlame(): void {
    const flame = this.flame;
    if (flame === null) return;
    this.flame = null;
    // 심은 불꽃의 **자식**이라 함께 파괴된다 — 참조만 끊는다(끊지 않으면 destroyed 객체를 만진다).
    this.dashCore = null;
    flame.parent?.removeChild(flame);
    if (!flame.destroyed) flame.destroy({ children: true });
  }

  private destroyRing(): void {
    const ring = this.ring;
    if (ring === null) return;
    this.ring = null;
    ring.parent?.removeChild(ring);
    if (!ring.destroyed) ring.destroy({ children: true });
  }

  private destroyGhosts(): void {
    for (const g of this.ghosts) {
      g.parent?.removeChild(g);
      if (!g.destroyed) g.destroy();
    }
    this.ghosts.length = 0;
    this.ghostAlpha = [];
    this.ghostCursor = 0;
  }
}

/**
 * 엔진 불꽃을 **단위 치수**(길이·반폭 1)로 굽는다 — 이후엔 컨테이너 스케일만 바꾼다
 * (매 프레임 `Graphics` 재빌드 금지, 실드 셸과 같은 규율).
 *
 * 기하는 로컬 **-x** 방향으로 뻗는 삼각 화염 3층(외곽→중간→심)이고, 컨테이너 회전이
 * 기수를 따르므로 언제나 기체 뒤로 뻗는다. 노즐은 중앙 1 + 외현 2 의 공통 3구 배치다
 * (기체 타입 7종을 가를 수 없는 이유는 파일 헤더 참조).
 *
 * `generateTexture`(GL 필요) 없이 절차적 `Graphics` 만 쓴다 — node 테스트에서도 자식이 실제로 생긴다.
 */
function buildThrustFlame(): Container {
  const c = new Container();
  c.label = 'playerThrust';
  // 가산 — 불꽃은 자체 발광체다(계약 §3 레인 A ②: "광원과 무관한 자체 발광체").
  c.blendMode = 'add';
  const nozzle = (sx: number, sy: number, scale: number): void => {
    const g = new Graphics();
    const L = THRUST_LENGTH * scale;
    const W = THRUST_HALF_WIDTH * scale;
    // 층은 {@link FLAME_LAYERS} 가 정본이다 — 굽는 쪽과 검증하는 쪽이 같은 데이터를 읽어야
    // "상수는 맞는데 화면은 틀린" CRIT-1 이 재발하지 않는다. 바깥 층일수록 길고 넓다.
    const SHRINK = [1, 0.72, 0.4];
    const NARROW = [1, 0.62, 0.3];
    for (let i = 0; i < FLAME_LAYERS.length; i++) {
      const layer = FLAME_LAYERS[i];
      if (layer === undefined) continue;
      const len = L * (SHRINK[i] ?? 1);
      const half = W * (NARROW[i] ?? 1);
      // 로컬 -x 로 뻗는 삼각 화염. 뒤끝을 살짝 +x 로 물려(0.12) 노즐 입구가 선체에 붙어 보인다.
      g.poly([len * 0.12, -half, -len, 0, len * 0.12, half]).fill({
        color: layer.color,
        alpha: layer.alpha,
      });
    }
    g.position.set(sx, sy);
    c.addChild(g);
  };
  nozzle(0, 0, 1);
  nozzle(0, -NOZZLE_SIDE, NOZZLE_SIDE_SCALE);
  nozzle(0, NOZZLE_SIDE, NOZZLE_SIDE_SCALE);

  // ── 대시 심(색 이동 축) ── 별도 **자식 컨테이너**라 알파 하나로 통째로 페이드된다. 여기에
  // 굽는 이유는 불꽃 스케일(속도·요동)을 그대로 물려받아야 심이 불꽃 밖으로 튀지 않기 때문이다.
  const core = new Container();
  core.label = 'playerDashCore';
  core.alpha = 0; // 대시 전엔 완전 투명 — 존재하지만 화면에 0 기여.
  const coreNozzle = (sy: number, scale: number): void => {
    const g = new Graphics();
    const len = THRUST_LENGTH * scale * DASH_CORE_SHRINK;
    const half = THRUST_HALF_WIDTH * scale * DASH_CORE_NARROW;
    g.poly([len * 0.12, -half, -len, 0, len * 0.12, half]).fill({
      color: DASH_CORE_COLOR,
      alpha: DASH_CORE_ALPHA,
    });
    g.position.set(0, sy);
    core.addChild(g);
  };
  coreNozzle(0, 1);
  coreNozzle(-NOZZLE_SIDE, NOZZLE_SIDE_SCALE);
  coreNozzle(NOZZLE_SIDE, NOZZLE_SIDE_SCALE);
  c.addChild(core);
  return c;
}

/**
 * 대시 개시 링을 **단위 반지름 1** 로 굽는다(실드 셸과 같은 규율 — 매 프레임 재빌드 금지).
 * 채움 없는 획 하나뿐이라 실루엣을 덮지 않고, 반지름이 매 프레임 커지므로 고정 표식이 아니다.
 */
function buildDashRing(): Container {
  const c = new Container();
  c.label = 'playerDashRing';
  c.blendMode = 'add';
  const g = new Graphics();
  g.circle(0, 0, 1).stroke({ color: DASH_RING_COLOR, width: DASH_RING_WIDTH, alpha: 1 });
  c.addChild(g);
  return c;
}

// ---------------------------------------------------------------------------
// 등록
// ---------------------------------------------------------------------------

/**
 * 플레이어 장식자 팩토리. 본체 → 추진 순서로 돌려준다(본체가 확정한 변환을 추진이 읽는다).
 * 두 장식자는 {@link PlayerMotion} 인스턴스를 **엔티티 단위로** 공유한다.
 */
export function playerAdorners(): EntityAdorner[] {
  const motion = new PlayerMotion();
  return [new PlayerBodyAdorner(motion), new PlayerThrustAdorner(motion)];
}

// 모듈 최상위 부수효과 등록(심 계약). 이 모듈을 import 하는 프로덕션 지점이 있어야 등록이
// 일어난다 — 배선 허브는 오케스트레이터가 3레인 산출물을 합칠 때 한 번에 넣는다.
registerAdornerFactory('player', playerAdorners);
