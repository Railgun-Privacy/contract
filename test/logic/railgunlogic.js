/* eslint-disable func-names */
/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const crypto = require('crypto');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const artifacts = require('../../helpers/snarkKeys');
const babyjubjub = require('../../helpers/babyjubjub');
const MerkleTree = require('../../helpers/merkletree');
const { Note } = require('../../helpers/note');
const transaction = require('../../helpers/transaction');
const NoteRegistry = require('../../helpers/noteregistry');

let snarkBypassSigner;
let railgunLogic;
let railgunLogicBypassSigner;
let primaryAccount;
let treasuryAccount;
let testERC20;
let testERC20BypassSigner;

describe('Logic/RailgunLogic', () => {
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
    railgunLogicBypassSigner = railgunLogic.connect(snarkBypassSigner);

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n / 2n);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunLogic.address, 2n ** 256n - 1n);
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

  it('Should calculate fee', async function () {
    let loops = 5n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    for (let feeBP = 0n; feeBP < loops; feeBP += 1n) {
      for (let i = 1n; i <= 15n; i += 1n) {
        const baseExclusive = BigInt(`0x${crypto.randomBytes(Number(i)).toString('hex')}`);
        const feeExclusive = transaction.getFee(baseExclusive, false, feeBP)[1];

        // eslint-disable-next-line no-await-in-loop
        const resultExclusive = await railgunLogic.getFee(baseExclusive, false, feeBP);
        expect(resultExclusive[0]).to.equal(baseExclusive);
        expect(resultExclusive[1]).to.equal(feeExclusive);

        const totalInclusive = baseExclusive + feeExclusive;
        const [baseInclusive, feeInclusive] = transaction.getFee(totalInclusive, true, feeBP);

        if (totalInclusive < 2n ** 120n) {
          // eslint-disable-next-line no-await-in-loop
          const resultInclusive = await railgunLogic.getFee(totalInclusive, true, feeBP);
          expect(resultInclusive[0]).to.equal(baseInclusive);
          expect(resultInclusive[1]).to.equal(feeInclusive);
        }
      }

      const baseExclusive = 2n ** 120n - 1n;
      const feeExclusive = transaction.getFee(baseExclusive, false, feeBP)[1];

      // eslint-disable-next-line no-await-in-loop
      const resultExclusive = await railgunLogic.getFee(baseExclusive, false, feeBP);
      expect(resultExclusive[0]).to.equal(baseExclusive);
      expect(resultExclusive[1]).to.equal(feeExclusive);

      const totalInclusive = baseExclusive + feeExclusive;
      const [baseInclusive, feeInclusive] = transaction.getFee(totalInclusive, true, feeBP);

      if (totalInclusive < 2n ** 120n) {
        // eslint-disable-next-line no-await-in-loop
        const resultInclusive = await railgunLogic.getFee(totalInclusive, true, feeBP);
        expect(resultInclusive[0]).to.equal(baseInclusive);
        expect(resultInclusive[1]).to.equal(feeInclusive);
      }
    }
  });

  it('Should calculate token field', async () => {
    const loops = 3n;

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
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
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
    let loops = 2n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 100n;
    }

    const merkletree = new MerkleTree();
    const testERC20noteregistry = new NoteRegistry();

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

      let eventCounter = 0;

      // eslint-disable-next-line no-loop-func
      tx.events.forEach((event) => {
        if (event.event === 'GeneratedCommitmentBatch') {
          eventCounter += 1;
          expect(event.args.treeNumber).to.equal(0n);
          expect(event.args.startPosition).to.equal(merkletree.leaves.length);

          event.args.commitments.forEach((commitment, index) => {
            const [base, fee] = transaction.getFee(
              notes[index].value,
              true,
              depositFee,
            );

            expect(commitment.npk).to.equal(notes[index].notePublicKey);
            expect(BigInt(commitment.token.tokenAddress)).to.equal(notes[index].token);
            expect(commitment.value).to.equal(base);

            cumulativeBase += base;
            cumulativeFee += fee;
          });

          event.args.encryptedRandom.forEach((encrypted) => {
            expect(encrypted[0]).to.equal(encrypted[0]);
            expect(encrypted[1]).to.equal(encrypted[1]);
          });
        }
      });

      expect(eventCounter).to.equal(1);

      // Parse events
      testERC20noteregistry.parseEvents(tx, merkletree);

      // eslint-disable-next-line no-await-in-loop
      expect(await railgunLogic.merkleRoot()).to.equal(merkletree.root);
      // eslint-disable-next-line no-await-in-loop
      expect(await railgunLogic.rootHistory(0, merkletree.root)).to.equal(true);

      // eslint-disable-next-line no-await-in-loop
      expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
      // eslint-disable-next-line no-await-in-loop
      expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
    }
  });

  it('Should transfer ERC20', async function () {
    let loops = 2n;
    let transactionCreator = transaction.dummyTransact;
    let railgunLogicContract = railgunLogicBypassSigner;

    const artifactsList = [];
    artifacts.allArtifacts().forEach((x, nullifiers) => {
      x.forEach((y, commitments) => {
        artifactsList.push({ nullifiers, commitments });
      });
    });

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transaction.transact;
      railgunLogicContract = railgunLogic;
      loops = 2n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transaction.transact;
      railgunLogicContract = railgunLogic;
      loops = 10n;
    }

    await artifacts.loadAllArtifacts(railgunLogic);

    const tokenData = {
      tokenType: 0,
      tokenAddress: testERC20.address,
      tokenSubID: 0,
    };

    const merkletree = new MerkleTree();
    const testERC20noteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    for (let i = 1n; i - 1n < loops; i += 1n) {
      for (let j = 0; j < artifactsList.length; j += 1) {
        const artifactConfig = artifactsList[j];
        const spendingKey = babyjubjub.genRandomPrivateKey();
        const viewingKey = babyjubjub.genRandomPrivateKey();

        const total = BigInt(artifactConfig.nullifiers) * BigInt(artifactConfig.commitments)
          * i * 10n ** 18n;

        const depositNotes = new Array(artifactConfig.nullifiers).fill(1).map(
          // eslint-disable-next-line no-loop-func
          () => new Note(
            spendingKey,
            viewingKey,
            total / BigInt(artifactConfig.nullifiers),
            babyjubjub.genRandomPoint(),
            BigInt(testERC20.address),
          ),
        );

        const encryptedRandom = new Array(artifactConfig.nullifiers).fill(1).map(() => [0n, 0n]);

        // eslint-disable-next-line
        const depositTx = await(await railgunLogicContract.generateDeposit(depositNotes.map((note) => ({
          npk: note.notePublicKey,
          token: tokenData,
          value: note.value,
        })), encryptedRandom)).wait();

        // Parse events
        testERC20noteregistry.parseEvents(depositTx, merkletree);
        const [base, fee] = testERC20noteregistry.loadNotesWithFees(depositNotes, depositFee);
        cumulativeBase += base;
        cumulativeFee += fee;

        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

        const [transferNotesIn, transferNotesOut] = testERC20noteregistry.getNotes(
          artifactConfig.nullifiers,
          artifactConfig.commitments,
          spendingKey,
          viewingKey,
        );

        // eslint-disable-next-line no-await-in-loop
        const tx = await transactionCreator(
          merkletree,
          0n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          transferNotesIn,
          transferNotesOut,
          new Note(0n, 0n, 0n, 0n, 0n),
          ethers.constants.AddressZero,
        );

        // eslint-disable-next-line no-await-in-loop
        const result = await (await railgunLogicContract.transact([tx])).wait();

        // Parse events
        testERC20noteregistry.parseEvents(result, merkletree);
        testERC20noteregistry.loadNotes(transferNotesOut);

        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogic.merkleRoot()).to.equal(merkletree.root);
        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogic.rootHistory(0, merkletree.root)).to.equal(true);

        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

        // Shouldn't be able to double spend
        expect(railgunLogicContract.transact([tx])).to.eventually.be.rejectedWith('RailgunLogic: Nullifier already seen');
      }
    }
  });
});
