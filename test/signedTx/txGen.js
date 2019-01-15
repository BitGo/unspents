const _ = require('lodash');
require('lodash.combinations');

const bitcoin = require('bitgo-utxo-lib');

const HDKey = require('hdkey');

const {
  UnspentTypeScript2of3,
  UnspentTypePubKeyHash,
  UnspentTypeOpReturn,
} = require('../testutils');

/**
 * Return a 2-of-3 multisig output
 * @param keys - the key array for multisig
 * @param unspentType - one of UnspentTypeScript2of3
 * @returns {{redeemScript, witnessScript, address}}
 */
const createOutputScript2of3 = (keys, unspentType) => {
  const pubkeys = keys.map(({ publicKey }) => publicKey);
  const script2of3 = bitcoin.script.multisig.output.encode(2, pubkeys);
  const p2wshOutputScript = bitcoin.script.witnessScriptHash.output.encode(
    bitcoin.crypto.sha256(script2of3)
  );
  let redeemScript, witnessScript;
  switch (unspentType) {
    case UnspentTypeScript2of3.p2sh:
      redeemScript = script2of3;
      break;
    case UnspentTypeScript2of3.p2shP2wsh:
      witnessScript = script2of3;
      redeemScript = p2wshOutputScript;
      break;
    case UnspentTypeScript2of3.p2wsh:
      witnessScript = script2of3;
      break;
    default:
      throw new Error(`unknown multisig output type ${unspentType}`);
  }

  let scriptPubKey;
  if (unspentType === UnspentTypeScript2of3.p2wsh) {
    scriptPubKey = p2wshOutputScript;
  } else {
    const redeemScriptHash = bitcoin.crypto.hash160(redeemScript);
    scriptPubKey = bitcoin.script.scriptHash.output.encode(redeemScriptHash);
  }

  return { redeemScript, witnessScript, scriptPubKey };
};


/**
 *
 * @param keys - Pubkeys to use for generating the address.
 *               If unspentType is one of UnspentTypePubKeyHash is used, the first key will be used.
 * @param unspentType {String} - one of UnspentTypeScript2of3 or UnspentTypePubKeyHash
 * @return {String} address
 */
const createScriptPubKey = (keys, unspentType) => {
  if (UnspentTypeScript2of3[unspentType]) {
    return createOutputScript2of3(keys, unspentType).scriptPubKey;
  }

  const key = keys[0];
  const pkHash = bitcoin.crypto.hash160(key.publicKey);
  switch (unspentType) {
    case UnspentTypePubKeyHash.p2pkh:
      return bitcoin.script.pubKeyHash.output.encode(pkHash);
    case UnspentTypePubKeyHash.p2wpkh:
      return bitcoin.script.witnessPubKeyHash.output.encode(pkHash);
  }

  if (unspentType instanceof UnspentTypeOpReturn) {
    const payload = Buffer(unspentType.size).fill(keys[0]);
    return bitcoin.script.nullData.output.encode(payload);
  }

  throw new Error(`unsupported output type ${unspentType}`);
};


const createInputTx = (unspents, inputValue) => {
  const txInputBuilder = new bitcoin.TransactionBuilder();
  txInputBuilder.addInput(Array(32).fill('01').join(''), 0);
  unspents.forEach(({ scriptPubKey }) => txInputBuilder.addOutput(scriptPubKey, inputValue));
  return txInputBuilder.buildIncomplete();
};


class TxCombo {
  constructor(keys, inputTypes, outputTypes, expectedDims, inputValue = 10) {
    this.keys = keys;
    this.inputTypes = inputTypes;
    this.outputTypes = outputTypes;
    this.unspents = inputTypes.map((inputType) => createOutputScript2of3(keys, inputType));
    this.inputTx = createInputTx(this.unspents, inputValue);
    this.expectedDims = expectedDims;
    this.inputValue = inputValue;
  }

  getBuilderWithUnsignedTx() {
    const txBuilder = new bitcoin.TransactionBuilder();
    this.inputTx.outs.forEach(({}, i) => txBuilder.addInput(this.inputTx, i));
    this.outputTypes.forEach(
      unspentType => txBuilder.addOutput(createScriptPubKey(this.keys, unspentType), this.inputValue)
    );
    return txBuilder;
  }

  getUnsignedTx() {
    return this.getBuilderWithUnsignedTx().tx;
  }

  getSignedTx() {
    const txBuilder = this.getBuilderWithUnsignedTx();
    this.unspents.forEach(({ redeemScript, witnessScript }, i) =>
      this.keys.slice(0, 2).forEach((key) =>
        txBuilder.sign(
          i,
          key,
          redeemScript,
          undefined /* hashType */,
          this.inputValue /* needed for segwit signatures */,
          witnessScript
        )
      )
    );
    return txBuilder.build();
  }
}

const runCombinations = (
  {
    inputTypes,
    maxNInputs,
    outputTypes,
    maxNOutputs,
  },
  callback
) => {
  // Create combinations of different input and output types. Length between 1 and 3.
  const inputCombinations = _.flatten(
    [...Array(maxNInputs)].map((__, i) => _.combinations(inputTypes, i + 1))
  );
  const outputCombinations = _.flatten(
    [...Array(maxNOutputs)].map((__, i) => _.combinations(outputTypes, i + 1))
  );

  inputCombinations.forEach(inputTypeCombo =>
    outputCombinations.forEach(outputTypeCombo => {
      callback(inputTypeCombo, outputTypeCombo);
    })
  );
};


class Histogram {
  constructor() {
    this.map = new Map();
    this.total = 0;
  }

  add(size) {
    this.map.set(size, (this.map.get(size) || 0) + 1);
    this.total++;
  }

  asSortedArray() {
    return [...this.map.entries()].sort(([a], [b]) => a - b);
  }

  asFullSortedArray() {
    return _.range(
      this.getPercentile(0),
      this.getPercentile(1)
    ).map((v) => [v, this.map.get(v) || 0]);
  }

  getPercentile(p) {
    if (0 > p || p > 1) {
      throw new Error(`p must be between 0 and 1`);
    }

    let sum = 0;
    for (const [k, v] of this.asSortedArray()) {
      sum += v;
      if ((sum / this.total) >= p) {
        return k;
      }
    }

    throw new Error('could not find percentile');
  }

  toString() {
    const keys = [...this.map.keys()].sort((a, b) => a - b);
    return `[${keys.map((k) => `[${k}, ${this.map.get(k)}]`).join(' ')}]`;
  }
}


const getKeyTriplets = (prefix, count) => [...Array(count)].map(
  (_, i) => [1, 2, 3].map((j) => HDKey.fromMasterSeed(Buffer.from(`${prefix}/${i}/${j}`)))
);

/**
 *
 * Calls `callback` with a variety of signed txs, based on input parameters
 * Callback arguments are
 *   inputType, inputCount, outputType, txs
 *  where `txs` implements `forEach()`
 *
 * @param inputTypes - input types to test
 * @param nInputKeyTriplets - number of different input key triples to cycle through
 * @param outputTypes - output types to test
 * @param nOutputKeyTriplets - number of different output key triplets to cycle through
 * @param callback
 */
const runSignedTransactions = (
  {
    inputTypes,
    nInputKeyTriplets,
    outputTypes,
    nOutputKeyTriplets,
  },
  callback
) => {
  const inputKeyTriplets = getKeyTriplets('test/input/', nInputKeyTriplets);
  const outputKeyTriplets = getKeyTriplets('test/output/', nOutputKeyTriplets);
  const outputValue = 1e8;

  inputTypes.forEach(({ inputType, count: inputCount }) => {
    const inputTxs = inputKeyTriplets
      .map((inputKeys) => {
        const unspents = [...Array(inputCount)].map(() => createOutputScript2of3(inputKeys, inputType));
        const inputTx = createInputTx(unspents, outputValue);
        return { inputKeys, unspents, inputTx };
      });

    outputTypes.forEach((outputType) => {
      const outputs = outputKeyTriplets.map((outputKeys) => createScriptPubKey(outputKeys, outputType));

      const txs = {
        forEach(callback) {
          inputTxs.forEach(({ inputKeys, unspents, inputTx }) => {
            const txBuilder = new bitcoin.TransactionBuilder(undefined, Infinity);
            inputTx.outs.forEach((_, i) => txBuilder.addInput(inputTx, i));

            outputs.forEach((scriptPubKey) => {
              txBuilder.tx.outs = [];
              txBuilder.inputs.forEach((i) => {
                delete i.signatures;
              });
              txBuilder.addOutput(scriptPubKey, outputValue);
              unspents.forEach(({ redeemScript, witnessScript }, i) => {
                inputKeys.slice(0, 2).forEach(key => txBuilder.sign(
                  i,
                  key,
                  redeemScript,
                  undefined, /* hashType */
                  outputValue,
                  witnessScript
                ));
              });

              callback(txBuilder.build());
            });
          });
        }
      };

      callback(inputType, inputCount, outputType, txs);
    });
  });
};


module.exports = {
  TxCombo,
  Histogram,
  runCombinations,
  runSignedTransactions
};
