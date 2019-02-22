import * as _ from 'lodash';
import * as t from 'tcomb';

import * as utxoChain from './codes';
import { ChainCode } from './codes';
import { PositiveInteger } from './types';

/*
This is a reference implementation for calculating weights and vSizes from bitcoinjs-lib 3.3.2.
https://github.com/bitcoinjs/bitcoinjs-lib/blob/v3.3.2/src/transaction.js#L194-L219

```
  function encodingLength (number) {
    checkUInt53(number)

    return (
      number < 0xfd ? 1
    : number <= 0xffff ? 3
    : number <= 0xffffffff ? 5
    : 9
    )
  }

  function varSliceSize (someScript) {
    var length = someScript.length

    return encodingLength(length) + length
  }

  function vectorSize (someVector) {
    var length = someVector.length

    return varuint.encodingLength(length) + someVector.reduce(function (sum, witness) {
      return sum + varSliceSize(witness)
    }, 0)
  }

  Transaction.prototype.__byteLength = function (__allowWitness) {
    var hasWitnesses = __allowWitness && this.hasWitnesses()

    return (
      (hasWitnesses ? 10 : 8) +
      varuint.encodingLength(this.ins.length) +
      varuint.encodingLength(this.outs.length) +
      this.ins.reduce(function (sum, input) { return sum + 40 + varSliceSize(input.script) }, 0) +
      this.outs.reduce(function (sum, output) { return sum + 8 + varSliceSize(output.script) }, 0) +
      (hasWitnesses ? this.ins.reduce(function (sum, input) { return sum + vectorSize(input.witness) }, 0) : 0)
    )
  }

  Transaction.prototype.weight = function () {
    var base = this.__byteLength(false)
    var total = this.__byteLength(true)
    return base * 3 + total
  }

  Transaction.prototype.virtualSize = function () {
    return Math.ceil(this.weight() / 4)
  }
```
*/

// Constants for signed TX input and output vsizes.
// See https://bitcoincore.org/en/segwit_wallet_dev/#transaction-serialization for full description
// FIXME(BG-9233): use weight units instead
export const VirtualSizes = Object.freeze({
  // FIXME(BG-7873): add support for signature grinding

  //
  // Input sizes
  //
  //
  // Size of a P2PKH input with (un)compressed key
  // Source: https://bitcoin.stackexchange.com/questions/48279/how-big-is-the-input-of-a-p2pkh-transaction
  txP2pkhInputSizeCompressedKey: 148,
  txP2pkhInputSizeUncompressedKey: 180,

  // The distribution of input weights for a 2-of-3 p2sh input with two signatures is as follows
  //   ┌───────┬─┬───────┬─┬───────┐
  //   │ 1172  │…│ 1184  │…│ 1188  │
  //   ├───────┼─┼───────┼─┼───────┤
  //   │ 0.270 │…│ 0.496 │…│ 0.234 │
  //   └───────┴─┴───────┴─┴───────┘
  // Which corresponds to vSizes [293, 296, 297].
  // The 3-byte gap is due to the fact that a single-byte increase of the total scriptSig length from 252 to 253
  // requires another 2-byte increase of the encoded scriptSig length.
  // For N inputs, the overestimation will be below 2 * N vbytes for 80% of transactions.
  txP2shInputSize: 296,

  // The distribution of input weights for a 2-of-3 p2shP2wsh input with two signatures is as follows
  //   ┌───────┬───────┬───────┐
  //   │ 556   │ 557   │ 558   │
  //   ├───────┼───────┼───────┤
  //   │ 0.281 │ 0.441 │ 0.277 │
  //   └───────┴───────┴───────┘
  // Which corresponds to a vSize  of 139.5 on the upper side. We will round up to 140.
  // For N inputs, the overestimation will be below N vbytes for all transactions.
  txP2shP2wshInputSize: 139,

  // The distribution of input weights for a 2-of-3 p2wsh input with two signatures is as follows
  //   ┌───────┬───────┬───────┬───────┐
  //   │ 415   │ 416   │ 417   │ 418   │
  //   ├───────┼───────┼───────┼───────┤
  //   │ 0.002 │ 0.246 │ 0.503 │ 0.249 │
  //   └───────┴───────┴───────┴───────┘
  // This corresponds to a vSize of 104.5 on the upper end, which we round up to 105.
  // For N inputs, the overestimation will be below N vbytes for all transactions.
  txP2wshInputSize: 105,

  //
  // Output sizes
  //

  // The size is calculated as
  //
  //    scriptLength + compactSize(scriptLength) + txOutputAmountSize
  //
  // Since compactSize(scriptLength) is 1 for all scripts considered here, we can simplify this to
  //
  //    scriptLength + 9
  //

  // Size of single output amount
  txOutputAmountSize: 8,

  // https://github.com/bitcoinjs/bitcoinjs-lib/blob/v4.0.2/src/templates/scripthash/output.js#L9
  txP2shOutputSize: 32,
  txP2shP2wshOutputSize: 32,
  // https://github.com/bitcoinjs/bitcoinjs-lib/blob/v4.0.2/src/templates/witnessscripthash/output.js#L9
  txP2wshOutputSize: 43,
  // https://github.com/bitcoinjs/bitcoinjs-lib/blob/v4.0.2/src/templates/pubkeyhash/output.js#L9
  txP2pkhOutputSize: 34,
  // https://github.com/bitcoinjs/bitcoinjs-lib/blob/v4.0.2/src/templates/witnesspubkeyhash/output.js#L9
  txP2wpkhOutputSize: 31,

  /** @deprecated - use txP2pkhOutputSize instead */
  txOutputSize: 34,

  //
  // General tx size constants
  //

  txOverheadSize: 10,
  // Segwit adds one byte each for marker and flag to the witness section.
  // Thus, the vsize is only increased by one.
  txSegOverheadVSize: 11,
});

/**
 * https://bitcoin.org/en/developer-reference#compactsize-unsigned-integers
 * https://github.com/bitcoinjs/varuint-bitcoin/blob/1d5b253/index.js#L79
 * @param integer
 * @return {number} - The compact size the integer requires when serialized in a transaction
 */
const compactSize = (integer: number) => {
  if (!PositiveInteger.is(integer)) {
    throw new TypeError(`expected positive integer`);
  }
  if (integer <= 252) {
    return 1;
  }
  if (integer <= 0xffff) {
    return 3;
  }
  if (integer <= 0xffffffff) {
    return 5;
  }
  return 9;
};

/**
 * A collection of outputs is represented as their count and aggregate vsize
 */
const StructOutputs = t.refinement(
  t.struct({
    count: PositiveInteger, // number of outputs
    size: PositiveInteger, // aggregate vsize
  }),
  /* predicate: count is zero iff size is zero */
  ({ count, size }: { count: number, size: number }) => (count === 0) === (size === 0),
  /* name */
  'Outputs',
);

interface IOutput {
  index: number;
  script: Buffer;
  witness: Buffer;
}

interface IBitcoinTx {
  ins: IOutput[];
  outs: IOutput[];
}

export interface IOutputDimensions {
  count: number;
  size: number;
}

export interface IBaseDimensions {
  nP2shInputs: number;
  nP2shP2wshInputs: number;
  nP2wshInputs: number;
  outputs: IOutputDimensions;
}

export interface IDimensions extends IBaseDimensions {
  nInputs: number;
  nOutputs: number;

  plus(v: Partial<IDimensions>): IDimensions;
  times(n: number): IDimensions;

  isSegwit(): boolean;
  getOverheadVSize(): number;
  getInputsVSize(): number;
  getOutputsVSize(): number;
  getVSize(): number;
}

export interface IDimensionsStruct extends t.Struct<IDimensions> {
  ASSUME_P2SH: symbol;
  ASSUME_P2SH_P2WSH: symbol;
  ASSUME_P2WSH: symbol;

  (v: IBaseDimensions): IDimensions;
  new (v: IBaseDimensions): IDimensions;

  zero(): IDimensions;
  sum(...args: Array<Partial<IDimensions>>): IDimensions;

  getOutputScriptLengthForChain(chain: ChainCode): number;
  getVSizeForOutputWithScriptLength(length: number): number;

  fromInput(input: IOutput, params?: { assumeUnsigned?: symbol }): IDimensions;
  fromInputs(input: IOutput[], params?: { assumeUnsigned?: symbol }): IDimensions;

  fromOutputScriptLength(scriptLength: number): IDimensions;
  fromOutput(output: { script: Buffer }): IDimensions;
  fromOutputs(outputs: Array<{ script: Buffer }>): IDimensions;
  fromOutputOnChain(chain: ChainCode): IDimensions;
  fromUnspent(unspent: { chain: ChainCode }): IDimensions;
  fromUnspents(unspents: Array<{ chain: ChainCode }>): IDimensions;

  fromTransaction(tx: IBitcoinTx, params?: { assumeUnsigned?: symbol } ): IDimensions;
}

/**
 * The transaction parameters required for vsize estimation.
 * The total vsize of a transaction (`getVSize()`) is the sum of:
 * - the overhead vsize (`getOverheadVSize()`),
 * - the inputs vsize (`getInputsVSize()`)
 * - the outputs vsize (`getOutputsVSize()`)
 * See https://bitcoincore.org/en/segwit_wallet_dev/#transaction-serialization
 * for explanation of the different components.
 */
export const Dimensions = t.struct<IDimensions>({
  nP2shInputs: PositiveInteger,
  nP2shP2wshInputs: PositiveInteger,
  nP2wshInputs: PositiveInteger,
  outputs: StructOutputs,
}, { name: 'Dimensions' }) as unknown as IDimensionsStruct;

const zero = Object.freeze(Dimensions({
  nP2shInputs: 0,
  nP2shP2wshInputs: 0,
  nP2wshInputs: 0,
  outputs: { count: 0, size: 0 },
})) as IDimensions;

/**
 * Dimensions object where all properties are 0
 * @return {any}
 */
Dimensions.zero = function(): IDimensions {
  return zero;
};

Object.defineProperty(Dimensions.prototype, 'nInputs', {
  /**
   * @return Number of total inputs (p2sh + p2shP2wsh + p2wsh)
   */
  get() {
    return this.nP2shInputs + this.nP2shP2wshInputs + this.nP2wshInputs;
  },

  set(v) {
    throw new Error('read-only property nInputs');
  },
});

Object.defineProperty(Dimensions.prototype, 'nOutputs', {
  /**
   * @return Number of total outputs
   */
  get() {
    return this.outputs.count;
  },

  set(v) {
    throw new Error('read-only property nOutputs');
  },
});

type DimProperty = number | IOutputDimensions;

type DimPropertyConstructor = (v: any) => DimProperty;

type MapFunc = (
  value: DimProperty,
  key: keyof IDimensions,
  prop: DimPropertyConstructor,
) => DimProperty;

/**
 * Return new Dimensions with all properties mapped by func
 * @param dim - Dimensions to be mapped
 * @param func - takes (value, key, prop)
 * @return {Dimensions} new dimensions
 */
const mapDimensions = (dim: IDimensions, func: MapFunc) => {
  return Dimensions(
    _.fromPairs(_.map(Dimensions.meta.props, (prop, key) =>
      [key, func((dim as any)[key], key as keyof IDimensions, prop as DimPropertyConstructor)],
    )) as IDimensions,
  );
};

Dimensions.ASSUME_P2SH = Symbol('assume-p2sh');
Dimensions.ASSUME_P2SH_P2WSH = Symbol('assume-p2sh-p2wsh');
Dimensions.ASSUME_P2WSH = Symbol('assume-p2wsh');

/**
 * @param args - Dimensions (can be partially defined)
 * @return {Dimensions} sum of arguments
 */
Dimensions.sum = function(...args: Array<Partial<IDimensions>>): IDimensions {
  return args.reduce((a: IDimensions, b: Partial<IDimensions>) => Dimensions(a).plus(b), zero);
};

/**
 * @param chain
 * @return {Number}
 */
Dimensions.getOutputScriptLengthForChain = function(chain: ChainCode): number {
  if (!utxoChain.isValid(chain)) {
    throw new TypeError('invalid chain code');
  }
  return utxoChain.isP2wsh(chain) ? 34 : 23;
};

/**
 * @param scriptLength
 * @return {Number} vSize of an output with script length
 */
Dimensions.getVSizeForOutputWithScriptLength = function(scriptLength: number): number {
  if (!PositiveInteger.is(scriptLength)) {
    throw new TypeError(`expected positive integer for scriptLength, got ${scriptLength}`);
  }
  return scriptLength + compactSize(scriptLength) + VirtualSizes.txOutputAmountSize;
};

/**
 * @param unspent - the unspent to count
 * @param params
 *        [param.assumeUnsigned] - default type for unsigned input
 */
Dimensions.fromInput = function({ index, script, witness }: IOutput, params = {}) {
  const p2shInput = Dimensions.sum({ nP2shInputs: 1 });
  const p2shP2wshInput = Dimensions.sum({ nP2shP2wshInputs: 1 });
  const p2wshInput = Dimensions.sum({ nP2wshInputs: 1 });

  if (!script.length) {
    if (witness.length > 0) {
      return p2wshInput;
    }
    const { assumeUnsigned } = params;
    if (!assumeUnsigned) {
      throw new Error(`illegal input ${index}: empty script`);
    }
    if (assumeUnsigned === Dimensions.ASSUME_P2SH) {
      return p2shInput;
    }
    if (assumeUnsigned === Dimensions.ASSUME_P2SH_P2WSH) {
      return p2shP2wshInput;
    }
    if (assumeUnsigned === Dimensions.ASSUME_P2WSH) {
      return p2wshInput;
    }
    throw new TypeError(`illegal value for assumeUnsigned: ${String(assumeUnsigned)}`);
  }

  return witness.length ? p2shP2wshInput : p2shInput;
};

/**
 * @param inputs - Array of inputs
 * @param params - @see Dimensions.fromInput()
 * @return {Dimensions} sum of the dimensions for each input (@see Dimensions.fromInput())
 */
Dimensions.fromInputs = function(inputs, params) {
  if (!Array.isArray(inputs)) {
    throw new TypeError(`inputs must be array`);
  }
  return Dimensions.sum(...inputs.map((i) => Dimensions.fromInput(i, params)));
};

/**
 * @param scriptLength {PositiveInteger} - size of the output script in bytes
 * @return {Dimensions} - Dimensions of the output
 */
Dimensions.fromOutputScriptLength = function(scriptLength) {
  return Dimensions.sum({
    outputs: {
      count: 1,
      size: Dimensions.getVSizeForOutputWithScriptLength(scriptLength),
    },
  });
};

/**
 * @param output - a tx output
 * @return Dimensions - the dimensions of the given output
 */
Dimensions.fromOutput = function({ script }) {
  if (!script) {
    throw new Error('expected output script to be defined');
  }
  if (!Buffer.isBuffer(script)) {
    throw new TypeError('expected script to be buffer, got ' + typeof script);
  }
  return Dimensions.fromOutputScriptLength(script.length);
};

/**
 * @param outputs - Array of outputs
 * @return {Dimensions} sum of the dimensions for each output (@see Dimensions.fromOutput())
 */
Dimensions.fromOutputs = function(outputs) {
  if (!Array.isArray(outputs)) {
    throw new TypeError(`outputs must be array`);
  }
  return Dimensions.sum(...outputs.map(Dimensions.fromOutput));
};

/**
 * Returns the dimensions of an output that will be created on a specific chain.
 * Currently, this simply adds a default output.
 *
 * @param chain - Chain code as defined by utxo.chain
 * @return {Dimensions} - Dimensions for a single output on the given chain.
 */
Dimensions.fromOutputOnChain = function(chain) {
  return Dimensions.fromOutputScriptLength(Dimensions.getOutputScriptLengthForChain(chain));
};

/**
 * Return dimensions of an unspent according to `chain` parameter
 * @param params.chain - Chain code as defined by utxo.chain
 * @return {Dimensions} of the unspent
 * @throws if the chain code is invalid or unsupported
 */
Dimensions.fromUnspent = ({ chain }) => {
  if (!utxoChain.isValid(chain)) {
    throw new TypeError('invalid chain code');
  }

  if (utxoChain.isP2sh(chain)) {
    return Dimensions.sum({ nP2shInputs: 1 });
  }

  if (utxoChain.isP2shP2wsh(chain)) {
    return Dimensions.sum({ nP2shP2wshInputs: 1 });
  }

  if (utxoChain.isP2wsh(chain)) {
    return Dimensions.sum({ nP2wshInputs: 1 });
  }

  throw new Error(`unsupported chain ${chain}`);
};

/**
 * @param unspents
 * @return {Dimensions} sum of the dimensions for each unspent (@see Dimensions.fromUnspent())
 */
Dimensions.fromUnspents = function(unspents) {
  if (!Array.isArray(unspents)) {
    throw new TypeError(`unspents must be array`);
  }
  // Convert the individual unspents into dimensions and sum them up
  return Dimensions.sum(...unspents.map(Dimensions.fromUnspent));
};

/**
 * @param transaction - bitcoin-like transaction
 * @param [param.assumeUnsigned] - default type for unsigned inputs
 * @return {Dimensions}
 */
Dimensions.fromTransaction = function({ ins, outs }, params) {
  return Dimensions.fromInputs(ins, params).plus(Dimensions.fromOutputs(outs));
};

/**
 * @param dimensions (can be partially defined)
 * @return new dimensions with argument added
 */
Dimensions.prototype.plus = function(dimensions: Partial<IDimensions>) {
  if (!_.isObject(dimensions)) {
    throw new TypeError(`expected argument to be object`);
  }

  // Catch instances where we try to initialize Dimensions from partial data using deprecated parameters
  // using only "nOutputs".
  if ('nOutputs' in dimensions) {
    if (!('outputs' in dimensions)) {
      throw new Error('deprecated partial addition: argument has key "nOutputs" but no "outputs"');
    }

    const { outputs, nOutputs } = (dimensions as IDimensions);

    if (outputs.count !== nOutputs) {
      throw new Error('deprecated partial addition: inconsistent values for "nOutputs" and "outputs.count"');
    }
  }

  const f: MapFunc = (v, key, prop) => {
    const w = dimensions.hasOwnProperty(key)
      ? prop(dimensions[key])
      : zero[key];
    if (key === 'outputs') {
      const vOutputs = (v as IOutputDimensions);
      const wOutputs = (w as IOutputDimensions);
      return {
        count: vOutputs.count + wOutputs.count,
        size: vOutputs.size + wOutputs.size,
      };
    }
    return (v as number) + (w as number);
  };

  return mapDimensions(this, f);
};

/**
 * Multiply dimensions by a given factor
 * @param factor - Positive integer
 * @return {Dimensions}
 */
Dimensions.prototype.times = function(factor: number) {
  if (!PositiveInteger.is(factor)) {
    throw new TypeError(`expected factor to be positive integer`);
  }

  return mapDimensions(this, (v, key) => {
    if (key === 'outputs') {
      const vOutputs = v as IOutputDimensions;
      return {
        count: vOutputs.count * factor,
        size: vOutputs.size * factor,
      };
    }
    return (v as number) * factor;
  });
};

/**
 * @return Number of total inputs (p2sh, p2shP2wsh and p2wsh)
 * @deprecated use `dimension.nInputs` instead
 */
Dimensions.prototype.getNInputs = function() {
  return this.nP2shInputs + this.nP2shP2wshInputs + this.nP2wshInputs;
};

/**
 * @returns {boolean} true iff dimensions have one or more (p2sh)p2wsh inputs
 */
Dimensions.prototype.isSegwit = function() {
  return (this.nP2wshInputs + this.nP2shP2wshInputs) > 0;
};

/**
 * @return {Number} overhead vsize, based on result isSegwit().
 */
Dimensions.prototype.getOverheadVSize = function() {
  return this.isSegwit()
    ? VirtualSizes.txSegOverheadVSize
    : VirtualSizes.txOverheadSize;
};

/**
 * @returns {number} vsize of inputs, without transaction overhead
 */
Dimensions.prototype.getInputsVSize = function() {
  const {
    txP2shInputSize,
    txP2shP2wshInputSize,
    txP2wshInputSize,
  } = VirtualSizes;

  const {
    nP2shInputs,
    nP2shP2wshInputs,
    nP2wshInputs,
  } = this;

  return nP2shInputs * txP2shInputSize +
    nP2shP2wshInputs * txP2shP2wshInputSize +
    nP2wshInputs * txP2wshInputSize;
};

/**
 * @returns {number} return vsize of outputs, without overhead
 */
Dimensions.prototype.getOutputsVSize = function() {
  return this.outputs.size;
};

/**
 * Estimates the virtual size (1/4 weight) of a signed transaction as sum of
 * overhead vsize, input vsize and output vsize.
 * @returns {Number} The estimated vsize of the transaction dimensions.
 */
Dimensions.prototype.getVSize = function() {
  return this.getOverheadVSize() + this.getInputsVSize() + this.getOutputsVSize();
};
