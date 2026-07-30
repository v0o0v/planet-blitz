/**
 * 보스 3D 액터 — **페이즈별로 다른 연출**을 재생한다.
 *
 * ── 왜 스켈레톤 애니메이션이 아닌가 ──
 * Meshy 의 리깅(`meshy_rig`)은 휴머노이드 전제(t-pose, height_meters 1.7)이고 커스텀 동작은
 * 정수 `action_id` 로 고르는 사전 정의 카탈로그(dancing/jumping/fighting…)다. 카르곤 보스는
 * **용암 요새 메카**라 스켈레톤이 의미가 없고, 우리가 원하는 연출(페이즈 전환·과열·붕괴)은
 * 애초에 그 카탈로그에 없다. 그래서 Meshy 는 **메시만** 주고, 연출은 여기서 트랜스폼 +
 * 발광(emissive)으로 저작한다. 게임 상태와 1:1 로 붙일 수 있고 리깅 비용도 들지 않는다.
 *
 * ── 상태 ──
 * sim 의 보스는 phase 0/1/2 를 가지고(HP 70%/35% 임계, `src/sim/boss.ts`), 임계를 넘을 때
 * 120틱(2초) 프리즈 전환에 들어가며, 시그니처 캐스트 뒤 과열 창(피해 2배)이 열린다.
 * 이 셋이 그대로 연출 상태가 된다:
 *
 *   phase 0  잔잔한 부유 — 아직 여유가 있다
 *   phase 1  빠른 맥동 + 전방 기울임 — 공격적으로 전환
 *   phase 2  격렬한 진동 + 강한 발광 + 크기 맥동 — 폭주 직전
 *   전환     상승 + 고속 스핀 + 발광 폭발(2초) — 프리즈와 화면 정리에 얹히는 연출
 *   과열     붉은 고주파 펄스 — 지금 때리라는 신호(피해 2배 창)
 *
 * 과열은 페이즈 위에 **덧씌워진다**(직교) — 페이즈별 기본 거동을 유지한 채 발광만 올라탄다.
 *
 * ── 결정론 ── render-only. 스냅샷을 읽기만 하고 sim 에 쓰지 않는다(골든 해시 불변).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SLOT_SIZE, type Stage3D } from './stage3d.js';

/** 렌더러가 넘기는 보스 연출 상태(전부 스냅샷 파생). */
export interface BossVisualState {
  /** sim 페이즈 0/1/2. 범위 밖은 방어적으로 0 취급. */
  phase: number;
  /** 페이즈 전환 애니메이션 중(스냅샷 `flash` = `boss.timer > 0`). */
  transitioning: boolean;
  /** 과열 창(스냅샷 `active` = `boss.iframes > 0`) — 피해 2배. */
  overheated: boolean;
}

/** 페이즈별 기본 거동 계수. 위 주석의 표를 그대로 수치화한 것이다. */
interface PhaseMotion {
  /** 상하 부유 진폭(모델 단위, 1 = 모델 최대 치수). */
  bobAmp: number;
  /** 부유 주파수(Hz). */
  bobHz: number;
  /** 좌우 요동 진폭(rad). */
  swayAmp: number;
  /** 좌우 요동 주파수(Hz). */
  swayHz: number;
  /** 전방 기울임(rad) — 클수록 공격적으로 읽힌다. */
  lean: number;
  /** 고주파 진동 진폭(모델 단위) — 폭주감. */
  jitter: number;
  /** 크기 맥동 비율(0 = 없음). */
  pulse: number;
  /** 용암 발광 세기 기준값. */
  emissive: number;
}

const PHASE_MOTION: readonly PhaseMotion[] = [
  // phase 0 — 잔잔한 부유.
  { bobAmp: 0.05, bobHz: 0.8, swayAmp: 0.12, swayHz: 0.35, lean: 0.0, jitter: 0, pulse: 0, emissive: 0.55 },
  // phase 1 — 빠른 맥동 + 기울임.
  { bobAmp: 0.08, bobHz: 1.4, swayAmp: 0.22, swayHz: 0.7, lean: 0.1, jitter: 0.004, pulse: 0.015, emissive: 1.05 },
  // phase 2 — 격렬한 진동 + 강한 발광.
  { bobAmp: 0.1, bobHz: 2.2, swayAmp: 0.3, swayHz: 1.2, lean: 0.18, jitter: 0.016, pulse: 0.035, emissive: 1.8 },
];

/** 전환 연출 길이(초) — sim 의 `BOSS_PHASE_TRANSITION_TICKS`(120틱 = 2초)와 맞춘다. */
const TRANSITION_SECONDS = 2;

/** 카메라 틸트(수평에서의 각도). 90°=완전 수직 내려보기. 기존 보스 아트의 프레이밍에 맞춘 값. */
const CAMERA_TILT_RAD = (62 * Math.PI) / 180;

/** GLB 자산 URL(있는 파일만 잡힌다 — 없으면 3D 액터가 생성되지 않고 2D 폴백). */
const MODEL_URLS = import.meta.glob('../../../assets/models/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function modelUrl(basename: string): string | undefined {
  for (const key in MODEL_URLS) {
    if (key.endsWith(`/${basename}`)) return MODEL_URLS[key];
  }
  return undefined;
}

/**
 * 보스 3D 액터. `load()` 가 성공한 뒤에만 무대에 mount 되고, 그 전까지 호출자는
 * 기존 PNG 스프라이트를 계속 쓴다(로딩이 화면을 비우지 않는다).
 */
export class BossActor {
  private readonly stage: Stage3D;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  /** 모델을 담는 피벗 — 연출 트랜스폼은 전부 여기에 건다(모델 원본은 안 건드린다). */
  private readonly pivot = new THREE.Group();
  private readonly emissiveMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly coreLight: THREE.PointLight;
  private ready = false;
  /** 연출 시계(초). 벽시계 누적 — sim 틱과 무관하다. */
  private clock = 0;
  /** 전환 연출 잔여(초). `transitioning` 상승 에지에서 채운다. */
  private transitionLeft = 0;
  private wasTransitioning = false;

  constructor(stage: Stage3D) {
    this.stage = stage;

    // 직교 카메라 — 탑다운 게임의 원근 없는 프레이밍(스프라이트와 같은 규율).
    // 모델을 최대 치수 1 로 정규화하므로 프러스텀 반폭 0.72 면 가장자리 여백이 남는다.
    const half = 0.72;
    this.camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 20);
    const d = 6;
    this.camera.position.set(
      0,
      d * Math.sin(CAMERA_TILT_RAD),
      d * Math.cos(CAMERA_TILT_RAD),
    );
    this.camera.lookAt(0, 0, 0);

    // 조명: 위에서 내리는 키 + 채움 + 용암 코어의 주황 점광(아래에서 올려 비춘다).
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
    key.position.set(0.6, 1.6, 0.9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-1, 0.4, -1);
    this.scene.add(rim);
    this.coreLight = new THREE.PointLight(0xff6a1a, 2.2, 4, 2);
    this.coreLight.position.set(0, -0.15, 0.1);
    this.scene.add(this.coreLight);

    this.scene.add(this.pivot);
  }

  /** 모델이 준비되어 3D 텍스처를 써도 되는가. false 면 호출자는 2D 폴백. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * GLB 를 읽어 정규화(중심 정렬 + 최대 치수 1)하고 무대에 mount 한다.
   * 파일이 없거나 파싱에 실패하면 조용히 false — 2D 스프라이트가 그대로 남는다.
   */
  async load(basename: string): Promise<boolean> {
    const url = modelUrl(basename);
    if (url === undefined) return false;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;

      // 정규화: 바운딩박스 중심을 원점으로, 최대 치수를 1 로.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.sub(center);
      const norm = new THREE.Group();
      norm.add(root);
      norm.scale.setScalar(1 / maxDim);
      this.pivot.add(norm);

      // 베이스 컬러를 그대로 발광 맵으로 재사용한다. Meshy refine 을 `remove_lighting: true`
      // 로 뽑아 텍스처에 하이라이트가 구워져 있지 않으므로, 발광 세기를 올리면 용암 균열이
      // 실제로 달아오르는 것처럼 보인다 — 페이즈 연출의 주 레버가 이것이다.
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.emissiveMap = m.map;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = PHASE_MOTION[0]?.emissive ?? 0.55;
            this.emissiveMaterials.push(m);
          }
        }
      });

      this.stage.mount('boss', this.scene, this.camera);
      this.ready = true;
      return true;
    } catch {
      return false; // 손상된 자산이 게임을 막지 않는다.
    }
  }

  /**
   * 한 프레임 갱신. 호출자는 보스가 화면에 있을 때만 부른다.
   *
   * @param dt   경과 시간(초, 상한 적용된 값).
   * @param s    이번 프레임의 보스 연출 상태.
   */
  update(dt: number, s: BossVisualState): void {
    if (!this.ready) return;
    this.clock += dt;

    // 전환은 상승 에지에서 한 번 채우고 스스로 소진된다. sim 프리즈(120틱)와 길이를 맞췄지만
    // 서로 독립이라 프레임 드랍이 나도 연출이 sim 을 기다리게 만들지 않는다.
    if (s.transitioning && !this.wasTransitioning) this.transitionLeft = TRANSITION_SECONDS;
    this.wasTransitioning = s.transitioning;
    if (this.transitionLeft > 0) this.transitionLeft = Math.max(0, this.transitionLeft - dt);

    const idx = s.phase >= 0 && s.phase < PHASE_MOTION.length ? s.phase : 0;
    const m = PHASE_MOTION[idx] ?? PHASE_MOTION[0];
    if (m === undefined) return;
    const t = this.clock;

    // ── 기본 거동(페이즈별) ──
    let y = Math.sin(t * m.bobHz * Math.PI * 2) * m.bobAmp;
    let yaw = Math.sin(t * m.swayHz * Math.PI * 2) * m.swayAmp;
    let pitch = m.lean;
    let scale = 1 + Math.sin(t * 6) * m.pulse;
    let emissive = m.emissive;

    // 폭주 페이즈의 고주파 진동 — 두 개의 무리수 비 사인으로 주기성을 깬다.
    const jx = m.jitter === 0 ? 0 : Math.sin(t * 47.3) * m.jitter;
    const jy = m.jitter === 0 ? 0 : Math.sin(t * 61.7) * m.jitter;

    // ── 전환 연출(페이즈 위에 덮어쓴다) ──
    // 남은 시간을 0..1 진행도로 바꿔 상승 → 고속 스핀 → 발광 폭발을 태운다.
    if (this.transitionLeft > 0) {
      const p = 1 - this.transitionLeft / TRANSITION_SECONDS; // 0 → 1
      // 상승은 sin 반주기로 올라갔다 내려온다(끝나면 원위치).
      y += Math.sin(p * Math.PI) * 0.32;
      yaw += p * p * 14; // 가속하는 스핀.
      pitch = m.lean * (1 - p);
      scale *= 1 + Math.sin(p * Math.PI) * 0.12;
      emissive += Math.sin(p * Math.PI) * 3.2; // 발광 폭발.
    }

    // ── 과열(페이즈와 직교로 덧씌운다) ──
    if (s.overheated) {
      emissive += 1.0 + 0.8 * Math.sin(t * 18);
    }

    this.pivot.position.set(jx, y + jy, 0);
    this.pivot.rotation.set(pitch, yaw, 0);
    this.pivot.scale.setScalar(scale);

    for (const mat of this.emissiveMaterials) mat.emissiveIntensity = emissive;
    // 코어 점광도 함께 달아올라 발광이 모델 밖(주변 면)까지 번진다.
    this.coreLight.intensity = 1.4 + emissive * 1.6;

    this.stage.markActive('boss');
  }
}

/** 슬롯 해상도를 외부(테스트·문서)에서 참조할 때 쓰는 재수출. */
export { SLOT_SIZE };
