/**
 * 런 목표·주의 2줄 파생 계약(`src/ui/runObjective.ts`, 사용자 요청 2026-08-04).
 *
 * 검증하는 것은 **문구 그 자체가 아니라 어느 문구가 뽑히는가**다 — 카탈로그 문자열은 다듬어질
 * 수 있으므로 키 기준(`t()` 결과 동치)으로 잠근다. 상황 경고는 우선순위(즉사 > 시간 > 그 외)가
 * 계약의 핵심이라 **동시 성립**을 따로 세운다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world.js';
import type { WorldState, WorldConfig } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { bossProgress } from '../src/sim/bossProgress.js';
import { invasionHudState } from '../src/ui/invasionProgress.js';
import type { InvasionHudState } from '../src/ui/invasionProgress.js';
import {
  runObjective,
  shelterArrivalMessage,
  PREDATOR_WARN_DISTANCE,
} from '../src/ui/runObjective.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import type { PlanetMode } from '../src/sim/planetMode.js';
import { t } from '../src/i18n/index.js';
import { CRYO_TENDER } from '../data/planets/niflheim.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';

const DURABLE_HP = 100_000_000;

/** 니플헤임(planet 2) = 추격 모드. 정규 경로 config 라 브릿지가 없다. */
function chaseWorld(): WorldState {
  const cfg: WorldConfig = {
    ...buildRunConfig(defaultProfile(), { planet: 2, stage: 1 }),
    playerHp: DURABLE_HP,
  };
  return createWorld(11, cfg);
}

/** 톡사르 계열이 아니라 **모드만** 갈아 끼운 최소 월드(수축 규칙 검증용). */
function worldWithMode(mode: PlanetMode): WorldState {
  const cfg: WorldConfig = {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: mode,
    playerHp: DURABLE_HP,
  };
  return createWorld(11, cfg);
}

function objectiveOf(w: WorldState, inv: InvasionHudState | null = null): ReturnType<
  typeof runObjective
> {
  return runObjective(w, bossProgress(w), inv);
}

describe('런 목표·주의 2줄', () => {
  it('추격 런: 목표는 대피소 **확보 카운터**, 주의는 모드 고정(경고 아님)', () => {
    const w = chaseWorld();
    // 포식자를 경고 거리 밖으로 밀어 평상시 상태를 만든다(스폰 직후엔 위쪽 1200 이라 이미 밖이다).
    const eta = bossProgress(w);
    const s = objectiveOf(w);
    expect(s.objective).not.toBeNull();
    // ⚠️ 카운터 축은 **구간이 아니라 대피소 수**다(2026-08-05 재설계). 보스까지의 거리가 곧
    // 남은 대피소 수라, 구간 카운터를 함께 붙이면 한 줄에 진행도가 둘이 되어 어느 쪽이 보스를
    // 부르는지 다시 흐려진다.
    expect(eta!.gate).toBe('shelter');
    expect(eta!.goal).toBe(10);
    expect(s.objective).toBe(t('hud.bossEta.shelter', { n: eta!.current, goal: eta!.goal }));
    expect(s.objective).toContain('0/10');
    expect(s.objective).not.toContain(t('hud.obj.count', { n: eta!.segment, total: eta!.totalSegments }));
    expect(s.caution).toBe(t('hud.obj.caution.chase'));
    expect(s.alert).toBe(false);
  });

  it('추격: 무적 포식자가 경고 거리 안이면 주의 줄이 경고로 바뀐다', () => {
    const w = chaseWorld();
    const player = w.entities[0] as Entity;
    const predator = w.entities.find((e) => e.kind === 'boss') as Entity;
    expect(predator.aux0).toBe(0); // 무적(취약화 전)
    predator.x = player.x + PREDATOR_WARN_DISTANCE - 20;
    predator.y = player.y;
    const s = objectiveOf(w);
    expect(s.caution).toBe(t('hud.obj.warn.predator'));
    expect(s.alert).toBe(true);
    // 경고가 떠도 **목표 줄은 사라지지 않는다**(둘째 줄만 갈아 끼운다).
    expect(s.objective).not.toBeNull();
  });

  it('추격: 취약화된 포식자(aux0=1)는 붙어 있어도 즉사 경고를 띄우지 않는다', () => {
    const w = chaseWorld();
    const player = w.entities[0] as Entity;
    const predator = w.entities.find((e) => e.kind === 'boss') as Entity;
    predator.aux0 = 1; // 취약 = 이제 접촉이 즉사가 아니다(아군탄으로 잡는 대상)
    predator.x = player.x + 10;
    predator.y = player.y;
    expect(objectiveOf(w).caution).toBe(t('hud.obj.caution.chase'));
  });

  it('수축: 플레이어가 안전 반경 밖이면 경고, 안이면 모드 고정 주의', () => {
    const w = worldWithMode(PLANET_MODE.shrink);
    const player = w.entities[0] as Entity;
    const radius = w.shrinkRuntime?.safeRadius ?? 0;
    expect(radius).toBeGreaterThan(0);
    player.x = radius + 100;
    player.y = 0;
    expect(objectiveOf(w).caution).toBe(t('hud.obj.warn.outside'));
    expect(objectiveOf(w).alert).toBe(true);
    player.x = radius - 100;
    expect(objectiveOf(w).caution).toBe(t('hud.obj.caution.shrink'));
  });

  it('수복형 적이 실제로 수복 중(phase=1)일 때만 경고한다 — 행성별 typeIndex 무관', () => {
    const w = chaseWorld();
    // 니플헤임 냉기 정비선(전역 typeIndex 13)을 직접 세운다. 역할이 아니라 **공격 종류**로
    // 거르는 계약이라, 기본 로스터의 support(3) 가 아니어도 걸려야 한다.
    const tender = CRYO_TENDER;
    expect(tender.attack.kind).toBe('heal');
    expect(ENEMY_BY_TYPE[tender.typeIndex]?.id).toBe(tender.id);
    const healer = blankEntity('enemy');
    healer.id = 9999;
    healer.enemyType = tender.typeIndex;
    healer.phase = 0; // 아직 수복 중이 아니다
    w.entities.push(healer);
    expect(objectiveOf(w).caution).toBe(t('hud.obj.caution.chase'));
    healer.phase = 1; // 이번 틱 실제로 회복시켰다(patterns/index.ts heal 분기)
    const s = objectiveOf(w);
    expect(s.caution).toBe(t('hud.obj.warn.healer'));
    expect(s.alert).toBe(true);
  });

  it('경고 우선순위: 즉사 위협이 수복형 경고를 이긴다', () => {
    const w = chaseWorld();
    const player = w.entities[0] as Entity;
    const predator = w.entities.find((e) => e.kind === 'boss') as Entity;
    predator.x = player.x + 100;
    predator.y = player.y;
    const healer = blankEntity('enemy');
    healer.id = 9999;
    healer.enemyType = CRYO_TENDER.typeIndex;
    healer.phase = 1;
    w.entities.push(healer);
    expect(objectiveOf(w).caution).toBe(t('hud.obj.warn.predator'));
  });

  it('보스전에서는 목표 줄이 사라지고 주의 줄만 남는다', () => {
    const w = chaseWorld();
    w.wave.boss = true; // 보스 구간 진입 = 보스 체력바가 목표를 대신한다
    const eta = bossProgress(w);
    const s = runObjective(w, eta, null);
    expect(eta?.bossActive).toBe(true);
    expect(s.objective).toBeNull();
    expect(s.caution).toBe(t('hud.obj.caution.chase'));
  });

  it('침공 런: 목표는 레이어 문구, 주의는 제한시간 — 임박하면 남은 초로 바뀐다', () => {
    const w = chaseWorld();
    const inv = {
      phase: 1,
      layerLabel: 'L2',
      layerFraction: 0.4,
      layerRemainSec: 40,
      totalRemainSec: 120,
      defense: { facilities: 0, guardians: 0, props: 0, enemies: 0 },
    } as InvasionHudState;
    const calm = runObjective(w, undefined, inv);
    expect(calm.objective).toBe(t('hud.obj.inv1'));
    expect(calm.caution).toBe(t('hud.obj.caution.invasion'));
    expect(calm.alert).toBe(false);

    const urgent = runObjective(w, undefined, { ...inv, totalRemainSec: 12 });
    expect(urgent.caution).toBe(t('hud.obj.warn.time', { n: 12 }));
    expect(urgent.alert).toBe(true);
    // 침공 목표는 레이어마다 다르다(세 키가 실제로 갈린다).
    expect(runObjective(w, undefined, { ...inv, phase: 2 }).objective).toBe(t('hud.obj.inv2'));
  });

  it('대피소 확보 알림은 확보 수의 상승 에지에만 뜬다 — 기준선 없음·정체·타 모드는 침묵', () => {
    // 정상: 확보 수가 1 → 2 로 올라간 프레임.
    expect(shelterArrivalMessage(PLANET_MODE.chase, 1, 2, 10)).toBe(
      t('hud.obj.shelterReached', { n: 2, goal: 10 }),
    );
    // 기준선 없음(-1) = 런 시작 직후 — 첫 프레임을 '확보'로 오인하면 안 된다.
    expect(shelterArrivalMessage(PLANET_MODE.chase, -1, 0, 10)).toBeNull();
    expect(shelterArrivalMessage(PLANET_MODE.chase, -1, 3, 10)).toBeNull();
    // 변화 없음·후퇴는 침묵.
    expect(shelterArrivalMessage(PLANET_MODE.chase, 2, 2, 10)).toBeNull();
    expect(shelterArrivalMessage(PLANET_MODE.chase, 3, 2, 10)).toBeNull();
    // 마지막 한 곳(= 보스가 열리는 순간)도 말한다 — 여기서 침묵하면 무슨 일이 났는지 안 보인다.
    expect(shelterArrivalMessage(PLANET_MODE.chase, 9, 10, 10)).toBe(
      t('hud.obj.shelterReached', { n: 10, goal: 10 }),
    );
    // 다른 모드는 대피소 축이 없다.
    expect(shelterArrivalMessage(PLANET_MODE.vampire, 1, 2, 10)).toBeNull();
    expect(shelterArrivalMessage(PLANET_MODE.contamination, 1, 2, 10)).toBeNull();
  });

  it('침공 파생이 null 이면 PvE 경로로 떨어진다(런이 아니면 호출부가 감춘다)', () => {
    const w = chaseWorld();
    expect(invasionHudState(w)).toBeNull();
    expect(objectiveOf(w).caution).toBe(t('hud.obj.caution.chase'));
  });
});
