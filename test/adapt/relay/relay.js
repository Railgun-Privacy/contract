/* eslint-disable func-names */
/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

const relayAdaptHelper = require('../../../helpers/adapt/relay/relayadapt');
const babyjubjub = require('../../../helpers/logic/babyjubjub');
const MerkleTree = require('../../../helpers/logic/merkletree');
const { Note } = require('../../../helpers/logic/note');
const transaction = require('../../../helpers/logic/transaction');

chai.use(chaiAsPromised);

const { expect } = chai;

let snarkBypassSigner;
let treasuryAccount;
let testERC20;
let railgunLogic;
let relayAdapt;

describe('Adapt/Relay', () => {
  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: ['0x000000000000000000000000000000000000dEaD', '0x56BC75E2D63100000'],
    });
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x000000000000000000000000000000000000dEaD'],
    });
    snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    const accounts = await ethers.getSigners();
    [treasuryAccount] = accounts;

    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    railgunLogic = await RailgunLogic.deploy();
    railgunLogic = railgunLogic.connect(snarkBypassSigner);
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      treasuryAccount.address,
    );

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n - 1n);
    testERC20 = testERC20.connect(snarkBypassSigner);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
    // @todo replace testerc20.address with bytecode deployment of IWBASE
    relayAdapt = await RelayAdapt.deploy(railgunLogic.address, testERC20.address);
  });

  it('Should calculate adapt params', async function () {
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const merkletree = new MerkleTree();
      const spendingKey = babyjubjub.genRandomPrivateKey();
      const viewingKey = babyjubjub.genRandomPrivateKey();
      const token = ethers.utils.keccak256(
        ethers.BigNumber.from(i * loops).toHexString(),
      ).slice(0, 42);

      const notes = new Array(12).fill(1).map(
        // eslint-disable-next-line no-loop-func
        () => new Note(
          spendingKey,
          viewingKey,
          i * 10n ** 18n,
          babyjubjub.genRandomPoint(),
          BigInt(token),
        ),
      );

      merkletree.insertLeaves(notes.map((note) => note.hash));

      // eslint-disable-next-line no-await-in-loop
      const tx = await transaction.dummyTransact(
        merkletree,
        0n,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        notes,
        notes,
        new Note(0n, 0n, 0n, 0n, 0n),
        ethers.constants.AddressZero,
      );

      // eslint-disable-next-line no-await-in-loop
      expect(await relayAdapt.getAdaptParams([tx], '0x')).to.equal(relayAdaptHelper.getAdaptParams([tx], '0x'));
    }
  });

  it('Should calculate relay adapt params', async function () {
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const merkletree = new MerkleTree();
      const spendingKey = babyjubjub.genRandomPrivateKey();
      const viewingKey = babyjubjub.genRandomPrivateKey();
      const token = ethers.utils.keccak256(
        ethers.BigNumber.from(i * loops).toHexString(),
      ).slice(0, 42);

      const notes = new Array(12).fill(1).map(
        // eslint-disable-next-line no-loop-func
        () => new Note(
          spendingKey,
          viewingKey,
          i * 10n ** 18n,
          babyjubjub.genRandomPoint(),
          BigInt(token),
        ),
      );

      merkletree.insertLeaves(notes.map((note) => note.hash));

      // eslint-disable-next-line no-await-in-loop
      const tx = await transaction.dummyTransact(
        merkletree,
        0n,
        ethers.constants.AddressZero,
        ethers.constants.HashZero,
        notes,
        notes,
        new Note(0n, 0n, 0n, 0n, 0n),
        ethers.constants.AddressZero,
      );

      // eslint-disable-next-line no-await-in-loop
      expect(await relayAdapt.getAdaptParams([tx], '0x')).to.equal(relayAdaptHelper.getAdaptParams([tx], '0x'));
    }
  });
});
