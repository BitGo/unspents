const _ = require('lodash');
const t = require('tcomb');

const utxoChain = require('./chain');
const { PositiveInteger } = require('./types');

// Constants for signed TX input and output vsizes.
const VirtualSizes = Object.freeze({
  // Size of a P2PKH input with (un)compressed key
  // Source: https://bitcoin.stackexchange.com/questions/48279/how-big-is-the-input-of-a-p2pkh-transaction
  txP2pkhInputSizeCompressedKey: 148,
  txP2pkhInputSizeUncompressedKey: 180,
  // Size of a signed P2SH multisig input.
  txP2shInputSize: 296,
  // A signed P2SH-P2WSH (wrapped P2WSH) input has approximately 552 bytes weight, but we're making a conservative
  // estimate with 139 bytes vsize.
  // Source: https://bitcoin.stackexchange.com/q/57479/5406
  txP2shP2wshInputSize: 139,
  // https://bitgoinc.atlassian.net/browse/BG-5103#comment-33544
  txP2wshInputSize: 105,
  // Standard output size
  // FIXME(BG-5139) - add support for dynamic output sizes
  txOutputSize: 34,
  txOverheadSize: 10,
  // Segwit adds one byte each for marker and flag to the witness section. Thus, the vsize is only increased by one.
  txSegOverheadVSize: 11
});

/**
 * The transaction parameters required for fee calculation
 */
const Dimensions = t.struct({
  nP2shInputs: PositiveInteger,
  nP2shP2wshInputs: PositiveInteger,
  nP2wshInputs: PositiveInteger,
  nOutputs: PositiveInteger
});

Dimensions.ASSUME_P2SH = Symbol('assume-p2sh');
Dimensions.ASSUME_P2SH_P2WSH = Symbol('assume-p2sh-p2wsh');
Dimensions.ASSUME_P2WSH = Symbol('assume-p2wsh');

/**
 * Dimensions object where all properties are 0
 * @return {any}
 */
Dimensions.zero = function () {
  return new Dimensions({ nP2shInputs: 0, nP2shP2wshInputs: 0, nP2wshInputs: 0, nOutputs: 0 });
};

/**
 * @param args - Dimensions (can be partially defined)
 * @return sum of arguments
 */
Dimensions.sum = function (...args) {
  return args.reduce((a, b) => Dimensions(a).plus(b), Dimensions.zero());
};

/**
 * @param unspent - the unspent to count
 * @param [param.assumeUnsigned] - default type for unsigned input
 */
Dimensions.fromInput = function ({ index, script, witness }, { assumeUnsigned } = {}) {
  // FIXME: BG-5103
  // Native Segwit inputs will not be P2SH-wrapped and thus will not have a script buffer
  const p2shInput = Dimensions.sum({ nP2shInputs: 1 });
  const p2shP2wshInput = Dimensions.sum({ nP2shP2wshInputs: 1 });
  const p2wshInput = Dimensions.sum({ nP2wshInputs: 1 });

  if (!script.length) {
    if (witness.length > 0) {
      return p2wshInput;
    }
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
    throw new TypeError(`illegal value for assumeUnsigned: ${assumeUnsigned}`);
  }

  return witness.length ? p2shP2wshInput : p2shInput;
};

/**
 * Return dimensions of an unspent according to `chain` parameter
 * @param params.chain
 * @return {Dimensions} of the unspent
 * @throws if the chain code is invalid or unsupported
 */
Dimensions.fromUnspent = ({ chain }) => {
  if (!utxoChain.isValid(chain)) {
    throw new TypeError('invalid chain code');
  }

  if (utxoChain.isP2sh(chain)) {
    // FIXME(BG-6388): imprecise name
    return Dimensions.sum({ nP2shInputs: 1 });
  }

  if (utxoChain.isP2shP2wsh(chain)) {
    return Dimensions.sum({ nP2shP2wshInputs: 1 });
  }

  if (utxoChain.isP2wsh(chain)) {
    return Dimensions.sum({ nP2wshInputs: 1 });
  }

  // FIXME(BG-5103): add support for p2wsh
  throw new Error(`unsupported chain ${chain}`);
};


/**
 * @param unspents
 * @return {Dimensions} sum of the dimensions for each unspent (@see Dimensions.fromUnspent())
 */
Dimensions.fromUnspents = function (unspents) {
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
Dimensions.fromTransaction = function ({ ins, outs }, { assumeUnsigned } = {}) {
  return Dimensions.sum(
    ...ins.map((input) => Dimensions.fromInput(input, { assumeUnsigned })),
    { nOutputs: outs.length }
  );
};

/**
 * @param dimensions (can be partially defined)
 * @return new dimensions with argument added
 */
Dimensions.prototype.plus = function (dimensions) {
  return new Dimensions(_.mergeWith({}, this, dimensions, (a = 0, b = 0) => a + b));
};

/**
 * @return Number of total inputs (Segwit and P2SH)
 */
Dimensions.prototype.getNInputs = function () {
  return this.nP2shInputs + this.nP2shP2wshInputs + this.nP2wshInputs;
};

/**
 * Estimates the virtual size (1/4 weight) of a signed transaction with segwit and legacy multisig inputs.
 * @returns {Number} The estimated vsize of the transaction.
 */
Dimensions.prototype.getVSize = function () {
  const {
    txP2shInputSize,
    txP2shP2wshInputSize,
    txP2wshInputSize,
    txOutputSize,
    txOverheadSize,
    txSegOverheadVSize
  } = VirtualSizes;

  const { nP2shInputs, nP2shP2wshInputs, nP2wshInputs, nOutputs } = this;

  const overheadSize = ((nP2wshInputs + nP2shP2wshInputs) > 0) ? txSegOverheadVSize : txOverheadSize;
  const totalP2shInputSize = nP2shInputs * txP2shInputSize;
  const totalP2shP2wshInputSize = nP2shP2wshInputs * txP2shP2wshInputSize;
  const totalP2wshInputSize = nP2wshInputs * txP2wshInputSize;
  const totalOutputSize = nOutputs * txOutputSize;

  return overheadSize +
    totalP2shInputSize +
    totalP2shP2wshInputSize +
    totalP2wshInputSize +
    totalOutputSize;
};

module.exports = { VirtualSizes, Dimensions };
