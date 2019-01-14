const utxo = require('../src');

describe('Dimensions Arithmetic', function () {
  it('sums correctly', function () {
    utxo.Dimensions.zero().plus({ nP2shInputs: 1 }).should.eql(utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 0,
      nP2wshInputs: 0,
      nOutputs: 0
    }));

    const components = [
      { nP2shInputs: 1 },
      { nP2shP2wshInputs: 2 },
      { nP2wshInputs: 3 },
      { nOutputs: 4 }
    ];

    const sum = utxo.Dimensions.zero()
      .plus(components[0])
      .plus(components[1])
      .plus(components[2])
      .plus(components[3]);

    sum.should.eql(utxo.Dimensions.sum(...components));

    sum.should.eql(utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      nOutputs: 4
    }));
  });

  it('multiplies correctly', function () {
    utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      nOutputs: 4
    }).times(2).should.eql(
      utxo.Dimensions({
        nP2shInputs: 2,
        nP2shP2wshInputs: 4,
        nP2wshInputs: 6,
        nOutputs: 8
      })
    );
  });
});


describe('Dimensions from unspent types', function () {
  it('determines unspent size according to chain', function () {
    utxo.chain.codes.p2sh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shInputs: 1 }))
    );

    utxo.chain.codes.p2shP2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: 1 }))
    );

    utxo.chain.codes.p2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2wshInputs: 1 }))
    );

    utxo.Dimensions.fromUnspents([
      { chain: utxo.chain.codes.p2sh.internal },
      { chain: utxo.chain.codes.p2sh.external },
      { chain: utxo.chain.codes.p2shP2wsh.internal },
      { chain: utxo.chain.codes.p2shP2wsh.external },
      { chain: utxo.chain.codes.p2wsh.internal },
      { chain: utxo.chain.codes.p2wsh.external }
    ]).should.eql(utxo.Dimensions({ nP2shP2wshInputs: 2, nP2shInputs: 2, nP2wshInputs: 2, nOutputs: 0 }));
  });
});


describe('Dimensions estimates', function () {
  it('calculates vsizes', function () {
    const dim = (
      nP2shInputs,
      nP2shP2wshInputs,
      nP2wshInputs, nOutputs
    ) => new utxo.Dimensions({
      nP2shInputs,
      nP2shP2wshInputs,
      nP2wshInputs,
      nOutputs,
    });

    [
      [dim(1, 0, 0, 1), [false, 10, 296, 34, 340]],
      [dim(0, 1, 0, 1), [true, 11, 139, 34, 184]],
      [dim(0, 0, 1, 1), [true, 11, 105, 34, 150]],
      [dim(2, 0, 0, 1), [false, 10, 592, 34, 636]],
      [dim(0, 2, 0, 1), [true, 11, 278, 34, 323]],
      [dim(0, 0, 2, 1), [true, 11, 210, 34, 255]],
      [dim(1, 1, 1, 1), [true, 11, 540, 34, 585]],
      [dim(1, 1, 1, 2), [true, 11, 540, 68, 619]],
    ].forEach(([dimensions, expectedSizes]) => {
      [
        dimensions.isSegwit(),
        dimensions.getOverheadVSize(),
        dimensions.getInputsVSize(),
        dimensions.getOutputsVSize(),
        dimensions.getVSize()
      ].should.eql(expectedSizes);
    });
  });
});
