import {TransactionResponse} from '@ethersproject/abstract-provider';
import {network, ethers} from 'hardhat';
import chai, {assert} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import weth9artifact from '@ethereum-artifacts/weth9';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {BigNumber, Contract, PopulatedTransaction} from 'ethers';
import {
  formatCalls,
  getAdaptParams,
  getRelayAdaptParams,
} from '../../../helpers/adapt/relay/relay-adapt';
import {genRandomPoint, genRandomPrivateKey} from '../../../helpers/logic/babyjubjub';
import {Note, WithdrawNote} from '../../../helpers/logic/note';
import {getRelayAdaptCallResultError} from '../../../helpers/adapt/relay/parse-events';
import {dummyTransact, getFee, transact} from '../../../helpers/logic/transaction';
import {MerkleTree} from '../../../helpers/logic/merkletree';
import {NoteRegistry} from '../../../helpers/logic/note-registry';
import {loadAllArtifacts} from '../../../helpers/logic/snarkKeys';

chai.use(chaiAsPromised);

const {expect} = chai;

let snarkBypassSigner;
let primaryAccount: SignerWithAddress;
let treasuryAccount: SignerWithAddress;
let testERC20: Contract;
let railgunLogic: Contract;
let weth9: Contract;
let relayAdapt: Contract;

describe('Adapt/Relay', () => {
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
      primaryAccount.address
    );

    await loadAllArtifacts(railgunLogic);
    railgunLogic = railgunLogic.connect(snarkBypassSigner);

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n - 1n);
    testERC20 = testERC20.connect(snarkBypassSigner);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const WETH9 = new ethers.ContractFactory(
      weth9artifact.WETH9.abi,
      weth9artifact.WETH9.bytecode,
      accounts[0]
    );
    weth9 = await WETH9.deploy();

    const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
    relayAdapt = await RelayAdapt.deploy(railgunLogic.address, weth9.address);
  });

  it('Should calculate adapt params', async function run() {
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 5n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const merkletree = new MerkleTree();
      const spendingKey = genRandomPrivateKey();
      const viewingKey = genRandomPrivateKey();
      const token = ethers.utils
        .keccak256(ethers.BigNumber.from(i * loops).toHexString())
        .slice(0, 42);

      for (let j = 0n; j < i + 1n; j += 1n) {
        const notes = new Array(Number(i)).fill(1).map(
          // eslint-disable-next-line no-loop-func
          () => new Note(spendingKey, viewingKey, i * 10n ** 18n, genRandomPoint(), BigInt(token))
        );

        merkletree.insertLeaves(notes.map(note => note.hash));

        // eslint-disable-next-line no-await-in-loop
        const txs = await Promise.all(
          new Array(Number(j))
            .fill(1)
            .map(() =>
              dummyTransact(
                merkletree,
                0n,
                ethers.constants.AddressZero,
                ethers.constants.HashZero,
                notes,
                notes,
                new WithdrawNote(0n, 0n, 0n),
                ethers.constants.AddressZero
              )
            )
        );

        const additionalData = ethers.utils
          .keccak256(ethers.BigNumber.from(i * loops + 1n).toHexString())
          .slice(0, 42);

        // eslint-disable-next-line no-await-in-loop
        expect(await relayAdapt.getAdaptParams(txs, additionalData)).to.equal(
          getAdaptParams(txs, additionalData)
        );
      }
    }
  });

  it('Should calculate relay adapt params', async function run() {
    let loops = 1n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 5n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const merkletree = new MerkleTree();
      const spendingKey = genRandomPrivateKey();
      const viewingKey = genRandomPrivateKey();
      const token = ethers.utils
        .keccak256(ethers.BigNumber.from(i * loops).toHexString())
        .slice(0, 42);

      for (let j = 0n; j < i; j += 1n) {
        const notes = new Array(Number(i)).fill(1).map(
          // eslint-disable-next-line no-loop-func
          () => new Note(spendingKey, viewingKey, i * 10n ** 18n, genRandomPoint(), BigInt(token))
        );

        merkletree.insertLeaves(notes.map(note => note.hash));

        // eslint-disable-next-line no-await-in-loop
        const txs = await Promise.all(
          new Array(Number(j))
            .fill(1)
            .map(() =>
              dummyTransact(
                merkletree,
                0n,
                ethers.constants.AddressZero,
                ethers.constants.HashZero,
                notes,
                notes,
                new WithdrawNote(0n, 0n, 0n),
                ethers.constants.AddressZero
              )
            )
        );

        const random = BigInt(
          ethers.utils.keccak256(ethers.BigNumber.from(i * loops + 2n).toHexString())
        );
        const requireSuccess = i % 2n === 0n;
        const calls: PopulatedTransaction[] = new Array(Number(j)).fill({
          to: token,
          data: ethers.utils.keccak256(ethers.BigNumber.from(i * loops + 3n).toHexString()),
          value: BigNumber.from(i),
        } as PopulatedTransaction);
        const minGas = i;

        expect(
          // eslint-disable-next-line no-await-in-loop
          await relayAdapt.getRelayAdaptParams(txs, random, requireSuccess, minGas, calls)
        ).to.equal(getRelayAdaptParams(txs, random, requireSuccess, minGas, calls));
      }
    }
  });

  it('Should send ETH/ERC20s', async () => {
    // eslint-disable-next-line no-unused-vars
    const merkletree = new MerkleTree();
    // eslint-disable-next-line no-unused-vars
    const wethnoteregistry = new NoteRegistry();

    // eslint-disable-next-line no-unused-vars
    const spendingKey = genRandomPrivateKey();
    // eslint-disable-next-line no-unused-vars
    const viewingKey = genRandomPrivateKey();
  });

  it('Should wrap+deposit, and unwrap+withdraw ETH', async () => {
    const merkletree = new MerkleTree();
    const wethnoteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());
    const withdrawFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const depositNote = new Note(
      spendingKey,
      viewingKey,
      1000n,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const callsDeposit = formatCalls([
      await relayAdapt.populateTransaction.wrapAllBase(),
      await relayAdapt.populateTransaction.deposit(
        [
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote.encryptRandom(),
        depositNote.notePublicKey
      ),
    ]);

    const random = genRandomPoint();

    const depositTx: TransactionResponse = await relayAdapt.relay(
      [],
      random,
      true,
      1n,
      callsDeposit,
      {
        value: depositNote.value,
      }
    );
    const depositReceipt = await depositTx.wait();

    const [depositTxBase, depositTxFee] = getFee(depositNote.value, true, depositFee);

    cumulativeBase += depositTxBase;
    cumulativeFee += depositTxFee;

    wethnoteregistry.parseEvents(depositReceipt, merkletree);
    wethnoteregistry.loadNotesWithFees([depositNote], depositFee);

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

    const [inputs, outputs, withdrawTxBase, withdrawTxFee] = wethnoteregistry.getNotesWithdraw(
      relayAdapt.address,
      1,
      2,
      spendingKey,
      viewingKey,
      withdrawFee
    );

    const railgunDummyBatch = [
      await dummyTransact(
        merkletree,
        1n,
        relayAdapt.address,
        ethers.constants.HashZero,
        inputs,
        outputs,
        outputs[0] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    const callsWithdraw = formatCalls([
      await relayAdapt.populateTransaction.unwrapAllBase(),
      await relayAdapt.populateTransaction.send(
        [
          {
            tokenType: 0n,
            tokenAddress: ethers.constants.AddressZero,
            tokenSubID: 0n,
          },
        ],
        primaryAccount.address
      ),
    ]);

    const relayParams = getRelayAdaptParams(railgunDummyBatch, random, true, 1n, callsWithdraw);

    const railgunBatch = [
      await transact(
        merkletree,
        1n,
        relayAdapt.address,
        relayParams,
        inputs,
        outputs,
        outputs[outputs.length - 1] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    await relayAdapt.relay(railgunBatch, random, true, 1n, callsWithdraw);

    cumulativeBase -= withdrawTxBase;
    cumulativeBase -= withdrawTxFee;
    cumulativeFee += withdrawTxFee;

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
  });

  it('Should deposit token with balance, and skip token without balance', async () => {
    const merkletree = new MerkleTree();
    const wethnoteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const depositNote = new Note(
      spendingKey,
      viewingKey,
      1000n,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const callsDeposit = formatCalls([
      await relayAdapt.populateTransaction.wrapAllBase(),
      await relayAdapt.populateTransaction.deposit(
        [
          {
            tokenType: 0n,
            tokenAddress: testERC20.address,
            tokenSubID: 0n,
          },
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote.encryptRandom(),
        depositNote.notePublicKey
      ),
    ]);

    const random = genRandomPoint();

    const depositTx = await (
      await relayAdapt.relay([], random, true, 1n, callsDeposit, {
        value: depositNote.value,
      })
    ).wait();

    const [depositTxBase, depositTxFee] = getFee(depositNote.value, true, depositFee);

    cumulativeBase += depositTxBase;
    cumulativeFee += depositTxFee;

    wethnoteregistry.parseEvents(depositTx, merkletree);
    wethnoteregistry.loadNotesWithFees([depositNote], depositFee);

    expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(0n);
    expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(0n);
    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
  });

  it('Should perform cross-contract Relay call (transfer)', async () => {
    const merkletree = new MerkleTree();
    const wethnoteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const depositNote = new Note(
      spendingKey,
      viewingKey,
      1000n,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const callsDeposit = formatCalls([
      await relayAdapt.populateTransaction.wrapAllBase(),
      await relayAdapt.populateTransaction.deposit(
        [
          // TODO: Test in reverse order (bad then good token).
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
          {
            tokenType: 0n,
            tokenAddress: testERC20.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote.encryptRandom(),
        depositNote.notePublicKey
      ),
    ]);

    const random = genRandomPoint();

    const depositTx = await (
      await relayAdapt.relay([], random, true, 1n, callsDeposit, {
        value: depositNote.value,
      })
    ).wait();

    const [depositTxBase, depositTxFee] = getFee(depositNote.value, true, depositFee);

    cumulativeBase += depositTxBase;
    cumulativeFee += depositTxFee;

    wethnoteregistry.parseEvents(depositTx, merkletree);
    wethnoteregistry.loadNotesWithFees([depositNote], depositFee);

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
    expect(await testERC20.balanceOf(railgunLogic.address)).to.equal(0n);
    expect(await testERC20.balanceOf(treasuryAccount.address)).to.equal(0n);
  });

  it('Should perform cross-contract Relay call (transfer)', async () => {
    const merkletree = new MerkleTree();
    const wethnoteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());
    const withdrawFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const depositNote = new Note(
      spendingKey,
      viewingKey,
      1000n,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const callsDeposit = formatCalls([
      await relayAdapt.populateTransaction.wrapAllBase(),
      await relayAdapt.populateTransaction.deposit(
        [
          // TODO: Test in reverse order (bad then good token).
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
          {
            tokenType: 0n,
            tokenAddress: testERC20.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote.encryptRandom(),
        depositNote.notePublicKey
      ),
    ]);

    const random = genRandomPoint();

    const depositTx = await (
      await relayAdapt.relay([], random, true, 1n, callsDeposit, {
        value: depositNote.value,
      })
    ).wait();

    const [depositTxBase, depositTxFee] = getFee(depositNote.value, true, depositFee);

    cumulativeBase += depositTxBase;
    cumulativeFee += depositTxFee;

    wethnoteregistry.parseEvents(depositTx, merkletree);
    wethnoteregistry.loadNotesWithFees([depositNote], depositFee);

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

    const [inputs, outputs, withdrawTxBase, withdrawTxFee] = wethnoteregistry.getNotesWithdraw(
      relayAdapt.address,
      1,
      2,
      spendingKey,
      viewingKey,
      withdrawFee
    );

    const railgunDummyBatch = [
      await dummyTransact(
        merkletree,
        1n,
        relayAdapt.address,
        ethers.constants.HashZero,
        inputs,
        outputs,
        outputs[0] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    const transferAmount = 1n;

    const depositNote2 = new Note(
      spendingKey,
      viewingKey,
      withdrawTxBase - transferAmount,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const [depositTxBase2, depositTxFee2] = getFee(depositNote2.value, true, depositFee);

    const crossContractCalls = formatCalls([
      await weth9.populateTransaction.transfer(
        '0x000000000000000000000000000000000000dEaD',
        transferAmount
      ),
      await relayAdapt.populateTransaction.deposit(
        [
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote2.encryptRandom(),
        depositNote2.notePublicKey
      ),
    ]);

    const relayParams = getRelayAdaptParams(
      railgunDummyBatch,
      random,
      false,
      1n,
      crossContractCalls
    );

    const railgunBatch = [
      await transact(
        merkletree,
        1n,
        relayAdapt.address,
        relayParams,
        inputs,
        outputs,
        outputs[outputs.length - 1] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

    const txResponse = await relayAdapt.relay(railgunBatch, random, false, 1n, crossContractCalls);
    const txReceipt = await txResponse.wait();

    const error = getRelayAdaptCallResultError(txReceipt);
    expect(error).to.equal(undefined);

    cumulativeBase -= withdrawTxBase;
    cumulativeBase -= withdrawTxFee;
    cumulativeFee += withdrawTxFee;

    cumulativeBase += depositTxBase2;
    cumulativeFee += depositTxFee2;

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);
  });

  it('Should revert cross-contract Relay call on deposit failure', async () => {
    const merkletree = new MerkleTree();
    const wethnoteregistry = new NoteRegistry();

    const depositFee = BigInt((await railgunLogic.depositFee()).toHexString());
    const withdrawFee = BigInt((await railgunLogic.depositFee()).toHexString());

    const spendingKey = genRandomPrivateKey();
    const viewingKey = genRandomPrivateKey();

    let cumulativeBase = 0n;
    let cumulativeFee = 0n;

    const depositNote = new Note(
      spendingKey,
      viewingKey,
      1000n,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const callsDeposit = formatCalls([
      await relayAdapt.populateTransaction.wrapAllBase(),
      await relayAdapt.populateTransaction.deposit(
        [
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote.encryptRandom(),
        depositNote.notePublicKey
      ),
    ]);

    const random = genRandomPoint();

    const depositTx = await (
      await relayAdapt.relay([], random, true, 1n, callsDeposit, {
        value: depositNote.value,
      })
    ).wait();

    const [depositTxBase, depositTxFee] = getFee(depositNote.value, true, depositFee);

    cumulativeBase += depositTxBase;
    cumulativeFee += depositTxFee;

    wethnoteregistry.parseEvents(depositTx, merkletree);
    wethnoteregistry.loadNotesWithFees([depositNote], depositFee);

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(cumulativeBase);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(cumulativeFee);

    const [inputs, outputs, withdrawTxBase] = wethnoteregistry.getNotesWithdraw(
      relayAdapt.address,
      1,
      2,
      spendingKey,
      viewingKey,
      withdrawFee
    );

    const railgunDummyBatch = [
      await dummyTransact(
        merkletree,
        1n,
        relayAdapt.address,
        ethers.constants.HashZero,
        inputs,
        outputs,
        outputs[0] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    const transferAmount = 100n;

    const depositNote2 = new Note(
      spendingKey,
      viewingKey,
      withdrawTxBase - transferAmount,
      genRandomPoint(),
      BigInt(weth9.address)
    );

    const crossContractCalls = formatCalls([
      await weth9.populateTransaction.transfer(
        '0x000000000000000000000000000000000000dEaD',
        transferAmount
      ),
      await relayAdapt.populateTransaction.deposit(
        [
          {
            tokenType: 0n,
            tokenAddress: weth9.address,
            tokenSubID: 0n,
          },
        ],
        await depositNote2.encryptRandom(),
        depositNote2.notePublicKey
      ),
    ]);

    const relayParams = getRelayAdaptParams(
      railgunDummyBatch,
      random,
      false,
      1n,
      crossContractCalls
    );

    const railgunBatch = [
      await transact(
        merkletree,
        1n,
        relayAdapt.address,
        relayParams,
        inputs,
        outputs,
        outputs[outputs.length - 1] as WithdrawNote,
        ethers.constants.AddressZero
      ),
    ];

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(998n);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(2n);

    try {
      await relayAdapt.relay(railgunBatch, random, false, crossContractCalls, {
        gasLimit: 1600000, // Requires ~1.7M.
      });
      assert(false, 'Should catch error');
    } catch (err) {
      // no op
    }

    expect(await weth9.balanceOf(railgunLogic.address)).to.equal(998n);
    expect(await weth9.balanceOf(treasuryAccount.address)).to.equal(2n);
  });
});
