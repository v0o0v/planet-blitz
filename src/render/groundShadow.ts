/**
 * 엔티티 **접지 그림자** — 탑다운에서 공간감을 만드는 유일한 수단.
 *
 * ## 왜 이 모듈이 따로 있는가
 * 카르곤 AAA 배경(PR#192)의 독립 비평은 "지면 위 물체가 지면에 붙어 있다는 증거가 화면에
 * 하나도 없다"를 지적했다. 배경이 아무리 두꺼워져도 엔티티가 그 위에 **떠 있으면** 공간이
 * 두 겹으로 갈린다. 접지 그림자는 그 두 겹을 붙이는 유일한 장치이며, 배경 레인 범위 밖이라
 * 6행성 테마가 전부 들어온 지금이 적기다.
 *
 * ## 그림자 방향은 **테마에서 나온다** (이 파일의 존재 이유)
 * `EnvLightSpec` 은 이미 데칼 레이어와 지형광 레이어가 **공유하는 정본**이고
 * `tests/envLightAgreement.test.ts` 가 코사인 유사도로 둘의 합의를 잠근다. 그림자가 자기
 * 광원을 따로 갖는 순간 **화면에 태양이 둘이 된다** — 이 리포가 실제로 밟았던 함정이라
 * 여기서는 `light` 를 소비만 하고 어떤 방향 상수도 선언하지 않는다.
 *
 * 6행성의 서사가 부호를 가른다: 카르곤·톡사르는 광원이 **아래**(발밑 용암 / 고인 독성
 * 웅덩이)라 그림자가 **위로** 뻗고, 베르단·니플헤임·아르케·크라스는 광원이 **위**라
 * 그림자가 **아래로** 뻗는다. 이 부호는 여기 어디에도 적혀 있지 않다 — 전부
 * `lightX`/`lightY` 에서 파생된다.
 *
 * ## 합성 모드 — 곱연산이고, 그게 가독성에도 맞다
 * 그림자는 "입사광의 차폐"라서 물리적으로 **비례 어둡힘**이다(곱연산). 곱연산의 화면차는
 * `바닥밝기 × α` 라 어두운 바닥에서 절대 변화가 작아지는데, 그 성질이 여기서는 **이득**이다:
 * 어두운 행성(카르곤 22.9 · 톡사르 24.4)일수록 적 실루엣이 그림자에 먹힐 위험이 큰데
 * 곱연산이 스스로 약해진다. 게다가 {@link SHADOW_BIAS_SOFTEN}(편향이 클수록 옅어짐)이
 * 우연이 아니라 구조적으로 보정으로 작동한다 — 바닥이 밝은 행성일수록 `shadowBias` 가
 * 크기 때문이다. 6행성 실측 명도로 계산한 예상 화면차는 6.6~10.0 (1.5배 폭) 안에 들어온다.
 *
 * ## 결정론(ADR-0005)
 * 렌더 전용. `src/sim/` 에서 타입만 가져오고 해시에 기여하지 않는다.
 */

import { Container, Graphics } from 'pixi.js';

import type { EntityKind } from '../sim/entities.js';
import { lightX, lightY, type EnvLightSpec } from './env/theme.js';

// ---------------------------------------------------------------------------
// 상수 — 전부 "표시 크기에 대한 배율"이다(픽셀 하드코딩 금지: 벽부터 젬까지 크기가 3배 넘게
// 갈리므로 절대값은 어느 한쪽에서 반드시 틀린다).
// ---------------------------------------------------------------------------

/** 그림자 타원의 가로 반지름 = 표시 반폭 × 이 값. 1 보다 살짝 작아야 실루엣 밖으로 안 삐져나온다. */
export const SHADOW_FOOTPRINT_SCALE = 0.92;
/**
 * 세로 눌림. 탑다운 접지 그림자는 지면에 눕는 타원이라 세로가 짧다. 1 이면 원이 되어
 * "물체 밑의 검은 원"으로 읽히고 접지감이 사라진다.
 */
export const SHADOW_FLATTEN = 0.72;
/**
 * 오프셋 크기 = 평균 반경 × `shadowBias` × 이 값. 오프셋이 반경을 넘으면 그림자가 실루엣에서
 * 떨어져 나가 "떠 있는 물체 옆의 얼룩"이 된다 — `bias ≤ 1` 이므로 이 값은 1 미만이어야 한다.
 */
export const SHADOW_OFFSET_SCALE = 0.5;
/** 중심 알파 상한. 이보다 크면 어두운 행성에서 적 실루엣이 그림자에 먹힌다(가독성 최우선 규율). */
export const SHADOW_ALPHA_MAX = 0.34;
/**
 * 편향이 클수록 옅어지는 비율. 물리적으로는 "빗겨 드는 빛일수록 반그림자가 넓고 옅다"이고,
 * 화면에서는 바닥이 밝은 행성(= 이 리포에서 `shadowBias` 가 큰 행성)의 그림자를 눌러 준다.
 */
export const SHADOW_BIAS_SOFTEN = 0.28;
/** 부드러운 falloff 를 만드는 동심 타원 개수. 텍스처 없이 절차적으로 굽는다(node 안전). */
export const SHADOW_RING_COUNT = 4;
/** 그림자 색. 순수 검정 대신 아주 살짝 차가운 값 — 용암·불빛 위에서 그을음처럼 읽힌다. */
export const SHADOW_COLOR = 0x05070c;

// ---------------------------------------------------------------------------
// castsGroundShadow — **무엇에 그릴 것인가**
// ---------------------------------------------------------------------------

/**
 * 이 kind 가 접지 그림자를 드리우는가.
 *
 * ## 기준: "지면 위에 부피를 갖고 서 있는 물체"인가
 * 탄·젬·전리품은 화면에서 **신호**다 — sim radius 가 물리 치수가 아니라 판정/트리거 반경이고
 * (`friendlyDisplay.displaySize` 주석이 정본), 표시 크기는 가독성을 위해 임의로 정해진다.
 * 거기에 접지 그림자를 붙이면 그림자가 **거짓말**을 한다: 없는 부피를 주장하고, 수백 개
 * 스프라이트가 한 번에 늘어 비용도 신호 가치도 최악이다. 지면에 눌린 오버레이(`boostPad`)와
 * 비물질 현상(`echo`·`encounterPortal`)도 같은 이유로 제외한다.
 *
 * 반대로 플레이어·적·아군 유닛·구조물은 전부 부피를 가진 실체이고, 그림자가 붙는 순간
 * 배경과 전경이 한 공간으로 붙는다.
 *
 * `hazard` 는 애초에 스프라이트가 없다(오버레이 Graphics).
 */
export function castsGroundShadow(kind: EntityKind): boolean {
  // 아래 목록은 세 묶음이다: ① 전투체(player~spawnedDrone) ② 침공 설비·기물·코어
  // (facilityGun~decoyCore) ③ 구조물·기믹(wall~encounterAltar). 케이스 사이에 주석을 끼우면
  // eslint `no-fallthrough` 가 의도적 폴스루를 못 읽으므로 분류는 여기 한 곳에 적는다.
  switch (kind) {
    case 'player':
    case 'enemy':
    case 'boss':
    case 'defenseBoss':
    case 'guardian':
    case 'formation':
    case 'formationDrone':
    case 'spawnedDrone':
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
    case 'prop':
    case 'core':
    case 'decoyCore':
    case 'wall':
    case 'destructible':
    case 'supply':
    case 'magnetEmitter':
    case 'bombDevice':
    case 'turretPickup':
    case 'shelter':
    case 'encounterAltar':
      return true;
    // 신호(탄·젬·전리품) · 지면 오버레이 · 비물질 현상 — 위 주석이 근거다.
    case 'bullet':
    case 'enemyBullet':
    case 'gem':
    case 'loot':
    case 'hazard':
    case 'boostPad':
    case 'echo':
    case 'encounterPortal':
      return false;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// groundShadowGeometry — 테마 `light` → 타원 반지름·오프셋·알파 (순수 함수)
// ---------------------------------------------------------------------------

/** 그림자 하나의 기하. 전부 표시 크기와 테마 `light` 의 함수다(저장 상태 없음). */
export interface GroundShadowGeometry {
  /** 타원 가로 반지름(px). */
  readonly rx: number;
  /** 타원 세로 반지름(px). */
  readonly ry: number;
  /** 엔티티 중심 기준 그림자 중심의 x 오프셋(px). **광원 반대쪽**이다. */
  readonly dx: number;
  /** 엔티티 중심 기준 그림자 중심의 y 오프셋(px). **광원 반대쪽**이다. */
  readonly dy: number;
  /** 중심 알파(0..1). 동심 타원 누적으로 이 값에 수렴한다. */
  readonly alpha: number;
}

/**
 * 테마 광원과 표시 반치수에서 그림자 기하를 구한다. **부호는 여기서 나오지 않는다** —
 * `lightX`/`lightY` 의 부호가 그대로 뒤집혀 전달될 뿐이다(광원 반대쪽 = `-light`).
 *
 * @param light 테마의 공유 광원 정본(`EnvTheme.light`).
 * @param halfW 스프라이트 표시 반폭(px). 벽처럼 비정방인 실체도 있으므로 x·y 를 따로 받는다.
 * @param halfH 스프라이트 표시 반높이(px).
 */
export function groundShadowGeometry(
  light: EnvLightSpec,
  halfW: number,
  halfH: number,
): GroundShadowGeometry {
  // 방어: 0/음수 치수는 도형이 안 그려져 "자식은 있는데 bounds 0" 이 된다(buildGlowHalo 선례).
  const hw = halfW > 0 ? halfW : 0.001;
  const hh = halfH > 0 ? halfH : 0.001;
  const bias = light.shadowBias < 0 ? 0 : light.shadowBias > 1 ? 1 : light.shadowBias;
  // 오프셋 기준 길이는 **평균 반경** — 벽처럼 비정방이어도 한쪽 축에 끌려가지 않는다.
  const ref = (hw + hh) / 2;
  const mag = ref * bias * SHADOW_OFFSET_SCALE;
  return {
    rx: hw * SHADOW_FOOTPRINT_SCALE,
    ry: hh * SHADOW_FOOTPRINT_SCALE * SHADOW_FLATTEN,
    // 광원을 향하는 단위 벡터의 **반대** — 부호는 전적으로 테마 `angle` 이 정한다.
    dx: -lightX(light) * mag,
    dy: -lightY(light) * mag,
    alpha: SHADOW_ALPHA_MAX * (1 - SHADOW_BIAS_SOFTEN * bias),
  };
}

// ---------------------------------------------------------------------------
// buildGroundShadow — 동심 타원 falloff (절차적·node 안전, buildGlowHalo 동형)
// ---------------------------------------------------------------------------

/**
 * 그림자 하나를 만든다. 텍스처를 굽지 않고 {@link Graphics} 동심 타원으로 falloff 를 만든다
 * (`buildGlowHalo` 와 같은 관용구 — renderer 없이도 돌아 node 테스트가 그대로 통과한다).
 *
 * **매 프레임 다시 그리지 않는다.** 엔티티당 한 번 굽고 이후에는 위치만 옮긴다 — 화면에
 * 엔티티가 많고, `Graphics` 재빌드는 프레임 예산에서 가장 비싼 축이다.
 *
 * 링 알파는 누적이 `alpha` 에 수렴하도록 역산한다: `1-(1-p)^N = alpha`.
 */
export function buildGroundShadow(rx: number, ry: number, alpha: number): Container {
  const c = new Container();
  // 곱연산 — 그림자는 빛의 차폐다. 컨테이너 단위로 걸어 겹친 그림자가 이중으로 어두워지지 않게
  // 한다(glowLayer 의 가산 설정과 동형 규율).
  c.blendMode = 'multiply';
  const maxX = rx > 0 ? rx : 0.001;
  const maxY = ry > 0 ? ry : 0.001;
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  const perRing = 1 - Math.pow(1 - a, 1 / SHADOW_RING_COUNT);
  const g = new Graphics();
  // 큰 타원부터 깔고 작은 타원을 위에 겹친다 → 중심이 진하고 가장자리로 부드럽게 옅어진다.
  for (let i = SHADOW_RING_COUNT; i >= 1; i--) {
    const t = i / SHADOW_RING_COUNT;
    g.ellipse(0, 0, maxX * t, maxY * t).fill({ color: SHADOW_COLOR, alpha: perRing });
  }
  c.addChild(g);
  return c;
}
