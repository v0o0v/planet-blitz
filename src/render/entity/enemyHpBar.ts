/**
 * 적 머리 위 **HP 바** — 사용자 요청(2026-08-04 "적 위에 적의 HP를 띄워줘").
 *
 * ## 왜 장식자인가
 * `entityRenderer.ts` 는 플레이어·적 루프가 한 함수 안에 있어 레인끼리 같은 줄에서 충돌한다.
 * `adorner.ts` 심을 쓰면 공유 파일을 한 글자도 안 건드리고 자기 모듈만으로 붙는다.
 * 등록은 모듈 최상위 부수효과이므로 `entity/index.ts` 에 import 한 줄이 **반드시** 있어야
 * 한다 — 이 리포는 그 누락으로 완성된 모듈이 화면에 없는 결함을 8번 밟았다.
 *
 * ## 왜 티어 게이트가 없는가
 * `adorner.ts` §계약은 "모든 신규 **이펙트**는 게이트 뒤에" 라고 못박는다. HP 바는 이펙트가
 * 아니라 **정보**다 — `hitFlash` 가 "저렴한 핵심 전투 피드백"이라 전 티어 on 인 것과 같은
 * 부류다. 저티어에서 꺼지면 저사양 기기에서만 적 체력을 못 보는, 게이트로 표현하면 안 되는
 * 종류의 차이가 생긴다. 대신 **애니메이션을 아예 넣지 않아**(맥동·페이드 없음) 모션 감소축과
 * 충돌할 여지 자체를 없앴다. 프레임당 비용은 `scale.x` 대입 1회뿐이다(아래 §비용).
 *
 * ## 비용 — Graphics 를 매 프레임 다시 그리지 않는다
 * 채움 막대는 **폭 1px 사각형**으로 한 번만 그리고, 이후에는 `scale.x` 만 바꾼다.
 * `clear()` + `rect()` 를 매 프레임 돌리면 밀도 구간(동시 적 50~60)에서 지오메트리 리빌드가
 * 그 수만큼 쌓인다. 색도 비율 구간이 바뀔 때만 다시 칠한다.
 *
 * ## 보스는 제외한다
 * 보스·방어 보스는 이미 HUD 상단에 전용 체력바가 있고(`src/ui/hud.ts`), `entityRenderer` 의
 * 보스 분기가 `alpha`·`tint` 를 전유한다. 머리 위에 하나 더 띄우면 같은 정보가 두 벌이 된다.
 *
 * ── 결정론(ADR-0005) ── render-only. sim 은 **타입 전용 import** 이고 해시에 기여하지 않는다.
 * 값의 근원은 스냅샷의 `hp`/`maxHp` 뿐이라 sim 변경이 0 이다.
 */

import { Container, Graphics } from 'pixi.js';
import type { Sprite } from 'pixi.js';

import type { EntityKind } from '../../sim/entities.js';
import type { EntitySnapshot } from '../../sim/snapshot.js';
import type { AdornerContext, EntityAdorner } from './adorner.js';
import { registerAdornerFactory } from './adorner.js';

/** 바를 붙일 kind. 보스 계열은 HUD 전용 바가 있어 제외한다(위 §보스). */
export const HP_BAR_KINDS: readonly EntityKind[] = ['enemy', 'formationDrone', 'spawnedDrone'];

/** 바 높이(px, 월드 좌표계). 얇게 — 실루엣을 덮으면 안 된다. */
const BAR_H = 5;

/** 테두리 두께(px). 어두운 바탕이 그대로 테두리 역할을 한다. */
const BAR_PAD = 1;

/** 스프라이트 위쪽 여백(px). 이름표의 `LABEL_GAP` 과 같은 계의 값이다. */
const BAR_GAP = 6;

/** 바 폭 하한·상한(px). 작은 드론이 실보다 얇아지거나 거인이 화면을 가로지르지 않게. */
const BAR_MIN_W = 26;
const BAR_MAX_W = 88;

/** 바탕색(어두운 반투명 — 밝은 지형 위에서도 채움이 읽힌다). */
const BACK_COLOR = 0x0b0f14;
const BACK_ALPHA = 0.72;

/**
 * 체력 구간별 채움색. 3단으로 끊는 이유: 연속 보간은 "노랑에서 주황으로 넘어가는 중"이 계속
 * 색을 바꿔 프레임마다 다시 칠해야 한다. 구간이면 경계를 넘을 때만 칠한다(§비용).
 */
const FILL_HIGH = 0x5ce08a; // > 60%
const FILL_MID = 0xf2c14e; // 25~60%
const FILL_LOW = 0xe8563f; // <= 25%

/** 비율 → 구간 인덱스(0 = 높음, 1 = 중간, 2 = 낮음). 순수 함수 — 테스트가 이것만 본다. */
export function hpBand(ratio: number): 0 | 1 | 2 {
  if (ratio > 0.6) return 0;
  if (ratio > 0.25) return 1;
  return 2;
}

/** 구간 인덱스 → 색. */
export function hpBandColor(band: 0 | 1 | 2): number {
  return band === 0 ? FILL_HIGH : band === 1 ? FILL_MID : FILL_LOW;
}

/**
 * 스프라이트 폭에서 바 폭을 정한다(순수). 상·하한으로 조여 종에 상관없이 읽히게 한다.
 * 폭이 0 이면(텍스처 미로드) 반경으로 대체한다 — 0 폭 바는 화면에서 사라진 것과 같다.
 */
export function hpBarWidth(spriteWidth: number, radius: number): number {
  const base = spriteWidth > 0 ? spriteWidth : Math.max(1, radius) * 2;
  return Math.max(BAR_MIN_W, Math.min(BAR_MAX_W, Math.round(base)));
}

/**
 * 체력 비율 [0,1]. `maxHp` 가 0 이하이거나 유한하지 않으면 0 을 준다 — 그런 실체는 아래에서
 * 바를 아예 숨긴다(1 을 주면 "가득 찬 바"가 되어 거짓 정보가 된다).
 */
export function hpRatio(hp: number, maxHp: number): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  if (!Number.isFinite(hp) || hp <= 0) return 0;
  return hp >= maxHp ? 1 : hp / maxHp;
}

class EnemyHpBarAdorner implements EntityAdorner {
  readonly name = 'enemyHpBar';

  private root: Container | null = null;
  private fill: Graphics | null = null;
  /** 채움 막대의 최대 폭(px). `scale.x` 의 분모다. */
  private innerW = 0;
  /** 마지막으로 칠한 색 구간. -1 = 아직 안 칠했다. */
  private band = -1;
  /** 마지막으로 적용한 비율. 같은 값이면 `scale.x` 대입도 건너뛴다. */
  private ratio = -1;

  onAttach(sprite: Sprite, e: EntitySnapshot, ctx: AdornerContext): void {
    const w = hpBarWidth(sprite.width, e.radius);
    this.innerW = Math.max(1, w - BAR_PAD * 2);

    const root = new Container();
    const back = new Graphics();
    back.rect(-w / 2, 0, w, BAR_H).fill({ color: BACK_COLOR, alpha: BACK_ALPHA });

    // 폭 1px 로 한 번만 그리고, 이후에는 scale.x 로만 늘린다(§비용).
    const fill = new Graphics();
    fill.rect(0, 0, 1, BAR_H - BAR_PAD * 2).fill({ color: FILL_HIGH });
    fill.position.set(-w / 2 + BAR_PAD, BAR_PAD);

    root.addChild(back);
    root.addChild(fill);
    // 형제로 붙인다 — Pixi v8 은 Sprite 를 컨테이너로 쓰는 것을 deprecate 했다.
    // **이펙트 레이어가 아니라 정보 레이어**(이름표와 같은 계)다 — `aboveLayer` 에 섞으면
    // 이펙트 예산 단언이 정보 요소까지 세게 된다(`adorner.ts` §labelLayer).
    ctx.labelLayer.addChild(root);

    this.root = root;
    this.fill = fill;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, _prev: EntitySnapshot, _ctx: AdornerContext): void {
    const root = this.root;
    const fill = this.fill;
    if (root === null || fill === null) return;

    const r = hpRatio(e.hp, e.maxHp);
    // 최대 HP 가 없는 실체(오브젝트성 적)는 띄울 정보가 없다 — 빈 테두리만 남기지 않는다.
    if (r <= 0) {
      root.visible = false;
      return;
    }
    root.visible = true;

    // 형제이므로 위치를 매 프레임 직접 미러한다(부모 변환을 물려받지 않는다).
    root.position.set(sprite.x, sprite.y - sprite.height / 2 - BAR_GAP - BAR_H);

    if (r !== this.ratio) {
      this.ratio = r;
      fill.scale.x = this.innerW * r;
      const band = hpBand(r);
      if (band !== this.band) {
        this.band = band;
        fill.tint = hpBandColor(band);
      }
    }
  }

  /**
   * 형제 회수. 부모 `destroy` 는 형제를 걷지 않는다 — 빠뜨리면 "죽은 적의 체력바가 허공에
   * 남는" 결함이 된다(접지 그림자가 실제로 낸 결함과 같은 형태). 두 번 불려도 안전하다.
   */
  dispose(_ctx: AdornerContext): void {
    const root = this.root;
    this.root = null;
    this.fill = null;
    if (root === null) return;
    root.parent?.removeChild(root);
    root.destroy({ children: true });
  }
}

for (const kind of HP_BAR_KINDS) {
  registerAdornerFactory(kind, () => [new EnemyHpBarAdorner()]);
}
