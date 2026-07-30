/**
 * 3D 모델 원장(`assets/models/manifest.json`) ↔ 실물 GLB 대조 (2026-07-30).
 *
 * ## 이 테스트가 막는 결함
 *
 * Meshy 의 변형 도구(retexture = 색만 교체 / rig+animate = 애니메이션 / remesh = 폴리곤
 * 재조정)는 전부 **로컬 파일이 아니라 서버의 task id** 를 입력으로 받는다. 그래서 이 프로젝트에서
 * 3D 모델의 "원본"은 리포에 있는 경량 GLB 가 아니라 **manifest 에 적힌 task id** 다.
 *
 * task id 를 잃으면 색 하나 바꾸려 해도 20 크레딧짜리 생성부터 다시 해야 한다 — 되돌릴 수 없는
 * 손실이고, 조용히 일어난다(GLB 는 멀쩡히 렌더되므로 화면에는 아무 신호가 없다). 그래서
 * **양방향으로** 건다:
 *
 *  - GLB 가 있는데 원장에 없으면 → 실패 (재사용 불가능한 고아 자산이 들어오는 것을 막는다)
 *  - 원장에 있는데 GLB 가 없으면 → 실패 (`bossActor` 의 로드는 조용한 폴백이라 신호가 없다)
 *  - 원장 항목에 재사용 키(`tasks.refine`)가 없으면 → 실패 (보관의 핵심이 그 한 줄이다)
 *
 * 자산 결손을 소스 기준으로 잡는 규율은 `uiAssetPresence.test.ts` 와 같다(빌드 산출물 기준으로
 * 짜면 Vite 의 인라인 임계값을 테스트하게 된다).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = join(ROOT, 'assets', 'models');

interface ModelEntry {
  id: string;
  file: string;
  meshy?: { tasks?: Record<string, string>; credits?: Record<string, number> };
}

const manifest = JSON.parse(readFileSync(join(MODELS_DIR, 'manifest.json'), 'utf8')) as {
  version: number;
  models: ModelEntry[];
};

/** UUID 꼴(Meshy task id). 오타·플레이스홀더가 원장에 남는 것을 막는다. */
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('3D 모델 원장 ↔ 실물 대조', () => {
  it('원장 버전이 알려진 스키마다', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.models.length).toBeGreaterThan(0);
  });

  it('원장의 모든 항목이 실제 GLB 를 가리킨다', () => {
    for (const m of manifest.models) {
      const path = join(MODELS_DIR, m.file);
      expect(statSync(path).isFile(), `${m.id}: ${m.file} 없음`).toBe(true);
    }
  });

  it('디스크의 모든 GLB 가 원장에 등재돼 있다 — 재사용 불가 고아 자산 금지', () => {
    const onDisk = readdirSync(MODELS_DIR).filter((f) => f.toLowerCase().endsWith('.glb'));
    const listed = new Set(manifest.models.map((m) => m.file));
    expect([...onDisk].filter((f) => !listed.has(f))).toEqual([]);
  });

  it('모든 항목이 재사용 키(refine task id)를 갖는다 — 잃으면 재생성뿐이다', () => {
    for (const m of manifest.models) {
      const refine = m.meshy?.tasks?.refine;
      expect(refine, `${m.id}: meshy.tasks.refine 누락`).toBeDefined();
      expect(TASK_ID.test(refine ?? ''), `${m.id}: refine task id 형식 오류 — ${refine}`).toBe(
        true,
      );
    }
  });

  it('기록된 task id 는 전부 UUID 꼴이다', () => {
    for (const m of manifest.models) {
      for (const [stage, id] of Object.entries(m.meshy?.tasks ?? {})) {
        expect(TASK_ID.test(id), `${m.id}.${stage}: ${id}`).toBe(true);
      }
    }
  });

  it('크레딧 합계가 단계별 값의 합과 일치한다', () => {
    for (const m of manifest.models) {
      const c = m.meshy?.credits;
      if (c === undefined) continue;
      const { total, ...stages } = c;
      const sum = Object.values(stages).reduce((a, b) => a + b, 0);
      expect(total, `${m.id}: 크레딧 합계 불일치`).toBe(sum);
    }
  });

  it('커밋된 GLB 가 웹 예산 안이다 — 원본(수십 MB)을 실수로 커밋하는 것을 막는다', () => {
    for (const m of manifest.models) {
      const bytes = statSync(join(MODELS_DIR, m.file)).size;
      // 1MB 상한: 카르곤 보스 실측 582KB. 이걸 넘으면 glb-prep 축소를 건너뛴 것이다
      // (원본은 32.7MB, 리메시만 한 것은 13.5MB 였다).
      expect(bytes, `${m.file}: ${(bytes / 1048576).toFixed(2)}MB`).toBeLessThan(1_048_576);
    }
  });
});
