/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = require('chai');

let testERC20;
let vestLock;
let distributor;
let staking;
let getter;

describe('Token/Vesting', () => {
  beforeEach(async () => {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Distributor = await ethers.getContractFactory('Distributor');
    const VestLock = await ethers.getContractFactory('VestLock');
    const Staking = await ethers.getContractFactory('Staking');
    const Getter = await ethers.getContractFactory('Getter');

    // Deploy token
    testERC20 = await TestERC20.deploy();

    // Deploy vestlock implementation
    vestLock = await VestLock.deploy();

    // Deploy distributor
    distributor = await Distributor.deploy(
      (await ethers.getSigners())[0].address,
      vestLock.address,
    );

    staking = await Staking.deploy(testERC20.address);

    // Deploy staking
    getter = await Getter.deploy();
  });

  it('Should setup vesting', async () => {
    const stakeLocktime = Number((await staking.STAKE_LOCKTIME()).toString());
    const VestLock = await ethers.getContractFactory('VestLock');

    // Create Vest Lock
    await distributor.createVestLock(
      (await ethers.getSigners())[0].address,
      BigInt((await getter.time()).toString()) + BigInt(stakeLocktime),
    );

    // Get clone
    const clone = VestLock.attach(
      await distributor.vestLocks(
        (await ethers.getSigners())[0].address,
      ),
    );

    // Transfer tokens to clone
    await testERC20.transfer(clone.address, 1000n);

    // Release time not reached, should fail
    await expect(
      clone.transferERC20(
        testERC20.address,
        (await ethers.getSigners())[0].address,
        1000n,
      ),
    ).to.eventually.be.rejectedWith('VestLock: Vesting hasn\'t matured yet');

    // Stake tokens
    await clone.stake(
      testERC20.address,
      staking.address,
      1000n,
    );

    // Should delegate
    await clone.delegate(
      staking.address,
      0n,
      (await ethers.getSigners())[1].address,
    );

    // Check we delegated correctly
    expect(
      await staking.votingPower((await ethers.getSigners())[1].address),
    ).to.equal(1000n);

    // Unlock stake
    await clone.unlock(staking.address, 0n);

    // Get us to release time
    await ethers.provider.send('evm_increaseTime', [stakeLocktime]);
    await ethers.provider.send('evm_mine');

    // Claim stake
    await clone.claim(staking.address, 0n);

    // Now we should be able to withdraw
    await clone.transferERC20(
      testERC20.address,
      (await ethers.getSigners())[1].address,
      1000n,
    );

    // Check the tokens were released
    expect(
      await testERC20.balanceOf((await ethers.getSigners())[1].address),
    ).to.equal(1000n);
  });
});
