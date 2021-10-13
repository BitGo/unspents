import * as bitcoin from '@bitgo/utxo-lib';
import * as bip32 from 'bip32';
import _ from 'lodash';
import 'lodash.combinations';
import { IDimensions } from '../../src';
import {
  TestUnspentType,
  UnspentTypeOpReturn,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from '../testutils';

/**
 *
 * @param keys - Pubkeys to use for generating the address.
 *               If unspentType is one of UnspentTypePubKeyHash is used, the first key will be used.
 * @param unspentType {String} - one of UnspentTypeScript2of3 or UnspentTypePubKeyHash
 * @return {String} address
 */
const createScriptPubKey = (keys: bip32.BIP32Interface[], unspentType: TestUnspentType) => {
  const pubkeys = keys.map((key) => key.publicKey);
  if (typeof unspentType === 'string' && unspentType in UnspentTypeScript2of3) {
    return bitcoin.bitgo.outputScripts.createOutputScript2of3(pubkeys, unspentType as any).scriptPubKey;
  }

  const pkHash = bitcoin.crypto.hash160(pubkeys[0]);
  switch (unspentType) {
    case UnspentTypePubKeyHash.p2pkh:
      return bitcoin.payments.p2pkh({ hash: pkHash }).output!;
    case UnspentTypePubKeyHash.p2wpkh:
      return bitcoin.payments.p2wpkh({ hash: pkHash }).output!;
  }

  if (unspentType instanceof UnspentTypeOpReturn) {
    const payload = Buffer.alloc(unspentType.size).fill(pubkeys[0]);
    return bitcoin.script.compile([0x6a, payload]);
  }

  throw new Error(`unsupported output type ${unspentType}`);
};

const createInputTx = (unspents: any[], inputValue: number) => {
  const txInputBuilder = new bitcoin.TransactionBuilder(bitcoin.networks.bitcoin);
  txInputBuilder.addInput(Array(32).fill('01').join(''), 0);
  unspents.forEach(({ scriptPubKey }) => txInputBuilder.addOutput(scriptPubKey, inputValue));
  return txInputBuilder.buildIncomplete();
};

class TxCombo {
  public unspents: any[];
  public inputTx: any;

  constructor(
    public keys: bip32.BIP32Interface[],
    public inputTypes: TestUnspentType[],
    public outputTypes: TestUnspentType[],
    public expectedDims: IDimensions,
    public inputValue: number = 10,
  ) {
    this.unspents = inputTypes.map((inputType) => bitcoin.bitgo.outputScripts.createOutputScript2of3(
      keys.map((key) => key.publicKey),
      inputType as any,
    ));
    this.inputTx = createInputTx(this.unspents, inputValue);
  }

  public getBuilderWithUnsignedTx() {
    const txBuilder = new bitcoin.TransactionBuilder(bitcoin.networks.bitcoin);
    this.inputTx.outs.forEach(({}, i: number) => txBuilder.addInput(this.inputTx, i));
    this.outputTypes.forEach(
      (unspentType) => txBuilder.addOutput(createScriptPubKey(this.keys, unspentType), this.inputValue),
    );
    return txBuilder;
  }

  public getUnsignedTx() {
    return this.getBuilderWithUnsignedTx().buildIncomplete();
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
    maxNOutputs: number,
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
  (v, i) => [1, 2, 3].map(
    (j) => bip32.fromSeed(Buffer.alloc(16, `${prefix}/${i}/${j}`), bitcoin.networks.bitcoin),
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
        const unspents = [...Array(inputCount)].map(() => bitcoin.bitgo.outputScripts.createOutputScript2of3(
          inputKeys.map((key) => key.publicKey),
          inputType as any,
        ));
        const inputTx = createInputTx(unspents, outputValue);
        return { inputKeys, unspents, inputTx };
      });

    outputTypes.forEach((outputType) => {
      const outputs = outputKeyTriplets.map((outputKeys) => createScriptPubKey(outputKeys, outputType));

      const txs = {
        forEach(cb: (txBuilder: any) => void) {
          inputTxs.forEach(({ inputKeys, unspents, inputTx }) => {

            outputs.forEach((scriptPubKey) => {
              const txBuilder = new bitcoin.TransactionBuilder(bitcoin.networks.bitcoin, Infinity);
              inputTx.outs.forEach(( v: any, i: number) => txBuilder.addInput(inputTx, i));
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
