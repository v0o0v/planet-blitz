/**
 * 엔티티 비주얼 등록 허브 — **AAA 비주얼 모듈을 프로덕션 그래프에 붙이는 유일한 지점**이다.
 *
 * ## 왜 허브가 필요한가
 * `adorner.ts` 의 `registerAdornerFactory` 와 `hazardHost.ts` 의
 * `registerHazardMaterialFactory` 는 **모듈 최상위 부수효과**로 호출된다. 즉 누군가 그 모듈을
 * import 하지 않으면 등록이 영영 일어나지 않고, 모듈은 완성된 채로 화면에 없다.
 *
 * 이 리포는 정확히 그 결함을 8번 밟았다(가장 최근: `invasionBackdrop.ts` 가 완성된 채로
 * `main.ts` 에 붙은 적이 없어, 전용 배경 3종과 레이어 전환이 통째로 죽어 있었다. 그 모듈의
 * 단위 테스트는 **전부 그린**이었다 — 모듈 자체는 멀쩡했기 때문이다).
 *
 * `tests/renderWiring.test.ts` 가 이 결함을 구조적으로 막는다: `src/render/**` 의 모든 모듈은
 * 프로덕션 코드가 실제로 import 해야 한다. 이 파일이 그 요구를 만족시키는 지점이고,
 * 이 파일 자신은 `entityRenderer.ts` 가 import 한다.
 *
 * ## 왜 여기이고 `hazardHost.ts` 가 아닌가
 * `hazardField.ts` 를 `hazardHost.ts` 에서 import 하면
 * `hazardField → hazardHost → hazardVisual → hazardField` 순환이 생기고, 최상위
 * `installHazardMaterials()` 가 아직 TDZ 인 `hazardHost` 의 `registry` 에 닿아 **ReferenceError
 * 로 죽는다**. 허브는 반드시 host 바깥에 있어야 한다.
 *
 * ## 왜 값 없는 import 인가
 * 각 모듈이 최상위에서 스스로 등록하므로 여기서는 **부수효과만** 필요하다. 등록은 멱등이라
 * 중복 import 도 안전하다. 레인이 늘면 이 목록에 한 줄씩 더한다 — 배열 리터럴이 아니라
 * import 문이라 여러 레인이 동시에 더해도 충돌 면이 최소다.
 *
 * ── 결정론(ADR-0005) ── 전부 render-only 다. sim·hashWorld 에 닿지 않는다.
 */

import './playerVisual.js';
import './enemyVisual.js';
import './hazardField.js';
