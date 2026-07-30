/**
 * 플레이어 기체 3D 액터 — **조종 상태를 자세로 번역**한다. 보스({@link file://./bossActor.ts})와
 * 같은 무대·같은 아틀라스를 쓰지만, 상태의 성질이 달라서 연출 구조가 정반대다.
 *
 * ── 보스와 무엇이 다른가 ──
 *
 * **① 요(yaw)는 여기 없다.** 기체의 기수 방향은 `entityRenderer` 의 `shipFacing()` 이 최근접 표적
 * 조준으로 계산해 **Pixi 스프라이트 회전**에 넣는다. 그래서 3D 는 모델을 **정면 고정**으로 그리고
 * 뱅크(roll)·피치·대시·피격만 저작한다. 여기서 yaw 를 또 돌리면 **이중 회전**이 되고, 조준선과
 * 기수가 어긋나 탄이 어디로 나가는지 읽을 수 없게 된다 — 이 게임에서 가장 비싼 종류의 결함이다.
 *
 * **② 상태가 열거형이 아니라 연속값이다.** 보스는 phase 0/1/2 라 모션 함수를 셋으로 갈랐지만,
 * 기체는 선회율·속도·가속이 전부 연속이다. 그래서 "상태별 모션 함수"가 아니라 **축마다 하나의
 * 연속 전달함수**를 둔다. 대신 보스에서 얻은 규율은 그대로다 — **축과 파형을 갈라라**:
 *
 *   | 축 | 입력 | 파형 |
 *   |---|---|---|
 *   | **롤**(기수 축 회전) | 선회율 | 감쇠 스프링(오버슈트 = 2차 운동) |
 *   | **피치**(횡축 회전) | 가·감속 + 아이들 호흡 | 1차 평활 + 느린 사인 |
 *   | **발광·신축** | 대시 | 빠른 어택 / 느린 릴리스 포락선 |
 *   | **위치 지터** | 피격 | 비정수비 고주파 감쇠 |
 *
 * 넷이 서로 다른 축·다른 파형이라 동시에 일어나도 무엇이 일어났는지 각각 읽힌다. 진폭만 다른
 * 구조로 만들면 "같은 동작을 세게 한 것"으로만 읽힌다(보스에서 실제로 그랬고 사용자가 지적했다).
 *
 * **③ 기체는 100% 상주한다.** 보스는 보스 세그먼트에서만 떴지만 기체는 런 내내 화면에 있다 —
 * 아틀라스 업로드 듀티가 그만큼 는다. 슬롯은 여전히 1칸이면 된다(런 중 기체는 안 바뀐다).
 *
 * ── 2D 와의 배타 처리 ──
 * `render/entity/playerVisual.ts` 의 AAA 장식자 중 **뱅킹/롤 변환**과 **판면 방향광(⑩)** 은 이
 * 액터와 같은 일을 한다(전자는 축이 겹쳐 이중이 되고, 후자는 납작한 스프라이트에 음영을 흉내내는
 * 항목이라 실제 3D 조명이 있으면 존재 이유가 없다). 둘은 `AdornerContext.ship3d` 로 꺼진다.
 * 나머지(컨투어·불꽃·잔상·실드·손상 그을림·부유)는 3D 와 직교라 그대로 살아 있다.
 *
 * ── 결정론(ADR-0005) ── render-only. 스냅샷 파생값을 읽기만 하고 sim 에 쓰지 않는다(골든 해시 불변).
 * 시간축도 sim 틱이 아니라 벽시계(연출 전용)다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SLOT_SIZE, type Stage3D } from './stage3d.js';
import {
  buildOutlineShell,
  collectEmissive,
  disposeSubtree,
  fitOrthoToObject,
  modelUrl,
  normalizeModel,
} from './framing.js';

/**
 * 렌더러가 넘기는 기체 연출 상태 — 전부 **스냅샷 파생**이다.
 *
 * 선회율·가속도를 여기 담지 **않는** 것은 의도적이다: 그것들은 프레임 간 차분이라 `dt` 가 필요한데,
 * `dt` 는 이 액터가 이미 받는다. 공유 파일(`entityRenderer`)에 미분을 두면 렌더 프레임률·상한 같은
 * 연출 전용 규칙이 그쪽으로 새어 나간다.
 */
export interface ShipVisualState {
  /** 기수 각도(rad) — 스프라이트에 이미 적용된 `shipFacing()` 값. 액터는 이걸 **미분해서만** 쓴다. */
  facing: number;
  /** 속력(u/s). `snapshotVelocity` 파생. */
  speed: number;
  /** 대시 중. `isDashSpeed` 파생 — 렌더러의 화면 흔들림과 **같은 판정**이라 같은 프레임에 붙는다. */
  dashing: boolean;
  /** 이번 프레임 피격(상승 에지). */
  hit: boolean;
}

/** 한 프레임의 자세 + 발광. 모든 축이 이 한 구조로 수렴해야 서로를 모르는 채 합성된다. */
interface Attitude {
  /** 기수 축(로컬 X) 회전 = 뱅크. */
  roll: number;
  /** 횡축(로컬 Z) 회전 = 피치. 양수 = 기수를 든다. */
  pitch: number;
  /** 기수 방향 신축(1 = 원래). */
  stretch: number;
  /** 횡·상하 신축(1 = 원래). */
  girth: number;
  /** 좌우 지터(프러스텀 반폭 배수). */
  jitterX: number;
  /** 상하 지터(프러스텀 반폭 배수). */
  jitterY: number;
  /** 발광 세기. */
  emissive: number;
}

/** 초 → 라디안(주파수 Hz 의 사인파 위상). */
function osc(t: number, hz: number): number {
  return Math.sin(t * hz * Math.PI * 2);
}

/** 각도 차를 [-π, π] 로 정규화. 기수가 ±π 를 넘나들 때 선회율이 폭발하는 것을 막는다. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 반음함 오일러 감쇠 스프링 1스텝. `playerVisual` 의 롤 스프링과 **같은 형태**다 — 2D 뱅킹이
 * 3D 로 옮겨온 것이므로 반응 특성이 달라지면 조작감이 바뀐다.
 */
export function springStep(
  value: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): { value: number; vel: number } {
  const v = vel + (-(value - target) * stiffness - vel * damping) * dt;
  return { value: value + v * dt, vel: v };
}

// ---------------------------------------------------------------------------
// 튜닝 상수 — 전부 placeholder(defer-balance-tuning). 길이 단위는 **프러스텀 반폭**이라
// 프레이밍을 바꿔도 연출의 화면상 크기가 변하지 않는다.
// ---------------------------------------------------------------------------

/**
 * 뱅크가 최대에 닿는 선회율(rad/s). `shipFacing` 은 표적이 바뀌면 한 프레임에 크게 튈 수 있어서
 * 이 값으로 정규화 + 클램프한다 — 안 하면 표적 전환마다 기체가 뒤집힌다.
 */
const TURN_RATE_FULL = 4.5;
/** 최대 뱅크 각(rad, ≈34°). 더 키우면 탑다운에서 실루엣이 옆면으로 눕어 기수가 안 읽힌다. */
const MAX_BANK = 0.6;
/**
 * 뱅크 스프링 강성·감쇠. 감쇠는 임계(`2√k ≈ 21.9`)보다 **낮다** — 오버슈트가 있어야 "체중이
 * 실렸다가 돌아오는" 2차 운동으로 읽힌다(임계감쇠면 그냥 지연된 1차 운동이라 뻣뻣하다).
 * `playerVisual.ROLL_STIFFNESS/ROLL_DAMPING` 과 같은 값이다.
 */
const BANK_STIFFNESS = 120;
const BANK_DAMPING = 10;
/**
 * 뱅크 부호. 화면에서 **선회 안쪽 날개가 내려가야** 한다(안쪽으로 기울며 도는 자세).
 *
 * 자명하지 않아서 기하로 유도했고 뷰어에서 확인했다. 카메라는 `(0, d·sin62°, d·cos62°)` 에서
 * 원점을 보므로 화면 위 방향이 대략 `(0, 0.47, −0.88)` 이다 → **+Z 가 화면 아래**다. 로컬 X 축
 * 양의 회전은 `(0,0,r) → (0, −r·sinθ, r·cosθ)` 라 **+Z 쪽(화면 아래) 날개를 내린다**. 한편 Pixi 의
 * 양의 회전은 화면에서 시계방향이므로 `facing` 증가 = 화면 아래쪽으로 도는 선회이고, 그 안쪽이
 * 곧 화면 아래다. 둘이 같은 부호이므로 **+1**.
 */
const BANK_SIGN = 1;

/** 순항 기준 속도(u/s). sim 기본 `playerSpeed`(720)에 파워업 여유를 얹은 렌더측 기준선이다. */
const CRUISE_SPEED = 900;
/** 가속도가 최대 피치에 닿는 값(u/s²). 대시 임펄스는 이보다 훨씬 크므로 클램프가 상시 작동한다. */
const ACCEL_FULL = 2600;
/** 가·감속 피치 최대 각(rad, ≈11°). 가속 시 기수를 숙이고 감속 시 든다. */
const PITCH_ACCEL = 0.2;
/** 가속도 평활 시간상수(초). 스냅샷 차분은 거칠어서 평활 없이는 피치가 떤다. */
const ACCEL_TAU = 0.1;

/**
 * 아이들 호흡 — 정지 상태에서 기체가 **살아 있게** 하는 유일한 3D 축.
 *
 * 2D 장식자에도 부유(`BOB_AMPLITUDE`)가 있지만 그건 **스프라이트 전체를 화면에서 위아래로 옮기는
 * 것**이라 3D 자세는 한 톨도 안 변한다. 여기 호흡은 **모델이 기수를 들었다 놓는** 것이라 음영과
 * 실루엣이 실제로 바뀐다 — 둘은 같은 축이 아니고, 함께 있으면 "떠 있으면서 숨 쉬는" 것이 된다.
 * 가·감속 피치와 같은 축을 쓰지만 파형이 다르고(느린 사인 vs 평활 계단) 속도로 배타 페이드되므로
 * 화면에서 겹치지 않는다.
 */
const BREATH_PITCH = 0.05;
const BREATH_HZ = 0.42;
/** 이 속도(u/s) 이상에서 호흡이 완전히 꺼진다. 그 아래는 선형으로 살아난다. */
const IDLE_SPEED_CUTOFF = 160;

/**
 * 대시 열기 포락선의 어택·릴리스 시간상수(초). **어택이 훨씬 빨라야 사건으로 읽힌다** —
 * 느리게 붙으면 그냥 밝아지는 것이다. `playerVisual` 의 대시 심 포락선과 같은 값이라 3D 발광과
 * 2D 불꽃 코어가 **같은 곡선으로** 달아오른다.
 */
const DASH_ATTACK = 0.02;
const DASH_RELEASE = 0.16;
/**
 * 대시 첨두의 기수 방향 늘임·횡 수축. 스쿼시-스트레치 = 속도감.
 *
 * ⚠️ **두 값은 비대칭이어야 한다.** 프레이밍이 타이트해서(`FRAME_MARGIN` 1.06) 기수 축 여유는
 * 한쪽 약 5px 뿐인데 기수 반경이 약 75px 이라, 늘임 0.16 은 첨두에서 기수를 슬롯 밖으로 밀어낸다
 * (실측: 테두리 접촉 **25px** — 다른 모든 장면은 0). 늘임은 그 여유에 맞춰 묶고, 대신 **수축을
 * 키운다** — 수축은 실루엣을 안쪽으로 당기므로 아무리 키워도 잘리지 않고, 스쿼시-스트레치의 체감은
 * 두 축의 **비율**에서 오기 때문에 비율(1.045 / 0.86 ≈ 1.22)은 오히려 원안(1.16/0.91 ≈ 1.27)에
 * 거의 맞먹는다.
 *
 * 늘임 실측 계단: 0.16 → 25px · 0.06 → 6px · **0.045 → 0px**(전 장면 0).
 */
const DASH_STRETCH = 0.045;
const DASH_GIRTH = 0.14;
/** 대시 첨두의 기수 숙임(rad). 가속 피치와 같은 축이지만 포락선이 달라 따로 읽힌다. */
const DASH_PITCH = 0.26;
/** 대시 첨두의 추가 발광. 엔진이 달아오르는 양이다. */
const DASH_EMISSIVE = 1.35;

/** 피격 셰이크 길이(초). 짧아야 "충격"이지 "고장"이 아니다. */
const HIT_SHAKE_S = 0.22;
/** 피격 지터 진폭(프러스텀 반폭 배수). 슬롯 여유 안에 들어가야 실루엣이 안 잘린다. */
const HIT_JITTER = 0.046;
/** 피격 롤 지터 진폭(rad). 위치 지터와 **다른 주파수**라 둘이 한 덩어리로 안 뭉친다. */
const HIT_ROLL = 0.22;

/**
 * 평시 발광 세기.
 *
 * ⚠️ 보스의 평시값(0.5)을 그대로 쓰면 **선체가 네온처럼 통째로 발광한다**(뷰어 실측). 보스는
 * 용암 균열이 달아오르는 것이 정체성이라 그 값이 맞지만, 기체는 **조명 받는 금속**으로 읽혀야
 * 한다 — 스스로 빛나면 (a) 청록 선체가 아군 탄·시안 이펙트와 같은 밝기대로 올라가 탄막에서
 * 서로 섞이고 (b) 판면 음영이 발광에 씻겨 3D 로 바꾼 이유(입체감)가 사라진다. 발광은 **대시에서
 * 올라가는 여유분**으로 남겨 둔다(그래야 대시가 사건이 된다).
 */
const BASE_EMISSIVE = 0.1;

/**
 * 아웃라인 셸 굵기(모델 최대 치수 배율)와 색({@link buildOutlineShell}).
 *
 * 이 게임의 스프라이트는 전부 어두운 외곽선을 가진 픽셀아트다. 3D 렌더에는 그 선이 없어서 같은
 * 텍셀 밀도로 그려도 나란히 두면 물러 보인다 — 없는 것은 해상도가 아니라 **경계선**이다.
 *
 * 색은 순흑이 아니라 아주 어두운 청색이다. 2D 감산 컨투어(`playerVisual` `CONTOUR_COLOR`)와 같은
 * 규율 — R 을 더 깎아 차갑게 기울이면 "만화적 아웃라인"이 아니라 **그림자**로 읽힌다. 두 표현이
 * 같은 계열이라 3D 선과 2D 컨투어가 한 겹처럼 이어진다.
 */
const OUTLINE_THICKNESS = 0.035;
const OUTLINE_COLOR = 0x07121f;

/** 카메라 틸트(수평에서의 각도). 보스와 **같은 값**이어야 둘이 한 세계에 있는 것으로 읽힌다. */
const CAMERA_TILT_RAD = (62 * Math.PI) / 180;

/**
 * 프러스텀 여유(1 = 실루엣에 딱 맞춤).
 *
 * 보스(1.10)보다 **타이트하다**. 보스의 전환 연출은 도약·스핀으로 실루엣을 크게 밀어내지만, 기체의
 * 연출은 **회전과 미세 지터뿐**이라 투영 실루엣이 거의 안 커지기 때문이다. 여유를 키우면 그만큼
 * 기체가 화면에서 작아지는데, 기체는 런 내내 봐야 하는 대상이라 존재감 손실이 보스보다 비싸다.
 *
 * ⚠️ "슬롯에 여백을 주고 스프라이트 크기로 보상"은 **원리상 불가능**하다 — 화면 크기를 유지한다는
 * 것은 모델 대 표시영역 비율을 유지한다는 뜻이고, 그러면 잘림 비율도 그대로다. 클리어런스와
 * 존재감은 맞바꿀 수밖에 없다.
 */
const FRAME_MARGIN = 1.06;

/** 한 기체 타입의 3D 정의. `null` 슬롯은 모델 미제작 = 기존 PNG 스프라이트 유지. */
interface ShipModelDef {
  /** `assets/models/` 안의 GLB 파일명. */
  file: string;
  /**
   * 엔진 점광 색. 모델 자체의 발광은 베이스컬러를 emissiveMap 으로 재사용하므로 **선체가 자기
   * 색으로** 달아오른다 — 이 점광은 그 발광이 모델 밖 주변 면까지 번지는 색만 정한다. 텍스처의
   * 지배색과 같은 계열이어야 실루엣 테두리가 안 탁해진다.
   */
  engineLight: number;
  /**
   * 모델 고유 자세 보정(Euler XYZ, rad) — Meshy 출력의 축을 게임 규약(**기수 +X · 위 +Y**)으로
   * 돌린다. 생성된 모델마다 다르므로 **눈으로 확인해서** 정한다(`/ship3d.html` 뷰어).
   * 이 보정은 정규화 그룹 **안쪽**에 걸리므로 액터의 연출 회전과 섞이지 않는다.
   */
  orient?: readonly [number, number, number];
}

/**
 * 기체 typeId → 3D 모델. 순서는 `src/render/textures.ts` 의 `shipSpriteName` 과 **같은 계약**이다
 * (0 스트라이커 … 6). 모델이 없는 타입은 `null` 이고, 그 경우 액터가 아예 만들어지지 않아 기존
 * 2단 PNG 폴백(`ship_<slug>.png` → `player.png` → 절차적)이 조용히 그대로 쓰인다.
 */
const SHIP_MODELS: readonly (ShipModelDef | null)[] = [
  // 0 스트라이커 — 청록 인터셉터. 기존 `player.png` 의 실루엣·색을 3D 로 옮긴 것이다.
  // 자세 보정 = Y축 180°: Meshy 출력이 **기수를 −X 로** 뽑았다(뷰어 실측). 게임 규약은 +X 라
  // (`textures.ts` 의 "기수 +X 방향") 여기서 한 번 돌린다 — 안 돌리면 기체가 뒤로 날아간다.
  { file: 'ship_striker.glb', engineLight: 0x39d0ff, orient: [0, Math.PI, 0] },
  null, // 1 arccaster  — TODO(3D): 스트라이커 승인 후 착수.
  null, // 2 bruiser
  null, // 3 bubble
  null, // 4 hatchling
  null, // 5 mallow
  null, // 6 phantom
];

/**
 * 이 기체 타입에 3D 모델이 있는가. 호출자가 **WebGL 컨텍스트를 만들기 전에** 물어보는 용도다 —
 * 모델 없는 타입에서 무대를 세우면 아무 이득 없이 컨텍스트 하나를 점유한다.
 */
export function hasShipModel(typeId: number): boolean {
  return (SHIP_MODELS[typeId] ?? null) !== null;
}

/**
 * 플레이어 기체 3D 액터. `load()` 가 성공한 뒤에만 무대에 mount 되고, 그 전까지 호출자는 기존
 * PNG 스프라이트를 계속 쓴다(로딩이 기체를 화면에서 지우지 않는다 — 기체는 조작 대상이라
 * 한 프레임이라도 사라지면 안 된다).
 */
export class ShipActor {
  private readonly stage: Stage3D;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  /** 모델을 담는 피벗 — 연출 트랜스폼은 전부 여기에 건다(모델 원본·자세 보정은 안 건드린다). */
  private readonly pivot = new THREE.Group();
  private readonly emissiveMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly engineLight: THREE.PointLight;
  private ready = false;

  /** 이동 연출의 길이 단위 = 프러스텀 반폭({@link fitOrthoToObject} 반환값). */
  private unit = 1;
  /** 연출 시계(초). 벽시계 누적 — sim 틱과 무관하다. */
  private clock = 0;

  /** 뱅크 스프링 상태. */
  private roll = 0;
  private rollVel = 0;
  /** 직전 프레임 기수(rad). 선회율의 유일한 근원이다. `null` = 아직 미분할 수 없음(첫 프레임). */
  private prevFacing: number | null = null;
  /** 평활된 가속도(u/s²)와 직전 속력. */
  private accel = 0;
  private prevSpeed = 0;
  /** 대시 열기 포락선 [0,1]. */
  private dashHeat = 0;
  /** 피격 셰이크 잔여(초). */
  private shakeLeft = 0;

  constructor(stage: Stage3D) {
    this.stage = stage;

    // 직교 카메라 — 탑다운 게임의 원근 없는 프레이밍(스프라이트와 같은 규율).
    // 프러스텀은 임시값이고, 모델 로드 후 {@link fitOrthoToObject} 가 투영 실측으로 다시 잡는다.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    const d = 6;
    this.camera.position.set(0, d * Math.sin(CAMERA_TILT_RAD), d * Math.cos(CAMERA_TILT_RAD));
    this.camera.lookAt(0, 0, 0);

    // 조명: 위에서 내리는 키 + 차가운 림 + 엔진 점광(뒤에서 앞으로 비춘다).
    // 보스와 같은 구성이라 두 모델이 한 광원 아래 있는 것으로 읽힌다.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
    key.position.set(0.6, 1.6, 0.9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-1, 0.4, -1);
    this.scene.add(rim);
    // 엔진은 기수(+X) 반대편이다 — 점광을 뒤에 둬야 대시 발광이 노즐 쪽에서 번진다.
    this.engineLight = new THREE.PointLight(0x39d0ff, 2.2, 4, 2);
    this.engineLight.position.set(-0.45, 0, 0.1);
    this.scene.add(this.engineLight);

    this.scene.add(this.pivot);
  }

  /** 모델이 준비되어 3D 텍스처를 써도 되는가. false 면 호출자는 2D 폴백. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * 기체의 GLB 를 읽어 정규화(중심 정렬 + 최대 치수 1 + 자세 보정)하고 무대에 mount 한다.
   * 모델이 없는 타입이거나 파싱에 실패하면 조용히 false — 2D 스프라이트가 그대로 남는다.
   *
   * @param typeId 기체 타입(0 스트라이커 …). {@link SHIP_MODELS} 참조.
   */
  async load(typeId: number): Promise<boolean> {
    const def = SHIP_MODELS[typeId] ?? null;
    if (def === null) return false;
    const url = await modelUrl(def.file);
    if (url === undefined) return false;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      const orient =
        def.orient === undefined
          ? undefined
          : new THREE.Euler(def.orient[0], def.orient[1], def.orient[2]);
      const norm = normalizeModel(root, orient);
      // ⚠️ 아웃라인 셸을 **본체보다 먼저** 넣는다. 뒷면만 그리므로 순서가 화면을 바꾸지는 않지만,
      // 셸은 정규화가 끝난 `norm` 에서 복제해야 자세 보정·스케일이 그대로 따라온다.
      this.pivot.add(buildOutlineShell(norm, OUTLINE_THICKNESS, OUTLINE_COLOR));
      this.pivot.add(norm);
      // 발광은 **본체에만** 건다 — 셸은 조명을 안 받는 `MeshBasicMaterial` 이라 대상이 아니다.
      for (const m of collectEmissive(root, BASE_EMISSIVE)) this.emissiveMaterials.push(m);
      this.engineLight.color.setHex(def.engineLight);
      this.unit = fitOrthoToObject(this.camera, this.pivot, FRAME_MARGIN);
      this.stage.mount('player', this.scene, this.camera);
      this.ready = true;
      return true;
    } catch {
      return false; // 손상된 자산이 게임을 막지 않는다.
    }
  }

  /**
   * 모델과 그 GPU 자원을 회수한다. **기체가 바뀌면(다음 런) 반드시 불러야 한다** — three 의
   * geometry/material/texture 는 GC 대상이 아니라 명시 `dispose()` 로만 GPU 에서 내려간다.
   *
   * 무대(WebGL 컨텍스트)는 건드리지 않는다 — 호출자가 액터보다 오래 쥐고 재사용한다.
   */
  dispose(): void {
    this.ready = false;
    this.stage.unmount('player');
    disposeSubtree(this.pivot);
    this.pivot.clear();
    this.emissiveMaterials.length = 0;
    this.resetMotion();
  }

  /**
   * 누적 연출 상태(스프링·포락선·시계)를 초기값으로 되돌린다. 모델은 그대로 둔다.
   *
   * 뷰어(`/ship3d.html`)가 **한 액터로 여러 대본을 이어 재생**할 때 필요하다 — 대본 사이에
   * 상태가 새면 앞 대본의 뱅크·열기가 다음 칸에 묻어난다. 모델을 다시 로드하는 것으로 대신할
   * 수는 없었다: 로드/해제를 반복하면 헤드리스 Chrome 의 GPU 프로세스가 죽어(`GPU state invalid
   * after WaitForGetOffsetInRange`) 뒤쪽 칸이 통째로 검게 찍힌다(실측).
   */
  resetMotion(): void {
    this.clock = 0;
    this.prevFacing = null;
    this.roll = 0;
    this.rollVel = 0;
    this.accel = 0;
    this.prevSpeed = 0;
    this.dashHeat = 0;
    this.shakeLeft = 0;
  }

  /**
   * 슬롯 실루엣이 테두리까지 남긴 여유(프러스텀 반폭 단위). 로드 직후 한 번 재서 진단·문서에 쓴다.
   * 빈 슬롯이면 null. 연출 진폭 자동 보정에는 쓰지 않는다 — 기체의 연출은 회전 위주라 실루엣이
   * 거의 안 커지고, 보스의 `roomScale` 같은 보정이 필요한 넘침이 구조적으로 생기지 않는다.
   */
  measureHeadroom(): { up: number; down: number; left: number; right: number } | null {
    return this.stage.measureSlotHeadroom('player');
  }

  /**
   * 한 프레임 갱신. 호출자는 기체가 화면에 있을 때(=런 중) 매 프레임 부른다.
   *
   * @param dt 경과 시간(초, 상한 적용된 값).
   * @param s  이번 프레임의 기체 연출 상태.
   */
  update(dt: number, s: ShipVisualState): void {
    if (!this.ready) return;
    this.clock += dt;
    const t = this.clock;

    // ── 롤 ── 선회율 → 뱅크. 스프링이라 방향 전환에 반 박자 늦게 따라붙고 한 번 오버슈트한다.
    // 첫 프레임에는 미분할 이전 값이 없으므로 선회율 0(기체가 뒤집힌 채로 등장하지 않는다).
    const turnRate =
      this.prevFacing === null ? 0 : angleDelta(s.facing, this.prevFacing) / Math.max(dt, 1e-4);
    this.prevFacing = s.facing;
    const norm = Math.max(-1, Math.min(1, turnRate / TURN_RATE_FULL));
    const st = springStep(
      this.roll,
      this.rollVel,
      norm * MAX_BANK * BANK_SIGN,
      BANK_STIFFNESS,
      BANK_DAMPING,
      dt,
    );
    this.roll = st.value;
    this.rollVel = st.vel;

    // ── 피치 ── 가·감속(평활) + 아이들 호흡(느린 사인, 속도로 배타 페이드).
    const rawAccel = (s.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = s.speed;
    const k = 1 - Math.exp(-dt / ACCEL_TAU);
    this.accel += (rawAccel - this.accel) * k;
    const accelNorm = Math.max(-1, Math.min(1, this.accel / ACCEL_FULL));
    const idle = Math.max(0, 1 - s.speed / IDLE_SPEED_CUTOFF);

    // ── 대시 ── 비대칭 포락선(빠른 어택 / 느린 릴리스). 2D 불꽃 코어와 같은 곡선이다.
    const tau = s.dashing ? DASH_ATTACK : DASH_RELEASE;
    this.dashHeat += ((s.dashing ? 1 : 0) - this.dashHeat) * (1 - Math.exp(-dt / tau));
    const heat = this.dashHeat;

    // ── 피격 ── 상승 에지에서 창을 채우고 스스로 소진된다.
    if (s.hit) this.shakeLeft = HIT_SHAKE_S;
    if (this.shakeLeft > 0) this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    // 남은 시간에 비례해 잦아든다. 두 주파수가 무리수 비라 패턴이 반복되지 않는다(기계적이지 않다).
    const shake = this.shakeLeft / HIT_SHAKE_S;

    const a: Attitude = {
      // 가속은 기수를 **숙이고**(−) 감속은 든다(+). 대시 첨두는 그 위에 더 깊게 숙인다.
      roll: this.roll + Math.sin(t * 83.1) * HIT_ROLL * shake,
      pitch: -accelNorm * PITCH_ACCEL + osc(t, BREATH_HZ) * BREATH_PITCH * idle - heat * DASH_PITCH,
      stretch: 1 + heat * DASH_STRETCH,
      girth: 1 - heat * DASH_GIRTH,
      jitterX: Math.sin(t * 61.7) * HIT_JITTER * shake,
      jitterY: Math.sin(t * 47.3) * HIT_JITTER * shake,
      emissive: BASE_EMISSIVE + heat * DASH_EMISSIVE,
    };

    // 이동은 프러스텀 반폭 배수다 — 프레이밍과 연출이 함께 움직인다.
    this.pivot.position.set(a.jitterX * this.unit, a.jitterY * this.unit, 0);
    // 로컬 X = 기수 축(롤) · 로컬 Z = 횡축(피치) · 요는 Pixi 가 쥐므로 **항상 0**이다(파일 헤더 ①).
    this.pivot.rotation.set(a.roll, 0, a.pitch);
    this.pivot.scale.set(a.stretch, a.girth, a.girth);

    for (const mat of this.emissiveMaterials) mat.emissiveIntensity = a.emissive;
    // 점광도 함께 달아올라 발광이 모델 밖(주변 면)까지 번진다.
    this.engineLight.intensity = 1.4 + a.emissive * 1.6;

    this.stage.markActive('player');
  }
}

/** 슬롯 해상도·순항 기준을 외부(뷰어·테스트)에서 참조할 때 쓰는 재수출. */
export { SLOT_SIZE, CRUISE_SPEED };
