import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Token/Vesting', () => {
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Distributor = await ethers.getContractFactory('Distributor');
    const VestLock = await ethers.getContractFactory('VestLock');
    const Staking = await ethers.getContractFactory('Staking');

    // Deploy token
    const testERC20 = await TestERC20.deploy();

    // Deploy staking
    const staking = await Staking.deploy(testERC20.address);

    // Deploy vestlock implementation
    const vestLock = await VestLock.deploy();

    // Deploy distributor
    const distributor = await Distributor.deploy((await ethers.getSigners())[0].address, staking.address, vestLock.address);

    return {
      testERC20,
      staking,
      distributor,
    };
  }

  it('Should setup vesting', async () => {
    const { testERC20, staking, distributor } = await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock((await ethers.getSigners())[0].address, (await time.latest()) + stakeLocktime);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks((await ethers.getSigners())[0].address));

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000n);

    // Release time not reached, should fail
    await expect(clone.transferERC20(testERC20.address, (await ethers.getSigners())[0].address, 1000n)).to.be.revertedWith(
      "VestLock: Vesting hasn't matured yet",
    );

    // Stake tokens
    await clone.stake(testERC20.address, 1000n);

    // Should delegate
    await clone.delegate(0n, (await ethers.getSigners())[1].address);

    // Check we delegated correctly
    expect(await staking.votingPower((await ethers.getSigners())[1].address)).to.equal(1000n);

    // Unlock stake
    await clone.unlock(0n);

    // Get us to release time
    await time.increase(stakeLocktime);

    // Claim stake
    await clone.claim(0n);

    // Now we should be able to withdraw
    await expect(await clone.transferERC20(testERC20.address, (await ethers.getSigners())[1].address, 1000n)).to.changeTokenBalance(
      testERC20,
      (
        await ethers.getSigners()
      )[1].address,
      1000n,
    );
  });

  it('Should override locktime', async () => {
    const { testERC20, staking, distributor } = await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock((await ethers.getSigners())[0].address, (await time.latest()) + stakeLocktime);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks((await ethers.getSigners())[0].address));

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000n);

    // Release time not reached, should fail
    await expect(clone.transferERC20(testERC20.address, (await ethers.getSigners())[0].address, 1000n)).to.eventually.be.rejectedWith(
      "VestLock: Vesting hasn't matured yet",
    );

    // Override locktime
    await clone.overrideLock(0n);

    // Now we should be able to withdraw
    await expect(clone.transferERC20(testERC20.address, (await ethers.getSigners())[1].address, 1000n)).to.changeTokenBalance(
      testERC20,
      (
        await ethers.getSigners()
      )[1].address,
      1000n,
    );
  });
});
