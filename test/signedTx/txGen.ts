import * as bitcoin from '@bitgo/utxo-lib';
import * as bip32 from 'bip32';
import _ from 'lodash';
import 'lodash.combinations';
import { Dimensions, IDimensions } from '../../src';
import {
  TestUnspentType,
  UnspentTypeOpReturn,
  UnspentTypeP2shP2pk,
  UnspentTypePubKeyHash,
  UnspentTypeScript2of3,
} from '../testutils';

interface IUnspent {
  scriptPubKey: Buffer;
  redeemScript?: Buffer;
  witnessScript?: Buffer;
  value: number;
  inputType: string;
}

function createUnspent(pubkeys: Buffer[], inputType: string, value: number): IUnspent {
  if (inputType === UnspentTypeP2shP2pk) {
    return {
      ...bitcoin.bitgo.outputScripts.createOutputScriptP2shP2pk(pubkeys[0]),
      value,
      inputType,
    };
  }
  if (bitcoin.bitgo.outputScripts.isScriptType2Of3(inputType)) {
    return {
      ...bitcoin.bitgo.outputScripts.createOutputScript2of3(
        pubkeys, inputType as bitcoin.bitgo.outputScripts.ScriptType2Of3,
      ),
      value,
      inputType,
    };
  }
  throw new Error(`unexpected inputType ${inputType}`);
}

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
    return createUnspent(pubkeys, unspentType, 0).scriptPubKey;
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

function signInput(
  txBuilder: bitcoin.TransactionBuilder,
  index: number,
  keys: bip32.BIP32Interface[],
  unspent: IUnspent,
) {
  const nKeys = unspent.inputType === 'p2shP2pk' ? 1 : 2;
  keys.slice(0, nKeys).forEach((key) =>
    txBuilder.sign(
      index,
      key,
      unspent.redeemScript,
      undefined /* hashType */,
      unspent.value /* needed for segwit signatures */,
      unspent.witnessScript,
    ),
  );
}

class TxCombo {
  public unspents: IUnspent[];
  public inputTx: any;

  constructor(
    public keys: bip32.BIP32Interface[],
    public inputTypes: string[],
    public outputTypes: TestUnspentType[],
    public expectedDims: IDimensions = Dimensions.zero(),
    public inputValue: number = 10,
  ) {
    this.unspents = inputTypes.map((inputType) =>
      createUnspent(keys.map((key) => key.publicKey), inputType, this.inputValue),
    );
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
    this.unspents.forEach((unspent, i) => {
      signInput(txBuilder, i, this.keys, unspent);
    });
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
    inputTypes: string[],
    maxNInputs: number,
    outputTypes: TestUnspentType[],
    maxNOutputs: number,
  },
  callback: (inputCombo: string[], outputCombo: TestUnspentType[]) => void,
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
    inputTypes: Array<{ inputType: string, count: number}>,
    nInputKeyTriplets: number,
    outputTypes: TestUnspentType[],
    nOutputKeyTriplets: number,
  },
  callback: (
    inputType: string,
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
        const unspents = [...Array(inputCount)].map(() => createUnspent(
          inputKeys.map((key) => key.publicKey),
          inputType,
          outputValue,
        ));
        const inputTx = createInputTx(unspents, outputValue);
        return { inputKeys, unspents, inputTx };
      });

    outputTypes.forEach((outputType) => {
      const outputs = outputKeyTriplets.map((outputKeys) => createScriptPubKey(outputKeys, outputType));

      const txs = {
        forEach(cb: (tx: bitcoin.Transaction) => void) {
          inputTxs.forEach(({ inputKeys, unspents, inputTx }) => {

            outputs.forEach((scriptPubKey) => {
              const txBuilder = new bitcoin.TransactionBuilder(bitcoin.networks.bitcoin, Infinity);
              inputTx.outs.forEach(( v: any, i: number) => txBuilder.addInput(inputTx, i));
              txBuilder.addOutput(scriptPubKey, outputValue);
              unspents.forEach((unspent, i) => {
                signInput(txBuilder, i, inputKeys, unspent);
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
