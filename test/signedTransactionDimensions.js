const _ = require('lodash');
require('lodash.combinations');

const should = require('should');

const HDKey = require('hdkey');
const bitcoin = require('bitgo-utxo-lib');

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

/**
 * Return the input dimensions based on unspent type
 * @param unspentType - one of UnspentTypeScript2of3
 * @return Dimensions
 */
const getInputDimensionsForUnspentType = (unspentType) => {
  switch (unspentType) {
    case UnspentTypeScript2of3.p2sh:
      return { nP2shInputs: 1 };
    case UnspentTypeScript2of3.p2shP2wsh:
      return { nP2shP2wshInputs: 1 };
    case UnspentTypeScript2of3.p2wsh:
      return { nP2wshInputs: 1 };
  }
  throw new Error(`no input dimensions for ${unspentType}`);
};

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

  let address;
  if (unspentType === UnspentTypeScript2of3.p2wsh) {
    address = bitcoin.address.fromOutputScript(p2wshOutputScript);
  } else {
    const redeemScriptHash = bitcoin.crypto.hash160(redeemScript);
    const scriptPubKey = bitcoin.script.scriptHash.output.encode(redeemScriptHash);
    address = bitcoin.address.fromOutputScript(scriptPubKey);
  }

  return { redeemScript, witnessScript, address };
};


/**
 *
 * @param keys - Pubkeys to use for generating the address.
 *               If unspentType is one of UnspentTypePubKeyHash is used, the first key will be used.
 * @param unspentType {String} - one of UnspentTypeScript2of3 or UnspentTypePubKeyHash
 * @return {String} address
 */
const createAddress = (keys, unspentType) => {
  if (UnspentTypeScript2of3[unspentType]) {
    return createOutputScript2of3(keys, unspentType).address;
  }

  const key = keys[0];
  const pkHash = bitcoin.crypto.hash160(key.publicKey);
  let scriptPubKey;
  switch (unspentType) {
    case UnspentTypePubKeyHash.p2pkh:
      scriptPubKey = bitcoin.script.pubKeyHash.output.encode(pkHash);
      break;
    case UnspentTypePubKeyHash.p2wpkh:
      scriptPubKey = bitcoin.script.witnessPubKeyHash.output.encode(pkHash);
      break;
    default:
      throw new Error(`unsupported output type ${unspentType}`);
  }
  return bitcoin.address.fromOutputScript(scriptPubKey);
};


const createInputTx = (unspents, inputValue) => {
  const txInputBuilder = new bitcoin.TransactionBuilder();
  txInputBuilder.addInput(Array(32).fill('01').join(''), 0);
  unspents.forEach(({ address }) => txInputBuilder.addOutput(address, inputValue));
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
      unspentType => txBuilder.addOutput(createAddress(this.keys, unspentType), this.inputValue)
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

const testDimensionsFromTx = (txCombo) => {
  const { inputTypes, outputTypes, expectedDims } = txCombo;

  describe(`Combination inputs=${inputTypes}; outputs=${outputTypes}`, function () {
    const nInputs = inputTypes.length;
    const nOutputs = outputTypes.length;

    it(`calculates dimensions from unsigned transaction`, function () {
      const unsignedTx = txCombo.getUnsignedTx();

      // does not work for unsigned transactions
      should.throws(() => utxo.Dimensions.fromTransaction(unsignedTx));

      // unless explicitly allowed
      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH })
        .should.eql(utxo.Dimensions.sum({ nP2shInputs: nInputs, nOutputs }));

      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH_P2WSH })
        .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: nInputs, nOutputs }));

      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2WSH })
        .should.eql(utxo.Dimensions.sum({ nP2wshInputs: nInputs, nOutputs }));
    });

    it(`calculates dimensions for signed transaction`, function () {
      const dimensions = utxo.Dimensions.fromTransaction(txCombo.getSignedTx());
      dimensions.should.eql(expectedDims);
      dimensions.getNInputs().should.eql(nInputs);
      dimensions.nOutputs.should.eql(nOutputs);
    });

    it(`calculates dimensions for signed input of transaction`, function () {
      const signedTx = txCombo.getSignedTx();

      // test Dimensions.fromInput()
      inputTypes.forEach((input, i) =>
        utxo.Dimensions.fromInput(signedTx.ins[i])
          .should.eql(utxo.Dimensions.sum(getInputDimensionsForUnspentType(input)))
      );
    });
  });
};


const runAllCombinations = (inputTypes, outputTypes, callback) => {
  // Create combinations of different input and output types. Length between 1 and 3.
  const inputCombinations = _.flatten([1, 2, 3].map(i => _.combinations(inputTypes, i)));
  const outputCombinations = _.flatten([1, 2, 3].map(i => _.combinations(outputTypes, i)));

  inputCombinations.forEach(inputTypeCombo =>
    outputCombinations.forEach(outputTypeCombo => {
      callback(inputTypeCombo, outputTypeCombo);
    })
  );
};


describe(`Dimensions for transaction combinations`, function () {
  const inputTypes = Object.keys(UnspentTypeScript2of3);
  const outputTypes = [...inputTypes, ...Object.keys(UnspentTypePubKeyHash)];

  runAllCombinations(inputTypes, outputTypes, (inputTypeCombo, outputTypeCombo) => {
    const expectedInputDims = utxo.Dimensions.sum(...inputTypeCombo.map(getInputDimensionsForUnspentType));
    const expectedOutputDims = utxo.Dimensions.sum({ nOutputs: outputTypeCombo.length });

    const keys = [1, 2, 3].map((v) => HDKey.fromMasterSeed(Buffer.from(`test/2/${v}`)));

    testDimensionsFromTx(
      new TxCombo(
        keys,
        inputTypeCombo,
        outputTypeCombo,
        expectedInputDims.plus(expectedOutputDims)
      )
    );

    // Doubling the inputs should yield twice the input dims
    testDimensionsFromTx(
      new TxCombo(
        keys,
        [...inputTypeCombo, ...inputTypeCombo],
        outputTypeCombo,
        expectedInputDims.plus(expectedInputDims).plus(expectedOutputDims)
      )
    );

    // Same for outputs
    testDimensionsFromTx(
      new TxCombo(
        keys,
        inputTypeCombo,
        [...outputTypeCombo, ...outputTypeCombo],
        expectedInputDims.plus(expectedOutputDims).plus(expectedOutputDims)
      )
    );
  });
});
