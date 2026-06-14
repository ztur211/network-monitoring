import { assertValidNesting } from '../property-nesting';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

describe('assertValidNesting', () => {
  it('allows SITE as a root (no parent)', () => {
    expect(() => assertValidNesting(null, 'SITE')).not.toThrow();
  });
  it('rejects a non-SITE root with PROP_002', () => {
    expect(() => assertValidNesting(null, 'BUILDING')).toThrow(NodeScopeException);
  });
  it('allows BUILDING under SITE and AREA under FLOOR', () => {
    expect(() => assertValidNesting('SITE', 'BUILDING')).not.toThrow();
    expect(() => assertValidNesting('FLOOR', 'AREA')).not.toThrow();
  });
  it('rejects FLOOR under SITE (PROP_002)', () => {
    expect(() => assertValidNesting('SITE', 'FLOOR')).toThrow(NodeScopeException);
  });
  it('allows SITE under SITE (sub-sites) and AREA under AREA', () => {
    expect(() => assertValidNesting('SITE', 'SITE')).not.toThrow();
    expect(() => assertValidNesting('AREA', 'AREA')).not.toThrow();
  });
});
