import 'should';

import * as utxo from '../../src';

import {
  TestUnspentType,
  UnspentTypeOpReturn,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from '../testutils';

import {
  Histogram,
  runSignedTransactions,
} from './txGen';

describe(`Dimension estimation errors`, function() {
  interface IInputTypeAndCount { inputType: TestUnspentType; count: number; }

  const inputTypes: IInputTypeAndCount[] = Object.keys(UnspentTypeScript2of3)
    .reduce((all: IInputTypeAndCount[], inputType) => [
      ...all,
      { inputType, count: 1 },
      { inputType, count: 2 },
      { inputType, count: 4 },
    ], []);

  const outputTypes = [
    ...Object.keys(UnspentTypeScript2of3),
    ...Object.keys(UnspentTypePubKeyHash),
    new UnspentTypeOpReturn(16),
    new UnspentTypeOpReturn(32),
  ];

  // set to `true` if we want the test to fail if the error is *smaller* than expected
  const strictErrorBounds = false;

  const getExpectedInputErrors = (inputType: any, inputCount: any, outputType: any) => {
    switch (inputType) {
      case UnspentTypeScript2of3.p2sh:
        return [0, 5 * inputCount];
      case UnspentTypeScript2of3.p2shP2wsh:
        return [0, inputCount];
      case UnspentTypeScript2of3.p2wsh:
        return [0, inputCount];
      default:
        throw new Error('illegal inputType ' + inputType);
    }
  };

  const params = {
    inputTypes,
    nInputKeyTriplets: 2,
    outputTypes,
    nOutputKeyTriplets: 128,
  };

  runSignedTransactions(params, (
    inputType: TestUnspentType,
    inputCount: number,
    outputType: TestUnspentType,
    signedTxs: any[]
  ) => {
    const title =
      `should have correct vsize error bounds ${getExpectedInputErrors(inputType, inputCount, outputType)}` +
      ` for input=${inputType}-${inputCount} and output=${outputType}`;

    it(title, function() {
      this.timeout(5000);
      const inputVSizeErrors = new Histogram();
      signedTxs.forEach((tx) => {
        const dims = utxo.Dimensions.fromTransaction(tx);

        const totalVSize = tx.virtualSize();
        const outputsVSize = totalVSize - Object.assign(tx.clone(), { outs: [] }).virtualSize();
        const outputVSizeError = (dims.getOutputsVSize() - outputsVSize);
        outputVSizeError.should.eql(0);

        const overheadPlusInputsVSize = totalVSize - outputsVSize;
        const inputVSizeError = (dims.getOverheadVSize() + dims.getInputsVSize()) - overheadPlusInputsVSize;
        inputVSizeErrors.add(inputVSizeError);
      });

      console.log(`inputType=${inputType} outputType=${outputType}\n`);
      console.log(`inputVSizeErrors`, inputVSizeErrors, '\n');

      const [low, high] = getExpectedInputErrors(inputType, inputCount, outputType);
      inputVSizeErrors.getPercentile(0.01).should.be.greaterThanOrEqual(low);
      inputVSizeErrors.getPercentile(0.99).should.be.belowOrEqual(high);
      if (strictErrorBounds) {
        [
          inputVSizeErrors.getPercentile(0.01),
          inputVSizeErrors.getPercentile(0.99),
        ].should.eql([low, high]);
      }
    });
  });
});
