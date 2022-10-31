import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Token/Vesting', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Distributor = await ethers.getContractFactory('Distributor');
    const VestLock = await ethers.getContractFactory('VestLock');
    const Staking = await ethers.getContractFactory('Staking');
    const Target = await ethers.getContractFactory('GovernanceStateChangeTargetStub');

    // Get primary and secondary account
    const [primaryAccount, secondaryAccount] = await ethers.getSigners();

    // Deploy token
    const testERC20 = await TestERC20.deploy();
    await testERC20.mint(await testERC20.signer.getAddress(), 2n ** 256n - 1n);

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

    const distributorSecondary = distributor.connect(secondaryAccount);

    // Deploy target
    const target = await Target.deploy('hello');

    return {
      testERC20,
      staking,
      distributor,
      distributorSecondary,
      target,
      primaryAccount,
      secondaryAccount,
    };
  }

  it('Vest functions should be callable after unlock', async () => {
    const { testERC20, staking, distributor, target, primaryAccount, secondaryAccount } =
      await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock(primaryAccount.address, (await time.latest()) + stakeLocktime);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks(primaryAccount.address));

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000);

    // Release time not reached, should fail
    await expect(
      clone.transferERC20(testERC20.address, primaryAccount.address, 1000),
    ).to.be.revertedWith("VestLock: Vesting hasn't matured yet");
    await expect(clone.transferETH(primaryAccount.address, 1000)).to.be.revertedWith(
      "VestLock: Vesting hasn't matured yet",
    );

    // Stake tokens
    await clone.stake(testERC20.address, 1000);

    // Should delegate
    await clone.delegate(0, secondaryAccount.address);

    // Check we delegated correctly
    expect(await staking.votingPower(secondaryAccount.address)).to.equal(1000);

    // Unlock stake
    await clone.unlock(0);

    // Get us to release time
    await time.increase(stakeLocktime);

    // Claim stake
    await clone.claim(0);

    // Now we should be able to unshield
    await expect(
      await clone.transferERC20(testERC20.address, secondaryAccount.address, 1000),
    ).to.changeTokenBalance(testERC20, secondaryAccount.address, 1000);

    // Should be able to unshield ETH
    await (
      await ethers.getSigners()
    )[1].sendTransaction({
      to: clone.address,
      value: 100,
    });

    await expect(clone.transferETH(target.address, 100)).to.be.revertedWith('Failed to send Ether');

    await expect(clone.transferETH(secondaryAccount.address, 100)).to.changeEtherBalances(
      [secondaryAccount.address, clone.address],
      [100, -100],
    );

    // Should be able to call contracts
    await expect(
      clone.callContract(target.address, target.interface.encodeFunctionData('willRevert'), 0),
    ).to.be.revertedWith('VestLock: failure on external contract call');

    await expect(
      clone.callContract(target.address, target.interface.encodeFunctionData('greeting'), 0),
    ).to.be.fulfilled;
  });

  it('Should override locktime', async () => {
    const { testERC20, staking, distributor, primaryAccount, secondaryAccount } = await loadFixture(
      deploy,
    );

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock(primaryAccount.address, (await time.latest()) + stakeLocktime);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks(primaryAccount.address));

    // Get clone contract with second signer
    const clone2 = clone.connect(secondaryAccount);

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000);

    // Release time not reached, should fail
    await expect(clone.transferETH(primaryAccount.address, 100)).to.be.revertedWith(
      "VestLock: Vesting hasn't matured yet",
    );
    await expect(
      clone.transferERC20(primaryAccount.address, testERC20.address, 100),
    ).to.be.revertedWith("VestLock: Vesting hasn't matured yet");
    await expect(
      clone.callContract(primaryAccount.address, new Uint8Array(0), 100),
    ).to.be.revertedWith("VestLock: Vesting hasn't matured yet");

    // Non admin shouldn't be able to override locktime
    await expect(clone2.overrideLock(0)).to.be.revertedWith('VestLock: Caller not admin');

    // Override locktime
    await clone.overrideLock(0);

    // Locktime can only be made earlier, not later
    await expect(clone.overrideLock(1)).to.be.revertedWith(
      'VestLock: new lock time must be less than old lock time',
    );

    // Now we should be able to unshield
    await expect(
      clone.transferERC20(testERC20.address, secondaryAccount.address, 1000),
    ).to.changeTokenBalance(testERC20, secondaryAccount.address, 1000);
  });

  it('Distributor should only be operable by owner', async () => {
    const { distributorSecondary } = await loadFixture(deploy);

    await expect(
      distributorSecondary.createVestLock((await ethers.getSigners())[0].address, 1),
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('Vestlock should only be operable by owner', async () => {
    const { testERC20, distributor, primaryAccount, secondaryAccount } = await loadFixture(deploy);
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock((await ethers.getSigners())[0].address, 1);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks(primaryAccount.address));

    // Get clone contract with second signer
    const clone2 = clone.connect(secondaryAccount);

    // Non-owner should not be able to call functions
    await expect(clone2.stake(testERC20.address, 100)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await expect(clone2.unlock(1)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(clone2.claim(1)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(clone2.delegate(1, ethers.constants.AddressZero)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await expect(clone2.transferETH(primaryAccount.address, 100)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await expect(
      clone2.transferERC20(primaryAccount.address, testERC20.address, 100),
    ).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(
      clone2.callContract(primaryAccount.address, new Uint8Array(0), 100),
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Vestlock should't double init", async () => {
    const { distributor, primaryAccount } = await loadFixture(deploy);
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock((await ethers.getSigners())[0].address, 1);

    // Get clone
    const clone = VestLock.attach(await distributor.vestLocks(primaryAccount.address));

    await expect(
      clone.initialize(
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        1,
      ),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });
});
