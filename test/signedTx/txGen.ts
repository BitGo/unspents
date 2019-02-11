import 'lodash.combinations';
import _ from 'lodash';

// @ts-ignore
import * as bitcoin from 'bitgo-utxo-lib';

// @ts-ignore
import * as HDKey from 'hdkey';

import {
  TestUnspentType,
  UnspentTypeOpReturn,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from '../testutils';
import {IDimensions} from "../../src/dimensions";

/**
 * Return a 2-of-3 multisig output
 * @param keys - the key array for multisig
 * @param unspentType - one of UnspentTypeScript2of3
 * @returns {{redeemScript, witnessScript, address}}
 */
const createOutputScript2of3 = (keys: any[], unspentType: TestUnspentType) => {
  const pubkeys = keys.map(({ publicKey }) => publicKey);
  const script2of3 = bitcoin.script.multisig.output.encode(2, pubkeys);
  const p2wshOutputScript = bitcoin.script.witnessScriptHash.output.encode(
    bitcoin.crypto.sha256(script2of3),
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
const createScriptPubKey = (keys: any[], unspentType: TestUnspentType) => {
  if (unspentType in UnspentTypeScript2of3) {
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
    const payload = new Buffer(unspentType.size).fill(keys[0]);
    return bitcoin.script.nullData.output.encode(payload);
  }

  throw new Error(`unsupported output type ${unspentType}`);
};

const createInputTx = (unspents: any[], inputValue: number) => {
  const txInputBuilder = new bitcoin.TransactionBuilder();
  txInputBuilder.addInput(Array(32).fill('01').join(''), 0);
  unspents.forEach(({ scriptPubKey }) => txInputBuilder.addOutput(scriptPubKey, inputValue));
  return txInputBuilder.buildIncomplete();
};

class TxCombo {
  public unspents: any[];
  public inputTx: any;

  constructor(
    public keys: any[],
    public inputTypes: TestUnspentType[],
    public outputTypes: TestUnspentType[],
    public expectedDims: IDimensions,
    public inputValue: number = 10
  ) {
    this.unspents = inputTypes.map((inputType) => createOutputScript2of3(keys, inputType));
    this.inputTx = createInputTx(this.unspents, inputValue);
  }

  public getBuilderWithUnsignedTx() {
    const txBuilder = new bitcoin.TransactionBuilder();
    this.inputTx.outs.forEach(({}, i: number) => txBuilder.addInput(this.inputTx, i));
    this.outputTypes.forEach(
      (unspentType) => txBuilder.addOutput(createScriptPubKey(this.keys, unspentType), this.inputValue),
    );
    return txBuilder;
  }

  public getUnsignedTx() {
    return this.getBuilderWithUnsignedTx().tx;
  }

  public getSignedTx() {
    const txBuilder = this.getBuilderWithUnsignedTx();
    this.unspents.forEach(({ redeemScript, witnessScript }, i) =>
      this.keys.slice(0, 2).forEach((key) =>
        txBuilder.sign(
          i,
          key,
          redeemScript,
          undefined /* hashType */,
          this.inputValue /* needed for segwit signatures */,
          witnessScript,
        ),
      ),
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
  }: {
    inputTypes: TestUnspentType[],
    maxNInputs: number,
    outputTypes: TestUnspentType[],
    maxNOutputs: number
  },
  callback: (inputCombo: TestUnspentType[], outputCombo: TestUnspentType[]) => void,
) => {
  // Create combinations of different input and output types. Length between 1 and 3.
  const inputCombinations = _.flatten(
    // @ts-ignore
    [...Array(maxNInputs)].map((__, i) => _.combinations(inputTypes, i + 1)),
  );
  const outputCombinations = _.flatten(
    // @ts-ignore
    [...Array(maxNOutputs)].map((__, i) => _.combinations(outputTypes, i + 1)),
  );

  inputCombinations.forEach((inputTypeCombo) =>
    outputCombinations.forEach((outputTypeCombo) => {
      callback(inputTypeCombo, outputTypeCombo);
    }),
  );
};

class Histogram {
  public total: number = 0;

  constructor(
    public map: Map<number, number> = new Map(),
  ) { }

  public add(size: number) {
    this.map.set(size, (this.map.get(size) || 0) + 1);
    this.total++;
  }

  public asSortedArray() {
    return [...this.map.entries()].sort(([a], [b]) => a - b);
  }

  public asFullSortedArray() {
    return _.range(
      this.getPercentile(0),
      this.getPercentile(1),
    ).map((v) => [v, this.map.get(v) || 0]);
  }

  public getPercentile(p: number) {
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

  public toString() {
    const keys = [...this.map.keys()].sort((a, b) => a - b);
    return `[${keys.map((k) => `[${k}, ${this.map.get(k)}]`).join(' ')}]`;
  }
}

const getKeyTriplets = (prefix: string, count: number) => [...Array(count)].map(
  (_, i) => [1, 2, 3].map(
    (j) => HDKey.fromMasterSeed(Buffer.from(`${prefix}/${i}/${j}`))
  ),
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
  }: {
    inputTypes: Array<{ inputType: TestUnspentType, count: number}>,
    nInputKeyTriplets: number,
    outputTypes: TestUnspentType[],
    nOutputKeyTriplets: number,
  },
  callback: (
    inputType: TestUnspentType,
    inputCount: number,
    outputType: TestUnspentType,
    txs: any,
  ) => void,
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
        forEach(cb: (txBuilder: any) => void) {
          inputTxs.forEach(({ inputKeys, unspents, inputTx }) => {
            const txBuilder = new bitcoin.TransactionBuilder(undefined, Infinity);
            inputTx.outs.forEach((_: never, i: number) => txBuilder.addInput(inputTx, i));

            outputs.forEach((scriptPubKey) => {
              txBuilder.tx.outs = [];
              txBuilder.inputs.forEach((i: any) => {
                delete i.signatures;
              });
              txBuilder.addOutput(scriptPubKey, outputValue);
              unspents.forEach(({ redeemScript, witnessScript }, i) => {
                inputKeys.slice(0, 2).forEach((key) => txBuilder.sign(
                  i,
                  key,
                  redeemScript,
                  undefined, /* hashType */
                  outputValue,
                  witnessScript,
                ));
              });

              cb(txBuilder.build());
            });
          });
        },
      };

      callback(inputType, inputCount, outputType, txs);
    });
  });
};

export {
  TxCombo,
  Histogram,
  runCombinations,
  runSignedTransactions,
};
