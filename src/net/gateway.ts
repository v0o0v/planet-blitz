/**
 * 서버 게이트웨이(M4 Phase B3) — 프로필 이관에 필요한 서버 IO 를 추상화.
 *
 * `ServerGateway` 인터페이스로 오케스트레이션(`index.ts`)과 실제 Supabase 호출을
 * 분리한다. 덕분에 이관 로직은 fake gateway 로 네트워크·`@supabase/supabase-js`
 * 없이 vitest 검증되고(계획 §3), 이 파일만 실제 SDK 를 import 한다.
 *
 * 익명 Auth(ADR-0002·계획 B3): 최초 호출 시 세션이 없으면 `signInAnonymously()` 로
 * 익명 유저를 만든다. Supabase 프로젝트에서 Anonymous sign-ins 활성화가 전제
 * (supabase/README.md 적용 절차 2단계).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '../save/profile.js';
import type { ServerProfile } from './profileSync.js';
import type { SupabaseConfig } from './config.js';
import type { Replay } from '../sim/replay.js';
import type { PveRunResult } from './pveRun.js';

/** 프로필 이관 오케스트레이션이 의존하는 서버 IO(테스트에서 fake 로 주입). */
export interface ServerGateway {
  /** 익명 세션을 보장하고 로그인 uid 를 반환한다. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** uid 의 profiles 행을 읽는다. 없으면 null. 실패 시 throw. */
  fetchProfile(uid: string): Promise<ServerProfile | null>;
  /** uid 의 profiles 행을 업서트한다. 실패 시 throw. */
  upsertProfile(uid: string, payload: { save: Profile; save_version: number }): Promise<void>;
  /**
   * PvE 런을 `pve_runs` 에 pending 증거로 insert 한다(리플레이 재실행 샘플링 대상).
   * 실패 시 throw. 구현이 없는 게이트웨이(구버전)면 `undefined` — 호출부(index.recordPveRun)가
   * no-op 으로 처리한다.
   */
  insertPveRun?(uid: string, payload: { replay: Replay; clientResult: PveRunResult }): Promise<void>;
}

/** Supabase 로 구현한 실 게이트웨이. */
export class SupabaseGateway implements ServerGateway {
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

  async fetchProfile(uid: string): Promise<ServerProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('save, save_version')
      .eq('id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const row = data as { save: unknown; save_version: number };
    return { save: row.save, saveVersion: row.save_version };
  }

  async upsertProfile(
    uid: string,
    payload: { save: Profile; save_version: number },
  ): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .upsert({ id: uid, save: payload.save, save_version: payload.save_version });
    if (error !== null) throw error;
  }

  async insertPveRun(
    uid: string,
    payload: { replay: Replay; clientResult: PveRunResult },
  ): Promise<void> {
    // pending 증거 insert. RLS with_check(auth.uid()=profile_id) + 가드 트리거가
    // verified_* 를 강제로 비운다(서버 권위). 결과 확정은 verify-pve-sample EF(service_role).
    const { error } = await this.client
      .from('pve_runs')
      .insert({ profile_id: uid, replay: payload.replay, client_result: payload.clientResult });
    if (error !== null) throw error;
  }
}
