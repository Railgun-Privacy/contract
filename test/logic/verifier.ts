import {ethers, network} from 'hardhat';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Note, WithdrawNote} from '../../helpers/logic/note';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {Contract} from 'ethers';
import {
  getKeys,
  loadAllArtifacts,
  artifactConfigs,
  allArtifacts,
} from '../../helpers/logic/snarkKeys';
import {hashBoundParams, dummyTransact, transact} from '../../helpers/logic/transaction';
import {genRandomPrivateKey, genRandomPoint} from '../../helpers/logic/babyjubjub';
import {MerkleTree} from '../../helpers/logic/merkletree';

chai.use(chaiAsPromised);
const {expect} = chai;

let verifier: Contract;
let snarkBypassSigner: SignerWithAddress;
let verifierBypassSigner: Contract;

describe('Logic/Verifier', () => {
  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x000000000000000000000000000000000000dEaD'],
    });
    snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    const VerifierStub = await ethers.getContractFactory('VerifierStub');
    verifier = await VerifierStub.deploy();
    verifierBypassSigner = verifier.connect(snarkBypassSigner);
  });

  it('Should set verifying key', async () => {
    const {solidityVkey} = getKeys(1, 2);

    const setKey = await (await verifier.setVerificationKey(1, 2, solidityVkey)).wait();

    expect(setKey.events[0].event).to.equal('VerifyingKeySet');
    expect(setKey.events[0].args.nullifiers).to.equal(1n);
    expect(setKey.events[0].args.commitments).to.equal(2n);
    expect(setKey.events[0].args.verifyingKey.artifactsIPFSHash).to.equal(
      solidityVkey.artifactsIPFSHash
    );
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

  it('Should hash bound parameters', async function run() {
    let loops = 10n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 1000n;
    }

    for (let i = 1n; i < loops; i += 1n) {
      const vector = {
        treeNumber: 0n,
        withdraw: 1n,
        adaptContract: ethers.utils
          .keccak256(ethers.BigNumber.from(i * loops).toHexString())
          .slice(0, 42),
        adaptParams: ethers.utils.keccak256(ethers.BigNumber.from(i).toHexString()),
        commitmentCiphertext: new Array(Number(i)).fill({
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
          memo: new Array(Number(i - 1n)).fill(
            ethers.utils.keccak256(ethers.BigNumber.from(i + loops * 6n).toHexString())
          ),
        }),
      };

      const jsHash = hashBoundParams(vector);

      // eslint-disable-next-line no-await-in-loop
      const contractHash = await verifier.hashBoundParams(vector);

      expect(contractHash).to.equal(jsHash);
    }
  });

  it('Should verify dummy proofs', async () => {
    await loadAllArtifacts(verifier);

    const artifactsList = artifactConfigs();

    for (let i = 0; i < artifactsList.length; i += 1) {
      const artifactConfig = artifactsList[i];

      const spendingKey = genRandomPrivateKey();
      const viewingKey = genRandomPrivateKey();

      const txTotal = BigInt(artifactConfig.nullifiers) * BigInt(artifactConfig.commitments);

      // eslint-disable-next-line no-loop-func
      const notesIn = new Array(artifactConfig.nullifiers)
        .fill(1)
        .map(
          () =>
            new Note(
              spendingKey,
              viewingKey,
              txTotal / BigInt(artifactConfig.nullifiers),
              genRandomPoint(),
              1n
            )
        );

      // eslint-disable-next-line no-loop-func
      const notesOut = new Array(artifactConfig.commitments)
        .fill(1)
        .map(
          () =>
            new Note(
              genRandomPrivateKey(),
              genRandomPrivateKey(),
              txTotal / BigInt(artifactConfig.commitments),
              genRandomPoint(),
              1n
            )
        );

      const merkletree = new MerkleTree();
      merkletree.insertLeaves(notesIn.map(note => note.hash));

      // eslint-disable-next-line no-await-in-loop
      const tx = await dummyTransact(
        merkletree,
        0n,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        notesIn,
        notesOut,
        new WithdrawNote(0n, 0n, 0n),
        ethers.constants.AddressZero
      );

      // eslint-disable-next-line no-await-in-loop
      expect(await verifierBypassSigner.verify(tx)).to.equal(true);
    }
  });

  it('Should verify proofs', async function run() {
    this.timeout(5 * 60 * 60 * 1000);
    if (!process.env.LONG_TESTS) {
      this.skip();
    }

    await loadAllArtifacts(verifier);

    await Promise.all(
      allArtifacts().map(async (x, nullifiers) =>
        Promise.all(
          x.map(async (y, commitments) => {
            const spendingKey = genRandomPrivateKey();
            const viewingKey = genRandomPrivateKey();

            const txTotal = BigInt(nullifiers) * BigInt(commitments);

            const notesIn = new Array(nullifiers)
              .fill(1)
              .map(
                () =>
                  new Note(
                    spendingKey,
                    viewingKey,
                    txTotal / BigInt(nullifiers),
                    genRandomPoint(),
                    1n
                  )
              );

            const notesOut = new Array(commitments)
              .fill(1)
              .map(
                () =>
                  new Note(
                    genRandomPrivateKey(),
                    genRandomPrivateKey(),
                    txTotal / BigInt(commitments),
                    genRandomPoint(),
                    1n
                  )
              );

            const merkletree = new MerkleTree();
            merkletree.insertLeaves(notesIn.map(note => note.hash));

            const tx = await transact(
              merkletree,
              0n,
              ethers.constants.AddressZero,
              ethers.constants.HashZero,
              notesIn,
              notesOut,
              new WithdrawNote(0n, 0n, 0n),
              ethers.constants.AddressZero
            );

            expect(await verifier.verify(tx)).to.equal(true);
          })
        )
      )
    );
  });

  it("Should throw error if circuit artifacts don't exist", async function run() {
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
        const spendingKey = genRandomPrivateKey();
        const viewingKey = genRandomPrivateKey();

        const txTotal = BigInt(nullifiers) * BigInt(commitments);

        // eslint-disable-next-line no-loop-func
        const notesIn = new Array(nullifiers)
          .fill(1)
          .map(
            () =>
              new Note(spendingKey, viewingKey, txTotal / BigInt(nullifiers), genRandomPoint(), 1n)
          );

        // eslint-disable-next-line no-loop-func
        const notesOut = new Array(commitments)
          .fill(1)
          .map(
            () =>
              new Note(
                genRandomPrivateKey(),
                genRandomPrivateKey(),
                txTotal / BigInt(commitments),
                genRandomPoint(),
                1n
              )
          );

        const merkletree = new MerkleTree();
        merkletree.insertLeaves(notesIn.map(note => note.hash));

        // eslint-disable-next-line no-await-in-loop
        const tx = await dummyTransact(
          merkletree,
          0n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          notesIn,
          notesOut,
          new WithdrawNote(0n, 0n, 0n),
          ethers.constants.AddressZero
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
