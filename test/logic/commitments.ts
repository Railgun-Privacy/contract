import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { arrayToBigInt } from '../../helpers/global/bytes';
import { hash } from '../../helpers/global/crypto';
import { MerkleTree } from '../../helpers/logic/merkletree';

describe('Logic/Commitments', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const poseidonT3 = await PoseidonT3.deploy();

    const CommitmentsStub = await ethers.getContractFactory('CommitmentsStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
      },
    });
    const commitments = await CommitmentsStub.deploy();

    const merkletree = await MerkleTree.createTree();

    return {
      commitments,
      merkletree,
    };
  }

  it('Should calculate zero values', async () => {
    const { commitments, merkletree } = await loadFixture(deploy);

    // Zero value should be the same
    expect(await commitments.ZERO_VALUE()).to.equal(arrayToBigInt(MerkleTree.zeroValue));

    // Each value in the zero values array should be the same
    await Promise.all(
      merkletree.zeros.map(async (zeroValue, level) => {
        expect(await commitments.zeros(level)).to.equal(arrayToBigInt(zeroValue));
      }),
    );
  });

  it('Should calculate empty root', async () => {
    const { commitments, merkletree } = await loadFixture(deploy);

    // Should initialize empty root correctly
    expect(await commitments.merkleRoot()).to.equal(arrayToBigInt(merkletree.root));
  });

  it('Should hash left/right pairs', async () => {
    let loops = 1;

    if (process.env.LONG_TESTS === 'extra') {
      loops = 10;
    } else if (process.env.LONG_TESTS === 'complete') {
      loops = 100;
    }

    const { commitments } = await loadFixture(deploy);

    for (let i = 0; i < loops; i += 1) {
      // Create left/right test values
      const left = await hash.poseidon([new Uint8Array([i])]);
      const right = await hash.poseidon([new Uint8Array([i]), new Uint8Array([1])]);

      // Get expected result
      const result = await hash.poseidon([left, right]);

      // Check if hash function on contract returns same value
      expect(await commitments.hashLeftRight(left, right)).to.equal(arrayToBigInt(result));
    }
  });

  it('Should incrementally insert elements', async function () {
    let loops = 2;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 5;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10;
    }

    const { commitments, merkletree } = await loadFixture(deploy);

    const insertList = [];
    for (let i = 0; i < loops; i += 1) {
      // Add another element to insert list
      insertList.push(new Uint8Array([i]));

      // Update with insert list on local and contract
      await commitments.insertLeavesStub(insertList.map(arrayToBigInt));
      await merkletree.insertLeaves(insertList);

      // Check roots match
      expect(await commitments.merkleRoot()).to.equal(arrayToBigInt(merkletree.root));

      // Check tree length matches
      expect(await commitments.nextLeafIndex()).to.equal(merkletree.length);
    }
  });

  it('Should roll over to new tree', async function () {
    const { commitments } = await loadFixture(deploy);

    // Check tree number is 0
    expect(await commitments.treeNumber()).to.equal(0);

    // Set next leaf index to filled tree
    await commitments.setNextLeafIndex(2 ** 16);

    // Insert leaf hash
    await commitments.insertLeavesStub([1]);

    // Check tree number is 1
    expect(await commitments.treeNumber()).to.equal(1);
  });
});
