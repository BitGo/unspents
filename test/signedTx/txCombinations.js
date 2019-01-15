const should = require('should');

const HDKey = require('hdkey');

const utxo = require('../../src');

const {
  UnspentTypeScript2of3,
  UnspentTypePubKeyHash,
  getInputDimensionsForUnspentType,
  getOutputDimensionsForUnspentType,
} = require('../testutils');

const {
  TxCombo,
  runCombinations,
} = require('./txGen');

const testDimensionsFromTx = (txCombo) => {
  const { inputTypes, outputTypes, expectedDims } = txCombo;

  describe(`Combination inputs=${inputTypes}; outputs=${outputTypes}`, function () {
    const nInputs = inputTypes.length;
    const outputDims = utxo.Dimensions.sum(...outputTypes.map(getOutputDimensionsForUnspentType));

    it(`calculates dimensions from unsigned transaction`, function () {
      const unsignedTx = txCombo.getUnsignedTx();

      // does not work for unsigned transactions
      should.throws(() => utxo.Dimensions.fromTransaction(unsignedTx));

      // unless explicitly allowed
      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH })
        .should.eql(utxo.Dimensions.sum({ nP2shInputs: nInputs }, outputDims));

      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH_P2WSH })
        .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: nInputs }, outputDims));

      utxo.Dimensions.fromTransaction(unsignedTx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2WSH })
        .should.eql(utxo.Dimensions.sum({ nP2wshInputs: nInputs }, outputDims));
    });

    it(`calculates dimensions for signed transaction`, function () {
      const dimensions = utxo.Dimensions.fromTransaction(txCombo.getSignedTx());
      dimensions.should.eql(expectedDims);
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


describe(`Dimensions for transaction combinations`, function () {
  const params = {
    inputTypes: Object.keys(UnspentTypeScript2of3),
    maxNInputs: 3,
    outputTypes: [...Object.keys(UnspentTypeScript2of3), ...Object.keys(UnspentTypePubKeyHash)],
    maxNOutputs: 3,
  };

  runCombinations(params, (inputTypeCombo, outputTypeCombo) => {
    const expectedInputDims = utxo.Dimensions.sum(...inputTypeCombo.map(getInputDimensionsForUnspentType));
    const expectedOutputDims = utxo.Dimensions.sum(...outputTypeCombo.map(getOutputDimensionsForUnspentType));

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
