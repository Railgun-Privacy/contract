/* eslint-disable func-names */
/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const artifacts = require('../../helpers/logic/snarkKeys');
const babyjubjub = require('../../helpers/logic/babyjubjub');
const MerkleTree = require('../../helpers/logic/merkletree');
const { Note } = require('../../helpers/logic/note');
const transaction = require('../../helpers/logic/transaction');

let verifier;
let snarkBypassSigner;
let verifierBypassSigner;

describe('Logic/Verifier', () => {
  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x000000000000000000000000000000000000dEaD'],
    });
    snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    const VerifierStub = await ethers.getContractFactory('VerifierStub');
    verifier = await VerifierStub.deploy();
    verifierBypassSigner = verifier.connect(snarkBypassSigner);
  });

  it('Should set verifying key', async () => {
    const { solidityVkey } = artifacts.getKeys(1, 2);

    const setKey = await (await verifier.setVerificationKey(1, 2, solidityVkey)).wait();

    expect(setKey.events[0].event).to.equal('VerifyingKeySet');
    expect(setKey.events[0].args.nullifiers).to.equal(1n);
    expect(setKey.events[0].args.commitments).to.equal(2n);
    expect(
      setKey.events[0].args.verifyingKey.artifactsIPFSHash,
    ).to.equal(solidityVkey.artifactsIPFSHash);
    expect(setKey.events[0].args.verifyingKey.alpha1.x).to.equal(solidityVkey.alpha1.x);
    expect(setKey.events[0].args.verifyingKey.beta2.x[0]).to.equal(solidityVkey.beta2.x[0]);
    expect(setKey.events[0].args.verifyingKey.delta2.x[0]).to.equal(solidityVkey.delta2.x[0]);
    expect(setKey.events[0].args.verifyingKey.gamma2.x[0]).to.equal(solidityVkey.gamma2.x[0]);
    expect(setKey.events[0].args.verifyingKey.ic[0].x).to.equal(solidityVkey.ic[0].x);

    const key = await verifier.getVerificationKey(1n, 2n);

    expect(key.artifactsIPFSHash).to.equal(solidityVkey.artifactsIPFSHash);
    expect(key.alpha1.x).to.equal(solidityVkey.alpha1.x);
    expect(key.beta2.x[0]).to.equal(solidityVkey.beta2.x[0]);
    expect(key.delta2.x[0]).to.equal(solidityVkey.delta2.x[0]);
    expect(key.gamma2.x[0]).to.equal(solidityVkey.gamma2.x[0]);
    expect(key.ic[0].x).to.equal(solidityVkey.ic[0].x);
  });

  it('Should hash bound parameters', async function () {
    let loops = 10n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 1000n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const vector = {
        treeNumber: 0n,
        withdraw: 1n,
        adaptContract: ethers.utils.keccak256(
          ethers.BigNumber.from(i * loops).toHexString(),
        ).slice(0, 42),
        adaptParams: ethers.utils.keccak256(ethers.BigNumber.from(i).toHexString()),
        commitmentCiphertext: new Array(i).fill({
          ciphertext: [
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 0n).toHexString()),
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 1n).toHexString()),
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 2n).toHexString()),
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 3n).toHexString()),
          ],
          ephemeralKeys: [
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 4n).toHexString()),
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 5n).toHexString()),
          ],
          memo: new Array(i - 1n).fill(
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 6n).toHexString()),
          ),
        }),
      };

      const jsHash = transaction.hashBoundParams(vector);

      // eslint-disable-next-line no-await-in-loop
      const contractHash = await verifier.hashBoundParams(vector);

      expect(contractHash).to.equal(jsHash);
    }
  });

  it('Should verify dummy proofs', async () => {
    await artifacts.loadAllArtifacts(verifier);

    const artifactsList = artifacts.artifactConfigs();

    for (let i = 0; i < artifactsList.length; i += 1) {
      const artifactConfig = artifactsList[i];

      const spendingKey = babyjubjub.genRandomPrivateKey();
      const viewingKey = babyjubjub.genRandomPrivateKey();

      const txTotal = BigInt(artifactConfig.nullifiers) * BigInt(artifactConfig.commitments);

      // eslint-disable-next-line no-loop-func
      const notesIn = new Array(artifactConfig.nullifiers).fill(1).map(() => new Note(
        spendingKey,
        viewingKey,
        txTotal / BigInt(artifactConfig.nullifiers),
        babyjubjub.genRandomPoint(),
        1n,
      ));

      // eslint-disable-next-line no-loop-func
      const notesOut = new Array(artifactConfig.commitments).fill(1).map(() => new Note(
        babyjubjub.genRandomPrivateKey(),
        babyjubjub.genRandomPrivateKey(),
        txTotal / BigInt(artifactConfig.commitments),
        babyjubjub.genRandomPoint(),
        1n,
      ));

      const merkletree = new MerkleTree();
      merkletree.insertLeaves(notesIn.map((note) => note.hash));

      // eslint-disable-next-line no-await-in-loop
      const tx = await transaction.dummyTransact(
        merkletree,
        0n,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        notesIn,
        notesOut,
        new Note(0n, 0n, 0n, 0n, 0n),
        ethers.constants.AddressZero,
      );

      // eslint-disable-next-line no-await-in-loop
      expect(await verifierBypassSigner.verify(tx)).to.equal(true);
    }
  });

  it('Should verify proofs', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    if (!process.env.LONG_TESTS) {
      this.skip();
    }

    await artifacts.loadAllArtifacts(verifier);

    await Promise.all(
      artifacts.allArtifacts().map(
        async (x, nullifiers) => Promise.all(x.map(async (y, commitments) => {
          const spendingKey = babyjubjub.genRandomPrivateKey();
          const viewingKey = babyjubjub.genRandomPrivateKey();

          const txTotal = BigInt(nullifiers) * BigInt(commitments);

          const notesIn = new Array(nullifiers).fill(1).map(() => new Note(
            spendingKey,
            viewingKey,
            txTotal / BigInt(nullifiers),
            babyjubjub.genRandomPoint(),
            1n,
          ));

          const notesOut = new Array(commitments).fill(1).map(() => new Note(
            babyjubjub.genRandomPrivateKey(),
            babyjubjub.genRandomPrivateKey(),
            txTotal / BigInt(commitments),
            babyjubjub.genRandomPoint(),
            1n,
          ));

          const merkletree = new MerkleTree();
          merkletree.insertLeaves(notesIn.map((note) => note.hash));

          const tx = await transaction.transact(
            merkletree,
            0n,
            ethers.constants.AddressZero,
            ethers.constants.HashZero,
            notesIn,
            notesOut,
            new Note(0n, 0n, 0n, 0n, 0n),
            ethers.constants.AddressZero,
          );

          expect(await verifier.verify(tx)).to.equal(true);
        })),
      ),
    );
  });

  it('Should throw error if circuit artifacts don\'t exist', async function () {
    this.timeout(5 * 60 * 60 * 1000);

    let limit = 2;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      limit = 4;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      limit = 20;
    }

    for (let nullifiers = 1; nullifiers < limit; nullifiers += 1) {
      for (let commitments = 1; commitments < limit; commitments += 1) {
        const spendingKey = babyjubjub.genRandomPrivateKey();
        const viewingKey = babyjubjub.genRandomPrivateKey();

        const txTotal = BigInt(nullifiers) * BigInt(commitments);

        // eslint-disable-next-line no-loop-func
        const notesIn = new Array(nullifiers).fill(1).map(() => new Note(
          spendingKey,
          viewingKey,
          txTotal / BigInt(nullifiers),
          babyjubjub.genRandomPoint(),
          1n,
        ));

        // eslint-disable-next-line no-loop-func
        const notesOut = new Array(commitments).fill(1).map(() => new Note(
          babyjubjub.genRandomPrivateKey(),
          babyjubjub.genRandomPrivateKey(),
          txTotal / BigInt(commitments),
          babyjubjub.genRandomPoint(),
          1n,
        ));

        const merkletree = new MerkleTree();
        merkletree.insertLeaves(notesIn.map((note) => note.hash));

        // eslint-disable-next-line no-await-in-loop
        const tx = await transaction.dummyTransact(
          merkletree,
          0n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          notesIn,
          notesOut,
          new Note(0n, 0n, 0n, 0n, 0n),
          ethers.constants.AddressZero,
        );

        // eslint-disable-next-line max-len
        // await expect(verifierBypassSigner.verify(tx)).to.eventually.throw('Verifier: Key not set');
        // eslint-disable-next-line no-await-in-loop
        await expect(verifierBypassSigner.verify(tx)).to.eventually.throw;
        // NOTE:
        // This is throwing the expected error but due to https://github.com/ethers-io/ethers.js/discussions/2849
        // The error message from hardhat isn't being parsed correctly
        // Switch back to error checking when patched
        // @todo
      }
    }
  });
});
