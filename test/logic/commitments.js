/* eslint-disable func-names */
/* global describe it beforeEach */
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const { poseidon } = require('circomlibjs');

const MerkleTree = require('../../helpers/logic/merkletree');

let commitmentsStub;
let merkletree;

describe('Logic/Commitments', () => {
  beforeEach(async () => {
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const poseidonT3 = await PoseidonT3.deploy();

    const CommitmentsStub = await ethers.getContractFactory('CommitmentsStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
      },
    });
    commitmentsStub = await CommitmentsStub.deploy();

    merkletree = new MerkleTree();
  });

  it('Should calculate zero values', async () => {
    await expect(await commitmentsStub.ZERO_VALUE()).to.equal(MerkleTree.zeroValue);

    await Promise.all(merkletree.zeros.map(async (zeroValue, level) => {
      expect(await commitmentsStub.zeros(level)).to.equal(zeroValue);
    }));
  });

  it('Should calculate empty root', async () => {
    await expect(await commitmentsStub.merkleRoot()).to.equal(merkletree.root);
  });

  it('Should hash left/right pairs', async () => {
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      loops = 100n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const left = poseidon([i]);
      const right = poseidon([i, 10000n]);
      const result = poseidon([left, right]);

      // eslint-disable-next-line no-await-in-loop
      expect(await commitmentsStub.hashLeftRight(left, right)).to.equal(result);
    }
  });

  it('Should incrementally insert elements', async function () {
    let loops = 5n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    const insertList = [];
    for (let i = 0n; i < loops; i += 1n) {
      insertList.push(i);

      // eslint-disable-next-line no-await-in-loop
      await commitmentsStub.insertLeavesStub(insertList);
      merkletree.insertLeaves(insertList);

      // eslint-disable-next-line no-await-in-loop
      expect(await commitmentsStub.merkleRoot()).to.equal(merkletree.root);
    }
  });

  it('Should roll over to new tree', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    if (process.env.LONG_TESTS !== 'complete') {
      this.skip();
    }

    const steps = 500;

    expect(await commitmentsStub.treeNumber()).to.equal(0n);

    // eslint-disable-next-line no-console
    console.log('\n      FILLING TREE\n');
    for (let i = 0; i < 2 ** 16; i += steps) {
      // eslint-disable-next-line no-console
      console.log(`      Filled ${i}/${2 ** 16}`);
      // eslint-disable-next-line no-await-in-loop
      await commitmentsStub.insertLeavesStub((new Array(steps)).fill(1n));
    }
    // eslint-disable-next-line no-console
    console.log('\n      TREE FILLED\n');

    await commitmentsStub.insertLeavesStub((new Array(steps)).fill(1n));
    expect(await commitmentsStub.treeNumber()).to.equal(1n);
  });
});
