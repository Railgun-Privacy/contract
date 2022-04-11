/* eslint-disable func-names */
/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const artifacts = require('../../helpers/snarkKeys');
const babyjubjub = require('../../helpers/babyjubjub');
const MerkleTree = require('../../helpers/merkletree');
const { Note } = require('../../helpers/note');
const transaction = require('../../helpers/transaction');

let verifier;
let snarkBypassSigner;
let verifierBypassSigner;

describe('Logic/Verifier', () => {
  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [ethers.constants.AddressZero],
    });
    snarkBypassSigner = await ethers.getSigner(ethers.constants.AddressZero);

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

    if (process.env.LONG_TESTS) {
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

  /**
   * Loads all available artifacts into verifier contract
   *
   * @param {ethers.Contract} verifierContract - verifier Contract
   */
  async function loadAllArtifacts(verifierContract) {
    await Promise.all(
      artifacts.allArtifacts().map(
        async (x, nullifiers) => Promise.all(x.map(async (y, commitments) => {
          await verifierContract.setVerificationKey(nullifiers, commitments, y.solidityVkey);
        })),
      ),
    );
  }

  it('Should verify dummy proofs', async () => {
    await loadAllArtifacts(verifier);

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
          expect(await verifierBypassSigner.verify(tx)).to.equal(true);
        })),
      ),
    );
  });

  it('Should verify proofs', async function () {
    if (!process.env.LONG_TESTS) {
      this.skip();
    }

    await loadAllArtifacts(verifier);

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
});
