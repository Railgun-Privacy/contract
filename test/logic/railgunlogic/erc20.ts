import {network, ethers} from 'hardhat';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {Note, WithdrawNote} from '../../../helpers/logic/note';
import {Contract, Event} from 'ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {MerkleTree} from '../../../helpers/logic/merkletree';
import {NoteRegistry} from '../../../helpers/logic/note-registry';
import {genRandomPrivateKey, genRandomPoint} from '../../../helpers/logic/babyjubjub';
import {artifactConfigs, loadAllArtifacts} from '../../../helpers/logic/snarkKeys';
import {getFee, dummyTransact, transact} from '../../../helpers/logic/transaction';
import {CommitmentPreimageArgs, SerializedTransaction} from '../../../helpers/types/types';

chai.use(chaiAsPromised);

const {expect} = chai;

let snarkBypassSigner: SignerWithAddress;
let railgunLogic: Contract;
let railgunLogicBypassSigner: Contract;
let primaryAccount: SignerWithAddress;
let treasuryAccount: SignerWithAddress;
let redirectAccount: SignerWithAddress;
let testERC20: Contract;
let testERC20BypassSigner: Contract;

describe('Logic/RailgunLogic/ERC20', () => {
  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_setBalance',
      params: ['0x000000000000000000000000000000000000dEaD', '0x56BC75E2D63100000'],
    });
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x000000000000000000000000000000000000dEaD'],
    });
    snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    const accounts = await ethers.getSigners();
    [primaryAccount, treasuryAccount, redirectAccount] = accounts;

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
      primaryAccount.address
    );
    railgunLogicBypassSigner = railgunLogic.connect(snarkBypassSigner);

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n / 2n);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunLogic.address, 2n ** 256n - 1n);
  });

  it('Should deposit ERC20', async function run() {
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

    const testERC20Address = testERC20.address;

    for (let i = 1n; i < loops; i += 1n) {
      const notes = new Array(Number(i))
        .fill(1)
        .map(
          (x, index) =>
            new Note(
              genRandomPrivateKey(),
              genRandomPrivateKey(),
              i * BigInt(index + 1) * 10n ** 18n,
              genRandomPoint(),
              BigInt(testERC20Address)
            )
        );

      const encryptedRandom = await Promise.all(notes.map(note => note.encryptRandom()));

      const tokenData = {
        tokenType: 0,
        tokenAddress: testERC20.address,
        tokenSubID: 0,
      };

      const tx = await (
        await railgunLogic.generateDeposit(
          notes.map(note => ({
            npk: note.notePublicKey,
            token: tokenData,
            value: note.value,
          })),
          encryptedRandom
        )
      ).wait();

      let eventCounter = 0;

      // eslint-disable-next-line no-loop-func
      tx.events.forEach((event: Event) => {
        if (event.event === 'GeneratedCommitmentBatch') {
          const {args} = event;
          eventCounter += 1;
          expect(args?.treeNumber).to.equal(0n);
          expect(args?.startPosition).to.equal(merkletree.leaves.length);

          args?.commitments.forEach((commitment: CommitmentPreimageArgs, index: number) => {
            const [base, fee] = getFee(notes[index].value, true, depositFee);

            expect(commitment.npk).to.equal(notes[index].notePublicKey);
            expect(BigInt(commitment.token.tokenAddress)).to.equal(notes[index].token);
            expect(commitment.value).to.equal(base);

            cumulativeBase += base;
            cumulativeFee += fee;
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

  it('Should transfer ERC20', async function run() {
    let loops = 1n;
    let transactionCreator = dummyTransact;
    let railgunLogicContract = railgunLogicBypassSigner;

    const artifactsList = artifactConfigs();

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 2n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 10n;
    }

    await loadAllArtifacts(railgunLogic);

    const tokenData = {
      tokenType: 0,
      tokenAddress: testERC20.address,
      tokenSubID: 0,
    };

    const merkletree = new MerkleTree();
    const testERC20noteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    for (let i = 1n; i - 1n < loops; i += 1n) {
      for (let j = 0; j < artifactsList.length; j += 1) {
        const artifactConfig = artifactsList[j];

        const depositNotes = new Array(artifactConfig.nullifiers).fill(1).map(
          // eslint-disable-next-line no-loop-func
          () =>
            new Note(
              spendingKey,
              viewingKey,
              i * 10n ** 18n,
              genRandomPoint(),
              BigInt(testERC20.address)
            )
        );

        // eslint-disable-next-line no-await-in-loop
        const encryptedRandom = await Promise.all(depositNotes.map(note => note.encryptRandom()));

        // eslint-disable-next-line
        const depositTx = await (
          await railgunLogicContract.generateDeposit(
            depositNotes.map(note => ({
              npk: note.notePublicKey,
              token: tokenData,
              value: note.value,
            })),
            encryptedRandom
          )
        ).wait();

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
          viewingKey
        );

        // eslint-disable-next-line no-await-in-loop
        const tx = await transactionCreator(
          merkletree,
          0n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          transferNotesIn,
          transferNotesOut,
          new WithdrawNote(0n, 0n, 0n),
          ethers.constants.AddressZero
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
        expect(railgunLogicContract.transact([tx])).to.eventually.be.rejectedWith(
          'RailgunLogic: Nullifier already seen'
        );
      }
    }
  });

  it('Should withdraw ERC20', async function run() {
    let loops = 1n;
    let transactionCreator = dummyTransact;
    let railgunLogicContract = railgunLogicBypassSigner;

    const artifactsList = artifactConfigs();

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 2n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 10n;
    }

    await loadAllArtifacts(railgunLogic);

    const tokenData = {
      tokenType: 0,
      tokenAddress: testERC20.address,
      tokenSubID: 0,
    };

    const merkletree = new MerkleTree();
    const testERC20noteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());
    const withdrawFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const testERC20Address = testERC20.address;

    for (let i = 1n; i - 1n < loops; i += 1n) {
      for (let j = 0; j < artifactsList.length; j += 1) {
        const artifactConfig = artifactsList[j];

        const depositNotes = new Array(artifactConfig.nullifiers)
          .fill(1)
          .map(
            () =>
              new Note(
                spendingKey,
                viewingKey,
                i * 10n ** 18n,
                genRandomPoint(),
                BigInt(testERC20Address)
              )
          );

        const encryptedRandom = await Promise.all(depositNotes.map(note => note.encryptRandom()));

        const depositTx = await (
          await railgunLogicContract.generateDeposit(
            depositNotes.map(note => ({
              npk: note.notePublicKey,
              token: tokenData,
              value: note.value,
            })),
            encryptedRandom
          )
        ).wait();

        // Parse events
        testERC20noteregistry.parseEvents(depositTx, merkletree);
        const [base, fee] = testERC20noteregistry.loadNotesWithFees(depositNotes, depositFee);
        cumulativeBase += base;
        cumulativeFee += fee;

        expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

        const [transferNotesIn, transferNotesOut, baseWithdraw, feeWithdraw] =
          testERC20noteregistry.getNotesWithdraw(
            (railgunLogicContract.signer as any).address, // TODO-TESTS: REMOVE ANY
            artifactConfig.nullifiers,
            artifactConfig.commitments,
            spendingKey,
            viewingKey,
            withdrawFee
          );

        const balanceBeforeWithdraw = await testERC20.balanceOf(
          (railgunLogicContract.signer as any).address // TODO-TESTS: REMOVE ANY
        );

        // TODO-TESTS: REMOVE ANY
        const tx: SerializedTransaction = await transactionCreator(
          merkletree,
          1n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          transferNotesIn,
          transferNotesOut,
          transferNotesOut[transferNotesOut.length - 1] as WithdrawNote,
          ethers.constants.AddressZero
        );

        const result = await (await railgunLogicContract.transact([tx])).wait();

        tx.overrideOutput = redirectAccount.address;

        // Shouldn't be able to redirect unless specified
        expect(railgunLogicContract.transact([tx])).to.eventually.be.rejectedWith(
          "RailgunLogic: Can't override destination address"
        );

        tx.overrideOutput = ethers.constants.AddressZero;
        tx.withdrawPreimage.value += 100n;

        // Shouldn't be able to change the withdraw preimage to one not validated by circuit
        expect(railgunLogicContract.transact([tx])).to.eventually.be.rejectedWith(
          'Withdraw commitment preimage is invalid'
        );

        tx.withdrawPreimage.value -= 100n;
        const originalToken = tx.withdrawPreimage.token.tokenAddress;
        tx.withdrawPreimage.token.tokenAddress = ethers.constants.AddressZero;

        // Shouldn't be able to change the withdraw preimage to one not validated by circuit
        expect(railgunLogicContract.transact([tx])).to.eventually.be.rejectedWith(
          'Withdraw commitment preimage is invalid'
        );

        tx.withdrawPreimage.token.tokenAddress = originalToken;

        // Parse events
        testERC20noteregistry.parseEvents(result, merkletree);
        testERC20noteregistry.loadNotes(transferNotesOut.slice(0, -1));

        // eslint-disable-next-line no-await-in-loop
        const balanceAfterWithdraw = await testERC20.balanceOf(
          (railgunLogicContract.signer as any).address // TODO-TESTS: REMOVE ANY
        );

        // Subtract base and fee
        cumulativeBase -= baseWithdraw;
        cumulativeBase -= feeWithdraw;
        cumulativeFee += feeWithdraw;

        expect(balanceAfterWithdraw.sub(balanceBeforeWithdraw)).to.equal(baseWithdraw);

        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogicContract.merkleRoot()).to.equal(merkletree.root);
        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogicContract.rootHistory(0, merkletree.root)).to.equal(true);

        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(railgunLogicContract.address)).to.equal(cumulativeBase);
        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
      }
    }
  });

  it('Should withdraw ERC20 redirected', async function run() {
    let loops = 2n;
    let transactionCreator = dummyTransact;
    let railgunLogicContract = railgunLogicBypassSigner;

    const artifactsList = artifactConfigs();

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 2n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      transactionCreator = transact;
      railgunLogicContract = railgunLogic;
      loops = 10n;
    }

    await loadAllArtifacts(railgunLogic);

    const tokenData = {
      tokenType: 0,
      tokenAddress: testERC20.address,
      tokenSubID: 0,
    };

    const merkletree = new MerkleTree();
    const testERC20noteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());
    const withdrawFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    for (let i = 1n; i - 1n < loops; i += 1n) {
      for (let j = 0; j < artifactsList.length; j += 1) {
        const artifactConfig = artifactsList[j];

        const depositNotes = new Array(artifactConfig.nullifiers).fill(1).map(
          // eslint-disable-next-line no-loop-func
          () =>
            new Note(
              spendingKey,
              viewingKey,
              i * 10n ** 18n,
              genRandomPoint(),
              BigInt(testERC20.address)
            )
        );

        // eslint-disable-next-line no-await-in-loop
        const encryptedRandom = await Promise.all(depositNotes.map(note => note.encryptRandom()));

        // eslint-disable-next-line
        const depositTx = await (
          await railgunLogicContract.generateDeposit(
            depositNotes.map(note => ({
              npk: note.notePublicKey,
              token: tokenData,
              value: note.value,
            })),
            encryptedRandom
          )
        ).wait();

        // Parse events
        testERC20noteregistry.parseEvents(depositTx, merkletree);
        const [base, fee] = testERC20noteregistry.loadNotesWithFees(depositNotes, depositFee);
        cumulativeBase += base;
        cumulativeFee += fee;

        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

        const [transferNotesIn, transferNotesOut, baseWithdraw, feeWithdraw] =
          testERC20noteregistry.getNotesWithdraw(
            (railgunLogicContract.signer as any).address, // TODO-TESTS: REMOVE ANY
            artifactConfig.nullifiers,
            artifactConfig.commitments,
            spendingKey,
            viewingKey,
            withdrawFee
          );

        // eslint-disable-next-line no-await-in-loop
        const balanceBeforeWithdraw = await testERC20.balanceOf(redirectAccount.address);

        // eslint-disable-next-line no-await-in-loop
        const tx = await transactionCreator(
          merkletree,
          2n,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          transferNotesIn,
          transferNotesOut,
          transferNotesOut[transferNotesOut.length - 1] as WithdrawNote,
          redirectAccount.address
        );

        // eslint-disable-next-line no-await-in-loop
        const result = await (await railgunLogicContract.transact([tx])).wait();

        // Parse events
        testERC20noteregistry.parseEvents(result, merkletree);
        testERC20noteregistry.loadNotes(transferNotesOut.slice(0, -1));

        // eslint-disable-next-line no-await-in-loop
        const balanceAfterWithdraw = await testERC20.balanceOf(redirectAccount.address);

        // Subtract base and fee
        cumulativeBase -= baseWithdraw;
        cumulativeBase -= feeWithdraw;
        cumulativeFee += feeWithdraw;

        expect(balanceAfterWithdraw.sub(balanceBeforeWithdraw)).to.equal(baseWithdraw);

        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogicContract.merkleRoot()).to.equal(merkletree.root);
        // eslint-disable-next-line no-await-in-loop
        expect(await railgunLogicContract.rootHistory(0, merkletree.root)).to.equal(true);

        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(railgunLogicContract.address)).to.equal(cumulativeBase);
        // eslint-disable-next-line no-await-in-loop
        expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
      }
    }
  });
});
