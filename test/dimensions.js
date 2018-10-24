require('lodash.combinations');
const _ = require('lodash');
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

describe('Dimensions', function () {
  it('sums correctly', function () {
    utxo.Dimensions.zero().plus({ nP2shInputs: 1 }).should.eql(utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 0,
      nP2wshInputs: 0,
      nOutputs: 0
    }));

    const components = [
      { nP2shInputs: 1 },
      { nP2shP2wshInputs: 2 },
      { nP2wshInputs: 3 },
      { nOutputs: 4 }
    ];

    const sum = utxo.Dimensions.zero()
      .plus(components[0])
      .plus(components[1])
      .plus(components[2])
      .plus(components[3]);

    sum.should.eql(utxo.Dimensions.sum(...components));

    sum.should.eql(utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      nOutputs: 4
    }));
  });

  it('multiplies correctly', function () {
    utxo.Dimensions({
      nP2shInputs: 1,
      nP2shP2wshInputs: 2,
      nP2wshInputs: 3,
      nOutputs: 4
    }).times(2).should.eql(
      utxo.Dimensions({
        nP2shInputs: 2,
        nP2shP2wshInputs: 4,
        nP2wshInputs: 6,
        nOutputs: 8
      })
    )
  });
  {
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

    const testDimensionsFromTx = (inputTypes, outputTypes, expectedDim) => {
      const testName = `inputs=${inputTypes}; outputs=${outputTypes}`;
      const nInputs = inputTypes.length;
      const nOutputs = outputTypes.length;
      const keys = [1, 2, 3].map((v) => HDKey.fromMasterSeed(Buffer.from(`test/${v}`)));
      const inputValue = 10;

      const unspents = inputTypes.map((inputType) => createOutputScript2of3(keys, inputType));
      const inputTx = createInputTx(unspents, inputValue);
      const txBuilder = new bitcoin.TransactionBuilder();
      inputTx.outs.forEach(({}, i) => txBuilder.addInput(inputTx, i));
      outputTypes.forEach(unspentType => txBuilder.addOutput(createAddress(keys, unspentType), inputValue));

      it(`calculates dimensions from unsigned transaction [${testName}]`, function () {
        // does not work for unsigned transactions
        should.throws(() => utxo.Dimensions.fromTransaction(txBuilder.tx));

        // unless explicitly allowed
        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH })
          .should.eql(utxo.Dimensions.sum({ nP2shInputs: nInputs, nOutputs }));

        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH_P2WSH })
          .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: nInputs, nOutputs }));

        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2WSH })
          .should.eql(utxo.Dimensions.sum({ nP2wshInputs: nInputs, nOutputs }));
      });

      unspents.forEach(({ redeemScript, witnessScript }, i) =>
        keys.slice(0, 2).forEach((key) =>
          txBuilder.sign(
            i,
            key,
            redeemScript,
            undefined /* hashType */,
            inputValue /* needed for segwit signatures */,
            witnessScript
          )
        )
      );
      const signedTx = txBuilder.build();

      it(`calculates dimensions for signed transaction [${testName}]`, function () {
        const dimensions = utxo.Dimensions.fromTransaction(signedTx);
        dimensions.should.eql(expectedDim);
        dimensions.getNInputs().should.eql(nInputs);
      });

      it(`calculates dimensions for signed input of transaction [${testName}]`, function () {
        // test Dimensions.fromInput()
        inputTypes.forEach((input, i) =>
          utxo.Dimensions.fromInput(signedTx.ins[i])
            .should.eql(utxo.Dimensions.sum(getInputDimensionsForUnspentType(input)))
        );
      });
    };

    const inputTypes = Object.keys(UnspentTypeScript2of3);
    const outputTypes = [...inputTypes, ...Object.keys(UnspentTypePubKeyHash)];

    // Create combinations of different input and output types. Length between 1 and 3.
    const inputCombinations = _.flatten([1,2,3].map(i => _.combinations(inputTypes, i)));
    const outputCombinations = _.flatten([1,2,3].map(i => _.combinations(outputTypes, i)));

    inputCombinations.forEach(inputTypeCombo =>
      outputCombinations.forEach(outputTypeCombo => {
        const expectedInputDims = utxo.Dimensions.sum(...inputTypeCombo.map(getInputDimensionsForUnspentType));
        const expectedOutputDims = utxo.Dimensions.sum({ nOutputs: outputTypeCombo.length });

        testDimensionsFromTx(
          inputTypeCombo, outputTypeCombo,
          expectedInputDims.plus(expectedOutputDims)
        );

        // Doubling the inputs should yield twice the input dims
        testDimensionsFromTx(
          [...inputTypeCombo, ...inputTypeCombo], outputTypeCombo,
          expectedInputDims.plus(expectedInputDims).plus(expectedOutputDims)
        );

        // Same for outputs
        testDimensionsFromTx(
          inputTypeCombo, [...outputTypeCombo, ...outputTypeCombo],
          expectedInputDims.plus(expectedOutputDims).plus(expectedOutputDims)
        );
      })
    );
  }

  it('determines unspent size according to chain', function () {
    utxo.chain.codes.p2sh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shInputs: 1 }))
    );

    utxo.chain.codes.p2shP2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: 1 }))
    );

    utxo.chain.codes.p2wsh.values.forEach((chain) =>
      utxo.Dimensions.fromUnspent({ chain })
        .should.eql(utxo.Dimensions.sum({ nP2wshInputs: 1 }))
    );

    utxo.Dimensions.fromUnspents([
      { chain: utxo.chain.codes.p2sh.internal },
      { chain: utxo.chain.codes.p2sh.external },
      { chain: utxo.chain.codes.p2shP2wsh.internal },
      { chain: utxo.chain.codes.p2shP2wsh.external },
      { chain: utxo.chain.codes.p2wsh.internal },
      { chain: utxo.chain.codes.p2wsh.external }
    ]).should.eql(utxo.Dimensions({ nP2shP2wshInputs: 2, nP2shInputs: 2, nP2wshInputs: 2, nOutputs: 0 }));
  });

  it('calculates vsize', function () {
    [
      [1, 0, 0, 1, 340],
      [0, 1, 0, 1, 184],
      [0, 0, 1, 1, 150],
      [2, 0, 0, 1, 636],
      [0, 2, 0, 1, 323],
      [0, 0, 2, 1, 255],
      [1, 1, 1, 1, 585]
    ].forEach(([
      nP2shInputs,
      nP2shP2wshInputs,
      nP2wshInputs,
      nOutputs,
      expectedVSize
    ]) => {
      new utxo.Dimensions({
        nP2shInputs,
        nP2shP2wshInputs,
        nP2wshInputs,
        nOutputs,
      }).getVSize().should.eql(expectedVSize);
    });
  });
});
