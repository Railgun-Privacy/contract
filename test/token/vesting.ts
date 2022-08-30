import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Token/Vesting', () => {
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Distributor = await ethers.getContractFactory('Distributor');
    const VestLock = await ethers.getContractFactory('VestLock');
    const Staking = await ethers.getContractFactory('Staking');
    const Target = await ethers.getContractFactory('GovernanceStateChangeTargetStub');

    // Deploy token
    const testERC20 = await TestERC20.deploy();

    // Deploy staking
    const staking = await Staking.deploy(testERC20.address);

    // Deploy vestlock implementation
    const vestLock = await VestLock.deploy();

    // Deploy distributor
    const distributor = await Distributor.deploy(
      (
        await ethers.getSigners()
      )[0].address,
      staking.address,
      vestLock.address,
    );

    // Deploy target
    const target = await Target.deploy('hello');

    return {
      testERC20,
      staking,
      distributor,
      target,
    };
  }

  it('Vest functions should be callable after unlock', async () => {
    const { testERC20, staking, distributor, target } = await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock(
      (
        await ethers.getSigners()
      )[0].address,
      (await time.latest()) + stakeLocktime,
    );

    // Get clone
    const clone = VestLock.attach(
      await distributor.vestLocks((await ethers.getSigners())[0].address),
    );

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000);

    // Release time not reached, should fail
    await expect(
      clone.transferERC20(testERC20.address, (await ethers.getSigners())[0].address, 1000),
    ).to.be.revertedWith("VestLock: Vesting hasn't matured yet");

    // Stake tokens
    await clone.stake(testERC20.address, 1000);

    // Should delegate
    await clone.delegate(0, (await ethers.getSigners())[1].address);

    // Check we delegated correctly
    expect(await staking.votingPower((await ethers.getSigners())[1].address)).to.equal(1000);

    // Unlock stake
    await clone.unlock(0);

    // Get us to release time
    await time.increase(stakeLocktime);

    // Claim stake
    await clone.claim(0);

    // Now we should be able to withdraw
    await expect(
      await clone.transferERC20(testERC20.address, (await ethers.getSigners())[1].address, 1000),
    ).to.changeTokenBalance(testERC20, (await ethers.getSigners())[1].address, 1000);

    // Should be able to withdraw ETH
    await (
      await ethers.getSigners()
    )[1].sendTransaction({
      to: clone.address,
      value: 100,
    });

    await expect(clone.transferETH(target.address, 100)).to.be.revertedWith('Failed to send Ether');

    await expect(
      clone.transferETH((await ethers.getSigners())[1].address, 100),
    ).to.changeEtherBalances([(await ethers.getSigners())[1].address, clone.address], [100, -100]);

    // Should be able to call contracts
    await expect(
      clone.callContract(target.address, target.interface.encodeFunctionData('willRevert'), 0),
    ).to.be.revertedWith('VestLock: failure on external contract call');

    await expect(
      clone.callContract(target.address, target.interface.encodeFunctionData('greeting'), 0),
    ).to.be.fulfilled;
  });

  it('Should override locktime', async () => {
    const { testERC20, staking, distributor } = await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock(
      (
        await ethers.getSigners()
      )[0].address,
      (await time.latest()) + stakeLocktime,
    );

    // Get clone
    const clone = VestLock.attach(
      await distributor.vestLocks((await ethers.getSigners())[0].address),
    );

    // Get clone contract with second signer
    const clone2 = clone.connect((await ethers.getSigners())[1]);

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000);

    // Release time not reached, should fail
    await expect(
      clone.transferERC20(testERC20.address, (await ethers.getSigners())[0].address, 1000),
    ).to.be.revertedWith("VestLock: Vesting hasn't matured yet");

    // Non admin shouldn't be able to override locktime
    await expect(clone2.overrideLock(0)).to.be.revertedWith('VestLock: Caller not admin');

    // Override locktime
    await clone.overrideLock(0);

    // Locktime can only be made earlier, not later
    await expect(clone.overrideLock(1)).to.be.revertedWith(
      'VestLock: new lock time must be less than old lock time',
    );

    // Now we should be able to withdraw
    await expect(
      clone.transferERC20(testERC20.address, (await ethers.getSigners())[1].address, 1000),
    ).to.changeTokenBalance(testERC20, (await ethers.getSigners())[1].address, 1000);
  });
});
