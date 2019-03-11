import should from 'should';
import Codes from '../src/codes';

describe('chain codes', function() {

  const externalList = [
    Codes.external.p2sh,
    Codes.external.p2shP2wsh,
    Codes.external.p2wsh,
  ];

  const internalList = [
    Codes.internal.p2sh,
    Codes.internal.p2shP2wsh,
    Codes.internal.p2wsh,
  ];

  it(`is immutable`, function() {
    const p2sh = Codes.internal.p2sh;
    // @ts-ignore
    should.throws(() => { Codes.internal.p2sh = -1; }, TypeError);
    Codes.internal.p2sh.should.eql(p2sh);

    // @ts-ignore
    should.throws(() => { Codes.internal.values.push(-1); }, TypeError);
    // @ts-ignore
    should.throws(() => { Codes.internal.values = []; }, TypeError);
    Codes.internal.values.should.eql([1, 11, 21]);

    // @ts-ignore
    should.throws(() => { Codes.all = []; });
    Codes.all.should.not.be.empty();
  });

  it('matches expected values', function() {
    externalList.should.eql([
      Codes.p2sh.external,
      Codes.p2shP2wsh.external,
      Codes.p2wsh.external,
    ]);
    externalList.should.eql([0, 10, 20]);
    externalList.should.eql([...Codes.external.values]);

    Codes.all.should.eql([...externalList, ...internalList]);
    internalList.should.eql([
      Codes.p2sh.internal,
      Codes.p2shP2wsh.internal,
      Codes.p2wsh.internal,
    ]);
    internalList.should.eql([1, 11, 21]);
    internalList.should.eql([...Codes.internal.values]);
  });

  it('are grouped correctly', function() {
    internalList.should.matchEach(Codes.isInternal);
    externalList.should.matchEach(Codes.isExternal);

    // all are either internal or external, never none or both
    Codes.all.should.matchEach((code) => !!(Codes.isExternal(code) !== Codes.isInternal(code)));

    Codes.p2sh.values.should.matchEach(Codes.isP2sh);
    Codes.p2shP2wsh.values.should.matchEach(Codes.isP2shP2wsh);
    Codes.p2wsh.values.should.matchEach(Codes.isP2wsh);

    // every code has exactly one address type
    Codes.all.should.matchEach(
      (code) => 1 ===
        [Codes.isP2sh(code), Codes.isP2wsh(code), Codes.isP2shP2wsh(code)]
          .reduce((sum, v) => sum + Number(v), 0),
    );

    Codes.all.should.matchEach(Codes.isValid);
  });

  const invalidInputs = [undefined, null, 'lol', -1, 42];

  it('throws correct error for invalid input', function() {
    [
      Codes.isInternal,
      Codes.isExternal,
      Codes.isP2sh,
      Codes.isP2shP2wsh,
      Codes.isP2wsh,
    ].forEach(
      (func) =>
        // @ts-ignore
        invalidInputs.forEach((input) => should.throws(() => func(input), Codes.ErrorInvalidCode)),
    );

    invalidInputs.should.matchEach((input) => !Codes.isValid(input));
  });

  it(`has chain type`, function() {
    Codes.all.should.matchEach(
      (code) => (Codes.ChainType(code) === code) && Codes.ChainType.is(code),
    );
    // @ts-ignore
    invalidInputs.forEach((code) => should.throws(() => chain.ChainType(code)));
  });
});
