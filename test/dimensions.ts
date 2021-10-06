import * as should from 'should';

import {
  Codes,
  Dimensions,
  IDimensions,
  IOutputDimensions,
  OutputDimensions,
  VirtualSizes,
} from '../src';

import {
  getOutputDimensionsForUnspentType,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from './testutils';

describe('Dimensions Attributes', function() {
  it('has read-only nInputs and nOutputs', function() {
    should.throws(() => Dimensions.zero().nInputs = 1, /read-only/);
    should.throws(() => Dimensions.zero().nOutputs = 1, /read-only/);
  });
});

describe('Output Dimensions', function() {
  it('instantiates', function() {
    const dims: IOutputDimensions = OutputDimensions({ size: 0, count: 0 });
    should.throws(() => dims.count += 1);
  });
});

describe('Dimensions Arithmetic', function() {
  it('sums correctly', function() {
    Dimensions.zero().plus({ nP2shInputs: 1 }).should.eql(Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 0,
      nP2wshInputs: 0,
      outputs: { size: 0, count: 0 },
    }));

    const components = [
      { nP2shInputs: 1 },
      { nP2shP2wshInputs: 2 },
      { nP2wshInputs: 3 },
      { outputs: { size: 23, count: 1 } },
      { outputs: { size: 44, count: 2 } },
      { outputs: { size: 0, count: 0 } },
    ];

    components.forEach((component) => should.doesNotThrow(() => Dimensions.sum(component)));

    const sum = Dimensions.zero()
      .plus(components[0])
      .plus(components[1])
      .plus(components[2])
      .plus(components[3])
      .plus(components[4])
      .plus(components[5]);

    sum.should.eql(Dimensions.sum(...components));

    sum.should.eql(Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      outputs: { size: 67, count: 3 },
    }));

    sum.nOutputs.should.eql(sum.outputs.count);
  });

  it('provides some typical output sizes', function() {
    ([
      [Dimensions.SingleOutput.p2sh, VirtualSizes.txP2shOutputSize],
      [Dimensions.SingleOutput.p2shP2wsh, VirtualSizes.txP2shP2wshOutputSize],
      [Dimensions.SingleOutput.p2wsh, VirtualSizes.txP2wshOutputSize],
      [Dimensions.SingleOutput.p2pkh, VirtualSizes.txP2pkhOutputSize],
      [Dimensions.SingleOutput.p2wpkh, VirtualSizes.txP2wpkhOutputSize],
    ] as Array<[IDimensions, number]>).forEach(([dims, size]) => {
      dims.getOutputsVSize().should.eql(size);
    });
  });

  it('prevents sum of invalid data', function() {
    should.doesNotThrow(() => Dimensions.sum({ outputs: { count: 0, size: 0 } }));
    should.doesNotThrow(() => Dimensions.sum({ outputs: { count: 1, size: 1 } }));
    should.throws(() => Dimensions.sum({ nOutputs: 1 }));
    should.throws(() => Dimensions.sum({ nOutputs: 1, outputs: { count: 2, size: 1 } }));
    // @ts-ignore
    should.throws(() => Dimensions.sum({ nP2shInputs: 1 }, { nP2shInputs: 'foo' }));
    should.throws(() => Dimensions.sum({ outputs: { count: 1, size: 0 } }));
    should.throws(() => Dimensions.sum({ outputs: { count: 0, size: 1 } }));
    should.throws(() => Dimensions.sum({ outputs: { count: 1, size: 1 } }, { outputs: { count: 1, size: 0 } }));
  });

  it('multiplies correctly', function() {
    Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      outputs: { count: 1, size: 22 },
    }).times(3).should.eql(
      Dimensions({
        nP2shInputs: 3,
        nP2shP2wshInputs: 6,
        nP2wshInputs: 9,
        outputs: { count: 3, size: 66 },
      }),
    );
  });
});

describe('Dimensions from unspent types', function() {
  it('determines unspent size according to chain', function() {
    Codes.p2sh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain })
        .should.eql(Dimensions.sum({ nP2shInputs: 1 })),
    );

    Codes.p2shP2wsh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain })
        .should.eql(Dimensions.sum({ nP2shP2wshInputs: 1 })),
    );

    Codes.p2wsh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain })
        .should.eql(Dimensions.sum({ nP2wshInputs: 1 })),
    );

    Dimensions.fromUnspents([
      { chain: Codes.p2sh.internal },
      { chain: Codes.p2sh.external },
      { chain: Codes.p2shP2wsh.internal },
      { chain: Codes.p2shP2wsh.external },
      { chain: Codes.p2wsh.internal },
      { chain: Codes.p2wsh.external },
    ]).should.eql(Dimensions({
      nP2shP2wshInputs: 2,
      nP2shInputs: 2,
      nP2wshInputs: 2,
      outputs: { count: 0, size: 0 },
    }));
  });

  it('calculates output dimensions dynamically', function() {
    const expectedSizes = new Map([
      [UnspentTypeScript2of3.p2sh, VirtualSizes.txP2shOutputSize],
      [UnspentTypeScript2of3.p2shP2wsh, VirtualSizes.txP2shP2wshOutputSize],
      [UnspentTypeScript2of3.p2wsh, VirtualSizes.txP2wshOutputSize],
      [UnspentTypePubKeyHash.p2pkh, VirtualSizes.txP2pkhOutputSize],
      [UnspentTypePubKeyHash.p2wpkh, VirtualSizes.txP2wpkhOutputSize],
    ]);

    [...Object.keys(UnspentTypeScript2of3), ...Object.keys(UnspentTypePubKeyHash)].forEach((type) =>
      getOutputDimensionsForUnspentType(type)
      .outputs.size.should.eql(expectedSizes.get(type as any)),
    );
  });
});

describe('Dimensions estimates', function() {
  it('calculates vsizes', function() {
    const dim = (
      nP2shInputs: number,
      nP2shP2wshInputs: number,
      nP2wshInputs: number,
      nOutputs: number,
    ): IDimensions => Dimensions.sum(
      {
        nP2shInputs,
        nP2shP2wshInputs,
        nP2wshInputs,
      },
      getOutputDimensionsForUnspentType(UnspentTypePubKeyHash.p2pkh).times(nOutputs),
    );

    [
      [dim(1, 0, 0, 1), [false, 10, 297, 34, 341]],
      [dim(0, 1, 0, 1), [true, 11, 140, 34, 185]],
      [dim(0, 0, 1, 1), [true, 11, 105, 34, 150]],
      [dim(2, 0, 0, 1), [false, 10, 594, 34, 638]],
      [dim(0, 2, 0, 1), [true, 11, 280, 34, 325]],
      [dim(0, 0, 2, 1), [true, 11, 210, 34, 255]],
      [dim(1, 1, 1, 1), [true, 11, 542, 34, 587]],
      [dim(1, 1, 1, 2), [true, 11, 542, 68, 621]],
    ].forEach(([dimensions, expectedSizes]) => {
      dimensions = dimensions as IDimensions;
      [
        dimensions.isSegwit(),
        dimensions.getOverheadVSize(),
        dimensions.getInputsVSize(),
        dimensions.getOutputsVSize(),
        dimensions.getVSize(),
      ].should.eql(expectedSizes);
    });
  });
});
