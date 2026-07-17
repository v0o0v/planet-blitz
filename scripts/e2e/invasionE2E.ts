/**
 * Phase G — 라이브 침공 e2e (게이트①②⑤ 실행 증거).
 *
 * 원격 Supabase(`qxgbxwyccbxokdgwxcuw`)에 **실 익명 계정 2개**(A=방어자, B=공격자)를
 * 만들어 다음을 실측한다. 서버 판정·스왑·약탈·복수·보너스는 전부 서버(Edge Function
 * verify-invasion + apply_invasion_result)가 결정한다 — 클라이언트는 리플레이(증거)만 제출.
 *
 *   게이트①(AC2, 위조 거부): 실 JWT 로 조작 해시·트림 로그·승패 뒤집기·self-invasion 을
 *                            원격 EF/DB 에 제출 → 전부 rejected/에러.
 *   게이트②(AC3, 침공 e2e):  A 방어 업로드 → B 배치전 → 매치메이킹 → B 침공 승리 제출 →
 *                            EF verified → 래더 스왑·복제 약탈 원격 DB 반영.
 *   게이트⑤(AC6, 복수전):    B 에게 순위를 뺏긴 A 가 24h 복수 대상으로 B 를 역침공 →
 *                            탈환 스왑 + 보너스 광물(+50) + 복제 약탈.
 *
 * 헤드리스 리플레이: 결정론 시뮬 코어(src/sim)를 그대로 구동해 "코어 근접·무포탑" 방어에
 * idle 입력으로 승리하는 리플레이를 생성한다(사람 입력 대체 — 사람 실플레이 게이트는 별도).
 *
 * 실행(scripts/deno-verify 에서 config 상속):
 *   deno run --allow-read --allow-env --allow-net --config ../deno-verify/deno.json invasionE2E.ts
 *
 * 정리: 생성한 A·B 계정/행은 이 스크립트가 아니라 리드가 MCP service_role 로 정리한다
 * (auth.users 삭제 cascade + NPC 래더 스냅샷 복원). 이 스크립트는 생성한 uid 를 마지막에
 * 출력한다.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createWorld, stepWorld, emptyInput } from '../../src/sim/world.ts';
import type { InputFrame, WorldConfig } from '../../src/sim/world.ts';
import { runReplay } from '../../src/sim/replay.ts';
import type { Replay } from '../../src/sim/replay.ts';
import { DEFAULT_TIME_LIMIT_TICKS, MAINTENANCE_FULL } from '../../src/sim/defense.ts';
import type { DefenseLayout } from '../../src/sim/defense.ts';

// ---- 환경 로드 (.env.local) ----
async function loadEnv(): Promise<{ url: string; anonKey: string }> {
  const text = await Deno.readTextFile(new URL('../../.env.local', import.meta.url));
  const map: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  const url = map['VITE_SUPABASE_URL'];
  const anonKey = map['VITE_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) throw new Error('.env.local 에 VITE_SUPABASE_URL/ANON_KEY 없음');
  return { url, anonKey };
}

const GREEN = '\x1b[32m', RED = '\x1b[31m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let failures = 0;
function pass(label: string, detail = '') { console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}${detail}${RESET}`); }
function fail(label: string, detail = '') { failures++; console.log(`${RED}FAIL${RESET} ${label}  ${detail}`); }
function check(cond: boolean, label: string, detail = '') { if (cond) pass(label, detail); else fail(label, detail); }

// ---- 침공 config/리플레이 헬퍼 ----
function invasionConfig(layout: DefenseLayout, maintenance = MAINTENANCE_FULL): WorldConfig {
  return {
    arenaWidth: 1920, arenaHeight: 1080, playerSpeed: 720, dashSpeed: 2800,
    dashCooldownTicks: 42, dashIframes: 10, hitIframes: 40, playerHp: 100,
    invasion: { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS, maintenance },
  };
}

/** 주어진 방어 layout 에 idle 입력으로 승리하는 리플레이 + 클라 결과 생성. 승리 못하면 throw. */
function buildWinReplay(seed: number, layout: DefenseLayout): { replay: Replay; clientResult: Record<string, unknown> } {
  const cfg = invasionConfig(layout);
  const idle: InputFrame = emptyInput();
  const state = createWorld(seed, cfg);
  const inputs: InputFrame[] = [];
  let won = false;
  for (let i = 0; i < DEFAULT_TIME_LIMIT_TICKS; i++) {
    inputs.push({ ...idle });
    stepWorld(state, idle);
    if (state.victory) { won = true; break; }
    if (state.gameOver) break;
  }
  if (!won) throw new Error('buildWinReplay: idle 로 승리 실패(layout 재선택 필요)');
  const replay: Replay = { seed, config: cfg, inputs };
  const r = runReplay(replay);
  if (!r.finalState.victory) throw new Error('buildWinReplay: 재실행 승리 불일치');
  const clientResult = {
    attackerWon: true, coreDestroyed: true,
    finalTick: inputs.length, finalHash: r.finalHash >>> 0,
    hashStream: r.hashes.map((h) => h >>> 0),
  };
  return { replay, clientResult };
}

// ---- Supabase 계정 헬퍼 ----
async function newClient(url: string, anonKey: string): Promise<SupabaseClient> {
  // persistSession:false → 인스턴스별 독립 메모리 세션(두 계정 격리).
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function signInAnon(c: SupabaseClient): Promise<string> {
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error('익명 로그인 후 uid 없음');
  return uid;
}
async function createProfile(c: SupabaseClient, uid: string, name: string, minerals: number): Promise<void> {
  const { error } = await c.from('profiles').insert({
    id: uid, display_name: name, save: { credits: 1000, minerals, ships: [], inventory: [] }, save_version: 1,
  });
  if (error) throw error;
}
async function insertShip(c: SupabaseClient, uid: string, name: string): Promise<void> {
  const { error } = await c.from('ships').insert({ profile_id: uid, slot: 0, name, level: 5, xp: 100 });
  if (error) throw error;
}
async function insertDefense(c: SupabaseClient, uid: string, layout: DefenseLayout): Promise<string> {
  const { data, error } = await c.from('defenses').insert({ profile_id: uid, layout }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
async function insertInvItems(c: SupabaseClient, uid: string, ids: string[]): Promise<void> {
  const rows = ids.map((item_id) => ({ profile_id: uid, item_id, location: 'inventory', data: { id: item_id, rarity: 2, name: `테스트-${item_id}` } }));
  const { error } = await c.from('items').insert(rows);
  if (error) throw error;
}
/** invasions insert(pending) → verify-invasion invoke. 원시 결과 반환(위조 검증용). */
async function submit(c: SupabaseClient, uid: string, defenderId: string, defenseId: string | null, replay: Replay, clientResult: Record<string, unknown>) {
  const ins = await c.from('invasions').insert({
    attacker_id: uid, defender_id: defenderId, defense_id: defenseId, replay, client_result: clientResult,
  }).select('id').single();
  if (ins.error) return { insertError: ins.error, verdict: null, invasionId: null };
  const invasionId = (ins.data as { id: string }).id;
  const inv = await c.functions.invoke('verify-invasion', { body: { invasion_id: invasionId } });
  return { insertError: null, verdict: inv.data, invokeError: inv.error, invasionId };
}
async function callRpc(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw error;
  return data;
}

const WIN_LAYOUT: DefenseLayout = { core: { x: 400, y: 0 }, turrets: [], obstacles: [] };
const NPC01_ID = '000000e5-ed00-4000-8000-000000000001';
const NPC01_DEF = '000000de-f000-4000-8000-000000000001';
const NPC01_LAYOUT: DefenseLayout = { core: { x: 0, y: 480 }, turrets: [{ x: -256, y: 360, type: 0 }, { x: 256, y: 360, type: 0 }], obstacles: [] };

async function main(): Promise<number> {
  const { url, anonKey } = await loadEnv();
  console.log(`${CYAN}=== Phase G 라이브 침공 e2e (${url}) ===${RESET}\n`);

  const cA = await newClient(url, anonKey);
  const cB = await newClient(url, anonKey);
  const uidA = await signInAnon(cA);
  const uidB = await signInAnon(cB);
  console.log(`계정 A(방어)=${uidA}\n계정 B(공격)=${uidB}\n`);

  // 프로필/기체/방어/인벤 셋업
  await createProfile(cA, uidA, 'E2E-방어자-A', 100);
  await createProfile(cB, uidB, 'E2E-공격자-B', 100);
  await insertShip(cA, uidA, '수호기-A');
  await insertShip(cB, uidB, '침공기-B');
  const defA = await insertDefense(cA, uidA, WIN_LAYOUT);
  const defB = await insertDefense(cB, uidB, WIN_LAYOUT);
  await insertInvItems(cA, uidA, ['a-item-1', 'a-item-2']);
  await insertInvItems(cB, uidB, ['b-item-1', 'b-item-2']);
  pass('셋업', `A방어=${defA.slice(0, 8)} B방어=${defB.slice(0, 8)}`);

  // 승리 리플레이(무포탑 코어) — A/B 방어 동일 layout 이라 하나로 재사용.
  const win = buildWinReplay(3, WIN_LAYOUT);
  // NPC#01 승리 리플레이(배치전용).
  const winNpc = buildWinReplay(3, NPC01_LAYOUT);
  pass('리플레이 생성', `승리(무포탑) ticks=${win.replay.inputs.length}, NPC#01 ticks=${winNpc.replay.inputs.length}`);

  // ---------------- 게이트① 위조 거부(실 JWT, B → NPC#01) ----------------
  console.log(`\n${CYAN}[게이트①] 원격 EF 위조 제출 스모크${RESET}`);
  // (a) 조작된 최종 해시
  {
    const bad = { ...win.clientResult, finalHash: ((win.clientResult.finalHash as number) ^ 0x1) >>> 0 };
    const r = await submit(cB, uidB, NPC01_ID, NPC01_DEF, winNpc.replay, bad);
    const status = (r.verdict as { status?: string })?.status;
    // 주의: finalHash 조작은 defense-mismatch(무포탑 리플레이 vs NPC 방어)로도 잡힘 — 어느 쪽이든 rejected 여야 함.
    check(status === 'rejected', '① 조작된 최종 해시 → rejected', `status=${status} reason=${(r.verdict as {reason?:string})?.reason}`);
  }
  // (b) 트림된(짧은) 로그 — 정직 NPC 리플레이의 입력·해시를 잘라서 제출
  {
    const trimmedInputs = winNpc.replay.inputs.slice(0, winNpc.replay.inputs.length - 50);
    const trimmedReplay: Replay = { ...winNpc.replay, inputs: trimmedInputs };
    const cr = { ...winNpc.clientResult, finalTick: trimmedInputs.length, hashStream: (winNpc.clientResult.hashStream as number[]).slice(0, trimmedInputs.length) };
    const r = await submit(cB, uidB, NPC01_ID, NPC01_DEF, trimmedReplay, cr);
    const status = (r.verdict as { status?: string })?.status;
    check(status === 'rejected', '② 트림된 로그 → rejected', `status=${status} reason=${(r.verdict as {reason?:string})?.reason}`);
  }
  // (c) 승패 뒤집기 — 정직 NPC 승리 리플레이인데 attackerWon=false 주장
  {
    const cr = { ...winNpc.clientResult, attackerWon: false, coreDestroyed: false };
    const r = await submit(cB, uidB, NPC01_ID, NPC01_DEF, winNpc.replay, cr);
    const status = (r.verdict as { status?: string })?.status;
    check(status === 'rejected', '③ 승패 뒤집기 → rejected', `status=${status} reason=${(r.verdict as {reason?:string})?.reason}`);
  }
  // (d) self-invasion insert — 트리거가 raise 해야 함(insert 자체 실패)
  {
    const r = await submit(cB, uidB, uidB, defB, win.replay, win.clientResult);
    check(r.insertError !== null, '④ self-invasion insert → 거부(트리거)', `insertError=${r.insertError?.message ?? '없음'}`);
  }

  // ---------------- 배치전(A, B 각각 NPC#01 5승) ----------------
  console.log(`\n${CYAN}[배치전] A·B 각각 NPC#01 5회 승리 → 순위 진입${RESET}`);
  async function placeViaNpc(c: SupabaseClient, uid: string, tag: string): Promise<{ rank: number; note: string }> {
    for (let i = 0; i < 5; i++) {
      const r = await submit(c, uid, NPC01_ID, NPC01_DEF, winNpc.replay, winNpc.clientResult);
      const status = (r.verdict as { status?: string })?.status;
      if (status !== 'verified') throw new Error(`${tag} 배치전 ${i + 1} verified 실패: ${JSON.stringify(r.verdict)}`);
    }
    const st = await callRpc(c, 'get_placement_status');
    const status = Array.isArray(st) ? st[0] : st;
    const res = await callRpc(c, 'apply_placement_result') as { placed: boolean; rank: number; note: string };
    console.log(`  ${tag} placement_status=${JSON.stringify(status)} → apply=${JSON.stringify(res)}`);
    return { rank: res.rank, note: res.note };
  }
  // A 를 먼저 배치(상위), 그다음 B(하위) → A.rank < B.rank
  const placeA = await placeViaNpc(cA, uidA, 'A');
  const placeB = await placeViaNpc(cB, uidB, 'B');
  check(placeA.rank < placeB.rank, '배치 순위: A 가 B 보다 상위', `A.rank=${placeA.rank} < B.rank=${placeB.rank}`);

  // ---------------- 게이트② 침공 e2e (B → A 스왑·약탈) ----------------
  console.log(`\n${CYAN}[게이트②] B 매치메이킹 → A 침공 → 스왑·약탈${RESET}`);
  const targets = await callRpc(cB, 'get_invasion_targets') as Array<{ profile_id: string; rank: number; defense_id: string }>;
  const tgtA = targets.find((t) => t.profile_id === uidA);
  check(tgtA !== undefined, 'B 매치메이킹에 A 가 제안됨', `targets=${targets.map((t) => `${t.profile_id.slice(0,8)}#${t.rank}`).join(',')}`);
  const subBA = await submit(cB, uidB, uidA, tgtA?.defense_id ?? defA, win.replay, win.clientResult);
  const vBA = subBA.verdict as { status?: string; attackerWon?: boolean; ladder?: { attackerRank: number; defenderRank: number }; loot?: unknown[] };
  check(vBA?.status === 'verified' && vBA?.attackerWon === true, 'B 침공 EF verified·공격자 승리', JSON.stringify(vBA?.ladder));
  check((vBA?.ladder?.attackerRank ?? 99) < (vBA?.ladder?.defenderRank ?? 0), 'EF 응답 스왑 반영', JSON.stringify(vBA?.ladder));
  check(Array.isArray(vBA?.loot) && (vBA?.loot?.length ?? 0) > 0, '복제 약탈 loot 반환', `loot 수=${vBA?.loot?.length}`);
  const invBA = subBA.invasionId;

  console.log(`\n계정 uid 출력(정리용):\nUID_A=${uidA}\nUID_B=${uidB}\nINV_BA=${invBA}`);

  // ---------------- 게이트⑤ 복수전 (A → B 탈환·보너스) ----------------
  console.log(`\n${CYAN}[게이트⑤] A 복수 대상 조회 → B 역침공 → 탈환·보너스 광물${RESET}`);
  const rev = await callRpc(cA, 'get_revenge_targets') as Array<{ profile_id: string; revenge_invasion_id: string; rank: number; defense_id: string }>;
  const revB = rev.find((t) => t.profile_id === uidB);
  check(revB !== undefined, 'A 복수 대상에 B 가 있음', `revenge=${rev.map((t) => t.profile_id.slice(0,8)).join(',')} revInv=${revB?.revenge_invasion_id?.slice(0,8)}`);
  const subAB = await submit(cA, uidA, uidB, revB?.defense_id ?? defB, win.replay, win.clientResult);
  const vAB = subAB.verdict as { status?: string; attackerWon?: boolean; revenge?: boolean; bonusMinerals?: number; ladder?: { attackerRank: number; defenderRank: number }; loot?: unknown[] };
  check(vAB?.status === 'verified' && vAB?.attackerWon === true, 'A 복수 침공 EF verified·승리', JSON.stringify(vAB?.ladder));
  check(vAB?.revenge === true, 'EF 복수 판정(is_revenge)', `revenge=${vAB?.revenge}`);
  check((vAB?.bonusMinerals ?? 0) === 50, '보너스 광물 +50', `bonusMinerals=${vAB?.bonusMinerals}`);
  check((vAB?.ladder?.attackerRank ?? 99) < (vAB?.ladder?.defenderRank ?? 0), '탈환 스왑(A 재상승)', JSON.stringify(vAB?.ladder));

  console.log('');
  if (failures === 0) console.log(`${GREEN}=== 라이브 e2e 전체 통과 ===${RESET}`);
  else console.log(`${RED}=== ${failures}건 실패 ===${RESET}`);
  console.log(`\nCLEANUP_UIDS ${uidA} ${uidB}`);
  return failures === 0 ? 0 : 1;
}

Deno.exit(await main());
