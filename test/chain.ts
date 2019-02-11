import should from 'should';
import * as chain from '../src/codes';

describe('chain codes', function() {
  const { codes } = chain;

  const externalList = [
    codes.external.p2sh,
    codes.external.p2shP2wsh,
    codes.external.p2wsh,
  ];

  const internalList = [
    codes.internal.p2sh,
    codes.internal.p2shP2wsh,
    codes.internal.p2wsh,
  ];

  it(`is immutable`, function() {
    const p2sh = codes.internal.p2sh;
    // @ts-ignore
    should.throws(() => { codes.internal.p2sh = -1; }, TypeError);
    codes.internal.p2sh.should.eql(p2sh);

    // @ts-ignore
    should.throws(() => { codes.internal.values.push(-1); }, TypeError);
    // @ts-ignore
    should.throws(() => { codes.internal.values = []; }, TypeError);
    codes.internal.values.should.eql([1, 11, 21]);

    // @ts-ignore
    should.throws(() => { codes.all = []; });
    codes.all.should.not.be.empty();
  });

  it('matches expected values', function() {
    externalList.should.eql([
      codes.p2sh.external,
      codes.p2shP2wsh.external,
      codes.p2wsh.external,
    ]);
    externalList.should.eql([0, 10, 20]);
    externalList.should.eql([...codes.external.values]);

    codes.all.should.eql([...externalList, ...internalList]);
    internalList.should.eql([
      codes.p2sh.internal,
      codes.p2shP2wsh.internal,
      codes.p2wsh.internal,
    ]);
    internalList.should.eql([1, 11, 21]);
    internalList.should.eql([...codes.internal.values]);
  });

  it('are grouped correctly', function() {
    internalList.should.matchEach(chain.isInternal);
    externalList.should.matchEach(chain.isExternal);

    // all are either internal or external, never none or both
    codes.all.should.matchEach((code) => !!(chain.isExternal(code) !== chain.isInternal(code)));

    codes.p2sh.values.should.matchEach(chain.isP2sh);
    codes.p2shP2wsh.values.should.matchEach(chain.isP2shP2wsh);
    codes.p2wsh.values.should.matchEach(chain.isP2wsh);

    // every code has exactly one address type
    codes.all.should.matchEach(
      (code) => 1 ===
        [chain.isP2sh(code), chain.isP2wsh(code), chain.isP2shP2wsh(code)]
          .reduce((sum, v) => sum + Number(v), 0),
    );

    codes.all.should.matchEach(chain.isValid);
  });

  const invalidInputs = [undefined, null, 'lol', -1, 42];

  it('throws correct error for invalid input', function() {
    [
      chain.isInternal,
      chain.isExternal,
      chain.isP2sh,
      chain.isP2shP2wsh,
      chain.isP2wsh,
    ].forEach(
      (func) =>
        // @ts-ignore
        invalidInputs.forEach((input) => should.throws(() => func(input), chain.ErrorInvalidCode)),
    );

    invalidInputs.should.matchEach((input) => !chain.isValid(input));
  });

  it(`has chain type`, function() {
    codes.all.should.matchEach(
      (code) => (chain.ChainType(code) === code) && chain.ChainType.is(code),
    );
    // @ts-ignore
    invalidInputs.forEach((code) => should.throws(() => chain.ChainType(code)));
  });
});
