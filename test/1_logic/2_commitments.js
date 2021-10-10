/* eslint-disable no-await-in-loop */
/* global describe it beforeEach overwriteArtifact ethers */
const { expect } = require('chai');
const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
const { MerkleTree } = require('railgun-privacy.js');

let commitments;

describe('Logic/Commitments', () => {
  beforeEach(async () => {
    // Deploy Poseidon library
    await overwriteArtifact(
      'PoseidonT3',
      poseidonGenContract.createCode(2),
    );

    await overwriteArtifact(
      'PoseidonT6',
      poseidonGenContract.createCode(5),
    );

    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const poseidonT3 = await PoseidonT3.deploy();

    // Deploy commitments contract
    const Commitments = await ethers.getContractFactory('CommitmentsStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
      },
    });

    commitments = await Commitments.deploy();

    await commitments.initializeCommitmentsStub({
      gasLimit: 1000000,
    });
  });

  it('Should initialize the tree correctly', async () => {
    const merkleTree = new MerkleTree();

    expect(
      (await commitments.merkleRoot()),
    ).to.deep.equal(
      merkleTree.root,
    );
  });

  it('Should update the tree correctly', async () => {
    const merkleTree = new MerkleTree();

    expect(
      (await commitments.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    for (let i = 1; i < 30; i += 1) {
      const insertionArray = [];
      for (let j = 0; j < i; j += 1) { insertionArray.push(Math.floor(Math.random() * 2 ** 20)); }

      await commitments.insertLeavesStub(insertionArray);
      merkleTree.insertLeaves(insertionArray);

      expect(
        (await commitments.merkleRoot()),
      ).to.equal(
        merkleTree.root,
      );
    }
  });
});
