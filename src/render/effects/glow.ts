/**
 * 발광체 글로우 — 가산 헤일로 + High 티어 타이트 블룸 (Phase 3 — plan §AC-3.1 · ADR-0031).
 *
 * Phase 1 갤러리([src/harness/gallery/glowVariants.ts])에서 사용자가 고른 글로우 룩
 * (`glow-bloom-tight` = "타이트 블룸", `.omc/state/fx-gallery-choices.json`)을 **프로덕션 정규
 * 경로**로 승격한 것이다. 두 조각으로 나뉜다:
 *
 *  1. **가산 헤일로**({@link buildGlowHalo}) — 갤러리 `glow-halo-soft` 의 계층형 헤일로를 승격한
 *     기본선. 동심원 저알파 falloff 를 add 블렌드로 쌓아 텍스처·GL 없이 부드러운 발광을 만든다.
 *     **전 티어·headless node 에서 성립**한다(필터 0 — `new Graphics()` + 도형 기록만). glowLayer
 *     (스프라이트 **아래**, AC-0.8)에 얹혀 발광체 밑에서 새어 나오는 빛이 된다.
 *  2. **타이트 블룸 필터**({@link createGlowBloomFilter}) — `glow-bloom-tight` 의 파라미터
 *     (threshold↑·blur↓ = 코어 또렷)로 pixi-filters `AdvancedBloomFilter` 를 감싼 1패스 필터.
 *     **High 티어에서만** entityRenderer 가 `glowLayer.filters` 로 건다(effectGates.bloom). GL 부재/
 *     컴파일 실패 시 `tryCreateFilter` 가 null 로 폴백 → 헤일로만 남는다(AC-3.6, headless 안전).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉(타입조차 import 하지 않는다). 결정론(hashWorld/hashEntity)과
 *    무관하다. {@link isGlowEmitter} 는 sim `EntityKind` 대신 **plain string** 을 받아 완전 디커플.
 *  - **combat 레지스터(SF 픽셀아트)**: 시원한 시안 톤 가산(add) 헤일로. 색·세기는 거동에 무관.
 *  - **발광체에만**(CONTEXT.md "발광체"): 폭발·보스 코어·젬·전리품·레벨업·머즐·플레이어뿐. **탄은
 *    제외** — 수천 개가 발광하면 흰 코어가 서로 번져 판정점 회피의 "틈"이 사라진다. {@link isGlowEmitter}
 *    가 그 allowlist 를 코드로 못박는다.
 *  - **GL 없는 node 에서도 성립**: 헤일로는 절차적 `Graphics`(동심원)라 생성 즉시 표시 객체가 붙는다
 *    (`container.children.length > 0`). 블룸은 지연·guard 라 node import 만으로는 아무것도 안 만든다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 링 수·알파·반경·threshold·blur·색온도는 전부 placeholder
 * 다. 실제 값은 구현 완료 후 출시 직전 graphicsSettings 티어 상한과 함께 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics, type Filter } from 'pixi.js';
import { createBloomFilter, tryCreateFilter, type BloomFilterOptions } from '../shaders/index.js';

// ---------------------------------------------------------------------------
// 헤일로 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/**
 * 헤일로 링 1개당 가산 알파. 링이 겹쳐 중심이 밝아진다(add 블렌드 누적). 갤러리
 * `glow-halo-soft` 의 `RING_ALPHA` 승격값. placeholder.
 */
const RING_ALPHA = 0.09;

/**
 * 헤일로 링 수. 많을수록 falloff 가 부드럽지만 draw 비용↑. 갤러리 `RING_COUNT` 승격값. placeholder.
 */
const RING_COUNT = 7;

/**
 * 기본 헤일로 색(combat SF 시안). 갤러리 `glow-halo-soft` 의 `haloColor` (0x39c8ff) 승격값.
 * 발광체별로 색을 달리하려면 {@link buildGlowHalo} 의 `color` 인자로 덮는다(젬=시안, 보스=웜 등). placeholder.
 */
export const DEFAULT_HALO_COLOR = 0x39c8ff;

/**
 * 타이트 블룸 파라미터. 갤러리 `glow-bloom-tight` 변형이 쓰던 값 그대로
 * ([src/harness/gallery/glowVariants.ts] `bloomTight.makeFilter`) — threshold↑·blur↓ 라 발광이
 * 코어 근처에만 남고 코어 실루엣이 또렷하게 보존된다(가독 우선의 "타이트" 룩). 전부 placeholder.
 */
const TIGHT_BLOOM: BloomFilterOptions = {
  threshold: 0.6,
  blur: 4,
  bloomScale: 1.25,
  brightness: 1.0,
  quality: 4,
};

// ---------------------------------------------------------------------------
// buildGlowHalo — 발광체 밑에 깔 가산 헤일로(절차적·node 안전)
// ---------------------------------------------------------------------------

/**
 * 발광체용 가산 헤일로를 만든다. 동심원 링을 add 블렌드로 쌓아 중심이 밝은 부드러운 falloff 를
 * 절차적으로(텍스처·GL 없이) 그린다 — glowLayer 규율(AC-0.8)과 동형이라 이 컨테이너를 발광체
 * 스프라이트 **아래**(glowLayer)에 origin(0,0) 기준으로 놓으면 밑에서 새어 나오는 빛이 된다.
 *
 * 원점(0,0) 중심이라 호출측(entityRenderer)이 발광체 위치로 `position` 만 옮기면 된다. 생성 즉시
 * 표시 객체(Graphics)가 붙어 `container.children.length > 0` 이 보장된다(배선 스모크 근거, node 안전).
 *
 * @param radius 헤일로 최대(외곽) 반경(px). 가장 바깥 링의 반지름 = 이 값. 링은 안쪽으로 갈수록
 *               반경이 `radius × i/RING_COUNT` 로 줄며 겹쳐 밝아진다.
 * @param color  헤일로 색(0xRRGGBB). 미지정 시 {@link DEFAULT_HALO_COLOR}(시안). 발광체 톤에 맞춰 덮는다.
 * @returns add 블렌드 `Container`(자식 1 = 동심원 Graphics). 폐기 시 `container.destroy({ children: true })`.
 */
export function buildGlowHalo(radius: number, color: number = DEFAULT_HALO_COLOR): Container {
  const halo = new Container();
  halo.blendMode = 'add';

  // 0 이하 방어: 최소 반경. (음수/0 이면 도형이 안 그려져 children 은 있으나 bounds 가 0 이 된다.)
  const maxR = radius > 0 ? radius : 0.001;

  const g = new Graphics();
  // 외곽(t=1)부터 중심(t=1/RING_COUNT)으로 큰 링을 먼저 깔고 작은 링을 위에 겹친다.
  // add 블렌드라 겹칠수록 밝아져 중심이 핫하고 가장자리로 부드럽게 falloff 한다(텍스처 불필요).
  for (let i = RING_COUNT; i >= 1; i--) {
    const t = i / RING_COUNT; // 1(외곽) .. 1/RING_COUNT(중심)
    g.circle(0, 0, maxR * t).fill({ color, alpha: RING_ALPHA });
  }
  halo.addChild(g);

  return halo;
}

// ---------------------------------------------------------------------------
// createGlowBloomFilter — High 티어 발광체 블룸(타이트 파라미터·graceful 폴백)
// ---------------------------------------------------------------------------

/**
 * High 티어 발광체 글로우용 타이트 블룸 필터를 만든다. 사용자가 고른 `glow-bloom-tight` 파라미터
 * ({@link TIGHT_BLOOM})로 pixi-filters `AdvancedBloomFilter` 를 감싼 1패스 필터다.
 *
 * entityRenderer 가 **High 티어에서만**(effectGates.bloom) `glowLayer.filters = [f]` 로 건다. 발광
 * 렌더타깃(glowLayer) 전체에 한 번만 걸어 발광체 헤일로가 코어 근처에서 또렷하게 피어오르게 한다.
 *
 * 생성은 이중 `tryCreateFilter` 로 감싼다({@link createBloomFilter} 자체도 내부에서 감싸지만,
 * 갤러리 `tryCreateFilter(() => createBloomFilter(...))` 관용구를 그대로 승격해 방어를 겹친다). GL
 * 부재/셰이더 컴파일 실패 시 예외를 삼키고 **null → 헤일로만**으로 폴백한다(AC-3.6, headless node 안전).
 * 인스턴스화는 **호출 시점에만** — 모듈 import 만으로는 아무 필터도 안 만든다(node-env import 안전).
 *
 * @returns 블룸 필터, 또는 생성 실패 시 null(폴백 — 블룸 생략, 헤일로만으로 게임 계속).
 */
export function createGlowBloomFilter(): Filter | null {
  return tryCreateFilter(() => createBloomFilter(TIGHT_BLOOM));
}

// ---------------------------------------------------------------------------
// isGlowEmitter — 발광체 allowlist 판정(CONTEXT "발광체" 정합)
// ---------------------------------------------------------------------------

/**
 * 발광이 허용되는 엔티티 kind allowlist(CONTEXT.md "발광체"). 수 적은 고임팩트체만 발광한다:
 *  - `player` — 플레이어 기체.
 *  - `gem`    — 젬(경험치·자원 픽업).
 *  - `loot`   — 전리품(장비 드랍).
 *  - `boss`   — PvE 보스 코어.
 *  - `defenseBoss` — 방어전 보스(PvE boss 와 별 kind 지만 발광체 자격은 같다).
 *
 * **탄(`bullet`/`enemyBullet`)·적 실루엣(`enemy`)은 의도적으로 제외**한다 — 수천 개가 발광하면
 * 흰 코어 아웃라인이 서로 번져 판정점 회피의 "틈"이 사라지고 저사양 성능이 무너진다(시각 권위의 규율).
 *
 * ⚠️ 폭발·머즐 플래시·레벨업 같은 나머지 발광체는 **엔티티가 아니라 이펙트**라 여기 없다 — 각 이펙트
 * 모듈(explosion.ts 등)이 자기 가산 룩을 직접 낸다. 이 판정은 "지속 발광 스프라이트"에만 쓰인다.
 */
const GLOW_EMITTER_KINDS: ReadonlySet<string> = new Set<string>([
  'player',
  'gem',
  'loot',
  'boss',
  'defenseBoss',
]);

/**
 * 이 엔티티 kind 가 발광체(글로우 허용)인지 판정한다. render-only 디커플을 위해 sim `EntityKind`
 * 대신 **plain string** 을 받는다 — entityRenderer 가 `e.kind`(EntityKind, string 에 대입 가능)를
 * 그대로 넘긴다. allowlist 밖(탄·적·기물 등)은 전부 false 라 발광이 새지 않는다.
 *
 * @param kind 엔티티 kind 문자열(예: 'player', 'bullet', 'gem').
 * @returns 발광체면 true, 아니면 false.
 */
export function isGlowEmitter(kind: string): boolean {
  return GLOW_EMITTER_KINDS.has(kind);
}
