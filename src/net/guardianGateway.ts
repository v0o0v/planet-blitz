/**
 * 수호 기체·계보 서버 게이트웨이 (M5 Phase A2/A3/A5 — RPC 배선).
 *
 * 서버 정본 RPC(supabase/migrations/20260718100000_m5_guardian_lineage):
 *   - retire_ship(p_preset, p_combat_score, p_snapshot) — 수호 생성 + 계보 기본 지급.
 *   - dismiss_guardian(p_guardian_id) — 상시 소멸 → 계보 포인트 회수.
 *   - invest_lineage(p_branch) — 계보 1레벨 투자(포인트 차감).
 * 조회: guardians(본인) select + profiles.lineage_* 컬럼.
 *
 * 이 파일만 `@supabase/supabase-js` 를 정적 import 한다(defenseGateway 와 동일 패턴 — 미설정
 * 번들에 SDK 미탑재). 서버 권위(ADR-0005 원칙2): performance·계보 포인트/레벨은 서버만 쓴다.
 * 클라이언트 로컬 미러(src/save/guardianLifecycle.ts)는 낙관적 반영이고, 이 게이트웨이가 서버
 * 정본과 동기화한다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type { GuardianSnapshot } from '../../data/guardian.js';
import type { GuardianBuild } from '../save/profile.js';
import type { LineageBranch } from '../../data/lineage.js';

function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 서버 수호 기체 1행(guardians 테이블). data=스냅샷 jsonb. */
export interface ServerGuardian {
  id: string;
  snapshot: GuardianSnapshot;
  /** performance numeric(0~100) → centi-percent(×100)로 변환한 값. */
  performanceCP: number;
  combatScore: number;
  preset: number;
  retired: boolean;
  /**
   * 퇴역 순간 고정된 실물 빌드(ADR-0024, guardians.build jsonb). 소집·장비 잠김용 — snapshot 의
   * 형제. 컬럼 부재/null(구 수호기) 이면 undefined. 깊은 정규화는 로컬 미러 조립 시
   * (normalizeGuardianRecords) 수행한다(여기선 jsonb 셰이프를 그대로 신뢰 — snapshot 과 동일 규율).
   */
  build?: GuardianBuild;
}

/** 서버 계보 상태(profiles 컬럼). */
export interface ServerLineage {
  available: number;
  shipLevel: number;
  guardianLevel: number;
}

export class SupabaseGuardianGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async getUserId(): Promise<string> {
    const { data: sessionData } = await this.client.auth.getSession();
    const existing = sessionData.session?.user?.id;
    if (existing !== undefined) return existing;
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error !== null) throw error;
    const uid = data.user?.id;
    if (uid === undefined) throw new Error('익명 로그인 후에도 uid 를 얻지 못했습니다');
    return uid;
  }

  /** 본인 수호 기체 목록(소멸분 포함 — 표시 측이 필터). */
  async fetchGuardians(uid: string): Promise<ServerGuardian[]> {
    // 정렬 고정(created_at→id): 서버 verify-invasion 이 수호 권위 주입 시 같은 순서로 슬롯을
    // 매핑하므로(index.ts), 클라 로컬 미러(profile.guardians)도 이 순서를 따라야 방어 배치
    // buildGuardianPlacements 의 슬롯 i↔수호 i 매핑이 클라·서버 비트 동일해진다(M5 계약 통일).
    const { data, error } = await this.client
      .from('guardians')
      .select('id, data, performance, combat_score, preset, retired, build')
      .eq('profile_id', uid)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw) => {
      const r = asRec(raw);
      return {
        id: String(r.id),
        snapshot: asRec(r.data) as unknown as GuardianSnapshot,
        performanceCP: Math.round(num(r.performance, 100) * 100),
        combatScore: num(r.combat_score, 0),
        preset: num(r.preset, 0),
        retired: r.retired === true,
        // build jsonb: null/부재(구 수호기) 이면 undefined. snapshot 과 동일하게 셰이프를 신뢰한다.
        ...(typeof r.build === 'object' && r.build !== null
          ? { build: r.build as unknown as GuardianBuild }
          : {}),
      };
    });
  }

  /** 본인 계보 상태(profiles 컬럼). */
  async fetchLineage(uid: string): Promise<ServerLineage> {
    const { data, error } = await this.client
      .from('profiles')
      .select('lineage_points, lineage_ship_level, lineage_guardian_level')
      .eq('id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      available: num(r.lineage_points, 0),
      shipLevel: num(r.lineage_ship_level, 0),
      guardianLevel: num(r.lineage_guardian_level, 0),
    };
  }

  /** 퇴역 → 수호 기체 생성 + 계보 기본 지급. 반환: {guardianId, granted}. */
  async retireShip(preset: number, combatScore: number, snapshot: GuardianSnapshot, build?: GuardianBuild): Promise<{ guardianId: string; granted: number }> {
    const { data, error } = await this.client.rpc('retire_ship', {
      p_preset: preset,
      p_combat_score: combatScore,
      p_snapshot: snapshot,
      // 실물 빌드(ADR-0024) — guardians.build 에 저장. 미전달(구 경로)이면 null 로 기존 동작 유지.
      p_build: build ?? null,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    if (r.retired !== true) throw new Error(`retire_ship 거부: ${String(r.note ?? 'unknown')}`);
    return { guardianId: String(r.guardian_id), granted: num(r.granted) };
  }

  /** 소멸 → 계보 포인트 회수. 반환: 회수 포인트(거부 시 throw). */
  async dismissGuardian(guardianId: string): Promise<number> {
    const { data, error } = await this.client.rpc('dismiss_guardian', { p_guardian_id: guardianId });
    if (error !== null) throw error;
    const r = asRec(data);
    if (r.dismissed !== true) throw new Error(`dismiss_guardian 거부: ${String(r.note ?? 'unknown')}`);
    return num(r.points);
  }

  /** 계보 1레벨 투자. 반환: {level, points}(거부 시 throw). */
  async investLineage(branch: LineageBranch): Promise<{ level: number; points: number }> {
    const { data, error } = await this.client.rpc('invest_lineage', { p_branch: branch });
    if (error !== null) throw error;
    const r = asRec(data);
    if (r.invested !== true) throw new Error(`invest_lineage 거부: ${String(r.note ?? 'unknown')}`);
    return { level: num(r.level), points: num(r.points) };
  }
}
