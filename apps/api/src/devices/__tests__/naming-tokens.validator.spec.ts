import { renderTemplate, fillSeq, hasSeqToken } from '../naming-tokens';

describe('naming-tokens', () => {
  const tokens = { site: 'hq', building: 'a', floor: '3', area: '', role: 'rtr' };

  it('substitutes location + role tokens and keeps {seq}', () => {
    expect(renderTemplate('{site}-{role}-{seq}', tokens)).toBe('hq-rtr-{seq}');
  });
  it('collapses separators around empty tokens', () => {
    expect(renderTemplate('{site}-{area}-{role}', tokens)).toBe('hq-rtr');
  });
  it('fills the seq placeholder', () => {
    expect(fillSeq('hq-rtr-{seq}', '01')).toBe('hq-rtr-01');
    expect(hasSeqToken('hq-rtr-{seq}')).toBe(true);
    expect(hasSeqToken('hq-rtr')).toBe(false);
  });
});
