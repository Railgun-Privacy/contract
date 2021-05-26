/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
/* global overwriteArtifact ethers */
const hre = require('hardhat');
const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
const { MerkleTree } = require('railgun-privacy.js');
const { assert } = require('chai');

// This test is run seperately to the mocha suite as it is long running

// Define test parameters
const testrounds = 3;
const treesize = 16;
const treelimit = 2 ** treesize;
const batchsize = 3;
const commitment = {
  hash: 1n,
  ciphertext: [1n, 1n, 1n, 1n, 1n, 1n],
  senderPubKey: [1n, 1n],
};

async function main() {
  await hre.run('compile');

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
  const PoseidonT6 = await ethers.getContractFactory('PoseidonT6');
  const poseidonT6 = await PoseidonT6.deploy();

  // Deploy commitments contract
  const Commitments = await ethers.getContractFactory('CommitmentsStub', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT6: poseidonT6.address,
    },
  });

  const commitments = await Commitments.deploy();

  await commitments.initializeCommitmentsStub({
    gasLimit: 4000000,
  });

  // Run test
  for (let fills = 0; fills < testrounds; fills += 1) {
    /* eslint-disable no-await-in-loop */
    // Create MerkleTree
    const merkleTree = new MerkleTree(treesize);

    // Fill tree
    while ((treelimit - merkleTree.tree[0].length) > batchsize) {
      // Insert leaves
      await commitments.addCommitmentsStub(Array(batchsize).fill(commitment));

      // Check merkle tree is still in sync
      merkleTree.insertLeaves(Array(batchsize).fill(commitment.hash));

      assert((await commitments.merkleRoot()).toString() === merkleTree.root.toString());

      // Log progress
      console.log(`Filled ${merkleTree.tree[0].length} elements in tree ${fills}`);
    }

    if (treelimit - merkleTree.tree[0].length !== 0) {
      // Inser remaining leaves into tree
      await commitments.addCommitmentsStub(
        Array(treelimit - merkleTree.tree[0].length).fill(commitment),
      );

      // Check merkle tree is still in sync
      merkleTree.insertLeaves(Array(treelimit - merkleTree.tree[0].length).fill(commitment.hash));
      assert((await commitments.merkleRoot()).toString() === merkleTree.root.toString());

      // Log progress
      console.log(`Filled ${merkleTree.tree[0].length} elements in tree ${fills}`);
    }
    /* eslint-enable no-await-in-loop */
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
