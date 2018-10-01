const _ = require('lodash');
const should = require('should');

const HDKey = require('hdkey');
const bitcoin = require('bitgo-utxo-lib');

const utxo = require('../src');

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
  {
    /**
     * Return a P2SH-P2PKH or P2SH-P2WPKH
     * @param keys - the key array for multisig
     * @param chain - the type of output to create
     * @returns {{redeemScript, witnessScript, address}}
     */
    const createOutput = (keys, chain) => {
      const pubkeys = keys.map(({ publicKey }) => publicKey);
      const script2Of3 = bitcoin.script.multisig.output.encode(2, pubkeys);
      const witnessScriptHash = bitcoin.script.witnessScriptHash.output.encode(
        bitcoin.crypto.sha256(script2Of3)
      );
      let redeemScript, witnessScript;
      if (utxo.chain.isP2sh(chain)) {
        redeemScript = script2Of3;
      } else if (utxo.chain.isP2shP2wsh(chain)) {
        witnessScript = script2Of3;
        redeemScript = witnessScriptHash;
      } else if (utxo.chain.isP2wsh(chain)) {
        witnessScript = script2Of3;
      }

      let address;
      if (utxo.chain.isP2wsh(chain)) {
        address = bitcoin.address.fromOutputScript(witnessScriptHash);
      } else {
        const redeemScriptHash = bitcoin.crypto.hash160(redeemScript);
        const scriptPubKey = bitcoin.script.scriptHash.output.encode(redeemScriptHash);
        address = bitcoin.address.fromOutputScript(scriptPubKey);
      }

      return { redeemScript, witnessScript, address };
    };

    const createInputTx = (key, outputs, inputValue) => {
      const txInputBuilder = new bitcoin.TransactionBuilder();
      txInputBuilder.addInput(Array(32).fill('01').join(''), 0);
      outputs.forEach(({ address }) => txInputBuilder.addOutput(address, inputValue) );
      return txInputBuilder.buildIncomplete();
    };

    [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [1, 1, 1, 1],
      [2, 2, 2, 1]
    ].map(([nP2shInputs, nP2shP2wshInputs, nP2wshInputs, nOutputs], i) => {
      const expectedDim = new utxo.Dimensions({ nP2shInputs, nP2shP2wshInputs, nP2wshInputs, nOutputs });
      const keys = [1, 2, 3].map((v) => HDKey.fromMasterSeed(Buffer(`test/${v}`)));
      const inputValue = 10;

      const unspents = [
        // add outputs of type p2sh (count defined by `nP2shInputs`)
        ..._.times(nP2shInputs, () => createOutput(keys, utxo.chain.codes.p2sh.internal)),
        // add outputs of type p2shP2wsh (count defined by `nP2shP2wshInputs`)
        ..._.times(nP2shP2wshInputs, () => createOutput(keys, utxo.chain.codes.p2shP2wsh.internal)),
        // add outputs of type p2wsh (count defined by `nP2wshInputs`)
        ..._.times(nP2wshInputs, () => createOutput(keys, utxo.chain.codes.p2wsh.internal))
      ];

      const inputTx = createInputTx(keys[0], unspents, inputValue);
      const txBuilder = new bitcoin.TransactionBuilder();
      const totalInputs = nP2shInputs + nP2shP2wshInputs + nP2wshInputs;

      inputTx.outs.forEach(({}, i) => txBuilder.addInput(inputTx, i));
      _.times(expectedDim.nOutputs,
        () => {
          const { address } = createOutput(keys, utxo.chain.codes.p2sh.internal);
          txBuilder.addOutput(address, inputValue);
        }
      );

      it(`calculates dimensions from unsigned transaction ${i}`, function () {
        // does not work for unsigned transactions
        should.throws(() => utxo.Dimensions.fromTransaction(txBuilder.tx));

        // unless explicitly allowed
        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH })
          .should.eql(utxo.Dimensions.sum({ nP2shInputs: totalInputs, nOutputs }));

        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2SH_P2WSH })
          .should.eql(utxo.Dimensions.sum({ nP2shP2wshInputs: totalInputs, nOutputs }));

        utxo.Dimensions.fromTransaction(txBuilder.tx, { assumeUnsigned: utxo.Dimensions.ASSUME_P2WSH })
          .should.eql(utxo.Dimensions.sum({ nP2wshInputs: totalInputs, nOutputs }));
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

      it(`calculates dimensions for signed transaction ${i}`, function () {
        const dimensions = utxo.Dimensions.fromTransaction(signedTx);
        dimensions.should.eql(expectedDim);
        dimensions.getNInputs().should.eql(totalInputs);
      });

      it(`calculates dimensions for signed input of transaction ${i}`, function () {
        // test Dimensions.fromInput()
        [
          ..._.times(nP2shInputs, () => ({ nP2shInputs: 1 })),
          ..._.times(nP2shP2wshInputs, () => ({ nP2shP2wshInputs: 1 })),
          ..._.times(nP2wshInputs, () => ({ nP2wshInputs: 1 }))
        ].forEach((expectedInputDim, i) =>
          utxo.Dimensions.fromInput(signedTx.ins[i]).should.eql(utxo.Dimensions.sum(expectedInputDim))
        );
      });
    });
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
