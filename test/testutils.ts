import * as utxo from '../src';

/**
 * makeEnum('a', 'b') returns `{ a: 'a', b: 'b' }`
 *
 * @param args
 * @return map with string keys and symbol values
 */
const makeEnum = (...args: string[]): any =>
  args.reduce((obj, key) => Object.assign(obj, { [key]: key }), {});

const UnspentTypeScript2of3: {
  p2sh: string;
  p2shP2wsh: string;
  p2wsh: string;
} = makeEnum('p2sh', 'p2shP2wsh', 'p2wsh');

const UnspentTypePubKeyHash: {
  p2pkh: string;
  p2wpkh: string;
} = makeEnum('p2pkh', 'p2wpkh');

export type TestUnspentType = string | UnspentTypeOpReturn;

class UnspentTypeOpReturn {
  constructor(public size: number) { }

  public toString() {
    return `opReturn(${this.size})`;
  }
}

/**
 * Return the input dimensions based on unspent type
 * @param unspentType - one of UnspentTypeScript2of3
 * @return Dimensions
 */
const getInputDimensionsForUnspentType = (unspentType: TestUnspentType) => {
  switch (unspentType) {
    case UnspentTypeScript2of3.p2sh:
      return utxo.Dimensions.sum({ nP2shInputs: 1 });
    case UnspentTypeScript2of3.p2shP2wsh:
      return utxo.Dimensions.sum({ nP2shP2wshInputs: 1 });
    case UnspentTypeScript2of3.p2wsh:
      return utxo.Dimensions.sum({ nP2wshInputs: 1 });
  }
  throw new Error(`no input dimensions for ${unspentType}`);
};

const getOutputDimensionsForUnspentType = (unspentType: TestUnspentType) => {
  /* The values here are validated in the test 'calculates output dimensions dynamically' */
  switch (unspentType) {
    case UnspentTypeScript2of3.p2sh:
    case UnspentTypeScript2of3.p2shP2wsh:
      return utxo.Dimensions.fromOutputScriptLength(23);
    case UnspentTypeScript2of3.p2wsh:
      return utxo.Dimensions.fromOutputScriptLength(34);
    case UnspentTypePubKeyHash.p2pkh:
      return utxo.Dimensions.fromOutputScriptLength(25);
    case UnspentTypePubKeyHash.p2wpkh:
      return utxo.Dimensions.fromOutputScriptLength(22);
    default:
      if (unspentType instanceof UnspentTypeOpReturn) {
        return utxo.Dimensions.fromOutputScriptLength(1 + unspentType.size);
      }
      throw new TypeError(`unknown unspentType ${unspentType}`);
  }
};

export {
  UnspentTypeScript2of3,
  UnspentTypePubKeyHash,
  UnspentTypeOpReturn,
  getInputDimensionsForUnspentType,
  getOutputDimensionsForUnspentType,
};
