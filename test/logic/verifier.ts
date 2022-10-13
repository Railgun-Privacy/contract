import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { hash, edBabyJubJub } from '../../helpers/global/crypto';
import { availableArtifacts, getKeys, loadAllArtifacts } from '../../helpers/logic/artifacts';
import { TokenType, CommitmentCiphertext, Note } from '../../helpers/logic/note';
import { MerkleTree } from '../../helpers/logic/merkletree';
import {
  UnshieldType,
  BoundParams,
  hashBoundParams,
  dummyTransact,
  transact,
} from '../../helpers/logic/transaction';
import {
  arrayToHexString,
  arrayToBigInt,
  bigIntToArray,
  hexStringToArray,
} from '../../helpers/global/bytes';
import { randomBytes } from 'crypto';

describe('Logic/Verifier', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const snarkBypassSigner = await ethers.getImpersonatedSigner(
      '0x000000000000000000000000000000000000dEaD',
    );

    const [, signer1] = await ethers.getSigners();

    const VerifierStub = await ethers.getContractFactory('VerifierStub');
    const verifier = await VerifierStub.deploy();
    const verifierBypassSigner = verifier.connect(snarkBypassSigner);
    const verifier1 = verifier.connect(signer1);

    return {
      snarkBypassSigner,
      verifier,
      verifierBypassSigner,
      verifier1,
    };
  }

  it('Should set verifying key', async () => {
    const { verifier, verifier1 } = await loadFixture(deploy);

    const artifact12 = getKeys(1, 2);

    // Non owner shouldn't be able to set key
    await expect(verifier1.setVerificationKey(1, 2, artifact12.solidityVKey)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Should set key
    await expect(verifier.setVerificationKey(1, 2, artifact12.solidityVKey))
      .to.emit(verifier, 'VerifyingKeySet')
      .withArgs(1, 2, artifact12.eventVKeyMatcher);

    // Retrieve key and check it matches
    const key = await verifier.getVerificationKey(1, 2);
    expect(artifact12.eventVKeyMatcher(key)).to.equal(true);
  });

  it('Should hash bound parameters', async function () {
    const { verifier } = await loadFixture(deploy);

    let loops = 2;

    if (process.env.LONG_TESTS === 'yes') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10;
    }

    for (let i = 0; i < loops; i += 1) {
      const vector: BoundParams = {
        treeNumber: 0,
        unshield: i % 3,
        adaptContract: arrayToHexString(hash.keccak256(new Uint8Array([i])), true).slice(0, 42),
        adaptParams: hash.keccak256(new Uint8Array([i])),
        commitmentCiphertext: new Array(i).fill({
          ciphertext: new Array(4).fill(bigIntToArray(BigInt(i), 32)),
          ephemeralKeys: new Array(2).fill(bigIntToArray(BigInt(i), 32)),
          memo: new Array(i).fill(bigIntToArray(BigInt(i), 32)),
        }) as CommitmentCiphertext[],
      };

      const jsHash = hashBoundParams(vector);

      const contractHash = await verifier.hashBoundParams(vector);

      expect(contractHash).to.equal(arrayToBigInt(jsHash));
    }
  });

  it('Should verify dummy proofs', async () => {
    const { verifier, verifierBypassSigner } = await loadFixture(deploy);

    await loadAllArtifacts(verifier);

    // Loop through each circuit artifact
    for (const artifactConfig of availableArtifacts()) {
      // Get placeholder values
      const spendingKey = edBabyJubJub.genRandomPrivateKey();
      const viewingKey = edBabyJubJub.genRandomPrivateKey();

      // Get total amount
      const txTotal = BigInt(artifactConfig.nullifiers) * BigInt(artifactConfig.commitments);

      // Get notes in
      const notesIn = new Array(artifactConfig.nullifiers).fill(1).map(
        () =>
          new Note(
            spendingKey,
            viewingKey,
            txTotal / BigInt(artifactConfig.nullifiers),
            randomBytes(16),
            {
              tokenType: TokenType.ERC20,
              tokenAddress: ethers.constants.AddressZero,
              tokenSubID: 1n,
            },
            '',
          ),
      );

      // Get notes out
      const notesOut = new Array(artifactConfig.commitments).fill(1).map(
        () =>
          new Note(
            spendingKey,
            viewingKey,
            txTotal / BigInt(artifactConfig.commitments),
            randomBytes(16),
            {
              tokenType: TokenType.ERC20,
              tokenAddress: ethers.constants.AddressZero,
              tokenSubID: 1n,
            },
            '',
          ),
      );

      // Create tree and add notes
      const merkletree = await MerkleTree.createTree();
      await merkletree.insertLeaves(
        await Promise.all(notesIn.map((note) => note.getHash())),
        merkletree.length,
      );

      // Get dummy proof
      const tx = await dummyTransact(
        merkletree,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        hexStringToArray(ethers.constants.HashZero),
        notesIn,
        notesOut,
        ethers.constants.AddressZero,
      );

      // Check that dummy proof check returns true
      expect(await verifierBypassSigner.verify(tx)).to.equal(true);

      // Shouldn't return true if not using bypass
      expect(await verifier.verify(tx)).to.equal(false);
    }
  });

  it('Should verify proofs', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    if (process.env.LONG_TESTS === 'no') this.skip();

    const { verifier } = await loadFixture(deploy);

    await loadAllArtifacts(verifier);

    // Loop through each circuit artifact
    for (const artifactConfig of availableArtifacts()) {
      // Get placeholder values
      const spendingKey = edBabyJubJub.genRandomPrivateKey();
      const viewingKey = edBabyJubJub.genRandomPrivateKey();

      // Get total amount
      const txTotal = BigInt(artifactConfig.nullifiers) * BigInt(artifactConfig.commitments);

      // Get notes in
      const notesIn = new Array(artifactConfig.nullifiers).fill(1).map(
        () =>
          new Note(
            spendingKey,
            viewingKey,
            txTotal / BigInt(artifactConfig.nullifiers),
            randomBytes(16),
            {
              tokenType: TokenType.ERC20,
              tokenAddress: ethers.constants.AddressZero,
              tokenSubID: 1n,
            },
            '',
          ),
      );

      // Get notes out
      const notesOut = new Array(artifactConfig.commitments).fill(1).map(
        () =>
          new Note(
            spendingKey,
            viewingKey,
            txTotal / BigInt(artifactConfig.commitments),
            randomBytes(16),
            {
              tokenType: TokenType.ERC20,
              tokenAddress: ethers.constants.AddressZero,
              tokenSubID: 1n,
            },
            '',
          ),
      );

      // Create tree and add notes
      const merkletree = await MerkleTree.createTree();
      await merkletree.insertLeaves(
        await Promise.all(notesIn.map((note) => note.getHash())),
        merkletree.length,
      );

      // Get proof
      const tx = await transact(
        merkletree,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        hexStringToArray(ethers.constants.HashZero),
        notesIn,
        notesOut,
        ethers.constants.AddressZero,
      );

      // Check that proof check returns true
      expect(await verifier.verify(tx)).to.equal(true);
    }
  });

  it("Should throw error if circuit artifacts don't exist", async function () {
    this.timeout(5 * 60 * 60 * 1000);
    if (process.env.LONG_TESTS === 'no') this.skip();

    const { verifierBypassSigner } = await loadFixture(deploy);

    const limit = 3;

    for (let nullifiers = 1; nullifiers < limit; nullifiers += 1) {
      for (let commitments = 1; commitments < limit; commitments += 1) {
        // Get placeholder values
        const spendingKey = edBabyJubJub.genRandomPrivateKey();
        const viewingKey = edBabyJubJub.genRandomPrivateKey();

        // Get total amount
        const txTotal = BigInt(nullifiers) * BigInt(commitments);

        // Get notes in
        const notesIn = new Array(nullifiers).fill(1).map(
          () =>
            new Note(
              spendingKey,
              viewingKey,
              txTotal / BigInt(nullifiers),
              randomBytes(16),
              {
                tokenType: TokenType.ERC20,
                tokenAddress: ethers.constants.AddressZero,
                tokenSubID: 1n,
              },
              '',
            ),
        );

        // Get notes out
        const notesOut = new Array(commitments).fill(1).map(
          () =>
            new Note(
              spendingKey,
              viewingKey,
              txTotal / BigInt(commitments),
              randomBytes(16),
              {
                tokenType: TokenType.ERC20,
                tokenAddress: ethers.constants.AddressZero,
                tokenSubID: 1n,
              },
              '',
            ),
        );

        // Create tree and add notes
        const merkletree = await MerkleTree.createTree();
        await merkletree.insertLeaves(
          await Promise.all(notesIn.map((note) => note.getHash())),
          merkletree.length,
        );

        // Get dummy proof
        const tx = await dummyTransact(
          merkletree,
          UnshieldType.NONE,
          ethers.constants.AddressZero,
          hexStringToArray(ethers.constants.HashZero),
          notesIn,
          notesOut,
          ethers.constants.AddressZero,
        );

        await expect(verifierBypassSigner.verify(tx)).to.be.revertedWith('Verifier: Key not set');
      }
    }
  });
});
