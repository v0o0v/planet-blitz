/**
 * 관제탑 순수 표시 로직 테스트 (src/ui/controlTower.ts — M4 Phase D3, AC10).
 *
 * DOM 오버레이가 아니라 표시를 떠받치는 순수 함수를 검증한다:
 *   1) 기체 요약·정비도·쿨다운 라벨 포매팅.
 *   2) computeInvadeState — 배치 없음/쿨다운/가능 분기(+normalizeTargetLayers 연동).
 *   3) resultBannerText — 서버 권위(제출/미제출·거부·승/패) 문구.
 *   4) normalizeTargetLayers / reconSummary — 3레이어 배치 판별과 정찰 요약(M7a 임시).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLocale } from '../src/i18n/index.js';
import {
  shipSummaryText,
  maintenanceLabel,
  formatCooldown,
  computeInvadeState,
  resultBannerText,
  reconSummary,
  normalizeTargetLayers,
  revengeCardState,
  incomingBannerText,
  incomingRowText,
  type InvasionResultView,
} from '../src/ui/controlTower.js';
import {
  INVASION_COOLDOWN_MS,
  REVENGE_WINDOW_MS,
  type InvasionTarget,
  type RevengeTarget,
  type IncomingInvasion,
} from '../src/net/invasion.js';
import { emptyInvasionLayers, SAMPLE_REF } from '../src/sim/invasion/normalize.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';

// 이 파일은 한국어 표시 문자열을 정확히 검증하므로 로케일을 ko 로 고정한다(i18n 도입 후 정합).
beforeEach(() => setLocale('ko'));
afterEach(() => setLocale('en'));

/** 유효한 3레이어 배치(웨이브 슬롯 1 + 설비 소켓 1). */
function validLayers(): InvasionLayers {
  const l = emptyInvasionLayers();
  l.l1.waveSlots[0] = { ...SAMPLE_REF };
  l.l2.sockets[0] = { ...SAMPLE_REF };
  return l;
}
const VALID_LAYOUT: InvasionLayers = validLayers();

function target(over: Partial<InvasionTarget> = {}): InvasionTarget {
  return {
    profileId: 'def-1',
    rank: 3,
    displayName: '적기지 알파',
    shipSummary: { name: '스팅어', level: 20 },
    defenseId: 'd-1',
    layout: VALID_LAYOUT,
    maintenance: 88,
    ...over,
  };
}

describe('표시 포매팅', () => {
  it('shipSummaryText: 이름+레벨 / 부분 / 부재', () => {
    expect(shipSummaryText({ name: '스팅어', level: 20 })).toBe('스팅어 · Lv 20');
    expect(shipSummaryText({ name: '스팅어' })).toBe('스팅어');
    expect(shipSummaryText({})).toBe('알 수 없는 기체');
  });

  it('maintenanceLabel: 반올림·클램프', () => {
    expect(maintenanceLabel(87.4)).toBe('정비도 87%');
    expect(maintenanceLabel(150)).toBe('정비도 100%');
    expect(maintenanceLabel(-5)).toBe('정비도 0%');
  });

  it('formatCooldown: 0 이하 빈 문자열 · 분 · 시간', () => {
    expect(formatCooldown(0)).toBe('');
    expect(formatCooldown(-100)).toBe('');
    expect(formatCooldown(60_000)).toBe('재도전까지 1분');
    expect(formatCooldown(90_000)).toBe('재도전까지 2분'); // 올림
    expect(formatCooldown(60 * 60_000)).toBe('재도전까지 1시간');
    expect(formatCooldown(75 * 60_000)).toBe('재도전까지 1시간 15분');
  });
});

describe('computeInvadeState — 침공 가능 분기', () => {
  it('유효 배치 + 쿨다운 없음 → 침공 가능', () => {
    const st = computeInvadeState(target(), {}, 0);
    expect(st.canInvade).toBe(true);
    expect(st.layout).not.toBeNull();
  });

  it('배치 손상/없음 → 침공 불가(방어 기지 없음)', () => {
    const st = computeInvadeState(target({ layout: null }), {}, 0);
    expect(st.canInvade).toBe(false);
    expect(st.reason).toBe('방어 기지 없음');
    expect(st.layout).toBeNull();
  });

  it('쿨다운 남으면 침공 불가(남은 시간 표시)', () => {
    const cd = { 'def-1': 1000 };
    const st = computeInvadeState(target(), cd, 1000 + INVASION_COOLDOWN_MS / 2);
    expect(st.canInvade).toBe(false);
    expect(st.reason).toContain('재도전까지');
    // 배치는 유효하므로 layout 은 채워져 있다(정찰 미리보기용).
    expect(st.layout).not.toBeNull();
  });
});

describe('resultBannerText — 서버 권위 문구', () => {
  it('미제출(잠정) — 승/패', () => {
    const win: InvasionResultView = { attackerWon: true, submitted: false, targetName: '알파' };
    expect(resultBannerText(win)).toContain('잠정 승리');
    expect(resultBannerText(win)).toContain('미제출');
    const lose: InvasionResultView = { attackerWon: false, submitted: false };
    expect(resultBannerText(lose)).toContain('잠정');
  });

  it('서버 거부(rejected)', () => {
    const v: InvasionResultView = { attackerWon: true, submitted: true, status: 'rejected' };
    expect(resultBannerText(v)).toContain('거부');
  });

  it('서버 확정 승리 — 순위·전리품 반영', () => {
    const v: InvasionResultView = {
      attackerWon: true,
      submitted: true,
      status: 'verified',
      ladder: { attackerRank: 3, defenderRank: 4 },
      lootCount: 2,
      targetName: '알파',
    };
    const t = resultBannerText(v);
    expect(t).toContain('침공 성공');
    expect(t).toContain('3위');
    expect(t).toContain('2개');
  });

  it('서버 확정 패배(방어 성공)', () => {
    const v: InvasionResultView = { attackerWon: false, submitted: true, status: 'verified' };
    expect(resultBannerText(v)).toContain('방어 성공');
  });

  it('attackerWon=null(판정 확정 중)은 패배로 강제하지 않고 확정 중 안내', () => {
    const v: InvasionResultView = { attackerWon: null, submitted: true, status: 'verified' };
    const t = resultBannerText(v);
    expect(t).toContain('확정 중');
    expect(t).not.toContain('실패');
    expect(t).not.toContain('방어 성공');
  });
});

describe('resultBannerText — 복수전(F1)', () => {
  it('복수 성공 — 자리 탈환 + 보너스 광물', () => {
    const v: InvasionResultView = {
      attackerWon: true,
      submitted: true,
      status: 'verified',
      revenge: true,
      bonusMinerals: 40,
      ladder: { attackerRank: 4, defenderRank: 5 },
      targetName: '숙적',
    };
    const t = resultBannerText(v);
    expect(t).toContain('복수 성공');
    expect(t).toContain('자리 탈환');
    expect(t).toContain('보너스 광물 40');
  });

  it('비복수 승리는 기존 문구(코어 파괴) 유지', () => {
    const v: InvasionResultView = { attackerWon: true, submitted: true, status: 'verified' };
    expect(resultBannerText(v)).toContain('코어 파괴');
    expect(resultBannerText(v)).not.toContain('복수');
  });
});

describe('revengeCardState — 복수 카드(순수)', () => {
  const base: RevengeTarget = {
    profileId: 'atk',
    rank: 5,
    displayName: '숙적',
    shipSummary: { name: '레이븐', level: 20 },
    defenseId: 'd',
    layout: VALID_LAYOUT,
    maintenance: 80,
    revengeInvasionId: 'inv-lost',
    expiresAtMs: 1000 + REVENGE_WINDOW_MS,
  };

  it('창이 남아 있고 배치 유효 → 복수 가능(만료 아님·layout 채움)', () => {
    const st = revengeCardState(base, 1000);
    expect(st.expired).toBe(false);
    expect(st.remainingLabel).toContain('복수 가능');
    expect(st.layout).not.toBeNull();
  });

  it('24h 지나면 만료(라벨 빈 문자열)', () => {
    const st = revengeCardState(base, 1000 + REVENGE_WINDOW_MS + 1);
    expect(st.expired).toBe(true);
    expect(st.remainingLabel).toBe('');
  });

  it('배치 손상/없음이면 layout=null(복수 불가 근거)', () => {
    const st = revengeCardState({ ...base, layout: null }, 1000);
    expect(st.layout).toBeNull();
  });
});

describe('알림 배너·행 문구(순수)', () => {
  const inv: IncomingInvasion = {
    invasionId: 'inv-1',
    attackerName: '감마',
    attackerWon: true,
    createdAtMs: 5000,
    sticker: 0,
    defenderSticker: null,
    isRevenge: false,
  };

  it('incomingBannerText: 0 이면 빈 문자열, n 이면 건수', () => {
    expect(incomingBannerText(0)).toBe('');
    expect(incomingBannerText(3)).toContain('3건');
  });

  it('incomingRowText: 함락/방어 + 도발 스티커 표시', () => {
    expect(incomingRowText(inv)).toContain('기지 함락');
    expect(incomingRowText(inv)).toContain('도발');
    const held = incomingRowText({ ...inv, attackerWon: false, sticker: null });
    expect(held).toContain('방어 성공');
    expect(held).not.toContain('도발');
  });

  it('incomingRowText: 복수 침공이면 [복수] 프리픽스', () => {
    expect(incomingRowText({ ...inv, isRevenge: true })).toContain('[복수]');
  });
});

describe('normalizeTargetLayers — 배치 없음 판별', () => {
  it('3레이어 꼴이면 정규형을 돌려준다', () => {
    const l = normalizeTargetLayers(VALID_LAYOUT);
    expect(l).not.toBeNull();
    expect(l!.l1.waveSlots[0]).not.toBeNull();
  });

  it('null·비객체·배열·구 형식(core/turrets/obstacles)은 null', () => {
    // 구 단일 아레나 배치가 그대로 넘어와도 "기지 있음"으로 오인하면 안 된다 — 3레이어 런이
    // 빈 배치로 조용히 굴러가 정직한 침공이 무내용이 된다.
    expect(normalizeTargetLayers(null)).toBeNull();
    expect(normalizeTargetLayers(42)).toBeNull();
    expect(normalizeTargetLayers([])).toBeNull();
    expect(normalizeTargetLayers({ core: { x: 0, y: 0 }, turrets: [], obstacles: [] })).toBeNull();
    expect(normalizeTargetLayers({ nope: true })).toBeNull();
  });
});

describe('reconSummary — 3레이어 정찰 요약(임시 텍스트)', () => {
  it('레이어별 점유 슬롯 수를 센다', () => {
    // 편대 1/6 · 설비 1/N · 기물 0/6 · 보스 0.
    const s = reconSummary(VALID_LAYOUT);
    expect(s).toContain('편대 1/6');
    expect(s).toContain('기물 0/6');
    expect(s).toContain('보스 0');
  });

  it('정확 스펙(카탈로그 id·레벨)은 노출하지 않는다(정찰 공개 범위 — 결정 #15)', () => {
    const s = reconSummary(VALID_LAYOUT);
    expect(s).not.toContain(String(SAMPLE_REF.affixSeed));
  });
});
