import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { GovernorRewardsShadow } from '../../helpers/treasury/governorrewards';

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
    await rail.mint(await rail.signer.getAddress(), 2n ** 256n - 1n);
    const staking = await Staking.deploy(rail.address);
    const treasury = await Treasury.deploy();
    let governorRewards = await GovernorRewards.deploy();

    // Deploy a bunch of tokens to use as distribution tokens and sort by integer representation of address
    const distributionTokensUnsorted = await Promise.all(
      Array(12)
        .fill(1)
        .map(() => ERC20.deploy()),
    );

    const distributionTokens = distributionTokensUnsorted.sort((a, b) => {
      return Number(BigInt(a.address) - BigInt(b.address));
    });

    await Promise.all(
      distributionTokens.map(async (token) =>
        token.mint(await token.signer.getAddress(), 2n ** 256n - 1n),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const proxyAdminAccount = signers.pop()!;

    // Deploy Proxy and set implementation
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    let proxy = await Proxy.deploy(proxyAdminAccount.address);
    proxy = proxy.connect(proxyAdminAccount);
    await proxy.upgrade(governorRewards.address);
    governorRewards = governorRewards.attach(proxy.address);
    await proxy.unpause();

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

    // Declare interval basis points
    const intervalBP = 10;

    // Set fee distribution interval
    await governorRewards.setIntervalBP(intervalBP);

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
      intervalBP,
      stakingInterval,
    };
  }

  it("Shouldn't initialize twice", async () => {
    const { governorRewards, treasury, staking } = await loadFixture(deploy);

    await expect(
      governorRewards.initializeGovernorRewards(staking.address, treasury.address, 0, []),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it('Admin functions should only be callable by governance', async () => {
    const { users } = await loadFixture(deploy);

    await expect(users[1].governorRewards.addTokens([])).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    await expect(users[1].governorRewards.removeTokens([])).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    await expect(users[1].governorRewards.setIntervalBP(1)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
  });

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
    this.timeout(5 * 60 * 60 * 1000);
    const intervals = process.env.SKIP_LONG_TESTS ? 50 : 100;

    const {
      stakingInterval,
      staking,
      governorRewards,
      users,
      basisPoints,
      intervalBP,
      stakingDistributionIntervalMultiplier,
    } = await loadFixture(deploy);

    // Increase time to first interval
    await time.increase(stakingInterval);

    // Loop through and create intervals
    for (let interval = 1; interval < intervals; interval += 1) {
      // Loop through each user
      await Promise.all(
        users.map(async (user, index) => {
          // Skip some intervals, create stakes on others
          if (interval % (index * 2) === 0) {
            await user.staking.stake(index);
          }
        }),
      );

      // Increase time to next interval
      await time.increase(stakingInterval);
    }

    // Incorrect number of hints should throw
    await expect(
      governorRewards.fetchAccountSnapshots(0, 0, users[0].signer.address, []),
    ).to.be.revertedWith('GovernorRewards: Incorrect number of hints given');
    await expect(governorRewards.fetchGlobalSnapshots(0, 0, [])).to.be.revertedWith(
      'GovernorRewards: Incorrect number of hints given',
    );

    // Create Governor Rewards Shadow
    const governorRewardsShadow = new GovernorRewardsShadow(
      BigInt(basisPoints),
      BigInt(intervalBP),
      stakingDistributionIntervalMultiplier,
    );

    // Scan snapshots
    await governorRewardsShadow.loadGlobalsSnapshots(staking);
    await Promise.all(
      users.map((user) => governorRewardsShadow.loadAccountSnapshots(user.signer.address, staking)),
    );

    // Loop through batch sizes
    for (let batch = 0; batch < 5; batch += 1) {
      // Loop through each user and check snapshots are retrieved correctly
      await Promise.all(
        users.map(async (user) => {
          // Loop through all intervals
          for (
            let interval = 1;
            interval < Math.floor(intervals / stakingDistributionIntervalMultiplier);
            interval += 1
          ) {
            const startingInterval = interval;
            const endingInterval =
              interval + batch > Math.floor(intervals / stakingDistributionIntervalMultiplier)
                ? Math.floor(intervals / stakingDistributionIntervalMultiplier)
                : interval + batch;

            // Fetch snapshots
            const snapshots = await governorRewards.fetchAccountSnapshots(
              startingInterval,
              endingInterval,
              user.signer.address,
              new Array(endingInterval - startingInterval + 1).fill(0) as number[],
            );

            // Check each snapshot returned the right value
            snapshots.forEach((snapshot, snapshotIndex) => {
              expect(snapshot).to.equal(
                governorRewardsShadow.getAccountSnapshot(
                  interval + snapshotIndex,
                  user.signer.address,
                )?.votingPower,
              );
            });
          }
        }),
      );
    }

    // Loop through batch sizes
    for (let batch = 0; batch < 5; batch += 1) {
      // Loop through intervals
      for (
        let interval = 1;
        interval < Math.floor(intervals / stakingDistributionIntervalMultiplier);
        interval += 1
      ) {
        const startingInterval = interval;
        const endingInterval =
          interval + batch > Math.floor(intervals / stakingDistributionIntervalMultiplier)
            ? Math.floor(intervals / stakingDistributionIntervalMultiplier)
            : interval + batch;

        // Fetch snapshots
        const snapshots = await governorRewards.fetchGlobalSnapshots(
          startingInterval,
          endingInterval,
          new Array(endingInterval - startingInterval + 1).fill(0) as number[],
        );

        // Check each snapshot returned the right value
        snapshots.forEach((snapshot, snapshotIndex) => {
          expect(snapshot).to.equal(
            governorRewardsShadow.getGlobalSnapshot(interval + snapshotIndex)?.totalVotingPower,
          );
        });
      }
    }
  });

  it('Should precalculate global snapshots', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    const intervals = process.env.SKIP_LONG_TESTS ? 50 : 100;

    const {
      stakingInterval,
      stakingDistributionIntervalMultiplier,
      staking,
      governorRewards,
      basisPoints,
      intervalBP,
    } = await loadFixture(deploy);

    // Increase time to first interval
    await time.increase(stakingInterval);

    // Loop through and create intervals
    for (let i = 1; i < intervals; i += 1) {
      // Stake every 3 intervals
      if (i % 3 === 0) {
        await staking.stake(100);
      }

      // Increase time to next interval
      await time.increase(stakingInterval);
    }

    // Should prefetch in order
    await expect(
      governorRewards.prefetchGlobalSnapshots(
        1,
        Math.floor(intervals / stakingDistributionIntervalMultiplier),
        new Array(Math.floor(intervals / stakingDistributionIntervalMultiplier) - 1).fill(
          0,
        ) as number[],
        [],
      ),
    ).to.be.revertedWith('GovernorRewards: Starting interval too late');

    // Should not allow prefetching future intervals
    await expect(
      governorRewards.prefetchGlobalSnapshots(
        0,
        Math.floor(intervals / stakingDistributionIntervalMultiplier) + 1,
        new Array(Math.floor(intervals / stakingDistributionIntervalMultiplier) + 2).fill(
          0,
        ) as number[],
        [],
      ),
    ).to.be.revertedWith("GovernorRewards: Can't prefetch future intervals");

    // Prefetch global snapshots in batches
    for (let i = 0; i <= Math.floor(intervals / stakingDistributionIntervalMultiplier); i += 5) {
      const startingInterval = i;
      const endingInterval =
        i + 5 > Math.floor(intervals / stakingDistributionIntervalMultiplier)
          ? Math.floor(intervals / stakingDistributionIntervalMultiplier)
          : i + 5;

      await governorRewards.prefetchGlobalSnapshots(
        startingInterval,
        endingInterval,
        new Array(endingInterval - startingInterval + 1).fill(0) as number[],
        [],
      );
    }

    // Scan snapshots
    const governorRewardsShadow = new GovernorRewardsShadow(
      BigInt(basisPoints),
      BigInt(intervalBP),
      stakingDistributionIntervalMultiplier,
    );
    await governorRewardsShadow.loadGlobalsSnapshots(staking);

    // Check fetched values
    for (let i = 0; i < Math.floor(intervals / stakingDistributionIntervalMultiplier); i += 1) {
      expect(await governorRewards.precalculatedGlobalSnapshots(i)).to.equal(
        governorRewardsShadow.getGlobalSnapshot(i)?.totalVotingPower,
      );
    }
  });

  it('Should earmark', async function () {
    const {
      distributionInterval,
      distributionTokens,
      basisPoints,
      intervalBP,
      stakingDistributionIntervalMultiplier,
      staking,
      treasury,
      governorRewards,
    } = await loadFixture(deploy);

    const intervals = 10;

    // Stake every 3rd interval
    for (let i = 0; i < intervals; i += 1) {
      if (i % 3 === 2) {
        // Stake tokens
        await staking.stake(100);
      }

      // Fast forward to first interval
      await time.increase(distributionInterval);
    }

    // Prefetch snapshots
    await governorRewards.prefetchGlobalSnapshots(
      0,
      intervals,
      new Array(intervals + 1).fill(0) as number[],
      [],
    );

    // Scan events in to shadow
    const governorRewardsShadow = new GovernorRewardsShadow(
      BigInt(basisPoints),
      BigInt(intervalBP),
      stakingDistributionIntervalMultiplier,
    );
    await governorRewardsShadow.loadGlobalsSnapshots(staking);

    for (let tokenIndex = 0; tokenIndex < distributionTokens.length; tokenIndex += 1) {
      // Set fee distribution interval
      await governorRewards.setIntervalBP(tokenIndex);

      // Get initial treasury balance
      const treasuryBalanceBeforeEarmark = (
        await distributionTokens[tokenIndex].balanceOf(treasury.address)
      ).toBigInt();

      // Calculate expected earmarks
      governorRewardsShadow.intervalBP = BigInt(tokenIndex);
      const expectedEarmarks = governorRewardsShadow.calculateEarmarkAmount(
        treasuryBalanceBeforeEarmark,
        0,
        intervals,
      );

      // Get total tokens that should move
      const totalMoved = expectedEarmarks.reduce((l, r) => l + r);

      // Earmark token and check the right amount was moved
      await expect(
        governorRewards.earmark(distributionTokens[tokenIndex].address),
      ).to.changeTokenBalances(
        distributionTokens[tokenIndex],
        [treasury.address, governorRewards.address],
        [-totalMoved, totalMoved],
      );

      // Multiple calls shouldn't earmark repeatedly
      await expect(
        governorRewards.earmark(distributionTokens[tokenIndex].address),
      ).to.changeTokenBalances(
        distributionTokens[tokenIndex],
        [treasury.address, governorRewards.address],
        [0, 0],
      );

      // Check all earmark values are correct
      await Promise.all(
        new Array(intervals).fill(0).map(async (x, earmarkIndex) => {
          expect(
            await governorRewards.earmarked(distributionTokens[tokenIndex].address, earmarkIndex),
          ).to.equal(expectedEarmarks[earmarkIndex]);
        }),
      );
    }

    // Set fee distribution interval
    await governorRewards.setIntervalBP(200);

    const startingInterval = Number(await governorRewards.nextSnapshotPreCalcInterval());
    const endingInterval = startingInterval + 3;

    // Earmark after some more intervals
    await time.increase(distributionInterval * (endingInterval - startingInterval + 1));

    // Prefetch snapshots
    await governorRewards.prefetchGlobalSnapshots(
      startingInterval,
      endingInterval,
      new Array(endingInterval - startingInterval + 1).fill(0) as number[],
      [],
    );

    // Get initial treasury balance
    const treasuryBalanceBeforeEarmark = (
      await distributionTokens[0].balanceOf(treasury.address)
    ).toBigInt();

    // Load snapshots
    await governorRewardsShadow.loadGlobalsSnapshots(staking);

    // Calculate expected earmarks
    governorRewardsShadow.intervalBP = BigInt(200);
    const expectedEarmarks = governorRewardsShadow.calculateEarmarkAmount(
      treasuryBalanceBeforeEarmark,
      startingInterval,
      endingInterval,
    );

    // Get total tokens that should move
    const totalMoved = expectedEarmarks.reduce((l, r) => l + r);

    // Earmark token and check the right amount was moved
    await expect(governorRewards.earmark(distributionTokens[0].address)).to.changeTokenBalances(
      distributionTokens[0],
      [treasury.address, governorRewards.address],
      [-totalMoved, totalMoved],
    );

    // Check all earmark values are correct
    await Promise.all(
      new Array(endingInterval - startingInterval + 1).fill(0).map(async (x, earmarkIndex) => {
        expect(
          await governorRewards.earmarked(
            distributionTokens[0].address,
            earmarkIndex + startingInterval,
          ),
        ).to.equal(expectedEarmarks[earmarkIndex]);
      }),
    );
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

  it('Should calculate rewards', async () => {
    const {
      distributionInterval,
      distributionTokens,
      users,
      governorRewards,
      basisPoints,
      intervalBP,
      stakingDistributionIntervalMultiplier,
      staking,
    } = await loadFixture(deploy);

    const intervals = 10;

    // Stake and increase intervals
    for (let i = 0; i < intervals; i += 1) {
      await Promise.all(
        users.map(async (user, index) => {
          if (i % index === 1) {
            await user.staking.stake(100);
          }
        }),
      );

      // Fast forward to first interval
      await time.increase(distributionInterval);
    }

    // Prefetch data and earmark
    await governorRewards.prefetchGlobalSnapshots(
      0,
      intervals,
      Array(intervals + 1).fill(0) as number[],
      distributionTokens.map((token) => token.address),
    );

    // Scan events in to shadow
    const governorRewardsShadow = new GovernorRewardsShadow(
      BigInt(basisPoints),
      BigInt(intervalBP),
      stakingDistributionIntervalMultiplier,
    );
    await governorRewardsShadow.loadGlobalsSnapshots(staking);

    // Loop through each user and check rewards are what we expect
    for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
      // Fetch snapshots
      await governorRewardsShadow.loadAccountSnapshots(users[userIndex].signer.address, staking);

      // Calculate rewards
      for (let i = 0; i < intervals; i += userIndex + 1) {
        const startingInterval = i;
        const endingInterval = i + userIndex < intervals ? i + userIndex : intervals;

        const expectedRewards = await governorRewardsShadow.calculateRewards(
          governorRewards,
          distributionTokens[0].address,
          users[userIndex].signer.address,
          startingInterval,
          endingInterval,
        );

        expect(
          (
            await governorRewards.calculateRewards(
              [distributionTokens[0].address],
              users[userIndex].signer.address,
              startingInterval,
              endingInterval,
              new Array(endingInterval - startingInterval + 1).fill(0) as number[],
              true,
            )
          )[0],
        ).to.equal(expectedRewards);
      }
    }
  });

  it('Should pass safety vector checks', async () => {
    const { governorRewards, users } = await loadFixture(deploy);
    const governorRewardsNoAdmin = governorRewards.connect(users[1].signer);
    await expect(governorRewards.treasury()).to.be.fulfilled;
    await expect(governorRewards.checkSafetyVectors()).to.be.reverted;
    await expect(governorRewards.treasury()).to.be.fulfilled;
    await expect(
      governorRewardsNoAdmin.addVector(BigInt(users[0].signer.address)),
    ).to.be.revertedWith('Ownable: caller is not the owner');
    await governorRewards.addVector(BigInt(users[0].signer.address));
    await expect(
      governorRewardsNoAdmin.removeVector(BigInt(users[0].signer.address)),
    ).to.be.revertedWith('Ownable: caller is not the owner');
    await governorRewards.removeVector(BigInt(users[0].signer.address));
    await expect(governorRewards.checkSafetyVectors()).to.be.reverted;
    await governorRewards.addVector(BigInt(users[0].signer.address));
    await expect(governorRewards.treasury()).to.be.fulfilled;
    await expect(governorRewards.checkSafetyVectors()).to.be.fulfilled;
    await expect(governorRewards.treasury()).to.be.reverted;
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
    await governorRewards.prefetchGlobalSnapshots(0, 9, Array(10).fill(0) as number[], []);

    // Should not be able to claim if not earmarked
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        Array(10).fill(0) as number[],
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

    // Should not be able to claim if tokens aren't ordered correctly
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address).reverse(),
        users[1].signer.address,
        0,
        9,
        Array(10).fill(0) as number[],
      ),
    ).to.be.revertedWith("GovernorRewards: Duplicate token or tokens aren't ordered");

    // Claim rewards
    await expect(
      governorRewards.claim(
        distributionTokens.map((token) => token.address),
        users[1].signer.address,
        0,
        9,
        Array(10).fill(0) as number[],
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
        Array(10).fill(0) as number[],
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
          Array(10).fill(0) as number[],
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
          Array(10).fill(0) as number[],
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
        Array(10).fill(0) as number[],
      ),
    ).to.changeTokenBalances(
      distributionTokens[0],
      [governorRewards.address, users[1].signer.address],
      [0, 0],
    );
  });
});
