/* eslint-disable func-names */
/* global describe it beforeEach */
const { ethers } = require('hardhat');
const crypto = require('crypto');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const babyjubjub = require('../../helpers/babyjubjub');
const MerkleTree = require('../../helpers/merkletree');
const { Note, WithdrawNote } = require('../../helpers/note');

let railgunLogic;
let primaryAccount;
let treasuryAccount;
let testERC20;

describe('Logic/RailgunLogic', () => {
  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    [primaryAccount, treasuryAccount] = accounts;

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
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      primaryAccount.address,
    );

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
  });

  it('Should change treasury', async () => {
    expect(await railgunLogic.treasury()).to.equal(treasuryAccount.address);
    await railgunLogic.changeTreasury(ethers.constants.AddressZero);
    expect(await railgunLogic.treasury()).to.equal(ethers.constants.AddressZero);
    await railgunLogic.changeTreasury(primaryAccount.address);
    expect(await railgunLogic.treasury()).to.equal(primaryAccount.address);
  });

  it('Should change fee', async () => {
    expect(await railgunLogic.depositFee()).to.equal(25n);
    expect(await railgunLogic.withdrawFee()).to.equal(25n);
    expect(await railgunLogic.nftFee()).to.equal(25n);

    await railgunLogic.changeFee(5n, 12n, 800n);

    expect(await railgunLogic.depositFee()).to.equal(5n);
    expect(await railgunLogic.withdrawFee()).to.equal(12n);
    expect(await railgunLogic.nftFee()).to.equal(800n);
  });

  /**
   * Get base and fee amount
   *
   * @param {bigint} amount - Amount to calculate for
   * @param {bigint} isInclusive - Whether the amount passed in is inclusive of the fee
   * @param {bigint} feeBP - Fee basis points
   * @returns {Array<bigint>} base, fee
   */
  function getFee(amount, isInclusive, feeBP) {
    const BASIS_POINTS = 10000n;
    let base;
    let fee;

    if (isInclusive) {
      base = (amount * BASIS_POINTS) / (BASIS_POINTS + feeBP);
      fee = amount - base;
    } else {
      base = amount;
      fee = (amount * feeBP) / BASIS_POINTS;
    }

    return [base, fee];
  }

  it('Should calculate fee', async function () {
    let loops = 10n;

    if (process.env.LONG_TESTS) {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    for (let feeBP = 0n; feeBP < loops; feeBP += 1n) {
      for (let i = 1n; i <= 15n; i += 1n) {
        const baseExclusive = BigInt(`0x${crypto.randomBytes(Number(i)).toString('hex')}`);
        const feeExclusive = getFee(baseExclusive, false, feeBP)[1];

        // eslint-disable-next-line no-await-in-loop
        const resultExclusive = await railgunLogic.getFee(baseExclusive, false, feeBP);
        expect(resultExclusive[0]).to.equal(baseExclusive);
        expect(resultExclusive[1]).to.equal(feeExclusive);

        const totalInclusive = baseExclusive + feeExclusive;
        const [baseInclusive, feeInclusive] = getFee(totalInclusive, true, feeBP);

        if (totalInclusive < 2n ** 120n) {
          // eslint-disable-next-line no-await-in-loop
          const resultInclusive = await railgunLogic.getFee(totalInclusive, true, feeBP);
          expect(resultInclusive[0]).to.equal(baseInclusive);
          expect(resultInclusive[1]).to.equal(feeInclusive);
        }
      }

      const baseExclusive = 2n ** 120n - 1n;
      const feeExclusive = getFee(baseExclusive, false, feeBP)[1];

      // eslint-disable-next-line no-await-in-loop
      const resultExclusive = await railgunLogic.getFee(baseExclusive, false, feeBP);
      expect(resultExclusive[0]).to.equal(baseExclusive);
      expect(resultExclusive[1]).to.equal(feeExclusive);

      const totalInclusive = baseExclusive + feeExclusive;
      const [baseInclusive, feeInclusive] = getFee(totalInclusive, true, feeBP);

      if (totalInclusive < 2n ** 120n) {
        // eslint-disable-next-line no-await-in-loop
        const resultInclusive = await railgunLogic.getFee(totalInclusive, true, feeBP);
        expect(resultInclusive[0]).to.equal(baseInclusive);
        expect(resultInclusive[1]).to.equal(feeInclusive);
      }
    }
  });

  it('Should calculate token field', async function () {
    let loops = 10n;

    if (process.env.LONG_TESTS) {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 1000n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const tokenData = {
        tokenType: 0,
        tokenAddress: ethers.utils.keccak256(
          ethers.BigNumber.from(i * loops).toHexString(),
        ).slice(0, 42),
        tokenSubID: i,
      };

      // eslint-disable-next-line no-await-in-loop
      expect(await railgunLogic.getTokenField(tokenData)).to.equal(tokenData.tokenAddress);
    }
  });

  it('Should hash note preimages', async function () {
    let loops = 10n;

    if (process.env.LONG_TESTS) {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const privateKey = babyjubjub.genRandomPrivateKey();
      const viewingKey = babyjubjub.genRandomPrivateKey();
      const token = ethers.utils.keccak256(
        ethers.BigNumber.from(i * loops).toHexString(),
      ).slice(0, 42);

      const note = new Note(
        privateKey,
        viewingKey,
        i,
        BigInt(ethers.utils.keccak256(ethers.BigNumber.from(i).toHexString())),
        BigInt(`${token}`),
      );

      // eslint-disable-next-line no-await-in-loop
      const contractHash = await railgunLogic.hashCommitment({
        npk: note.notePublicKey,
        token: {
          tokenType: 0,
          tokenAddress: token,
          tokenSubID: 0,
        },
        value: note.value,
      });

      expect(contractHash).to.equal(note.hash);
    }
  });

  it('Should deposit ERC20', async function () {
    let loops = 10n;

    if (process.env.LONG_TESTS) {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    const merkletree = new MerkleTree();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    for (let i = 1n; i < loops; i += 1n) {
      // eslint-disable-next-line no-loop-func
      const notes = new Array(Number(i)).fill(1).map((x, index) => new Note(
        babyjubjub.genRandomPrivateKey(),
        babyjubjub.genRandomPrivateKey(),
        i * BigInt(index + 1) * 10n ** 18n,
        babyjubjub.genRandomPoint(),
        BigInt(testERC20.address),
      ));

      const encryptedRandom = new Array(Number(i)).fill(1).map(() => [i, i * 2n]);

      const tokenData = {
        tokenType: 0,
        tokenAddress: testERC20.address,
        tokenSubID: 0,
      };

      // eslint-disable-next-line no-await-in-loop
      const tx = await (await railgunLogic.generateDeposit(notes.map((note) => ({
        npk: note.notePublicKey,
        token: tokenData,
        value: note.value,
      })), encryptedRandom)).wait();

      const insertLeaves = [];

      // eslint-disable-next-line no-loop-func
      tx.events.forEach((event) => {
        if (event.address === railgunLogic.address) {
          expect(event.args.treeNumber).to.equal(0n);
          expect(event.args.startPosition).to.equal(merkletree.leaves.length);

          event.args.commitments.forEach((commitment, index) => {
            const [base, fee] = getFee(
              notes[index].value,
              true,
              depositFee,
            );

            expect(commitment.npk).to.equal(notes[index].notePublicKey);
            expect(BigInt(commitment.token.tokenAddress)).to.equal(notes[index].token);
            expect(commitment.value).to.equal(base);

            insertLeaves.push(new WithdrawNote(
              BigInt(commitment.npk.toHexString()),
              BigInt(commitment.value.toHexString()),
              BigInt(commitment.token.tokenAddress),
            ));

            cumulativeBase += base;
            cumulativeFee += fee;
          });

          event.args.encryptedRandom.forEach((encrypted) => {
            expect(encrypted[0]).to.equal(encrypted[0]);
            expect(encrypted[1]).to.equal(encrypted[1]);
          });
        }
      });

      expect(insertLeaves.length).to.be.greaterThan(0);

      merkletree.insertLeaves(insertLeaves.map((note) => note.hash));

      // eslint-disable-next-line no-await-in-loop
      expect(await railgunLogic.merkleRoot()).to.equal(merkletree.root);

      // eslint-disable-next-line no-await-in-loop
      expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
      // eslint-disable-next-line no-await-in-loop
      expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
    }
  });
});
