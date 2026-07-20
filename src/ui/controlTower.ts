/**
 * 관제탑 — 침공(비동기 PvP) 사령 화면 (M4 Phase D3, plan §4/AC10, GDD §8).
 *
 * 공격자가 침공 대상을 고르고 침공 런을 시작하는 화면이다. 세 블록으로 구성된다:
 *   1) 타깃 제안 목록 — RPC `get_invasion_targets()`(내 위 랭커 3명 + 30위 랜덤 1명).
 *      각 행: 순위·이름·기체 요약·정비도 + 정찰/침공 버튼. 재도전 쿨다운 1h(서버 강제)
 *      미러로 버튼을 비활성·남은 시간 표시.
 *   2) 기지 정찰 뷰 — 선택한 대상의 3레이어 배치 요약(M7a 임시 텍스트, 정식판은 M7b).
 *   3) 순위표 — `ladder` 상위 조회(관제탑 래더 표시).
 *
 * 서버 권위(원칙2): 침공 런의 클라이언트 결과는 잠정이며, `submitInvasion` 의 서버 판정이
 * 최종이다. 이 화면은 결과 배너로 서버 판정을 표시한다(잠정→최종).
 *
 * env 미설정/미로그인: net 계층이 `null` 을 돌려주므로 목록·순위표가 비활성 안내 상태로
 * 뜬다(기존 로컬 플레이 100% 유지 — 침공만 잠긴다).
 *
 * 결정론 무관: 렌더/네트워크 전용. 침공 런의 정적 배치(layout)만 sim config 로 흘러가고
 * 그 시뮬은 sim 이 결정론으로 재현한다. layout 은 **반드시 {@link normalizeTargetLayers}** 로
 * 정규화(내부적으로 sim 정본 `normalizeInvasionLayers`)해 Invasion3Config 를 구성한다 —
 * raw jsonb 를 sim 에 그대로 넣으면 클라·서버 재실행이 갈린다(ADR-0005 보호).
 */

import type { Profile } from '../save/profile.js';
import type { InvasionLayers } from '../sim/invasion/types.js';
import { normalizeInvasionLayers } from '../sim/invasion/normalize.js';
import {
  INVASION_WAVE_SLOTS,
  INVASION_PROP_SLOTS,
} from '../sim/invasion/constants.js';
import {
  fetchInvasionTargets,
  fetchLadder,
  fetchPlacementStatus,
  fetchPlacementTargets,
  fetchRevengeTargets,
  fetchIncomingInvasions,
  applyPlacementResult,
  placementPhase,
  placementProgressLabel,
  placementRemaining,
  readInvasionCooldowns,
  cooldownRemainingMs,
  revengeRemainingMs,
  formatRevengeRemaining,
  readInvasionsSeenAt,
  writeInvasionsSeenAt,
  countUnseenInvasions,
  type InvasionTarget,
  type LadderEntry,
  type ShipSummary,
  type PlacementStatus,
  type PlacementResult,
  type RevengeTarget,
  type IncomingInvasion,
} from '../net/invasion.js';
import { stickerLabel } from '../../data/stickers.js';
import { seedBaseByProfileId } from '../../data/seedBases.js';
import type { CardInstance } from '../../data/defenseCards.js';
import { cardRarityColor, cardRarityLabel, cardAffixOneLine } from './cardsView.js';
import { t } from '../i18n/index.js';

// ---------------------------------------------------------------------------
// 표시 데이터
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 순수 표시 로직 (테스트 대상 — DOM 무관)
// ---------------------------------------------------------------------------

/** 기체 요약 → 한 줄 텍스트("이름 · Lv N"). 필드 부재 시 방어적 폴백. */
export function shipSummaryText(summary: ShipSummary): string {
  const name = typeof summary.name === 'string' && summary.name.length > 0 ? summary.name : t('ctl.ship.unknown');
  const level = typeof summary.level === 'number' && Number.isFinite(summary.level) ? summary.level : null;
  return level !== null ? t('ctl.ship.withLevel', { name, level }) : name;
}

/** 정비도 라벨("정비도 87%"). 0~100 밖은 클램프. */
export function maintenanceLabel(maintenance: number): string {
  const m = Number.isFinite(maintenance) ? Math.max(0, Math.min(100, Math.round(maintenance))) : 0;
  return t('ctl.maintenance', { m });
}

/** 남은 쿨다운(ms) → 사람이 읽는 라벨. 0 이하면 빈 문자열(즉시 가능). */
export function formatCooldown(remainingMs: number): string {
  if (remainingMs <= 0) return '';
  const totalMin = Math.ceil(remainingMs / 60000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? t('ctl.cooldown.hm', { h, m }) : t('ctl.cooldown.h', { h });
  }
  return t('ctl.cooldown.min', { n: totalMin });
}

/** 침공 버튼 상태(순수): 침공 가능 여부 + 비활성 사유. */
export interface InvadeState {
  canInvade: boolean;
  /** 비활성 사유(canInvade=true 면 빈 문자열). */
  reason: string;
  /** 정규화된 3레이어 배치(침공 런 config 입력). 배치 없음/손상이면 null. */
  layout: InvasionLayers | null;
}

/**
 * 서버가 준 raw layout → 정규화된 3레이어 배치. **"배치 없음"을 구분하는 유일한 지점**이다.
 *
 * `normalizeInvasionLayers` 는 total function 이라 무엇을 넣어도 정규형을 돌려준다(빈 배치로
 * 폴백). 그건 sim·해시 입력으로는 옳지만 UI 로는 위험하다 — 서버 응답이 통째로 비었거나 구
 * 형식(`{core,turrets,obstacles}`)이어도 "정상 기지"로 보여 침공 버튼이 열리기 때문이다.
 * 그래서 여기서 **3레이어 형태인지**(l1/l2/l3 중 하나라도 있는 객체인지)를 먼저 보고, 아니면
 * null 을 돌려 호출부가 "방어 기지 없음"으로 분기하게 한다.
 */
export function normalizeTargetLayers(raw: unknown): InvasionLayers | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o['l1'] === undefined && o['l2'] === undefined && o['l3'] === undefined) return null;
  return normalizeInvasionLayers(raw);
}

/**
 * 한 대상에 대한 침공 버튼 상태를 계산한다(순수). 우선순위:
 *   1) 배치 layout 이 정규화되지 않으면(없음/손상) → 침공 불가("방어 기지 없음").
 *   2) 재도전 쿨다운이 남아 있으면 → 침공 불가(남은 시간 표시).
 *   3) 그 외 → 침공 가능.
 */
export function computeInvadeState(
  target: InvasionTarget,
  cooldowns: Record<string, number>,
  nowMs: number,
): InvadeState {
  const layout = normalizeTargetLayers(target.layout);
  if (layout === null) {
    return { canInvade: false, reason: t('ctl.noBase'), layout: null };
  }
  const remaining = cooldownRemainingMs(cooldowns, target.profileId, nowMs);
  if (remaining > 0) {
    return { canInvade: false, reason: formatCooldown(remaining), layout };
  }
  return { canInvade: true, reason: '', layout };
}

/**
 * 배치전 대상의 침공 버튼 상태(순수). 일반 침공과 달리 **재도전 쿨다운을 무시**한다
 * (계약 §2 — 배치전은 NPC 전용·쿨다운 없음). 배치 layout 정규화만 검사한다.
 */
export function computePlacementInvadeState(target: InvasionTarget): InvadeState {
  const layout = normalizeTargetLayers(target.layout);
  if (layout === null) {
    return { canInvade: false, reason: t('ctl.noBase'), layout: null };
  }
  return { canInvade: true, reason: '', layout };
}

/**
 * 배치전 대상 표시명을 시드 메타로 보강한다(순수). 서버가 display_name 을 주면 그대로,
 * 없으면 seedBases 메타의 한글 이름으로 대체한다("난이도밴드 · 이름" 형태 라벨도 제공).
 */
export function placementTargetName(target: InvasionTarget): string {
  if (target.displayName.length > 0 && target.displayName !== '무명 파일럿') return target.displayName;
  const meta = seedBaseByProfileId(target.profileId);
  return meta !== null ? meta.name : target.displayName;
}

// ---------------------------------------------------------------------------
// 복수전 카드 표시 로직 (순수 · 테스트 대상) — 계약 §F1/AC6
// ---------------------------------------------------------------------------

/** 복수 대상 카드 1장의 표시 상태(순수). */
export interface RevengeCardState {
  /** 24h 창이 만료됐는지(만료면 복수 불가 — 서버도 제외하지만 UI 이중 방어). */
  expired: boolean;
  /** 잔여시간 라벨("복수 가능 N시간 남음"). 만료면 빈 문자열. */
  remainingLabel: string;
  /** 방어 배치 정규화 결과(복수 침공 런 config). 배치 없음/손상이면 null. */
  layout: InvasionLayers | null;
}

/**
 * 복수 대상 카드 상태(순수). 24h 창 잔여 + 배치 정규화. 쿨다운은 **무시**한다(계약 §F1 —
 * 복수는 쿨다운 예외, 서버가 격차·쿨다운 예외를 강제). 만료됐거나 배치가 없으면 복수 불가.
 */
export function revengeCardState(target: RevengeTarget, nowMs: number): RevengeCardState {
  const remaining = revengeRemainingMs(target.expiresAtMs, nowMs);
  const layout = normalizeTargetLayers(target.layout);
  return {
    expired: remaining <= 0,
    remainingLabel: formatRevengeRemaining(remaining),
    layout,
  };
}

/** 알림 배너 문구(순수). 미확인 0 이면 빈 문자열(배너 숨김). */
export function incomingBannerText(unseenCount: number): string {
  if (unseenCount <= 0) return '';
  return t('ctl.incoming.banner', { n: unseenCount });
}

/**
 * 알림 한 행 문구(순수). 공격자 이름 + 결과(함락/방어) + 상대 도발 스티커(있으면).
 * 복수 침공이면 앞에 "[복수]" 를 붙여 강조한다.
 */
export function incomingRowText(inv: IncomingInvasion): string {
  const who = inv.attackerName.length > 0 ? inv.attackerName : t('ctl.anonymous');
  const outcome = inv.attackerWon ? t('ctl.incoming.fell') : t('ctl.incoming.held');
  const prefix = inv.isRevenge ? t('ctl.incoming.revengePrefix') : '';
  const taunt = stickerLabel(inv.sticker);
  const tauntText = taunt.length > 0 ? t('ctl.incoming.taunt', { taunt }) : '';
  return `${prefix}${who} — ${outcome}${tauntText}`;
}

/** 침공 결과 배너에 표시할 요약(main 이 서버 판정/잠정 결과로 채운다). */
export interface InvasionResultView {
  /** 최종(서버) 또는 잠정(클라) 승패. null = 서버가 실값을 아직 안 줌(판정 확정 중). */
  attackerWon: boolean | null;
  /** 서버 판정 상태. 미제출(로컬 전용)이면 undefined. */
  status?: 'verified' | 'rejected';
  /** 서버에 제출·판정됐는지. false = env 미설정/오프라인으로 잠정 결과만. */
  submitted: boolean;
  /** 스왑 후 순위(서버 판정 시). */
  ladder?: { attackerRank: number; defenderRank: number } | null;
  /** 복제 약탈 전리품 수. */
  lootCount?: number;
  /** 대상 이름(배너 문구용). */
  targetName?: string;
  /** 복수전 판정(서버 EF). 복수 성공 시 자리 탈환 + 보너스 광물 강조. */
  revenge?: boolean;
  /** 복수 성공 보너스 광물(서버 지급분). */
  bonusMinerals?: number;
}

/** 결과 배너 문구(순수). 서버 권위: 제출된 경우 status 를 최종으로 반영. */
export function resultBannerText(view: InvasionResultView): string {
  const who = view.targetName !== undefined && view.targetName.length > 0 ? `${view.targetName} ` : '';
  if (!view.submitted) {
    // 서버 미제출 — 잠정 결과만(런은 끝났으나 판정 미확정).
    const outcome = view.attackerWon === true ? t('ctl.res.provWin') : t('ctl.res.provLose');
    return t('ctl.res.unsubmitted', { who, outcome });
  }
  if (view.status === 'rejected') {
    return t('ctl.res.rejected', { who });
  }
  // verified — 서버가 승패 실값을 아직 안 준 응답(null)은 패배로 강제하지 않고 "확정 중".
  if (view.attackerWon === null) {
    return t('ctl.res.pending', { who });
  }
  if (view.attackerWon) {
    const rankText = view.ladder != null ? t('ctl.res.rank', { n: view.ladder.attackerRank }) : '';
    const lootText = view.lootCount !== undefined && view.lootCount > 0 ? t('ctl.res.loot', { n: view.lootCount }) : '';
    const bonusText =
      view.revenge === true && view.bonusMinerals !== undefined && view.bonusMinerals > 0
        ? t('ctl.res.bonus', { n: view.bonusMinerals })
        : '';
    const head = view.revenge === true ? t('ctl.res.revengeHead') : t('ctl.res.winHead');
    return t('ctl.res.winLine', { who, head, extra: `${rankText}${lootText}${bonusText}` });
  }
  return t('ctl.res.lose', { who });
}

/**
 * 3레이어 배치 정찰 요약 한 줄(순수). 정식 정찰 화면(레이어별 실루엣·등급·승급 표시)은
 * **M7b-command-ui** 가 만든다 — 여기서는 "몇 개나 배치돼 있는가"만 센다.
 *
 * 구 구현은 15×9 미니 격자에 포탑·장애물 글리프를 찍었다. 3레이어에는 격자가 없어 그 표현이
 * 통째로 성립하지 않으므로 M7a 에서는 텍스트로 낮춘다(레인 문서 L11 ④).
 *
 * 정찰 정보 공개 범위(결정 #15): 슬롯 **점유 수**까지만 세고 카탈로그 id·레벨·어픽스 같은
 * 정확 스펙은 노출하지 않는다.
 */
export function reconSummary(layers: InvasionLayers): string {
  const filled = (slots: readonly (unknown | null)[]): number =>
    slots.reduce<number>((n, s) => (s === null || s === undefined ? n : n + 1), 0);
  return t('ctl.recon.summary3', {
    f: filled(layers.l1.waveSlots),
    fm: INVASION_WAVE_SLOTS,
    s: filled(layers.l2.sockets),
    sm: layers.l2.sockets.length,
    p: filled(layers.l3.props),
    pm: INVASION_PROP_SLOTS,
    b: layers.l3.boss !== null ? 1 : 0,
  });
}

// ---------------------------------------------------------------------------
// DOM 오버레이
// ---------------------------------------------------------------------------
const STYLE = `
#pb-ctl { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; gap:12px; padding:20px 16px; box-sizing:border-box; background:radial-gradient(circle at 50% 16%,#12102a,#04030a 76%); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:29; overflow:auto; }
#pb-ctl h1 { margin:0; color:#c86aff; font-size:24px; font-weight:900; letter-spacing:2px; }
#pb-ctl .pb-sub { color:#8896b8; font-size:12px; margin-top:-6px; }
#pb-ctl .pb-banner { max-width:640px; text-align:center; font-size:13px; font-weight:700; padding:8px 14px; border-radius:10px; }
#pb-ctl .pb-banner.win { background:rgba(60,120,60,.35); color:#8fe08f; border:1px solid #3d8a4d; }
#pb-ctl .pb-banner.lose { background:rgba(120,60,60,.3); color:#ff9a9a; border:1px solid #8a3d3d; }
#pb-ctl .pb-banner.info { background:rgba(40,44,72,.6); color:#c3cdea; border:1px solid #2a3552; }
#pb-ctl .pb-cols { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; justify-content:center; width:100%; max-width:900px; }
#pb-ctl .pb-panel { background:rgba(12,14,30,.72); border:1px solid #2a3552; border-radius:14px; padding:14px; box-sizing:border-box; }
#pb-ctl .pb-panel h2 { margin:0 0 10px; color:#aab6d6; font-size:13px; font-weight:700; letter-spacing:1px; }
#pb-ctl .pb-targets { flex:1 1 420px; min-width:320px; }
#pb-ctl .pb-tgt { display:flex; align-items:center; gap:10px; padding:9px 10px; border:1px solid #262f4c; border-radius:10px; margin-bottom:7px; background:rgba(20,24,44,.6); cursor:pointer; }
#pb-ctl .pb-tgt:hover { border-color:#4c7dff; }
#pb-ctl .pb-tgt.sel { border-color:#c86aff; box-shadow:0 0 0 1px #c86aff inset; }
#pb-ctl .pb-tgt .rk { color:#ffd24c; font-weight:900; font-size:16px; min-width:44px; text-align:center; }
#pb-ctl .pb-tgt .info { flex:1; min-width:0; }
#pb-ctl .pb-tgt .info .nm { color:#fff; font-size:14px; font-weight:800; }
#pb-ctl .pb-tgt .info .ds { color:#9fb0d8; font-size:11px; }
#pb-ctl .pb-tgt .mt { color:#8fd94c; font-size:11px; font-weight:700; white-space:nowrap; }
#pb-ctl button.pb-inv { pointer-events:auto; cursor:pointer; padding:7px 12px; font-size:12px; font-weight:800; color:#150a24; background:linear-gradient(90deg,#c86aff,#7affea); border:none; border-radius:8px; white-space:nowrap; }
#pb-ctl button.pb-inv:disabled { opacity:.4; cursor:default; filter:grayscale(.4); color:#c3cdea; background:rgba(30,36,60,.9); }
#pb-ctl .pb-side { flex:0 1 320px; min-width:260px; display:flex; flex-direction:column; gap:14px; }
#pb-ctl .pb-recon .grid { display:grid; gap:1px; background:#0a0a1a; border:1px solid #2a3552; border-radius:8px; padding:3px; }
#pb-ctl .pb-recon .cell { width:20px; height:18px; border-radius:3px; background:rgba(30,34,58,.5); display:flex; align-items:center; justify-content:center; font-size:11px; line-height:1; }
#pb-ctl .pb-recon .cell.spawn { background:rgba(80,60,30,.5); }
#pb-ctl .pb-recon .empty { color:#68789c; font-size:12px; }
#pb-ctl table.pb-lad { border-collapse:collapse; width:100%; font-size:12px; }
#pb-ctl table.pb-lad th { color:#8896b8; font-weight:700; text-align:left; padding:3px 6px; border-bottom:1px solid #2a3552; }
#pb-ctl table.pb-lad td { color:#c3cdea; padding:3px 6px; border-bottom:1px solid rgba(255,255,255,.05); }
#pb-ctl table.pb-lad td.rk { color:#ffd24c; font-weight:800; }
#pb-ctl .pb-note { color:#8896b8; font-size:11px; max-width:640px; text-align:center; }
#pb-ctl .pb-pgbar { display:flex; gap:5px; justify-content:center; }
#pb-ctl .pb-pgseg { width:38px; height:9px; border-radius:5px; background:rgba(80,90,130,.4); border:1px solid #2a3552; }
#pb-ctl .pb-pgseg.done { background:linear-gradient(90deg,#c86aff,#7affea); border-color:#7affea; }
#pb-ctl .pb-actions { display:flex; gap:10px; }
#pb-ctl button.pb-ghost { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(20,24,44,.9); border:1px solid #2a3552; border-radius:10px; }
#pb-ctl .pb-notif { width:100%; max-width:640px; background:rgba(28,20,44,.72); border:1px solid #6a4c8a; border-radius:12px; padding:10px 14px; box-sizing:border-box; }
#pb-ctl .pb-notif h3 { margin:0 0 8px; color:#e0b3ff; font-size:13px; font-weight:800; }
#pb-ctl .pb-notif-row { display:flex; align-items:center; gap:10px; padding:6px 4px; border-top:1px solid rgba(255,255,255,.06); font-size:12px; color:#dfe6ff; }
#pb-ctl .pb-notif-row:first-of-type { border-top:none; }
#pb-ctl .pb-notif-row .txt { flex:1; min-width:0; }
#pb-ctl .pb-notif-row.lost .txt { color:#ff9a9a; }
#pb-ctl .pb-notif-row.held .txt { color:#8fe08f; }
#pb-ctl button.pb-spec-btn { pointer-events:auto; cursor:pointer; padding:5px 12px; font-size:12px; font-weight:800; color:#150a24; background:linear-gradient(90deg,#7affea,#c86aff); border:none; border-radius:7px; white-space:nowrap; }
#pb-ctl .pb-rev { width:100%; max-width:640px; background:rgba(44,16,20,.6); border:1px solid #8a3d3d; border-radius:12px; padding:10px 14px; box-sizing:border-box; }
#pb-ctl .pb-rev h3 { margin:0 0 8px; color:#ff9a9a; font-size:13px; font-weight:800; }
#pb-ctl .pb-rev-card { display:flex; align-items:center; gap:10px; padding:8px 6px; border-top:1px solid rgba(255,255,255,.06); }
#pb-ctl .pb-rev-card:first-of-type { border-top:none; }
#pb-ctl .pb-rev-card .info { flex:1; min-width:0; }
#pb-ctl .pb-rev-card .nm { color:#fff; font-size:13px; font-weight:800; }
#pb-ctl .pb-rev-card .rem { color:#ffd24c; font-size:11px; font-weight:700; }
#pb-ctl .pb-badge { display:inline-block; padding:1px 7px; margin-left:6px; font-size:10px; font-weight:800; color:#150a24; background:#ffd24c; border-radius:6px; vertical-align:middle; }
#pb-ctl button.pb-rev-btn { pointer-events:auto; cursor:pointer; padding:7px 14px; font-size:12px; font-weight:800; color:#fff; background:linear-gradient(90deg,#ff5a7a,#ff9a4c); border:none; border-radius:8px; white-space:nowrap; }
#pb-ctl button.pb-rev-btn:disabled { opacity:.4; cursor:default; filter:grayscale(.4); }
#pb-ctl .pb-reveal { width:100%; max-width:640px; background:rgba(24,20,44,.7); border:1px solid #4c5a8a; border-radius:12px; padding:10px 14px; box-sizing:border-box; }
#pb-ctl .pb-reveal .rv-head { color:#c3cdea; font-size:13px; font-weight:800; margin-bottom:4px; }
#pb-ctl .pb-reveal .rv-grade { font-size:13px; font-weight:900; letter-spacing:1px; }
#pb-ctl .pb-reveal .rv-affix { color:#9fb0d8; font-size:11px; margin-top:3px; line-height:1.5; }
`;

/** 관제탑 콜백(main 이 침공 런/뒤로가기를 구동). */
export interface ControlTowerCallbacks {
  /** 침공 시작 — 정규화된 3레이어 배치를 침공 런 config 로 넘긴다(normalizeTargetLayers 완료본). */
  onInvade: (target: InvasionTarget, layout: InvasionLayers) => void;
  /** 리플레이 관전 진입 — invasionId 로 리플레이를 로드해 재생한다(F3). */
  onSpectate: (invasionId: string, attackerName: string) => void;
  /** 방어 성공한 침공에 도발 스티커 달기(F2 방어자 몫) — 스티커 선택 UI 를 연다. */
  onSticker: (invasionId: string, attackerName: string) => void;
  /** 기지로 돌아가기. */
  onBack: () => void;
}

/** show() 부가 옵션(결과 배너·검증 중 상태). */
export interface ControlTowerShowOpts {
  /** 침공 런 종료 후 결과 배너(잠정→최종). */
  result?: InvasionResultView;
  /** 서버 검증 대기 중 표시. */
  verifying?: boolean;
  /**
   * 방금 침공한 상대의 방어 카드(정찰 공개 — 스펙 R9). 침공해 본 상대만 옵션을 공개한다
   * (타겟 목록은 등급도 비공개 상태이므로 여기서만 어픽스를 드러낸다). 미장착이면 null/미지정.
   */
  revealCard?: CardInstance | null;
}

export class ControlTower {
  private readonly root: HTMLElement;
  private onInvade: ControlTowerCallbacks['onInvade'] | null = null;
  private onSpectate: ControlTowerCallbacks['onSpectate'] | null = null;
  private onSticker: ControlTowerCallbacks['onSticker'] | null = null;
  private onBack: (() => void) | null = null;

  private targets: InvasionTarget[] | null = null; // null = 미로딩/미설정
  private ladder: LadderEntry[] | null = null;
  private cooldowns: Record<string, number> = {};
  private selectedId: string | null = null;
  private loading = true;
  private loadToken = 0;
  private opts: ControlTowerShowOpts = {};

  // 복수전(F1)·알림(계약 5) 상태 — 서버 권위. null = 미설정/미구현(→ 해당 UI 숨김).
  private revengeTargets: RevengeTarget[] | null = null;
  private incoming: IncomingInvasion[] | null = null;
  private unseenCount = 0;

  // 배치전(AC4) 상태 — 서버 권위. null = 미설정/미배치정보없음(→ 일반 침공만).
  private placement: PlacementStatus | null = null;
  private placementTargets: InvasionTarget[] | null = null;
  private placementResult: PlacementResult | null = null;
  private applying = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-ctl';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(_profile: Profile, cb: ControlTowerCallbacks, opts: ControlTowerShowOpts = {}): void {
    this.onInvade = cb.onInvade;
    this.onSpectate = cb.onSpectate;
    this.onSticker = cb.onSticker;
    this.onBack = cb.onBack;
    this.opts = opts;
    this.selectedId = null;
    this.loading = true;
    this.targets = null;
    this.ladder = null;
    this.placement = null;
    this.placementTargets = null;
    this.placementResult = null;
    this.applying = false;
    this.revengeTargets = null;
    this.incoming = null;
    this.unseenCount = 0;
    this.render();
    this.root.style.display = 'flex';
    void this.load();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onInvade = null;
    this.onSpectate = null;
    this.onSticker = null;
    this.onBack = null;
  }

  /** 타깃·순위표·쿨다운을 비동기 로드하고 재렌더. race 방지 토큰 사용. */
  private async load(): Promise<void> {
    const token = ++this.loadToken;
    try {
      if (typeof localStorage !== 'undefined') this.cooldowns = readInvasionCooldowns(localStorage);
    } catch {
      this.cooldowns = {};
    }
    // 알림은 마지막 확인 시각 이후의 결과만 서버가 필터해 준다(폴링 전용, 계약 5).
    let seenAt = 0;
    try {
      if (typeof localStorage !== 'undefined') seenAt = readInvasionsSeenAt(localStorage);
    } catch {
      seenAt = 0;
    }
    const [targets, ladder, placement, revenge, incoming] = await Promise.all([
      fetchInvasionTargets(),
      fetchLadder(20),
      fetchPlacementStatus(),
      fetchRevengeTargets(),
      fetchIncomingInvasions(seenAt, 20),
    ]);
    if (token !== this.loadToken || !this.visible) return; // 낡은 로드 무시
    this.targets = targets;
    this.ladder = ladder;
    this.placement = placement;
    this.revengeTargets = revenge;
    this.incoming = incoming;
    // 미확인 수 계산 후, 확인 시각을 최신 결과 시각으로 갱신한다(다음 방문부터 새 것만 카운트).
    if (incoming !== null && incoming.length > 0) {
      this.unseenCount = countUnseenInvasions(incoming, seenAt);
      let maxAt = seenAt;
      for (const inv of incoming) if (inv.createdAtMs > maxAt) maxAt = inv.createdAtMs;
      try {
        if (typeof localStorage !== 'undefined') writeInvasionsSeenAt(localStorage, maxAt);
      } catch {
        // 저장 실패 무해(다음 방문에 같은 결과가 다시 새 것으로 셀 뿐).
      }
    } else {
      this.unseenCount = 0;
    }
    // 배치전 진행 중이면 NPC 시드 기지 목록도 로드(쿨다운 무시 제안).
    if (placement !== null && placementPhase(placement) === 'placement') {
      const pts = await fetchPlacementTargets();
      if (token !== this.loadToken || !this.visible) return;
      this.placementTargets = pts;
    }
    this.loading = false;
    this.render();
  }

  /** 배치전 5회 완료 후 순위 삽입을 서버에 요청하고 연출 상태로 재렌더한다. */
  private async applyPlacement(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    this.render();
    const result = await applyPlacementResult();
    if (!this.visible) return;
    this.applying = false;
    this.placementResult = result;
    if (result !== null && result.placed) {
      // 순위 진입 — 배치전 종료. 상태를 placed 로 갱신하고 순위표를 새로 로드한다.
      this.placement = this.placement !== null
        ? { ...this.placement, placed: true }
        : { completed: 0, won: 0, total: 0, placed: true };
      void this.load();
    } else {
      this.render();
    }
  }

  private selectTarget(id: string): void {
    this.selectedId = this.selectedId === id ? null : id;
    this.render();
  }

  /** 배치전 진행 단계인지(NPC 시드 기지 제안·쿨다운 무시). */
  private inPlacement(): boolean {
    return this.placement !== null && placementPhase(this.placement) === 'placement';
  }

  /** 배치전 5회를 다 치렀으나 아직 순위 삽입 전(연출 대상)인지. */
  private isCompleting(): boolean {
    return this.placement !== null && placementPhase(this.placement) === 'completing';
  }

  private invade(target: InvasionTarget): void {
    // 배치전 대상은 쿨다운을 무시(computePlacementInvadeState), 일반 침공은 쿨다운 미러 적용.
    const st = this.inPlacement()
      ? computePlacementInvadeState(target)
      : computeInvadeState(target, this.cooldowns, Date.now());
    if (!st.canInvade || st.layout === null) return;
    const cb = this.onInvade;
    // 침공 런으로 넘어가면 이 화면은 내려간다(런 종료 후 main 이 다시 연다).
    this.hide();
    cb?.(target, st.layout);
  }

  // --- Render --------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = t('ctl.title');
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = t('ctl.sub');
    this.root.appendChild(sub);

    if (this.opts.result !== undefined) this.root.appendChild(this.banner(this.opts.result));
    const reveal = this.revealPanel();
    if (reveal !== null) this.root.appendChild(reveal);
    if (this.opts.verifying === true) {
      const v = document.createElement('div');
      v.className = 'pb-banner info';
      v.textContent = t('ctl.verifying');
      this.root.appendChild(v);
    }

    // 알림(계약 5): 새 침공 결과 배너 + 관전 진입. 서버 결과가 있을 때만.
    const notif = this.notificationsPanel();
    if (notif !== null) this.root.appendChild(notif);

    // 복수전(F1): 24h 창 복수 대상 카드. 대상이 있을 때만.
    const revenge = this.revengePanel();
    if (revenge !== null) this.root.appendChild(revenge);

    // 배치전 진행/완료/순위 진입 연출(서버 상태가 있을 때만).
    const placementPanel = this.placementPanel();
    if (placementPanel !== null) this.root.appendChild(placementPanel);

    const cols = document.createElement('div');
    cols.className = 'pb-cols';
    cols.appendChild(this.targetsPanel());
    cols.appendChild(this.sidePanel());
    this.root.appendChild(cols);

    const note = document.createElement('div');
    note.className = 'pb-note';
    note.textContent = t('ctl.note');
    this.root.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    const back = document.createElement('button');
    back.className = 'pb-ghost';
    back.textContent = t('common.backToBase');
    back.addEventListener('click', () => {
      const cb = this.onBack;
      this.hide();
      cb?.();
    });
    actions.appendChild(back);
    this.root.appendChild(actions);
  }

  /**
   * 침공한 상대의 방어 카드 정찰 공개 패널(스펙 R9). 결과 배너가 있고 카드가 실제로 장착돼
   * 있었을 때만 표시한다(미장착·미제출이면 null). 등급·잔여 횟수·어픽스 옵션을 드러내 복수전·
   * 재침공의 역퍼즐 정보를 준다. 렌더 전용.
   */
  private revealPanel(): HTMLElement | null {
    if (this.opts.result === undefined) return null;
    const card = this.opts.revealCard;
    if (card === null || card === undefined) return null;

    const panel = document.createElement('div');
    panel.className = 'pb-reveal';
    const h3 = document.createElement('div');
    h3.className = 'rv-head';
    h3.textContent = t('card.reveal.head');
    panel.appendChild(h3);

    const grade = document.createElement('div');
    grade.className = 'rv-grade';
    grade.style.color = cardRarityColor(card.rarity);
    grade.textContent = `${t('card.reveal.grade', { rarity: cardRarityLabel(card.rarity) })} · ${t('card.reveal.charges', { n: card.chargesLeft })}`;
    panel.appendChild(grade);

    const affix = document.createElement('div');
    affix.className = 'rv-affix';
    affix.textContent = cardAffixOneLine(card);
    panel.appendChild(affix);

    return panel;
  }

  private banner(view: InvasionResultView): HTMLElement {
    const el = document.createElement('div');
    // 미제출·판정 확정 중(null)은 중립(info), 확정 승 win, 그 외(패배·거부) lose.
    const cls =
      !view.submitted || view.attackerWon === null
        ? 'info'
        : view.status === 'verified' && view.attackerWon
          ? 'win'
          : 'lose';
    el.className = `pb-banner ${cls}`;
    el.textContent = resultBannerText(view);
    return el;
  }

  private targetsPanel(): HTMLElement {
    const placementMode = this.inPlacement();
    const panel = document.createElement('div');
    panel.className = 'pb-panel pb-targets';
    const h2 = document.createElement('h2');
    h2.textContent = placementMode ? t('ctl.tgt.placementHead') : t('ctl.tgt.head');
    panel.appendChild(h2);

    if (this.loading) {
      panel.appendChild(this.msg(t('ctl.tgt.loading')));
      return panel;
    }
    // 배치전이 아직 안 끝났으나 순위 삽입 대기(completing)면 목록 대신 안내.
    if (this.isCompleting()) {
      panel.appendChild(this.msg(t('ctl.tgt.completingMsg')));
      return panel;
    }

    const list = placementMode ? this.placementTargets : this.targets;
    if (list === null) {
      panel.appendChild(this.msg(placementMode ? t('ctl.tgt.placementNull') : t('ctl.tgt.normalNull')));
      return panel;
    }
    if (list.length === 0) {
      panel.appendChild(this.msg(placementMode ? t('ctl.tgt.placementEmpty') : t('ctl.tgt.normalEmpty')));
      return panel;
    }

    const now = Date.now();
    for (const t of list) {
      panel.appendChild(this.targetRow(t, placementMode, now));
    }
    return panel;
  }

  /** 대상 1행(일반/배치전 공통). 배치전은 쿨다운 무시 + 시드 이름·난이도 밴드 표시. */
  private targetRow(target: InvasionTarget, placementMode: boolean, now: number): HTMLElement {
    const st = placementMode
      ? computePlacementInvadeState(target)
      : computeInvadeState(target, this.cooldowns, now);
    const meta = placementMode ? seedBaseByProfileId(target.profileId) : null;

    const row = document.createElement('div');
    row.className = `pb-tgt${this.selectedId === target.profileId ? ' sel' : ''}`;
    row.addEventListener('click', () => this.selectTarget(target.profileId));

    const rk = document.createElement('div');
    rk.className = 'rk';
    rk.textContent = `#${target.rank}`;
    const info = document.createElement('div');
    info.className = 'info';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = placementMode ? placementTargetName(target) : target.displayName;
    const ds = document.createElement('div');
    ds.className = 'ds';
    // 배치전이면 난이도 밴드 + 기체 요약, 일반이면 기체 요약.
    ds.textContent =
      meta !== null
        ? t('ctl.tgt.difficulty', { band: meta.difficultyBand, ship: shipSummaryText(target.shipSummary) })
        : shipSummaryText(target.shipSummary);
    info.append(nm, ds);
    const mt = document.createElement('div');
    mt.className = 'mt';
    mt.textContent = maintenanceLabel(target.maintenance);

    const btn = document.createElement('button');
    btn.className = 'pb-inv';
    btn.textContent = st.canInvade ? (placementMode ? t('ctl.tgt.btnPlacement') : t('ctl.tgt.btnInvade')) : st.reason;
    btn.disabled = !st.canInvade;
    btn.title = st.canInvade ? (placementMode ? t('ctl.tgt.titlePlacement') : t('ctl.tgt.titleInvade')) : st.reason;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.invade(target);
    });

    row.append(rk, info, mt, btn);
    return row;
  }

  /**
   * 배치전 진행/완료 패널(순위 진입 연출 포함). 배치전 상태가 없으면(일반 침공 단계 또는
   * 서버 미설정) null 을 돌려 아무것도 그리지 않는다.
   */
  private placementPanel(): HTMLElement | null {
    // 방금 순위에 진입한 직후 연출(placementResult.placed)은 status.placed 여도 1회 표시.
    if (this.placementResult !== null && this.placementResult.placed) {
      const el = document.createElement('div');
      el.className = 'pb-banner win';
      el.textContent = t('ctl.place.entered', {
        rank: this.placementResult.rank,
        won: this.placementResult.matchesWon,
      });
      return el;
    }
    const status = this.placement;
    if (status === null) return null;
    const phase = placementPhase(status);
    if (phase === 'ranked') return null; // 일반 침공 단계 — 배치전 UI 없음

    const wrap = document.createElement('div');
    wrap.className = 'pb-banner info';

    if (phase === 'completing') {
      const line = document.createElement('div');
      line.textContent = t('ctl.place.completeLine', { total: status.total, won: status.won });
      line.style.marginBottom = '8px';
      wrap.appendChild(line);
      const btn = document.createElement('button');
      btn.className = 'pb-inv';
      btn.textContent = this.applying ? t('ctl.place.applying') : t('ctl.place.enter');
      btn.disabled = this.applying;
      btn.addEventListener('click', () => void this.applyPlacement());
      wrap.appendChild(btn);
      return wrap;
    }

    // 진행 중 — 진행바 + 남은 횟수.
    const label = document.createElement('div');
    label.textContent = `${placementProgressLabel(status)}${t('ctl.place.remaining', { n: placementRemaining(status) })}`;
    label.style.marginBottom = '6px';
    wrap.appendChild(label);
    const bar = document.createElement('div');
    bar.className = 'pb-pgbar';
    for (let i = 0; i < status.total; i++) {
      const seg = document.createElement('span');
      seg.className = `pb-pgseg${i < status.completed ? ' done' : ''}`;
      bar.appendChild(seg);
    }
    wrap.appendChild(bar);
    const hint = document.createElement('div');
    hint.className = 'pb-note';
    hint.style.marginTop = '6px';
    hint.textContent = t('ctl.place.hint');
    wrap.appendChild(hint);
    return wrap;
  }

  /**
   * 알림 패널(계약 5): 내가 당한 최근 침공 결과 목록 + 관전 진입. 결과가 없거나 서버
   * 미설정이면 null(아무것도 안 그림). 상대 도발 스티커도 함께 표시한다.
   */
  private notificationsPanel(): HTMLElement | null {
    const incoming = this.incoming;
    if (incoming === null || incoming.length === 0) return null;

    const panel = document.createElement('div');
    panel.className = 'pb-notif';
    const h3 = document.createElement('h3');
    const bannerText = incomingBannerText(this.unseenCount);
    h3.textContent = bannerText.length > 0 ? bannerText : t('ctl.notif.head');
    panel.appendChild(h3);

    for (const inv of incoming) {
      const row = document.createElement('div');
      row.className = `pb-notif-row ${inv.attackerWon ? 'lost' : 'held'}`;
      const txt = document.createElement('div');
      txt.className = 'txt';
      // 내가 이미 이 침공에 도발을 남겼으면 함께 표시(방어 성공 회신).
      const myTaunt = stickerLabel(inv.defenderSticker);
      txt.textContent =
        myTaunt.length > 0
          ? `${incomingRowText(inv)}${t('ctl.notif.myTaunt', { taunt: myTaunt })}`
          : incomingRowText(inv);
      row.appendChild(txt);
      // 방어 성공(격퇴)했고 아직 회신 도발이 없으면 "도발" 버튼(F2 방어자 몫).
      if (inv.invasionId.length > 0 && !inv.attackerWon && inv.defenderSticker === null) {
        const taunt = document.createElement('button');
        taunt.className = 'pb-spec-btn';
        taunt.textContent = t('ctl.notif.tauntBtn');
        taunt.title = t('ctl.notif.tauntTitle');
        taunt.addEventListener('click', () => {
          const cb = this.onSticker;
          cb?.(inv.invasionId, inv.attackerName);
        });
        row.appendChild(taunt);
      }
      // 관전(F3): 침공당한 리플레이 재생. invasionId 가 있어야 로드 가능.
      if (inv.invasionId.length > 0) {
        const spec = document.createElement('button');
        spec.className = 'pb-spec-btn';
        spec.textContent = t('ctl.notif.spectate');
        spec.title = t('ctl.notif.spectateTitle');
        spec.addEventListener('click', () => {
          const cb = this.onSpectate;
          cb?.(inv.invasionId, inv.attackerName);
        });
        row.appendChild(spec);
      }
      panel.appendChild(row);
    }
    return panel;
  }

  /**
   * 복수전 패널(F1): 24h 창 안의 복수 대상 카드. 대상이 없거나 서버 미설정/미구현이면 null.
   * 쿨다운 무시 배지·잔여시간을 표시하고, 복수 침공은 기존 침공 런 경로(onInvade)를 탄다
   * (서버가 이력으로 복수를 자동 판정 — 계약 §F1).
   */
  private revengePanel(): HTMLElement | null {
    const list = this.revengeTargets;
    if (list === null || list.length === 0) return null;
    const now = Date.now();

    const panel = document.createElement('div');
    panel.className = 'pb-rev';
    const h3 = document.createElement('h3');
    h3.textContent = t('ctl.rev.head');
    panel.appendChild(h3);

    for (const target of list) {
      const st = revengeCardState(target, now);
      const card = document.createElement('div');
      card.className = 'pb-rev-card';

      const info = document.createElement('div');
      info.className = 'info';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = target.displayName.length > 0 ? target.displayName : t('ctl.anonymous');
      const badge = document.createElement('span');
      badge.className = 'pb-badge';
      badge.textContent = t('ctl.rev.badge');
      nm.appendChild(badge);
      const rem = document.createElement('div');
      rem.className = 'rem';
      rem.textContent = st.expired
        ? t('ctl.rev.expired')
        : `${st.remainingLabel} · ${shipSummaryText(target.shipSummary)}`;
      info.append(nm, rem);

      const btn = document.createElement('button');
      btn.className = 'pb-rev-btn';
      const canRevenge = !st.expired && st.layout !== null;
      btn.textContent = st.expired ? t('ctl.rev.btnExpired') : st.layout === null ? t('ctl.rev.btnNoBase') : t('ctl.rev.btnRevenge');
      btn.disabled = !canRevenge;
      btn.addEventListener('click', () => {
        if (!canRevenge || st.layout === null) return;
        const cb = this.onInvade;
        this.hide();
        cb?.(target, st.layout);
      });

      card.append(info, btn);
      panel.appendChild(card);
    }
    return panel;
  }

  private sidePanel(): HTMLElement {
    const side = document.createElement('div');
    side.className = 'pb-side';
    side.appendChild(this.reconPanel());
    side.appendChild(this.ladderPanel());
    return side;
  }

  private reconPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel pb-recon';
    const h2 = document.createElement('h2');
    h2.textContent = t('ctl.recon.head');
    panel.appendChild(h2);

    // 선택 대상은 일반/배치전 두 목록 중 하나에 있다.
    const inList = (list: InvasionTarget[] | null): InvasionTarget | null =>
      list?.find((x) => x.profileId === this.selectedId) ?? null;
    const target = inList(this.targets) ?? inList(this.placementTargets);
    if (target === null) {
      panel.appendChild(this.msg(t('ctl.recon.selectPrompt')));
      return panel;
    }
    const layout = normalizeTargetLayers(target.layout);
    if (layout === null) {
      panel.appendChild(this.msg(t('ctl.recon.noBase')));
      return panel;
    }

    // 15×9 미니 격자는 M7a 에서 사라졌다(3레이어에 격자가 없다). 정식 정찰 화면은
    // M7b-command-ui 가 레이어 탭으로 다시 만든다 — 그때까지 슬롯 점유 요약 한 줄만 보여준다.
    const sum = document.createElement('div');
    sum.className = 'pb-note';
    sum.style.textAlign = 'left';
    sum.style.marginTop = '6px';
    sum.textContent = reconSummary(layout);
    panel.appendChild(sum);
    return panel;
  }

  private ladderPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = t('ctl.ladder.head');
    panel.appendChild(h2);

    if (this.loading) {
      panel.appendChild(this.msg(t('ctl.ladder.loading')));
      return panel;
    }
    if (this.ladder === null) {
      panel.appendChild(this.msg(t('ctl.ladder.null')));
      return panel;
    }
    if (this.ladder.length === 0) {
      panel.appendChild(this.msg(t('ctl.ladder.empty')));
      return panel;
    }

    const table = document.createElement('table');
    table.className = 'pb-lad';
    const thead = document.createElement('tr');
    for (const label of [t('ctl.ladder.rank'), t('ctl.ladder.name'), t('ctl.ladder.record')]) {
      const th = document.createElement('th');
      th.textContent = label;
      thead.appendChild(th);
    }
    table.appendChild(thead);
    for (const e of this.ladder) {
      const tr = document.createElement('tr');
      const rk = document.createElement('td');
      rk.className = 'rk';
      rk.textContent = `#${e.rank}`;
      const nm = document.createElement('td');
      nm.textContent = e.displayName ?? `${e.profileId.slice(0, 6)}…`;
      const rec = document.createElement('td');
      rec.textContent = t('ctl.ladder.wl', { w: e.wins, l: e.losses });
      tr.append(rk, nm, rec);
      table.appendChild(tr);
    }
    panel.appendChild(table);
    return panel;
  }

  private msg(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = text;
    return el;
  }
}
