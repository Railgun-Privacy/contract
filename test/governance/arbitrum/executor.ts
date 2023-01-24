import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  impersonateAccount,
  loadFixture,
  setBalance,
  setCode,
  time,
} from '@nomicfoundation/hardhat-network-helpers';

import { hash } from '../../../helpers/global/crypto';
import {
  fromUTF8String,
  arrayToHexString,
  arrayToBigInt,
  bigIntToArray,
} from '../../../helpers/global/bytes';

describe('Governance/Arbitrum/Executor', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Calculate addresses
    const senderL1Address = arrayToHexString(
      hash.keccak256(fromUTF8String('Sender Address')).slice(0, 20),
      true,
    );
    const senderL2Address = arrayToHexString(
      bigIntToArray(
        arrayToBigInt(hash.keccak256(fromUTF8String('Sender Address')).slice(0, 20)) +
          BigInt('0x1111000000000000000000000000000000001111'),
        20,
      ),
      true,
    );
    const arbRetryableTxAddress = '0x000000000000000000000000000000000000006e';

    // Impersonate sender L2 address
    await setBalance(senderL2Address, 20 * 10 ** 18);
    await impersonateAccount(senderL2Address);
    const senderL2Signer = await ethers.getSigner(senderL2Address);

    // Deploy ArbRetryableTx stub
    const ArbRetryableTxStub = await hre.artifacts.readArtifact('ArbRetryableTxStub');
    await setCode(arbRetryableTxAddress, ArbRetryableTxStub.deployedBytecode);
    const arbRetryableTxStub = await ethers.getContractAt(
      'ArbRetryableTxStub',
      arbRetryableTxAddress,
    );

    // Deploy delegator
    const Delegator = await ethers.getContractFactory('Delegator');
    const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);

    // Deploy executor
    const Executor = await ethers.getContractFactory('ArbitrumExecutor');
    const executor = await Executor.deploy(senderL1Address, delegator.address);
    const executorFromSender = executor.connect(senderL2Signer);

    // Transfer delegator admin to executor
    await delegator.transferOwnership(executor.address);

    // Deploy governance test targets
    const StateChangeTarget = await ethers.getContractFactory('GovernanceStateChangeTargetStub');
    const stateChangeTarget = await StateChangeTarget.deploy('hi');

    return {
      arbRetryableTxStub,
      executor,
      executorFromSender,
      stateChangeTarget,
    };
  }

  it('Convenience functions should call ArbRetryableTx precompile', async () => {
    const { arbRetryableTxStub, executor } = await loadFixture(deploy);

    // Redeem
    await expect(executor.redeem(12)).to.eventually.be.fulfilled;

    // Timeout values
    expect(await executor.newTicketTimeout()).to.equal(await arbRetryableTxStub.getLifetime());
    expect(await executor.ticketTimeLeft(12)).to.equal(
      await arbRetryableTxStub.getTimeout(bigIntToArray(12n, 32)),
    );
  });

  it('Should create tasks', async () => {
    const { executor } = await loadFixture(deploy);

    interface Call {
      callContract: string;
      data: string;
      value: number;
    }

    const calls: Call[] = [];

    // Create tasks and verify they match
    for (let i = 0; i < 15; i += 1) {
      // Push a new action to calls array
      calls.push({
        callContract: arrayToHexString(
          hash.keccak256(bigIntToArray(BigInt(i), 32)).slice(0, 20),
          true,
        ),
        data: arrayToHexString(hash.keccak256(bigIntToArray(BigInt(i * 2), 32)), true),
        value: i,
      });

      // Create task
      const creationTX = await executor.createTask(calls);

      // Check event was emitted
      await expect(creationTX).to.emit(executor, 'TaskCreated').withArgs(i);

      // Task state should be created
      expect((await executor.tasks(i)).state).to.equal(0);

      // Task creation time should be timestamp of latest block
      expect((await executor.tasks(i)).creationTime).to.equal(await time.latest());

      // Get actions and check they match what was submitted
      const contractActions = await executor.getActions(i);

      contractActions.forEach((action, index) => {
        expect(action.callContract).to.equal(ethers.utils.getAddress(calls[index].callContract));
        expect(action.data).to.equal(calls[index].data);
        expect(action.value).to.equal(calls[index].value);
      });
    }
  });

  it('Should execute tasks', async () => {
    const { executor, executorFromSender, stateChangeTarget } = await loadFixture(deploy);

    // Check initial greeting
    expect(await stateChangeTarget.greeting()).to.equal('hi');

    // Create task
    await expect(
      executor.createTask([
        {
          callContract: stateChangeTarget.address,
          data: stateChangeTarget.interface.encodeFunctionData('changeGreeting', ['hello']),
          value: 0,
        },
      ]),
    )
      .to.emit(executor, 'TaskCreated')
      .withArgs(0);

    // Execute should not callable before task is ready
    await expect(executor.executeTask(0)).to.be.revertedWith(
      'ArbitrumExecutor: Task not marked as executable',
    );

    // Ready task should only be callable by L1 sender
    await expect(executor.readyTask(0)).to.be.revertedWith(
      'ArbitrumExecutor: Caller is not L1 sender contract',
    );

    // Ready task
    await expect(executorFromSender.readyTask(0)).to.emit(executor, 'TaskReady').withArgs(0);

    // Ready task should fail if task is already readied
    await expect(executorFromSender.readyTask(0)).to.be.revertedWith(
      'ArbitrumExecutor: Task has already been executed',
    );

    // Task should now execute
    await expect(executor.executeTask(0)).to.emit(executor, 'TaskExecuted').withArgs(0);

    // Execute should not be able to be called twice
    await expect(executor.executeTask(0)).to.be.revertedWith(
      'ArbitrumExecutor: Task not marked as executable',
    );

    // Ready task should fail if called again after execution
    await expect(executorFromSender.readyTask(0)).to.be.revertedWith(
      'ArbitrumExecutor: Task has already been executed',
    );

    // Check greeting has changed
    expect(await stateChangeTarget.greeting()).to.equal('hello');
  });

  it('Should throw on reverting sub call', async () => {
    const { executor, executorFromSender, stateChangeTarget } = await loadFixture(deploy);

    // Create task
    await executor.createTask([
      {
        callContract: stateChangeTarget.address,
        data: '0x',
        value: 0,
      },
    ]);

    // Ready task
    await executorFromSender.readyTask(0);

    // Execution should throw
    await expect(executor.executeTask(0))
      .to.be.revertedWithCustomError(executor, 'ExecutionFailed')
      .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['string'], ['1 is not equal to 2'])
          .slice(2)}`,
      );
  });

  it('Should throw if task has expired', async () => {
    const { executor, executorFromSender, stateChangeTarget } = await loadFixture(deploy);

    // Create task
    await executor.createTask([
      {
        callContract: stateChangeTarget.address,
        data: '0x',
        value: 0,
      },
    ]);

    // Ready task
    await executorFromSender.readyTask(0);

    // Advance time
    await time.increase((await executor.EXPIRY_TIME()).toNumber() + 1);

    // Execution should throw
    await expect(executor.executeTask(0)).to.be.revertedWith('ArbitrumExecutor: Task has expired');
  });
});
