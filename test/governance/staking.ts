import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Governance/Staking', () => {
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');

    // Deploy with test ERC20 as staking coin
    const testERC20 = await TestERC20.deploy();
    const staking = await Staking.deploy(testERC20.address);

    // Approve entire balance for staking
    await testERC20.approve(
      staking.address,
      await testERC20.balanceOf((await ethers.getSigners())[0].address),
    );

    return {
      testERC20,
      staking,
    };
  }

  it('Should count intervals properly', async () => {
    const { staking } = await loadFixture(deploy);

    const snapshotInterval = Number(await staking.SNAPSHOT_INTERVAL());

    for (let i = 0; i < 10; i += 1) {
      // Check we are in correct interval
      expect(await staking.currentInterval()).to.equal(i);

      // Increase time to next interval
      await time.increase(snapshotInterval);
    }
  });

  it('Should return correct snapshot regardless of hint', async function () {
    let loops = 5n;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 20n;
    }

    const { staking } = await loadFixture(deploy);

    const snapshotInterval = Number(await staking.SNAPSHOT_INTERVAL());

    const snapshotIntervals = [];

    // Increase time to first interval
    await time.increase(snapshotInterval);

    // Loop through intervals
    for (let i = 1; i < loops; i += 1) {
      // Take a snapshot every 3rd interval
      if (i % 3 === 0) {
        await staking.snapshotStub((await ethers.getSigners())[0].address);

        snapshotIntervals.push(i);
      }

      // Increase time to next interval
      await time.increase(snapshotInterval);
    }

    // Increase time without taking snapshots
    await time.increase(snapshotInterval * 10);

    // Loop through each interval and try a hint for each one
    for (let i = 0; i < loops + 5n; i += 1) {
      for (let hint = 0; hint < loops * 2n; hint += 1) {
        // Should be inclusive upper bounds or if all values are lower than
        // the interval it should be interval itself
        const expectedInterval = snapshotIntervals.reduceRight(
          (right, left) => (left >= i ? left : right),
          i,
        );

        const accountSnapshot = await staking.accountSnapshotAt(
          (
            await ethers.getSigners()
          )[0].address,
          i,
          hint,
        );

        const globalsSnapshot = await staking.globalsSnapshotAt(i, hint);

        expect(accountSnapshot.interval).to.equal(expectedInterval);
        expect(globalsSnapshot.interval).to.equal(expectedInterval);
      }
    }
  });

  it('Should go through stake lifecycle', async () => {
    const { staking } = await loadFixture(deploy);

    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());

    // Stake 100
    await expect(staking.stake(100))
      .to.emit(staking, 'Stake')
      .withArgs((await ethers.getSigners())[0].address, 0, 100);
    let stake = await staking.stakes((await ethers.getSigners())[0].address, 0);
    expect(stake.delegate).to.equal((await ethers.getSigners())[0].address);
    expect(stake.amount).to.equal(100);
    expect(stake.locktime).to.equal(0);
    expect(stake.claimedTime).to.equal(0);

    // Should not allow claiming before unlock
    await expect(staking.claim(0)).to.be.revertedWith('Staking: Stake not unlocked');

    // Unlock stake
    await expect(staking.unlock(0))
      .to.emit(staking, 'Unlock')
      .withArgs((await ethers.getSigners())[0].address, 0);
    stake = await staking.stakes((await ethers.getSigners())[0].address, 0n);
    expect(stake.locktime).to.not.equal(0n);

    // Should not allow claiming before locktime is up
    await expect(staking.claim(0n)).to.be.revertedWith('Staking: Stake not unlocked');

    // Increase time to stake unlock time
    await time.increase(stakeLocktime);

    // Claim stake
    await expect(staking.claim(0n))
      .to.emit(staking, 'Claim')
      .withArgs((await ethers.getSigners())[0].address, 0);
    stake = await staking.stakes((await ethers.getSigners())[0].address, 0n);
    expect(stake.claimedTime).to.not.equal(0n);

    // Should not allow unlocking or claiming twice
    await expect(staking.unlock(0n)).to.be.revertedWith('Staking: Stake already unlocked');
    await expect(staking.claim(0n)).to.be.revertedWith('Staking: Stake already claimed');
  });

  it('Should delegate and snapshot', async () => {
    const { staking } = await loadFixture(deploy);

    const snapshotInterval = Number(await staking.SNAPSHOT_INTERVAL());
    const stakeLocktime = Number(await staking.STAKE_LOCKTIME());

    // Stake 100
    await staking.stake(100);

    // Increase time to next interval
    await time.increase(snapshotInterval);

    // Delegate to account 1
    await expect(staking.delegate(0n, (await ethers.getSigners())[1].address))
      .to.emit(staking, 'Delegate')
      .withArgs(
        (
          await ethers.getSigners()
        )[0].address,
        (
          await ethers.getSigners()
        )[0].address,
        (
          await ethers.getSigners()
        )[1].address,
        0,
        100,
      );

    // Check snapshots correctly stored values at beginning of period
    let snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[0].address,
      1,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(100);

    snapshotAccount = await staking.accountSnapshotAt((await ethers.getSigners())[1].address, 1, 0);
    expect(snapshotAccount.votingPower).to.equal(0);

    let snapshotGlobal = await staking.globalsSnapshotAt(1, 0);
    expect(snapshotGlobal.totalVotingPower).to.equal(100);
    expect(snapshotGlobal.totalStaked).to.equal(100);

    // Increase time to next interval
    await time.increase(snapshotInterval);

    // Check snapshots have updated to new values
    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[0].address,
      2,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(0);

    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[1].address,
      2,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(100);

    // Undelegate
    await expect(staking.undelegate(0))
      .to.emit(staking, 'Delegate')
      .withArgs(
        (
          await ethers.getSigners()
        )[0].address,
        (
          await ethers.getSigners()
        )[1].address,
        (
          await ethers.getSigners()
        )[0].address,
        0,
        100,
      );

    // Increase time to next interval
    await time.increase(snapshotInterval);

    // Check snapshots have updated to new values
    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[0].address,
      3,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(100);

    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[1].address,
      3,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(0);

    // Unlock stake
    await staking.unlock(0);

    // Don't allow delegating after stake has been unlocked
    expect(
      staking.delegate(0, (await ethers.getSigners())[1].address),
    ).to.be.revertedWith('Staking: Stake unlocked');

    // Increase time to next interval
    await time.increase(snapshotInterval);

    // Check snapshots have updated to new values
    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[0].address,
      4,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(0);

    snapshotAccount = await staking.accountSnapshotAt(
      (
        await ethers.getSigners()
      )[1].address,
      4,
      0,
    );
    expect(snapshotAccount.votingPower).to.equal(0);

    snapshotGlobal = await staking.globalsSnapshotAt(4, 0);
    expect(snapshotGlobal.totalVotingPower).to.equal(0);
    expect(snapshotGlobal.totalStaked).to.equal(100);

    // Increase time to stake unlock time
    await time.increase(stakeLocktime);

    // Claim stake
    await staking.claim(0);

    // Increase time to next interval
    await time.increase(snapshotInterval);

    // Check snapshots have updated to new values
    const currentInterval = await staking.currentInterval();
    snapshotGlobal = await staking.globalsSnapshotAt(currentInterval, 0);
    expect(snapshotGlobal.totalVotingPower).to.equal(0);
    expect(snapshotGlobal.totalStaked).to.equal(0);
  });
});
