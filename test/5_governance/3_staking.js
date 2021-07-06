/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = require('chai');

let staking;
let testERC20;

describe('Governance/Staking', () => {
  beforeEach(async () => {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');

    // Deploy with test ERC20 as staking coin
    testERC20 = await TestERC20.deploy();
    staking = await Staking.deploy(testERC20.address);

    // Approve entire balance for staking
    await testERC20.approve(
      staking.address,
      await testERC20.balanceOf(
        (await ethers.getSigners())[0].address,
      ),
    );
  });

  it('Should count intervals properly', async () => {
    const snapshotInterval = Number((await staking.SNAPSHOT_INTERVAL()).toString());

    // Increast time to first interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Check we are in first interval
    expect(await staking.currentInterval()).to.equal(1n);

    // Increase time to second interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Check we are in second interval
    expect(await staking.currentInterval()).to.equal(2n);
  });

  it('Should return correct snapshot regardless of hint', async () => {
    const snapshotInterval = Number((await staking.SNAPSHOT_INTERVAL()).toString());

    const snapshotIntervals = [];

    // Increast time to second interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval * 2]);
    await ethers.provider.send('evm_mine');

    /* eslint-disable no-await-in-loop */
    // Loop through 10 intervals
    for (let i = 2; i < 15; i += 1) {
      // Random chance to take a snapshot
      if (Math.random() < 0.3) {
        await staking.snapshotStub((await ethers.getSigners())[0].address);

        snapshotIntervals.push(i);
      }

      // Increast time to next interval
      await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
      await ethers.provider.send('evm_mine');
    }

    // Increase time without taking snapshots
    for (let i = 0; i < 10; i += 1) {
      await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
      await ethers.provider.send('evm_mine');
    }

    // Loop through each interval and try a hint for each one
    for (let i = 0; i < 20; i += 1) {
      for (let hint = 0; hint < 25; hint += 1) {
        // Should be inclusive upper bounds or if all values are lower than
        // Interval it should be interval itself
        const expectedInterval = snapshotIntervals.reduceRight(
          (right, left) => (left >= i ? left : right),
          i,
        );

        const accountSnapshot = await staking.accountSnapshotAt(
          (await ethers.getSigners())[0].address,
          i,
          hint,
        );

        const globalsSnapshot = await staking.accountSnapshotAt(
          (await ethers.getSigners())[0].address,
          i,
          hint,
        );

        expect(accountSnapshot.interval).to.equal(expectedInterval);
        expect(globalsSnapshot.interval).to.equal(expectedInterval);
      }
    }

    /* eslint-enable no-await-in-loop */
  });

  it('Should go through stake lifecycle correctly', async () => {
    const stakeLocktime = Number((await staking.STAKE_LOCKTIME()).toString());

    // Stake 100
    await staking.stake(100n);
    let stake = await staking.stakes((await ethers.getSigners())[0].address, 0n);

    expect(stake.delegate).to.equal((await ethers.getSigners())[0].address);
    expect(stake.amount).to.equal(100n);
    expect(stake.locktime).to.equal(0n);
    expect(stake.claimedTime).to.equal(0n);

    // Should not allow claiming before unlock
    await expect(staking.claim(0n)).to.eventually.be.rejectedWith('Staking: Stake not unlocked');

    // Unlock stake
    await staking.unlock(0n);
    stake = await staking.stakes((await ethers.getSigners())[0].address, 0n);

    expect(stake.locktime).to.not.equal(0n);

    // Should not allow claiming before locktime is up
    await expect(staking.claim(0n)).to.eventually.be.rejectedWith('Staking: Stake not unlocked');

    // Increast time to stake unlock time
    await ethers.provider.send('evm_increaseTime', [stakeLocktime]);
    await ethers.provider.send('evm_mine');

    // Claim stake
    await staking.claim(0n);
    stake = await staking.stakes((await ethers.getSigners())[0].address, 0n);

    expect(stake.claimedTime).to.not.equal(0n);

    // Should not allow unlocking or claiming twice
    await expect(staking.unlock(0n)).to.eventually.be.rejectedWith('Staking: Stake already unlocked');
    await expect(staking.claim(0n)).to.eventually.be.rejectedWith('Staking: Stake already claimed');
  });

  it('Should delegate and snapshot correctly', async () => {
    const snapshotInterval = Number((await staking.SNAPSHOT_INTERVAL()).toString());
    const stakeLocktime = Number((await staking.STAKE_LOCKTIME()).toString());

    // Stake 100
    await staking.stake(100n);

    // Increast time to next interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Delegate to account 1
    await staking.delegate(
      0n,
      (await ethers.getSigners())[1].address,
    );

    // Check snapshots correctly stored values at begining of period
    let snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[0].address, 1n, 0n);
    expect(snapshot.votingPower).to.equal(100n);

    snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[1].address, 1n, 0n);
    expect(snapshot.votingPower).to.equal(0n);

    snapshot = await staking.globalsSnapshotAt(1n, 0n);
    expect(snapshot.totalVotingPower).to.equal(100n);
    expect(snapshot.totalStaked).to.equal(100n);

    // Increast time to next interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Check snapshots have updated to new values
    snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[0].address, 2n, 0n);
    expect(snapshot.votingPower).to.equal(0n);

    snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[1].address, 2n, 0n);
    expect(snapshot.votingPower).to.equal(100n);

    // Unlock stake
    await staking.unlock(0n);

    // Don't allow delegating after stake has been unlocked
    expect(staking.delegate(0n, (await ethers.getSigners())[0].address))
      .to.eventually.be.rejectedWith('Staking: Stake unlocked');

    // Increast time to next interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Check snapshots have updated to new values
    snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[0].address, 3n, 0n);
    expect(snapshot.votingPower).to.equal(0n);

    snapshot = await staking.accountSnapshotAt((await ethers.getSigners())[1].address, 3n, 0n);
    expect(snapshot.votingPower).to.equal(0n);

    snapshot = await staking.globalsSnapshotAt(3n, 0n);
    expect(snapshot.totalVotingPower).to.equal(0n);
    expect(snapshot.totalStaked).to.equal(100n);

    // Increast time to stake unlock time
    await ethers.provider.send('evm_increaseTime', [stakeLocktime]);
    await ethers.provider.send('evm_mine');

    // Claim stake
    await staking.claim(0n);

    // Increast time to next interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Check snapshots have updated to new values
    const currentInterval = await staking.currentInterval();
    snapshot = await staking.globalsSnapshotAt(currentInterval, 0n);
    expect(snapshot.totalVotingPower).to.equal(0n);
    expect(snapshot.totalStaked).to.equal(0n);
  });
});
