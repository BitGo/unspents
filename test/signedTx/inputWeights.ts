import * as bitcoin from '@bitgo/utxo-lib';
import * as assert from 'assert';
import * as bip32 from 'bip32';
import {
  getInputWeight,
  getInputComponentsWeight,
  InputComponents,
  inputComponentsP2sh,
  inputComponentsP2shP2pk,
  inputComponentsP2shP2wsh,
  inputComponentsP2wsh,
} from '../../src/inputWeights';
import { pushdataEncodingLength } from '../../src/scriptSizes';
import { UnspentTypeP2shP2pk, UnspentTypeScript2of3 } from '../testutils';
import { TxCombo } from './txGen';

describe('Input Script Sizes (Worst-Case)', function () {
  const keys = [1, 2, 3].map((v) => bip32.fromSeed(Buffer.alloc(16, `test/${v}`)));

  function getLargestInputWithType(inputType: string, inputCount = 100): bitcoin.TxInput {
    return new TxCombo(keys, Array.from({ length: inputCount }).fill(inputType) as string[], [
      UnspentTypeScript2of3.p2sh,
    ])
      .getSignedTx()
      .ins.reduce((a, b) => (getInputWeight(a) > getInputWeight(b) ? a : b));
  }

  function getInputComponents(input: bitcoin.TxInput): InputComponents {
    const decompiled = bitcoin.script.decompile(input.script);
    if (!decompiled) {
      throw new Error();
    }

    const script = decompiled.map((v) => {
      if (!Buffer.isBuffer(v)) {
        return { length: 1 };
      }
      return { length: v.length + pushdataEncodingLength(v.length) };
    });
    const witness = (input.witness || []).map((v) => ({ length: v.length }));

    const scriptSize = script.reduce((a, b) => a + b.length, 0);
    assert.strictEqual(scriptSize, input.script.length, bitcoin.script.toASM(decompiled));

    return {
      script: script.map((v) => v.length),
      witness: witness.map((v) => v.length),
    };
  }

  [...Object.keys(UnspentTypeScript2of3), UnspentTypeP2shP2pk].forEach((inputType: string) => {
    describe(`inputType=${inputType}`, function () {
      if (inputType === 'p2tr') {
        return;
      }

      it(`component sizes`, function () {
        let expectedComponents;
        switch (inputType) {
          case 'p2sh':
            expectedComponents = inputComponentsP2sh;
            break;
          case 'p2shP2wsh':
            expectedComponents = inputComponentsP2shP2wsh;
            break;
          case 'p2wsh':
            expectedComponents = inputComponentsP2wsh;
            break;
          case 'p2shP2pk':
            expectedComponents = inputComponentsP2shP2pk;
            break;
          default:
            throw new Error(`invalid inputType ${inputType}`);
        }

        const input = getLargestInputWithType(inputType);
        const components = getInputComponents(input);
        assert.deepStrictEqual(components, expectedComponents);
        assert.strictEqual(getInputComponentsWeight(components), getInputWeight(input));
      });
    });
  });
});
