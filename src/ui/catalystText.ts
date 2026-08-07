/**
 * 촉매 표시 문자열 유도 — 순수 (ADR-0052 레인 D).
 *
 * 구 `catalystLabels.ts` 의 자리를 잇는다. 그 파일은 **축별 배율 줄**(`catalyst.pen.*` /
 * `catalyst.rew.*`)을 라벨로 옮기는 것이 전부였고, 축 모델이 사라지면서 통째로 무효가 됐다.
 * 여기서 옮기는 것은 그 대신 들어온 넷이다 — **규칙문 · 신호 · 태그 · 상한**.
 *
 * ## 왜 다시 한 곳인가
 * 픽커(Pixi)·보관함(Pixi)·런 중 정보판(DOM HUD)이 **같은 문구**를 써야 한다. 세 화면이 각자
 * 키를 유도하면 한쪽만 고쳐져 "픽커는 점화, 보관함은 Ignite" 가 된다(구 파일이 같은 이유로
 * 존재했고, 그 규율만 살아남았다).
 *
 * ## 누락 키 폴백 — 이 파일의 존재 이유 절반
 * `t()` 는 **없는 키에 키 문자열 자체를 돌려준다**(개발 중 누락을 눈에 띄게 하려는 설계).
 * 그대로 화면에 나가면 사용자가 `catalyst.abundance.rule` 을 읽는다. 규칙문·신호 48종은
 * **i18n 레인이 별도로 채우는 중**이라, 도착 전까지는 구 `desc` 한 줄로 접어 두고 신호는
 * 빈 문자열로 접는다 — 화면이 키를 뱉지 않는 것이 계약이다.
 *
 * 순수 문자열 유도라 Pixi 없이 vitest 로 검증된다(`bossLabels.ts` 와 같은 관례).
 */

import type { CatalystCap, CatalystDef, CatalystTag } from '../data/catalysts.js';
import type { ResonanceDef, ResonanceTier } from '../data/catalystResonance.js';
import { t, type MessageKey } from '../i18n/index.js';

/**
 * 키를 찾되 **없으면 폴백**. `t()` 가 키 자체를 되돌려 주는 것을 누락 신호로 읽는다.
 * (`t()` 안에서 못 하는 이유: 그 함수는 카탈로그 전역 계약이고 누락을 드러내는 것이 그쪽 규율이다.)
 */
function tOr(key: string, fallback: string): string {
  const s = t(key as MessageKey);
  return s === key ? fallback : s;
}

/**
 * 촉매 **규칙문** — 이 카드가 무엇을 하는가(양날 한 몸). 픽커 카드 본문이자 보관함 상세 본문.
 *
 * 정본 키는 `catalyst.<slug>.rule` 하나다. 구 `catalyst.<slug>.desc` 폴백은 **끊었다** —
 * i18n 레인이 48종을 다 채웠고(EN/KO 양쪽), 폴백을 남겨 두면 키가 빠진 카드가 조용히 옛 축
 * 문구("페널티: 적 수 증가 / 보상: 드랍량 증가")를 보여 **화면과 규칙이 갈린다.**
 * 지금은 키가 없으면 빈 문자열이라 **누락이 화면에서 바로 보인다** — 그게 옳은 실패 방향이다.
 */
export function catalystRule(def: CatalystDef): string {
  return tOr(`catalyst.${def.slug}.rule`, '');
}

/**
 * 촉매 **신호** — 런 중에 이 규칙이 화면·소리로 어떻게 읽히는가(헌장 §가시성 규율).
 * 없으면 빈 문자열 — 호출부가 줄 자체를 생략한다(빈 줄이 자리만 먹으면 안 된다).
 */
export function catalystSignal(def: CatalystDef): string {
  return tOr(`catalyst.${def.slug}.signal`, '');
}

/** 촉매 이름. */
export function catalystName(def: CatalystDef): string {
  return tOr(`catalyst.${def.slug}.name`, def.slug);
}

/** 태그 표시명(점화·밀도·정밀·수확·도박·침식). */
export function catalystTagLabel(tag: CatalystTag): string {
  return t(`catalyst.tag.${tag}` as MessageKey);
}

/** 상한 축 표시명(드랍·자원·희귀도·XP·촉매 드랍). */
export function catalystCapAxisLabel(cap: CatalystCap): string {
  return t(`catalyst.cap.${cap.axis}` as MessageKey);
}

/**
 * 상한 한 줄 — `드랍 ×2.0`. **정산 유계**이지 "이만큼 발동한다"가 아니다.
 * 배율은 소수 한 자리 고정 — `2` 와 `2.0` 이 섞이면 같은 열에서 자릿수가 흔들린다.
 */
export function catalystCapLine(cap: CatalystCap): string {
  return t('catalyst.cap.line', { axis: catalystCapAxisLabel(cap), mult: cap.mult.toFixed(1) });
}

/** 공명 이름(불씨·되울림 …). ⚠️ 시스템 용어 "공명" 과 촉매 id 20 표시명은 다른 말이다. */
export function resonanceName(def: ResonanceDef): string {
  return tOr(`catalyst.resonance.${def.slug}.name`, def.slug);
}

/** 공명 규칙문. */
export function resonanceRule(def: ResonanceDef): string {
  return tOr(`catalyst.resonance.${def.slug}.rule`, '');
}

/** 단 표시명(약공명/강공명). */
export function resonanceTierLabel(tier: ResonanceTier): string {
  return t(`catalyst.resonance.tier.${tier}` as MessageKey);
}
