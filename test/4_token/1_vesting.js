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
let target;

describe('Token/Vesting', () => {
  beforeEach(async () => {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Distributor = await ethers.getContractFactory('Distributor');
    const VestLock = await ethers.getContractFactory('VestLock');
    const Staking = await ethers.getContractFactory('Staking');
    const Getter = await ethers.getContractFactory('Getter');
    const Target = await ethers.getContractFactory('GovernanceStateChangeTargetStub');

    // Deploy token
    testERC20 = await TestERC20.deploy();

    // Deploy staking
    staking = await Staking.deploy(testERC20.address);

    // Deploy vestlock implementation
    vestLock = await VestLock.deploy();

    // Deploy distributor
    distributor = await Distributor.deploy(
      (await ethers.getSigners())[0].address,
      staking.address,
      vestLock.address,
    );

    // Deploy getter
    getter = await Getter.deploy();

    // Deploy target
    target = await Target.deploy();
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
      1000n,
    );

    // Should delegate
    await clone.delegate(
      0n,
      (await ethers.getSigners())[1].address,
    );

    // Check we delegated correctly
    expect(
      await staking.votingPower((await ethers.getSigners())[1].address),
    ).to.equal(1000n);

    // Unlock stake
    await clone.unlock(0n);

    // Get us to release time
    await ethers.provider.send('evm_increaseTime', [stakeLocktime]);
    await ethers.provider.send('evm_mine');

    // Claim stake
    await clone.claim(0n);

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

    // Check target greeting returns hello
    expect(await target.greeting()).to.equal('hello');

    // Change target greeting
    await clone.callContract(
      target.address,
      target.interface.encodeFunctionData('changeGreeting(string)', ['hi']),
      0n,
    );

    // Check target greeting changed
    expect(await target.greeting()).to.equal('hi');
  });

  it('Should override locktime', async () => {
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

    // Override locktime
    await clone.overrideLock(0n);

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
