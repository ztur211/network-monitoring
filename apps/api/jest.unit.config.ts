import type { Config } from 'jest';
import { base } from './jest.base.config';

const config: Config = {
  ...base,
  testRegex: [
    '.*\\.(service|provider|state-machine|guard|interceptor|validator|cursor|adapter|config|filter)\\.spec\\.ts$',
    // Spec 5: the export module's pure IFC primitives (ifc-guid, ifc2x3-writer) are unit tests.
    '.*/export/__tests__/.*\\.spec\\.ts$',
    // Spec 6: the bcf module's pure .bcfzip codec (bcf-zip) is a unit test.
    '.*/bcf/__tests__/.*\\.spec\\.ts$',
    // Spec 7: monitoring pure-logic tests (e.g. derive-state). DB-integration tests
    // in this module use the `.repository.spec.ts` suffix (→ jest.integration.config)
    // and are excluded here so they don't run twice / require a DB in the unit suite.
    '.*/monitoring/__tests__/(?!.*\\.repository\\.spec\\.ts$).*\\.spec\\.ts$',
    // Storage: pure-logic + real-tmpdir backend tests (no external service).
    '.*/storage/__tests__/.*\\.spec\\.ts$',
    // Alerts: engine/evaluator/delivery/channel unit tests (no external service). DB-integration
    // tests in this module use the `.repository.spec.ts` suffix (→ jest.integration.config) and
    // are excluded here so they don't run twice / require a DB in the unit suite (mirrors monitoring).
    '.*/alerts/__tests__/(?!.*\\.repository\\.spec\\.ts$).*\\.spec\\.ts$',
  ],
  coverageDirectory: '../coverage/unit',
};

export default config;
