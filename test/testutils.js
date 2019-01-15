const utxo = require('../src');


/**
 * makeEnum('a', 'b') returns `{ a: 'a', b: 'b' }`
 *
 * @param args
 * @return map with string keys and symbol values
 */
const makeEnum = (...args) =>
  args.reduce((obj, key) => Object.assign(obj, { [key]: key }), {});


const UnspentTypeScript2of3 = makeEnum('p2sh', 'p2shP2wsh', 'p2wsh');
const UnspentTypePubKeyHash = makeEnum('p2pkh', 'p2wpkh');

class UnspentTypeOpReturn {
  constructor(size) {
    this.size = size;
  }
  toString() {
    return `opReturn(${this.size})`;
  }
}


/**
 * Return the input dimensions based on unspent type
 * @param unspentType - one of UnspentTypeScript2of3
 * @return Dimensions
 */
const getInputDimensionsForUnspentType = (unspentType) => {
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


const getOutputDimensionsForUnspentType = (unspentType) => {
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


module.exports = {
  UnspentTypeScript2of3,
  UnspentTypePubKeyHash,
  UnspentTypeOpReturn,
  getInputDimensionsForUnspentType,
  getOutputDimensionsForUnspentType,
};
