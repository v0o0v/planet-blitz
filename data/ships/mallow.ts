/**
 * mallow = 기체 타입 5, 완충 재생 (로스터 7종 확장, 2026-07-21 사용자 지시).
 *
 * ## 컨셉
 * 마시멜로. 폭신해서 충격을 "먹는다" — 피격 피해의 일부를 즉시가 아니라 **지연 피해**로
 * 돌리고, 무피격이 임계 틱 이어지면 그 몫을 정산(일부 소멸·일부 선체행)한다. "피해를 나중에
 * 갚는다"의 부채 관리 게임 — 시그니처(비트 22, `src/sim/shipSignature.ts` 의
 * `SIG_MALLOW_CUSHION`)는 이미 sim 전 구간 배선 완료 상태다. 설계 정본은
 * `.omc/plans/skill-rebuild-2026-08-05/mallow.md`(확정 4판) — 레벨 공식·침공 판정·구현
 * 태그는 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구**만 담는다.
 *
 * ## 빌드 방향
 * **비율 체력(maxHpPct) 1위.** 브루저가 flat 장갑을 쌓아 "두꺼운 선체"라면, 말로우는 기본
 * 체력을 배로 부풀리는 축이라 계보·장비로 기본 HP 가 커질수록 함께 커진다 — 같은 defense
 * affinity 인데 성장 곡선이 다르다. `baseBp`(dmg −8% · 연사 −2% · HP +18% · 이동 +6%)가
 * 같은 축을 굳힌다: 브루저(HP +25% · 이동 −5%)와 달리 **둔하지 않다** — 맞아도 버티면서
 * 계속 돌아다니는 기체다.
 *
 * ## 축 대응(설계서 ↔ 이 파일, 순서 불변)
 *   squish(offense) = 설계서 SQ축(짓뭉개기 — 빚을 화력으로) · mend(utility) = 설계서 ME축
 *   (어루만짐 — 빚을 경제·동선으로) · cushion(defense) = 설계서 CU축(쿠션 — 빚의 성질).
 *
 * ## 축 순서를 바꾸지 않는다
 * `[squish(offense), mend(utility), cushion(defense)]` — 구 레이아웃 순서 그대로다.
 * 액티브 레지스트리(`data/ships/actives/mallow.ts`)가 `treeIndex` 로 축을 가리키고 i18n
 * 키가 축 slug 를 쓰므로, 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 5` — SHIP_TYPES 인덱스 = 세이브 wire 값. append-only
 *   - `signatureBit = 22`(`SIG_MALLOW_CUSHION` 이 정본, `tests/shipSignatureRegistry.test.ts`
 *     가 두 값을 마주 세운다)
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'mallow';

/** 짓뭉개기 — 빚을 화력으로 굴리는 축. */
const SQUISH: readonly SkillSpec[] = [
  ['SQ1', 'debt-fury', '부채 격노', '적립된 지연 피해(부채)에 비례해 주무기 볼리 피해가 증폭된다'],
  ['SQ2', 'settlement-blast', '청산 폭발', '정산 틱에 그 정산으로 선체에 실제 들어간 피해량에 비례한 즉발 자기 주변 폭발이 터진다'],
  ['SQ3', 'body-recoil', '몸통 반발', '실제로 HP 가 깎인 피격 틱에 최근접 적 1기에게 반격 피해를 되돌린다'],
  ['SQ4', 'debt-stamp', '압인 탄두', '부채 보유 중 발사한 탄이 명중한 적을 좌표 직접 변위로 밀어낸다'],
  ['SQ5', 'forgiveness-loader', '탕감 장전', '정산에서 탕감된 양이 이후 볼리들에 추가 피해로 장전된다'],
  ['SQ6', 'instant-exchange', '즉석 환전', '공격 액티브(짓뭉개기 계열) 발동 시 부채 환산율이 개선되고 청산 탄에 관통과 탄당 피해 증폭이 실린다'],
  ['SQ7', 'momentum-launch', '관성 사출', '이동 입력 중 발사한 볼리는 입력 방향과 발사각의 일치도만큼 탄속·피해가 실린다'],
  ['SQ8', 'scar-cannon', '흉터 포문', '정산으로 선체에 실제 들어간 피해가 런 내 누적될수록 볼리 피해가 영구 증가한다'],
  ['SQ9', 'interest-burn', '이자 소각', '부채 보유 중 명중한 적에게 화상을 부여하고, 화상 만료 또는 사망 시 부채가 소액 탕감된다'],
  ['SQ10', 'maturity-volley', '만기 일제', '방어 액티브(전량 유예 만기) 정산 틱 전용으로 정산액에 비례한 방향성 관통 탄막을 발사한다'],
];

/** 어루만짐 — 빚을 경제·동선으로 굴리는 축. */
const MEND: readonly SkillSpec[] = [
  ['ME1', 'early-repayment', '조기 상환', '젬을 수거할 때마다 무피격 카운터가 추가로 흐른다'],
  ['ME2', 'debt-magnet', '채무 자석', '부채가 클수록 젬 자석 반경이 커진다'],
  ['ME3', 'painless-drive', '무통 주행', '감속이 걸려 있어야 할 동안 감속 대신 주기적으로 부채가 쌓인다'],
  ['ME4', 'rebate-therapy', '반환 요법', '정산 틱에 탕감분의 일부가 HP 로 회복되되 그 정산의 선체행을 넘지 않는다'],
  ['ME5', 'installment-plan', '분할 상환', '정산이 한 번에 들어오지 않고 절반씩 2회로 나뉜다'],
  ['ME6', 'afterimage-rinse', '잔상 세척', '이동 액티브(블링크)의 도착 지점에 적탄 소거와 냉기 부여 반경이 생긴다'],
  ['ME7', 'echo-bond', '에코 채권', '에코 안정화·조우 완수 틱에 부채가 전액 소각되고 소각량에 비례한 자석 버프 창이 열린다'],
  ['ME8', 'rhythm-forgiveness', '리듬 탕감', '젬 콤보 스택이 유지되는 동안 정산의 탕감 비율이 올라간다'],
  ['ME9', 'fluff-convalescence', '솜틀 요양', '벽 슬라이드 접촉을 일정 틱 이상 유지하는 동안 정산 임계 자체가 낮아진다'],
  ['ME10', 'growth-conversion', '성장 환전', '레벨업 파워업 픽 적용 틱에 부채의 절반이 경험치로 환전되어 런 XP 에 들어간다'],
];

/** 쿠션 — 빚의 성질을 바꾸는 축. */
const CUSHION: readonly SkillSpec[] = [
  ['CU1', 'overload-absorb', '과부하 흡수', '한 피격의 피해가 임계 이상이면 임계 초과분 전액이 지연분으로 넘어간다'],
  ['CU2', 'debt-ceiling', '부채 한도', '부채에 한도가 생겨, 한도를 초과해 미뤄질 몫은 처음부터 즉시분으로 남는다'],
  ['CU3', 'painless-settlement', '무통 정산', '한 번의 정산이 선체에서 가져갈 수 있는 양에 상한이 생기고 넘치는 몫은 다음 정산으로 이월된다'],
  ['CU4', 'recoil-rinse', '반발 세척', '부채 보유 중 실피격 틱에 주변 적탄을 소거하며 소거 반경이 부채에 비례해 커진다'],
  ['CU5', 'full-deferral-stance', '전량 유예 태세', '방어 액티브(카운터 가속) 지속 중 받는 피해의 지연 비율이 크게 올라간다'],
  ['CU6', 'bankruptcy-protection', '파산 보호', '치명 피격을 런당 1회, 피해 전액을 지연 전환해 살아남는다'],
  ['CU7', 'healed-hide', '아문 살갗', '연속 무피격 틱에 비례해 받는 피해가 감소한다'],
  ['CU8', 'pain-anesthesia', '통증 마취', '부채 보유 중 이동 속도가 오른다'],
  ['CU9', 'grace-of-settlement', '유예의 은총', '정산 틱에 짧은 무적이 선다'],
  ['CU10', 'perpetual-capitalization', '영구 채무 자본화', '정산마다 탕감된 양의 일부만큼 최대 HP 가 런 내 영구 증가한다'],
];

export const MALLOW: ShipTypeDef = {
  id: 5,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'squish', 'offense', SQUISH),
    buildShipAxis(SLUG, 'mend', 'utility', MEND),
    buildShipAxis(SLUG, 'cushion', 'defense', CUSHION),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 22,
  baseBp: { damageBp: -800, fireRateBp: -200, maxHpBp: 1800, moveSpeedBp: 600 },
};
