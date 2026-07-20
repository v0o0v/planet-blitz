/**
 * 침공 3레이어 네임스페이스 배럴 (M7a · L0-schema).
 *
 * 다른 레인(sim·net·UI·EF)은 개별 파일 대신 이 배럴을 통해 import 하는 것을 기본으로 한다.
 * 단, Edge Function 은 번들 크기를 줄이려고 개별 파일(`./normalize.js` 등)을 직접 import 해도
 * 무방하다 — 두 경로 모두 같은 모듈 인스턴스다.
 */

export * from './constants.js';
export * from './types.js';
export * from './normalize.js';
export * from './scroll.js';
export * from './phase.js';
export * from './step.js';
export * from './formation.js';
export * from './facility.js';
export * from './hazardCycle.js';
export * from './wallIndex.js';
export * from './coreRoom.js';
export * from './guardianBridge.js';
