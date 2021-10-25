import 'should';

import { Dimensions } from '../../src';

import {
  TestUnspentType,
  UnspentTypeOpReturn,
  UnspentTypeP2shP2pk,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from '../testutils';

import { Histogram, runSignedTransactions } from './txGen';

describe(`Dimension estimation errors`, function () {
  interface IInputTypeAndCount {
    inputType: string;
    count: number;
  }

  const inputTypes: IInputTypeAndCount[] = [...Object.keys(UnspentTypeScript2of3), UnspentTypeP2shP2pk]
    .filter((scriptType) => scriptType !== 'p2tr') // TODO: remove when p2tr signing is supported
    .reduce(
      (all: IInputTypeAndCount[], inputType) => [
        ...all,
        { inputType, count: 1 },
        { inputType, count: 2 },
        { inputType, count: 4 },
      ],
      []
    );

  const outputTypes = [
    ...Object.keys(UnspentTypeScript2of3),
    ...Object.keys(UnspentTypePubKeyHash),
    new UnspentTypeOpReturn(16),
    new UnspentTypeOpReturn(32),
  ];

  // set to `true` if we want the test to fail if the error is *smaller* than expected
  const strictErrorBounds = false;

  const getExpectedInputErrors = (inputType: string, inputCount: number): [low: number, high: number] => {
    switch (inputType) {
      case UnspentTypeScript2of3.p2sh:
        return [0, 5 * inputCount];
      case UnspentTypeScript2of3.p2shP2wsh:
      case UnspentTypeScript2of3.p2wsh:
      case UnspentTypeScript2of3.p2tr:
        return [0, inputCount];
      case UnspentTypeP2shP2pk:
        return [0, 3 * inputCount];
      default:
        throw new Error('illegal inputType ' + inputType);
    }
  };

  const params = {
    inputTypes,
    nInputKeyTriplets: 2,
    outputTypes,
    nOutputKeyTriplets: 32,
  };

  runSignedTransactions(
    params,
    (inputType: string, inputCount: number, outputType: TestUnspentType, signedTxs: any[]) => {
      const title =
        `should have correct vsize error bounds ${getExpectedInputErrors(inputType, inputCount)}` +
        ` for input=${inputType}-${inputCount} and output=${outputType}`;

      it(title, function () {
        this.timeout(5000);
        const inputVSizeErrors = new Histogram();
        signedTxs.forEach((tx) => {
          const dims = Dimensions.fromTransaction(tx);

          const totalVSize = tx.virtualSize();
          const outputsVSize = totalVSize - Object.assign(tx.clone(), { outs: [] }).virtualSize();
          const outputVSizeError = dims.getOutputsVSize() - outputsVSize;
          outputVSizeError.should.eql(0);

          const overheadPlusInputsVSize = totalVSize - outputsVSize;
          const inputVSizeError = dims.getOverheadVSize() + dims.getInputsVSize() - overheadPlusInputsVSize;
          inputVSizeErrors.add(inputVSizeError);
        });

        console.log(`inputType=${inputType} outputType=${outputType}\n`);
        console.log(`inputVSizeErrors`, inputVSizeErrors, '\n');

        const [low, high] = getExpectedInputErrors(inputType, inputCount);
        inputVSizeErrors.getPercentile(0.01).should.be.greaterThanOrEqual(low);
        inputVSizeErrors.getPercentile(0.99).should.be.belowOrEqual(high);
        if (strictErrorBounds) {
          [inputVSizeErrors.getPercentile(0.01), inputVSizeErrors.getPercentile(0.99)].should.eql([low, high]);
        }
      });
    }
  );
});
