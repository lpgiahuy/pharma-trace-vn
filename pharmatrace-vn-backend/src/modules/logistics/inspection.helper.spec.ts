import { deriveGoodUids, validateInspectionUids } from './inspection.helper';

const shipped = ['a', 'b', 'c', 'd', 'e'];

describe('deriveGoodUids', () => {
  it('counts every dispatched box as good when nothing is listed', () => {
    expect(deriveGoodUids(shipped, undefined)).toEqual(shipped);
  });

  it('leaves out the damaged and missing boxes the staff scanned', () => {
    expect(deriveGoodUids(shipped, undefined, ['b'], ['e'])).toEqual(['a', 'c', 'd']);
  });

  it('keeps an explicit good list as it is', () => {
    expect(deriveGoodUids(shipped, ['a', 'b'], ['c'], ['d'])).toEqual(['a', 'b']);
  });

  it('lets a scanned exception list pass the count validation', () => {
    const damaged = ['b'];
    const good = deriveGoodUids(shipped, undefined, damaged, ['e']);
    expect(() => validateInspectionUids(shipped, [{ quantity: 3, uids: good }, { quantity: 1, uids: damaged }], true)).not.toThrow();
  });

  it('is refused when the exception counts do not match the quantities', () => {
    const good = deriveGoodUids(shipped, undefined, ['b'], []);
    expect(() => validateInspectionUids(shipped, [{ quantity: 3, uids: good }, { quantity: 1, uids: ['b'] }], true)).toThrow();
  });
});
