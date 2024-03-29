/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as should from 'should';

import { Codes, Dimensions, IDimensions, IOutputDimensions, OutputDimensions, VirtualSizes } from '../src';

import { getOutputDimensionsForUnspentType, UnspentTypePubKeyHash, UnspentTypeScript2of3 } from './testutils';

describe('VirtualSizes', function () {
  it('have expected values', function () {
    VirtualSizes.should.match({
      // check computed values only
      txP2shInputSize: 298,
      txP2shP2wshInputSize: 140,
      txP2wshInputSize: 105,
      txP2trKeypathInputSize: 58,
      txP2trScriptPathLevel1InputSize: 108,
      txP2trScriptPathLevel2InputSize: 116,
      txP2shP2pkInputSize: 151,
    });
  });
});

describe('Dimensions Attributes', function () {
  it('has read-only nInputs and nOutputs', function () {
    should.throws(() => (Dimensions.zero().nInputs = 1), /read-only/);
    should.throws(() => (Dimensions.zero().nOutputs = 1), /read-only/);
  });
});

describe('Output Dimensions', function () {
  it('instantiates', function () {
    const dims: IOutputDimensions = OutputDimensions({ size: 0, count: 0 });
    should.throws(() => (dims.count += 1));
  });
});

describe('Dimensions Arithmetic', function () {
  it('sums correctly', function () {
    Dimensions.zero()
      .plus({ nP2shInputs: 1 })
      .should.eql(
        Dimensions({
          nP2shInputs: 1,
          nP2shP2wshInputs: 0,
          nP2wshInputs: 0,
          nP2trKeypathInputs: 0,
          nP2trScriptPathLevel1Inputs: 0,
          nP2trScriptPathLevel2Inputs: 0,
          nP2shP2pkInputs: 0,
          outputs: { size: 0, count: 0 },
        })
      );

    const components = [
      { nP2shInputs: 1 },
      { nP2shP2wshInputs: 2 },
      { nP2wshInputs: 3 },
      { nP2trKeypathInputs: 4 },
      { nP2trScriptPathLevel1Inputs: 5 },
      { nP2trScriptPathLevel2Inputs: 6 },
      { outputs: { size: 23, count: 1 } },
      { outputs: { size: 44, count: 2 } },
      { outputs: { size: 0, count: 0 } },
    ];

    components.forEach((component) => should.doesNotThrow(() => Dimensions.sum(component)));

    const sum = components.reduce((a, b) => a.plus(b), Dimensions.zero());

    sum.should.eql(Dimensions.sum(...components));

    sum.should.eql(
      Dimensions({
        nP2shInputs: 1,
        nP2shP2wshInputs: 2,
        nP2wshInputs: 3,
        nP2trKeypathInputs: 4,
        nP2trScriptPathLevel1Inputs: 5,
        nP2trScriptPathLevel2Inputs: 6,
        nP2shP2pkInputs: 0,
        outputs: { size: 67, count: 3 },
      })
    );

    sum.nOutputs.should.eql(sum.outputs.count);
  });

  it('provides some typical output sizes', function () {
    (
      [
        [Dimensions.SingleOutput.p2sh, VirtualSizes.txP2shOutputSize],
        [Dimensions.SingleOutput.p2shP2wsh, VirtualSizes.txP2shP2wshOutputSize],
        [Dimensions.SingleOutput.p2wsh, VirtualSizes.txP2wshOutputSize],
        [Dimensions.SingleOutput.p2pkh, VirtualSizes.txP2pkhOutputSize],
        [Dimensions.SingleOutput.p2wpkh, VirtualSizes.txP2wpkhOutputSize],
      ] as Array<[IDimensions, number]>
    ).forEach(([dims, size]) => {
      dims.getOutputsVSize().should.eql(size);
    });
  });

  it('prevents sum of invalid data', function () {
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

  it('multiplies correctly', function () {
    const d = Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      nP2trKeypathInputs: 4,
      nP2trScriptPathLevel1Inputs: 5,
      nP2trScriptPathLevel2Inputs: 6,
      nP2shP2pkInputs: 7,
      outputs: { count: 1, size: 22 },
    }).times(3);

    d.should.eql(
      Dimensions({
        nP2shInputs: 3,
        nP2shP2wshInputs: 6,
        nP2wshInputs: 9,
        nP2trKeypathInputs: 12,
        nP2trScriptPathLevel1Inputs: 15,
        nP2trScriptPathLevel2Inputs: 18,
        nP2shP2pkInputs: 21,
        outputs: { count: 3, size: 66 },
      })
    );

    d.getNInputs().should.eql(63);
    d.nInputs.should.eql(63);
  });
});

describe('Dimensions from unspent types', function () {
  it('determines unspent size according to chain', function () {
    Codes.p2sh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain }).should.eql(Dimensions.sum({ nP2shInputs: 1 }))
    );

    Codes.p2shP2wsh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain }).should.eql(Dimensions.sum({ nP2shP2wshInputs: 1 }))
    );

    Codes.p2wsh.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain }).should.eql(Dimensions.sum({ nP2wshInputs: 1 }))
    );

    Codes.p2tr.values.forEach((chain) =>
      Dimensions.fromUnspent({ chain }).should.eql(Dimensions.sum({ nP2trScriptPathLevel1Inputs: 1 }))
    );

    Dimensions.fromUnspents([
      { chain: Codes.p2sh.internal },
      { chain: Codes.p2sh.external },
      { chain: Codes.p2shP2wsh.internal },
      { chain: Codes.p2shP2wsh.external },
      { chain: Codes.p2wsh.internal },
      { chain: Codes.p2wsh.external },
      { chain: Codes.p2tr.internal },
      { chain: Codes.p2tr.external },
    ]).should.eql(
      Dimensions({
        nP2shP2wshInputs: 2,
        nP2shInputs: 2,
        nP2wshInputs: 2,
        nP2trKeypathInputs: 0,
        nP2trScriptPathLevel1Inputs: 2,
        nP2trScriptPathLevel2Inputs: 0,
        nP2shP2pkInputs: 0,
        outputs: { count: 0, size: 0 },
      })
    );
  });

  it('calculates output dimensions dynamically', function () {
    const expectedSizes = new Map([
      [UnspentTypeScript2of3.p2sh, VirtualSizes.txP2shOutputSize],
      [UnspentTypeScript2of3.p2shP2wsh, VirtualSizes.txP2shP2wshOutputSize],
      [UnspentTypeScript2of3.p2wsh, VirtualSizes.txP2wshOutputSize],
      [UnspentTypeScript2of3.p2tr, VirtualSizes.txP2trOutputSize],
      [UnspentTypePubKeyHash.p2pkh, VirtualSizes.txP2pkhOutputSize],
      [UnspentTypePubKeyHash.p2wpkh, VirtualSizes.txP2wpkhOutputSize],
    ]);

    [
      ...Object.keys(UnspentTypeScript2of3).filter((scriptType) => scriptType !== 'p2tr'), // TODO: remove when p2tr signing is supported,
      ...Object.keys(UnspentTypePubKeyHash),
    ].forEach((type) =>
      getOutputDimensionsForUnspentType(type).outputs.size.should.eql(expectedSizes.get(type as any))
    );
  });
});

describe('Dimensions estimates', function () {
  it('calculates vsizes', function () {
    function dim(nP2shInputs: number, nP2shP2wshInputs: number, nP2wshInputs: number, nOutputs: number): IDimensions {
      return Dimensions.sum(
        {
          nP2shInputs,
          nP2shP2wshInputs,
          nP2wshInputs,
        },
        getOutputDimensionsForUnspentType(UnspentTypePubKeyHash.p2pkh).times(nOutputs)
      );
    }

    function dimP2tr(
      nP2trKeypathInputs: number,
      nP2trScriptPathLevel1Inputs: number,
      nP2trScriptPathLevel2Inputs: number,
      nOutputs: number
    ): IDimensions {
      return Dimensions.sum(
        {
          nP2trKeypathInputs,
          nP2trScriptPathLevel1Inputs,
          nP2trScriptPathLevel2Inputs,
        },
        getOutputDimensionsForUnspentType(UnspentTypePubKeyHash.p2pkh).times(nOutputs)
      );
    }

    [
      [dim(1, 0, 0, 1), [false, 10, 298, 34, 342]],
      [dim(0, 1, 0, 1), [true, 11, 140, 34, 185]],
      [dim(0, 0, 1, 1), [true, 11, 105, 34, 150]],
      [dim(2, 0, 0, 1), [false, 10, 596, 34, 640]],
      [dim(0, 2, 0, 1), [true, 11, 280, 34, 325]],
      [dim(0, 0, 2, 1), [true, 11, 210, 34, 255]],
      [dim(1, 1, 1, 1), [true, 11, 543, 34, 588]],
      [dim(1, 1, 1, 2), [true, 11, 543, 68, 622]],

      [dimP2tr(1, 0, 0, 1), [true, 11, 58, 34, 103]],
      [dimP2tr(0, 1, 0, 1), [true, 11, 108, 34, 153]],
      [dimP2tr(0, 0, 1, 1), [true, 11, 116, 34, 161]],
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
