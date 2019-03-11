import * as should from 'should';

import * as utxo from '../src';

import { IDimensions } from '../src/dimensions';
import {
  getOutputDimensionsForUnspentType,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from './testutils';

describe('Dimensions Attributes', function() {
  it('has read-only nInputs and nOutputs', function() {
    should.throws(() => utxo.Dimensions.zero().nInputs = 1, /read-only/);
    should.throws(() => utxo.Dimensions.zero().nOutputs = 1, /read-only/);
  });
});

describe('Dimensions Arithmetic', function() {
  it('sums correctly', function() {
    utxo.Dimensions.zero().plus({ nP2shInputs: 1 }).should.eql(utxo.Dimensions({
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

    components.forEach((component) => should.doesNotThrow(() => utxo.Dimensions.sum(component)));

    const sum = utxo.Dimensions.zero()
      .plus(components[0])
      .plus(components[1])
      .plus(components[2])
      .plus(components[3])
      .plus(components[4])
      .plus(components[5]);

    sum.should.eql(utxo.Dimensions.sum(...components));

    sum.should.eql(utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      outputs: { size: 67, count: 3 },
    }));

    sum.nOutputs.should.eql(sum.outputs.count);
  });

  it('prevents sum of invalid data', function() {
    should.doesNotThrow(() => utxo.Dimensions.sum({ outputs: { count: 0, size: 0 } }));
    should.doesNotThrow(() => utxo.Dimensions.sum({ outputs: { count: 1, size: 1 } }));
    should.throws(() => utxo.Dimensions.sum({ nOutputs: 1 }));
    should.throws(() => utxo.Dimensions.sum({ nOutputs: 1, outputs: { count: 2, size: 1 } }));
    // @ts-ignore
    should.throws(() => utxo.Dimensions.sum({ nP2shInputs: 1 }, { nP2shInputs: 'foo' }));
    should.throws(() => utxo.Dimensions.sum({ outputs: { count: 1, size: 0 } }));
    should.throws(() => utxo.Dimensions.sum({ outputs: { count: 0, size: 1 } }));
    should.throws(() => utxo.Dimensions.sum({ outputs: { count: 1, size: 1 } }, { outputs: { count: 1, size: 0 } }));
  });

  it('multiplies correctly', function() {
    utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      outputs: { count: 1, size: 22 },
    }).times(3).should.eql(
      utxo.Dimensions({
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
    utxo.chain.codes.p2sh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shInputs: 1 })),
    );

    utxo.chain.codes.p2shP2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: 1 })),
    );

    utxo.chain.codes.p2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2wshInputs: 1 })),
    );

    utxo.Dimensions.fromUnspents([
      { chain: utxo.chain.codes.p2sh.internal },
      { chain: utxo.chain.codes.p2sh.external },
      { chain: utxo.chain.codes.p2shP2wsh.internal },
      { chain: utxo.chain.codes.p2shP2wsh.external },
      { chain: utxo.chain.codes.p2wsh.internal },
      { chain: utxo.chain.codes.p2wsh.external },
    ]).should.eql(utxo.Dimensions({
      nP2shP2wshInputs: 2,
      nP2shInputs: 2,
      nP2wshInputs: 2,
      outputs: { count: 0, size: 0 },
    }));
  });

  it('calculates output dimensions dynamically', function() {
    const expectedSizes = new Map([
      [UnspentTypeScript2of3.p2sh, utxo.VirtualSizes.txP2shOutputSize],
      [UnspentTypeScript2of3.p2shP2wsh, utxo.VirtualSizes.txP2shP2wshOutputSize],
      [UnspentTypeScript2of3.p2wsh, utxo.VirtualSizes.txP2wshOutputSize],
      [UnspentTypePubKeyHash.p2pkh, utxo.VirtualSizes.txP2pkhOutputSize],
      [UnspentTypePubKeyHash.p2wpkh, utxo.VirtualSizes.txP2wpkhOutputSize],
    ]);

    [...Object.keys(UnspentTypeScript2of3), ...Object.keys(UnspentTypePubKeyHash)].forEach((type) =>
      getOutputDimensionsForUnspentType(type)
      .outputs.size.should.eql(expectedSizes.get(type)),
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
    ): IDimensions => utxo.Dimensions.sum(
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
