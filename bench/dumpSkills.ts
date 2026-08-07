/**
 * 스킬 210종 매니페스트 덤프 (아이콘 생성 레인 보조 도구).
 *
 * 스킬 아이콘을 노드마다 한 장씩 만들려면 "무엇을 그릴지"의 원본이 필요하다. 그 원본은
 * `data/ships/**` 의 `ShipSkillDef` 이고, 여기서 직접 읽어 JSON 으로 뱉는다 — TS 리터럴을
 * 정규식으로 긁으면 축 순서·id 조립 규칙이 조용히 갈린다(삼중 해시 계약과 같은 함정).
 *
 * `pnpm vite-node bench/dumpSkills.ts > <경로>` 로 쓴다. 게이트가 아니라 CLI 다.
 */

import { SHIP_TYPES, flattenShipNodes } from '../data/ships/index.js';

const rows = SHIP_TYPES.flatMap((def) =>
  flattenShipNodes(def).map((node, flatIndex) => ({
    ship: def.slug,
    shipTypeId: def.id,
    flatIndex,
    id: node.id,
    code: node.code,
    axis: node.axis,
    name: node.name,
    desc: node.desc,
  })),
);

console.log(JSON.stringify(rows, null, 1));
