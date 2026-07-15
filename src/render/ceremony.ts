/**
 * 유니크 드랍 세리머니 — 렌더 전용 (M2 plan F2, AC7 후단).
 *
 * loot 엔티티 중 rarity=unique(enemyType===3)가 화면에 새로 나타나는 순간 0.5초
 * 슬로모 + 금빛 플래시를 연출한다. 순수 렌더/UX 계층 — 시뮬 상태·RNG·해시에 전혀
 * 손대지 않는다. 슬로모는 게임 루프의 dt 배율(hit-stop)로만 구현하며, 입력 로그는
 * 매 틱 그대로 기록되므로 리플레이/검증(ADR-0005)은 bit-identical하게 유지된다.
 *
 * 금빛 플래시는 DOM 오버레이(전체 화면 고정, pointer-events 없음)로, 기존 HUD/오버레이
 * 와 동일한 DOM 계층 패턴을 따른다. PixiJS·외부 자원 의존 없음.
 */

import type { WorldSnapshot } from '../sim/snapshot.js';
import { RARITY_CODE } from '../items/types.js';

/** 세리머니 지속(초): 0.5s. */
const DURATION_SEC = 0.5;
/** 슬로모 배율(게임 루프 dt에 곱): 0.35배 속도. */
const SLOWMO_SCALE = 0.35;
/** 금빛 플래시 최대 불투명도. */
const FLASH_PEAK = 0.55;

export class UniqueCeremony {
  private readonly el: HTMLDivElement;
  /** 남은 세리머니 시간(초). */
  private remaining = 0;
  /** 이미 세리머니를 튼 loot 엔티티 id(중복 트리거 방지). */
  private readonly seen = new Set<number>();

  constructor(parent: HTMLElement = document.body) {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    el.style.zIndex = '50';
    // 중앙에서 번지는 금빛 방사 그라디언트.
    el.style.background =
      'radial-gradient(circle at 50% 45%, rgba(255,215,90,0.9) 0%, rgba(255,180,40,0.35) 35%, rgba(255,170,30,0) 70%)';
    el.style.transition = 'opacity 60ms linear';
    parent.appendChild(el);
    this.el = el;
  }

  /**
   * 이번 스냅샷에서 처음 보이는 유니크 loot를 찾으면 세리머니를 발동한다. 매 프레임
   * 호출해도 안전(같은 loot id는 한 번만 튼다).
   */
  notice(snap: WorldSnapshot): void {
    for (const e of snap.entities) {
      if (e.kind !== 'loot') continue;
      if (e.enemyType !== RARITY_CODE.unique) continue;
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      this.remaining = DURATION_SEC;
    }
  }

  /**
   * 실시간 dt(초)만큼 세리머니를 진행하고, 게임 루프가 dt에 곱할 시간 배율을 돌려준다
   * (세리머니 중 SLOWMO_SCALE, 아니면 1). 금빛 플래시 불투명도도 여기서 갱신한다.
   */
  update(dtSec: number): number {
    if (this.remaining <= 0) {
      if (this.el.style.opacity !== '0') this.el.style.opacity = '0';
      return 1;
    }
    this.remaining -= dtSec;
    // 남은 비율에 따라 밝기 페이드(피크에서 시작해 사그라듦).
    const frac = this.remaining > 0 ? this.remaining / DURATION_SEC : 0;
    this.el.style.opacity = String(FLASH_PEAK * frac);
    return SLOWMO_SCALE;
  }

  /** 세리머니 진행 중 여부. */
  get active(): boolean {
    return this.remaining > 0;
  }
}
