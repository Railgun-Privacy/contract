import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Treasury/GovernorRewards', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Get signers list
    const signers = await ethers.getSigners();

    // Get contracts
    const GovernorRewards = await ethers.getContractFactory('GovernorRewards');
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');
    const Treasury = await ethers.getContractFactory('Treasury');

    // Deploy contracts
    const rail = await ERC20.deploy();
    const staking = await Staking.deploy(rail.address);
    const treasury = await Treasury.deploy();
    const governorRewards = await GovernorRewards.deploy();

    // Deploy a bunch of tokens to use as distribution tokens
    const distributionTokens = await Promise.all(new Array(12).fill(1).map(() => ERC20.deploy()));

    // Setup contract connections for each signer
    const users = signers.map((signer) => ({
      signer,
      rail: rail.connect(signer),
      distributionTokens: distributionTokens.map((token) => token.connect(signer)),
      staking: staking.connect(signer),
      governorRewards: governorRewards.connect(signer),
    }));

    // Send staking tokens to each signer and allow staking
    for (const user of users) {
      await rail.transfer(user.signer.address, 100000);

      await user.rail.approve(staking.address, 2n ** 256n - 1n);
    }

    // Initialize contracts
    await treasury.initializeTreasury(users[0].signer.address);

    await governorRewards.initializeGovernorRewards(
      users[0].signer.address,
      staking.address,
      treasury.address,
      0,
      distributionTokens.map((token) => token.address),
    );

    // Send distribution tokens balance to treasury
    await Promise.all(
      distributionTokens.map(async (token) => {
        await token.transfer(treasury.address, 100000n * 10n ** 18n);
      }),
    );

    // Set fee distribution interval
    await governorRewards.setIntervalBP(10);

    // Get constants
    const stakingDistributionIntervalMultiplier = Number(
      await governorRewards.STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER(),
    );
    const distributionInterval = Number(await governorRewards.DISTRIBUTION_INTERVAL());
    const basisPoints = Number(await governorRewards.BASIS_POINTS());
    const stakingInterval = Number(await staking.SNAPSHOT_INTERVAL());

    // Give fee distribution contract transfer role
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), governorRewards.address);

    return {
      rail,
      staking,
      treasury,
      governorRewards,
      distributionTokens,
      users,
      stakingDistributionIntervalMultiplier,
      distributionInterval,
      basisPoints,
      stakingInterval,
    };
  }

  it('Should calculate interval numbers', async () => {
    const { stakingInterval, stakingDistributionIntervalMultiplier, governorRewards } =
      await loadFixture(deploy);

    // Should throw for interval times in the past
    await expect(governorRewards.intervalAtTime(0)).to.be.revertedWith(
      'GovernorRewards: Requested time is before contract was deployed',
    );

    // Should return intervals correctly
    for (let i = 1; i < 10; i += 1) {
      // Check current interval returns correct value
      expect(await governorRewards.currentInterval()).to.equal(
        Math.floor(i / stakingDistributionIntervalMultiplier),
      );

      // Check interval at time returns correct value
      expect(await governorRewards.intervalAtTime(await time.latest())).to.equal(
        Math.floor(i / stakingDistributionIntervalMultiplier),
      );

      await time.increase(stakingInterval);
    }
  });

  it('Should retrieve snapshot sequence', async function () {
    let intervals = 50;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 100;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 1000;
    }

    const {
      stakingInterval,
      stakingDistributionIntervalMultiplier,
      staking,
      governorRewards,
      users,
    } = await loadFixture(deploy);

    // Increase time to first interval
    await time.increase(stakingInterval);

    let currentVotingPower = 0;
    const votingPower = [0];

    // Loop through and create intervals
    for (let i = 1; i < intervals; i += 1) {
      // Store voting power snapshot
      if (i % stakingDistributionIntervalMultiplier === 0) {
        votingPower.push(currentVotingPower);
      }

      // Stake every 3 interval
      if (i % 3 === 0) {
        await staking.stake(100);
        currentVotingPower += 100;
      }

      // Increase time to next interval
      await time.increase(stakingInterval);
    }

    // Incorrect number of hints should throw
    await expect(
      governorRewards.fetchAccountSnapshots(0, votingPower.length - 1, users[0].signer.address, []),
    ).to.be.rejectedWith('GovernorRewards: Incorrect number of hints given');
    await expect(
      governorRewards.fetchGlobalSnapshots(0, votingPower.length - 1, []),
    ).to.be.rejectedWith('GovernorRewards: Incorrect number of hints given');

    // Check account with correct hints
    expect(
      (
        await governorRewards.fetchAccountSnapshots(
          0,
          votingPower.length - 1,
          users[0].signer.address,
          votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
        )
      ).map((val) => val.toNumber()),
    ).to.deep.equal(votingPower);

    // Check account with incorrect hints
    expect(
      (
        await governorRewards.fetchAccountSnapshots(
          0,
          votingPower.length - 1,
          users[0].signer.address,
          votingPower.map(() => 0),
        )
      ).map((val) => val.toNumber()),
    ).to.deep.equal(votingPower);

    // Check global with correct hints
    expect(
      (
        await governorRewards.fetchGlobalSnapshots(
          0,
          votingPower.length - 1,
          votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
        )
      ).map((val) => val.toNumber()),
    ).to.deep.equal(votingPower);

    // Check global with incorrect hints
    expect(
      (
        await governorRewards.fetchGlobalSnapshots(
          0,
          votingPower.length - 1,
          votingPower.map(() => 0),
        )
      ).map((val) => val.toNumber()),
    ).to.deep.equal(votingPower);
  });

  it('Should precalculate global snapshots', async function () {
    let intervals = 50;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 100;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 1000;
    }

    const { stakingInterval, stakingDistributionIntervalMultiplier, staking, governorRewards } =
      await loadFixture(deploy);

    // Increase time to first interval
    await time.increase(stakingInterval);

    let currentVotingPower = 0;
    const votingPower = [0];

    // Loop through and create intervals
    for (let i = 1; i < intervals; i += 1) {
      // Store voting power snapshot
      if (i % stakingDistributionIntervalMultiplier === 0) {
        votingPower.push(currentVotingPower);
      }

      // Stake every 3 intervals
      if (i % 3 === 0) {
        await staking.stake(100);
        currentVotingPower += 100;
      }

      // Increase time to next interval
      await time.increase(stakingInterval);
    }

    // Should prefetch in order
    await expect(
      governorRewards.prefetchGlobalSnapshots(
        1,
        votingPower.length - 1,
        votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
        [],
      ),
    ).to.be.revertedWith('GovernorRewards: Starting interval too late');

    // Should not allow prefetching future intervals
    await expect(
      governorRewards.prefetchGlobalSnapshots(
        0,
        votingPower.length,
        votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
        [],
      ),
    ).to.be.revertedWith("GovernorRewards: Can't prefetch future intervals");

    // Prefetch global snapshots
    await governorRewards.prefetchGlobalSnapshots(
      0,
      votingPower.length - 1,
      votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
      [],
    );

    // Check fetched values
    for (let i = 0; i < votingPower.length; i += 1) {
      expect(await governorRewards.precalculatedGlobalSnapshots(i)).to.equal(votingPower[i]);
    }
  });

  it('Should earmark', async () => {
    const {
      distributionInterval,
      distributionTokens,
      basisPoints,
      staking,
      treasury,
      governorRewards,
    } = await loadFixture(deploy);

    // Stake tokens
    await staking.stake(100);

    // Fast forward to first interval
    await time.increase(distributionInterval);

    // Prefetch snapshots
    await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0], []);

    for (let i = 0; i < distributionTokens.length; i += 1) {
      // Set fee distribution interval
      await governorRewards.setIntervalBP(i);

      // Get expected earmark amount
      const treasuryBalanceBeforeEarmark = (
        await distributionTokens[i].balanceOf(treasury.address)
      ).toBigInt();
      const expectedEarmark = (treasuryBalanceBeforeEarmark * BigInt(i)) / BigInt(basisPoints);

      // Earmark token and check the right amount was moved
      await expect(governorRewards.earmark(distributionTokens[i].address)).to.changeTokenBalances(
        distributionTokens[i],
        [treasury.address, governorRewards.address],
        [-expectedEarmark, expectedEarmark],
      );

      // Multiple calls shouldn't earmark repeatedly
      await expect(governorRewards.earmark(distributionTokens[i].address)).to.changeTokenBalances(
        distributionTokens[i],
        [treasury.address, governorRewards.address],
        [0, 0],
      );

      // Check that the right amount was entered in the earmarked record
      expect(
        (await governorRewards.earmarked(distributionTokens[i].address, 0)).toBigInt() +
          (await governorRewards.earmarked(distributionTokens[i].address, 1)).toBigInt(),
      ).to.equal(expectedEarmark);
    }
  });

  it('Should add and remove from earmark list', async () => {
    const { distributionInterval, distributionTokens, staking, governorRewards } =
      await loadFixture(deploy);

    // Stake tokens
    await staking.stake(100);

    // Fast forward to first interval
    await time.increase(distributionInterval);

    // Prefetch snapshots
    await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0], []);

    // Remove from list
    await governorRewards.removeTokens(distributionTokens.map((token) => token.address));

    // Earmark should fail
    await expect(governorRewards.earmark(distributionTokens[0].address)).to.be.revertedWith(
      'GovernorRewards: Token is not on distribution list',
    );

    // Add to list
    await governorRewards.addTokens(distributionTokens.map((token) => token.address));

    // Earmark should succeed
    await expect(governorRewards.earmark(distributionTokens[0].address)).to.be.fulfilled;
  });

  it("Shouldn't earmark if no tokens are staked", async () => {
    const { distributionInterval, distributionTokens, treasury, governorRewards } =
      await loadFixture(deploy);

    // Fast forward to first interval
    await time.increase(distributionInterval);

    for (let i = 0; i < distributionTokens.length; i += 1) {
      // Set fee distribution interval
      await governorRewards.setIntervalBP(i);

      // Earmark token
      await expect(
        governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0], [distributionTokens[i].address]),
      ).to.changeTokenBalances(
        distributionTokens[i],
        [treasury.address, governorRewards.address],
        [0, 0],
      );

      // Check that nothing was entered in the earmarked record
      expect(await governorRewards.earmarked(distributionTokens[i].address, 0)).to.equal(0);
      expect(await governorRewards.earmarked(distributionTokens[i].address, 1)).to.equal(0);
    }
  });

  it('Should calculate rewards', async () => {
    const { distributionInterval, distributionTokens, users, governorRewards } = await loadFixture(
      deploy,
    );

    // Stake tokens
    await users[0].staking.stake(100);
    await users[1].staking.stake(100);

    // Increase time to 10th interval
    await time.increase(distributionInterval * 10);

    // Prefetch data
    await governorRewards.prefetchGlobalSnapshots(
      0,
      9,
      new Array(10).fill(0) as number[],
      distributionTokens.map((token) => token.address),
    );

    // Calculate rewards
    const user1reward = (
      await governorRewards.calculateRewards(
        distributionTokens.map((token) => token.address),
        users[0].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
        false,
      )
    ).map((val) => val.toBigInt());

    const user2reward = (
      await governorRewards.calculateRewards(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
        false,
      )
    ).map((val) => val.toBigInt());

    // Rewards should be the same for equal stakes
    expect(user1reward).to.deep.equal(user2reward);

    // Get total rewards for first distribution token
    let totalRewards = 0n;
    for (let i = 0; i <= 9; i += 1) {
      const intervalEarmarked = (
        await governorRewards.earmarked(distributionTokens[0].address, i)
      ).toBigInt();
      totalRewards += intervalEarmarked / 2n;
    }

    // Check rewards are what we expect
    expect(user1reward[0].toString()).to.equal(totalRewards.toString());
  });

  it('Should claim', async () => {
    const { distributionInterval, distributionTokens, users, governorRewards } = await loadFixture(
      deploy,
    );

    // Stake tokens
    await users[1].staking.stake(100);
    await users[2].staking.stake(100);

    // Increase time to 10th interval
    await time.increase(distributionInterval * 10);

    // Prefetch data
    await governorRewards.prefetchGlobalSnapshots(0, 9, new Array(10).fill(0) as number[], []);

    // Should not be able to claim if not earmarked
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
      ),
    ).to.be.revertedWith('GovernorRewards: Tried to claim beyond last earmarked interval');

    // Earmark all tokens
    await Promise.all(distributionTokens.map((token) => governorRewards.earmark(token.address)));

    // Get total rewards
    let totalRewards = 0n;
    for (let i = 0; i <= 9; i += 1) {
      const intervalEarmarked = (
        await governorRewards.earmarked(distributionTokens[0].address, i)
      ).toBigInt();

      totalRewards += intervalEarmarked / 2n;
    }

    // Claim rewards
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
      ),
    )
      .to.emit(governorRewards, 'Claim')
      .withArgs(distributionTokens[0].address, users[1].signer.address, totalRewards, 0, 9);

    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[2].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
      ),
    )
      .to.emit(governorRewards, 'Claim')
      .withArgs(distributionTokens[0].address, users[2].signer.address, totalRewards, 0, 9)
      .changeTokenBalances(
        distributionTokens[0],
        [governorRewards, users[2].signer.address],
        [-totalRewards, totalRewards],
      );

    // Check claimed records are updated
    for (let i = 0; i <= 9; i += 1) {
      expect(
        await governorRewards.getClaimed(users[2].signer.address, distributionTokens[0].address, i),
      ).to.equal(true);
    }

    expect(
      await governorRewards.getClaimed(users[2].signer.address, distributionTokens[0].address, 10),
    ).to.equal(false);

    // Check rewards have been paid out
    expect(await distributionTokens[0].balanceOf(users[1].signer.address)).to.equal(totalRewards);
    expect(await distributionTokens[0].balanceOf(users[2].signer.address)).to.equal(totalRewards);

    // Calculate rewards should return 0 if ignoring claimed
    expect(
      (
        await governorRewards.calculateRewards(
          distributionTokens.map((token) => token.address),
          users[1].signer.address,
          0,
          9,
          new Array(10).fill(0) as number[],
          true,
        )
      )[0],
    ).to.equal(0);

    // Calculate rewards should return original value if not ignoring claimed
    expect(
      (
        await governorRewards.calculateRewards(
          distributionTokens.map((token) => token.address),
          users[1].signer.address,
          0,
          9,
          new Array(10).fill(0) as number[],
          false,
        )
      )[0],
    ).to.equal(totalRewards);

    // Claiming rewards twice should move 0 coins
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        new Array(10).fill(0) as number[],
      ),
    ).to.changeTokenBalances(
      distributionTokens[0],
      [governorRewards.address, users[1].signer.address],
      [0, 0],
    );
  });
});
