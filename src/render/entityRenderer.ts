/**
 * Renders simulation snapshots to PixiJS sprites with interpolation.
 *
 * The sim advances at a fixed 60 Hz, but the display may refresh at any rate.
 * Each render frame we interpolate between the previous and current sim snapshot
 * by `alpha` (the fractional progress toward the next tick), so motion looks
 * smooth regardless of monitor refresh. The sim itself is never touched here —
 * render reads immutable snapshots only (sim/render separation, ADR-0005).
 *
 * Sprites cover point-like entities (player, enemies, bullets, gems). Hazards
 * (telegraphed zones) and support heal beams have per-frame variable geometry,
 * so they are drawn into a Graphics overlay from the current snapshot each frame.
 */

import { Container, Graphics, Sprite, Text, type Texture, type Filter } from 'pixi.js';
import type { WorldSnapshot, EntitySnapshot } from '../sim/snapshot.js';
import type { EntityKind } from '../sim/entities.js';
import type { PlaceholderTextures } from './textures.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';
import { shipFacing } from './shipFacing.js';
// 아군·이익 오브젝트 표시 규약(크기 상한·이름표·포탑 조준, 2026-07-26 사용자 피드백).
// 전부 render-only 순수 함수 — 스냅샷만 읽는다.
import {
  displaySize,
  friendlyLabel,
  showsTriggerRing,
  turretAimAngle,
  TRIGGER_RING_COLOR,
} from './friendlyDisplay.js';
// 루프 애니메이션(아군·이익 오브젝트). 프레임 선택은 순수 함수, 프레임 텍스처는 textures 가
// 스트립에서 잘라 실어 온다. 스트립이 없으면 슬롯이 없어 기존 정지 스프라이트 그대로다.
import { animatedKindOf, animFrameIndex, phaseForEntity } from './spriteAnimation.js';
import { tiledWallTexture } from './wallTexture.js';
// 포탑 사거리(조준 회전 반경). sim 상수를 재선언하지 않고 그대로 읽는다 — 갈라지면 포신이
// 사거리 밖 표적을 가리킨다. 값만 읽을 뿐 sim 을 실행하지 않는다.
import { TURRET_RANGE } from '../sim/events.js';
import { facilitySpecFor } from '../../data/invasion/facilities.js';
import { HAZARD_LAVA } from '../sim/patterns/types.js';
// 엔티티 장식자 심(entity/adorner.ts) — 플레이어·적 비주얼 레인이 이 공유 파일을 건드리지 않고
// 자기 모듈에서 등록만 하는 확장 지점. 등록된 팩토리가 없으면 장식자 0개라 거동이 완전히 불변이다.
import {
  createAdorners,
  NO_ADORNERS,
  type AdornerContext,
  type EntityAdorner,
} from './entity/adorner.js';
// 해저드 렌더 진입점(entity/hazardHost.ts) — 장판 그리기(구 drawOverlay 루프)와 재질 확장 지점.
// 표시 규칙 자체는 여전히 hazardVisual.ts 가 정본이고 호스트가 그것을 소비한다.
import { HazardHost, type HazardHostContext } from './entity/hazardHost.js';
// 엔티티 비주얼 등록 허브 — 값 없는 부수효과 import 다. 이 한 줄이 없으면 비주얼 레인 모듈들이
// 등록되지 않아 **완성된 채로 화면에 없다**(이 리포가 8번 밟은 결함). 근거는 entity/index.ts 헤더.
import './entity/index.js';
// 조우 유형 상수(ADR-0033). `data/encounters.ts` 는 다른 sim 모듈을 import 하지 않는 leaf
// 데이터라 렌더가 읽어도 순환·결정론 위험이 없다(facilities/props 카탈로그 참조 선례).
import { ENCOUNTER_TYPE } from '../../data/encounters.js';
// Phase 2 전투 피드백 배선 — 전부 render-only(sim·hashWorld/hashEntity 무접촉, ADR-0005).
// 선행 레인 모듈을 소비만 한다(재작성 금지).
import { ShardBurst } from './effects/explosion.js';
import {
  TraumaController,
  TRAUMA_PLAYER_HIT,
  TRAUMA_BOSS_KILL,
  TRAUMA_ELITE_KILL,
  TRAUMA_BIG_EXPLOSION,
} from './screenShake.js';
import { effectGates, type EffectGates, type QualityTier } from './qualityTier.js';
import { graphicsSettings } from './graphicsSettings.js';
import { graphicsTierController } from './graphicsRuntime.js';
// Phase 3 발광체 글로우 배선 — 선행 레인 모듈(effects/glow.ts)을 소비만 한다(재작성 금지).
// render-only(sim·hashWorld/hashEntity 무접촉, ADR-0005). glowLayer=스프라이트 아래·가산(AC-0.8).
import { buildGlowHalo, createGlowBloomFilter, haloSpec, isGlowEmitter } from './effects/glow.js';
// 플레이어 전용 파생(레인 A). **플레이어 경로에서만** 쓰인다 — 다른 발광체·엔티티의 거동은
// 한 줄도 바뀌지 않는다. 튜닝값이 레인 A 파일에 남아 있어야 이 공유 파일이 밸런스 축을 안 먹는다.
import {
  PLAYER_DASH_TRAUMA,
  isDashSpeed,
  playerHaloAniso,
  snapshotVelocity,
  type HaloAniso,
} from './entity/playerVisual.js';
import { buildGroundShadow, castsGroundShadow, groundShadowGeometry } from './groundShadow.js';
import { themeFor } from './env/themes/index.js';
import type { EnvTheme } from './env/theme.js';
// Phase 3 사망/해저드 이벤트 셰이더 배선 — 선행 레인 모듈(effects/shaderEffects.ts)을 소비만 한다
// (재작성 금지). render-only(sim·hashWorld/hashEntity 무접촉, ADR-0005). 전부 eventShaders 게이트
// (High 티어 전용) 뒤에 격리 — 저티어에선 기존 즉시 destroy·헤일로만 거동 유지(AC-3.6 폴백).
import { ShockwaveEffect, DissolveEffect, ShimmerEffect } from './effects/shaderEffects.js';
// Phase 4 전투 부가 연출 배선 — 선행 레인 모듈(effects/*)을 소비만 한다(재작성 금지). 전부
// render-only(sim·hashWorld/hashEntity 무접촉, ADR-0005). 데미지 숫자는 스냅샷 HP-델타 추론이라
// sim 0 변경(AC-4.1). 이펙트는 effectLayer(스프라이트 위)에 얹는다(폭발과 동일 규율, AC-0.8).
import { DamageNumber } from './effects/damageNumber.js';
import { isTrailBullet, BulletTrail } from './effects/bulletTrail.js';
import { isGraze, GrazeTracker, GrazeSpark } from './effects/grazeSpark.js';
import { PickupPop, LevelUpRing } from './effects/pickupPop.js';
import { MuzzleFlash } from './effects/muzzleFlash.js';
// three.js 는 **타입만** 정적으로 가져온다(런타임 코드는 아래 ensureBoss3D 의 동적 import).
// 정적 import 로 두면 three 전체가 메인 청크에 들어가 첫 로드가 무거워진다 — 실측 gzip 약 0.4MB.
import type { Stage3D } from './three3d/stage3d.js';
import type { BossActor } from './three3d/bossActor.js';
import type { ShipActor } from './three3d/shipActor.js';

/**
 * effectLayer 원샷 이펙트의 공통 계약(ShardBurst 동형). 데미지 숫자·그레이징 스파크·수집 팝·레벨업
 * 링·머즐 플래시가 이 모양을 만족해 한 목록({@link EntityRenderer.oneShots})에서 함께 수명 관리된다
 * (탄 트레일은 위치를 먹여야 해 update 시그니처가 달라 별도 관리). update 가 false 를 돌려주면
 * 호출측이 effectLayer 에서 떼고 destroy 한다.
 */
interface OneShotEffect {
  readonly container: Container;
  update(dt: number): boolean;
  destroy(): void;
}

interface TrackedSprite {
  sprite: Sprite;
  seenTick: number;
  kind: EntityKind;
  /**
   * 직전 프레임 스냅샷 HP(데미지 숫자 킬블로우용, AC-4.1). 소멸(처치) 시점엔 curr 스냅샷이 없어
   * 치사 델타를 못 얻으므로, 매 프레임 갱신해 두었다가 킬 루프에서 이 잔량을 최종 피해 숫자로 띄운다
   * (Critic m3 엣지 ①). 보스·엘리트만 숫자를 띄우지만 필드는 전 kind 가 들고 있어도 무해하다. **데미지
   * 감지도 이 필드로** 한다(스냅샷 보간 델타 p.hp 대신) — render 가 sim(60Hz)과 분리돼 sim-step 없는
   * 프레임에 같은 스냅샷이 재계수되는 HIGH-1 결함을 막는다(no-step 프레임엔 직전 프레임이 이미
   * tracked.hp=e.hp 로 낮춰 재발화가 자연 차단된다).
   */
  hp: number;
  /**
   * 아직 숫자로 방출하지 않은 누적 피해(AC-4.1 스로틀). 대상별로 `tracked.hp - e.hp`(>0)를 모았다가
   * {@link DAMAGE_NUMBER_THROTTLE_FRAMES} 창마다 한 숫자로 합쳐 방출한다(고빈도 피해 정돈·예산 보호).
   */
  dmgAccum: number;
  /** 마지막 데미지 숫자 방출 프레임(스로틀 기준). 생성 시 음수로 둬 첫 피해는 즉시 방출된다. */
  dmgEmitTick: number;
  /**
   * 히트 플래시 창의 종료 프레임(AC-2.3). `frameTick < flashUntilTick` 이면 가산 흰 오버레이를
   * 유지하고, 창이 끝나면(`frameTick >= flashUntilTick`) 오버레이를 떼고 파괴한다. 0 = 비활성.
   */
  flashUntilTick: number;
  /**
   * 히트 플래시용 가산 흰 오버레이 스프라이트(있으면 표시 중). Pixi v8 tint 는 곱연산이라 흰색은
   * 항등원 → 무틴트 스프라이트에 곱하면 화면 변화가 없다(MED-1). 대신 같은 텍스처를 `blendMode='add'`
   * 로 얹어 실루엣을 실제로 밝힌다. **Pixi v8 은 Sprite 를 컨테이너로 쓰는 것을 deprecate 했으므로
   * (Sprite.addChild 경고), 부모의 자식이 아니라 spriteLayer 형제로 두고 매 프레임 부모 위치·회전·
   * 스케일을 미러**한다(발광 헤일로와 동형). 형제라 부모 destroy 로는 안 딸려 오므로 창 종료·킬·
   * reset·destroy 시 명시 회수한다({@link detachFromSpriteLayer}). null = 오버레이 없음.
   */
  flashOverlay: Sprite | null;
  /**
   * 낙하산(보급 수송체 위 고정 매닮) 형제 스프라이트. 히트 플래시 오버레이와 같은 이유로 부모
   * Sprite 의 자식이 아니라 spriteLayer 형제로 두고(Pixi v8 Sprite.addChild deprecate 회피), 매
   * 프레임 부모 위치로 미러한다(수송체는 fixed facing 이라 회전 0). 형제라 킬·reset·destroy 시
   * 명시 회수해야 한다(부모 destroy 로 안 딸려 온다). null = 낙하산 없음(에셋 부재·비-보급).
   */
  chute: Sprite | null;
  /**
   * 이름표(아군·이익 오브젝트 아래 표시, 2026-07-26 피드백). 낙하산·히트 플래시와 같은 이유로
   * 부모 Sprite 의 자식이 아니라 **labelLayer 형제**다(Pixi v8 Sprite.addChild deprecate 회피)
   * — 부모 destroy 로 안 딸려 오므로 킬·reset·destroy 에서 명시 회수한다. null = 라벨 없는 kind.
   */
  label: Text | null;
  /**
   * 이름표에 현재 찍혀 있는 문자열. 포탑은 휴면↔활성 전이로 이름이 바뀌므로 매 프레임 비교해
   * **달라졌을 때만** `Text.text` 를 갱신한다(매 프레임 대입은 텍스트 리빌드를 유발한다).
   */
  labelText: string;
  /**
   * 활성 포탑이 마지막으로 향한 각도(표적이 없을 때 유지). 플레이어의 `lastPlayerAngle` 과 같은
   * 규율 — 표적이 사라질 때마다 포신이 0도로 튀지 않게 한다.
   */
  aimAngle: number;
  /**
   * 루프 애니메이션 프레임(있으면 매 프레임 텍스처를 갈아 끼운다). null = 정지 스프라이트.
   * 모든 프레임이 같은 치수라 표시 크기(setSize 로 확정)는 교체에도 불변이다.
   */
  animFrames: readonly Texture[] | null;
  /** 이 엔티티의 애니메이션 시작 위상(프레임) — 같은 kind 가 동시에 깜빡이지 않게 흩뜨린다. */
  animPhase: number;
  /**
   * 엘리트 여부(스냅샷 `elite >= 0`). 처치 시 화면 흔들림 세기를 고르기 위해 매 프레임 갱신한다
   * (엘리트 처치=TRAUMA_ELITE_KILL). 소멸 시점엔 스냅샷이 없으므로 tracked 에 실어 둔다.
   */
  elite: boolean;
  /**
   * 이 엔티티에 붙은 장식자(비주얼 레인 확장, {@link file://./entity/adorner.ts}). 등록된 팩토리가
   * 없는 kind 는 {@link NO_ADORNERS}(공유 빈 배열)라 할당도 호출도 없다.
   *
   * ⚠️ 장식자가 만드는 컨테이너는 스프라이트의 **형제**라 부모 `destroy` 로 회수되지 않는다 —
   * 킬 루프·디졸브·reset·destroy 네 경로가 전부 {@link EntityRenderer.disposeAdorners} 를 불러야
   * 한다. 회수한 뒤에는 이 필드를 `NO_ADORNERS` 로 되돌려 이중 회수가 no-op 이 되게 한다.
   */
  adorners: readonly EntityAdorner[];
}

/** Sprite display diameter relative to the sim hitbox (art reads a bit larger). */
const ART_SCALE = 1.5;
/**
 * 발광체 헤일로 외곽 반경 = 스프라이트 **표시 반경**(sprite.width/2)의 배수. >1 이라 빛이 코어
 * 밖으로 새어 나온다(발광 룩). sim radius 가 아니라 표시 크기 기준인 이유: loot 의 sim radius 는
 * 픽업 사거리(큰 값)라 glyph 크기와 어긋나기 때문(LOOT_SIZE 선례). placeholder, defer-balance-tuning
 * (색온도·세기와 함께 출시 직전 일괄 조정).
 */
const GLOW_HALO_RADIUS_SCALE = 1.6;
/** 히트 플래시 지속 프레임(2~3). placeholder, defer-balance-tuning. */
const HIT_FLASH_FRAMES = 3;
/** 히트 플래시 가산 오버레이 색(화이트). blendMode='add' 라 대상 실루엣을 흰빛으로 밝힌다(AC-2.3). */
const HIT_FLASH_TINT = 0xffffff;
/** 히트 플래시 오버레이 알파(가산 세기). placeholder, defer-balance-tuning(프레임 감쇠는 후속). */
const HIT_FLASH_ALPHA = 0.85;
/**
 * 낙하산 폭 = 수송체 **표시 폭**(sprite.width)의 배수. 낙하산이 부모 Sprite 의 자식이던 시절
 * `setSize(tw*0.95)`(부모 텍스처 로컬)을 부모 스케일이 곱해 표시하던 크기를, 이제 형제로 두므로
 * 부모 표시 치수에 직접 곱해 동일 크기로 재현한다(자식 세팅과 수치 동치). placeholder.
 */
const PARACHUTE_WIDTH_SCALE = 0.95;
/**
 * 낙하산을 수송체 중심 **위로** 매다는 오프셋 = 수송체 **표시 높이**(sprite.height)의 배수. 자식
 * 이던 시절 로컬 `position(0, -th*0.35)`(부모 스케일 곱)와 수치 동치(부모 표시 높이 × 0.35).
 */
const PARACHUTE_OFFSET_SCALE = 0.35;
/**
 * 대형 폭발 흔들림 임계 스케일(AC-2.1). {@link explosionScale} 이 설비/기물=2·보스류=3 을 내므로
 * `>=2` 를 "대형"으로 본다 — 잡몹(1) 폭발은 흔들림 제외. placeholder, defer-balance-tuning.
 */
const BIG_EXPLOSION_SCALE = 2;
/**
 * 동시 디졸브(사망 지연 소멸) 상한(AC-3.4). 이 수를 넘는 사망은 디졸브로 넘기지 않고 즉시 destroy
 * 한다 — 폭탄 밀도(수십 개 동시 사망)에서 필터 부착 스프라이트가 무한 누적하는 성능 붕괴를 막는
 * 방어선이다. placeholder, defer-balance-tuning(출시 직전 프레임 예산으로 조정).
 */
const MAX_DISSOLVES = 12;
/**
 * 동시 충격파 링 상한(AC-3.3). 충격파는 {@link layer}(루트 카메라 레이어) **전체**에 변위 필터를
 * 거는 풀스크린 post-process 1패스라, 대형 킬이 한 프레임에 여럿(폭탄이 다수 설비·기물을 동시
 * 파괴; 둘 다 scale 2) 나면 필터가 layer.filters 에 누적돼 1.15초 동안 N중 풀스크린 패스가 겹친다
 * ({@link MAX_DISSOLVES} 가 막는 바로 그 폭탄 밀도 시나리오가 충격파엔 무방비였다 — 리뷰 MEDIUM).
 * 이 상한에 도달하면 새 충격파를 생략한다(저빈도·고임팩트 규율 유지). placeholder,
 * defer-balance-tuning(출시 직전 프레임 예산으로 조정).
 */
const MAX_SHOCKWAVES = 4;
/**
 * 동시 원샷 이펙트(데미지 숫자·그레이징 스파크·수집 팝·레벨업 링·머즐 플래시) 상한(AC-4.*). 이
 * 수를 넘는 신규 이펙트는 생략한다 — 탄막 밀도·연사에서 effectLayer 가 무한 성장하는 성능 붕괴
 * 방어선(MAX_DISSOLVES·MAX_SHOCKWAVES 와 동형 정신). placeholder, defer-balance-tuning.
 */
const MAX_ONESHOTS = 48;
/**
 * 동시 탄 트레일 상한(AC-4.4). 트레일 대상 탄(플레이어 탄 + 특수 거동 적탄)이 이 수를 넘으면 신규 탄은
 * 트레일 없이 렌더된다(스트릭 Graphics 무한 성장 방어). placeholder, defer-balance-tuning.
 */
const MAX_BULLET_TRAILS = 64;
/**
 * 동시 접지 그림자 상한. 그림자 대상은 이미 "부피 있는 실체"로 좁혀져 있어(탄·젬 제외) 보통
 * 수십 개지만, 군집 스폰·설비 다수 화면에서 shadowLayer 가 무한 성장하지 않게 못 박는다
 * (MAX_ONESHOTS·MAX_BULLET_TRAILS 와 동형 정신). placeholder, defer-balance-tuning.
 */
const MAX_GROUND_SHADOWS = 160;

/**
 * 접지 그림자 1개의 추적 레코드. `dx`/`dy` 는 테마 광원에서 파생된 **불변** 오프셋이라 생성 시
 * 한 번만 구한다 — 매 프레임 cos/sin 을 다시 돌리지 않기 위한 캐시다.
 */
interface GroundShadowEntry {
  readonly view: Container;
  readonly dx: number;
  readonly dy: number;
}
/**
 * 그레이징 판정 대역폭(월드 유닛, AC-4.5). 플레이어↔적탄 거리가 (충돌 반경, 충돌 반경+이 값] 이면
 * "스칠 뻔"으로 본다 — 판정점 안(충돌)도 아니고 멀지도 않은 근접 링. placeholder, defer-balance-tuning.
 */
const GRAZE_BAND = 14;
/** 데미지 숫자를 대상 머리 위로 띄우는 y 오프셋(월드 유닛, AC-4.1). placeholder, defer-balance-tuning. */
const DAMAGE_NUMBER_Y_OFFSET = 22;
/**
 * 데미지 숫자 방출 스로틀(render 프레임, AC-4.1). 대상별로 이 프레임 수 안에 들어온 피해를 **한 숫자로
 * 합쳐** 방출한다. 두 목적: ①연사·DoT(매 sim tick 피해)로 숫자가 프레임마다 쏟아져 겹쳐 뭉개지고
 * oneShots 예산(MAX_ONESHOTS)을 통째 고갈시켜 머즐·수집·레벨업이 굶는 것을 막는다(리뷰 MEDIUM).
 * ②render 가 sim(60Hz)과 분리돼 sim-step 없는 프레임에 같은 피해가 재계수되는 것은 tracked.hp 델타가
 * 이미 막지만(리뷰 HIGH-1), 스로틀이 고빈도 피해까지 정돈한다. placeholder, defer-balance-tuning.
 */
const DAMAGE_NUMBER_THROTTLE_FRAMES = 8;
/** render 벽시계 프레임 델타 상한(초) — 탭 복귀 spike 방어. ShardBurst.MAX_DT(0.05)와 정합. */
const MAX_RENDER_DT = 0.05;
/** 프레임 델타 nominal(초, 60Hz). 첫 프레임·비정상 dt 폴백값. */
const NOMINAL_DT = 1 / 60;
/** Fixed on-screen size (px) of a floor loot glyph — the sim `radius` is the
 *  pickup range (44), far larger than the icon should read. */
const LOOT_SIZE = 48;
/** 이름표를 스프라이트 아래로 띄우는 간격(px). placeholder, defer-balance-tuning. */
const LABEL_GAP = 4;
/** Rarity → tint for loot (render-only): normal grey, magic blue, rare gold,
 *  unique orange. Indexed by the rarity code carried in `enemyType`. */
const LOOT_TINT = [0xcfd6e0, 0x5aa0ff, 0xffd24a, 0xff8a2a];
/** 보조무기 5종의 직접 발사체 색(render-only): friendly bullet에 실린 sub-type 코드
 *  (0..4, sim의 subWeapon이 enemyType에 태깅)로 색을 구분한다. 주무기 탄은 enemyType
 *  -1이라 이 배열을 타지 않고 기본 흰색으로 렌더된다.
 *  0 사이드킥=청록, 1 스캐터=연두, 2 기뢰장=주황, 3 센트리=미사용(포탑탄은 기본), 4 플레어=자홍. */
const SUB_BULLET_TINT = [0x4ff0d0, 0x9cff5a, 0xff9a3a, 0xffffff, 0xff5ad0];

// ---------------------------------------------------------------------------
// kind → 텍스처 슬롯 매핑 (M7a L10-render)
//
// 이 매핑이 **모든** kind 를 덮는지는 tests/invasionRender.test.ts 가 KIND_CODE 배열에서
// 파생해 전수 검사한다. 미등록 kind 는 조용히 player 텍스처로 폴백해 결함이 눈에 띄지 않기
// 때문에(정찰 지적), 매핑을 스위치 안에 숨기지 않고 **순수 함수로 꺼내** 검증 가능하게 뒀다.
// ---------------------------------------------------------------------------

/** 단일 텍스처 슬롯 이름. */
export type SingleTextureSlot =
  | 'player'
  | 'bullet'
  | 'enemyBullet'
  | 'gem'
  | 'supply'
  | 'loot'
  | 'wall'
  | 'destructible'
  | 'magnetEmitter'
  | 'bombDevice'
  | 'turretPickup'
  | 'shelter'
  | 'encounterPortal'
  | 'encounterSeal'
  | 'encounterAltar'
  | 'core'
  | 'formation'
  | 'formationDrone'
  | 'spawnedDrone';

/** 배열 텍스처 슬롯 이름(인덱스 의미는 textures.ts 인터페이스 주석이 정본). */
export type ArrayTextureSlot =
  | 'enemy'
  | 'boss'
  | 'enemyBulletBehaviors'
  | 'guardian'
  | 'facility'
  | 'prop'
  | 'defenseBoss';

/** 한 kind 가 어느 텍스처를 쓰는지의 서술(순수 데이터 — 렌더 상태 무관). */
export type SpriteSlot =
  | { readonly kind: 'single'; readonly slot: SingleTextureSlot }
  | { readonly kind: 'array'; readonly slot: ArrayTextureSlot; readonly index: number }
  /** 스프라이트가 없는 kind(오버레이 Graphics 로 그린다) — `hazard` 하나뿐이다. */
  | { readonly kind: 'overlay' };

/**
 * 엔티티 kind(+ 유형 코드)를 텍스처 슬롯으로 사상한다. **순수 함수** — 폴백 판단(범위 밖
 * 인덱스 → 0)은 텍스처 해석 단계가 맡고, 여기서는 "어느 배열의 몇 번" 만 정한다.
 *
 * @param planet `boss` 전용(행성별 보스 아트). 그 외 kind 는 무시된다.
 * @param encounterType `encounterPortal` 전용. 이번 런의 조우 유형(`ENCOUNTER_TYPE` 값,
 *   미발생·무관이면 0). **봉인 수호자가 포탈과 같은 kind 를 쓰기 때문에** 필요한 인자다 —
 *   자세한 사유는 아래 `encounterPortal` 분기 주석 참조.
 */
export function spriteSlotFor(
  kind: EntityKind,
  enemyType: number,
  planet = 0,
  encounterType = 0,
): SpriteSlot {
  switch (kind) {
    case 'player':
      return { kind: 'single', slot: 'player' };
    case 'bullet':
      return { kind: 'single', slot: 'bullet' };
    case 'enemyBullet':
      // 시각 문법(탄막 다양성 Lane 1): 색 = 거동 종류. 거동 없는 적탄(-1)은 기본 hot-red.
      return enemyType >= 0
        ? { kind: 'array', slot: 'enemyBulletBehaviors', index: enemyType }
        : { kind: 'single', slot: 'enemyBullet' };
    case 'hazard':
      return { kind: 'overlay' };
    case 'gem':
      return { kind: 'single', slot: 'gem' };
    case 'supply':
      return { kind: 'single', slot: 'supply' };
    case 'boss':
      return { kind: 'array', slot: 'boss', index: planet };
    case 'wall':
      return { kind: 'single', slot: 'wall' };
    case 'destructible':
      return { kind: 'single', slot: 'destructible' };
    case 'magnetEmitter':
      return { kind: 'single', slot: 'magnetEmitter' };
    case 'bombDevice':
      return { kind: 'single', slot: 'bombDevice' };
    case 'turretPickup':
      return { kind: 'single', slot: 'turretPickup' };
    case 'loot':
      return { kind: 'single', slot: 'loot' };
    case 'enemy':
      return { kind: 'array', slot: 'enemy', index: enemyType };
    case 'core':
    case 'decoyCore':
      // 가짜 코어도 실제 코어와 동일 텍스처(조준·피격이 같은 시각 계약).
      return { kind: 'single', slot: 'core' };
    case 'guardian':
      return { kind: 'array', slot: 'guardian', index: enemyType };
    // --- M7a 침공 3레이어 ---
    case 'formation':
      return { kind: 'single', slot: 'formation' };
    case 'formationDrone':
      return { kind: 'single', slot: 'formationDrone' };
    case 'spawnedDrone':
      return { kind: 'single', slot: 'spawnedDrone' };
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
      // 설비 3종 모두 `enemyType = 설비 catalogId`(facility.ts 필드 매핑표가 정본).
      return { kind: 'array', slot: 'facility', index: enemyType };
    case 'prop':
      // 기물은 `enemyType = 역할 코드 PROP_*`(catalogId 가 아니다 — coreRoom.ts 필드 매핑표).
      return { kind: 'array', slot: 'prop', index: enemyType };
    case 'defenseBoss':
      return { kind: 'array', slot: 'defenseBoss', index: enemyType };
    // --- 레이싱(Lane5) ---
    case 'boostPad':
      // TODO(art): 전용 부스트 패드 아트는 후속(Lane5 스펙 §3 — 렌더 세부는 balance/art 후속).
      // 지금은 기존 이벤트 오브젝트 텍스처를 placeholder 로 재사용한다(sim 정합만 필수).
      return { kind: 'single', slot: 'turretPickup' };
    // --- 추격·탈출(Lane6) ---
    case 'shelter':
      // 대피소 전용 슬롯(안전지대 돔). 실 PNG 가 없으면 절차적 돔으로 폴백한다(textures.ts).
      // 시야 암흑/안개는 별도 렌더 오버레이(drawFieldOverlays)가 담당한다(스프라이트가 아니다).
      return { kind: 'single', slot: 'shelter' };
    // --- 에코 신호(story Phase D, ADR-0023) ---
    case 'echo':
      // TODO(art): 전용 에코 신호 비콘 아트는 후속. 지금은 자석 이미터 텍스처를 placeholder 로
      // 재사용한다(sim 정합만 필수 — boostPad 선례). 안정화 반경·게이지 UI 는 W3 렌더 몫이다.
      return { kind: 'single', slot: 'magnetEmitter' };
    // --- 조우 프레임워크(ADR-0033) ---
    case 'encounterPortal':
      // ⚠️ **이 kind 하나에 두 조우가 산다.** 봉인 수호자는 신규 `EntityKind` 를 만들지 않고
      // 포탈 kind 를 재사용한다(`src/sim/encounter.ts` 의 `maybeSpawnEncounter`: `KIND_CODE` 가
      // append-only 해시 계약이라 신규 kind 는 골든 재생성을 강제하는데, 필요한 것은 inert 한
      // 근접 판정 실체뿐이고 포탈이 정확히 그것이다). 그래서 연출 구분은 kind 가 아니라
      // **조우 유형**(`encounterRuntime.type`)으로 가른다 — sim 은 그대로 두고 렌더만 갈린다.
      // 런당 조우는 최대 1회라 유형 하나로 화면의 실체가 유일하게 결정된다.
      return encounterType === ENCOUNTER_TYPE.sealedGuardian
        ? { kind: 'single', slot: 'encounterSeal' }
        : { kind: 'single', slot: 'encounterPortal' };
    case 'encounterAltar':
      return { kind: 'single', slot: 'encounterAltar' };
  }
}

/** 슬롯 서술 → 실제 텍스처. 범위 밖 인덱스·빈 슬롯은 순차 폴백(화면이 비지 않는다). */
export function resolveSpriteSlot(textures: PlaceholderTextures, s: SpriteSlot): Texture {
  if (s.kind === 'overlay') return textures.player; // 호출되지 않는 경로(방어적)
  if (s.kind === 'single') return textures[s.slot] ?? textures.player;
  const arr = textures[s.slot];
  const i = s.index >= 0 && s.index < arr.length ? s.index : 0;
  return arr[i] ?? arr[0] ?? textures.player;
}

// ---------------------------------------------------------------------------
// 예고선(관통 레일포 텔레그래프) · 주기 해저드 온오프 시각 표현
// ---------------------------------------------------------------------------

/** 예고선 색(경고 앰버 — 적탄 hot-red 와 구분되어 "아직 안 맞는다"가 읽힌다). */
export const TELEGRAPH_COLOR = 0xffb020;
/** 예고선 굵기(px). */
export const TELEGRAPH_WIDTH = 3;

/** 화면에 그릴 예고선 1개(월드 좌표). */
export interface TelegraphRail {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly alpha: number;
}

/**
 * 방향 제한 방어포의 **예고선**. 예고 구간(`facility.ts` 의 `phase === 1`)에만 나오며,
 * 스냅샷에서는 `active` 플래그로 실려 온다(설비 텔레그래프 = active).
 *
 * 길이는 카탈로그의 사거리(`spec.range`)에서 파생한다 — 하드코딩하면 설비 스펙이 바뀔 때
 * 예고선과 실제 사거리가 조용히 어긋난다. 잠긴 조준각(`angle`)을 그대로 쓴다.
 *
 * 알파는 프레임 틱의 순수 함수로 맥동시켜(0.45~0.9) 정지 화면에서도 "곧 발사"가 읽힌다.
 */
export function railTelegraph(e: EntitySnapshot, frameTick: number): TelegraphRail | null {
  if (e.kind !== 'facilityGun' || !e.active) return null;
  const spec = facilitySpecFor(e.enemyType);
  if (spec === undefined || spec.range <= 0) return null;
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.5);
  return {
    x1: e.x,
    y1: e.y,
    x2: e.x + Math.cos(e.angle) * spec.range,
    y2: e.y + Math.sin(e.angle) * spec.range,
    alpha: 0.45 + 0.45 * pulse,
  };
}

// 해저드 장판의 표시 규칙(색=성질·형태=상태)은 `hazardVisual.ts` 가 정본이다 — 구 `hazardStyle`
// (색=subtype 하나뿐)은 피해 지형을 아군 시안으로 칠하던 규칙이라 폐기했다(2026-07-26 피드백).

/** 사망 폭발 스케일. 등록되지 않은 kind 는 폭발 없음(0). */
function explosionScale(kind: EntityKind): number {
  switch (kind) {
    case 'boss':
    case 'defenseBoss':
      return 3;
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
    case 'prop':
      return 2;
    case 'enemy':
    case 'formation':
    case 'formationDrone':
    case 'spawnedDrone':
      return 1;
    default:
      return 0;
  }
}

/**
 * 스냅샷에 활성/예열 무관하게 **용암 해저드**(HAZARD_LAVA)가 하나라도 있는가(AC-3.2 히트 시머
 * 게이트). 시머는 지속형이라 용암류가 화면에 있는 동안만 켜고(있으면 부착), 사라지면 detach 한다.
 * render-only 순수 판정 — 스냅샷만 읽는다.
 */
function hasLavaHazard(curr: WorldSnapshot): boolean {
  for (const e of curr.entities) {
    if (e.kind === 'hazard' && e.enemyType === HAZARD_LAVA) return true;
  }
  return false;
}

/**
 * 회전하지 않는(고정 방향) kind 집합. 여기 없는 kind 는 이동 렌더 규약(`rotation = e.angle`)을
 * 따른다.
 *
 * - 코어는 고정 방향(OQ1/OQ4). 수호(guardian)는 목록 밖이라 조준각으로 돈다.
 * - 침공 3레이어: 벽 부착 해저드·스포너와 L3 기물·보스는 고정 자세다. `facilityGun` 만
 *   조준각으로 회전한다 — 예고선과 포신 방향이 일치해야 예고가 읽힌다.
 */
const FIXED_FACING_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'gem',
  'boss',
  'supply',
  'wall',
  'destructible',
  'magnetEmitter',
  'bombDevice',
  'turretPickup',
  'shelter',
  'loot',
  'core',
  'decoyCore',
  'facilityHazard',
  'facilitySpawner',
  'prop',
  'defenseBoss',
]);

function isFixedFacing(kind: EntityKind): boolean {
  return FIXED_FACING_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// 필드 오버레이 — 시야 암흑(추격 Lane6) · 안전 반경 압박존(수축 Lane7)
//
// 둘 다 **렌더 전용**이다: 스냅샷의 render-only 필드(visionRadius/safeRadius)만 읽고, sim·
// hashWorld/hashEntity 에 절대 접히지 않는다(결정론 골든 바이트 불변). 월드=화면 1:1 이므로
// (app.ts, 카메라 줌 없음) 화면 절반 대각선까지 덮으면 뷰포트 구석이 채워진다. `fog` Graphics 는
// 카메라 팬 레이어 안에 있어 월드 좌표로 그린다.
// ---------------------------------------------------------------------------

/** 화면 절반 대각선(월드 유닛=px). 오버레이가 뷰포트 구석까지 덮도록 외곽 반경 상한에 쓴다. */
const HALF_DIAGONAL = Math.hypot(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);

/** 시야 암흑 색(거의 검정, 살짝 남색). */
export const VISION_FOG_COLOR = 0x05070d;
/** 시야 암흑 최대 알파(가장자리). 완전 불투명을 피해 소프트 비네트로 읽힌다. */
export const VISION_FOG_MAX_ALPHA = 0.85;

/**
 * 추격 시야 암흑(플레이어=카메라 중심 기준). 반경 안은 투명, 밖은 반경→외곽으로 알파가 오르는
 * 동심 밴드 비네트. 반경이 화면 절반 대각선보다 크면 화면 전체가 시야 안이라 밴드가 화면 밖에만
 * 걸려 아무것도 안 보인다(밸런스가 반경을 줄이면 자연히 암흑이 나타난다). 순수 그리기(상태 무변경).
 */
export function drawVisionFog(g: Graphics, cx: number, cy: number, radius: number): void {
  const outer = radius + HALF_DIAGONAL + 40; // 화면 구석까지 확실히 덮는다
  const band = 24;
  for (let r = radius; r < outer; r += band) {
    const t = (r - radius) / (outer - radius); // 0..1
    const alpha = Math.min(VISION_FOG_MAX_ALPHA, t * VISION_FOG_MAX_ALPHA * 1.7);
    g.circle(cx, cy, r + band).stroke({ color: VISION_FOG_COLOR, width: band + 2, alpha });
  }
}

// ---------------------------------------------------------------------------
// 대피소 표식(추격 Lane6)
//
// 대피소 링 반경은 1600 월드 유닛인데 화면은 1920×1080(월드=화면 1:1, 카메라 줌 없음)이라
// **대피소는 대개 화면 밖에 있다**. 게다가 6개가 전부 같은 스프라이트로 서 있고 전진 게이트는
// `aux0 === segmentIndex` 인 하나뿐이라, 화면만 봐서는 어디로 가야 하는지 알 수 없었다
// (사용자 신고 2026-07-27 "대피소가 어디인지 잘 보이지 않음"). 세 가지로 나눠 답한다:
//   ① 활성 대피소 = 맥동 링으로 강조, 비활성 = 톤 다운 → 가까이 가면 어느 것이 목표인지 즉시 읽힌다.
//   ② 화면 밖이면 카메라 중심 둘레에 **방향 화살표** → 어느 쪽으로 달릴지 항상 보인다.
//   ③ 레이더 `objective` 블립(radar.ts) → 사거리 밖이면 테두리 화살표로 방향.
// 전부 렌더 전용(스냅샷 `active` 만 읽는다) — sim·해시 무관.
// ---------------------------------------------------------------------------

/** 활성 대피소(이번 세그먼트 목표) 강조 색 — 레이더 objective 와 같은 연두. */
export const SHELTER_ACTIVE_COLOR = 0x7dff5a;
/** 비활성 대피소 링 색(존재만 알리는 톤). */
export const SHELTER_IDLE_COLOR = 0x4a6a80;
/** 화면 밖 대피소 화살표를 띄우는 카메라 중심 반경(월드 유닛 = px). */
export const SHELTER_ARROW_RADIUS = 260;

/**
 * 화면 밖 활성 대피소를 가리키는 화살표의 위치·각도. 대피소가 뷰포트(디자인 1920×1080) 안이면
 * null 을 돌려 화살표를 그리지 않는다(그 자리에 실물 대피소가 이미 보이므로). 순수 함수 —
 * 카메라·대상 좌표만의 함수라 vitest 로 단위 검증한다.
 */
export function shelterArrow(
  camX: number,
  camY: number,
  sx: number,
  sy: number,
): { x: number; y: number; angle: number } | null {
  const dx = sx - camX;
  const dy = sy - camY;
  // 뷰포트 안이면 화살표 불요(살짝 여유를 둬 가장자리에서 깜빡이지 않게 한다).
  const margin = 80;
  if (Math.abs(dx) <= DESIGN_WIDTH / 2 - margin && Math.abs(dy) <= DESIGN_HEIGHT / 2 - margin) {
    return null;
  }
  const angle = Math.atan2(dy, dx);
  return {
    x: camX + Math.cos(angle) * SHELTER_ARROW_RADIUS,
    y: camY + Math.sin(angle) * SHELTER_ARROW_RADIUS,
    angle,
  };
}

/** 안전 반경 경계 링 색(시안 — 아군/안전 톤). */
export const SAFE_RING_COLOR = 0x39d0ff;
/** 안전 반경 밖 압박존 색(어두운 적자). */
export const SAFE_PRESSURE_COLOR = 0x2a0812;
/** 압박존 최대 알파. */
export const SAFE_PRESSURE_MAX_ALPHA = 0.62;

/**
 * 수축 안전 반경(아레나 중심 = 월드 원점 0,0 기준). 경계에 맥동하는 시안 링을 긋고, 반경 밖을
 * 적자 압박존으로 어둡게 한다(배틀로얄식). 압박존은 카메라 위치를 반영해 화면에 보이는 "밖"
 * 영역까지 덮는다(원점→카메라 거리 + 화면 절반 대각선). 순수 그리기(상태 무변경).
 */
export function drawSafeZone(
  g: Graphics,
  camX: number,
  camY: number,
  radius: number,
  frameTick: number,
): void {
  // 경계 링(맥동) — 줄어드는 가장자리가 눈에 읽힌다.
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.08);
  g.circle(0, 0, radius).stroke({ color: SAFE_RING_COLOR, width: 4, alpha: 0.5 + 0.35 * pulse, alignment: 0 });
  g.circle(0, 0, radius - 3).stroke({ color: 0xffffff, width: 1.5, alpha: 0.28, alignment: 0 });
  // 압박존: 반경 밖을 어둡게. 화면에 보이는 최원거리까지 덮되 밴드 수를 120 으로 상한(성능).
  const need = Math.hypot(camX, camY) + HALF_DIAGONAL + 40;
  const outer = Math.max(radius + 200, need);
  const band = Math.max(24, (outer - radius) / 120);
  for (let r = radius; r < outer; r += band) {
    const t = (r - radius) / (outer - radius); // 0..1
    const alpha = Math.min(SAFE_PRESSURE_MAX_ALPHA, t * 1.1);
    g.circle(0, 0, r + band).stroke({ color: SAFE_PRESSURE_COLOR, width: band + 2, alpha });
  }
}

export class EntityRenderer {
  readonly layer = new Container();
  private readonly sprites = new Map<number, TrackedSprite>();
  /**
   * 발광(글로우/블룸 헤일로) 레이어 — 가산 blend, 스프라이트 **아래**에 그려 발광이 불투명
   * 코어·탄막을 덮지 않게 한다(탄막 가독성 계약). Phase 0(현재)에서는 **빈 상태**(자식 0)로만
   * 두어 렌더 출력·골든 해시가 불변이다 — 발광 이펙트 배선은 Phase 3 몫이다. blend 설정과 draw
   * order 삽입, "glow=아래·폭발=위" 비대칭 규율(AC-0.8)은 생성자 주석이 정본이다.
   */
  private readonly glowLayer = new Container();
  /**
   * 발광체 id → glowLayer 헤일로 Container(AC-3.1). 발광체(isGlowEmitter)마다 하나를 유지한다:
   * 첫 등장 시 {@link buildGlowHalo} 로 만들어 glowLayer.addChild, 매 프레임 엔티티 보간 위치로
   * 미러(헤일로는 스프라이트와 별개 레이어라 좌표 동기 필요), 소멸·발광체 아님·헤일로 게이트
   * off 시 removeChild+destroy. {@link sprites} 캐시와 평행한 생명주기다.
   */
  private readonly glowHalos = new Map<number, Container>();
  /**
   * 접지 그림자 레이어 — 곱연산, **지형 오버레이 위 · 스프라이트 아래**. 그림자는 빛의 차폐라
   * 곱연산이고(색을 더하는 게 아니라 바닥을 누른다), 지형·해저드 위에 얹혀야 "지면에 떨어진
   * 그림자"로 읽힌다. glowLayer 보다 아래라 발광 헤일로가 자기 그림자에 눌리지 않는다.
   *
   * 컨테이너 단위 blend 라 겹친 그림자가 이중으로 어두워지지 않는다(glowLayer 가산 규율과 동형).
   */
  private readonly shadowLayer = new Container();
  /**
   * 엔티티 id → 접지 그림자 Container. {@link glowHalos} 와 **완전히 평행한 생명주기**다:
   * 첫 등장 시 굽고, 매 프레임 보간 위치로 미러하고, 소멸·테마 없음·상한 초과 시 회수한다.
   *
   * ⚠️ 그림자는 스프라이트의 **자식이 아니라 형제**다(Pixi v8 `Sprite.addChild` deprecate).
   * 형제는 부모 `destroy` 로 회수되지 않으므로 킬 루프·reset·destroy 가 명시 회수해야 누수가
   * 0 이다 — 히트 플래시 오버레이·낙하산·이름표가 밟았던 자리와 같다.
   */
  private readonly groundShadows = new Map<number, GroundShadowEntry>();
  /**
   * 이번 런의 환경 테마(그림자 광원 정본). `null` = 담당 테마 없음 → 그림자를 **한 개도** 안 그린다.
   *
   * `curr.planet` 에서 못 읽는다 — 침공 런의 `config.planet` 은 항상 0(카르곤)이고 환경 테마는
   * **합성 인덱스**(6·7·8)를 쓰기 때문이다(`themes/invasion/index.ts` 의 `invasionEnvPlanet`).
   * 그래서 `env.configure` 와 **같은 인덱스**를 main.ts 가 {@link setEnvPlanet} 으로 먹인다
   * (`setEncounterType` 과 같은 imperative 훅 규율). 두 소스가 갈리면 화면에 태양이 둘이 된다.
   */
  private envTheme: EnvTheme | null = null;
  /**
   * High 티어 타이트 블룸 필터(AC-3.1) — **지연 1회 생성**해 캐시한다. undefined=아직 미생성,
   * Filter=생성 성공, null=GL 부재/컴파일 실패 폴백(헤일로만, AC-3.6). 매 프레임 재생성 금지
   * ({@link syncGlowBloom} 이 캐시·전이만 관리한다).
   */
  private glowBloom: Filter | null | undefined = undefined;
  /** glowLayer.filters 에 블룸이 현재 붙어 있는지 — 게이트 전이 시에만 filters 배열을 재설정하기 위한 상태. */
  private glowBloomAttached = false;
  /**
   * 해저드 렌더 호스트(구 `drawOverlay` 의 장판 루프). 재질 레이어({@link HazardHost.view})는
   * 생성자가 장판 오버레이 **위** · 스프라이트 **아래**에 끼운다. 재질 팩토리가 하나도 등록되지
   * 않으면 자식 0 인 빈 컨테이너라 화면이 불변이다(glowLayer Phase 0 과 같은 규율).
   */
  private readonly hazardHost = new HazardHost();
  private readonly spriteLayer = new Container();
  /**
   * 이름표 레이어 — 스프라이트 **위**, 이펙트 **아래**. 위에 둬야 겹친 스프라이트에 이름이
   * 가려지지 않고, 이펙트 아래라 폭발·충격파가 이름표를 덮는 기존 연출 우선순위는 유지된다.
   */
  private readonly labelLayer = new Container();
  private readonly effectLayer = new Container();
  /**
   * 살아 있는 파편 폭발(ShardBurst) 목록. 기존 단일 스프라이트 페이드(`effects[]`)를 대체한다
   * (AC-2.4). 각 burst.container 는 effectLayer(스프라이트 **위**)에 붙고, `update(dt)` 가 false 를
   * 돌려주면 effectLayer 에서 떼고 destroy 한다. render-only.
   */
  private readonly bursts: ShardBurst[] = [];
  /**
   * 살아 있는 충격파 링(ShockwaveEffect) 목록(AC-3.3). 보스·대형 폭발 킬 순간 {@link layer}(카메라
   * 팬 레이어) 전체에 짧은 원형 왜곡을 건다. 저빈도(보스/대형)라 가독 레이어 순간 왜곡을 허용한다
   * (plan 규율). 각 원샷은 `update(dt)` 가 false 를 돌려주면 destroy(자기 필터만 detach)+splice.
   * eventShaders 게이트(High 티어) off 면 아예 생성되지 않는다.
   */
  private readonly shockwaves: ShockwaveEffect[] = [];
  /**
   * 사망 디졸브 중인 스프라이트 목록(AC-3.4). eventShaders on 이고 전투체(explosionScale>0)가 죽으면
   * 즉시 destroy 대신 여기로 수명을 이관한다: 스프라이트는 spriteLayer 에 잔류한 채 {@link DissolveEffect}
   * 가 디더 알파로 소멸시키고, 완료(update→false)되면 그때 sprite.destroy 한다. {@link sprites} Map
   * 에서는 즉시 빼(중복 렌더·재추적 방지) 수명만 이 목록으로 넘긴다. {@link MAX_DISSOLVES} 초과분은
   * 이관하지 않고 즉시 destroy(폭탄 밀도 성능 방어).
   */
  private readonly dyingSprites: { sprite: Sprite; effect: DissolveEffect }[] = [];
  /**
   * 용암 해저드 히트 시머(AC-3.2) — 지속형. eventShaders on 이고 스냅샷에 용암 해저드가 있는 동안만
   * {@link overlay}(해저드/빔/예고선 Graphics)에 국소 변위 필터를 부착한다. 용암이 사라지거나 게이트
   * 가 꺼지면 detach 하고 null 로 되돌린다. null = 미부착. GL 부재(node)면 필터가 null 폴백이라
   * update 가 no-op 이지만 부착/detach 수명은 동일하게 관리된다(AC-3.6).
   */
  private shimmer: ShimmerEffect | null = null;
  /**
   * effectLayer 원샷 이펙트 목록(Phase 4, AC-4.1/4.5/4.6/4.7). 데미지 숫자·그레이징 스파크·수집 팝·
   * 레벨업 링·머즐 플래시가 {@link OneShotEffect} 계약으로 함께 산다. {@link updateOneShots} 가 dt 로
   * 진행하고 update→false 인 것을 effectLayer 에서 떼고 destroy 한다(ShardBurst 동형). {@link MAX_ONESHOTS}
   * 상한으로 탄막 밀도·연사에서 무한 성장 방어. 전부 render-only.
   */
  private readonly oneShots: OneShotEffect[] = [];
  /**
   * 탄 트레일(AC-4.4) — 탄 id → BulletTrail. 살아있는 트레일 대상 탄(isTrailBullet)마다 하나를 유지하며
   * 엔티티 루프가 매 프레임 보간 위치를 먹이고(update(dt,x,y)), 탄이 사라지면 잔상만 페이드해 소진 시
   * 회수한다. effectLayer(월드 좌표계). update 시그니처가 위치를 받아 oneShots 와 별도 관리한다.
   */
  private readonly bulletTrails = new Map<number, BulletTrail>();
  /** 그레이징 스파크 rising-edge 게이트(AC-4.5) — 탄 id 별 근접 진입 순간 1회만 발화(매 프레임 재발화 방지). */
  private readonly grazeTracker = new GrazeTracker();
  /**
   * 레벨업 링 대기 플래그(AC-4.6). main.ts 가 레벨 델타를 감지해 {@link pulseLevelUp} 을 부르면 켜지고,
   * 다음 render 가 플레이어 위치를 확정하는 시점에 링을 방출하고 되돌린다(스냅샷엔 level 이 없어 렌더가
   * 위치를 모르므로 imperative 신호 → 다음 프레임 배치). render-only.
   */
  private pendingLevelUp = false;
  /** 화면 흔들림 트라우마 컨트롤러(AC-2.1). render-only 파생 — sim 되먹임 없음(카메라 오프셋만). */
  private readonly trauma = new TraumaController();

  /**
   * 이번 프레임 플레이어 헤일로의 이방성 변환(레인 A ⑤). 플레이어 스냅샷 델타에서 파생하며
   * 플레이어가 화면에 없으면 `null` 이다. 다른 발광체는 이 값을 절대 안 받는다.
   */
  private playerAniso: HaloAniso | null = null;
  /** 직전 프레임 플레이어 대시 여부 — 대시 트라우마는 **상승 에지**에서만 한 번 발화한다. */
  private playerWasDashing = false;
  /** 직전 render 벽시계(ms). 프레임 델타 자체 추적용(render 는 dt 를 받지 않음). undefined=첫 프레임. */
  private lastFrameMs: number | undefined = undefined;
  private readonly overlay = new Graphics();
  /**
   * 용암 해저드 **전용** 오버레이 Graphics(AC-3.2 히트 시머 대상). 시머(변위 필터)는 이 컨테이너
   * 에만 붙어 용암류만 국소로 흔든다 — {@link overlay}(빔·비-용암 해저드·관통 예고선을 함께 그림)에
   * 붙이면 회피 판정에 직결되는 **박격/레일 예고선까지 흔들려 가독성이 무너진다**(리뷰 MEDIUM).
   * {@link overlay} 바로 **아래**에 깔아(스프라이트보다 아래) 예고선·비-용암 해저드가 용암 위에
   * 또렷이 남게 한다. render-only — sim/해시 무관.
   */
  private readonly lavaOverlay = new Graphics();
  /**
   * 필드 오버레이(시야 암흑·안전 반경 압박존). **엔티티 스프라이트보다 위**에 그려 시야 밖 적을
   * 어둡게 가린다(hazard 오버레이는 아래). 렌더 전용 — sim/해시와 무관하며 스냅샷의 render-only
   * 필드(visionRadius·safeRadius)만 읽는다(결정론 골든 불변).
   */
  private readonly fog = new Graphics();
  private frameTick = 0;
  /** Active planet index (from the current snapshot) — selects boss art. */
  private planet = 0;
  /**
   * 이번 런의 조우 유형(`ENCOUNTER_TYPE` 값, 미발생·침공이면 0). **포탈 kind 하나가 보물 격실
   * 포탈과 봉인석 둘 다를 실어 나르므로**(사유는 {@link spriteSlotFor} 의 `encounterPortal`
   * 분기) 어느 아트를 쓸지 이 값으로 가른다.
   *
   * planet 처럼 스냅샷에서 읽지 **못한다** — 스냅샷 필드를 늘리려면 `src/sim/snapshot.ts` 를
   * 건드려야 하는데 이 레인은 render-only 이기 때문이다. 대신 main.ts 가 매 프레임
   * {@link setEncounterType} 로 먹인다(레벨업 링 `pulseLevelUp` 과 같은 imperative 훅 규율).
   */
  private encounterType = 0;
  /** 기체가 마지막으로 향한 각도(대상·이동이 없을 때 유지). shipFacing 참조. */
  private lastPlayerAngle = 0;
  /**
   * 루프 애니메이션 시계(초). 렌더 프레임 dt 를 누적한 render-only 값 — sim tick 과 무관하다
   * (배속·일시정지와 독립적으로 아트가 계속 살아 움직인다). reset 에서 0 으로 되돌린다.
   */
  private animClock = 0;

  /**
   * 런타임 3D 무대(오프스크린 three.js → 아틀라스 텍스처, `three3d/stage3d.ts`).
   *
   * **지연 생성**이다 — 보스가 화면에 처음 등장하고 티어 게이트(`gates.model3d`)가 열릴 때만
   * 만든다. 대부분의 런은 보스 조우 전에 끝나거나 저티어라, 여기서 WebGL 컨텍스트를 미리
   * 잡으면 아무 이득 없이 컨텍스트 하나를 상시 점유하게 된다.
   *
   * null 인 채로 남는 경우(GL 미지원·컨텍스트 소진·자산 없음)에는 기존 PNG 스프라이트가
   * 그대로 쓰인다 — 3D 는 덧붙임이라 실패해도 보스가 사라지지 않는다.
   */
  private stage3d: Stage3D | null = null;
  private bossActor: BossActor | null = null;
  /**
   * 현재 액터가 어느 행성 모델로 로드됐는가(로드 중인 것도 포함). 보스 모델은 행성마다 다르므로
   * 이 값이 {@link planet} 과 갈라지면 모델을 갈아탄다. 시도 자체를 기록하기 때문에 **실패도 1회로
   * 끝난다**(매 프레임 재시도 금지) — 같은 행성으로 다시 들어오지 않는 한 재시도하지 않는다.
   *
   * 런 중에 행성이 바뀌지는 않으므로 실제 교체는 **다음 런**에서만 일어난다. 그래서 아틀라스
   * 슬롯은 `boss` 한 칸으로 충분하다(행성 6칸으로 늘릴 이유가 없다).
   */
  private boss3dPlanet: number | null = null;

  /**
   * 플레이어 기체 3D 액터(`three3d/shipActor.ts`). 보스와 **같은 무대·다른 슬롯**을 쓴다.
   *
   * ⚠️ 보스와 달리 기체는 런 내내 화면에 있으므로, 이 액터가 준비되는 순간부터 아틀라스 업로드가
   * **매 프레임** 일어난다(보스는 보스 세그먼트에서만). 그래서 티어 게이트(`gates.model3d`) 뒤에
   * 있는 것이 보스보다 더 중요하다.
   */
  private shipActor: ShipActor | null = null;
  /**
   * 현재 액터가 어느 기체 타입으로 로드됐는가(로드 중 포함). 시도 자체를 기록하기 때문에 **실패도
   * 1회로 끝난다**(매 프레임 재시도 금지). 런 중에 기체는 안 바뀌므로 실제 교체는 **다음 런**에서만
   * 일어난다 — 그래서 아틀라스 슬롯은 `player` 한 칸으로 충분하다.
   */
  private ship3dType: number | null = null;
  /**
   * 이번 런의 기체 타입. 스냅샷에서 못 읽는다(`EntitySnapshot` 에 `typeId` 가 없고, 넣으려면 sim
   * 표면을 넓혀야 한다) — {@link setShipType} 으로 main.ts 가 먹인다(`setEncounterType` 과 같은
   * imperative 훅 규율).
   */
  private shipType = 0;
  /** 이번 프레임 기체가 3D 로 구동됐는가. 장식자 맥락(`AdornerContext.ship3d`)의 소스다. */
  private shipDriven3d = false;

  constructor(private readonly textures: PlaceholderTextures) {
    // Draw order (bottom → top): lava overlay (시머 대상), hazard/beam overlay, [glow halos],
    // entity sprites, death bursts, then the field overlay (시야 암흑·안전 반경) on top so it dims
    // out-of-vision entities. lavaOverlay 는 overlay **아래**라 예고선·비-용암 해저드가 용암 위에
    // 또렷이 남는다(시머 국소화 — 예고선 가독성 계약).
    //
    // ── 발광 비대칭 규율 (AC-0.8 / ADR-0031) ────────────────────────────────
    // glowLayer 는 스프라이트 **아래**다: 발광 헤일로가 불투명 코어·탄막을 덮으면 판정점
    // 가독성이 무너진다(탄막 가독성 계약 — 흰 코어+유색 아웃라인, 색=거동). 정확히 반대로
    // 폭발 파티클(effectLayer)은 스프라이트 **위**다 — 사망 유닛 위 순간 폭발은 가독 레이어를
    // 잠깐 덮어도 허용되고(살아있는 적 피드백은 tint 방식이라 안전), 그래야 폭발이 읽힌다.
    // 요컨대 **glow=아래(스프라이트 밑), 폭발/effectLayer=위(스프라이트 위)** — 이 비대칭을
    // 깨서 glow 를 스프라이트 위로 올리거나 effectLayer 를 아래로 내리지 말 것.
    //
    // glowLayer 는 가산 blend(additive) Container 이며, Phase 0(현재)에서는 **빈 상태**(자식
    // 0)로만 둔다 → 빈 컨테이너는 아무것도 그리지 않으므로 렌더 출력·골든 해시가 불변이다
    // (발광 이펙트 배선은 Phase 3 몫). fog 는 계속 최상단이라 필드 오버레이 계약도 그대로다.
    this.glowLayer.blendMode = 'add';
    this.layer.addChild(this.lavaOverlay);
    // 해저드 재질 레이어 — 용암 채움 **위**, 비-용암 오버레이(예고선 포함) **아래**. 재질이
    // 예고선을 덮으면 회피 판정 가독성이 무너진다(시머 국소화 계약과 같은 이유).
    this.layer.addChild(this.hazardHost.view);
    this.layer.addChild(this.overlay);
    // 접지 그림자는 지형·해저드 오버레이 **위**, 발광 헤일로·스프라이트 **아래**다. 위 발광
    // 비대칭 규율의 연장선이며 이유는 {@link shadowLayer} 주석이 정본이다.
    this.shadowLayer.blendMode = 'multiply';
    this.layer.addChild(this.shadowLayer);
    this.layer.addChild(this.glowLayer);
    this.layer.addChild(this.spriteLayer);
    this.layer.addChild(this.labelLayer);
    this.layer.addChild(this.effectLayer);
    this.layer.addChild(this.fog);
  }

  /**
   * 현재 살아 있는 사망 연출(폭발) 개수. **읽기 전용 관측창** — 렌더 거동에 전혀 관여하지 않고
   * 상태를 노출만 한다. 정지 1프레임 렌더(방어 배치 프리뷰)는 이펙트가 페이드아웃될 프레임을
   * 얻지 못해 누적이 눈에 보이는 결함이 되므로, 그 계약을 테스트가 수치로 못 박을 수 있어야 한다.
   *
   * Phase 2(AC-2.4)에서 사망 폭발이 단일 스프라이트 → 파편 버스트(ShardBurst)로 바뀌었지만,
   * "살아 있는 사망 폭발 개수"라는 의미는 그대로다 — 이제 {@link bursts} 길이를 센다. burst 하나가
   * effectLayer 자식 하나(container)라 `effectLayer.children.length` 와도 일치한다.
   */
  get effectCount(): number {
    return this.bursts.length;
  }

  /**
   * 현재 화면 흔들림 트라우마([0,1]). **읽기 전용 관측창** — 흔들림 배선(AC-2.1)이 실제로 트리거를
   * 받는지 자동 통합 테스트가 수치로 확인할 수 있게 노출한다. 렌더 거동에는 관여하지 않는다.
   */
  get shakeTrauma(): number {
    return this.trauma.getTrauma();
  }

  /**
   * 현재 히트 플래시 가산 오버레이가 붙어 있는 스프라이트 수. **읽기 전용 관측창** — 히트 플래시
   * 배선(AC-2.3)이 tint 상태값이 아니라 **실제 가산 오버레이**(spriteLayer 형제)를 만들고(가시
   * 메커니즘) 창 종료 시 회수하는지 자동 통합 테스트가 수치로 확인하게 노출한다. 렌더 거동에는
   * 관여하지 않는다.
   */
  get hitFlashOverlayCount(): number {
    let n = 0;
    for (const t of this.sprites.values()) if (t.flashOverlay !== null) n++;
    return n;
  }

  /**
   * 현재 살아 있는 충격파 링 개수(AC-3.3). **읽기 전용 관측창** — 보스·대형 폭발 킬이 실제로
   * 충격파를 방출하는지, eventShaders off 에선 하나도 안 생기는지 자동 통합 테스트가 수치로
   * 확인하게 노출한다. 렌더 거동에는 관여하지 않는다.
   */
  get shockwaveCount(): number {
    return this.shockwaves.length;
  }

  /**
   * 현재 디졸브 소멸 중인 스프라이트 개수(AC-3.4). **읽기 전용 관측창** — eventShaders on 에서
   * 전투체 사망이 즉시 destroy 되지 않고 디졸브로 이관되는지(그리고 완료 후 정리되는지)를 자동
   * 통합 테스트가 수치로 확인하게 노출한다. 렌더 거동에는 관여하지 않는다.
   */
  get dyingCount(): number {
    return this.dyingSprites.length;
  }

  /**
   * 용암 해저드 시머가 현재 부착돼 있는가(AC-3.2). **읽기 전용 관측창** — 용암 스냅샷 + High 티어
   * 에서 시머가 붙고, 용암이 없거나 게이트 off 면 떨어지는지 자동 통합 테스트가 확인하게 노출한다.
   * 렌더 거동에는 관여하지 않는다.
   */
  get shimmerActive(): boolean {
    return this.shimmer !== null;
  }

  /**
   * 현재 살아 있는 접지 그림자 개수. **읽기 전용 관측창** — 테마가 있는 행성에서 부피 있는
   * 실체에만 그림자가 붙고, 소멸 시 회수되며(형제라 부모 destroy 로 안 걷힌다 — 누수 자리),
   * 테마 없는 행성에선 0 인지를 자동 통합 테스트가 수치로 못 박게 노출한다. 렌더 거동에는
   * 관여하지 않는다.
   */
  get groundShadowCount(): number {
    return this.groundShadows.size;
  }

  /**
   * 현재 살아 있는 장식자 개수. **읽기 전용 관측창** — 등록된 kind 에만 붙고, 소멸·reset·destroy
   * 에서 회수되는지(형제 컨테이너라 부모 destroy 로 안 걷힌다 — 누수 자리)를 자동 통합 테스트가
   * 수치로 못 박게 노출한다. 렌더 거동에는 관여하지 않는다.
   */
  get adornerCount(): number {
    let n = 0;
    for (const t of this.sprites.values()) n += t.adorners.length;
    return n;
  }

  /** 현재 살아 있는 해저드 재질 묶음 수(읽기 전용 관측창). */
  get hazardMaterialCount(): number {
    return this.hazardHost.materialCount;
  }

  /**
   * 플레이어 스프라이트를 `spriteLayer` 최상단으로 올린다. 근거는 호출부 주석에 있다.
   *
   * 플레이어에 딸린 형제(히트 플래시 오버레이 등)가 `spriteLayer` 에 있으면 그것도 함께 올려
   * 순서를 보존한다 — 오버레이가 본체보다 아래로 내려가면 가산 번쩍임이 실루엣에 안 얹힌다.
   */
  private raisePlayerSprite(sprite: Sprite): void {
    const layer = this.spriteLayer;
    const last = layer.children.length - 1;
    if (last < 0) return;
    if (layer.children[last] !== sprite) layer.setChildIndex(sprite, last);
  }

  /** 플레이어가 스프라이트 레이어 최상단인가(읽기 전용 관측창 — z 우선순위 회귀 가드). */
  get playerOnTop(): boolean {
    const kids = this.spriteLayer.children;
    if (kids.length === 0) return false;
    for (const t of this.sprites.values()) {
      if (t.kind === 'player') return kids[kids.length - 1] === t.sprite;
    }
    return false;
  }

  /**
   * 현재 살아 있는 발광 헤일로 개수. **읽기 전용 관측창.**
   *
   * 배선 테스트가 `glowLayer.children.length` 를 절대값으로 재던 것을 이 창으로 옮겼다.
   * 자식 수는 **그 레이어에 사는 다른 거주자와 결합한다** — 장식자(`src/render/entity/`)가
   * 발광 레이어에 무엇이든 그리는 순간, 헤일로와 무관한 이유로 "헤일로 배선" 단언이 빨개진다.
   * 자식을 안 만들면 화면에도 없으므로 장식자 쪽에서는 피할 방법이 없다.
   *
   * 그래서 단언을 **헤일로만 세는 창**으로 옮겨 결합을 끊는다. 잃는 것은 없다 — 원래 그 테스트가
   * 물으려던 질문이 "발광체 수만큼 헤일로가 붙었는가"이지 "레이어에 자식이 몇인가"가 아니다.
   */
  get glowHaloCount(): number {
    return this.glowHalos.size;
  }

  // ── Phase 4 관측창(읽기 전용) — 자동 배선 통합 테스트가 각 이펙트 트리거의 실효를 수치로 못 박는다
  //    (#1 반복결함 "유닛 그린인데 배선 없음" 방어). 렌더 거동에는 관여하지 않는다.

  /** 현재 살아있는 데미지 숫자 개수(AC-4.1). 보스·엘리트 피격/처치가 실제로 숫자를 띄우는지 검증. */
  get damageNumberCount(): number {
    let n = 0;
    for (const fx of this.oneShots) if (fx instanceof DamageNumber) n++;
    return n;
  }

  /** 현재 살아있는 탄 트레일 개수(AC-4.4). 트레일 대상 탄만 스트릭을 남기는지 검증. */
  get bulletTrailCount(): number {
    return this.bulletTrails.size;
  }

  /** 현재 살아있는 그레이징 스파크 개수(AC-4.5). 근접 회피 진입이 스파크를 내는지 검증. */
  get grazeSparkCount(): number {
    let n = 0;
    for (const fx of this.oneShots) if (fx instanceof GrazeSpark) n++;
    return n;
  }

  /** 현재 살아있는 수집 팝 개수(AC-4.6). gem/loot 소멸(수집)이 팝을 내는지 검증. */
  get pickupPopCount(): number {
    let n = 0;
    for (const fx of this.oneShots) if (fx instanceof PickupPop) n++;
    return n;
  }

  /** 현재 살아있는 레벨업 링 개수(AC-4.6). pulseLevelUp 신호가 링을 내는지 검증. */
  get levelUpRingCount(): number {
    let n = 0;
    for (const fx of this.oneShots) if (fx instanceof LevelUpRing) n++;
    return n;
  }

  /** 현재 살아있는 머즐 플래시 개수(AC-4.7). 신규 플레이어 탄 등장이 총구 섬광을 내는지 검증. */
  get muzzleFlashCount(): number {
    let n = 0;
    for (const fx of this.oneShots) if (fx instanceof MuzzleFlash) n++;
    return n;
  }

  /**
   * 레벨업 링 방출을 예약한다(AC-4.6). main.ts 가 런 레벨 델타(soundObserver 와 동일 신호)를 감지해
   * 부른다 — 스냅샷엔 level 이 없어 렌더가 레벨업을 스스로 감지 못 하므로 이 imperative 훅으로 받는다.
   * 실제 링은 다음 render 가 플레이어 보간 위치를 확정한 뒤 그 자리에 방출한다(위치 정합). render-only.
   */
  pulseLevelUp(): void {
    this.pendingLevelUp = true;
  }

  /**
   * 이번 런의 조우 유형을 렌더에 알린다(`ENCOUNTER_TYPE` 값, 미발생·관전·침공이면 0).
   * main.ts 가 매 프레임 sim 상태에서 읽어 먹인다 — 근거는 {@link encounterType} 주석.
   * render-only(sim·해시 무접촉).
   */
  setEncounterType(type: number): void {
    this.encounterType = type;
  }

  /**
   * 이번 런의 **기체 타입**을 먹인다(런타임 3D 모델 선택). `applyShipSprite` 와 **같은 값·같은
   * 지점**에서 부른다 — 2D 스프라이트와 3D 모델이 갈리면 화면의 기체와 손상 오버레이·컨투어가
   * 서로 다른 실루엣이 된다.
   *
   * 모델이 없는 타입이면 아무 일도 일어나지 않고 기존 2단 PNG 폴백이 그대로 쓰인다.
   */
  setShipType(typeId: number): void {
    this.shipType = typeId;
  }

  /**
   * 이번 런의 **환경 행성 인덱스**를 먹인다(접지 그림자 광원 정본). `null` 이면 그림자를 끄고
   * 남은 그림자를 전부 회수한다.
   *
   * **반드시 `env.configure({ planet })` 와 같은 값을 넘겨라** — 침공은 합성 인덱스(6·7·8)이고
   * `curr.planet`(항상 0)과 다르다. 두 소스가 갈리면 배경의 광원과 그림자의 광원이 어긋나
   * 화면에 태양이 둘이 된다(이 리포가 데칼↔지형광에서 이미 겪은 실패의 재현).
   * render-only(sim·해시 무접촉).
   */
  setEnvPlanet(planet: number | null): void {
    const next = planet === null ? null : (themeFor(planet) ?? null);
    if (next === this.envTheme) return;
    this.envTheme = next;
    // 테마가 바뀌면 광원이 바뀐 것이다 — 이전 광원으로 구운 그림자는 전부 버린다(다음 프레임에
    // 새 기하로 다시 굽는다). 남기면 오프셋만 옛 방향인 그림자가 그 런 내내 고정된다.
    this.clearGroundShadows();
  }

  /** 스냅샷 1건의 텍스처. 매핑 판단은 순수 함수({@link spriteSlotFor})가 하고 여기서는 해석만 한다. */
  private textureFor(e: EntitySnapshot): Texture {
    return resolveSpriteSlot(
      this.textures,
      spriteSlotFor(e.kind, e.enemyType, this.planet, this.encounterType),
    );
  }

  render(prev: WorldSnapshot, curr: WorldSnapshot, alpha: number): void {
    this.frameTick++;
    this.planet = curr.planet;

    // 프레임 델타(초) — render 는 dt 를 받지 않으므로 벽시계로 자체 추적한다(render-only 파생,
    // sim·해시 무관). 첫 프레임·비정상·탭 복귀는 nominal 또는 상한으로 클램프해 파티클·트라우마가
    // 순간이동하지 않게 한다. TraumaController.tick 과 ShardBurst.update 가 같은 dt 를 쓴다.
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let dt = this.lastFrameMs === undefined ? NOMINAL_DT : (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    if (!Number.isFinite(dt) || dt <= 0) dt = NOMINAL_DT;
    else if (dt > MAX_RENDER_DT) dt = MAX_RENDER_DT;
    this.animClock += dt; // 루프 애니메이션 시계(엔티티 루프가 프레임 인덱스를 뽑는다)

    // 이펙트 게이트(티어 × 감소 토글) — 프레임당 1회만 산출해 흔들림·히트 플래시·발광이 공유한다.
    const settings = graphicsSettings.getSettings();
    const tier = graphicsTierController.getActiveTier();
    const gates = effectGates(tier, settings);
    // 기체 3D 액터를 **장식자 맥락보다 먼저** 준비한다. 맥락의 `ship3d` 가 이 결과를 실어야
    // 플레이어 장식자가 같은 프레임에 자기 몫을 물릴 수 있다(한 프레임 늦으면 뱅킹이 이중으로
    // 걸린 프레임이 섞인다). `ensureShip3D` 는 타입이 그대로면 즉시 반환한다.
    if (gates.model3d) this.ensureShip3D();
    this.shipDriven3d = gates.model3d && (this.shipActor?.isReady ?? false);
    // 장식자·해저드 재질 맥락 — 프레임당 **한 번**만 만들어 전 장식자가 공유한다(엔티티 수만큼
    // 게이트를 재산출하지 않는다).
    const adornCtx = this.adornerCtx(gates, tier, dt, alpha);
    const hazardCtx = this.hazardCtx(gates, tier, dt);
    // 데미지 숫자(AC-4.1)는 티어 예산이 아니라 순수 사용자 토글이라 effectGates 밖에서 직접 읽는다.
    const showDamageNumbers = settings.damageNumbers;

    // 발광체 블룸(High 티어 1패스, AC-3.1) — 필터는 지연 1회 생성해 캐시하고 게이트 전이 시점에만
    // glowLayer.filters 를 재설정한다(매 프레임 재생성/재배열 금지). null 폴백(GL 없음)이면 헤일로만.
    this.syncGlowBloom(gates.bloom);
    // 헤일로 게이트가 꺼지면(Low·reducedGlow) 남은 헤일로를 전부 회수한다(발광 0). 켜져 있으면
    // 엔티티 루프가 발광체별로 헤일로를 생성·미러하고, 킬 루프가 소멸분을 제거한다.
    if (!gates.halo) this.clearGlowHalos();

    this.drawOverlay(curr, hazardCtx);
    this.drawFieldOverlays(curr);
    this.updateBursts(dt);
    // 이벤트 셰이더 원샷 진행(충격파·디졸브) — updateBursts 와 동형. 이번 프레임에 킬 루프가 새로
    // 생성하는 원샷은 다음 프레임부터 진행된다(생성 시점이 이 호출 뒤라 dt 이중 적용 없음).
    this.updateShockwaves(dt);
    this.updateDyingSprites(dt);
    // 원샷 부가 이펙트(데미지 숫자·그레이징·수집 팝·레벨업 링·머즐 플래시, Phase 4) 진행. 이번 프레임에
    // 엔티티/킬 루프가 새로 만드는 것은 다음 프레임부터 진행된다(생성이 이 호출 뒤 — dt 이중 적용 없음,
    // updateBursts 와 동형).
    this.updateOneShots(dt);
    // 용암 해저드 히트 시머(지속형, AC-3.2) — eventShaders on 이고 용암이 화면에 있는 동안만 부착.
    // overlay 는 이미 이번 프레임 drawOverlay 로 다시 그려졌다(시머는 그 위 필터).
    this.syncShimmer(gates.eventShaders && hasLavaHazard(curr), dt);

    // 카메라 팬(순수 보간) — 킬 루프의 충격파 center(스크린 정규화) 계산에 미리 쓰고, 프레임 끝에서
    // 흔들림 오프셋만 더해 layer.position 에 적용한다. prev/curr/alpha 만의 함수라 위치를 앞당겨도
    // 결과가 불변이다(트라우마 흔들림 sh 만 루프 뒤에서 가산).
    const camX = prev.cameraX + (curr.cameraX - prev.cameraX) * alpha;
    const camY = prev.cameraY + (curr.cameraY - prev.cameraY) * alpha;

    const prevById = new Map<number, EntitySnapshot>();
    for (const e of prev.entities) prevById.set(e.id, e);

    // Phase 4 프레임 누적기 — 엔티티 루프가 채우고, 루프 뒤 후처리(트레일 페이드·그레이징·머즐·레벨업)가 읽는다.
    let playerX = 0;
    let playerY = 0;
    let playerR = 0;
    let hasPlayer = false;
    /** 플레이어 스프라이트(루프 뒤 최상단으로 올리기 위해 잡는다 — {@link raisePlayerSprite}). */
    let playerSprite: Sprite | null = null;
    let newPlayerBullet = false; // 이번 프레임 신규 플레이어 탄 등장(머즐 플래시 근사, AC-4.7).
    const trailSeen = new Set<number>(); // 이번 프레임 살아있는 트레일 대상 탄 id(트레일 페이드 판정).

    for (const e of curr.entities) {
      if (e.kind === 'hazard') continue; // drawn in the overlay
      let tracked = this.sprites.get(e.id);
      if (tracked === undefined) {
        const sprite = new Sprite(this.textureFor(e));
        sprite.anchor.set(0.5);
        if (e.kind === 'wall') {
          // Walls render at their EXACT AABB (radius = half-width, aabbH =
          // half-height) — no ART_SCALE, so the cover the player sees matches the
          // collision box exactly.
          //
          // 무늬는 **반복**한다(늘리지 않는다) — 절차 벽은 크기를 굴려서 만들기 때문에 한 장을
          // AABB 로 늘리면 벽마다 무늬 배율이 달라 흐물거렸다(사용자 신고 2026-07-27).
          const w = e.radius * 2;
          const h = e.aabbH * 2;
          sprite.texture = tiledWallTexture(sprite.texture, w, h);
          sprite.setSize(w, h);
        } else if (e.kind === 'loot') {
          // Loot: fixed icon size (sim radius is the large pickup range, not the
          // glyph). Tint by rarity so the drop's grade always reads — whether the
          // sprite is the placeholder diamond or a neutral gold loot.png.
          sprite.setSize(LOOT_SIZE, LOOT_SIZE);
          sprite.tint = LOOT_TINT[e.enemyType] ?? LOOT_TINT[0] ?? 0xffffff;
        } else if (e.kind === 'bullet' && e.enemyType >= 0) {
          // 보조무기 직접 발사체: sub-type 코드로 색 구분(주무기 탄은 enemyType -1이라
          // 이 분기를 타지 않음). 크기는 일반 탄과 동일한 hitbox 기준.
          const size = e.radius * 2 * ART_SCALE;
          sprite.setSize(size, size);
          sprite.tint = SUB_BULLET_TINT[e.enemyType] ?? 0xffffff;
        } else {
          // Real sprites are 64/128px; scale to the sim hitbox so art matches
          // collisions (player r16 → 48px, matching the GDD ship size).
          //
          // 예외: 아군·이익 오브젝트는 sim radius 가 **트리거 반경**이라 그대로 환산하면 기체의
          // 몇 배로 부풀어 화면을 덮는다(포탑 픽업 r70 → 210px). displaySize 가 기체 크기(48px)로
          // 묶는다 — 사라진 반경 정보는 아래 트리거 링이 대신 그린다(friendlyDisplay.ts).
          const size = displaySize(e.kind, e.radius, ART_SCALE);
          sprite.setSize(size, size);
        }
        // 루프 애니메이션 프레임(있으면). 첫 텍스처는 위 `new Sprite(this.textureFor(e))` 가 이미
        // 정지 스프라이트로 잡아 뒀고, 아래 프레임 진행이 이번 프레임부터 바로 갈아 끼운다.
        const animSlot = animatedKindOf(e.kind);
        const animFrames = animSlot === null ? null : (this.textures.anim?.[animSlot] ?? null);
        // 이름표(아군·이익 오브젝트) — labelLayer 형제로 만든다. 라벨 없는 kind 면 null.
        // 포탑은 휴면/활성으로 이름이 갈리므로 스냅샷 `active` 를 함께 넘긴다.
        let label: Text | null = null;
        const labelText = friendlyLabel(e.kind, e.active);
        if (labelText !== null) {
          label = new Text({
            text: labelText,
            resolution: 2,
            style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: '700', fill: 0xdfe8ff },
          });
          label.anchor.set(0.5, 0);
          this.labelLayer.addChild(label);
        }
        // Supply drop: pin a parachute canopy above the transport when the
        // fx_parachute.png asset is present (render-only; no PNG → unchanged).
        // 낙하산은 부모 Sprite 의 **자식이 아니라 spriteLayer 형제**다(Pixi v8 Sprite.addChild
        // deprecate 회피). 자식일 때는 부모 스케일이 곱해져 표시됐으므로, 형제는 부모의 **표시
        // 치수**(sprite.width — 이미 위 setSize 로 확정)에 배수를 직접 곱해 같은 크기로 만든다.
        // 위치는 아래 엔티티 루프가 매 프레임 미러한다(생성 시엔 미배치 — 첫 미러에서 자리 잡는다).
        let chute: Sprite | null = null;
        if (e.kind === 'supply' && this.textures.parachute !== null) {
          chute = new Sprite(this.textures.parachute);
          chute.anchor.set(0.5, 1);
          const chuteSize = sprite.width * PARACHUTE_WIDTH_SCALE;
          chute.setSize(chuteSize, chuteSize);
        }
        this.spriteLayer.addChild(sprite);
        // 낙하산은 sprite **뒤에** 붙여 수송체 위에 렌더한다(기존 자식일 때의 상하 관계 보존).
        if (chute !== null) this.spriteLayer.addChild(chute);
        tracked = {
          sprite,
          seenTick: this.frameTick,
          kind: e.kind,
          flashUntilTick: 0,
          flashOverlay: null,
          chute,
          label,
          labelText: labelText ?? '',
          aimAngle: 0,
          animFrames,
          animPhase: animFrames === null ? 0 : phaseForEntity(e.id, animFrames.length),
          elite: e.elite >= 0,
          hp: e.hp,
          dmgAccum: 0,
          // 첫 피해가 즉시 방출되도록 스로틀 창을 이미 지난 값으로 초기화.
          dmgEmitTick: this.frameTick - DAMAGE_NUMBER_THROTTLE_FRAMES,
          // 장식자 생성(비주얼 레인 확장). 등록된 팩토리가 없으면 공유 빈 배열이라 비용 0.
          adorners: createAdorners(e),
        };
        this.sprites.set(e.id, tracked);
        for (const ad of tracked.adorners) ad.onAttach?.(sprite, e, adornCtx);
        // 머즐 플래시(AC-4.7) — 신규 **플레이어 탄**('bullet', 주무기·보조 포함) 등장 = 발사. 프레임당
        // 1회 총구 섬광으로 근사한다(정밀 위치·연사별 개별 섬광은 범위 밖). 적탄('enemyBullet')은 제외.
        if (e.kind === 'bullet') newPlayerBullet = true;
      }
      tracked.seenTick = this.frameTick;
      // 엘리트 여부를 매 프레임 갱신 — 소멸(처치) 시점엔 스냅샷이 없어 흔들림 세기를 못 고른다.
      tracked.elite = e.elite >= 0;

      const p = prevById.get(e.id) ?? e;
      tracked.sprite.x = p.x + (e.x - p.x) * alpha;
      tracked.sprite.y = p.y + (e.y - p.y) * alpha;
      // 플레이어 기체는 마우스 조준각(e.angle)이 아니라 실제 사격 방향(최근접
      // 적/보스/보급 = autoAttack 대상군)을 향한다. 렌더 전용 계산(sim 불변).
      if (e.kind === 'player') {
        const facing = shipFacing(e.x, e.y, curr.entities, e.x - p.x, e.y - p.y, this.lastPlayerAngle);
        this.lastPlayerAngle = facing;
        tracked.sprite.rotation = facing;
        // 화면 흔들림 트리거 ① 플레이어 피격(중) — HP 델타(AC-2.1). p 는 직전 스냅샷.
        if (p.hp > e.hp) this.trauma.addTrauma(TRAUMA_PLAYER_HIT);
        // 화면 흔들림 트리거 ①-b **대시**(레인 A ④) — AAA 의 조작감은 기체가 아니라 카메라가
        // 만든다. 피격은 이미 트라우마에 걸려 있었는데 대시는 비어 있어, 게임에서 가장 자주
        // 누르는 조작이 화면에 아무 반응도 못 얻고 있었다. 대시 판정은 레인 A 와 **같은 함수**를
        // 써야(isDashSpeed) 흔들림과 불꽃 확장이 같은 프레임에 붙는다. 상승 에지 1회 발화라
        // 대시가 지속되는 동안 트라우마가 누적되지 않는다. `gates.shake` 는 TraumaController 를
        // 소비하는 쪽(applyShake)이 이미 존중하므로 여기서 다시 볼 필요가 없다.
        // 속도 파생은 레인 A 의 `snapshotVelocity` 를 **그대로** 쓴다(틱레이트·점프 상한이
        // 그 파일에만 있어야 공유 파일이 밸런스 축을 안 먹는다).
        const pv = snapshotVelocity(e, p);
        const dashing = isDashSpeed(Math.hypot(pv.vx, pv.vy));
        if (dashing && !this.playerWasDashing) this.trauma.addTrauma(PLAYER_DASH_TRAUMA);
        this.playerWasDashing = dashing;
        // 헤일로 이방성(레인 A ⑤) — 등방 원 blob 은 면적을 가장 많이 쓰면서 정보를 0 비트 준다.
        // 기수 축으로 늘이고 전방으로 편심시키면 발광 자체가 방향 신호가 된다.
        this.playerAniso = playerHaloAniso(pv.vx, pv.vy, facing, tracked.sprite.width / 2);
        // 런타임 3D 기체(티어 게이트) — 보스와 **같은 규율**로 텍스처만 아틀라스 프레임으로 갈아
        // 끼운다. 스프라이트는 끝까지 평범한 Pixi Sprite 라 헤일로·접지 그림자·레이더·z-order 가
        // 한 줄도 안 바뀌고, 장식자 복제(컨투어·림·잔상·손상)는 매 프레임 `sprite.texture` 를
        // 되읽으므로 자동으로 3D 실루엣을 따라온다.
        //
        // ⚠️ **요(yaw)는 여기서 이미 끝났다** — 바로 위에서 `shipFacing` 이 스프라이트 회전에
        // 들어갔다. 액터는 그 각도를 **미분해서 뱅크에만** 쓰고 3D 안에서 다시 돌리지 않는다.
        // 돌리면 이중 회전이라 조준선과 기수가 어긋난다(shipActor 헤더 ①).
        if (this.shipDriven3d) {
          const actor = this.shipActor;
          const stage = this.stage3d;
          if (actor !== null && stage !== null) {
            actor.update(dt, {
              facing,
              speed: Math.hypot(pv.vx, pv.vy),
              dashing,
              // 피격은 **`tracked.hp`** 로 판정한다 — `p.hp` 는 sim-step 없는 프레임에 같은 피해를
              // 재발화한다(데미지 숫자가 밟았던 HIGH-1 과 같은 함정). tracked.hp 는 이 루프
              // 뒷부분에서 e.hp 로 갱신되므로 여기서는 아직 직전 프레임 값이다.
              hit: tracked.hp > e.hp,
            });
            // 표시 크기는 **건드리지 않는다** — 헤일로·접지 그림자가 첫 등장 시 그 크기에서
            // 파생되므로, 3D 로 갈아타는 시점에 따라 크기가 달라지는 순서 의존 결함이 된다.
            const tex = stage.textureOf('player');
            if (tracked.sprite.texture !== tex) tracked.sprite.texture = tex;
          }
        }
        // 플레이어 보간 위치·반경 캡처 — 루프 뒤 그레이징(AC-4.5)·머즐(AC-4.7)·레벨업 링(AC-4.6)이 쓴다.
        playerX = tracked.sprite.x;
        playerY = tracked.sprite.y;
        playerR = e.radius;
        hasPlayer = true;
        playerSprite = tracked.sprite;
      } else if (e.kind === 'turretPickup' && e.active) {
        // 활성 아군 포탑: 포신이 **실제 사격 방향**을 향한다(2026-07-26 피드백). sim 은 조준각을
        // 저장하지 않으므로(해시 계약 — friendlyDisplay.turretAimAngle 주석) 렌더가 같은 규칙으로
        // 다시 구한다. 표적이 없으면 직전 각도를 유지해 포신이 0도로 튀지 않게 한다.
        const aim = turretAimAngle(e.x, e.y, curr.entities, TURRET_RANGE);
        if (aim !== null) tracked.aimAngle = aim;
        tracked.sprite.rotation = tracked.aimAngle;
      } else {
        // Gems, boss, supply and the static gimmicks keep a fixed facing; others
        // face their travel/aim angle. 목록은 isFixedFacing 이 정본이다.
        tracked.sprite.rotation = isFixedFacing(e.kind) ? 0 : e.angle;
      }

      // 루프 애니메이션 프레임 진행(render-only). 프레임 텍스처는 전부 같은 치수라 setSize 로
      // 확정한 표시 크기는 교체에도 불변이다. 히트 플래시 오버레이는 생성 시점 텍스처에 고정돼
      // 있지만 창이 2~3프레임뿐이라 눈에 띄지 않는다(의도적 단순화).
      if (tracked.animFrames !== null) {
        const idx = animFrameIndex(this.animClock, tracked.animFrames.length, tracked.animPhase);
        const frame = tracked.animFrames[idx];
        if (frame !== undefined && tracked.sprite.texture !== frame) tracked.sprite.texture = frame;
      }

      // 이름표 미러(형제라 부모 변환이 자동 적용되지 않는다) — 스프라이트 **아래**에 수평으로
      // 붙인다(회전은 따라가지 않는다: 포신이 돌아도 글자는 읽혀야 한다). 포탑처럼 상태로 이름이
      // 바뀌는 kind 는 달라졌을 때만 텍스트를 교체한다.
      if (tracked.label !== null) {
        const next = friendlyLabel(e.kind, e.active);
        if (next !== null && next !== tracked.labelText) {
          tracked.labelText = next;
          tracked.label.text = next;
        }
        tracked.label.position.set(
          tracked.sprite.x,
          tracked.sprite.y + tracked.sprite.height / 2 + LABEL_GAP,
        );
      }

      // 낙하산 형제 미러(있으면) — 부모 보간 위치를 따라가되 수송체 **위** 고정 오프셋으로 매단다.
      // 부모(supply)는 fixed facing 이라 회전 0이지만 안전하게 부모 회전을 그대로 따른다. 크기는
      // 생성 시 확정(수송체 스케일 불변)이라 여기선 위치·회전만 갱신한다.
      if (tracked.chute !== null) {
        tracked.chute.position.set(
          tracked.sprite.x,
          tracked.sprite.y - tracked.sprite.height * PARACHUTE_OFFSET_SCALE,
        );
        tracked.chute.rotation = tracked.sprite.rotation;
      }

      if (e.kind === 'boss') {
        // 런타임 3D 액터(티어 게이트) — **텍스처만** 3D 아틀라스 프레임으로 갈아 끼운다.
        // 스프라이트는 끝까지 평범한 Pixi Sprite 로 남으므로 스프라이트 풀·접지 그림자·발광·
        // 레이더·z-order 가 한 줄도 바뀌지 않는다. 페이즈별 거동은 액터가 쥔다.
        //
        // 단 **tint/alpha 연출만은 배타적**이다 — 아래 `driven3d` 분기 주석 참조.
        let driven3d = false;
        if (gates.model3d) {
          this.ensureBoss3D();
          const actor = this.bossActor;
          const stage = this.stage3d;
          if (actor !== null && stage !== null && actor.isReady) {
            actor.update(dt, {
              phase: e.bossPhase ?? 0,
              transitioning: e.flash,
              overheated: e.active,
            });
            // 스프라이트 표시 크기는 **건드리지 않는다** — 발광 헤일로·접지 그림자가 그 크기에서
            // 첫 등장 시 한 번 파생되므로, 3D 로 갈아타는 시점에 따라 헤일로 크기가 달라지는 순서
            // 의존 결함이 된다(같은 행성 2회차 런은 액터가 이미 준비돼 첫 프레임에 갈아탄다).
            const tex = stage.textureOf('boss');
            if (tracked.sprite.texture !== tex) tracked.sprite.texture = tex;
            driven3d = true;
          }
        }

        if (driven3d) {
          // 3D 액터가 전환·과열을 **자기 연출로** 표현하므로 아래 2D tint 처리를 태우지 않는다.
          //
          // ⚠️ 태우면 보스가 화면에서 사라진다(사용자 신고 2026-07-30). Pixi tint 는 곱연산이라
          // 과열의 `0xff4020` 은 녹색을 0.25배·파랑을 0.125배로 깎는데, 이는 3D 액터가 발광으로
          // 밝힌 것을 정확히 되돌리는 연산이다. 거기에 alpha 0.86 까지 겹쳐 어두운 배경과 섞인다.
          // 즉 같은 상태를 두 시스템이 **반대 방향으로** 그리고 있었다.
          tracked.sprite.tint = 0xffffff;
          tracked.sprite.alpha = 1;
        } else if (e.flash) {
          tracked.sprite.tint = (this.frameTick >> 2) % 2 === 0 ? 0xffffff : 0xff8080;
        } else if (e.active) {
          const pulse = 0.5 + 0.5 * Math.sin(this.frameTick * 0.4);
          tracked.sprite.tint = 0xff4020;
          tracked.sprite.alpha = 0.8 + 0.2 * pulse;
        } else {
          tracked.sprite.tint = 0xffffff;
          tracked.sprite.alpha = 1;
        }
      } else if (e.kind !== 'player') {
        // 히트 플래시(AC-2.3) — HP 델타로 피해를 감지해 2~3프레임 동안 **가산 흰 오버레이**로 대상
        // 실루엣을 실제로 번쩍이게 한다. Pixi v8 tint 는 곱연산이라 흰색(0xffffff)은 항등원 →
        // 무틴트(대개 흰) 스프라이트에 곱하면 화면 변화가 0 이다(MED-1). 그래서 같은 텍스처를
        // blendMode='add' 로 얹어 가산합성으로 밝힌다. 트리거는 데미지 숫자와 동일 소스(HP 델타)라
        // sim 표면 불확대. 보스는 위 기존 로직, 플레이어는 적 kind 아님 → 제외. reducedMotion 은
        // effectGates.hitFlash 가 반영(감소 시 false → 오버레이가 아예 안 생긴다).
        //
        // **Pixi v8 은 Sprite 를 컨테이너로 쓰는 것을 deprecate**(Sprite.addChild 경고)했으므로,
        // 오버레이는 부모의 자식이 아니라 spriteLayer **형제**로 두고 매 프레임 부모 위치·회전·
        // 스케일을 미러한다(같은 텍스처·앵커라 동일 실루엣으로 겹친다 — 발광 헤일로와 동형). 형제라
        // 부모 destroy 로는 안 딸려 오므로 창 종료·킬·reset·destroy 시 명시 회수한다.
        if (gates.hitFlash && p.hp > e.hp) {
          tracked.flashUntilTick = this.frameTick + HIT_FLASH_FRAMES;
          if (tracked.flashOverlay === null) {
            const ov = new Sprite(tracked.sprite.texture);
            ov.anchor.set(0.5);
            ov.tint = HIT_FLASH_TINT;
            ov.blendMode = 'add';
            ov.alpha = HIT_FLASH_ALPHA;
            this.spriteLayer.addChild(ov);
            tracked.flashOverlay = ov;
          }
          // 이미 오버레이가 있으면 위에서 창(flashUntilTick)만 연장된다 — 중복 생성 금지.
        }
        // 오버레이가 있으면: 창이 살아 있는 동안 매 프레임 부모 변환을 미러하고(생성 프레임 포함 —
        // 여기서 자리·크기를 잡는다), 창이 끝나면 떼고 파괴한다(딱 한 번, 재피격 없이 프레임이
        // 흐르면 여기서 회수). 형제라 부모 스케일이 자동 적용되지 않으므로 스케일도 직접 미러한다.
        if (tracked.flashOverlay !== null) {
          if (this.frameTick >= tracked.flashUntilTick) {
            this.detachFromSpriteLayer(tracked.flashOverlay);
            tracked.flashOverlay = null;
          } else {
            this.mirrorTransform(tracked.flashOverlay, tracked.sprite);
          }
        }
      }

      // 데미지 숫자(AC-4.1) — 보스·엘리트 저빈도 한정 + 토글. 렌더측 HP-델타 추론(sim 0 변경). **감지는
      // 스냅샷 보간 델타(p.hp)가 아니라 렌더러가 유지하는 tracked.hp 로** 한다(리뷰 HIGH-1): render 는
      // sim(60Hz)과 분리돼 매 rAF 프레임 호출되는데, sim-step 없는 프레임엔 prev/curr 스냅샷이 그대로여서
      // p.hp 델타는 같은 피해를 프레임마다 재계수한다(120/144Hz·위상 지터에서 중복 숫자·예산 고갈). tracked.hp
      // 는 직전 프레임이 이미 e.hp 로 낮췄으므로 no-step 프레임엔 tracked.hp>e.hp 가 거짓 → 재발화가 자연
      // 차단되고, 프레임 드랍(다중 step) 시 소실 델타도 누적된다. 힐(델타<0)은 무시(Critic m3 ②).
      const isDmgTarget = e.kind === 'boss' || e.kind === 'defenseBoss' || e.elite >= 0;
      if (showDamageNumbers && isDmgTarget) {
        if (tracked.hp > e.hp) tracked.dmgAccum += tracked.hp - e.hp; // 피해 누적(프레임 드랍 소실분 포함).
        // 스로틀 방출(리뷰 MEDIUM): 누적 피해를 THROTTLE 창마다 한 숫자로 합쳐 방출한다 — 연사·DoT 로
        // 매 sim tick 피해가 들어와도 숫자가 프레임마다 쏟아져 겹치거나 oneShots 예산을 통째 고갈시켜
        // 머즐·수집·레벨업을 굶기지 않게 한다(합산 표기라 가독도 낫다).
        if (tracked.dmgAccum > 0 && this.frameTick - tracked.dmgEmitTick >= DAMAGE_NUMBER_THROTTLE_FRAMES) {
          this.addOneShot(
            new DamageNumber(
              tracked.sprite.x,
              tracked.sprite.y - DAMAGE_NUMBER_Y_OFFSET,
              tracked.dmgAccum,
              { crit: e.kind === 'boss' && e.active }, // 보스 과열 창(2배 피해) 피격 = 치명타 강조.
            ),
          );
          tracked.dmgAccum = 0;
          tracked.dmgEmitTick = this.frameTick;
        }
      }
      // 킬블로우용 + 데미지 감지 기준선 갱신(AC-4.1). 이 대입이 tracked.hp 델타 감지의 다음-프레임 기준이자,
      // 소멸 시 킬 루프가 읽을 잔량이다(엣지 ①). 반드시 위 감지 뒤에 온다.
      tracked.hp = e.hp;

      // 탄 트레일(AC-4.4) — 티어 게이트(trails, med+) on 이고 트레일 대상 탄(플레이어 탄 전부 + 유도/
      // 곡사/가속/분열 적탄)만 짧은 가산 스트릭. 조밀 직진 잡몹탄(behavior=-1)은 제외(가독성). 살아있는
      // 동안 매 프레임 보간 위치를 먹이고, 소멸 후엔 updateBulletTrails 가 잔상을 페이드해 회수한다.
      if (gates.trails && isTrailBullet(e.kind, e.enemyType)) {
        let tr = this.bulletTrails.get(e.id);
        if (tr === undefined && this.bulletTrails.size < MAX_BULLET_TRAILS) {
          tr = new BulletTrail({ tier: graphicsTierController.getActiveTier() });
          this.effectLayer.addChild(tr.container);
          this.bulletTrails.set(e.id, tr);
        }
        if (tr !== undefined) {
          tr.update(dt, tracked.sprite.x, tracked.sprite.y);
          trailSeen.add(e.id);
        }
      }

      // 발광체 헤일로(glowLayer, 스프라이트 아래·가산, AC-3.1) — 게이트 on 이고 발광체일 때만
      // 유지한다. 헤일로는 스프라이트와 별개 레이어라 보간 위치를 매 프레임 미러한다. 탄·적
      // 실루엣은 isGlowEmitter=false 라 헤일로가 없다(탄막 가독성 계약).
      if (gates.halo && isGlowEmitter(e.kind)) {
        // 이방성은 **플레이어에게만** 넘긴다. 나머지 발광체(젬·전리품·보스)는 null 을 받아
        // 종전과 픽셀 단위로 동일하다.
        this.syncGlowHalo(
          e.id,
          tracked.sprite,
          e.kind === 'player' ? this.playerAniso : null,
          e.kind,
        );
      }

      // 접지 그림자 — 담당 테마가 있고(=배경이 켜진 행성) 부피를 가진 실체일 때만. 한 번 굽고
      // 이후엔 위치만 미러한다(매 프레임 Graphics 재빌드 금지).
      if (this.envTheme !== null && castsGroundShadow(e.kind)) {
        this.syncGroundShadow(e.id, tracked.sprite, this.envTheme);
      }

      // 장식자 프레임 갱신 — 스프라이트의 보간 위치·회전이 확정된 **뒤**여야 한다(장식자가
      // 그 값을 미러한다). 등록이 없으면 배열이 비어 있어 루프가 0회다.
      for (const ad of tracked.adorners) ad.onFrame(tracked.sprite, e, p, adornCtx);
    }

    // 플레이어를 스프라이트 레이어 최상단으로 — **잡몹이 아바타를 덮지 않게 한다.**
    //
    // ## 이 한 줄이 없으면 무슨 일이 나는가
    // `spriteLayer` 에는 z 우선순위가 없어 **자식 추가 순서**가 그리는 순서다. 플레이어는
    // 스냅샷 entities[0] 이라 거의 항상 **가장 먼저** 만들어지고, 따라서 **가장 아래**에 깔린다.
    // 실측(비평가 3차, 카르곤 보스 컷): 플레이어가 적 몸통에 **약 70% 가려져 있었다.**
    //
    // 기준선 문서의 최고가 결함("보스 컷에서 플레이어를 찾는 데 시간이 걸린다")의 잔존분이
    // 실은 여기였다 — 레인 A 가 세 라운드에 걸쳐 선체 **주변**의 가독을 올렸지만(외곽선·헤일로·
    // 감산 컨투어) 선체 자체가 z 싸움에서 지고 있었다. **어떤 AAA 트윈스틱도 아바타를 잡몹이
    // 덮게 두지 않는다.**
    //
    // 매 프레임 부르는 이유: 신규 스프라이트가 루프 도중 플레이어 **뒤에** 추가되므로 한 번
    // 올려 두는 것으로는 부족하다. 이미 최상단이면 `setChildIndex` 를 건너뛰어 splice 를 아낀다.
    if (playerSprite !== null) this.raisePlayerSprite(playerSprite);

    // ── 엔티티 루프 후처리(Phase 4) — 플레이어 위치·신규 탄 정보가 확정된 뒤 수행 ──────────────
    // 탄 트레일 잔상 페이드: 이번 프레임에 안 보인(소멸한) 탄의 트레일만 위치 없이 진행해 소진 시 회수.
    this.updateBulletTrails(dt, trailSeen);

    // 그레이징 스파크(AC-4.5) — render-only 근접 회피 감지(보상 없음). 플레이어↔적탄 거리가 판정점
    // 밖의 근접 대역이면, 그 탄이 대역에 **진입하는 순간 1회**(GrazeTracker rising-edge) 스파크. 티어
    // 파티클 게이트 뒤. 탄 위치는 엔티티 루프가 세운 보간 스프라이트에서 읽는다.
    if (hasPlayer && gates.particles !== 'off') {
      for (const e of curr.entities) {
        if (e.kind !== 'enemyBullet') continue;
        const bt = this.sprites.get(e.id);
        if (bt === undefined) continue;
        const grazing = isGraze(playerX, playerY, playerR, bt.sprite.x, bt.sprite.y, e.radius, GRAZE_BAND);
        if (this.grazeTracker.shouldSpark(e.id, grazing)) {
          // 스파크는 플레이어↔탄 중점에 — 스치는 지점 근처.
          this.addOneShot(
            new GrazeSpark((playerX + bt.sprite.x) / 2, (playerY + bt.sprite.y) / 2, {
              tier: graphicsTierController.getActiveTier(),
              seed: e.id, // 탄 id 로 시드 고정(결정론·탄마다 다른 흩뿌림).
            }),
          );
        }
      }
    }

    // 머즐 플래시(AC-4.7) — 이번 프레임 신규 플레이어 탄이 있었으면 총구(플레이어) 위치에 1회 섬광.
    if (newPlayerBullet && hasPlayer && gates.particles !== 'off') {
      this.addOneShot(new MuzzleFlash(playerX, playerY, this.lastPlayerAngle));
    }

    // 레벨업 링(AC-4.6) — main.ts 가 예약(pulseLevelUp)한 링을 플레이어 위치에 방출. 플레이어가 없으면
    // 다음 프레임까지 예약을 유지한다(레벨업 순간엔 플레이어가 살아있어 보통 즉시 소비).
    if (this.pendingLevelUp && hasPlayer) {
      this.addOneShot(new LevelUpRing(playerX, playerY));
      this.pendingLevelUp = false;
    }

    for (const [id, tracked] of this.sprites) {
      if (tracked.seenTick !== this.frameTick) {
        // A combat unit vanishing = a kill: leave a brief death burst behind.
        // 침공 3레이어의 설비·기물·보스도 파괴 연출을 받는다(스케일은 explosionScale).
        const scale = explosionScale(tracked.kind);
        if (scale > 0) this.spawnExplosion(tracked.sprite.x, tracked.sprite.y, scale);
        // 화면 흔들림 트리거 ② 보스/엘리트 처치(강) — 잡몹 처치는 제외(AC-2.1). 보스류(boss·
        // defenseBoss)는 TRAUMA_BOSS_KILL, 엘리트 잡몹은 TRAUMA_ELITE_KILL.
        if (tracked.kind === 'boss' || tracked.kind === 'defenseBoss') {
          this.trauma.addTrauma(TRAUMA_BOSS_KILL);
        } else if (tracked.elite) {
          this.trauma.addTrauma(TRAUMA_ELITE_KILL);
        }
        // 충격파 링(AC-3.3) — eventShaders on 이고 대형(보스류=3·설비/기물=2, 즉 scale>=대형임계)
        // 킬만. layer(카메라 팬 레이어) 전체에 짧은 원형 왜곡. center 는 킬 월드 위치의 스크린
        // 정규화(camX/camY 는 위에서 선계산). 잡몹(scale 1)은 제외.
        if (gates.eventShaders && scale >= BIG_EXPLOSION_SCALE) {
          this.spawnShockwave(tracked.sprite.x, tracked.sprite.y, camX, camY);
        }
        // 발광체 헤일로는 스프라이트 생사와 무관하게 즉시 회수(디졸브로 넘겨도 헤일로는 남기지
        // 않는다 — 발광은 살아있는 발광체만). 발광체가 아니었으면 no-op.
        this.removeGlowHalo(id);
        // 접지 그림자도 스프라이트 생사와 무관하게 즉시 회수한다. **디졸브 경로에서도** 그렇다:
        // 디졸브는 스프라이트를 spriteLayer 에 잔류시키지만 그림자는 그 자리에 얼어붙은 채
        // 남아(위치 미러가 끊긴다) 사라진 실체의 그림자만 바닥에 남는다. 형제라 부모 destroy
        // 로는 절대 안 걷힌다 — 여기가 누수 자리다.
        this.removeGroundShadow(id);
        // 장식자도 같은 규율로 즉시 회수한다 — **디졸브 경로 포함**. 디졸브는 스프라이트를
        // spriteLayer 에 잔류시키지만 장식자의 형제 컨테이너는 위치 미러가 끊긴 채 화면에
        // 얼어붙는다(접지 그림자가 실제로 낸 결함). 이 한 줄이 킬·디졸브 두 경로를 함께 덮는다.
        this.disposeAdorners(tracked, adornCtx);
        // 킬블로우 데미지 숫자(AC-4.1 엣지 ①) — 보스·엘리트가 사라지면 마지막 잔량(tracked.hp)을 치사
        // 피해로 띄운다(curr 스냅샷이 없어 델타를 못 얻는 경우 보정). 토글 on 한정. sprite.destroy 전이라
        // 위치가 유효하다.
        if (
          showDamageNumbers &&
          (tracked.kind === 'boss' || tracked.kind === 'defenseBoss' || tracked.elite) &&
          tracked.hp > 0
        ) {
          this.addOneShot(
            new DamageNumber(tracked.sprite.x, tracked.sprite.y - DAMAGE_NUMBER_Y_OFFSET, tracked.hp),
          );
        }
        // 수집 팝(AC-4.6) — gem/loot 소멸 = 수집. 작은 가산 팝으로 획득을 피드백한다(파티클 게이트 뒤).
        if ((tracked.kind === 'gem' || tracked.kind === 'loot') && gates.particles !== 'off') {
          this.addOneShot(new PickupPop(tracked.sprite.x, tracked.sprite.y));
        }
        // 그레이징 rising-edge 상태 정리(탄 소멸) — id 재사용은 없지만 맵 성장을 막는다(no-op if 미등록).
        this.grazeTracker.forget(id);
        // 트레일도 이 탄이 이번 프레임 unseen 이라 updateBulletTrails 가 이미 페이드를 시작했다(별도 처리 불필요).
        // 히트 플래시 오버레이·낙하산은 spriteLayer **형제**라 부모 destroy({children}) 로 안 딸려
        // 오고, 디졸브 경로는 애초에 부모 sprite 를 destroy 하지 않는다. 따라서 **어느 사망 경로든**
        // 여기서 부착물을 명시 회수한다(누수 0). 발광 헤일로가 스프라이트 생사와 무관하게 회수되는
        // 것과 같은 규율이다.
        if (tracked.flashOverlay !== null) {
          this.detachFromSpriteLayer(tracked.flashOverlay);
          tracked.flashOverlay = null;
        }
        if (tracked.chute !== null) {
          this.detachFromSpriteLayer(tracked.chute);
          tracked.chute = null;
        }
        // 이름표도 labelLayer 형제라 같은 규율로 회수한다(디졸브 경로 포함 — 사라지는 실체에
        // 이름만 남으면 안 된다).
        if (tracked.label !== null) {
          this.labelLayer.removeChild(tracked.label);
          tracked.label.destroy();
          tracked.label = null;
        }
        // 사망 디졸브(AC-3.4) — eventShaders on 이고 전투체(scale>0)면 즉시 destroy 대신 디졸브로
        // 수명을 이관해 스프라이트를 spriteLayer 에 잠깐 잔류시키며 디더 소멸시킨다. 상한 초과분·
        // gem/loot(scale 0)·저티어(eventShaders off)는 기존대로 즉시 destroy. 어느 경로든 sprites
        // Map 에서는 즉시 빼(중복 렌더·재추적 방지) 수명만 갈라진다.
        if (gates.eventShaders && scale > 0 && this.dyingSprites.length < MAX_DISSOLVES) {
          // 이관: spriteLayer 에 그대로 두고(destroy 하지 않음) 디졸브 필터만 붙인다. sprite 는
          // 이제 dyingSprites 가 소유하며, 디졸브 완료 시 updateDyingSprites 가 destroy 한다.
          this.dyingSprites.push({ sprite: tracked.sprite, effect: new DissolveEffect(tracked.sprite) });
        } else {
          // 부착물(형제)은 위에서 이미 회수했다. children:true 는 낙하산/오버레이가 아니라, 스프라이트가
          // 소유할 수 있는 진짜 자식(예: 없음)까지 안전히 회수하려는 방어적 유지다.
          tracked.sprite.destroy({ children: true });
        }
        this.sprites.delete(id);
      }
    }

    // 화면 흔들림(AC-2.1)만 프레임 끝에서 카메라에 가산. 카메라 팬(camX/camY)은 위에서 선계산했고
    // (render-only 파생·sim 무권위), 이 프레임에 누적된 트라우마(피격·처치·대형 폭발)가 같은
    // 프레임에 반영되도록 엔티티/킬 루프 **뒤**에서 흔들림 오프셋을 더한다. drawOverlay/필드
    // 오버레이는 layer 자식에 월드 좌표로 그리므로 position 설정 시점과 무관하다.
    const sh = this.trauma.tick(dt, gates.shake);
    this.layer.position.set(DESIGN_WIDTH / 2 - camX + sh.dx, DESIGN_HEIGHT / 2 - camY + sh.dy);

    // 3D 아틀라스를 그려 Pixi 텍스처로 올린다(프레임당 업로드 1회). 이번 프레임에 활성 슬롯이
    // 없으면 — 보스가 화면에 없거나 티어가 낮으면 — 아무것도 하지 않는다(비용 0).
    this.stage3d?.render();
  }

  /**
   * **현재 행성의** 보스 액터를 준비한다(지연 생성). 로드는 비동기라 이번 프레임에는 준비되지
   * 않는다 — 그동안 호출자는 기존 PNG 스프라이트를 계속 쓰고, 로드가 끝난 다음 프레임부터 3D
   * 텍스처로 자연스럽게 갈아탄다(로딩이 화면을 비우지 않는다).
   *
   * 행성이 바뀌면(다음 런) **이전 모델을 회수하고 새로 로드**한다. 무대(WebGL 컨텍스트)는 액터보다
   * 오래 살려 재사용한다 — 브라우저의 컨텍스트 수 상한이 낮아 런마다 새로 잡으면 몇 런 뒤에 3D 가
   * 조용히 꺼진다.
   */
  private ensureBoss3D(): void {
    const planet = this.planet;
    if (this.boss3dPlanet === planet) return;
    this.boss3dPlanet = planet;

    // 이전 행성의 모델을 먼저 내린다. `bossActor` 를 **즉시** null 로 만들어야 이번 프레임부터
    // 2D 로 폴백한다 — 안 그러면 회수된 geometry 를 그리려 들거나 빈 아틀라스를 물린다.
    const prev = this.bossActor;
    this.bossActor = null;
    prev?.dispose();

    // three.js 는 무겁다 — **동적 import** 로 코드를 분할해 보스 3D 가 실제로 필요해지는
    // 순간에만 내려받는다. 보스 조우 전에 끝나는 런·저티어 기기는 이 청크를 아예 받지 않는다.
    void (async () => {
      try {
        const [{ Stage3D }, { BossActor, hasBossModel }] = await Promise.all([
          import('./three3d/stage3d.js'),
          import('./three3d/bossActor.js'),
        ]);
        // 모델 없는 행성에서는 **무대조차 세우지 않는다** — 아무 이득 없이 GL 컨텍스트를 점유한다.
        if (!hasBossModel(planet)) return;
        // 청크를 받는 동안 행성이 또 바뀌었으면 이 로드는 사문이다(뒤에 온 호출이 이미 진행 중).
        if (this.boss3dPlanet !== planet) return;
        this.stage3d ??= Stage3D.create();
        const stage = this.stage3d;
        if (stage === null) return; // GL 없음 — 2D 폴백 유지.
        const actor = new BossActor(stage);
        if (!(await actor.load(planet)) || this.boss3dPlanet !== planet) {
          actor.dispose(); // 로드 실패 또는 그 사이 행성 교체. 무대는 남겨 재사용한다.
          return;
        }
        this.bossActor = actor;
      } catch {
        // 청크 로드 실패(오프라인·배포 불일치)는 화면을 막지 않는다 — 2D 스프라이트로 남는다.
      }
    })();
  }

  /**
   * **현재 기체 타입의** 3D 액터를 준비한다(지연 생성). 로드는 비동기라 이번 프레임에는 준비되지
   * 않는다 — 그동안 호출자는 기존 PNG 스프라이트를 계속 쓰고, 로드가 끝난 다음 프레임부터 3D
   * 텍스처로 자연스럽게 갈아탄다(로딩이 조작 대상을 화면에서 지우지 않는다).
   *
   * 기체가 바뀌면(다음 런) 이전 모델을 회수하고 새로 로드한다. 무대(WebGL 컨텍스트)는 보스와
   * **공유**한다 — 브라우저의 컨텍스트 수 상한이 낮아 액터마다 새로 잡으면 몇 런 뒤에 3D 가
   * 조용히 꺼진다. 그래서 두 액터가 같은 아틀라스의 다른 칸을 쓴다.
   */
  private ensureShip3D(): void {
    const typeId = this.shipType;
    if (this.ship3dType === typeId) return;
    this.ship3dType = typeId;

    // 이전 기체 모델을 먼저 내린다. `shipActor` 를 **즉시** null 로 만들어야 이번 프레임부터
    // 2D 로 폴백한다 — 안 그러면 회수된 geometry 를 그리려 들거나 빈 아틀라스를 물린다.
    const prev = this.shipActor;
    this.shipActor = null;
    prev?.dispose();

    // three.js 는 무겁다 — **동적 import** 로 코드를 분할한다. 보스 청크와 무대를 공유하므로
    // 보스전까지 간 런에서는 이 import 가 이미 캐시돼 있다.
    void (async () => {
      try {
        const [{ Stage3D }, { ShipActor, hasShipModel }] = await Promise.all([
          import('./three3d/stage3d.js'),
          import('./three3d/shipActor.js'),
        ]);
        // 모델 없는 기체 타입에서는 **무대조차 세우지 않는다** — 아무 이득 없이 GL 컨텍스트를 점유한다.
        if (!hasShipModel(typeId)) return;
        // 청크를 받는 동안 기체가 또 바뀌었으면 이 로드는 사문이다(뒤에 온 호출이 이미 진행 중).
        if (this.ship3dType !== typeId) return;
        this.stage3d ??= Stage3D.create();
        const stage = this.stage3d;
        if (stage === null) return; // GL 없음 — 2D 폴백 유지.
        const actor = new ShipActor(stage);
        if (!(await actor.load(typeId)) || this.ship3dType !== typeId) {
          actor.dispose(); // 로드 실패 또는 그 사이 기체 교체. 무대는 남겨 재사용한다.
          return;
        }
        this.shipActor = actor;
      } catch {
        // 청크 로드 실패(오프라인·배포 불일치)는 화면을 막지 않는다 — 2D 스프라이트로 남는다.
      }
    })();
  }

  /**
   * 파편 폭발(ShardBurst) 1개를 effectLayer(스프라이트 위)에 방출한다(AC-2.4). 기존 단일 스프라이트
   * 24프레임 페이드를 대체 — 절차적 가산 파티클이라 텍스처 의존이 없다. 티어를 전달해 Low 에서
   * 파티클이 최소가 되게 한다. `scale >= 대형임계` 면 화면 흔들림 트리거 ③(대형 폭발)도 건다.
   */
  private spawnExplosion(x: number, y: number, scale: number): void {
    const burst = new ShardBurst(x, y, scale, { tier: graphicsTierController.getActiveTier() });
    this.effectLayer.addChild(burst.container);
    this.bursts.push(burst);
    // 화면 흔들림 트리거 ③ 대형 폭발(중) — 설비/기물/보스류(scale>=2)만. 잡몹(1) 제외(AC-2.1).
    if (scale >= BIG_EXPLOSION_SCALE) this.trauma.addTrauma(TRAUMA_BIG_EXPLOSION);
  }

  /**
   * 살아 있는 파편 폭발을 dt(초)만큼 진행하고, 원샷이 끝난 것(update→false)은 effectLayer 에서
   * 떼고 destroy 한다. dt 는 render 가 벽시계로 산출해 넘긴다(TraumaController 와 동일 dt).
   */
  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      if (b === undefined) continue;
      if (!b.update(dt)) {
        this.effectLayer.removeChild(b.container);
        b.destroy();
        this.bursts.splice(i, 1);
      }
    }
  }

  /**
   * 원샷 이펙트(Phase 4) 1개를 effectLayer(스프라이트 위)에 얹고 추적 목록에 등록한다. {@link MAX_ONESHOTS}
   * 상한에 도달하면 즉시 destroy 하고 등록하지 않는다(탄막 밀도·연사 성능 방어) — 호출측은 반환값을
   * 신경 쓸 필요 없이 "방출을 시도"하면 된다. 위치는 호출측이 fx.container.position 으로 이미 잡아 둔다.
   */
  private addOneShot(fx: OneShotEffect): void {
    if (this.oneShots.length >= MAX_ONESHOTS) {
      fx.destroy(); // 상한 초과 — 등록 없이 즉시 폐기(effectLayer 무한 성장 방어).
      return;
    }
    this.effectLayer.addChild(fx.container);
    this.oneShots.push(fx);
  }

  /**
   * 살아있는 원샷 이펙트를 dt 만큼 진행하고, 끝난 것(update→false)은 effectLayer 에서 떼고 destroy+splice
   * 한다(updateBursts 동형 수명 관리). 데미지 숫자·그레이징·수집 팝·레벨업 링·머즐 플래시 공통.
   */
  private updateOneShots(dt: number): void {
    for (let i = this.oneShots.length - 1; i >= 0; i--) {
      const fx = this.oneShots[i];
      if (fx === undefined) continue;
      if (!fx.update(dt)) {
        this.effectLayer.removeChild(fx.container);
        fx.destroy();
        this.oneShots.splice(i, 1);
      }
    }
  }

  /**
   * 탄 트레일(AC-4.4) 잔상 페이드 + 회수. 이번 프레임에 살아있는 탄으로 갱신된(seen) 트레일은
   * 엔티티 루프가 이미 위치를 먹였으므로 건너뛰고, 소멸한 탄(unseen)의 트레일만 위치 없이 update 해
   * 잔상을 페이드시킨다 — 다 사라지면(update→false) effectLayer 에서 떼고 destroy 한다.
   * `seen` 은 이번 프레임 트레일 대상 탄 id 집합(엔티티 루프가 채운다).
   */
  private updateBulletTrails(dt: number, seen: ReadonlySet<number>): void {
    for (const [id, tr] of this.bulletTrails) {
      if (seen.has(id)) continue; // 살아있는 탄 — 엔티티 루프가 이미 update(dt,x,y) 했다.
      if (!tr.update(dt)) {
        this.effectLayer.removeChild(tr.container);
        tr.destroy();
        this.bulletTrails.delete(id);
      }
    }
  }

  /** 모든 원샷 이펙트를 destroy 하고 목록을 비운다(reset·destroy 정리, 누수 0). */
  private clearOneShots(): void {
    for (const fx of this.oneShots) {
      this.effectLayer.removeChild(fx.container);
      fx.destroy();
    }
    this.oneShots.length = 0;
  }

  /** 모든 탄 트레일을 destroy 하고 맵을 비운다(reset·destroy 정리, 누수 0). grazeTracker 도 리셋. */
  private clearBulletTrails(): void {
    for (const tr of this.bulletTrails.values()) {
      this.effectLayer.removeChild(tr.container);
      tr.destroy();
    }
    this.bulletTrails.clear();
  }

  /**
   * 충격파 링 1개를 {@link layer}(카메라 팬 레이어) 전체에 건다(AC-3.3). GL 있으면 필터의 원형
   * 왜곡, node/폴백이면 layer 자식으로 팽창 링 Graphics(AC-3.6). center 는 킬 월드 위치를 스크린
   * 정규화(0..1)한 값 — layer 는 스크린좌표 = 월드 + (DESIGN/2 - cam) 이므로 그 사상으로 구한다.
   * 폴백 링은 layer 자식(월드 좌표계)이라 fallbackCenterPx 는 킬 월드 좌표 그대로 넘긴다. 룩
   * 파라미터(durationS/amplitude/width)는 shockwave-thick-slow 승격 기본값(placeholder).
   *
   * {@link MAX_SHOCKWAVES} 상한에 도달하면 생략한다 — 폭탄 밀도(한 프레임 다수 대형 킬)에서 풀스크린
   * 변위 패스가 무한 누적하는 성능 붕괴 방어(디졸브 캡과 동형 정신).
   */
  private spawnShockwave(worldX: number, worldY: number, camX: number, camY: number): void {
    if (this.shockwaves.length >= MAX_SHOCKWAVES) return; // 풀스크린 필터 스택 상한(성능 방어)
    const sx = (worldX + DESIGN_WIDTH / 2 - camX) / DESIGN_WIDTH;
    const sy = (worldY + DESIGN_HEIGHT / 2 - camY) / DESIGN_HEIGHT;
    const cx = sx < 0 ? 0 : sx > 1 ? 1 : sx;
    const cy = sy < 0 ? 0 : sy > 1 ? 1 : sy;
    this.shockwaves.push(
      new ShockwaveEffect(this.layer, { center: [cx, cy], fallbackCenterPx: [worldX, worldY] }),
    );
  }

  /**
   * 살아 있는 충격파를 dt 만큼 진행하고, 원샷이 끝난 것(update→false)은 destroy(자기 필터/폴백 링만
   * 제거, 다른 필터 보존)+splice 한다. updateBursts 와 동형 수명 관리.
   */
  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      if (s === undefined) continue;
      if (!s.update(dt)) {
        s.destroy();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  /**
   * 디졸브 소멸 중인 스프라이트를 dt 만큼 진행하고, 소멸 완료(update→false)면 그때 필터를 떼고
   * (effect.destroy) 스프라이트를 destroy({children:true})해 spriteLayer 에서 회수한다(누수 0).
   * effect.destroy 는 대상 표시 객체를 파괴하지 않으므로(호출측 소유), 여기서 sprite 도 함께 destroy.
   */
  private updateDyingSprites(dt: number): void {
    for (let i = this.dyingSprites.length - 1; i >= 0; i--) {
      const d = this.dyingSprites[i];
      if (d === undefined) continue;
      if (!d.effect.update(dt)) {
        d.effect.destroy();
        d.sprite.destroy({ children: true });
        this.dyingSprites.splice(i, 1);
      }
    }
  }

  /**
   * 용암 시머(지속형, AC-3.2)를 게이트·용암 유무에 맞춰 부착/detach 하고, 부착돼 있으면 uTime 을
   * 진행한다. `want` = eventShaders on AND 용암 해저드 존재. 전이 시점에만 attach/detach 하고
   * (매 프레임 재생성 금지), 부착 상태면 매 프레임 update(node/폴백이면 no-op).
   *
   * 시머는 {@link lavaOverlay}(용암 전용 Graphics)에만 붙는다 — {@link overlay}(예고선·비-용암 해저드)
   * 는 흔들리지 않는다(국소 시머 계약). **보스 과열 창**(AC-3.2 문구의 다른 대상)은 시머가 아니라
   * 히트 플래시 tint 펄스로 처리하므로 여기 트리거에 포함하지 않는다(의도된 대체 — 스펙 문구 분업).
   */
  private syncShimmer(want: boolean, dt: number): void {
    if (want && this.shimmer === null) {
      this.shimmer = new ShimmerEffect(this.lavaOverlay);
    } else if (!want && this.shimmer !== null) {
      this.shimmer.detach();
      this.shimmer = null;
    }
    if (this.shimmer !== null) this.shimmer.update(dt);
  }

  /** 살아 있는 충격파를 전부 destroy 하고 목록을 비운다(reset·destroy 정리). 자기 필터만 detach. */
  private clearShockwaves(): void {
    for (const s of this.shockwaves) s.destroy();
    this.shockwaves.length = 0;
  }

  /**
   * 디졸브 중인 스프라이트를 전부 정리한다(reset·destroy). 각 필터를 떼고 스프라이트를
   * destroy({children:true})해 spriteLayer 잔류분까지 회수한다(누수 0).
   */
  private clearDyingSprites(): void {
    for (const d of this.dyingSprites) {
      d.effect.destroy();
      d.sprite.destroy({ children: true });
    }
    this.dyingSprites.length = 0;
  }

  /** 용암 시머를 detach 하고 null 로 되돌린다(reset·destroy). 미부착이면 no-op. */
  private clearShimmer(): void {
    if (this.shimmer !== null) {
      this.shimmer.detach();
      this.shimmer = null;
    }
  }

  /**
   * High 티어 발광체 블룸(AC-3.1)을 glowLayer.filters 로 관리한다. 필터는 **지연 1회 생성**해
   * ({@link glowBloom}) 캐시하고, 게이트 전이 시점에만 filters 배열을 재설정한다 — 매 프레임
   * 재생성/재배열하면 필터 시스템이 불필요하게 재빌드된다. GL 부재/컴파일 실패(null 폴백)면
   * 아무것도 붙이지 않아 헤일로만 남는다(AC-3.6, headless node 안전).
   */
  private syncGlowBloom(want: boolean): void {
    if (want && !this.glowBloomAttached) {
      // 지연 생성: 처음 필요할 때 딱 한 번. 이후 null(폴백)이어도 undefined 가 아니라 재호출 없음.
      if (this.glowBloom === undefined) this.glowBloom = createGlowBloomFilter();
      if (this.glowBloom !== null) {
        this.glowLayer.filters = [this.glowBloom];
        this.glowBloomAttached = true;
      }
      // null 폴백이면 attach 하지 않는다 — 헤일로만으로 계속(캐시된 null 유지, 재생성 안 함).
    } else if (!want && this.glowBloomAttached) {
      this.glowLayer.filters = [];
      this.glowBloomAttached = false;
    }
  }

  /**
   * 발광체 하나의 헤일로를 유지·미러한다(AC-3.1). 첫 등장 시 스프라이트 **표시 반경**(sprite.width/2)
   * 기반으로 {@link buildGlowHalo} 를 만들어 glowLayer(스프라이트 아래·가산)에 붙이고, 매 프레임
   * 스프라이트의 보간 위치로 옮긴다(별개 레이어라 좌표 동기 필요). 반경을 sim radius 가 아니라
   * 실제 표시 크기에서 파생하는 이유는 {@link GLOW_HALO_RADIUS_SCALE} 주석 참조.
   */
  private syncGlowHalo(
    id: number,
    sprite: Sprite,
    aniso: HaloAniso | null = null,
    kind = 'player',
  ): void {
    let halo = this.glowHalos.get(id);
    if (halo === undefined) {
      // kind 별 색·알파. 이 인자를 넘기지 않던 동안 **보스가 아군 시안 헤일로를 두르고 있었고**
      // (§2-2 위반) **젬이 화면 최고 명도**였다(위협보다 보상이 밝은 역전). 근거는 haloSpec 주석.
      const spec = haloSpec(kind);
      halo = buildGlowHalo(
        (sprite.width / 2) * GLOW_HALO_RADIUS_SCALE,
        spec.color,
        spec.alphaScale,
      );
      this.glowLayer.addChild(halo);
      this.glowHalos.set(id, halo);
    }
    if (aniso === null) {
      halo.position.set(sprite.x, sprite.y);
      return;
    }
    // 플레이어 전용 이방성(레인 A ⑤). 기수 축으로 늘이고 횡으로 좁히고 중심을 전방으로 민다 —
    // 셋이 합쳐져야 원이 추진 원뿔이 되고 그 형태 자체가 방향 신호가 된다. `aniso` 가 null 인
    // 다른 발광체는 위에서 이미 돌아갔으므로 rotation/scale 이 생성 시 기본값(0·1)에 머문다.
    halo.position.set(sprite.x + aniso.ox, sprite.y + aniso.oy);
    halo.rotation = aniso.rotation;
    halo.scale.set(aniso.scaleX, aniso.scaleY);
  }

  /** 발광체 헤일로 하나를 glowLayer 에서 떼고 destroy 한다(소멸 회수). 헤일로가 없으면 no-op. */
  private removeGlowHalo(id: number): void {
    const halo = this.glowHalos.get(id);
    if (halo === undefined) return;
    this.glowLayer.removeChild(halo);
    halo.destroy({ children: true });
    this.glowHalos.delete(id);
  }

  /**
   * 접지 그림자 하나를 유지·미러한다. 첫 등장 시 스프라이트의 **표시 반치수**(width/2·height/2)와
   * 테마 광원으로 기하를 구해 굽고, 이후 매 프레임 보간 위치 + 테마 오프셋으로 옮긴다.
   *
   * 반치수를 sim radius 가 아니라 표시 크기에서 뽑는 이유는 둘이 다르기 때문이다 — 아군·이익
   * 오브젝트의 sim radius 는 트리거 반경이고(`friendlyDisplay.displaySize`), 벽은 비정방이다.
   * 스프라이트 표시 크기는 생성 시 `setSize` 로 확정되고 애니메이션 프레임 교체에도 불변이라,
   * 여기서 한 번 굽는 것으로 충분하다.
   *
   * 상한({@link MAX_GROUND_SHADOWS})을 넘으면 새로 굽지 않는다 — 이미 있는 것은 계속 미러한다
   * (탄막·군집 밀도에서 스프라이트 수가 무한 성장하지 않게 하는 방어, oneShots 규율과 동형).
   */
  private syncGroundShadow(id: number, sprite: Sprite, theme: EnvTheme): void {
    let sh = this.groundShadows.get(id);
    if (sh === undefined) {
      if (this.groundShadows.size >= MAX_GROUND_SHADOWS) return;
      const geo = groundShadowGeometry(theme.light, sprite.width / 2, sprite.height / 2);
      sh = { view: buildGroundShadow(geo.rx, geo.ry, geo.alpha), dx: geo.dx, dy: geo.dy };
      this.shadowLayer.addChild(sh.view);
      this.groundShadows.set(id, sh);
    }
    // 오프셋은 테마 광원의 함수라 엔티티 수명 동안 불변이다 — 생성 시 한 번 구해 두고 매 프레임
    // 보간 위치에 더하기만 한다(cos/sin 재계산 금지).
    sh.view.position.set(sprite.x + sh.dx, sprite.y + sh.dy);
  }

  /** 접지 그림자 하나를 shadowLayer 에서 떼고 destroy 한다(소멸 회수). 없으면 no-op. */
  private removeGroundShadow(id: number): void {
    const sh = this.groundShadows.get(id);
    if (sh === undefined) return;
    this.shadowLayer.removeChild(sh.view);
    sh.view.destroy({ children: true });
    this.groundShadows.delete(id);
  }

  /** 모든 접지 그림자를 회수한다(테마 전환·리셋·파괴). shadowLayer 컨테이너 자체는 살려 둔다. */
  private clearGroundShadows(): void {
    for (const sh of this.groundShadows.values()) {
      this.shadowLayer.removeChild(sh.view);
      sh.view.destroy({ children: true });
    }
    this.groundShadows.clear();
  }

  /** 모든 발광체 헤일로를 회수한다(게이트 off·리셋·파괴). glowLayer 컨테이너 자체는 살려 둔다. */
  private clearGlowHalos(): void {
    for (const halo of this.glowHalos.values()) {
      this.glowLayer.removeChild(halo);
      halo.destroy({ children: true });
    }
    this.glowHalos.clear();
  }

  /**
   * spriteLayer 형제 부착물(히트 플래시 오버레이·낙하산)을 부모 스프라이트의 위치·회전·스케일에
   * 맞춘다. 같은 텍스처·앵커(0.5)를 쓰는 오버레이는 이 세 값만 맞추면 부모와 정확히 겹친다. 부모가
   * 자식일 때 자동 상속하던 변환을 형제에선 이렇게 직접 미러한다(스케일 미러가 특히 중요 — 형제는
   * 부모 스케일을 자동으로 받지 않으므로 벽처럼 비정방 스케일도 x·y 를 각각 복사해야 실루엣이 맞다).
   */
  private mirrorTransform(child: Sprite, parent: Sprite): void {
    child.position.set(parent.x, parent.y);
    child.rotation = parent.rotation;
    child.scale.set(parent.scale.x, parent.scale.y);
  }

  /**
   * spriteLayer 형제 부착물(히트 플래시 오버레이·낙하산)을 레이어에서 떼고 destroy 한다(누수 0).
   * 형제라 부모 sprite.destroy({children}) 로는 회수되지 않으므로, 창 종료·킬·reset·destroy 의
   * 모든 경로가 이 헬퍼로 명시 회수한다.
   */
  private detachFromSpriteLayer(child: Sprite): void {
    this.spriteLayer.removeChild(child);
    child.destroy();
  }

  /**
   * 이번 프레임의 장식자 맥락을 만든다. 레이어는 **발광(아래)·이펙트(위)** 를 그대로 재사용한다 —
   * 새 레이어를 추가하면 draw order 가 바뀌어 "거동 변화 0" 계약이 깨진다.
   */
  private adornerCtx(
    gates: EffectGates,
    tier: QualityTier,
    dt: number,
    alpha: number,
  ): AdornerContext {
    return {
      belowLayer: this.glowLayer,
      aboveLayer: this.effectLayer,
      frameTick: this.frameTick,
      dt,
      gates,
      tier,
      theme: this.envTheme,
      alpha,
      ship3d: this.shipDriven3d,
    };
  }

  /** 이번 프레임의 해저드 재질 맥락. `layer` 는 항상 호스트 자신의 view 다. */
  private hazardCtx(gates: EffectGates, tier: QualityTier, dt: number): HazardHostContext {
    return {
      layer: this.hazardHost.view,
      frameTick: this.frameTick,
      dt,
      gates,
      tier,
      theme: this.envTheme,
    };
  }

  /**
   * 장식자 하나의 묶음을 회수한다. 회수 뒤 {@link NO_ADORNERS} 로 되돌려 **두 번 불려도 no-op**
   * 이 되게 한다(킬 루프 뒤 같은 프레임에 reset 이 오는 경로가 실제로 있다).
   */
  private disposeAdorners(tracked: TrackedSprite, ctx: AdornerContext): void {
    if (tracked.adorners.length === 0) return;
    for (const ad of tracked.adorners) ad.dispose(ctx);
    tracked.adorners = NO_ADORNERS;
  }

  /**
   * 살아있는 장식자·해저드 재질을 전부 회수한다(reset·destroy 공통). 두 경로가 각각 맥락을
   * 조립하면 한쪽만 고쳐지는 사고가 나므로 여기 한 곳에 모은다.
   */
  private disposeAllAdorners(): void {
    const tier = graphicsTierController.getActiveTier();
    const gates = effectGates(tier, graphicsSettings.getSettings());
    const ctx = this.adornerCtx(gates, tier, 0, 0);
    for (const t of this.sprites.values()) this.disposeAdorners(t, ctx);
    this.hazardHost.clear(this.hazardCtx(gates, tier, 0));
  }

  private drawOverlay(curr: WorldSnapshot, hazardCtx: HazardHostContext): void {
    const g = this.overlay;
    const lg = this.lavaOverlay;
    g.clear();
    lg.clear(); // 용암 전용 오버레이(시머 대상)도 매 프레임 재그린다.
    // Support heal beams.
    for (const b of curr.beams) {
      g.moveTo(b.x1, b.y1).lineTo(b.x2, b.y2).stroke({ color: 0x33ffcc, width: 3, alpha: 0.5 });
    }
    // 휴면 접촉 기믹(포탑 키트·자석 발신기·폭탄 장치)의 **트리거 반경 링**. 스프라이트를 기체
    // 크기로 줄이면서(friendlyDisplay.displaySize) 화면에서 사라진 "어디까지 다가가면 켜지는가"를
    // 얇은 링으로 되돌린다. 활성 포탑에는 그리지 않는다(이미 발동한 실체).
    for (const e of curr.entities) {
      if (!showsTriggerRing(e.kind, e.active)) continue;
      g.circle(e.x, e.y, e.radius).stroke({ color: TRIGGER_RING_COLOR, width: 2, alpha: 0.35 });
    }
    // 대피소 표식(추격 Lane6). 활성(이번 세그먼트 목표)만 맥동 링으로 세우고 나머지는 낮춘다.
    // 화면 밖이면 카메라 둘레에 방향 화살표를 띄운다(SHELTER_ARROW_RADIUS).
    const shelterPulse = 0.5 + 0.5 * Math.sin(this.frameTick * 0.08);
    for (const e of curr.entities) {
      if (e.kind !== 'shelter') continue;
      if (!e.active) {
        g.circle(e.x, e.y, e.radius).stroke({ color: SHELTER_IDLE_COLOR, width: 2, alpha: 0.22 });
        continue;
      }
      g.circle(e.x, e.y, e.radius).stroke({
        color: SHELTER_ACTIVE_COLOR,
        width: 4,
        alpha: 0.5 + 0.4 * shelterPulse,
      });
      // 바깥으로 퍼지는 맥동 링(멀리서도 "여기다"로 읽히는 신호).
      g.circle(e.x, e.y, e.radius + 20 + 34 * shelterPulse).stroke({
        color: SHELTER_ACTIVE_COLOR,
        width: 3,
        alpha: 0.42 * (1 - shelterPulse),
      });
      const arrow = shelterArrow(curr.cameraX, curr.cameraY, e.x, e.y);
      if (arrow === null) continue;
      const ca = Math.cos(arrow.angle);
      const sa = Math.sin(arrow.angle);
      const tip = 34;
      const half = 18;
      const bx = arrow.x - ca * tip;
      const by = arrow.y - sa * tip;
      g.moveTo(arrow.x, arrow.y)
        .lineTo(bx - sa * half, by + ca * half)
        .lineTo(bx + sa * half, by - ca * half)
        .closePath()
        .fill({ color: SHELTER_ACTIVE_COLOR, alpha: 0.55 + 0.35 * shelterPulse });
    }
    // Hazard zones: telegraph = outlined warning ring; active = filled danger.
    // 주기 온오프 해저드(L2 설비·L3 중력 앵커)는 이 예열↔활성 대비가 리듬을 읽게 한다.
    // **용암(HAZARD_LAVA)만 lavaOverlay 로 분리** — 시머가 용암류만 국소로 흔들고 예고선·비-용암
    // 해저드는 overlay 에 남겨 흔들리지 않게 한다(AC-3.2 국소 시머 계약).
    // 장판 루프는 {@link HazardHost} 로 이관했다(해저드 레인 확장 지점). 그리기 순서·장식 예산·
    // 용암 분리는 그대로다 — 이관은 거동 변화 0 이다.
    this.hazardHost.draw(curr.entities, g, lg, hazardCtx);
    // 예고선(관통 레일포 텔레그래프): 조준각이 잠긴 예고 구간에만 나온다. 탄보다 먼저 선이
    // 보이므로 플레이어가 사계를 벗어날 시간을 얻는다(예고 중에는 피해가 없다 — facility.ts).
    for (const e of curr.entities) {
      const rail = railTelegraph(e, this.frameTick);
      if (rail === null) continue;
      g.moveTo(rail.x1, rail.y1)
        .lineTo(rail.x2, rail.y2)
        .stroke({ color: TELEGRAPH_COLOR, width: TELEGRAPH_WIDTH, alpha: rail.alpha });
    }
  }

  /**
   * 필드 오버레이(추격 시야 암흑 · 수축 안전 반경). 스냅샷의 render-only 필드만 읽고 둘 다 0 이면
   * 아무것도 그리지 않는다(그 외 전 모드는 0). chase↔shrink 는 상호 배타라 동시에 켜지지 않는다.
   * `fog` 는 스프라이트보다 위 레이어라 시야 밖 엔티티가 어둡게 가려진다. sim/해시 무관.
   */
  private drawFieldOverlays(curr: WorldSnapshot): void {
    const g = this.fog;
    g.clear();
    if (curr.visionRadius > 0) drawVisionFog(g, curr.cameraX, curr.cameraY, curr.visionRadius);
    if (curr.safeRadius > 0) drawSafeZone(g, curr.cameraX, curr.cameraY, curr.safeRadius, this.frameTick);
  }

  /**
   * 런 사이 스프라이트 캐시를 비운다(**런 시작 시 호출** — `main.ts` 의 `createWorld` 직전).
   *
   * ## 왜 필요한가 (라이브 플레이테스트 B-1)
   * 스프라이트는 **엔티티 id 로 캐시**되고 텍스처는 `new Sprite(this.textureFor(e))` 로
   * **생성 시점에 한 번만** 묶인다. 퇴출은 "이번 프레임에 안 보인 스프라이트" 뿐인데, 플레이어
   * 엔티티 id 는 런이 바뀌어도 동일(항상 0번 슬롯)하므로 **이전 런의 플레이어 스프라이트가
   * 그대로 재사용**된다 → `applyShipSprite` 가 `textures.player` 를 새 기체로 갈아끼워도
   * 화면의 기체는 새로고침 전까지 첫 런의 그림으로 고정된다(기체 교체 5종 전부 재현).
   *
   * ## 왜 "매 프레임 텍스처 재조회"가 아니라 리셋인가
   * 매 프레임 `spriteSlotFor`+`resolveSpriteSlot` 를 전 엔티티(탄막 포함 수백~수천)에 대해
   * 다시 돌리는 것은 순수 렌더 오버헤드다. 텍스처가 바뀌는 시점은 **런 시작 하나뿐**이므로
   * (`applyShipSprite` 호출 지점 = `createWorld` 직전) 그 시점에 캐시를 비우는 것이 정확하면서
   * 프레임 비용 0 이다.
   *
   * `destroy()` 와 달리 레이어·오버레이는 살려 둔다 — 렌더러 인스턴스는 앱 수명 내내 유지된다.
   */
  reset(): void {
    // 장식자·해저드 재질 전량 회수(누수 0) — 형제 컨테이너라 아래 sprite.destroy 로는 안 걷힌다.
    // 스프라이트를 파괴하기 **전**에 부른다: 장식자가 dispose 에서 부모 스프라이트를 읽을 수 있다.
    this.disposeAllAdorners();
    for (const t of this.sprites.values()) {
      // 형제 부착물(히트 플래시 오버레이·낙하산)을 먼저 회수한다 — 형제라 부모 destroy 로는 안
      // 딸려 온다(누수 0). reset 은 spriteLayer 를 살려 두므로 removeChild 가 필수, destroy 는 뒤에서
      // layer 를 통째로 파괴하지만 여기서 미리 떼도 무해하다(이미 뗀 것은 재파괴 대상이 아니다).
      if (t.flashOverlay !== null) this.detachFromSpriteLayer(t.flashOverlay);
      if (t.chute !== null) this.detachFromSpriteLayer(t.chute);
      if (t.label !== null) {
        this.labelLayer.removeChild(t.label);
        t.label.destroy();
        t.label = null;
      }
      t.sprite.destroy({ children: true });
    }
    this.sprites.clear();
    // 사망 폭발도 비운다 — 남기면 다른 월드(런/프리뷰 레이어) 좌표의 폭발이 화면에 떠 있다
    // (defensePreviewFrame 계약). 트라우마·프레임 시계도 초기화해 잔류 흔들림·dt spike 를 막는다.
    for (const b of this.bursts) b.destroy();
    this.bursts.length = 0;
    // 이벤트 셰이더 원샷·지속형 전량 정리(누수 0) — 충격파 필터/폴백 링 detach, 디졸브 중인
    // 스프라이트(spriteLayer 잔류분) destroy, 시머 detach. 다른 월드(런/프리뷰) 좌표의 왜곡·소멸
    // 잔류를 막는다(defensePreviewFrame 계약, ShardBurst 와 동일 정신).
    this.clearShockwaves();
    this.clearDyingSprites();
    this.clearShimmer();
    // Phase 4 원샷 이펙트·탄 트레일 전량 정리(누수 0) + 그레이징 rising-edge·레벨업 예약 리셋.
    this.clearOneShots();
    this.clearBulletTrails();
    this.grazeTracker.reset();
    this.pendingLevelUp = false;
    // 발광체 헤일로 전량 회수 + 블룸 필터 해제(누수 0). 캐시된 블룸 필터 인스턴스(this.glowBloom)는
    // 살려 둔다 — 렌더러는 런 사이 재사용되고 필터 재생성은 비싸다. 다음 런 첫 프레임에 게이트가
    // 켜지면 syncGlowBloom 이 캐시된 필터를 다시 붙인다(glowBloomAttached 로 전이만 관리).
    this.clearGlowHalos();
    // 접지 그림자 전량 회수(누수 0). 형제라 부모 destroy 로는 안 걷힌다. reset 에서는 남기면
    // 다른 월드(런/프리뷰) 좌표의 그림자가 바닥에 떠 있다(ShardBurst·헤일로와 같은 규율).
    this.clearGroundShadows();
    this.glowLayer.filters = [];
    this.glowBloomAttached = false;
    this.trauma.reset();
    this.lastFrameMs = undefined;
    this.animClock = 0;
    this.overlay.clear();
    this.lavaOverlay.clear();
    this.fog.clear();
    this.lastPlayerAngle = 0;
    // 플레이어 파생 상태(레인 A ④⑤)도 되돌린다 — 남기면 다음 런 첫 프레임에 이전 런의 기수로
    // 헤일로가 늘어나고, 대시 에지가 이미 true 라 첫 대시의 화면 흔들림이 통째로 유실된다.
    this.playerAniso = null;
    this.playerWasDashing = false;
    // 조우 유형도 되돌린다 — 남기면 다음 런의 첫 프레임(main.ts 가 아직 새 값을 먹이기 전)에
    // 이전 런의 유형으로 조우 오브젝트가 그려질 수 있다. 스프라이트는 생성 시점에 텍스처가
    // 묶이므로 그 한 프레임의 오분류가 그 런 내내 고정된다.
    this.encounterType = 0;
  }

  destroy(): void {
    // 장식자·해저드 재질 전량 회수(누수 0). layer.destroy 는 형제 컨테이너를 걷지 않으며
    // 필터도 파괴하지 않는다 — 명시 회수가 유일한 경로다.
    this.disposeAllAdorners();
    for (const t of this.sprites.values()) {
      // 형제 부착물(히트 플래시 오버레이·낙하산)을 먼저 회수한다 — 형제라 부모 destroy 로는 안
      // 딸려 온다(누수 0). reset 은 spriteLayer 를 살려 두므로 removeChild 가 필수, destroy 는 뒤에서
      // layer 를 통째로 파괴하지만 여기서 미리 떼도 무해하다(이미 뗀 것은 재파괴 대상이 아니다).
      if (t.flashOverlay !== null) this.detachFromSpriteLayer(t.flashOverlay);
      if (t.chute !== null) this.detachFromSpriteLayer(t.chute);
      if (t.label !== null) {
        this.labelLayer.removeChild(t.label);
        t.label.destroy();
        t.label = null;
      }
      t.sprite.destroy({ children: true });
    }
    this.sprites.clear();
    for (const b of this.bursts) b.destroy();
    this.bursts.length = 0;
    // 이벤트 셰이더 정리 — overlay/layer.destroy **전**에 필터를 명시 detach 한다(Container.destroy
    // 는 filters 를 파괴하지 않는다). 시머=lavaOverlay 필터, 충격파=layer 필터, 디졸브=spriteLayer 잔류.
    this.clearShockwaves();
    this.clearDyingSprites();
    this.clearShimmer();
    // Phase 4 원샷 이펙트·탄 트레일 전량 정리(누수 0).
    this.clearOneShots();
    this.clearBulletTrails();
    this.grazeTracker.reset();
    this.pendingLevelUp = false;
    // 런타임 3D 무대 회수 — WebGL 컨텍스트·GPU 자원을 쥐고 있어 명시 해제가 필요하다
    // (브라우저의 컨텍스트 수 상한은 낮다: 누수시 재진입에서 3D 가 조용히 꺼진다).
    this.bossActor?.dispose(); // 모델의 geometry/material/texture 는 명시 해제로만 GPU 에서 내려간다.
    this.bossActor = null;
    this.shipActor?.dispose();
    this.shipActor = null;
    this.stage3d?.destroy();
    this.stage3d = null;
    this.boss3dPlanet = null;
    this.ship3dType = null;
    this.shipDriven3d = false;
    // 발광체 헤일로·블룸 필터를 명시 회수한다(Container.destroy 는 filters 를 파괴하지 않는다).
    this.clearGlowHalos();
    // 접지 그림자 전량 회수(누수 0). 형제라 부모 destroy 로는 안 걷힌다. reset 에서는 남기면
    // 다른 월드(런/프리뷰) 좌표의 그림자가 바닥에 떠 있다(ShardBurst·헤일로와 같은 규율).
    this.clearGroundShadows();
    this.glowLayer.filters = [];
    if (this.glowBloom) this.glowBloom.destroy();
    this.glowBloom = undefined;
    this.glowBloomAttached = false;
    this.overlay.destroy();
    this.lavaOverlay.destroy();
    this.fog.destroy();
    this.layer.destroy({ children: true });
  }
}
