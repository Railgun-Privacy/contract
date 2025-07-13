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
import { Contract } from 'ethers';

import { hash } from '../../../helpers/global/crypto';
import {
  fromUTF8String,
  arrayToHexString,
  arrayToBigInt,
  bigIntToArray,
} from '../../../helpers/global/bytes';

interface Call {
  callContract: string;
  data: string;
  value: number;
}

interface CrossDomainMessengerStub extends Contract {
  callAs(sender: string, target: string, data: string): Promise<unknown>;
}

describe('Governance/OpStack/Executor', () => {
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
    const crossDomainMessengerAddress = '0x4200000000000000000000000000000000000007';

    // Impersonate sender L2 address
    await setBalance(senderL2Address, 20 * 10 ** 18);
    await impersonateAccount(senderL2Address);
    const senderL2Signer = await ethers.getSigner(senderL2Address);

    // Deploy CrossDomainMessenger stub
    const CrossDomainMessengerStub = await hre.artifacts.readArtifact('CrossDomainMessengerStub');
    await setCode(crossDomainMessengerAddress, CrossDomainMessengerStub.deployedBytecode);
    const crossDomainMessengerStub = (await ethers.getContractAt(
      'CrossDomainMessengerStub',
      crossDomainMessengerAddress,
    )) as CrossDomainMessengerStub;

    // Deploy delegator
    const Delegator = await ethers.getContractFactory('Delegator');
    const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);

    // Deploy executor
    const Executor = await ethers.getContractFactory('OPStackExecutor');
    const executor = await Executor.deploy(
      senderL1Address,
      delegator.address,
      crossDomainMessengerAddress,
    );
    const executorFromSender = executor.connect(senderL2Signer);

    // Transfer delegator admin to executor
    await delegator.transferOwnership(executor.address);

    // Deploy governance test targets
    const StateChangeTarget = await ethers.getContractFactory('GovernanceStateChangeTargetStub');
    const stateChangeTarget = await StateChangeTarget.deploy('hi');

    return {
      crossDomainMessengerStub,
      executor,
      executorFromSender,
      stateChangeTarget,
    };
  }

  it('Convenience functions should call CrossDomainMessenger precompile', async () => {
    const { crossDomainMessengerStub, executor } = await loadFixture(deploy);

    // Get xDomainMessageSender
    expect(await executor.MESSENGER()).to.equal(crossDomainMessengerStub.address);
  });

  it('Should create tasks', async () => {
    const { executor } = await loadFixture(deploy);

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
      const task = await executor.tasks(i);
      expect(task.state).to.equal(0);

      // Task creation time should be timestamp of latest block
      expect(task.creationTime).to.equal(await time.latest());

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
    const { executor, crossDomainMessengerStub, stateChangeTarget } = await loadFixture(deploy);

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
      'OPStackExecutor: Task not marked as executable',
    );

    // Ready task should only be callable by L1 sender
    await expect(executor.readyTask(0)).to.be.revertedWith(
      'OPStackExecutor: Caller is not L1 sender contract',
    );

    // Get the SENDER_L1 address from the executor
    const senderL1Address = await executor.SENDER_L1();

    // Ready task using the CrossDomainMessenger
    const readyTaskData = executor.interface.encodeFunctionData('readyTask', [0]);
    await crossDomainMessengerStub.callAs(senderL1Address, executor.address, readyTaskData);

    // Task should now execute
    await expect(executor.executeTask(0)).to.emit(executor, 'TaskExecuted').withArgs(0);

    // Execute should not be able to be called twice
    await expect(executor.executeTask(0)).to.be.revertedWith(
      'OPStackExecutor: Task not marked as executable',
    );

    // Check greeting has changed
    expect(await stateChangeTarget.greeting()).to.equal('hello');
  });

  it('Should throw on reverting sub call', async () => {
    const { executor, crossDomainMessengerStub, stateChangeTarget } = await loadFixture(deploy);

    // Create task
    await executor.createTask([
      {
        callContract: stateChangeTarget.address,
        data: '0x',
        value: 0,
      },
    ]);

    // Get the SENDER_L1 address from the executor
    const senderL1Address = await executor.SENDER_L1();

    // Ready task using the CrossDomainMessenger
    const readyTaskData = executor.interface.encodeFunctionData('readyTask', [0]);
    await crossDomainMessengerStub.callAs(senderL1Address, executor.address, readyTaskData);

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
    const { executor, crossDomainMessengerStub, stateChangeTarget } = await loadFixture(deploy);

    // Create task
    await executor.createTask([
      {
        callContract: stateChangeTarget.address,
        data: '0x',
        value: 0,
      },
    ]);

    // Get the SENDER_L1 address from the executor
    const senderL1Address = await executor.SENDER_L1();

    // Ready task using the CrossDomainMessenger
    const readyTaskData = executor.interface.encodeFunctionData('readyTask', [0]);
    await crossDomainMessengerStub.callAs(senderL1Address, executor.address, readyTaskData);

    // Advance time
    const expiryTime = await executor.EXPIRY_TIME();
    await time.increase(expiryTime.toNumber() + 1);

    // Execution should throw
    await expect(executor.executeTask(0)).to.be.revertedWith('OPStackExecutor: Task has expired');
  });
});
